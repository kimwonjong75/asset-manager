// hooks/useHistoricalPriceData.ts
// MA 차트용 과거 시세 데이터 fetching hook

import { useState, useEffect, useRef } from 'react';
import { AssetCategory } from '../types';
import {
  HistoricalPriceData,
  fetchStockHistoricalPrices,
  fetchCryptoHistoricalPrices,
  convertTickerForAPI,
  isCryptoExchange,
} from '../services/historicalPriceService';
import { getRequiredHistoryDays } from '../utils/maCalculations';

interface UseHistoricalPriceDataProps {
  ticker: string;
  exchange: string;
  category: AssetCategory;
  isExpanded: boolean;
  maxMAPeriod: number;
}

interface UseHistoricalPriceDataResult {
  historicalPrices: HistoricalPriceData | null;
  isLoading: boolean;
  error: string | null;
}

interface CacheEntry {
  data: HistoricalPriceData;
  fetchedAt: number;
  maxPeriod: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10분
const cache = new Map<string, CacheEntry>();

function getCacheKey(ticker: string, exchange: string): string {
  return `${ticker}__${exchange}`;
}

export function useHistoricalPriceData({
  ticker,
  exchange,
  category,
  isExpanded,
  maxMAPeriod,
}: UseHistoricalPriceDataProps): UseHistoricalPriceDataResult {
  const [historicalPrices, setHistoricalPrices] = useState<HistoricalPriceData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    // 차트가 접혀있거나 MA가 비활성이면 fetch하지 않음
    if (!isExpanded || maxMAPeriod <= 0) {
      return;
    }

    const cacheKey = getCacheKey(ticker, exchange);
    const now = Date.now();

    // 캐시 확인: TTL 유효 + 이전 요청이 현재 maxPeriod를 커버하면 재사용
    const cached = cache.get(cacheKey);
    if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS && cached.maxPeriod >= maxMAPeriod) {
      setHistoricalPrices(cached.data);
      setError(null);
      return;
    }

    abortRef.current = false;
    setIsLoading(true);
    setError(null);

    const fetchData = async () => {
      try {
        const days = getRequiredHistoryDays(maxMAPeriod);
        const endDate = new Date().toISOString().split('T')[0];
        const startD = new Date();
        startD.setDate(startD.getDate() - days);
        const startDate = startD.toISOString().split('T')[0];

        const apiTicker = convertTickerForAPI(ticker, exchange, category);
        const isCrypto = isCryptoExchange(exchange);

        let priceData: HistoricalPriceData | undefined;

        if (isCrypto) {
          const result = await fetchCryptoHistoricalPrices([apiTicker], startDate, endDate);
          const entry = result[apiTicker] || result[Object.keys(result)[0]];
          priceData = entry?.data;
        } else {
          const result = await fetchStockHistoricalPrices([apiTicker], startDate, endDate);
          const entry = result[apiTicker] || result[Object.keys(result)[0]];
          priceData = entry?.data;
        }

        if (abortRef.current) return;

        if (priceData && Object.keys(priceData).length > 0) {
          cache.set(cacheKey, {
            data: priceData,
            fetchedAt: Date.now(),
            maxPeriod: maxMAPeriod,
          });
          setHistoricalPrices(priceData);
          setError(null);
        } else {
          setError('과거 시세 데이터가 없습니다.');
        }
      } catch (err) {
        if (abortRef.current) return;
        console.error('[useHistoricalPriceData] fetch error:', err);
        setError('과거 시세 조회 실패');
      } finally {
        if (!abortRef.current) {
          setIsLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      abortRef.current = true;
    };
  }, [ticker, exchange, category, isExpanded, maxMAPeriod]);

  return { historicalPrices, isLoading, error };
}
