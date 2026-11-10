// hooks/useEnrichedIndicators.ts
// 포트폴리오 전체 종목의 과거 OHLCV를 배치 조회하여 확장 지표(MA 전 기간, RSI, ATR, 52주 신고가/최대거래량, 클라이맥스/디스트리뷰션 메타) 계산

import { useState, useEffect, useRef, useMemo } from 'react';
import type { Asset, WatchlistItem } from '../types';
import { createLogger } from '../utils/logger';

const log = createLogger('EnrichedIndicators');
import {
  fetchStockHistoricalPrices,
  fetchCryptoHistoricalPrices,
  convertTickerForAPI,
  isCryptoExchange,
  type HistoricalPriceResult,
} from '../services/historicalPriceService';
import { getCategoryName, DEFAULT_CATEGORIES } from '../types/category';
import { getRequiredHistoryDaysForOHLCV } from '../utils/maCalculations';
import { VOLUME_PROXY_MAP } from '../constants/commodityProxyMap';
import type { DistributionDayMeta as SharedDistributionDayMeta } from '../utils/marketDistribution';
import { buildEnrichedIndicator } from '../utils/buildEnrichedIndicator';
import { shouldRefetchEnrichedAfterPriceRefresh, ENRICHED_REFRESH_TOLERANCE_MS } from '../utils/enrichedRefreshPolicy';
import { markLoadStage } from '../utils/loadTiming';

/** 디스트리뷰션 판정 메타 — 정의는 utils/marketDistribution으로 이동 (지수와 종목 공용) */
export type DistributionDayMeta = SharedDistributionDayMeta;

/** 종목별 확장 지표 데이터 */
export interface EnrichedIndicatorData {
  /** 금일 MA 값 — 기간별 { 10: 72500, 20: 71000, ... } */
  ma: Record<number, number | null>;
  /** 전일 MA 값 — 동일 구조 */
  prevMa: Record<number, number | null>;
  /** 금일 RSI (14일) */
  rsi: number | null;
  /** 전일 RSI (14일) */
  prevRsi: number | null;
  /** MA 교차 경과일 — maCrossDays[shortPeriod][longPeriod] */
  maCrossDays: Record<number, Record<number, number | null>>;
  /** 전일 종가 */
  prevClose: number | null;
  /** 가격이 MA를 상향돌파한 경과일 — priceCrossMaDays[period] */
  priceCrossMaDays: Record<number, number | null>;
  /** 가격이 MA를 하향이탈한 경과일 — priceBreakBelowMaDays[period] (와인스타인 매도 트리거) */
  priceBreakBelowMaDays: Record<number, number | null>;
  /** RSI가 30을 상향돌파한 경과일 */
  rsiBounceDay: number | null;
  /** RSI가 70을 상향돌파한 경과일 */
  rsiOverheatEntryDay: number | null;

  // ── OHLCV 기반 확장 (백엔드 OHLCV 미수신 시 일부 필드는 null) ──
  /** 금일 ATR(14) — Wilder's smoothing (H/L/C 필요) */
  atr14: number | null;
  /** 52주(252거래일) 최고 종가 */
  high52w: number | null;
  /** 52주(252거래일) 최대 거래량 (프록시 적용 후) */
  volume52wMax: number | null;
  /** 단기/장기 기울기 비율 (slope10 / slope60), 장기 기울기 ≤ 0이면 null */
  slopeRatio: number | null;
  /** 당일 (고가 - 저가) / ATR14. H/L/ATR 미수신 시 null */
  dayRangeOverAtr: number | null;
  /** 금일 종가가 52주 신고가 (관용 0.01% 허용 — 부동소수 비교) */
  priceIsAt52wHigh: boolean;
  /** 금일 거래량(프록시 적용 후)이 52주 최대 거래량 */
  volumeIsAt52wMax: boolean;
  /** 디스트리뷰션 판정 메타 — 최근 DISTRIBUTION_META_LENGTH일 (오래된→최신) */
  distributionDayMeta: DistributionDayMeta[];
  /** OHLCV (open/high/low) 수신 여부. false면 클라이맥스 (b)와 디스트리뷰션 윗꼬리 조건은 평가 안 됨 */
  ohlcvAvailable: boolean;
  /** 당일 양봉 여부 (close > open) — 클라이맥스 (b) 방향성 보강용. OHLCV 미수신 시 null */
  isBullishCandle: boolean | null;
  /** "수개월 상승" 전제 — MA60이 LONG_TREND_LOOKBACK일 전 대비 +10% 이상. 데이터 부족 시 null */
  longTrendUp: boolean | null;
  /** 최근 60거래일 내 가장 최근에 확정된 swing low 종가 (와인스타인 매도 트리거). 미형성 시 null */
  recentSwingLow: number | null;

  // ── 강의검증 급성 매도 신호 재료 (KR 전용, 백테스트 lectureSignals S1~S6와 동일 정의, 룩어헤드 0) ──
  // 아래 8필드는 buildEnrichedIndicator가 항상 채운다. 옵셔널은 기존 테스트/소비자 호환용(미지정=null과 동일 취급).
  /** S1 재료: 21거래일 가격비 close[i]/close[i-21] (≥2.0이면 +100%). 창부족/base≤0이면 null */
  runup21dRatio?: number | null;
  /** S2 재료: 5거래일 가격비 close[i]/close[i-5] (≥1.4이면 +40%). 창부족/base≤0이면 null */
  runup5dRatio?: number | null;
  /** S3/S5/S6 재료: 당일 종가/전일 종가 (close-to-close, 백테스트 dailyRatio). metrics.yesterdayChange 아님. */
  todayDailyRatio?: number | null;
  /** S3 재료: 당일 종가==고가 (상대 허용오차 1e-9). 고가 미수신 시 null */
  todayCloseEqualsHigh?: boolean | null;
  /** S4 재료: 시가갭 open[i]/close[i-1]. 시가/전일종가 미수신 시 null */
  gapUpRatio?: number | null;
  /** S4 재료: 당일 음봉 (close < open). 시가/종가 미수신 시 null */
  todayIsBearishCandle?: boolean | null;
  /** S4/S6 재료: 당일 거래량 / 20일 평균거래량(당일 제외, 룩어헤드 규약). 거래량 미수신/창부족이면 null */
  volumeVs20dAvg?: number | null;
  /** S5(APP_PROXY) 재료: 거래대금 프록시(종가×거래량)가 최근 63일(당일 포함) 최대. 원천 거래대금 아닌 프록시. 거래량 미수신/창부족이면 null */
  turnoverProxyIsMax63d?: boolean | null;
}

/** enriched 지표 계산에 필요한 최소 종목 정보 */
interface TickerItem {
  ticker: string;
  exchange: string;
  categoryId: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10분
// MA_PERIODS/RSI_PERIOD/DISTRIBUTION_META_LENGTH/VOLUME_AVG_PERIOD_DISTRIBUTION 등 enrichment 상수는
// `utils/buildEnrichedIndicator`에 정의됨 (백테스트와 공유)

interface CacheEntry {
  data: Map<string, EnrichedIndicatorData>;
  fetchedAt: number;
  tickerKey: string;
  /** 이 조회가 요청한 `ticker|exchange` 집합 — 부분집합 재사용 판정용(히스토리가 없어 맵에 빠진 종목도 "요청됨"으로 센다) */
  requested: Set<string>;
}

interface InFlightEntry {
  tickerKey: string;
  requested: Set<string>;
  startedAt: number;
  promise: Promise<Map<string, EnrichedIndicatorData> | null>;
}

let cache: CacheEntry | null = null;
/** 진행 중인 조회(single-flight) — 같은/상위 집합 요청은 새 요청 대신 이 promise에 붙는다. */
let inFlight: InFlightEntry | null = null;
/** 가장 최근 조회(진행 중이거나 캐시를 만든 것)의 시작 시각(ms). 조회한 적 없으면 null. */
let lastFetchStartedAt: number | null = null;

/**
 * 모듈 캐시 강제 무효화(P4) — 수동/자동 시세 갱신 직후 호출해 다음 조회가 10분 TTL을 무시하고
 * 새 가격으로 MA/RSI 등 enriched 지표를 재계산하게 한다. `useEnrichedIndicators`의
 * `forceRefreshVersion` 인자와 함께 쓴다 — 이 함수만으로는 effect가 재실행되지 않으므로
 * (React state 변화가 없으면 effect가 다시 안 돎) 호출부는 반드시 버전도 함께 올려야 한다.
 */
export function invalidateEnrichedCache(): void {
  cache = null;
}

/**
 * 시세 갱신 직후 호출: 정책(`shouldRefetchEnrichedAfterPriceRefresh`)상 재조회가 필요하면 캐시와 진행 중 조회를
 * 폐기하고 true를 돌려준다. true일 때만 호출부가 `forceRefreshVersion`을 올려야 한다(false면 아무것도 건드리지 않는다).
 */
export function requestEnrichedRefreshAfterPriceRefresh(priceRefreshStartedAt: number): boolean {
  // 직전 조회가 실패/빈 결과로 끝나 캐시도 진행 중 조회도 없으면, 시각과 무관하게 재조회한다
  // (과거엔 갱신 후 무조건 재조회가 사실상의 재시도 역할을 했다 — 그 복구 경로를 유지).
  const nothingUsable = !cache && !inFlight;
  const refetch = nothingUsable || shouldRefetchEnrichedAfterPriceRefresh({
    lastEnrichedFetchStartedAt: lastFetchStartedAt,
    priceRefreshStartedAt,
    toleranceMs: ENRICHED_REFRESH_TOLERANCE_MS,
  });
  if (refetch) {
    cache = null;
    inFlight = null; // 오래된 조회가 끝나도 캐시를 덮어쓰지 않도록 분리(결과는 기존 구독자에게만 전달)
  }
  return refetch;
}

function isSuperset(superset: Set<string>, needed: Set<string>): boolean {
  for (const k of needed) if (!superset.has(k)) return false;
  return true;
}

function buildTickerKey(items: TickerItem[]): string {
  return items.map(a => `${a.ticker}|${a.exchange}`).sort().join(',');
}

/** results에서 ticker 키로 엔트리 안전 추출 */
function getResultEntry(
  results: Record<string, HistoricalPriceResult>,
  apiTicker: string
): HistoricalPriceResult | undefined {
  return results[apiTicker];
}

/** 시계열 dict → 동일 길이 정렬 배열 (sortedDates 기준, 값 미존재 시 null) */
function alignSeries(
  sortedDates: string[],
  series: Record<string, number> | undefined
): (number | null)[] {
  if (!series) return sortedDates.map(() => null);
  return sortedDates.map(d => {
    const v = series[d];
    return typeof v === 'number' && isFinite(v) ? v : null;
  });
}

/** 실제 /history 조회 + 지표 계산 (모듈 레벨 — 컴포넌트 생명주기와 무관하게 끝까지 돌아 캐시를 채운다). */
async function fetchAndComputeEnriched(allTickerItems: TickerItem[]): Promise<Map<string, EnrichedIndicatorData>> {
    const days = getRequiredHistoryDaysForOHLCV(); // 52주 + MA200 워밍업 ≈ 440일
    const endDate = new Date().toISOString().split('T')[0];
    const startD = new Date();
    startD.setDate(startD.getDate() - days);
    const startDate = startD.toISOString().split('T')[0];

    // stock/crypto 분류
    const stockTickers: { item: TickerItem; apiTicker: string }[] = [];
    const cryptoTickers: { item: TickerItem; apiTicker: string }[] = [];

    for (const item of allTickerItems) {
      const apiTicker = convertTickerForAPI(item.ticker, item.exchange, getCategoryName(item.categoryId, DEFAULT_CATEGORIES));
      if (isCryptoExchange(item.exchange)) {
        cryptoTickers.push({ item, apiTicker });
      } else {
        stockTickers.push({ item, apiTicker });
      }
    }

    // 거래량 프록시 ticker도 stock 배치에 dedup 추가 (가격은 무시, volume만 사용)
    const stockApiTickers = new Set(stockTickers.map(t => t.apiTicker));
    const proxyTickersNeeded = new Set<string>();
    for (const { item } of stockTickers) {
      const proxy = VOLUME_PROXY_MAP[item.ticker];
      if (proxy && !stockApiTickers.has(proxy)) {
        proxyTickersNeeded.add(proxy);
      }
    }
    const stockTickersForFetch = [...stockTickers.map(t => t.apiTicker), ...proxyTickersNeeded];

    // 배치 조회 (stock + crypto 병렬)
    const [stockResults, cryptoResults] = await Promise.all([
      stockTickersForFetch.length > 0
        ? fetchStockHistoricalPrices(stockTickersForFetch, startDate, endDate)
        : Promise.resolve({}),
      cryptoTickers.length > 0
        ? fetchCryptoHistoricalPrices(
            cryptoTickers.map(t => t.apiTicker),
            startDate,
            endDate
          )
        : Promise.resolve({}),
    ]);

    const result = new Map<string, EnrichedIndicatorData>();

    // 각 종목별 지표 계산
    const allItems = [
      ...stockTickers.map(t => ({ ...t, results: stockResults })),
      ...cryptoTickers.map(t => ({ ...t, results: cryptoResults })),
    ];

    for (const { item, apiTicker, results } of allItems) {
      const entry = getResultEntry(results, apiTicker);
      const priceData = entry?.data;

      if (!priceData || Object.keys(priceData).length === 0) {
        continue;
      }

      // 거래량 프록시 적용: 본 자산의 거래량 시계열을 프록시 ticker의 것으로 대체
      const proxyTicker = VOLUME_PROXY_MAP[item.ticker];
      const proxyEntry = proxyTicker ? getResultEntry(stockResults, proxyTicker) : undefined;
      const effectiveVolumeSeries = proxyEntry?.volume ?? entry.volume;

      // 날짜 오름차순 정렬 (close 기준)
      const sortedDates = Object.keys(priceData).sort();
      const closes = sortedDates.map(d => priceData[d]);

      // OHLCV 시계열 정렬 (없으면 null로 채움)
      const opens = alignSeries(sortedDates, entry.open);
      const highs = alignSeries(sortedDates, entry.high);
      const lows = alignSeries(sortedDates, entry.low);
      const volumes = alignSeries(sortedDates, effectiveVolumeSeries);

      // 단일 종목 enrichment — 백테스트와 동일 알고리즘 사용
      const enriched = buildEnrichedIndicator({
        sortedDates, closes, opens, highs, lows, volumes,
      });
      result.set(item.ticker, enriched);
  }

  return result;
}

function startEnrichedFetch(items: TickerItem[], tickerKey: string): InFlightEntry {
  const startedAt = Date.now();
  lastFetchStartedAt = startedAt;
  markLoadStage('enriched-start');
  const entry: InFlightEntry = {
    tickerKey,
    requested: new Set(items.map(i => `${i.ticker}|${i.exchange}`)),
    startedAt,
    promise: Promise.resolve(null),
  };
  entry.promise = fetchAndComputeEnriched(items)
    .then(result => {
      if (inFlight === entry) {
        // 빈 결과는 캐시하지 않는다(/history 실패는 {}로 삼켜져 빈 맵이 된다 — 캐시하면 10분간 지표가 비어 보인다)
        if (result.size > 0) {
          cache = { data: result, fetchedAt: Date.now(), tickerKey, requested: entry.requested };
        }
        inFlight = null;
      }
      markLoadStage('enriched-end');
      return result;
    })
    .catch((err: unknown) => {
      log.error('fetch error:', err);
      if (inFlight === entry) inFlight = null;
      markLoadStage('enriched-end');
      return null;
    });
  inFlight = entry;
  return entry;
}

export function useEnrichedIndicators(
  assets: Asset[],
  watchlistItems?: WatchlistItem[],
  /**
   * P4: 강제 재조회 트리거(값이 바뀔 때만 의미 있음, 값 자체는 임의). 티커 집합이 그대로여도
   * 시세를 갱신했으면 MA/RSI가 새 종가를 반영해야 하므로, 호출부(PortfolioContext)가 가격
   * 갱신 직후 `invalidateEnrichedCache()`와 함께 이 값을 올린다.
   */
  forceRefreshVersion: number = 0
): {
  enrichedMap: Map<string, EnrichedIndicatorData>;
  isLoading: boolean;
} {
  const [enrichedMap, setEnrichedMap] = useState<Map<string, EnrichedIndicatorData>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  // 포트폴리오 + 관심종목 ticker 통합 (중복 제거)
  const allTickerItems: TickerItem[] = useMemo(() => {
    const items: TickerItem[] = assets.map(a => ({
      ticker: a.ticker,
      exchange: a.exchange,
      categoryId: a.categoryId,
    }));
    if (watchlistItems && watchlistItems.length > 0) {
      const existingTickers = new Set(assets.map(a => a.ticker));
      for (const w of watchlistItems) {
        if (!existingTickers.has(w.ticker)) {
          items.push({ ticker: w.ticker, exchange: w.exchange, categoryId: w.categoryId });
        }
      }
    }
    return items;
  }, [assets, watchlistItems]);

  const tickerKey = useMemo(() => buildTickerKey(allTickerItems), [allTickerItems]);

  // 최신 항목 목록을 ref로 들고 있다가 effect에서 읽는다 — assets 배열 identity만 바뀌고 티커 집합이 같으면
  // effect가 재실행되지 않게 하기 위함(deps는 tickerKey/forceRefreshVersion). 선언 순서상 아래 effect보다 먼저 실행된다.
  const itemsRef = useRef<TickerItem[]>(allTickerItems);
  useEffect(() => {
    itemsRef.current = allTickerItems;
  }, [allTickerItems]);

  useEffect(() => {
    const items = itemsRef.current;
    if (items.length === 0) {
      setEnrichedMap(new Map());
      return;
    }

    const needed = new Set(items.map(i => `${i.ticker}|${i.exchange}`));

    // 캐시 확인 — 같은 티커 집합이거나, 캐시가 요청 종목을 모두 포함(상위 집합)하면 재사용
    const now = Date.now();
    if (cache && (now - cache.fetchedAt) < CACHE_TTL_MS
        && (cache.tickerKey === tickerKey || isSuperset(cache.requested, needed))) {
      setEnrichedMap(cache.data);
      setIsLoading(false);
      markLoadStage('enriched-start');
      markLoadStage('enriched-end');
      return;
    }

    // single-flight: 같은/상위 집합의 조회가 이미 진행 중이면 붙는다
    const entry = (inFlight && (inFlight.tickerKey === tickerKey || isSuperset(inFlight.requested, needed)))
      ? inFlight
      : startEnrichedFetch(items, tickerKey);

    let cancelled = false; // 이 effect 실행 전용 — 정리 후 setState 방지(공유 promise 자체는 계속 진행)
    setIsLoading(true);
    entry.promise.then(result => {
      if (cancelled) return;
      if (result) setEnrichedMap(result);
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [tickerKey, forceRefreshVersion]);

  return { enrichedMap, isLoading };
}
