import React, { useMemo } from 'react';
import { Asset } from '../../types';
import PortfolioTable from '../PortfolioTable';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { matchesOwnerFilter } from '../../types/owner';
import { getAssetBucket } from '../../types/bucket';

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
    // 계정 뷰 필터 (통합/원종/유선) — 표시 계층 전용, 원본 data.assets 불변
    if (ui.accountView !== 'ALL') {
      filtered = filtered.filter(asset => matchesOwnerFilter(asset, ui.accountView));
    }
    if (filterCategory === 'SATELLITE') {
      filtered = filtered.filter(asset => getAssetBucket(asset) === 'SATELLITE');
    } else if (filterCategory !== 'ALL') {
      filtered = filtered.filter(asset => asset.categoryId === filterCategory);
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
  }, [assets, ui.accountView, filterCategory, searchQuery]);

  return (
    <div>
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
