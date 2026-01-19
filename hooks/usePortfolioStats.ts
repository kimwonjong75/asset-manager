import { useMemo } from 'react';
import { Asset, ExchangeRates, SellRecord } from '../types';
import { usePortfolioCalculator } from './usePortfolioCalculator';

interface UsePortfolioStatsProps {
  assets: Asset[];
  sellHistory: SellRecord[];
  exchangeRates: ExchangeRates;
  sellAlertDropRate?: number;
}

export const usePortfolioStats = ({ assets, sellHistory, exchangeRates, sellAlertDropRate = 15 }: UsePortfolioStatsProps) => {
  const { getValueInKRW, calculatePortfolioStats, calculateSoldAssetsStats, calculateAlertCount } = usePortfolioCalculator();

  const { totalValue, totalPurchaseValue, totalGainLoss, totalReturn } = useMemo(
    () => calculatePortfolioStats(assets, exchangeRates),
    [assets, exchangeRates, calculatePortfolioStats]
  );

  const alertCount = useMemo(
    () => calculateAlertCount(assets, sellAlertDropRate),
    [assets, sellAlertDropRate, calculateAlertCount]
  );

  const soldAssetsStats = useMemo(
    () => calculateSoldAssetsStats(sellHistory, assets),
    [sellHistory, assets, calculateSoldAssetsStats]
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
