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
