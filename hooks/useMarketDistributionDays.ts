// hooks/useMarketDistributionDays.ts
// 시장 지수별 오닐 디스트리뷰션 데이 카운트 → severity 산출
// 오닐 원의도: 디스트리뷰션 데이는 시장 지수에 적용 — 5회 이상 누적이면 시장 전체 위험 신호
//
// severity 매핑:
//   0~2: safe      (배너에 표시하지 않음)
//   3:   attention (노랑 — 주의)
//   4:   warning   (주황 — 약세 신호)
//   5+:  exit      (빨강 — 시장 탈출 검토)

import { useEffect, useState } from 'react';
import {
  MARKET_INDEX_DEFS,
  fetchMarketIndicesOHLCV,
} from '../services/marketIndexService';
import {
  buildDistributionMeta,
  countDistributionDays,
} from '../utils/marketDistribution';
import { createLogger } from '../utils/logger';

const log = createLogger('MarketDistributionDays');

export type MarketDistributionSeverity = 'safe' | 'attention' | 'warning' | 'exit';

export interface MarketDistributionEntry {
  ticker: string;
  name: string;
  /** 윈도우 내 디스트리뷰션 데이 수 — fetch 실패/데이터 부족 시 null */
  count: number | null;
  severity: MarketDistributionSeverity;
}

interface UseMarketDistributionDaysOptions {
  /** 카운트 윈도우 거래일 수 (기본 13, 오닐 표준) */
  windowDays?: number;
  /** 거래량 / 50일 평균 비율 임계 (기본 1.5) */
  volumeRatioThreshold?: number;
  /** 캐시 TTL (기본 1시간) */
  cacheTtlMs?: number;
  /** fetch 트리거. 변경되면 강제 재조회 (시세 업데이트 동기화용) — undefined면 마운트 시 1회 */
  refreshKey?: string | number;
}

interface CacheEntry {
  data: MarketDistributionEntry[];
  fetchedAt: number;
  refreshKey: string | number | undefined;
}

const DEFAULT_WINDOW_DAYS = 13;
const DEFAULT_VOLUME_RATIO = 1.5;
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1시간
const FETCH_LOOKBACK_DAYS = 120; // 카운트 윈도우(13) + 50일 평균 워밍업 + 여유

let cache: CacheEntry | null = null;

function severityFor(count: number | null): MarketDistributionSeverity {
  if (count === null) return 'safe';
  if (count >= 5) return 'exit';
  if (count === 4) return 'warning';
  if (count === 3) return 'attention';
  return 'safe';
}

/** 시계열 dict → 정렬 배열 (sortedDates 기준, 값 없으면 null) */
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

export function useMarketDistributionDays(
  options: UseMarketDistributionDaysOptions = {}
): { data: MarketDistributionEntry[]; isLoading: boolean } {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const ratio = options.volumeRatioThreshold ?? DEFAULT_VOLUME_RATIO;
  const cacheTtl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const refreshKey = options.refreshKey;

  const [data, setData] = useState<MarketDistributionEntry[]>(() => {
    if (cache && cache.refreshKey === refreshKey && Date.now() - cache.fetchedAt < cacheTtl) {
      return cache.data;
    }
    return MARKET_INDEX_DEFS.map(d => ({
      ticker: d.ticker,
      name: d.name,
      count: null,
      severity: 'safe' as const,
    }));
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (cache && cache.refreshKey === refreshKey && Date.now() - cache.fetchedAt < cacheTtl) {
      setData(cache.data);
      return;
    }

    let aborted = false;
    setIsLoading(true);

    const run = async () => {
      try {
        const tickers = MARKET_INDEX_DEFS.map(d => d.ticker);
        const results = await fetchMarketIndicesOHLCV(tickers, FETCH_LOOKBACK_DAYS);
        if (aborted) return;

        const entries: MarketDistributionEntry[] = MARKET_INDEX_DEFS.map(def => {
          const entry = results[def.ticker];
          const priceData = entry?.data;
          if (!priceData || Object.keys(priceData).length === 0) {
            return { ticker: def.ticker, name: def.name, count: null, severity: 'safe' };
          }
          const sortedDates = Object.keys(priceData).sort();
          const closes = sortedDates.map(d => priceData[d]);
          const opens = alignSeries(sortedDates, entry.open);
          const highs = alignSeries(sortedDates, entry.high);
          const lows = alignSeries(sortedDates, entry.low);
          const volumes = alignSeries(sortedDates, entry.volume);

          const meta = buildDistributionMeta(opens, highs, lows, closes, volumes, {
            metaLength: windowDays,
            volumeAvgPeriod: 50,
          });
          const count = countDistributionDays(meta, windowDays, ratio);
          return { ticker: def.ticker, name: def.name, count, severity: severityFor(count) };
        });

        cache = { data: entries, fetchedAt: Date.now(), refreshKey };
        setData(entries);
      } catch (err) {
        if (!aborted) log.error('compute error:', err);
      } finally {
        if (!aborted) setIsLoading(false);
      }
    };

    run();

    return () => {
      aborted = true;
    };
  }, [windowDays, ratio, cacheTtl, refreshKey]);

  return { data, isLoading };
}
