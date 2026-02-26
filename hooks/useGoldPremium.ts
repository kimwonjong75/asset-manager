import { useState, useEffect, useCallback } from 'react';
import { usePortfolio } from '../contexts/PortfolioContext';
import { fetchGoldPremium, GoldPremiumResult } from '../services/goldPremiumService';

interface UseGoldPremiumReturn {
  data: GoldPremiumResult | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useGoldPremium(): UseGoldPremiumReturn {
  const { data: portfolioData } = usePortfolio();
  const usdKrwRate = portfolioData.exchangeRates.USD;

  const [data, setData] = useState<GoldPremiumResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!usdKrwRate || usdKrwRate <= 0) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchGoldPremium(usdKrwRate);
      setData(result);
    } catch (e) {
      setError('금 가격 조회 실패');
      console.error('[useGoldPremium]', e);
    } finally {
      setLoading(false);
    }
  }, [usdKrwRate]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
