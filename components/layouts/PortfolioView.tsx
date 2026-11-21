import React, { useMemo } from 'react';
import PortfolioTable from '../PortfolioTable';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { matchesOwnerFilter, OWNER_FILTER_OPTIONS, OWNER_FILTER_LABELS } from '../../types/owner';
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
      <div className="mb-2 flex items-center gap-2 md:hidden" role="group" aria-label="보유자산 계정 선택">
        <span className="text-xs text-gray-400">계정</span>
        {OWNER_FILTER_OPTIONS.map(owner => (
          <button key={owner} type="button" aria-pressed={ui.accountView === owner}
            onClick={() => actions.setAccountView(owner)}
            className={`focus-ring min-h-9 rounded px-3 text-sm ${ui.accountView === owner ? 'bg-primary text-white' : 'bg-gray-800 text-gray-300'}`}>
            {OWNER_FILTER_LABELS[owner]}
          </button>
        ))}
      </div>
        <PortfolioTable
          assets={filteredAssets}
          history={portfolioHistory}
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
          failedIds={status.failedAssetIds}
          exchangeRates={exchangeRates}
        />
    </div>
  );
};

export default PortfolioView;
