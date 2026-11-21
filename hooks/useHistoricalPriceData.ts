// hooks/useHistoricalPriceData.ts
// 차트용 과거 시세 데이터 fetching hook (종가 기반)

import { useState, useEffect, useCallback } from 'react';
import { createLogger } from '../utils/logger';

const log = createLogger('HistoricalPriceData');
import {
  HistoricalPriceData,
  fetchStockHistoricalPrices,
  fetchCryptoHistoricalPrices,
  convertTickerForAPI,
  isCryptoExchange,
} from '../services/historicalPriceService';
interface UseHistoricalPriceDataProps {
  ticker: string;
  exchange: string;
  category?: string;
  isExpanded: boolean;
  maxMAPeriod: number;
  displayDays?: number | null; // 글로벌 기간 (null = ALL) — visibleRange 전달용 (fetch에는 미사용)
}

interface UseHistoricalPriceDataResult {
  historicalPrices: HistoricalPriceData | null;
  historicalVolumes: HistoricalPriceData | null;
  /** 시가 시계열 (캔들차트용, 백엔드 미수신 시 null → 라인 폴백) */
  historicalOpens: HistoricalPriceData | null;
  /** 고가 시계열 (캔들차트용, 백엔드 미수신 시 null → 라인 폴백) */
  historicalHighs: HistoricalPriceData | null;
  /** 저가 시계열 (캔들차트용, 백엔드 미수신 시 null → 라인 폴백) */
  historicalLows: HistoricalPriceData | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

interface CacheEntry {
  data: HistoricalPriceData;
  volume: HistoricalPriceData | null;
  open: HistoricalPriceData | null;
  high: HistoricalPriceData | null;
  low: HistoricalPriceData | null;
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
  const [historicalOpens, setHistoricalOpens] = useState<HistoricalPriceData | null>(null);
  const [historicalHighs, setHistoricalHighs] = useState<HistoricalPriceData | null>(null);
  const [historicalLows, setHistoricalLows] = useState<HistoricalPriceData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => {
    cache.delete(getCacheKey(ticker, exchange));
    setRevision(value => value + 1);
  }, [ticker, exchange]);

  useEffect(() => {
    // 차트가 접혀있거나 ticker가 없으면 fetch하지 않음
    if (!isExpanded || !ticker) {
      return;
    }

    // 항상 전체 데이터를 fetch (차트에서 visibleRange로 초기 뷰만 제한, 드래그로 이전 구간 탐색 가능)
    const totalDays = 3650;

    const cacheKey = getCacheKey(ticker, exchange);
    const now = Date.now();

    // 캐시 확인: TTL 유효 + 이전 요청이 현재 일수를 커버하면 재사용
    const cached = cache.get(cacheKey);
    if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS && cached.totalDays >= totalDays) {
      setIsLoading(false);
      setHistoricalPrices(cached.data);
      setHistoricalVolumes(cached.volume);
      setHistoricalOpens(cached.open);
      setHistoricalHighs(cached.high);
      setHistoricalLows(cached.low);
      setError(null);
      return;
    }

    let cancelled = false;
    setHistoricalPrices(null);
    setHistoricalVolumes(null);
    setHistoricalOpens(null);
    setHistoricalHighs(null);
    setHistoricalLows(null);
    setIsLoading(true);
    setError(null);

    const fetchData = async () => {
      try {
        const endDate = new Date(Date.now() + 86_400_000).toISOString().split('T')[0];
        const startD = new Date();
        startD.setDate(startD.getDate() - totalDays);
        const startDate = startD.toISOString().split('T')[0];

        const apiTicker = convertTickerForAPI(ticker, exchange, category);
        const isCrypto = isCryptoExchange(exchange);

        let priceData: HistoricalPriceData | undefined;
        let volumeData: HistoricalPriceData | undefined;
        let openData: HistoricalPriceData | undefined;
        let highData: HistoricalPriceData | undefined;
        let lowData: HistoricalPriceData | undefined;

        if (isCrypto) {
          const result = await fetchCryptoHistoricalPrices([apiTicker], startDate, endDate);
          const entry = result[apiTicker] || result[Object.keys(result)[0]];
          priceData = entry?.data;
          volumeData = entry?.volume;
          openData = entry?.open;
          highData = entry?.high;
          lowData = entry?.low;
        } else {
          const result = await fetchStockHistoricalPrices([apiTicker], startDate, endDate);
          const entry = result[apiTicker] || result[Object.keys(result)[0]];
          priceData = entry?.data;
          volumeData = entry?.volume;
          openData = entry?.open;
          highData = entry?.high;
          lowData = entry?.low;
        }

        if (cancelled) return;

        if (priceData && Object.keys(priceData).length > 0) {
          cache.set(cacheKey, {
            data: priceData,
            volume: volumeData ?? null,
            open: openData ?? null,
            high: highData ?? null,
            low: lowData ?? null,
            fetchedAt: Date.now(),
            totalDays,
          });
          setHistoricalPrices(priceData);
          setHistoricalVolumes(volumeData ?? null);
          setHistoricalOpens(openData ?? null);
          setHistoricalHighs(highData ?? null);
          setHistoricalLows(lowData ?? null);
          setError(null);
        } else {
          setError('과거 시세 데이터가 없습니다.');
        }
      } catch (err) {
        if (cancelled) return;
        log.error('fetch error:', err);
        setError('과거 시세 조회 실패');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [ticker, exchange, category, isExpanded, revision]);

  return { historicalPrices, historicalVolumes, historicalOpens, historicalHighs, historicalLows, isLoading, error, refresh };
}
