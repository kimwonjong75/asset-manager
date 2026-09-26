// hooks/useTurtleHoldings.ts
// ---------------------------------------------------------------------------
// "보유종목 터틀" 데이터 훅 (계획서 PLAN_터틀중심_앱재정비_260925 §6 P2 2-1).
//
// 읽기 전용 보장 — hooks/useTodayTurtle.ts 와 동일한 계약:
//   · 저장 함수를 주입받지 않는다(자동 저장 금지 — "보이지 않는 쓰기 금지").
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
import { Currency, normalizeExchange } from '../types';
import { TurtlePosition } from '../types/turtle';
import { EnrichedAsset } from '../types/ui';
import { resolveHoldingsSettings, isInHoldingsScope } from '../utils/turtleHoldings';
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
import { todayInstrumentKey } from '../utils/todayTurtle';
import { createLogger } from '../utils/logger';

const log = createLogger('TurtleHoldings');

function isoDaysAgo(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

interface Target {
  key: string;
  kind: 'legacy' | 'reentry' | 'watch';
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
  const cryptoTickers = targets.filter(t => t.isCrypto).map(t => t.fetchTicker);
  const stockTickers = targets.filter(t => !t.isCrypto).map(t => t.fetchTicker);
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
  const { data, derived } = usePortfolio();
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
      if (!isInHoldingsScope(a, settings)) continue;
      s.add(todayInstrumentKey(a.ticker, a.exchange, normalizeExchange));
    }
    return s;
  }, [enrichedAssets, settings]);

  const watchCandidates = useMemo(() => watchlist.filter(w => w.isTurtleCandidate), [watchlist]);

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

  const asOfDate = new Date().toISOString().slice(0, 10);
  const lookbackDays = turtleHoldingsLookbackCalendarDays(settings);
  const requestKey = useMemo(() => {
    const parts = targets.map(t => `${t.kind}:${t.key}:${t.fetchTicker}`).sort();
    return `${asOfDate}|${lookbackDays}|${parts.join(',')}`;
  }, [targets, asOfDate, lookbackDays]);

  const hasTargets = targets.length > 0;
  const peek = useMemo(
    () => (hasTargets ? peekFreshEntry(requestKey, new Date()) : null),
    [requestKey, hasTargets],
  );

  useEffect(() => {
    if (loadedKeyRef.current === requestKey) return;
    loadedKeyRef.current = requestKey;
    const reqId = ++requestIdRef.current;
    void acquireOutcome(requestKey, targets, asOfDate, lookbackDays).then(outcome => {
      if (reqId !== requestIdRef.current) return; // 오래된 응답 폐기(useTodayTurtle의 isStaleResponse와 동일 규약)
      setLoaded({ requestKey, raw: outcome.raw, failedKeys: outcome.failedKeys });
    });
  }, [requestKey, targets, asOfDate, lookbackDays]);

  const display = selectDisplayedResult<RawMap>({ requestKey, hasTargets, loaded, peek });
  const rawByKey = display.raw;
  const failedKeys = display.failedKeys;
  const isLoading = display.isLoading;

  return useMemo<TurtleHoldingsModel>(() => {
    const now = new Date();
    const { holdingsValueKRW, parkedCashKRW, managedEquityKRW } = computeManagedEquity(enrichedAssets, settings);
    const { equityKRW: effectiveManagedEquityKRW, drawdownApplied } = resolveEffectiveManagedEquity(
      managedEquityKRW, settings, settings.drawdownReferenceKRW,
    );
    void holdingsValueKRW;

    const rows: TurtleHoldingsRow[] = [];
    for (const t of targets) {
      const raw = rawByKey?.get(t.key);
      const fetchFailed = rawByKey != null && failedKeys.has(t.key);
      if (t.kind === 'watch') {
        const w = watchCandidates.find(x => `watch|${x.id}` === t.key);
        if (!w) continue;
        const fxRate = resolvePositionFxRate(w.currency ?? Currency.KRW, exchangeRates);
        rows.push(buildTurtleHoldingsWatchRow({
          watchItem: w, raw, isCrypto: t.isCrypto, fetchFailed, now, settings, fxRate,
          effectiveManagedEquityKRW, heldTickerKeys,
        }));
      } else {
        const assetId = t.key.split('|')[1];
        const asset = enrichedById.get(assetId);
        if (!asset) continue;
        const fxRate = resolvePositionFxRate(asset.currency, exchangeRates);
        if (t.kind === 'reentry') {
          const position = openReentryByAssetId.get(assetId);
          if (!position) continue;
          rows.push(buildTurtleHoldingsReentryRow({
            position, asset, raw, isCrypto: t.isCrypto, fetchFailed, now, settings, fxRate,
            effectiveManagedEquityKRW,
          }));
        } else {
          rows.push(buildTurtleHoldingsLegacyRow({ asset, raw, isCrypto: t.isCrypto, fetchFailed, now, settings }));
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
}
