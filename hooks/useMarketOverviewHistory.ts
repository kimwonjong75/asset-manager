import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchStockHistoricalPrices } from '../services/historicalPriceService';
import { buildMarketOverviewHistory } from '../utils/marketOverviewSeries';
import { MarketOverviewHistory } from '../types/marketOverview';
import { createLogger } from '../utils/logger';

const log = createLogger('MarketOverviewHistory');

/** 차트 기간 프리셋 → 조회 일수(주말·휴장 여유 포함). */
export type OverviewChartPeriod = '1M' | '3M' | '6M' | '1Y';
const PERIOD_DAYS: Record<OverviewChartPeriod, number> = {
  '1M': 40,
  '3M': 100,
  '6M': 190,
  '1Y': 380,
};

/** 차트에 필요한 4종 티커 — 한 번의 /history 호출로 함께 조회. */
const HISTORY_TICKERS = ['KRX-GOLD', 'GC=F', 'USD/KRW', 'JPY/KRW'];

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface UseMarketOverviewHistoryReturn {
  history: MarketOverviewHistory | null;
  loading: boolean;
  error: string | null;
}

/**
 * 시장 요약 차트용 일별 히스토리 훅 (지연 로딩).
 *
 *  · `enabled=false`(차트 접힘)이면 절대 /history 를 호출하지 않는다.
 *  · 최초 펼침(enabled=true)에서만, 그리고 기간 변경 시에만 조회한다.
 *  · 기간별 결과를 메모리 캐시 — 접었다 다시 펴거나 기간을 오갈 때 재요청 없음.
 *  · StrictMode 이중 마운트/중복 요청은 in-flight 키로 차단.
 */
export function useMarketOverviewHistory(
  enabled: boolean,
  period: OverviewChartPeriod,
): UseMarketOverviewHistoryReturn {
  const [history, setHistory] = useState<MarketOverviewHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cacheRef = useRef<Map<OverviewChartPeriod, MarketOverviewHistory>>(new Map());
  const inFlightRef = useRef<OverviewChartPeriod | null>(null);

  const load = useCallback(async (p: OverviewChartPeriod) => {
    const cached = cacheRef.current.get(p);
    if (cached) {
      setHistory(cached);
      setError(null);
      return;
    }
    if (inFlightRef.current === p) return; // 동일 기간 요청 진행 중 — 중복 차단
    inFlightRef.current = p;
    setLoading(true);
    setError(null);
    try {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - PERIOD_DAYS[p]);
      const raw = await fetchStockHistoricalPrices(HISTORY_TICKERS, toISODate(start), toISODate(end));
      const built = buildMarketOverviewHistory(
        raw['KRX-GOLD']?.data,
        raw['GC=F']?.data,
        raw['USD/KRW']?.data,
        raw['JPY/KRW']?.data,
      );
      cacheRef.current.set(p, built);
      setHistory(built);
    } catch (e) {
      log.error(e);
      setError('차트 데이터 조회 실패');
    } finally {
      setLoading(false);
      inFlightRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return; // 접힘 상태 — 요청 0건
    load(period);
  }, [enabled, period, load]);

  return { history, loading, error };
}
