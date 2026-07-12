import React, { useMemo } from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { getCategoryName } from '../../types/category';
import { matchesOwnerFilter } from '../../types/owner';
import { getAssetBucket, BUCKET_LABELS } from '../../types/bucket';
import { usePortfolioCalculator } from '../../hooks/usePortfolioCalculator';
import { useGlobalPeriodDays } from '../../hooks/useGlobalPeriodDays';

// Dashboard Components
import DashboardControls from '../dashboard/DashboardControls';
import DashboardStats from '../dashboard/DashboardStats';
import SoldAssetsStats from '../dashboard/SoldAssetsStats';
import ProfitLossChart from '../dashboard/ProfitLossChart';
import AllocationChart from '../dashboard/AllocationChart';
import CategorySummaryTable from '../dashboard/CategorySummaryTable';
import RebalancingTable from '../dashboard/RebalancingTable';
import MarketOverviewBar from '../dashboard/MarketOverviewBar';
import MarketDistributionBanner from '../MarketDistributionBanner';
import RiskCalculatorCard from '../dashboard/RiskCalculatorCard';
import GuruSignalCard from '../dashboard/GuruSignalCard';
import ReferenceIndicatorsSection from '../dashboard/ReferenceIndicatorsSection';

const DashboardView: React.FC = () => {
  const { data, ui, actions, derived } = usePortfolio();
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


  // 계정 뷰 필터 (통합/원종/유선) — 표시 계층 전용. 매도통계(allSellRecords)와 리밸런싱은
  // 의도적으로 원본 assets 사용: 매도통계는 SellRecord에 owner가 없어 통합 기준(1차 한계),
  // 리밸런싱은 뷰와 무관하게 항상 전략 대상(원종)만 계산(useRebalancing 내부 필터).
  const viewAssets = useMemo(
    () => assets.filter(a => matchesOwnerFilter(a, ui.accountView)),
    [assets, ui.accountView]
  );

  // 자산구분 필터 — 카테고리는 코어 버킷의 배분 축, 투더문은 카테고리와 무관한 덩어리 취급:
  //   숫자 = 코어 버킷의 해당 카테고리만 / 'SATELLITE' = 투더문 버킷 전체 (배분 차트·자산군별 요약과 동일 분해)
  const dashboardFilteredAssets = useMemo(() => {
      if (dashboardFilterCategory === 'ALL') {
          return viewAssets;
      }
      if (dashboardFilterCategory === 'SATELLITE') {
          return viewAssets.filter(asset => getAssetBucket(asset) === 'SATELLITE');
      }
      return viewAssets.filter(asset => asset.categoryId === dashboardFilterCategory && getAssetBucket(asset) === 'CORE');
  }, [viewAssets, dashboardFilterCategory]);

  // Use hook for dashboard specific stats (filtered)
  const { 
    totalValue: dashboardTotalValue, 
    totalPurchaseValue: dashboardTotalPurchaseValue, 
    totalGainLoss: dashboardTotalGainLoss, 
    totalReturn: dashboardTotalReturn 
  } = useMemo(() => calculatePortfolioStats(dashboardFilteredAssets, exchangeRates), [dashboardFilteredAssets, exchangeRates, calculatePortfolioStats]);

  // 계정 뷰 기준 총 평가액 — 카테고리 비중 분모 (derived.totalValue는 통합 기준이라 뷰 선택 시 어긋남)
  const viewTotalValue = useMemo(
    () => calculatePortfolioStats(viewAssets, exchangeRates).totalValue,
    [viewAssets, exchangeRates, calculatePortfolioStats]
  );

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
      const catName = dashboardFilterCategory === 'SATELLITE'
        ? BUCKET_LABELS.SATELLITE
        : getCategoryName(dashboardFilterCategory, data.categoryStore.categories);
      return `${catName} 손익 추이 분석`;
  }, [dashboardFilterCategory, data.categoryStore.categories]);

  return (
    <div className="space-y-6">
      <MarketDistributionBanner />

      <DashboardControls
        assets={viewAssets}
        filterCategory={dashboardFilterCategory}
        onFilterChange={(cat) => setDashboardFilterCategory(cat)}
      />

      <DashboardStats
        totalValue={dashboardTotalValue}
        totalPurchaseValue={dashboardTotalPurchaseValue}
        totalGainLoss={dashboardTotalGainLoss}
        totalReturn={dashboardTotalReturn}
      />

      <MarketOverviewBar />

      {/* 리스크 계산기(평소 접힘). */}
      <RiskCalculatorCard />

      {/*
        구루 신호 엔진 — 항상 상단 위치 유지(Phase 5). 강조 토글이 켜지면 기존처럼 펼쳐 표시,
        꺼지면 같은 자리에서 접힌 상태로 표시(접힘/펼침은 localStorage 영속). 계산/발화 무변경.
      */}
      <GuruSignalCard
        collapsible={!ui.signalDisplay.showGuruSignalsProminently}
        defaultCollapsed
        storageKey="asset-manager-guru-card-open"
      />

      {/* 참고 지표(리스크 매트릭스 등) — 구루 신호 엔진 바로 아래. 구루 카드는 중복 제외. */}
      <ReferenceIndicatorsSection />

      <SoldAssetsStats stats={soldAssetsStats} globalPeriod={ui.globalPeriod} onPeriodChange={actions.setGlobalPeriod} />

      {/* 손익 추이 분석 — 기본 접힘(Phase 5 UX). 계산/차트 로직 불변, 렌더 상태만. */}
      <ProfitLossChart
        history={portfolioHistory}
        assetsToDisplay={dashboardFilteredAssets}
        title={profitLossChartTitle}
        globalPeriod={ui.globalPeriod}
        onPeriodChange={actions.setGlobalPeriod}
        collapsible
        defaultCollapsed
        storageKey="asset-manager-profitloss-open"
      />
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="lg:col-span-1">
          <AllocationChart assets={viewAssets} exchangeRates={exchangeRates} />
        </div>
        <div className="lg:col-span-1">
           <CategorySummaryTable
            assets={viewAssets}
            totalPortfolioValue={viewTotalValue}
            exchangeRates={exchangeRates}
           />
        </div>
      </div>
      
      <RebalancingTable assets={assets} exchangeRates={exchangeRates} />
    </div>
  );
};

export default DashboardView;
