import { useCallback } from 'react';
import { Asset, Currency, ExchangeRates } from '../types';
import { AssetMetrics, EnrichedAsset } from '../types/ui';

export const usePortfolioCalculator = () => {
  
  const getValueInKRW = useCallback((value: number, currency: Currency, exchangeRates: ExchangeRates): number => {
    switch (currency) {
      case Currency.USD: return value * (exchangeRates.USD || 0);
      case Currency.JPY: return value * (exchangeRates.JPY || 0);
      case Currency.KRW: default: return value;
    }
  }, []);

  // [신규] 매수가를 KRW로 변환 - 구매 당시 환율 우선 사용
  const getPurchaseValueInKRW = useCallback((asset: Asset, exchangeRates: ExchangeRates): number => {
    // KRW 자산은 그대로 반환
    if (asset.currency === Currency.KRW) {
      return asset.purchasePrice;
    }
    
    // 구매 당시 환율이 있으면 사용 (우선)
    if (asset.purchaseExchangeRate && asset.purchaseExchangeRate > 0) {
      return asset.purchasePrice * asset.purchaseExchangeRate;
    }
    
    // 구매 환율이 없으면 현재 환율로 폴백 (기존 로직 유지)
    return getValueInKRW(asset.purchasePrice, asset.currency, exchangeRates);
  }, [getValueInKRW]);

  const calculateAssetMetrics = useCallback((asset: Asset, exchangeRates: ExchangeRates, totalPortfolioValue: number = 0): EnrichedAsset => {
    // 1. isKRWExchange: Check if exchange is Upbit or Bithumb
    const isKRWExchange = asset.exchange === 'Upbit' || asset.exchange === 'Bithumb';

    // 2. Calculate Current Price in KRW
    let currentPriceKRW: number;
    if (isKRWExchange) {
      // If Upbit/Bithumb, API returns KRW even if asset is set to USD
      currentPriceKRW = asset.currentPrice;
    } else {
      currentPriceKRW = getValueInKRW(asset.currentPrice, asset.currency, exchangeRates);
    }

    const currentValueKRW = currentPriceKRW * asset.quantity;
    
    // [수정] 매수가는 구매 당시 환율 사용
    const purchasePriceKRW = getPurchaseValueInKRW(asset, exchangeRates);
    const purchaseValueKRW = purchasePriceKRW * asset.quantity;
    const profitLossKRW = currentValueKRW - purchaseValueKRW;

    // Calculate Return Percentage using KRW values to ensure consistency
    const returnPercentage = purchaseValueKRW === 0 ? 0 : (profitLossKRW / purchaseValueKRW) * 100;

    // Raw values (외화 기준 - 개별 자산 표시용)
    const currentValue = asset.currentPrice * asset.quantity;
    const purchaseValue = asset.purchasePrice * asset.quantity;
    const profitLoss = currentValue - purchaseValue;

    // 3. Calculate Yesterday Price in KRW
    const yesterdayPrice = asset.previousClosePrice || 0;
    let yesterdayPriceKRW: number;

    if (isKRWExchange) {
      if (asset.currency === Currency.USD) {
        yesterdayPriceKRW = yesterdayPrice * (exchangeRates.USD || 1);
      } else {
        yesterdayPriceKRW = yesterdayPrice;
      }
    } else {
      yesterdayPriceKRW = getValueInKRW(yesterdayPrice, asset.currency, exchangeRates);
    }

    // 4. Calculate Yesterday Change (Daily Return)
    const yesterdayChange = yesterdayPriceKRW > 0 
      ? ((currentPriceKRW - yesterdayPriceKRW) / yesterdayPriceKRW) * 100 
      : 0;
      
    const diffFromYesterday = yesterdayPriceKRW > 0 
      ? currentPriceKRW - yesterdayPriceKRW 
      : 0;

    const allocation = totalPortfolioValue === 0 ? 0 : (currentValueKRW / totalPortfolioValue) * 100;
    const dropFromHigh = asset.highestPrice === 0 ? 0 : ((asset.currentPrice - asset.highestPrice) / asset.highestPrice) * 100;
    const diffFromHigh = asset.currentPrice - asset.highestPrice;
    
    const metrics: AssetMetrics = {
      purchasePrice: asset.purchasePrice,
      currentPrice: asset.currentPrice,
      currentPriceKRW,
      purchasePriceKRW,
      purchaseValue, currentValue, purchaseValueKRW, currentValueKRW,
      returnPercentage, allocation, dropFromHigh, profitLoss, profitLossKRW,
      diffFromHigh, yesterdayChange, diffFromYesterday,
    };

    return {
      ...asset,
      metrics
    };
  }, [getValueInKRW, getPurchaseValueInKRW]);

  const calculatePortfolioStats = useCallback((assets: Asset[], exchangeRates: ExchangeRates) => {
    let totalValue = 0;
    let totalPurchaseValue = 0;

    // First pass to calculate totals
    const processedAssets = assets.map(asset => {
        const enriched = calculateAssetMetrics(asset, exchangeRates, 0); // Allocation 0 for now
        return enriched;
    });

    totalValue = processedAssets.reduce((sum, asset) => sum + asset.metrics.currentValueKRW, 0);
    totalPurchaseValue = processedAssets.reduce((sum, asset) => sum + asset.metrics.purchaseValueKRW, 0);
    
    const totalGainLoss = totalValue - totalPurchaseValue;
    const totalReturn = totalPurchaseValue === 0 ? 0 : (totalGainLoss / totalPurchaseValue) * 100;

    return {
      totalValue,
      totalPurchaseValue,
      totalGainLoss,
      totalReturn
    };
  }, [calculateAssetMetrics]);

  const calculateSoldAssetsStats = useCallback((assets: Asset[]) => {
    let totalSoldAmount = 0;
    let totalSoldPurchaseValue = 0;
    let totalSoldProfit = 0;
    let soldCount = 0;

    assets.forEach(asset => {
      if (asset.sellTransactions && asset.sellTransactions.length > 0) {
        asset.sellTransactions.forEach(transaction => {
          totalSoldAmount += transaction.sellPrice * transaction.sellQuantity;
          soldCount += 1;
          
          let purchaseValueForSold: number;
          if (asset.currency === Currency.KRW) {
            purchaseValueForSold = asset.purchasePrice * transaction.sellQuantity;
          } else if (asset.purchaseExchangeRate) {
            purchaseValueForSold = asset.purchasePrice * asset.purchaseExchangeRate * transaction.sellQuantity;
          } else if (asset.priceOriginal > 0) {
            const exchangeRate = asset.currentPrice / asset.priceOriginal;
            purchaseValueForSold = asset.purchasePrice * exchangeRate * transaction.sellQuantity;
          } else {
            purchaseValueForSold = asset.purchasePrice * transaction.sellQuantity;
          }
          totalSoldPurchaseValue += purchaseValueForSold;
        });
      }
    });

    totalSoldProfit = totalSoldAmount - totalSoldPurchaseValue;
    const soldReturn = totalSoldPurchaseValue === 0 ? 0 : (totalSoldProfit / totalSoldPurchaseValue) * 100;

    return {
      totalSoldAmount,
      totalSoldPurchaseValue,
      totalSoldProfit,
      soldReturn,
      soldCount,
    };
  }, []);

  const calculateAlertCount = useCallback((assets: Asset[], globalSellAlertDropRate: number) => {
      return assets.filter(asset => {
        if (asset.highestPrice === 0) return false;
        const dropFromHigh = ((asset.currentPrice - asset.highestPrice) / asset.highestPrice) * 100;
        const alertRate = asset.sellAlertDropRate ?? globalSellAlertDropRate;
        return dropFromHigh <= -alertRate;
      }).length;
  }, []);

  return {
    getValueInKRW,
    getPurchaseValueInKRW,
    calculateAssetMetrics,
    calculatePortfolioStats,
    calculateSoldAssetsStats,
    calculateAlertCount
  };
};