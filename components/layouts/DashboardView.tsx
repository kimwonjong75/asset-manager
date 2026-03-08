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
import GoldPremiumWidget from '../GoldPremiumWidget';

const DashboardView: React.FC = () => {
  const { data, ui, actions, status, derived } = usePortfolio();
  const assets = data.assets;
  const sellHistory = data.sellHistory;
  const { startDate: periodStart, endDate: periodEnd } = useGlobalPeriodDays(ui.globalPeriod);
  const portfolioHistory = useMemo(
    () => data.portfolioHistory.filter(s => s.date >= periodStart && s.date <= periodEnd),
    [data.portfolioHistory, periodStart, periodEnd]
  );
  const exchangeRates = data.exchangeRates;
  const dashboardFilterCategory = ui.dashboardFilterCategory;
  const setDashboardFilterCategory = actions.setDashboardFilterCategory;
  const { calculatePortfolioStats, calculateSoldAssetsStats } = usePortfolioCalculator();

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

  // sellHistory + 인라인 sellTransactions 병합 (수익통계와 동일한 데이터 소스)
  const allSellRecords = useMemo(() => {
    const sellHistoryIds = new Set(sellHistory.map(r => r.id));
    const inlineRecords: typeof sellHistory = [];
    assets.forEach(a => {
      if (a.sellTransactions && a.sellTransactions.length > 0) {
        a.sellTransactions.forEach(t => {
          if (!sellHistoryIds.has(t.id)) {
            inlineRecords.push({
              assetId: a.id,
              ticker: a.ticker,
              name: a.name,
              categoryId: a.categoryId,
              ...t,
            });
          }
        });
      }
    });
    return [...sellHistory, ...inlineRecords];
  }, [sellHistory, assets]);

  // 기간 필터 적용
  const filteredSellHistory = useMemo(
    () => allSellRecords.filter(r => r.sellDate >= periodStart && r.sellDate <= periodEnd),
    [allSellRecords, periodStart, periodEnd]
  );
  const soldAssetsStats = useMemo(() => calculateSoldAssetsStats(filteredSellHistory, assets), [filteredSellHistory, assets, calculateSoldAssetsStats]);

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
      />

      <DashboardStats
        totalValue={dashboardTotalValue}
        totalPurchaseValue={dashboardTotalPurchaseValue}
        totalGainLoss={dashboardTotalGainLoss}
        totalReturn={dashboardTotalReturn}
      />

      <GoldPremiumWidget />

      <SoldAssetsStats stats={soldAssetsStats} globalPeriod={ui.globalPeriod} onPeriodChange={actions.setGlobalPeriod} />

      <ProfitLossChart history={portfolioHistory} assetsToDisplay={dashboardFilteredAssets} title={profitLossChartTitle} globalPeriod={ui.globalPeriod} onPeriodChange={actions.setGlobalPeriod} />
      
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
