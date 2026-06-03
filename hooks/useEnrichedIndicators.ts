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
import {
  calculateSMA,
  calculateRSI,
  calculateCrossDays,
  calculatePriceCrossMaDays,
  calculatePriceBreakBelowMaDays,
  calculateRsiCrossDays,
  calculateATR,
  calculate52WeekHigh,
  calculate52WeekMaxVolume,
  calculateSlopeRatio,
  getRequiredHistoryDaysForOHLCV,
} from '../utils/maCalculations';
import { VOLUME_PROXY_MAP } from '../constants/commodityProxyMap';
import { detectRecentSwingLow } from '../utils/swingPointDetection';

/** 디스트리뷰션 판정 메타 (최근 N일치 — N은 DISTRIBUTION_META_LENGTH) */
export interface DistributionDayMeta {
  /** 거래량 / 50일 평균 거래량 (프록시 적용 후) — 50일 평균 산출 불가 시 null */
  volRatio: number | null;
  /** 종가 < 시가 (음봉). open 시계열 미수신 시 null */
  isBearish: boolean | null;
  /** 종가가 당일 (고-저) 구간의 하위 50%에서 마감. high/low 미수신 시 null */
  isLowerHalfClose: boolean | null;
  /** 등락률 (close - prevClose) / prevClose */
  changeRatio: number;
}

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
}

/** enriched 지표 계산에 필요한 최소 종목 정보 */
interface TickerItem {
  ticker: string;
  exchange: string;
  categoryId: number;
}

const MA_PERIODS = [5, 10, 20, 60, 120, 150, 200];
const RSI_PERIOD = 14;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10분
const DISTRIBUTION_META_LENGTH = 30; // filterLogic에서 최대 30일 윈도우까지 지원
const VOLUME_AVG_PERIOD_DISTRIBUTION = 50; // 디스트리뷰션 거래량 비율 산출에 사용
const PRICE_HIGH_TOLERANCE = 1e-9; // 52주 신고가 비교 관용
const LONG_TREND_LOOKBACK = 60;     // longTrendUp: MA60을 60거래일 전과 비교
const LONG_TREND_GROWTH = 1.1;      // longTrendUp: +10% 이상 우상향
const SWING_LOW_LOOKBACK = 60;      // swing low 탐지 윈도우 (거래일)
const SWING_LOW_BARS = 5;            // 좌우 N거래일 동안 자기보다 낮은 종가 없어야 함

interface CacheEntry {
  data: Map<string, EnrichedIndicatorData>;
  fetchedAt: number;
  tickerKey: string;
}

let cache: CacheEntry | null = null;

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

/** 50일 trailing 평균 거래량 — i 이전 50일치 평균 (i 미포함, 룩어헤드 방지) */
function trailingVolumeAvg(volumes: (number | null)[], i: number, period: number): number | null {
  if (i < period) return null;
  let sum = 0;
  let count = 0;
  for (let j = i - period; j < i; j++) {
    const v = volumes[j];
    if (typeof v === 'number') {
      sum += v;
      count++;
    }
  }
  if (count < period * 0.8) return null; // 50일 중 80% 미만이면 신뢰 불가
  return sum / count;
}

export function useEnrichedIndicators(
  assets: Asset[],
  watchlistItems?: WatchlistItem[]
): {
  enrichedMap: Map<string, EnrichedIndicatorData>;
  isLoading: boolean;
} {
  const [enrichedMap, setEnrichedMap] = useState<Map<string, EnrichedIndicatorData>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef(false);

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

  useEffect(() => {
    if (allTickerItems.length === 0) {
      setEnrichedMap(new Map());
      return;
    }

    // 캐시 확인
    const now = Date.now();
    if (cache && cache.tickerKey === tickerKey && (now - cache.fetchedAt) < CACHE_TTL_MS) {
      setEnrichedMap(cache.data);
      return;
    }

    abortRef.current = false;
    setIsLoading(true);

    const fetchAndCompute = async () => {
      try {
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

        if (abortRef.current) return;

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
          const sortedPrices = sortedDates.map(date => ({
            date,
            price: priceData[date],
          }));
          const closes = sortedPrices.map(p => p.price);

          // OHLCV 시계열 정렬 (없으면 null로 채움)
          const opens = alignSeries(sortedDates, entry.open);
          const highs = alignSeries(sortedDates, entry.high);
          const lows = alignSeries(sortedDates, entry.low);
          const volumes = alignSeries(sortedDates, effectiveVolumeSeries);

          const ohlcvAvailable =
            opens.some(v => v !== null) &&
            highs.some(v => v !== null) &&
            lows.some(v => v !== null);

          // MA 계산
          const ma: Record<number, number | null> = {};
          const prevMa: Record<number, number | null> = {};
          const smaArrays: Record<number, (number | null)[]> = {};
          for (const period of MA_PERIODS) {
            const smaValues = calculateSMA(sortedPrices, period);
            smaArrays[period] = smaValues;
            const lastIdx = smaValues.length - 1;
            ma[period] = lastIdx >= 0 ? smaValues[lastIdx] : null;
            prevMa[period] = lastIdx >= 1 ? smaValues[lastIdx - 1] : null;
          }

          // MA 교차 경과일 (모든 short < long 쌍)
          const maCrossDays: Record<number, Record<number, number | null>> = {};
          for (let i = 0; i < MA_PERIODS.length; i++) {
            for (let j = i + 1; j < MA_PERIODS.length; j++) {
              const short = MA_PERIODS[i];
              const long = MA_PERIODS[j];
              if (!maCrossDays[short]) maCrossDays[short] = {};
              maCrossDays[short][long] = calculateCrossDays(smaArrays[short], smaArrays[long]);
            }
          }

          // RSI 계산
          const rsiValues = calculateRSI(sortedPrices, RSI_PERIOD);
          const lastRsiIdx = rsiValues.length - 1;
          const rsi = lastRsiIdx >= 0 ? rsiValues[lastRsiIdx] : null;
          const prevRsi = lastRsiIdx >= 1 ? rsiValues[lastRsiIdx - 1] : null;

          // 전일 종가
          const prevClose = sortedPrices.length >= 2
            ? sortedPrices[sortedPrices.length - 2].price
            : null;

          // 가격 vs MA 상향돌파 경과일
          const priceCrossMaDays: Record<number, number | null> = {};
          const priceBreakBelowMaDays: Record<number, number | null> = {};
          for (const period of MA_PERIODS) {
            priceCrossMaDays[period] = calculatePriceCrossMaDays(sortedPrices, smaArrays[period]);
            priceBreakBelowMaDays[period] = calculatePriceBreakBelowMaDays(sortedPrices, smaArrays[period]);
          }

          // RSI 이벤트 경과일
          const rsiBounceDay = calculateRsiCrossDays(rsiValues, 30);
          const rsiOverheatEntryDay = calculateRsiCrossDays(rsiValues, 70);

          // ── OHLCV 기반 확장 ──
          const closesNullable: (number | null)[] = closes;

          // ATR(14) — H/L/C 필요
          const atrSeries = ohlcvAvailable
            ? calculateATR(highs, lows, closesNullable, 14)
            : [];
          const atr14 = atrSeries.length > 0 ? atrSeries[atrSeries.length - 1] : null;

          // 52주 신고가/최대거래량
          const high52w = calculate52WeekHigh(closesNullable);
          const volume52wMax = calculate52WeekMaxVolume(volumes);

          // 기울기 비율
          const slopeRatio = calculateSlopeRatio(closesNullable, 10, 60);

          // 당일 (H-L) / ATR
          const lastIdx = sortedDates.length - 1;
          const todayHigh = highs[lastIdx];
          const todayLow = lows[lastIdx];
          const dayRangeOverAtr =
            ohlcvAvailable && typeof todayHigh === 'number' && typeof todayLow === 'number' && typeof atr14 === 'number' && atr14 > 0
              ? (todayHigh - todayLow) / atr14
              : null;

          // 52주 신고가/최대거래량 충족 여부
          const todayClose = closes[lastIdx];
          const todayVolume = volumes[lastIdx];
          const priceIsAt52wHigh =
            typeof high52w === 'number' && typeof todayClose === 'number' && todayClose >= high52w - PRICE_HIGH_TOLERANCE;
          const volumeIsAt52wMax =
            typeof volume52wMax === 'number' && typeof todayVolume === 'number' && todayVolume >= volume52wMax - PRICE_HIGH_TOLERANCE;

          // 당일 양봉 여부 (close > open) — 클라이맥스 (b) 방향성 보강
          const todayOpen = opens[lastIdx];
          const isBullishCandle: boolean | null =
            typeof todayOpen === 'number' && typeof todayClose === 'number'
              ? todayClose > todayOpen
              : null;

          // "수개월 상승" 전제 — MA60이 LONG_TREND_LOOKBACK일 전 대비 LONG_TREND_GROWTH배 이상
          const sma60 = smaArrays[60];
          const ma60Today = sma60[sma60.length - 1] ?? null;
          const ma60PastIdx = sma60.length - 1 - LONG_TREND_LOOKBACK;
          const ma60Past = ma60PastIdx >= 0 ? sma60[ma60PastIdx] : null;
          const longTrendUp: boolean | null =
            typeof ma60Today === 'number' && typeof ma60Past === 'number' && ma60Past > 0
              ? ma60Today > ma60Past * LONG_TREND_GROWTH
              : null;

          // 직전 swing low — 와인스타인 매도 트리거
          const swingLow = detectRecentSwingLow(sortedPrices, SWING_LOW_LOOKBACK, SWING_LOW_BARS, SWING_LOW_BARS);
          const recentSwingLow = swingLow?.price ?? null;

          // 디스트리뷰션 메타: 최근 30일(또는 가용)
          const distributionDayMeta: DistributionDayMeta[] = [];
          const metaStart = Math.max(0, sortedDates.length - DISTRIBUTION_META_LENGTH);
          for (let i = metaStart; i < sortedDates.length; i++) {
            const avgVol = trailingVolumeAvg(volumes, i, VOLUME_AVG_PERIOD_DISTRIBUTION);
            const v = volumes[i];
            const volRatio = typeof v === 'number' && typeof avgVol === 'number' && avgVol > 0
              ? v / avgVol
              : null;
            const o = opens[i];
            const h = highs[i];
            const l = lows[i];
            const c = closes[i];
            const pc = i > 0 ? closes[i - 1] : null;
            const isBearish: boolean | null =
              typeof o === 'number' && typeof c === 'number' ? c < o : null;
            const isLowerHalfClose: boolean | null =
              typeof h === 'number' && typeof l === 'number' && typeof c === 'number' && h > l
                ? (c - l) / (h - l) < 0.5
                : null;
            const changeRatio =
              typeof pc === 'number' && pc > 0 && typeof c === 'number'
                ? (c - pc) / pc
                : 0;
            distributionDayMeta.push({ volRatio, isBearish, isLowerHalfClose, changeRatio });
          }

          // ticker 기준으로 저장
          result.set(item.ticker, {
            ma,
            prevMa,
            rsi,
            prevRsi,
            maCrossDays,
            prevClose,
            priceCrossMaDays,
            priceBreakBelowMaDays,
            rsiBounceDay,
            rsiOverheatEntryDay,
            atr14,
            high52w,
            volume52wMax,
            slopeRatio,
            dayRangeOverAtr,
            priceIsAt52wHigh,
            volumeIsAt52wMax,
            distributionDayMeta,
            ohlcvAvailable,
            isBullishCandle,
            longTrendUp,
            recentSwingLow,
          });
        }

        if (abortRef.current) return;

        cache = {
          data: result,
          fetchedAt: Date.now(),
          tickerKey,
        };

        setEnrichedMap(result);
      } catch (err) {
        if (abortRef.current) return;
        log.error('fetch error:', err);
      } finally {
        if (!abortRef.current) {
          setIsLoading(false);
        }
      }
    };

    fetchAndCompute();

    return () => {
      abortRef.current = true;
    };
  }, [allTickerItems, tickerKey]);

  return { enrichedMap, isLoading };
}
