import { useEffect } from 'react';
import { Asset, Currency, ExchangeRates, PortfolioSnapshot } from '../types';

interface UsePortfolioHistoryProps {
  assets: Asset[];
  exchangeRates: ExchangeRates;
  setPortfolioHistory: React.Dispatch<React.SetStateAction<PortfolioSnapshot[]>>;
}

export const usePortfolioHistory = ({ assets, exchangeRates, setPortfolioHistory }: UsePortfolioHistoryProps) => {
  useEffect(() => {
    const updatePortfolioHistory = () => {
      if (assets.length === 0) return;
      const today = new Date().toISOString().slice(0, 10);
      const newAssetSnapshots = assets.map(asset => {
        const rate = asset.currency === Currency.KRW ? 1 : (exchangeRates[asset.currency] || 0);
        const currentValueKRW = asset.currentPrice * asset.quantity * rate;
        let purchaseValueKRW: number;
        if (asset.currency === Currency.KRW) {
          purchaseValueKRW = asset.purchasePrice * asset.quantity;
        } else if (asset.purchaseExchangeRate) {
          purchaseValueKRW = asset.purchasePrice * asset.purchaseExchangeRate * asset.quantity;
        } else if (asset.priceOriginal > 0) {
          const exchangeRate = asset.currentPrice / asset.priceOriginal;
          purchaseValueKRW = asset.purchasePrice * exchangeRate * asset.quantity;
        } else {
          purchaseValueKRW = asset.purchasePrice * asset.quantity;
        }
        const unitPriceKRW = asset.currentPrice * rate;
        return {
          id: asset.id,
          name: (asset.customName?.trim() || asset.name),
          currentValue: currentValueKRW,
          purchaseValue: purchaseValueKRW,
          unitPrice: unitPriceKRW,
        };
      });
      const newSnapshot = { date: today, assets: newAssetSnapshots };
      setPortfolioHistory(prevHistory => {
        const todayIndex = prevHistory.findIndex(snap => snap.date === today);
        let updatedHistory;
        if (todayIndex > -1) {
          updatedHistory = [...prevHistory];
          updatedHistory[todayIndex] = newSnapshot;
        } else {
          updatedHistory = [...prevHistory, newSnapshot];
        }
        if (updatedHistory.length > 365) {
          updatedHistory = updatedHistory.slice(updatedHistory.length - 365);
        }
        return updatedHistory;
      });
    };
    updatePortfolioHistory();
  }, [assets, exchangeRates, setPortfolioHistory]);
};
