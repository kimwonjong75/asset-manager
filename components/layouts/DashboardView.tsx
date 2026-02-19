import React, { useMemo } from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { getCategoryName } from '../../types/category';
import { usePortfolioCalculator } from '../../hooks/usePortfolioCalculator';
import { useGlobalPeriodDays } from '../../hooks/useGlobalPeriodDays';

// Dashboard Components
import DashboardControls from '../dashboard/DashboardControls';
import DashboardStats from '../dashboard/DashboardStats';
import SoldAssetsStats from '../dashboard/SoldAssetsStats';
import ProfitLossChart from '../dashboard/ProfitLossChart';
import AllocationChart from '../dashboard/AllocationChart';
import CategorySummaryTable from '../dashboard/CategorySummaryTable';
import TopBottomAssets from '../dashboard/TopBottomAssets';
import RebalancingTable from '../dashboard/RebalancingTable';

const DashboardView: React.FC = () => {
  const { data, ui, actions, status, derived } = usePortfolio();
  const assets = data.assets;
  const sellHistory = data.sellHistory;
  const { startDate: periodStart } = useGlobalPeriodDays(ui.globalPeriod);
  const portfolioHistory = useMemo(
    () => data.portfolioHistory.filter(s => s.date >= periodStart),
    [data.portfolioHistory, periodStart]
  );
  const exchangeRates = data.exchangeRates;
  const dashboardFilterCategory = ui.dashboardFilterCategory;
  const setDashboardFilterCategory = actions.setDashboardFilterCategory;
  const alertCount = derived.alertCount;
  
  const { calculatePortfolioStats, calculateSoldAssetsStats } = usePortfolioCalculator();

  const onAlertClick = () => {
    actions.setActiveTab('portfolio');
    actions.setFilterAlerts(true);
  };
  const onRatesChange = actions.setExchangeRates;
  const showExchangeRateWarning = status.showExchangeRateWarning;

  const dashboardFilteredAssets = useMemo(() => {
      if (dashboardFilterCategory === 'ALL') {
          return assets;
      }
      return assets.filter(asset => asset.categoryId === dashboardFilterCategory);
  }, [assets, dashboardFilterCategory]);

  // Use hook for dashboard specific stats (filtered)
  const { 
    totalValue: dashboardTotalValue, 
    totalPurchaseValue: dashboardTotalPurchaseValue, 
    totalGainLoss: dashboardTotalGainLoss, 
    totalReturn: dashboardTotalReturn 
  } = useMemo(() => calculatePortfolioStats(dashboardFilteredAssets, exchangeRates), [dashboardFilteredAssets, exchangeRates, calculatePortfolioStats]);

  // Use hook for sold stats (global)
  const soldAssetsStats = useMemo(() => calculateSoldAssetsStats(sellHistory, assets), [sellHistory, assets, calculateSoldAssetsStats]);

  const profitLossChartTitle = useMemo(() => {
      if (dashboardFilterCategory === 'ALL') return '손익 추이 분석';
      const catName = getCategoryName(dashboardFilterCategory, data.categoryStore.categories);
      return `${catName} 손익 추이 분석`;
  }, [dashboardFilterCategory, data.categoryStore.categories]);

  return (
    <div className="space-y-6">
      <DashboardControls 
        assets={assets}
        filterCategory={dashboardFilterCategory}
        onFilterChange={(cat) => setDashboardFilterCategory(cat)}
        exchangeRates={exchangeRates}
        onRatesChange={onRatesChange}
        showExchangeRateWarning={showExchangeRateWarning}
        alertCount={alertCount}
        onAlertClick={onAlertClick}
      />

      <DashboardStats 
        totalValue={dashboardTotalValue}
        totalPurchaseValue={dashboardTotalPurchaseValue}
        totalGainLoss={dashboardTotalGainLoss}
        totalReturn={dashboardTotalReturn}
      />

      <SoldAssetsStats stats={soldAssetsStats} />

      <ProfitLossChart history={portfolioHistory} assetsToDisplay={dashboardFilteredAssets} title={profitLossChartTitle} />
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="lg:col-span-1">
          <AllocationChart assets={assets} exchangeRates={exchangeRates} />
        </div>
        <div className="lg:col-span-1">
           <CategorySummaryTable 
            assets={assets} 
            totalPortfolioValue={derived.totalValue} 
            exchangeRates={exchangeRates} 
           />
        </div>
      </div>
      
      <RebalancingTable assets={assets} exchangeRates={exchangeRates} />
      
      <TopBottomAssets assets={assets} exchangeRates={exchangeRates} />
    </div>
  );
};

export default DashboardView;
