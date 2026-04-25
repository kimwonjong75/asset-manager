// hooks/useEnrichedIndicators.ts
// 포트폴리오 전체 종목의 과거 종가를 배치 조회하여 확장 지표(MA 전 기간, RSI 전일값 등) 계산

import { useState, useEffect, useRef, useMemo } from 'react';
import type { Asset, WatchlistItem } from '../types';
import { createLogger } from '../utils/logger';

const log = createLogger('EnrichedIndicators');
import {
  fetchStockHistoricalPrices,
  fetchCryptoHistoricalPrices,
  convertTickerForAPI,
  isCryptoExchange,
} from '../services/historicalPriceService';
import { getCategoryName, DEFAULT_CATEGORIES } from '../types/category';
import { calculateSMA, calculateRSI, calculateCrossDays, calculatePriceCrossMaDays, calculateRsiCrossDays, getRequiredHistoryDays } from '../utils/maCalculations';

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
  /** MA 교차 경과일 — maCrossDays[shortPeriod][longPeriod]
   *  양수 = 골든크로스 N거래일 전, 음수 = 데드크로스 N거래일 전, null = 미확인 */
  maCrossDays: Record<number, Record<number, number | null>>;
  /** 전일 종가 (가격 vs MA 돌파 감지용) */
  prevClose: number | null;
  /** 가격이 MA를 상향돌파한 경과일 — priceCrossMaDays[period]
   *  양수 = N거래일 전 상향돌파, null = 미확인/현재 MA 아래 */
  priceCrossMaDays: Record<number, number | null>;
  /** RSI가 30을 상향돌파한 경과일 (null = 미확인/현재 RSI ≤ 30) */
  rsiBounceDay: number | null;
  /** RSI가 70을 상향돌파한 경과일 (null = 미확인/현재 RSI ≤ 70) */
  rsiOverheatEntryDay: number | null;
}

/** enriched 지표 계산에 필요한 최소 종목 정보 */
interface TickerItem {
  ticker: string;
  exchange: string;
  categoryId: number;
}

const MA_PERIODS = [5, 10, 20, 60, 120, 200];
const RSI_PERIOD = 14;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10분

interface CacheEntry {
  data: Map<string, EnrichedIndicatorData>;
  fetchedAt: number;
  tickerKey: string;
}

let cache: CacheEntry | null = null;

function buildTickerKey(items: TickerItem[]): string {
  return items.map(a => `${a.ticker}|${a.exchange}`).sort().join(',');
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
        const days = getRequiredHistoryDays(200); // MA200 대응
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

        // 배치 조회 (stock + crypto 병렬)
        const [stockResults, cryptoResults] = await Promise.all([
          stockTickers.length > 0
            ? fetchStockHistoricalPrices(
                stockTickers.map(t => t.apiTicker),
                startDate,
                endDate
              )
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
          const entry = results[apiTicker] || results[Object.keys(results).find(k => k === apiTicker) || ''];
          const priceData = entry?.data;

          if (!priceData || Object.keys(priceData).length === 0) {
            continue;
          }

          // 날짜 오름차순 정렬
          const sortedDates = Object.keys(priceData).sort();
          const sortedPrices = sortedDates.map(date => ({
            date,
            price: priceData[date],
          }));

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

          // MA 교차 경과일 계산 (모든 short < long 쌍)
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

          // 가격 vs MA 상향돌파 경과일 (각 기간별)
          const priceCrossMaDays: Record<number, number | null> = {};
          for (const period of MA_PERIODS) {
            priceCrossMaDays[period] = calculatePriceCrossMaDays(sortedPrices, smaArrays[period]);
          }

          // RSI 이벤트 경과일
          const rsiBounceDay = calculateRsiCrossDays(rsiValues, 30);
          const rsiOverheatEntryDay = calculateRsiCrossDays(rsiValues, 70);

          // ticker 기준으로 저장
          result.set(item.ticker, { ma, prevMa, rsi, prevRsi, maCrossDays, prevClose, priceCrossMaDays, rsiBounceDay, rsiOverheatEntryDay });
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
