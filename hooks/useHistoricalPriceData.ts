// hooks/useHistoricalPriceData.ts
// 차트용 과거 시세 데이터 fetching hook (종가 기반)

import { useState, useEffect, useRef } from 'react';
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
  category?: string;
  isExpanded: boolean;
  maxMAPeriod: number;
  displayDays?: number | null; // 글로벌 기간 (null = ALL)
}

interface UseHistoricalPriceDataResult {
  historicalPrices: HistoricalPriceData | null;
  historicalVolumes: HistoricalPriceData | null;
  isLoading: boolean;
  error: string | null;
}

interface CacheEntry {
  data: HistoricalPriceData;
  volume: HistoricalPriceData | null;
  fetchedAt: number;
  totalDays: number;
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
  displayDays,
}: UseHistoricalPriceDataProps): UseHistoricalPriceDataResult {
  const [historicalPrices, setHistoricalPrices] = useState<HistoricalPriceData | null>(null);
  const [historicalVolumes, setHistoricalVolumes] = useState<HistoricalPriceData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    // 차트가 접혀있거나 ticker가 없으면 fetch하지 않음
    if (!isExpanded || !ticker) {
      return;
    }

    // MA warm-up에 필요한 일수
    const effectivePeriod = Math.max(maxMAPeriod, 1);
    const maWarmupDays = getRequiredHistoryDays(effectivePeriod);

    // 총 fetch 일수: 표시 기간 + MA warm-up (또는 MA warm-up만)
    let totalDays: number;
    if (displayDays === null) {
      // ALL: 최대 10년
      totalDays = 3650;
    } else if (displayDays && displayDays > 0) {
      totalDays = displayDays + maWarmupDays;
    } else {
      totalDays = maWarmupDays;
    }

    const cacheKey = getCacheKey(ticker, exchange);
    const now = Date.now();

    // 캐시 확인: TTL 유효 + 이전 요청이 현재 일수를 커버하면 재사용
    const cached = cache.get(cacheKey);
    if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS && cached.totalDays >= totalDays) {
      setHistoricalPrices(cached.data);
      setHistoricalVolumes(cached.volume);
      setError(null);
      return;
    }

    abortRef.current = false;
    setIsLoading(true);
    setError(null);

    const fetchData = async () => {
      try {
        const endDate = new Date().toISOString().split('T')[0];
        const startD = new Date();
        startD.setDate(startD.getDate() - totalDays);
        const startDate = startD.toISOString().split('T')[0];

        const apiTicker = convertTickerForAPI(ticker, exchange, category);
        const isCrypto = isCryptoExchange(exchange);

        let priceData: HistoricalPriceData | undefined;
        let volumeData: HistoricalPriceData | undefined;

        if (isCrypto) {
          const result = await fetchCryptoHistoricalPrices([apiTicker], startDate, endDate);
          const entry = result[apiTicker] || result[Object.keys(result)[0]];
          priceData = entry?.data;
          volumeData = entry?.volume;
        } else {
          const result = await fetchStockHistoricalPrices([apiTicker], startDate, endDate);
          const entry = result[apiTicker] || result[Object.keys(result)[0]];
          priceData = entry?.data;
          volumeData = entry?.volume;
        }

        if (abortRef.current) return;

        if (priceData && Object.keys(priceData).length > 0) {
          cache.set(cacheKey, {
            data: priceData,
            volume: volumeData ?? null,
            fetchedAt: Date.now(),
            totalDays,
          });
          setHistoricalPrices(priceData);
          setHistoricalVolumes(volumeData ?? null);
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
  }, [ticker, exchange, category, isExpanded, maxMAPeriod, displayDays]);

  return { historicalPrices, historicalVolumes, isLoading, error };
}
