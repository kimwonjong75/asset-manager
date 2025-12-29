import { useMemo, useState } from 'react';
import { Asset, ExchangeRates, ALLOWED_CATEGORIES, AssetCategory } from '../../types';
import { Currency } from '../../types';
import { getValueInKRW } from './utils';
import { EnrichedAsset, SortKey, SortDirection } from './types';

interface UsePortfolioDataProps {
  assets: Asset[];
  exchangeRates: ExchangeRates;
  filterAlerts: boolean;
  sellAlertDropRate: number;
  showFailedOnly: boolean;
  failedIds?: Set<string>;
}

export const usePortfolioData = ({
  assets,
  exchangeRates,
  filterAlerts,
  sellAlertDropRate,
  showFailedOnly,
  failedIds
}: UsePortfolioDataProps) => {
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection } | null>(null);

  const totalValueKRW = useMemo(() => {
    return assets.reduce((sum, asset) => {
      const valueInOriginalCurrency = asset.currentPrice * asset.quantity;
      return sum + getValueInKRW(valueInOriginalCurrency, asset.currency, exchangeRates);
    }, 0);
  }, [assets, exchangeRates]);

  const categoryOptions = useMemo(() => {
    const extras = Array.from(new Set(assets.map(asset => asset.category))).filter(
      (cat) => !ALLOWED_CATEGORIES.includes(cat) && cat !== AssetCategory.FOREIGN_STOCK
    );
    return [...ALLOWED_CATEGORIES, ...extras];
  }, [assets]);

  const enrichedAndSortedAssets = useMemo(() => {
    let enriched: EnrichedAsset[] = assets.map(asset => {
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
      const purchasePriceKRW = getValueInKRW(asset.purchasePrice, asset.currency, exchangeRates);
      const purchaseValueKRW = purchasePriceKRW * asset.quantity;
      const profitLossKRW = currentValueKRW - purchaseValueKRW;

      // Calculate Return Percentage using KRW values to ensure consistency
      const returnPercentage = purchaseValueKRW === 0 ? 0 : (profitLossKRW / purchaseValueKRW) * 100;

      // Raw values (kept for reference, though mixed currencies may exist)
      const currentValue = asset.currentPrice * asset.quantity;
      const purchaseValue = asset.purchasePrice * asset.quantity;
      const profitLoss = currentValue - purchaseValue;

      // 3. Calculate Yesterday Price in KRW
      const yesterdayPrice = asset.yesterdayPrice || 0;
      let yesterdayPriceKRW: number;

      if (isKRWExchange) {
        if (asset.currency === Currency.USD) {
          // Fix data mismatch: yesterdayPrice is in USD, convert to KRW
          yesterdayPriceKRW = yesterdayPrice * (exchangeRates.USD || 1);
        } else {
          // Currency is KRW, use as is
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

      const allocation = totalValueKRW === 0 ? 0 : (currentValueKRW / totalValueKRW) * 100;
      const dropFromHigh = asset.highestPrice === 0 ? 0 : ((asset.currentPrice - asset.highestPrice) / asset.highestPrice) * 100;
      const diffFromHigh = asset.currentPrice - asset.highestPrice;
      
      return {
        ...asset,
        metrics: {
          purchasePrice: asset.purchasePrice,
          currentPrice: asset.currentPrice,
          currentPriceKRW,
          purchasePriceKRW,
          purchaseValue, currentValue, purchaseValueKRW, currentValueKRW,
          returnPercentage, allocation, dropFromHigh, profitLoss, profitLossKRW,
          diffFromHigh, yesterdayChange, diffFromYesterday,
        }
      };
    });

    if (filterAlerts) {
      enriched = enriched.filter(asset => {
        const alertRate = asset.sellAlertDropRate ?? sellAlertDropRate;
        return asset.metrics.dropFromHigh <= -alertRate;
      });
    }

    if (showFailedOnly && failedIds && failedIds.size > 0) {
      enriched = enriched.filter(asset => failedIds.has(asset.id));
    }

    if (sortConfig !== null) {
      enriched.sort((a, b) => {
        const { key, direction } = sortConfig;
        let aValue: number | string, bValue: number | string;

        if (key === 'name') {
          aValue = (a.customName?.toLowerCase() || a.name.toLowerCase());
          bValue = (b.customName?.toLowerCase() || b.name.toLowerCase());
        } else if (key === 'purchaseDate') {
          aValue = a.purchaseDate; bValue = b.purchaseDate;
        } else if (key === 'quantity') {
          aValue = a.quantity; bValue = b.quantity;
        } else if (key === 'currentPrice') {
          aValue = a.metrics.currentPriceKRW;
          bValue = b.metrics.currentPriceKRW;
        } else if (key === 'purchasePrice') {
          aValue = a.metrics.purchasePriceKRW;
          bValue = b.metrics.purchasePriceKRW;
        } else if (key === 'currentValue') {
           aValue = a.metrics.currentValueKRW;
           bValue = b.metrics.currentValueKRW;
        } else if (key === 'purchaseValue') {
           aValue = a.metrics.purchaseValueKRW;
           bValue = b.metrics.purchaseValueKRW;
        } else {
          aValue = a.metrics[key as keyof typeof a.metrics];
          bValue = b.metrics[key as keyof typeof b.metrics];
        }

        if (aValue < bValue) return direction === 'ascending' ? -1 : 1;
        if (aValue > bValue) return direction === 'ascending' ? 1 : -1;
        return 0;
      });
    }

    return enriched;
  }, [assets, sortConfig, totalValueKRW, exchangeRates, filterAlerts, sellAlertDropRate, showFailedOnly, failedIds]);

  const requestSort = (key: SortKey) => {
    let direction: SortDirection = 'ascending';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };
  
  const toggleReturnSort = () => {
    const s = sortConfig;
    if (!s || (s.key !== 'returnPercentage' && s.key !== 'profitLossKRW')) {
      setSortConfig({ key: 'returnPercentage', direction: 'descending' });
      return;
    }
    if (s.key === 'returnPercentage' && s.direction === 'descending') {
      setSortConfig({ key: 'returnPercentage', direction: 'ascending' });
      return;
    }
    if (s.key === 'returnPercentage' && s.direction === 'ascending') {
      setSortConfig({ key: 'profitLossKRW', direction: 'descending' });
      return;
    }
    if (s.key === 'profitLossKRW' && s.direction === 'descending') {
      setSortConfig({ key: 'profitLossKRW', direction: 'ascending' });
      return;
    }
    setSortConfig(null);
  };

  return {
    enrichedAndSortedAssets,
    sortConfig,
    requestSort,
    toggleReturnSort,
    categoryOptions,
    totalValueKRW
  };
};
