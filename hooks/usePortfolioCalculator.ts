import { useCallback } from 'react';
import { Asset, Currency, ExchangeRates, SellRecord } from '../types';
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

    // 3. Calculate Yesterday Change (Daily Return)
    // API changeRate 우선 사용 (0은 유효값, undefined/null일 때만 폴백)
    let yesterdayChange: number;
    let diffFromYesterday: number;

    if (asset.changeRate != null) {
      yesterdayChange = asset.changeRate * 100;
      const rate = asset.changeRate;
      diffFromYesterday = (1 + rate) !== 0
        ? currentPriceKRW * (rate / (1 + rate))
        : 0;
    } else {
      // 폴백: changeRate 없는 레거시 데이터
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
      yesterdayChange = yesterdayPriceKRW > 0
        ? ((currentPriceKRW - yesterdayPriceKRW) / yesterdayPriceKRW) * 100
        : 0;
      diffFromYesterday = yesterdayPriceKRW > 0
        ? currentPriceKRW - yesterdayPriceKRW
        : 0;
    }

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

  const calculateSoldAssetsStats = useCallback((sellHistory: SellRecord[], assets: Asset[]) => {
    let totalSoldAmount = 0;
    let totalSoldPurchaseValue = 0;
    let totalSoldProfit = 0;
    let soldCount = 0;

    sellHistory.forEach(record => {
      // 매도 금액 합산 (이미 KRW 환산된 값으로 가정)
      const sellAmount = record.sellPrice * record.sellQuantity;
      totalSoldAmount += sellAmount;
      soldCount += 1;
      
      let purchaseValueForSold = 0;
      
      // 1. 저장된 매수 원본 정보가 있는 경우 (신규 로직)
      if (record.originalPurchasePrice && record.originalPurchasePrice > 0) {
        const purchasePrice = record.originalPurchasePrice;
        const purchaseExchangeRate = record.originalPurchaseExchangeRate || 1;
        const currency = record.originalCurrency || Currency.KRW;
        
        if (currency === Currency.KRW) {
             purchaseValueForSold = purchasePrice * record.sellQuantity;
        } else {
             purchaseValueForSold = purchasePrice * purchaseExchangeRate * record.sellQuantity;
        }
      } 
      // 2. 저장된 정보가 없고, 현재 보유 자산 목록에 있는 경우 (기존 로직 호환)
      else {
        const asset = assets.find(a => a.id === record.assetId);
        if (asset) {
            if (asset.currency === Currency.KRW) {
                purchaseValueForSold = asset.purchasePrice * record.sellQuantity;
            } else if (asset.purchaseExchangeRate) {
                purchaseValueForSold = asset.purchasePrice * asset.purchaseExchangeRate * record.sellQuantity;
            } else if (asset.priceOriginal > 0) {
                 const exchangeRate = asset.currentPrice / asset.priceOriginal;
                 purchaseValueForSold = asset.purchasePrice * exchangeRate * record.sellQuantity;
            } else {
                 purchaseValueForSold = asset.purchasePrice * record.sellQuantity;
            }
        } else {
            // 3. 자산도 삭제되고 이력에 매수 정보도 없는 경우
            // 수익을 계산할 수 없으므로 매수금액 = 매도금액으로 처리하여 수익 0으로 잡음 (데이터 왜곡 방지)
            purchaseValueForSold = sellAmount;
        }
      }
      
      totalSoldPurchaseValue += purchaseValueForSold;
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