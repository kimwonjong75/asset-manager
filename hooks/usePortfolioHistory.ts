import { useEffect } from 'react';
import { Asset, Currency, ExchangeRates, PortfolioSnapshot } from '../types';

interface UsePortfolioHistoryProps {
  assets: Asset[];
  exchangeRates: ExchangeRates;
  setPortfolioHistory: React.Dispatch<React.SetStateAction<PortfolioSnapshot[]>>;
}

// 매수가를 KRW로 변환 - usePortfolioCalculator와 동일한 로직
const getPurchaseValueInKRW = (asset: Asset, exchangeRates: ExchangeRates): number => {
  // KRW 자산은 그대로 반환
  if (asset.currency === Currency.KRW) {
    return asset.purchasePrice;
  }
  
  // 구매 당시 환율이 있으면 사용 (우선)
  if (asset.purchaseExchangeRate && asset.purchaseExchangeRate > 0) {
    return asset.purchasePrice * asset.purchaseExchangeRate;
  }
  
  // 구매 환율이 없으면 현재 환율로 폴백 (기존 자산 호환성)
  const rate = exchangeRates[asset.currency] || 0;
  return asset.purchasePrice * rate;
};

export const usePortfolioHistory = ({ assets, exchangeRates, setPortfolioHistory }: UsePortfolioHistoryProps) => {
  useEffect(() => {
    const updatePortfolioHistory = () => {
      if (assets.length === 0) return;
      const today = new Date().toISOString().slice(0, 10);
      const newAssetSnapshots = assets.map(asset => {
        const rate = asset.currency === Currency.KRW ? 1 : (exchangeRates[asset.currency] || 0);
        const currentValueKRW = asset.currentPrice * asset.quantity * rate;
        
        // [수정] usePortfolioCalculator와 동일한 로직 사용
        const purchasePriceKRW = getPurchaseValueInKRW(asset, exchangeRates);
        const purchaseValueKRW = purchasePriceKRW * asset.quantity;
        
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