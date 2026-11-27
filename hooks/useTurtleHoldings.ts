// hooks/useTurtleHoldings.ts
// ---------------------------------------------------------------------------
// "보유종목 터틀" 데이터 훅 (계획서 PLAN_터틀중심_앱재정비_260925 §6 P2 2-1).
//
// 사용자가 선택한 터틀 방침의 최초 본전 활성일만 저장한다. 체결·주문을 만들지 않는다.
//   · 순수 계산은 utils/turtleHoldingsView 에 위임 — 여기는 fetch + 배선만.
//   · 일부 종목 실패가 전체 실패로 번지지 않는다(해당 행만 '확인 불가').
//   · 모듈 캐시(utils/todayTurtleCache 재사용, 별도 네임스페이스) — fresh 캐시 재사용·in-flight 공유·
//     완전 성공만 캐싱(부분 실패는 다음 마운트에서 재시도).
//
// 대상 = ① 범위 내 보유 자산(원래 보유분 legacy-holding / 재매수분 reentry-position 구분)
//        ② 관심종목 중 isTurtleCandidate(다시 살 때 감시). 조회 기간은
//        `turtleHoldingsLookbackCalendarDays`(entryLookback/exitLookback/maPeriod/ATR 워밍업 중 최댓값)로 정한다.

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePortfolio } from '../contexts/PortfolioContext';
import {
  fetchStockHistoricalPrices,
  fetchCryptoHistoricalPrices,
  isCryptoExchange,
  convertTickerForAPI,
  HistoricalPriceResult,
} from '../services/historicalPriceService';
import { Currency } from '../types';
import { instrumentMarket } from '../utils/ownerHoldings';
import { TurtlePosition } from '../types/turtle';
import { EnrichedAsset } from '../types/ui';
import { getAssetOwner, hasUnresolvedOwners } from '../types/owner';
import { isBaseType } from '../types/category';
import { holdingPolicyFxTicker } from '../utils/holdingPolicyFx';
import { holdingPolicyTurtleSettings, isPolicyReentryWatch } from '../utils/holdingPolicy';
import { resolveHoldingsSettings } from '../utils/turtleHoldings';
import {
  buildTurtleHoldingsLegacyRow,
  buildTurtleHoldingsReentryRow,
  buildTurtleHoldingsWatchRow,
  computeManagedEquity,
  resolveEffectiveManagedEquity,
  sortTurtleHoldingsRows,
  summarizeTurtleHoldingsRows,
  turtleHoldingsLookbackCalendarDays,
  resolvePositionFxRate,
  TurtleHoldingsRow,
  TurtleHoldingsCounts,
} from '../utils/turtleHoldingsView';
import {
  marketDaySignature, evaluateCacheEntry, isCacheableResult, pruneCacheEntries, selectDisplayedResult,
  TODAY_TURTLE_CACHE_TTL_MS, TODAY_TURTLE_CACHE_MAX_ENTRIES, KeyedTodayResult,
} from '../utils/todayTurtleCache';
import { todayInstrumentKey, addIsoDays } from '../utils/todayTurtle';
import { createLogger } from '../utils/logger';

const log = createLogger('TurtleHoldings');

function isoDaysAgo(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

interface Target {
  key: string;
  kind: 'legacy' | 'reentry' | 'watch' | 'fx';
  ticker: string;
  fetchTicker: string;
  isCrypto: boolean;
}

type RawMap = Map<string, HistoricalPriceResult>;
interface FetchOutcome { raw: RawMap | null; failedKeys: ReadonlySet<string> }
interface CacheEntry { requestKey: string; raw: RawMap; failedKeys: ReadonlySet<string>; fetchedAtMs: number; signature: string }

// 별도 네임스페이스 모듈 캐시(useTodayTurtle과 대상 집합이 다르므로 키 공간을 공유하지 않는다).
const holdingsCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, { promise: Promise<FetchOutcome>; signature: string }>();

function peekFreshEntry(requestKey: string, now: Date): CacheEntry | null {
  const entry = holdingsCache.get(requestKey);
  const verdict = evaluateCacheEntry(entry, { requestKey, nowMs: now.getTime(), signature: marketDaySignature(now) }, { ttlMs: TODAY_TURTLE_CACHE_TTL_MS });
  return verdict === 'fresh' && entry ? entry : null;
}

async function fetchTurtleHoldingsSeries(targets: Target[], startDate: string, endDate: string): Promise<FetchOutcome> {
  const cryptoTickers = [...new Set(targets.filter(t => t.isCrypto).map(t => t.fetchTicker))];
  const stockTickers = [...new Set(targets.filter(t => !t.isCrypto).map(t => t.fetchTicker))];
  const empty: Record<string, HistoricalPriceResult> = {};
  const [cryptoRes, stockRes] = await Promise.all([
    cryptoTickers.length
      ? fetchCryptoHistoricalPrices(cryptoTickers, startDate, endDate).catch(e => { log.error('코인 시세 조회 실패:', e); return empty; })
      : Promise.resolve(empty),
    stockTickers.length
      ? fetchStockHistoricalPrices(stockTickers, startDate, endDate).catch(e => { log.error('주식 시세 조회 실패:', e); return empty; })
      : Promise.resolve(empty),
  ]);
  const merged: RawMap = new Map();
  const failed = new Set<string>();
  for (const t of targets) {
    const r = (t.isCrypto ? cryptoRes : stockRes)[t.fetchTicker];
    if (r && r.data && Object.keys(r.data).length > 0) merged.set(t.key, r);
    else failed.add(t.key);
  }
  return { raw: merged, failedKeys: failed };
}

function startSharedFetch(requestKey: string, targets: Target[], now: Date, endDate: string, lookbackDays: number): Promise<FetchOutcome> {
  const fetchedAtMs = now.getTime();
  const signature = marketDaySignature(now);
  const promise: Promise<FetchOutcome> = fetchTurtleHoldingsSeries(targets, isoDaysAgo(lookbackDays, now), endDate)
    .catch((e: unknown): FetchOutcome => {
      log.error('보유종목 터틀 조회 처리 실패:', e);
      return { raw: new Map(), failedKeys: new Set(targets.map(t => t.key)) };
    })
    .then(outcome => {
      if (outcome.raw && isCacheableResult({ failed: outcome.failedKeys.size, total: targets.length })) {
        holdingsCache.delete(requestKey);
        holdingsCache.set(requestKey, { requestKey, raw: outcome.raw, failedKeys: outcome.failedKeys, fetchedAtMs, signature });
        for (const k of pruneCacheEntries(holdingsCache, TODAY_TURTLE_CACHE_MAX_ENTRIES)) holdingsCache.delete(k);
      }
      return outcome;
    })
    .finally(() => {
      if (inFlight.get(requestKey)?.promise === promise) inFlight.delete(requestKey);
    });
  inFlight.set(requestKey, { promise, signature });
  return promise;
}

function acquireOutcome(requestKey: string, targets: Target[], endDate: string, lookbackDays: number): Promise<FetchOutcome> {
  if (targets.length === 0) return Promise.resolve({ raw: null, failedKeys: new Set<string>() });
  const now = new Date();
  const signature = marketDaySignature(now);
  const entry = holdingsCache.get(requestKey);
  const verdict = evaluateCacheEntry(entry, { requestKey, nowMs: now.getTime(), signature }, { ttlMs: TODAY_TURTLE_CACHE_TTL_MS });
  if (verdict === 'fresh' && entry) return Promise.resolve(entry);
  if (verdict === 'expired') holdingsCache.delete(requestKey);
  const pending = inFlight.get(requestKey);
  if (pending && pending.signature === signature) return pending.promise;
  return startSharedFetch(requestKey, targets, now, endDate, lookbackDays);
}

export interface TurtleHoldingsModel {
  rows: TurtleHoldingsRow[];
  /** assetId 키 맵(legacy-holding·reentry-position만 — watch행은 자산이 없어 제외). 표 컬럼 등에서 조회용. */
  rowsByAssetId: Map<string, TurtleHoldingsRow>;
  summary: TurtleHoldingsCounts;
  managedEquityKRW: number;
  parkedCashKRW: number;
  effectiveManagedEquityKRW: number;
  drawdownApplied: boolean;
  isLoading: boolean;
  partialFailure: boolean;
}

const EMPTY_MODEL_SUMMARY: TurtleHoldingsCounts = { sellCount: 0, reentryCount: 0, pyramidCount: 0, stopCheckCount: 0 };

export function useTurtleHoldings(): TurtleHoldingsModel {
  const { data, derived, actions } = usePortfolio();
  const { watchlist, turtlePositions, turtleSettings, exchangeRates } = data;
  const settings = useMemo(() => resolveHoldingsSettings(turtleSettings.holdings), [turtleSettings.holdings]);

  const [loaded, setLoaded] = useState<KeyedTodayResult<RawMap> | null>(null);
  const loadedKeyRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);

  // enriched 지표(currentValueKRW 등)는 이미 Context에서 계산돼 있다 — 재계산 금지, derived 재사용.
  const enrichedAssets = derived.enrichedAssets;
  const enrichedById = useMemo(() => {
    const m = new Map<string, EnrichedAsset>();
    for (const a of enrichedAssets) m.set(a.id, a);
    return m;
  }, [enrichedAssets]);

  // 오픈 재매수 포지션(assetId 키) — 이 자산은 legacy-holding이 아니라 reentry-position으로 취급.
  const openReentryByAssetId = useMemo(() => {
    const m = new Map<string, TurtlePosition>();
    for (const p of turtlePositions) {
      if (p.status === 'open' && p.origin === 'holdings-reentry' && p.assetId) m.set(p.assetId, p);
    }
    return m;
  }, [turtlePositions]);

  // 범위 내 보유 자산(원래 보유분·재매수분)의 정규화 티커 키 — 관심종목 감시 행 중복 제외용
  // (useTodayTurtle의 heldKeys와 동일 관례: ticker + normalizeExchange 거래소).
  // 방금 [샀음 기록]해 생긴 reentry-position도 assetId·quantity>0인 enrichedAssets에 이미 반영되므로
  // 별도로 turtlePositions를 다시 훑을 필요 없다.
  const heldTickerKeys = useMemo(() => {
    const s = new Set<string>();
    for (const a of enrichedAssets) {
      if (a.quantity <= 0) continue;
      if (isBaseType(a.categoryId, 'CASH')) continue;
      const key = todayInstrumentKey(a.ticker, a.exchange, instrumentMarket);
      if (hasUnresolvedOwners(a)) s.add(key);
      else s.add(getAssetOwner(a) + '|' + key);
    }
    return s;
  }, [enrichedAssets]);

  const watchCandidates = useMemo(() => watchlist.filter(w => w.isTurtleCandidate && (!w.holdingPolicy || isPolicyReentryWatch(w))), [watchlist]);

  const targets = useMemo<Target[]>(() => {
    const out: Target[] = [];
    const seen = new Set<string>();
    for (const a of enrichedAssets) {
      if (a.quantity <= 0) continue;
      const key = `asset|${a.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key, kind: openReentryByAssetId.has(a.id) ? 'reentry' : 'legacy',
        ticker: a.ticker, isCrypto: isCryptoExchange(a.exchange),
        fetchTicker: convertTickerForAPI(a.ticker, a.exchange),
      });
      const fxTicker = a.holdingPolicy && a.holdingPolicy.mode !== 'hold' && !isCryptoExchange(a.exchange) ? holdingPolicyFxTicker(a.currency) : null;
      if (fxTicker && !seen.has('fx|' + fxTicker)) {
        seen.add('fx|' + fxTicker);
        out.push({ key: 'fx|' + fxTicker, kind: 'fx', ticker: fxTicker, fetchTicker: fxTicker, isCrypto: false });
      }
    }
    for (const w of watchCandidates) {
      const key = `watch|${w.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key, kind: 'watch', ticker: w.ticker, isCrypto: isCryptoExchange(w.exchange),
        fetchTicker: convertTickerForAPI(w.ticker, w.exchange),
      });
    }
    return out;
  }, [enrichedAssets, openReentryByAssetId, watchCandidates]);

  const [refreshSlot, setRefreshSlot] = useState(() => Math.floor(Date.now() / TODAY_TURTLE_CACHE_TTL_MS));
  useEffect(() => {
    const refresh = () => setRefreshSlot(Math.floor(Date.now() / TODAY_TURTLE_CACHE_TTL_MS));
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  const now = new Date();
  const asOfDate = now.toISOString().slice(0, 10);
  const signature = marketDaySignature(now);
  const lookbackDays = useMemo(() => {
    let days = Math.max(turtleHoldingsLookbackCalendarDays(settings), turtleHoldingsLookbackCalendarDays(holdingPolicyTurtleSettings(settings)));
    for (const { holdingPolicy } of enrichedAssets) {
      if (holdingPolicy?.mode !== 'turtle-after-cost' || holdingPolicy.armedOn || !holdingPolicy.startedOn) continue;
      const age = (Date.parse(asOfDate) - Date.parse(holdingPolicy.startedOn)) / 86_400_000;
      if (Number.isFinite(age)) days = Math.max(days, age + 2);
    }
    return days;
  }, [asOfDate, enrichedAssets, settings]);
  const requestKey = useMemo(() => {
    const parts = targets.map(t => `${t.kind}:${t.key}:${t.fetchTicker}`).sort();
    return `${asOfDate}|${signature}|${refreshSlot}|${lookbackDays}|${parts.join(',')}`;
  }, [targets, asOfDate, signature, refreshSlot, lookbackDays]);

  const hasTargets = targets.length > 0;
  const peek = useMemo(
    () => (hasTargets ? peekFreshEntry(requestKey, new Date()) : null),
    [requestKey, hasTargets],
  );

  useEffect(() => {
    if (loadedKeyRef.current === requestKey) return;
    loadedKeyRef.current = requestKey;
    const reqId = ++requestIdRef.current;
    // 조회 종료일 = asOfDate(UTC 오늘) + 1일. 백엔드 /history 의 end_date 는 미국 종목에서 **배타적**(실측: end=10-23 → 마지막 봉 10-22)이고
    // UTC 날짜는 KST 오전에 아직 전날이라, asOfDate 그대로 보내면 막 확정된 미국 당일 봉이 도착하지 않는다.
    // 아직 확정 전인 봉은 추출 단계(extractCompletedBars)가 걸러내므로 넉넉히 +1일을 요청해도 안전하다.
    void acquireOutcome(requestKey, targets, addIsoDays(asOfDate, 1), lookbackDays).then(outcome => {
      if (reqId !== requestIdRef.current) return; // 오래된 응답 폐기(useTodayTurtle의 isStaleResponse와 동일 규약)
      setLoaded({ requestKey, raw: outcome.raw, failedKeys: outcome.failedKeys });
    });
  }, [requestKey, targets, asOfDate, lookbackDays]);

  const display = selectDisplayedResult<RawMap>({ requestKey, hasTargets, loaded, peek });
  const rawByKey = display.raw;
  const failedKeys = display.failedKeys;
  const isLoading = display.isLoading;

  const model = useMemo<TurtleHoldingsModel>(() => {
    const now = new Date();
    const { holdingsValueKRW, parkedCashKRW, managedEquityKRW } = computeManagedEquity(enrichedAssets, settings);
    const { equityKRW: effectiveManagedEquityKRW, drawdownApplied } = resolveEffectiveManagedEquity(
      managedEquityKRW, settings, settings.drawdownReferenceKRW,
    );
    void holdingsValueKRW;

    const rows: TurtleHoldingsRow[] = [];
    for (const t of targets) {
      if (t.kind === 'fx') continue;
      const raw = rawByKey?.get(t.key);
      const fetchFailed = rawByKey != null && failedKeys.has(t.key);
      if (t.kind === 'watch') {
        const w = watchCandidates.find(x => `watch|${x.id}` === t.key);
        if (!w) continue;
        const fxRate = w.holdingPolicy && t.isCrypto ? 1 : resolvePositionFxRate(w.currency ?? Currency.KRW, exchangeRates);
        rows.push(buildTurtleHoldingsWatchRow({
          watchItem: w, raw, isCrypto: t.isCrypto, fetchFailed, now, settings, fxRate,
          effectiveManagedEquityKRW, heldTickerKeys,
        }));
      } else {
        const assetId = t.key.split('|')[1];
        const asset = enrichedById.get(assetId);
        if (!asset) continue;
        const fxRate = asset.holdingPolicy && t.isCrypto ? 1 : resolvePositionFxRate(asset.currency, exchangeRates);
        const policyFx = rawByKey?.get('fx|' + holdingPolicyFxTicker(asset.currency));
        if (t.kind === 'reentry') {
          const position = openReentryByAssetId.get(assetId);
          if (!position) continue;
          rows.push(buildTurtleHoldingsReentryRow({
            position, asset, raw, isCrypto: t.isCrypto, fetchFailed, now, settings, fxRate, policyFx,
            effectiveManagedEquityKRW,
          }));
        } else {
          rows.push(buildTurtleHoldingsLegacyRow({ asset, raw, policyFx, isCrypto: t.isCrypto, fetchFailed, now, settings }));
        }
      }
    }

    const sorted = sortTurtleHoldingsRows(rows);
    const rowsByAssetId = new Map<string, TurtleHoldingsRow>();
    for (const r of sorted) if (r.assetId) rowsByAssetId.set(r.assetId, r);

    return {
      rows: sorted,
      rowsByAssetId,
      summary: rows.length > 0 ? summarizeTurtleHoldingsRows(sorted) : EMPTY_MODEL_SUMMARY,
      managedEquityKRW,
      parkedCashKRW,
      effectiveManagedEquityKRW,
      drawdownApplied,
      isLoading,
      partialFailure: failedKeys.size > 0,
    };
  }, [targets, rawByKey, failedKeys, isLoading, enrichedAssets, enrichedById, openReentryByAssetId, watchCandidates, exchangeRates, settings, heldTickerKeys]);
  useEffect(() => {
    const activations = model.rows.flatMap(row => {
      const policy = row.assetId ? enrichedById.get(row.assetId)?.holdingPolicy : undefined;
      const armedOn = row.holdingPolicyEvaluation?.armedOn;
      return row.assetId && policy?.cycleId && armedOn && (!policy.armedOn || armedOn < policy.armedOn)
        ? [{ assetId: row.assetId, cycleId: policy.cycleId, armedOn }] : [];
    });
    if (activations.length) actions.armHoldingPolicies(activations);
  }, [actions, enrichedById, model.rows]);
  return model;
}
