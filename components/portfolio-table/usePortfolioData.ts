import { useMemo, useState } from 'react';
import { Asset, ExchangeRates } from '../../types';
import { Currency } from '../../types';
import { getAllowedCategories, type CategoryDefinition } from '../../types/category';
import { PortfolioTableProps, SortKey, SortDirection, AssetMetrics, EnrichedAsset } from '../../types/ui';
import { usePortfolioCalculator } from '../../hooks/usePortfolioCalculator';
import type { EnrichedIndicatorData } from '../../hooks/useEnrichedIndicators';

interface UsePortfolioDataProps {
  assets: Asset[];
  exchangeRates: ExchangeRates;
  categories: CategoryDefinition[];
  filterAlerts: boolean;
  sellAlertDropRate: number;
  showFailedOnly: boolean;
  failedIds?: Set<string>;
  enrichedMap?: Map<string, EnrichedIndicatorData>;
  maShortPeriod?: number;
  maLongPeriod?: number;
}

export const usePortfolioData = ({
  assets,
  exchangeRates,
  categories,
  filterAlerts,
  sellAlertDropRate,
  showFailedOnly,
  failedIds,
  enrichedMap,
  maShortPeriod,
  maLongPeriod
}: UsePortfolioDataProps) => {
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection } | null>(null);
  const { calculatePortfolioStats, calculateAssetMetrics } = usePortfolioCalculator();

  const totalValueKRW = useMemo(() => {
    const stats = calculatePortfolioStats(assets, exchangeRates);
    return stats.totalValue;
  }, [assets, exchangeRates, calculatePortfolioStats]);

  const categoryOptions = useMemo(() => {
    const allowed = getAllowedCategories(categories);
    const allowedIds = new Set(allowed.map(c => c.id));
    const assetCatIds = new Set(assets.map(a => a.categoryId));
    const extras = categories.filter(c => assetCatIds.has(c.id) && !allowedIds.has(c.id));
    return [...allowed, ...extras];
  }, [assets, categories]);

  const enrichedAndSortedAssets = useMemo(() => {
    let enriched: EnrichedAsset[] = assets.map(asset => {
      return calculateAssetMetrics(asset, exchangeRates, totalValueKRW);
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

        // GC/DC 2단계 정렬: 그룹(GC/DC) → 그룹 내 최근 크로스 순
        if (key === 'maCrossDays' && enrichedMap && maShortPeriod != null && maLongPeriod != null) {
          const aCross = enrichedMap.get(a.ticker)?.maCrossDays?.[maShortPeriod]?.[maLongPeriod] ?? null;
          const bCross = enrichedMap.get(b.ticker)?.maCrossDays?.[maShortPeriod]?.[maLongPeriod] ?? null;

          // null은 항상 맨 뒤
          if (aCross === null && bCross === null) return 0;
          if (aCross === null) return 1;
          if (bCross === null) return -1;

          const aIsGC = aCross >= 0;
          const bIsGC = bCross >= 0;

          // 그룹이 다르면: ascending=GC먼저, descending=DC먼저
          if (aIsGC !== bIsGC) {
            if (aIsGC) return direction === 'ascending' ? -1 : 1;
            return direction === 'ascending' ? 1 : -1;
          }

          // 같은 그룹 내: 절대값 작은 것(최근 크로스)이 항상 위
          return Math.abs(aCross) - Math.abs(bCross);
        }

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
  }, [assets, sortConfig, totalValueKRW, exchangeRates, filterAlerts, sellAlertDropRate, showFailedOnly, failedIds, enrichedMap, maShortPeriod, maLongPeriod]);

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
