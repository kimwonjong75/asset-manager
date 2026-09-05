import { useMemo } from 'react';
import { Asset, ExchangeRates, SellRecord } from '../types';
import { usePortfolioCalculator } from './usePortfolioCalculator';
import type { PLBasis } from '../types/valuation';

interface UsePortfolioStatsProps {
  assets: Asset[];
  sellHistory: SellRecord[];
  exchangeRates: ExchangeRates;
  sellAlertDropRate?: number;
  /** 수익률 기준 — 기본값 없음(필수). 호출부가 반드시 설정값을 넘기게 해 화면 간 기준이 갈리는 것을 막는다. */
  plBasis: PLBasis;
}

export const usePortfolioStats = ({ assets, sellHistory, exchangeRates, sellAlertDropRate = 15, plBasis }: UsePortfolioStatsProps) => {
  const { getValueInKRW, calculatePortfolioStats, calculateSoldAssetsStats, calculateAlertCount } = usePortfolioCalculator(plBasis);

  const { totalValue, totalPurchaseValue, totalGainLoss, totalReturn } = useMemo(
    () => calculatePortfolioStats(assets, exchangeRates),
    [assets, exchangeRates, calculatePortfolioStats]
  );

  const alertCount = useMemo(
    () => calculateAlertCount(assets, sellAlertDropRate),
    [assets, sellAlertDropRate, calculateAlertCount]
  );

  const soldAssetsStats = useMemo(
    () => calculateSoldAssetsStats(sellHistory, assets, exchangeRates),
    [sellHistory, assets, exchangeRates, calculateSoldAssetsStats]
  );

  return {
    totalValue,
    totalPurchaseValue,
    totalGainLoss,
    totalReturn,
    alertCount,
    soldAssetsStats,
    getValueInKRW,
  };
};
