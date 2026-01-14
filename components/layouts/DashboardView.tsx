import React, { useMemo } from 'react';
import { AssetCategory } from '../../types';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { usePortfolioCalculator } from '../../hooks/usePortfolioCalculator';

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
  const portfolioHistory = data.portfolioHistory;
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
      return assets.filter(asset => asset.category === dashboardFilterCategory);
  }, [assets, dashboardFilterCategory]);

  // Use hook for dashboard specific stats (filtered)
  const { 
    totalValue: dashboardTotalValue, 
    totalPurchaseValue: dashboardTotalPurchaseValue, 
    totalGainLoss: dashboardTotalGainLoss, 
    totalReturn: dashboardTotalReturn 
  } = useMemo(() => calculatePortfolioStats(dashboardFilteredAssets, exchangeRates), [dashboardFilteredAssets, exchangeRates, calculatePortfolioStats]);

  // Use hook for sold stats (global)
  const soldAssetsStats = useMemo(() => calculateSoldAssetsStats(assets), [assets, calculateSoldAssetsStats]);

  const profitLossChartTitle = useMemo(() => (
      dashboardFilterCategory === 'ALL'
      ? '손익 추이 분석'
      : `${dashboardFilterCategory} 손익 추이 분석`
  ), [dashboardFilterCategory]);

  return (
    <div className="space-y-6">
      <DashboardControls 
        assets={assets}
        filterCategory={dashboardFilterCategory}
        onFilterChange={(cat) => setDashboardFilterCategory(cat as AssetCategory | 'ALL')}
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
