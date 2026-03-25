import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchGoldPremium, GoldPremiumResult } from '../services/goldPremiumService';
import { createLogger } from '../utils/logger';

const log = createLogger('GoldPremium');

const VISIBILITY_COOLDOWN_MS = 10 * 60 * 1000; // 10분

interface UseGoldPremiumOptions {
  usdKrwRate: number;
  enableVisibilityRefresh: boolean;
}

interface UseGoldPremiumReturn {
  data: GoldPremiumResult | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useGoldPremium({
  usdKrwRate,
  enableVisibilityRefresh,
}: UseGoldPremiumOptions): UseGoldPremiumReturn {
  const [data, setData] = useState<GoldPremiumResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetchedAtRef = useRef<number>(0);

  const refresh = useCallback(async () => {
    if (!usdKrwRate || usdKrwRate <= 0) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchGoldPremium(usdKrwRate);
      setData(result);
      lastFetchedAtRef.current = Date.now();
    } catch (e) {
      setError('금 가격 조회 실패');
      log.error(e);
    } finally {
      setLoading(false);
    }
  }, [usdKrwRate]);

  // visibilitychange 리스너 (10분 쿨다운)
  useEffect(() => {
    if (!enableVisibilityRefresh) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (!usdKrwRate || usdKrwRate <= 0) return;

      const elapsed = Date.now() - lastFetchedAtRef.current;
      if (elapsed >= VISIBILITY_COOLDOWN_MS) {
        refresh();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [enableVisibilityRefresh, usdKrwRate, refresh]);

  return { data, loading, error, refresh };
}
