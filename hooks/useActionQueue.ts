// hooks/useActionQueue.ts
// ---------------------------------------------------------------------------
// 실행 큐 오케스트레이션 훅 (Phase 2b-2).
//
// 설계 원칙 (Codex 리뷰 반영):
//   · **보이지 않는 쓰기 금지**: 마운트 자동 effect 없음. 큐 생성·저장은 명시적 `refreshActionQueue()` 호출로만.
//   · **최소 fetch**: 터틀 포지션 + 관심종목의 "터틀 후보"만, 55일 돈치안 + ATR20을 덮는 최소 기간(≈105일).
//   · 순수 계산(N·돈치안·생성·병합)은 utils에 위임 — 훅은 fetch + 배선만.
//   · 통화 규약(D6): 가격/N/돈치안 원통화, fxRate로 사이징·리스크만 KRW 환산.
//
// 사용자 행동(markDone/markSkipped/snooze)은 사용자가 명시적으로 일으키므로 저장이 "보이는 쓰기"다.

import { useCallback, useState } from 'react';
import { usePortfolio } from '../contexts/PortfolioContext';
import {
  fetchStockHistoricalPrices,
  fetchCryptoHistoricalPrices,
  isCryptoExchange,
  convertTickerForAPI,
  HistoricalPriceResult,
} from '../services/historicalPriceService';
import {
  buildTurtleActions,
  diagnoseTurtleActions,
  reconcileActionQueue,
  isSnoozeExpired,
  TurtleMarketInput,
  TurtleCandidateRef,
} from '../utils/actionQueueGenerator';
import {
  assembleMarketInput,
  extractOhlcvSeries,
  turtleHistoryWindow,
  computeDeployedBudgetKRW,
  turtleFxRate,
} from '../utils/turtleMarketData';
import { resolveTurtleUpdate, completeQueueItem, TurtleFill } from '../utils/turtleExecution';
import { ActionItem, RefreshDiagnostics, TurtleActionDiagnostics } from '../types/actionQueue';
import { Currency, NewAssetForm } from '../types';
import type { AddAssetResult } from '../types/assetActionResult';
import { createLogger } from '../utils/logger';

const log = createLogger('ActionQueue');

interface TickerMeta {
  ticker: string;
  name: string;
  price: number;          // 현재가 (priceOriginal, 원통화)
  currency?: Currency;
  exchange: string;
  isCrypto: boolean;
  fetchTicker: string;    // API 조회용 변환 티커
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function useActionQueue() {
  const { data, actions } = usePortfolio();
  const { assets, watchlist, exchangeRates, turtlePositions, turtleSettings, actionQueue } = data;
  const { updateActionQueue, addAsset, confirmSell, confirmBuyMore, commitPortfolioPatch } = actions;

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  /**
   * 터틀 규칙을 평가해 실행 큐를 갱신한다 (명시적 호출 전용 — 자동 실행 아님).
   * 오픈 포지션의 손절/청산/피라미딩 + 터틀 후보의 진입을 생성하고, 만료 스누즈를 되살려 저장한다.
   */
  const refreshActionQueue = useCallback(async (): Promise<{ generated: number; diagnostics: RefreshDiagnostics }> => {
    setIsRefreshing(true);
    setRefreshError(null);
    const today = todayISO();

    const openPositions = turtlePositions.filter(p => p.status === 'open');
    // 훅 레벨 진단 사실(생성기에 도달하기 전에 알 수 있는 것) — 예산·후보·시세 미갱신
    const turtleCandidates = watchlist.filter(w => w.isTurtleCandidate);
    const stalePriceTickers = turtleCandidates.filter(w => !((w.priceOriginal ?? 0) > 0)).map(w => w.ticker);
    const emptyActionsDiag: TurtleActionDiagnostics = { positions: [], candidates: [], generatedCount: 0 };
    const makeDiag = (actions: TurtleActionDiagnostics): RefreshDiagnostics => ({
      budgetKRW: turtleSettings.satelliteBudgetKRW,
      budgetMissing: !(turtleSettings.satelliteBudgetKRW > 0),
      turtleCandidateCount: turtleCandidates.length,
      stalePriceTickers,
      openPositionCount: openPositions.length,
      actions,
    });

    try {
      const { startDate, endDate } = turtleHistoryWindow(turtleSettings, today);

      const candidateItems = watchlist.filter(w => w.isTurtleCandidate && (w.priceOriginal ?? 0) > 0);

      // ── 종목 메타 해석 (현재가·통화·거래소) ──
      const metaByTicker = new Map<string, TickerMeta>();
      const addMeta = (ticker: string, name: string, price: number | undefined, currency: Currency | undefined, exchange: string) => {
        if (metaByTicker.has(ticker) || !(price && price > 0)) return;
        metaByTicker.set(ticker, {
          ticker, name, price, currency, exchange,
          isCrypto: isCryptoExchange(exchange),
          fetchTicker: convertTickerForAPI(ticker, exchange),
        });
      };
      for (const p of openPositions) {
        const asset = (p.assetId ? assets.find(a => a.id === p.assetId) : undefined) ?? assets.find(a => a.ticker === p.ticker);
        if (asset) addMeta(p.ticker, p.name, asset.priceOriginal, asset.currency, asset.exchange);
      }
      for (const w of candidateItems) addMeta(w.ticker, w.name, w.priceOriginal, w.currency, w.exchange);

      const metas = [...metaByTicker.values()];
      if (metas.length === 0) {
        // 대상 없음 — 만료 스누즈만 되살릴 수 있으면 저장, 아니면 무저장(보이지 않는 쓰기 방지)
        const hasRevival = actionQueue.some(it => isSnoozeExpired(it, today));
        if (hasRevival) updateActionQueue(reconcileActionQueue(actionQueue, [], today));
        return { generated: 0, diagnostics: makeDiag(emptyActionsDiag) };
      }

      // ── OHLCV 최소 기간 fetch (주식/코인 분기) ──
      const cryptoTickers = metas.filter(m => m.isCrypto).map(m => m.fetchTicker);
      const stockTickers = metas.filter(m => !m.isCrypto).map(m => m.fetchTicker);
      const empty: Record<string, HistoricalPriceResult> = {};
      const [cryptoRes, stockRes] = await Promise.all([
        cryptoTickers.length ? fetchCryptoHistoricalPrices(cryptoTickers, startDate, endDate) : Promise.resolve(empty),
        stockTickers.length ? fetchStockHistoricalPrices(stockTickers, startDate, endDate) : Promise.resolve(empty),
      ]);

      // ── 시장 입력 조립 ──
      const marketByTicker = new Map<string, TurtleMarketInput>();
      for (const m of metas) {
        const result = (m.isCrypto ? cryptoRes : stockRes)[m.fetchTicker];
        const series = extractOhlcvSeries(result);
        if (series.sortedDates.length === 0) continue; // fetch 실패 → 이 종목 스킵 (fail-closed)
        marketByTicker.set(m.ticker, assembleMarketInput({
          ticker: m.ticker, name: m.name, price: m.price, currency: m.currency,
          isCrypto: m.isCrypto, series, settings: turtleSettings, rates: exchangeRates,
        }));
      }

      const candidates: TurtleCandidateRef[] = candidateItems.map(w => ({ ticker: w.ticker, name: w.name }));
      const remainingBudgetKRW = Math.max(0, turtleSettings.satelliteBudgetKRW - computeDeployedBudgetKRW(openPositions));

      // 생성기와 진단이 **동일 입력**을 받도록 공유 (진단이 생성 결과와 어긋나지 않음)
      const genInput = {
        positions: turtlePositions,
        candidates,
        marketByTicker,
        settings: turtleSettings,
        existingQueue: actionQueue,
        remainingBudgetKRW,
        today,
      };
      const generated = buildTurtleActions({ ...genInput, makeId: (seq) => `aq-${today}-${Date.now().toString(36)}-${seq}` });
      const actionsDiag = diagnoseTurtleActions(genInput);

      const hasRevival = actionQueue.some(it => isSnoozeExpired(it, today));
      if (generated.length > 0 || hasRevival) {
        updateActionQueue(reconcileActionQueue(actionQueue, generated, today));
      }
      return { generated: generated.length, diagnostics: makeDiag(actionsDiag) };
    } catch (e) {
      log.error('실행 큐 새로고침 실패:', e);
      setRefreshError('실행 큐를 갱신하지 못했습니다.');
      return { generated: 0, diagnostics: makeDiag(emptyActionsDiag) };
    } finally {
      setIsRefreshing(false);
    }
  }, [assets, watchlist, exchangeRates, turtlePositions, turtleSettings, actionQueue, updateActionQueue]);

  // ── 사용자 행동 (보이는 쓰기) ──
  const markDone = useCallback((id: string, linkedSellRecordId?: string) => {
    updateActionQueue(actionQueue.map(it =>
      it.id === id ? { ...it, status: 'done' as const, resolvedDate: todayISO(), linkedSellRecordId: linkedSellRecordId ?? it.linkedSellRecordId } : it
    ));
  }, [actionQueue, updateActionQueue]);

  const markSkipped = useCallback((id: string, reason: string) => {
    const trimmed = reason.trim();
    if (!trimmed) return; // 사유 필수
    updateActionQueue(actionQueue.map(it =>
      it.id === id ? { ...it, status: 'skipped' as const, resolvedDate: todayISO(), skipReason: trimmed } : it
    ));
  }, [actionQueue, updateActionQueue]);

  const snoozeAction = useCallback((id: string, days: number = 1) => {
    const until = new Date(Date.now() + Math.max(1, days) * 86_400_000).toISOString().slice(0, 10);
    updateActionQueue(actionQueue.map(it =>
      it.id === id ? { ...it, status: 'snoozed' as const, snoozedUntil: until, snoozeCount: (it.snoozeCount ?? 0) + 1 } : it
    ));
  }, [actionQueue, updateActionQueue]);

  /**
   * 터틀 주문 실행 (Phase 2b-4b-2d) — TurtleExecuteModal이 실제 체결값(fill)으로 호출.
   * 기존 머니 액션(addAsset/confirmBuyMore/confirmSell) 그대로 호출 → **저장 성공(res.ok) 시에만**
   * resolveTurtleUpdate로 positions/queue 계산 후 **단일 commitPortfolioPatch**(assets/sellHistory는 머니 액션 반환 재사용).
   * 실패/취소({ok:false})면 커밋 없음 → action pending·position 무변경. 가격/N/stop 원통화(D6).
   */
  const executeTurtleAction = useCallback(async (action: ActionItem, fill: TurtleFill): Promise<{ ok: boolean; reason?: string }> => {
    const today = todayISO();
    const settings = turtleSettings;
    try {
      if (action.kind === 'TURTLE_ENTRY') {
        const w = watchlist.find(x => x.ticker === action.ticker);
        if (!w) return { ok: false, reason: 'candidate-missing' };
        const currency = w.currency ?? Currency.USD;
        const form = {
          ticker: w.ticker, exchange: w.exchange, currency, categoryId: w.categoryId,
          quantity: fill.quantity, purchasePrice: fill.fillPrice, purchaseDate: fill.fillDate,
          bucket: 'SATELLITE' as const, name: w.name,
        } as unknown as NewAssetForm;
        const res = await (addAsset as unknown as (d: NewAssetForm) => Promise<AddAssetResult>)(form);
        if (!res.ok) return res;
        const fxRate = action.ruleSnapshot.fxRate ?? turtleFxRate(currency, exchangeRates);
        const upd = resolveTurtleUpdate({ action, fill, settings, turtlePositions, actionQueue, today, assetId: res.asset.id, fxRate, newPositionId: `tp-${Date.now().toString(36)}` });
        if (!upd) return { ok: false, reason: 'resolve-failed' };
        commitPortfolioPatch({ assets: res.nextAssets, turtlePositions: upd.turtlePositions, actionQueue: upd.actionQueue });
        return { ok: true };
      }

      if (action.kind === 'TURTLE_PYRAMID') {
        const pos = turtlePositions.find(p => p.id === action.positionId && p.status === 'open');
        if (!pos || !pos.assetId) return { ok: false, reason: 'position-missing' };
        const res = await confirmBuyMore(pos.assetId, fill.fillDate, fill.fillPrice, fill.quantity);
        if (!res.ok) return res;
        const asset = assets.find(a => a.id === pos.assetId);
        const fxRate = action.ruleSnapshot.fxRate ?? turtleFxRate(asset?.currency, exchangeRates);
        const upd = resolveTurtleUpdate({ action, fill, settings, turtlePositions, actionQueue, today, fxRate });
        if (!upd) return { ok: false, reason: 'resolve-failed' };
        commitPortfolioPatch({ assets: res.nextAssets, turtlePositions: upd.turtlePositions, actionQueue: upd.actionQueue });
        return { ok: true };
      }

      if (action.kind === 'TURTLE_STOP' || action.kind === 'TURTLE_EXIT') {
        const pos = turtlePositions.find(p => p.id === action.positionId && p.status === 'open');
        if (!pos || !pos.assetId) return { ok: false, reason: 'position-missing' };
        const asset = assets.find(a => a.id === pos.assetId);
        const res = await confirmSell(pos.assetId, fill.fillDate, fill.fillPrice, fill.quantity, asset?.currency ?? Currency.KRW);
        if (!res.ok) return res;
        const upd = resolveTurtleUpdate({ action, fill, settings, turtlePositions, actionQueue, today, sellRecordId: res.sellRecordId });
        if (!upd) return { ok: false, reason: 'resolve-failed' };
        commitPortfolioPatch({ assets: res.nextAssets, sellHistory: res.nextSellHistory, turtlePositions: upd.turtlePositions, actionQueue: upd.actionQueue });
        return { ok: true };
      }

      return { ok: false, reason: 'unsupported-kind' };
    } catch (e) {
      log.error('터틀 실행 실패:', e);
      return { ok: false, reason: 'exception' };
    }
  }, [assets, watchlist, exchangeRates, turtlePositions, turtleSettings, actionQueue, addAsset, confirmSell, confirmBuyMore, commitPortfolioPatch]);

  /**
   * 대청소 청산 실행 (Phase 3d) — CLEANUP_SELL 전용. CleanupExecuteModal이 실제 체결값(fill)으로 호출.
   * 포지션 개념 없음(TurtlePosition 무접촉). 공용 `confirmSell` 저장 성공 시에만 큐 done + 단일 commit.
   *   · 수량은 **실행 시점의 asset.quantity(전량)** — action.quantity(생성 시점 스냅샷) 신뢰 안 함(그 사이 변동 가능).
   *   · confirmSell 인자 순서 = (id, sellDate, sellPrice, sellQuantity, currency). 통화=asset.currency.
   *   · 성공 시 linkedSellRecordId = res.sellRecordId. 실패/취소면 커밋 없음(pending 유지).
   */
  const executeCleanupAction = useCallback(async (action: ActionItem, fill: TurtleFill): Promise<{ ok: boolean; reason?: string }> => {
    const today = todayISO();
    if (action.kind !== 'CLEANUP_SELL') return { ok: false, reason: 'unsupported-kind' };
    if (!action.assetId) return { ok: false, reason: 'asset-missing' };
    const asset = assets.find(a => a.id === action.assetId);
    if (!asset || !(asset.quantity > 0)) return { ok: false, reason: 'asset-missing' };
    if (!(fill.fillPrice > 0)) return { ok: false, reason: 'invalid-price' };
    const sellQty = asset.quantity; // 실행 시점 전량(action.quantity 아님)
    try {
      const res = await confirmSell(asset.id, fill.fillDate, fill.fillPrice, sellQty, asset.currency);
      if (!res.ok) return res;
      const queue = completeQueueItem(actionQueue, action.id, { resolvedDate: today, linkedSellRecordId: res.sellRecordId });
      commitPortfolioPatch({ assets: res.nextAssets, sellHistory: res.nextSellHistory, actionQueue: queue });
      return { ok: true };
    } catch (e) {
      log.error('대청소 청산 실행 실패:', e);
      return { ok: false, reason: 'exception' };
    }
  }, [assets, actionQueue, confirmSell, commitPortfolioPatch]);

  return { actionQueue, refreshActionQueue, markDone, markSkipped, snoozeAction, executeTurtleAction, executeCleanupAction, isRefreshing, refreshError };
}
