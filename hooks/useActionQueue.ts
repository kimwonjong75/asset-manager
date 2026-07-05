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
} from '../utils/turtleMarketData';
import { Currency } from '../types';
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
  const { updateActionQueue } = actions;

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  /**
   * 터틀 규칙을 평가해 실행 큐를 갱신한다 (명시적 호출 전용 — 자동 실행 아님).
   * 오픈 포지션의 손절/청산/피라미딩 + 터틀 후보의 진입을 생성하고, 만료 스누즈를 되살려 저장한다.
   */
  const refreshActionQueue = useCallback(async (): Promise<{ generated: number }> => {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const today = todayISO();
      const { startDate, endDate } = turtleHistoryWindow(turtleSettings, today);

      const openPositions = turtlePositions.filter(p => p.status === 'open');
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
        return { generated: 0 };
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

      const generated = buildTurtleActions({
        positions: turtlePositions,
        candidates,
        marketByTicker,
        settings: turtleSettings,
        existingQueue: actionQueue,
        remainingBudgetKRW,
        today,
        makeId: (seq) => `aq-${today}-${Date.now().toString(36)}-${seq}`,
      });

      const hasRevival = actionQueue.some(it => isSnoozeExpired(it, today));
      if (generated.length > 0 || hasRevival) {
        updateActionQueue(reconcileActionQueue(actionQueue, generated, today));
      }
      return { generated: generated.length };
    } catch (e) {
      log.error('실행 큐 새로고침 실패:', e);
      setRefreshError('실행 큐를 갱신하지 못했습니다.');
      return { generated: 0 };
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

  return { actionQueue, refreshActionQueue, markDone, markSkipped, snoozeAction, isRefreshing, refreshError };
}
