import React, { useMemo } from 'react';
import { Asset, AssetCategory, ExchangeRates, PortfolioSnapshot } from '../../types';
import PortfolioTable from '../PortfolioTable';
import SellAlertControl from '../SellAlertControl';

interface PortfolioViewProps {
  assets: Asset[];
  portfolioHistory: PortfolioSnapshot[];
  exchangeRates: ExchangeRates;
  filterCategory: AssetCategory | 'ALL';
  setFilterCategory: (cat: AssetCategory | 'ALL') => void;
  filterAlerts: boolean;
  setFilterAlerts: (active: boolean) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  sellAlertDropRate: number;
  setSellAlertDropRate: (rate: number) => void;
  isLoading: boolean;
  failedAssetIds: Set<string>;
  
  // Actions
  onRefreshAll: () => void;
  onRefreshSelected: (ids: string[]) => void;
  onRefreshOne: (id: string) => void;
  onEdit: (asset: Asset) => void;
  onSell: (asset: Asset) => void;
  onAddSelectedToWatchlist: (assets: Asset[]) => void;
}

const PortfolioView: React.FC<PortfolioViewProps> = ({
  assets,
  portfolioHistory,
  exchangeRates,
  filterCategory,
  setFilterCategory,
  filterAlerts,
  setFilterAlerts,
  searchQuery,
  setSearchQuery,
  sellAlertDropRate,
  setSellAlertDropRate,
  isLoading,
  failedAssetIds,
  onRefreshAll,
  onRefreshSelected,
  onRefreshOne,
  onEdit,
  onSell,
  onAddSelectedToWatchlist
}) => {
  const filteredAssets = useMemo(() => {
    let filtered = assets;
    if (filterCategory !== 'ALL') {
      filtered = filtered.filter(asset => asset.category === filterCategory);
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(asset => 
        ((asset.customName?.toLowerCase() || asset.name.toLowerCase()).includes(query)) ||
        asset.ticker.toLowerCase().includes(query) ||
        (asset.memo && asset.memo.toLowerCase().includes(query))
      );
    }
    return filtered;
  }, [assets, filterCategory, searchQuery]);

  return (
    <div className="space-y-6">
       <SellAlertControl value={sellAlertDropRate} onChange={setSellAlertDropRate} />
        <PortfolioTable
          assets={filteredAssets}
          history={portfolioHistory}
          onRefreshAll={onRefreshAll}
          onRefreshSelected={onRefreshSelected}
          onRefreshOne={onRefreshOne}
          onEdit={onEdit}
          onSell={onSell}
          isLoading={isLoading}
          sellAlertDropRate={sellAlertDropRate}
          filterCategory={filterCategory}
          onFilterChange={setFilterCategory}
          filterAlerts={filterAlerts}
          onFilterAlertsChange={setFilterAlerts}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onAddSelectedToWatchlist={onAddSelectedToWatchlist}
          failedIds={failedAssetIds}
          exchangeRates={exchangeRates}
        />
    </div>
  );
};

export default PortfolioView;
