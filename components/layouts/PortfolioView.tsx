import React, { useMemo } from 'react';
import { Asset } from '../../types';
import PortfolioTable from '../PortfolioTable';
import { usePortfolio } from '../../contexts/PortfolioContext';

const PortfolioView: React.FC = () => {
  const { data, ui, actions, status } = usePortfolio();
  const assets = data.assets;
  const portfolioHistory = data.portfolioHistory;
  const exchangeRates = data.exchangeRates;
  const filterCategory = ui.filterCategory;
  const filterAlerts = ui.filterAlerts;
  const searchQuery = ui.searchQuery;
  const sellAlertDropRate = ui.sellAlertDropRate;
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
        <PortfolioTable
          assets={filteredAssets}
          history={portfolioHistory}
          onRefreshAll={() => actions.refreshAllPrices(false)}
          onRefreshSelected={actions.refreshSelectedPrices}
          onRefreshOne={actions.refreshOnePrice}
          onEdit={actions.openEditModal}
          onSell={actions.openSellModal}
          onBuy={actions.openBuyModal}
          isLoading={status.isLoading}
          sellAlertDropRate={sellAlertDropRate}
          onSellAlertDropRateChange={actions.setSellAlertDropRate}
          filterCategory={filterCategory}
          onFilterChange={actions.setFilterCategory}
          filterAlerts={filterAlerts}
          onFilterAlertsChange={actions.setFilterAlerts}
          searchQuery={searchQuery}
          onSearchChange={actions.setSearchQuery}
          onAddSelectedToWatchlist={(assets: Asset[]) => actions.addSelectedToWatchlist(assets)}
          failedIds={new Set(status.failedAssetIds)}
          exchangeRates={exchangeRates}
        />
    </div>
  );
};

export default PortfolioView;
