// hooks/useTodayTurtle.ts
// ---------------------------------------------------------------------------
// "오늘의 터틀 확인" 데이터 훅 — 기존 역사시세 서비스로 OHLC 를 읽고 부분 성공·로딩·오류를 관리.
//
// 읽기 전용 보장:
//   · 저장 함수(updateActionQueue / TurtlePosition 저장 / Drive 저장)를 **주입받지 않는다**.
//   · `buildTurtleActions`/`diagnoseTurtleActions`/`evaluatePyramid`/`computeDeployedBudgetKRW` 미사용.
//   · 순수 계산은 utils/todayTurtle 에 위임 — 여기는 fetch + 배선만.
//   · 일부 종목 실패가 전체 카드 실패로 번지지 않는다(해당 행만 'fetch-failed').
//
// 재조회 수명주기 (C-3): 세션 1회가 아니라 **requestKey 기반**.
//   계정 필터·관심종목 추가/삭제·보유 변경·포지션 연결 변경·날짜 변경 시 재조회하고,
//   장중 가격 변동만으로는 재조회하지 않는다. 오래된 응답이 새 응답을 덮어쓰지 않도록 request id 로 가드.
//
// 모듈 캐시 (Stage D2 F1): 홈은 탭 전환마다 재마운트되므로 loadedKeyRef(마운트 단위)만으로는 재진입마다
//   POST /history 를 다시 불렀다. 이제 모듈 Map 에 requestKey 별 결과를 30분 보관하고, 판정은 순수 함수
//   utils/todayTurtleCache 에 위임한다.
//   · fresh(키 일치 + 시장 현지 날짜 서명 일치 + TTL 이내) → 조회 없이 재사용. 렌더 중 엿보기로 첫 화면부터 표시.
//   · 같은 키 조회가 진행 중이면(in-flight) 같은 Promise 를 기다린다 — 동시 마운트가 요청을 공유.
//   · **완전 성공만 저장**(isCacheableResult) — 부분 실패·빈 결과는 저장하지 않아 다음 마운트에서 재시도된다.
//   · 가격 새로고침 버튼은 이 캐시를 비우지 않는다(장중 가격은 원래 재조회 사유가 아님 — 날짜·서명·requestKey 가 담당).
//   · 마운트된 채로 TTL 이 지나도 자동 재조회하지 않는다(기존과 동일 — 같은 requestKey 는 마운트 중 1회).
//   · 저장·쓰기·큐 생성 없음(읽기 전용 보장 불변). 캐시는 메모리 전용 — 새로고침하면 비워진다.

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePortfolio } from '../contexts/PortfolioContext';
import {
  fetchStockHistoricalPrices,
  fetchCryptoHistoricalPrices,
  isCryptoExchange,
  convertTickerForAPI,
  HistoricalPriceResult,
} from '../services/historicalPriceService';
import {
  buildWatchRow, buildPositionRow, buildLegacyRow, sortRows, summarizeRows,
  todayInstrumentKey, buildTodayRequestKey, isStaleResponse, RawSeries,
} from '../utils/todayTurtle';
import {
  marketDaySignature, evaluateCacheEntry, isCacheableResult, pruneCacheEntries, selectDisplayedResult,
  TODAY_TURTLE_CACHE_TTL_MS, TODAY_TURTLE_CACHE_MAX_ENTRIES, KeyedTodayResult,
} from '../utils/todayTurtleCache';
import { TodayRow, TodayTurtleModel } from '../types/todayTurtle';
import { getAssetBucket } from '../types/bucket';
import { matchesOwnerFilter } from '../types/owner';
import { normalizeExchange, Asset } from '../types';
import { createLogger } from '../utils/logger';

const log = createLogger('TodayTurtle');

/** 55일 채널(56봉) + 여유를 덮는 조회 창. 휴장 보정 포함. */
const LOOKBACK_CALENDAR_DAYS = 130;

function isoDaysAgo(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

interface Target {
  key: string;
  kind: 'watch' | 'position' | 'legacy';
  ticker: string;
  name: string;
  exchange: string;
  isCrypto: boolean;
  fetchTicker: string;
  intradayPrice: number | null;
  stopPrice?: number | null;
  linkError?: boolean;
}

// ── 모듈 캐시 (탭 재진입 재조회 방지) ─────────────────────────────────────────

type RawMap = Map<string, HistoricalPriceResult>;

/** 한 번의 조회(또는 대상 0 / 캐시 재사용) 결과 */
interface FetchOutcome {
  raw: RawMap | null;
  failedKeys: ReadonlySet<string>;
}

interface CacheEntry {
  requestKey: string;
  raw: RawMap;
  failedKeys: ReadonlySet<string>;
  /** 조회 **시작** 시각 — 보수적(TTL·서명 모두 요청 시점 기준) */
  fetchedAtMs: number;
  /** 조회 시작 시점의 marketDaySignature */
  signature: string;
}

const todayCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, { promise: Promise<FetchOutcome>; signature: string }>();

/** 렌더 중 엿보기 — 읽기만 한다(삭제·저장 없음). fresh 가 아니면 null. */
function peekFreshEntry(requestKey: string, now: Date): CacheEntry | null {
  const entry = todayCache.get(requestKey);
  const verdict = evaluateCacheEntry(
    entry,
    { requestKey, nowMs: now.getTime(), signature: marketDaySignature(now) },
    { ttlMs: TODAY_TURTLE_CACHE_TTL_MS }
  );
  return verdict === 'fresh' && entry ? entry : null;
}

/** 배치 조회 — 한쪽이 실패해도 다른 쪽은 살린다(부분 성공). 실패 종목은 failedKeys 로. */
async function fetchTodaySeries(targets: Target[], startDate: string, endDate: string): Promise<FetchOutcome> {
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
    else failed.add(t.key);   // 조회 실패 → no-high-low 가 아니라 fetch-failed 로 표시
  }
  return { raw: merged, failedKeys: failed };
}

/** 새 조회를 시작하고 in-flight 로 공유한다. 완전 성공일 때만 캐시에 저장. */
function startSharedFetch(requestKey: string, targets: Target[], now: Date, asOfDate: string): Promise<FetchOutcome> {
  const fetchedAtMs = now.getTime();
  const signature = marketDaySignature(now);
  const promise: Promise<FetchOutcome> = fetchTodaySeries(targets, isoDaysAgo(LOOKBACK_CALENDAR_DAYS, now), asOfDate)
    .catch((e: unknown): FetchOutcome => {
      // 예기치 못한 처리 오류 → 전 종목 fetch-failed 로 폴백(로딩에 갇히지 않게). 저장하지 않는다.
      log.error('오늘의 터틀 조회 처리 실패:', e);
      return { raw: new Map(), failedKeys: new Set(targets.map(t => t.key)) };
    })
    .then(outcome => {
      if (outcome.raw && isCacheableResult({ failed: outcome.failedKeys.size, total: targets.length })) {
        todayCache.delete(requestKey);   // delete→set 으로 삽입 순서 갱신(오래된 것부터 정리)
        todayCache.set(requestKey, { requestKey, raw: outcome.raw, failedKeys: outcome.failedKeys, fetchedAtMs, signature });
        for (const k of pruneCacheEntries(todayCache, TODAY_TURTLE_CACHE_MAX_ENTRIES)) todayCache.delete(k);
      }
      return outcome;
    })
    .finally(() => {
      if (inFlight.get(requestKey)?.promise === promise) inFlight.delete(requestKey);
    });
  inFlight.set(requestKey, { promise, signature });
  return promise;
}

/** requestKey 의 결과를 얻는다: 대상 0 → 빈 결과 / fresh 캐시 → 재사용 / 같은 서명 in-flight → 공유 / 그 외 → 새 조회 */
function acquireOutcome(requestKey: string, targets: Target[], asOfDate: string): Promise<FetchOutcome> {
  if (targets.length === 0) return Promise.resolve({ raw: null, failedKeys: new Set<string>() });
  const now = new Date();
  const signature = marketDaySignature(now);
  const entry = todayCache.get(requestKey);
  const verdict = evaluateCacheEntry(entry, { requestKey, nowMs: now.getTime(), signature }, { ttlMs: TODAY_TURTLE_CACHE_TTL_MS });
  if (verdict === 'fresh' && entry) return Promise.resolve(entry);
  if (verdict === 'expired') todayCache.delete(requestKey);
  const pending = inFlight.get(requestKey);
  if (pending && pending.signature === signature) return pending.promise;
  return startSharedFetch(requestKey, targets, now, asOfDate);
}

export interface PositionLinkResult {
  asset: Asset | null;
  /** 연결 모호(후보 0개 또는 2개 이상) → '포지션 연결 확인 필요' 표시 */
  linkError: boolean;
  /** 연결은 확정됐지만 **현재 계정 필터 밖** → 이 화면에서 제외(오류 아님) */
  outOfView: boolean;
}

/**
 * 포지션 → 자산 연결 (C-4, AMENDMENT-2).
 *
 * **ID 조회는 반드시 전체 `assets` 에서 한다.** viewAssets 만 뒤지면 assetId 가 다른 계정 자산을
 * 가리킬 때 조회에 실패해 ticker fallback 으로 흘러가고, **현재 계정의 동일 ticker 자산에 잘못 붙어
 * 다른 계정의 stopPrice 가 현재 계정 자산에 표시**된다. 그 경로를 구조적으로 없앤다.
 *
 *   1) assetId 있음 → **전체 assets** 에서 ID 조회
 *        · 찾음 + 현재 필터 안  → 연결
 *        · 찾음 + 현재 필터 밖  → **outOfView (화면에서 제외)**. ticker fallback 으로 내려가지 않는다.
 *        · 못 찾음(깨진 ID)     → 2)로
 *   2) assetId 없음/깨짐 → **전체 assets** 에서 정규화 ticker 후보 검색
 *        · 유일 → 연결 확정 후 계정 필터 적용(밖이면 outOfView)
 *        · 0개·2개 이상 → 임의 선택 금지 → linkError
 */
export function resolvePositionAsset(
  position: { assetId?: string; ticker: string },
  allAssets: Asset[],
  isInView: (a: Asset) => boolean
): PositionLinkResult {
  if (position.assetId) {
    const byId = allAssets.find(a => a.id === position.assetId);
    if (byId) {
      // ID 로 확정된 자산이 현재 계정 밖이면 **여기서 끝낸다** — 같은 ticker 다른 계정으로 대체 금지
      return isInView(byId)
        ? { asset: byId, linkError: false, outOfView: false }
        : { asset: null, linkError: false, outOfView: true };
    }
  }
  const t = position.ticker.trim().toUpperCase();
  const candidates = allAssets.filter(a => a.ticker.trim().toUpperCase() === t);
  if (candidates.length !== 1) return { asset: null, linkError: true, outOfView: false }; // 0개 또는 2개+ → 모호
  const only = candidates[0];
  return isInView(only)
    ? { asset: only, linkError: false, outOfView: false }
    : { asset: null, linkError: false, outOfView: true };
}

export function useTodayTurtle(): TodayTurtleModel {
  const { data, ui } = usePortfolio();
  const { assets, watchlist, turtlePositions } = data;

  /** 커밋된 결과 — 어떤 requestKey 의 결과인지 함께 보관. 로딩·캐시 표시는 렌더에서 파생한다. */
  const [loaded, setLoaded] = useState<KeyedTodayResult<RawMap> | null>(null);
  const loadedKeyRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);

  // 대시보드 계정 필터를 그대로 따른다 (표시 계층 일관성)
  /** 현재 계정 필터 술어 — 자산 목록 필터와 포지션 연결 판정이 **같은 기준**을 쓰도록 단일화 */
  const inView = useMemo(
    () => (a: Asset) => matchesOwnerFilter(a, ui.accountView),
    [ui.accountView]
  );
  const viewAssets = useMemo(
    () => assets.filter(inView),
    [assets, inView]
  );

  const targets = useMemo<Target[]>(() => {
    const out: Target[] = [];
    const seen = new Set<string>();

    // ── 1) 정식 터틀 포지션 (open) — SATELLITE 와 겹치면 이쪽 우선 ──
    const positionAssetIds = new Set<string>();
    for (const p of turtlePositions) {
      if (p.status !== 'open') continue;
      // ID 조회는 **전체 assets**, 계정 판정은 주입된 술어로 — 다른 계정 자산으로의 fallback 차단
      const { asset, linkError, outOfView } = resolvePositionAsset(p, assets, inView);
      if (outOfView) continue; // 다른 계정 소유 → 이 화면에서 제외(오류 아님)
      if (linkError) {
        // 연결 실패해도 **행을 숨기지 않는다** — 손절 경고 누락 방지(C-4)
        const key = `position-link|${p.ticker.trim().toUpperCase()}|${p.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          key, kind: 'position', ticker: p.ticker, name: p.name,
          exchange: '', isCrypto: false, fetchTicker: '',
          intradayPrice: null, stopPrice: p.stopPrice, linkError: true,
        });
        continue;
      }
      const a = asset!;
      const key = todayInstrumentKey(a.ticker, a.exchange, normalizeExchange);
      if (seen.has(key)) continue;
      seen.add(key);
      positionAssetIds.add(a.id);
      out.push({
        key, kind: 'position', ticker: a.ticker, name: a.customName || a.name,
        exchange: a.exchange, isCrypto: isCryptoExchange(a.exchange),
        fetchTicker: convertTickerForAPI(a.ticker, a.exchange),
        intradayPrice: a.priceOriginal > 0 ? a.priceOriginal : null,
        stopPrice: p.stopPrice,
      });
    }

    // ── 2) 기존 투더문 보유분 (bucket === 'SATELLITE', 포지션 없음) ──
    for (const a of viewAssets) {
      if (getAssetBucket(a) !== 'SATELLITE') continue;
      if (positionAssetIds.has(a.id)) continue;
      const key = todayInstrumentKey(a.ticker, a.exchange, normalizeExchange);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key, kind: 'legacy', ticker: a.ticker, name: a.customName || a.name,
        exchange: a.exchange, isCrypto: isCryptoExchange(a.exchange),
        fetchTicker: convertTickerForAPI(a.ticker, a.exchange),
        intradayPrice: a.priceOriginal > 0 ? a.priceOriginal : null,
      });
    }

    // ── 3) 관심종목 전체 (isTurtleCandidate 무관). 단, **이미 보유한 종목은 제외** ──
    const heldKeys = new Set(viewAssets.map(a => todayInstrumentKey(a.ticker, a.exchange, normalizeExchange)));
    for (const w of watchlist) {
      const key = todayInstrumentKey(w.ticker, w.exchange, normalizeExchange);
      if (heldKeys.has(key) || seen.has(key)) continue; // 보유 중 → 신규진입 후보 아님
      seen.add(key);
      out.push({
        key, kind: 'watch', ticker: w.ticker, name: w.name,
        exchange: w.exchange, isCrypto: isCryptoExchange(w.exchange),
        fetchTicker: convertTickerForAPI(w.ticker, w.exchange),
        intradayPrice: (w.priceOriginal ?? 0) > 0 ? (w.priceOriginal as number) : null,
      });
    }
    return out;
  }, [assets, inView, viewAssets, watchlist, turtlePositions]);

  // 조회 기준일 — 날짜가 바뀌면 requestKey 가 바뀌어 재평가된다
  const asOfDate = new Date().toISOString().slice(0, 10);
  const fetchTargets = useMemo(() => targets.filter(t => !t.linkError), [targets]);
  const requestKey = useMemo(
    () => buildTodayRequestKey(fetchTargets.map(t => ({ key: t.key, kind: t.kind, fetchTicker: t.fetchTicker })), asOfDate),
    [fetchTargets, asOfDate]
  );

  const hasTargets = fetchTargets.length > 0;
  // 렌더 중 캐시 엿보기(읽기 전용) — 탭 재진입 첫 화면부터 캐시 결과를 보여 로딩 깜빡임을 없앤다.
  // requestKey 단위로 고정: 마운트 중 TTL 이 지나도 표시가 비지 않는다(그 사이 effect 가 같은 결과를 커밋).
  const peek = useMemo(
    () => (hasTargets ? peekFreshEntry(requestKey, new Date()) : null),
    [requestKey, hasTargets]
  );

  useEffect(() => {
    if (loadedKeyRef.current === requestKey) return; // 동일 requestKey → 재조회 없음
    loadedKeyRef.current = requestKey;
    const reqId = ++requestIdRef.current;
    // 대상 0 / fresh 캐시 / in-flight 공유 / 새 조회 — 모두 같은 비동기 커밋 경로로 모인다.
    // (effect 본문에서 동기 setState 하지 않음: 로딩·대상0·캐시 표시는 selectDisplayedResult 로 렌더에서 파생)
    void acquireOutcome(requestKey, fetchTargets, asOfDate).then(outcome => {
      // 오래된 응답이 새 요청 결과를 덮어쓰지 않게 가드 (순수 판정은 utils 로 분리 — 테스트 가능)
      if (isStaleResponse(reqId, requestIdRef.current)) return;
      // 대상 0 이면 raw=null 커밋 → 이전 raw map 을 남기지 않는다
      setLoaded({ requestKey, raw: outcome.raw, failedKeys: outcome.failedKeys });
    });
  }, [requestKey, fetchTargets, asOfDate]);

  const display = selectDisplayedResult<RawMap>({ requestKey, hasTargets, loaded, peek });
  const rawByTicker = display.raw;
  const failedKeys = display.failedKeys;
  const isLoading = display.isLoading;

  return useMemo<TodayTurtleModel>(() => {
    const now = new Date();
    const rows: TodayRow[] = [];
    for (const t of targets) {
      const raw = rawByTicker?.get(t.key) as RawSeries | undefined;
      const fetchFailed = !t.linkError && rawByTicker != null && failedKeys.has(t.key);
      if (t.kind === 'position') {
        rows.push(buildPositionRow({
          ticker: t.ticker, name: t.name, raw, exchange: t.exchange, isCrypto: t.isCrypto,
          stopPrice: t.stopPrice, now, fetchFailed, linkError: t.linkError,
        }));
      } else if (t.kind === 'legacy') {
        rows.push(buildLegacyRow({ ticker: t.ticker, name: t.name, raw, exchange: t.exchange, isCrypto: t.isCrypto, now, fetchFailed }));
      } else {
        rows.push(buildWatchRow({
          ticker: t.ticker, name: t.name, raw, exchange: t.exchange, isCrypto: t.isCrypto,
          intradayPrice: t.intradayPrice, now, fetchFailed,
        }));
      }
    }
    const sorted = sortRows(rows);
    return {
      rows: sorted,
      summary: summarizeRows(sorted),
      isLoading,
      partialFailure: failedKeys.size > 0,
    };
  }, [targets, rawByTicker, failedKeys, isLoading]);
}
