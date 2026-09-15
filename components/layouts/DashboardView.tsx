// components/layouts/DashboardView.tsx
// 홈 탭(기본 탭) — Stage A(2026-09-14): 과거 '오늘' 탭 본문(TodayActionCenter)을 상단에 흡수.
// 레이아웃(표시 계층 전용, 계산/발화/저장 불변):
//   · 모바일 1열: 스냅샷 → 오늘의 브리핑 → 시장·데이터 → 손익 추이 → 배분 → 실현 손익 → 자산군 요약 → 전략 점검
//   · md 2열(grid-flow-row-dense): 스냅샷 | 시장 / 브리핑(2칸) / 손익 추이(2칸) / 배분 | 실현 손익 / 자산군(2칸) / 전략(2칸)
//   · xl 12열: 브리핑 1~8열 × 1~2행, 스냅샷 9~12열 1행, 시장 9~12열 2행 / 손익 7 + 배분 5 / 실현 6 + 자산군 6 / 전략 12
// 모든 카드는 계산 범위를 ScopeChip으로 표시한다. 계정 선택(ui.accountView)은 이 화면의 세그먼트가 담당.

import React, { useMemo } from 'react';
import { Info } from 'lucide-react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { getCategoryName } from '../../types/category';
import { matchesOwnerFilter, OWNER_FILTER_OPTIONS, OWNER_FILTER_LABELS } from '../../types/owner';
import { getAssetBucket, BUCKET_LABELS } from '../../types/bucket';
import { usePortfolioCalculator } from '../../hooks/usePortfolioCalculator';
import { useGlobalPeriodDays } from '../../hooks/useGlobalPeriodDays';
import { mergeSellRecords } from '../../utils/sellRecords';
import { actionNeededCount, pendingOrderCounts } from '../../utils/todayViewModel';

// Home / Dashboard Components
import ScopeChip from '../common/ScopeChip';
import TodayActionCenter, { HOME_STRATEGY_SECTION_ID } from '../today/TodayActionCenter';
import HomeSnapshotCard from '../dashboard/HomeSnapshotCard';
import DashboardControls from '../dashboard/DashboardControls';
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
import { TRADE_PLAN_BASIS_NOTE } from '../trade-plan/TradePlanCard';

const ACCOUNT_FILTER_SCOPE_TITLE = '위 계정 선택을 따릅니다. 자산 구분 필터는 적용되지 않습니다.';

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
  const plBasis = data.valuationSettings.plBasis;
  const { calculatePortfolioStats, calculateSoldAssetsStats } = usePortfolioCalculator(plBasis);

  // 계정 뷰 필터 (통합/원종/유선) — 표시 계층 전용. 매도통계(allSellRecords)와 리밸런싱은
  // 의도적으로 원본 assets 사용: 매도통계는 SellRecord에 owner가 없어 통합 기준(1차 한계),
  // 리밸런싱은 뷰와 무관하게 항상 전략 대상(원종)만 계산(useRebalancing 내부 필터).
  const viewAssets = useMemo(
    () => assets.filter(a => matchesOwnerFilter(a, ui.accountView)),
    [assets, ui.accountView]
  );
  const accountLabel = OWNER_FILTER_LABELS[ui.accountView];

  // 자산구분 필터 — 손익 추이 차트에만 적용. 카테고리는 코어 버킷의 배분 축, 투더문은 카테고리와 무관한 덩어리 취급:
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

  // 계정 뷰 기준 통계 — 스냅샷 + 카테고리 비중 분모 (derived.totalValue는 통합 기준이라 뷰 선택 시 어긋남).
  // 자산구분 필터는 스냅샷에 적용하지 않는다(2026-09-14 결정).
  const viewStats = useMemo(
    () => calculatePortfolioStats(viewAssets, exchangeRates),
    [viewAssets, exchangeRates, calculatePortfolioStats]
  );

  // 조치 필요(전체 계정 계획 행, 자산 단위 합집합) / 대기 리밸런싱 주문 수 — 순수 유틸
  const actionNeeded = useMemo(() => actionNeededCount(derived.tradePlanRows), [derived.tradePlanRows]);
  const pendingRebalanceCount = useMemo(() => pendingOrderCounts(data.actionQueue).rebalance, [data.actionQueue]);

  // sellHistory + 인라인 sellTransactions 병합 (수익통계·대청소와 동일한 단일 유틸)
  const allSellRecords = useMemo(() => mergeSellRecords(sellHistory, assets), [sellHistory, assets]);

  // 기간 필터 적용
  const filteredSellHistory = useMemo(
    () => allSellRecords.filter(r => r.sellDate >= periodStart && r.sellDate <= periodEnd),
    [allSellRecords, periodStart, periodEnd]
  );
  // exchangeRates 전달 필수 — 생략하면 기본값(USD 1450)으로 비정상 환율을 보정해 수익통계 탭과 값이 어긋난다
  const soldAssetsStats = useMemo(
    () => calculateSoldAssetsStats(filteredSellHistory, assets, exchangeRates),
    [filteredSellHistory, assets, exchangeRates, calculateSoldAssetsStats]
  );

  const profitLossChartTitle = useMemo(() => {
      if (dashboardFilterCategory === 'ALL') return '손익 추이 분석';
      const catName = dashboardFilterCategory === 'SATELLITE'
        ? BUCKET_LABELS.SATELLITE
        : getCategoryName(dashboardFilterCategory, data.categoryStore.categories);
      return `${catName} 손익 추이 분석`;
  }, [dashboardFilterCategory, data.categoryStore.categories]);

  const accountScopeChip = <ScopeChip label="계정 필터 적용" title={ACCOUNT_FILTER_SCOPE_TITLE} />;

  return (
    <div className="space-y-4 pb-16">
      {/* 페이지 헤드 — 계정 세그먼트(모든 폭에서 표시, 좁으면 가로 스크롤) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="max-w-full overflow-x-auto">
          <div className="inline-flex items-center bg-gray-700 rounded-md p-0.5" role="group" aria-label="계정 선택">
            {OWNER_FILTER_OPTIONS.map(f => (
              <button
                key={f}
                type="button"
                onClick={() => actions.setAccountView(f)}
                aria-pressed={ui.accountView === f}
                className={`min-h-9 text-sm px-3 rounded transition-colors whitespace-nowrap ${
                  ui.accountView === f ? 'bg-primary text-white font-semibold' : 'text-gray-300 hover:text-white'
                }`}
                title={f === 'ALL' ? '모든 계정 자산 표시' : `${OWNER_FILTER_LABELS[f]} 계정 자산만 표시`}
              >
                {OWNER_FILTER_LABELS[f]}
              </button>
            ))}
          </div>
        </div>
        <p className="hidden sm:block text-xs text-gray-500">
          계정 선택은 이 화면 전체에 적용돼요. 따르지 않는 카드는 범위를 표시합니다.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:grid-flow-row-dense xl:grid-cols-12 xl:gap-5 items-start">
        {/* 포트폴리오 스냅샷 */}
        <div className="min-w-0 md:col-span-1 xl:col-span-4 xl:col-start-9 xl:row-start-1">
          <HomeSnapshotCard
            totalValue={viewStats.totalValue}
            totalPurchaseValue={viewStats.totalPurchaseValue}
            totalGainLoss={viewStats.totalGainLoss}
            totalReturn={viewStats.totalReturn}
            accountLabel={accountLabel}
            actionNeeded={actionNeeded}
          />
        </div>

        {/* 오늘의 브리핑 — 유일한 강조 컨테이너 */}
        <div className="min-w-0 md:col-span-2 xl:col-span-8 xl:col-start-1 xl:row-start-1 xl:row-span-2">
          <TodayActionCenter />
        </div>

        {/* 시장 · 데이터 */}
        <section className="min-w-0 md:col-span-1 xl:col-span-4 xl:col-start-9 xl:row-start-2 space-y-2" aria-label="시장 · 데이터">
          <h2 className="text-sm font-semibold text-gray-300">시장 · 데이터</h2>
          <MarketDistributionBanner />
          <MarketOverviewBar />
        </section>

        {/* 손익 추이 — 자산 구분 필터 + 기간 선택(홈의 유일한 기간 컨트롤) */}
        <div className="min-w-0 md:col-span-2 xl:col-span-7">
          <ProfitLossChart
            history={portfolioHistory}
            assetsToDisplay={dashboardFilteredAssets}
            title={profitLossChartTitle}
            globalPeriod={ui.globalPeriod}
            onPeriodChange={actions.setGlobalPeriod}
            plBasis={plBasis}
            collapsible
            defaultCollapsed={false}
            storageKey="asset-manager-profitloss-open"
            headerActions={
              <>
                <DashboardControls
                  assets={viewAssets}
                  filterCategory={dashboardFilterCategory}
                  onFilterChange={(cat) => setDashboardFilterCategory(cat)}
                />
                <ScopeChip label="계정 필터 적용" title="위 계정 선택과 자산 구분 필터를 함께 따릅니다." />
              </>
            }
          />
        </div>

        <div className="min-w-0 md:col-span-1 xl:col-span-5">
          <AllocationChart assets={viewAssets} exchangeRates={exchangeRates} headerExtra={accountScopeChip} />
        </div>

        <div className="min-w-0 md:col-span-1 xl:col-span-6">
          <SoldAssetsStats
            stats={soldAssetsStats}
            globalPeriod={ui.globalPeriod}
            plBasis={plBasis}
            onOpenDetails={() => actions.setActiveTab('analytics')}
          />
        </div>

        <div className="min-w-0 md:col-span-2 xl:col-span-6">
          <CategorySummaryTable
            assets={viewAssets}
            totalPortfolioValue={viewStats.totalValue}
            exchangeRates={exchangeRates}
            headerExtra={accountScopeChip}
          />
        </div>

        {/* 전략 점검 — 접힌 헤더도 건수/요약을 항상 표시 */}
        <section
          id={HOME_STRATEGY_SECTION_ID}
          className="min-w-0 md:col-span-2 xl:col-span-12 space-y-4 scroll-mt-20"
          aria-label="전략 점검"
        >
          <h2 className="text-sm font-semibold text-gray-300">전략 점검</h2>
          {/* 구루 신호 엔진 — 강조 토글이 켜지면 펼쳐 표시, 꺼지면 같은 자리에서 접힘(localStorage 영속). 계산/발화 무변경. */}
          <GuruSignalCard
            collapsible={!ui.signalDisplay.showGuruSignalsProminently}
            defaultCollapsed
            storageKey="asset-manager-guru-card-open"
          />
          {/* 참고 지표(리스크 매트릭스 등) — 구루 카드는 중복 제외. */}
          <ReferenceIndicatorsSection />
          <RebalancingTable assets={assets} exchangeRates={exchangeRates} pendingRebalanceCount={pendingRebalanceCount} />
          {/* 리스크 계산기(평소 접힘). */}
          <RiskCalculatorCard />
        </section>
      </div>

      {/* 화면 면책 — Stage C: 카드마다(리스크 계산기·과열 리스크·시장 디스트리뷰션·구루 신호·매매 계획 카드) 반복하던
          "투자자문이 아닙니다"를 홈 하단 한 줄로 통합. 각 카드에는 성격 설명(예측 아님 등)만 남긴다. */}
      <p className="flex items-start gap-1.5 text-xs text-gray-500 leading-relaxed">
        <Info className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden="true" />
        <span>
          이 화면의 신호·경고·계산(오늘의 브리핑, 시장 디스트리뷰션, 구루 신호, 과열 리스크, 리스크 계산기)은 판단을 돕는 참고용이며 투자자문이 아닙니다.
          매매 계획 {TRADE_PLAN_BASIS_NOTE}
        </span>
      </p>
    </div>
  );
};

export default DashboardView;
