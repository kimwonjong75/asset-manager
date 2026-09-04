// components/layouts/TodayView.tsx
// "오늘" 화면 (P3, 기본 탭) — 계획서 §4.3. 계산은 utils/todayViewModel(순수) + 이미 산출된
// derived 상태(hooks/useTradePlanSignals 등)만 소비한다. 렌더는 여기 + components/today/*
// (RULES.md §2 — components는 UI만, 계산 로직 없음).

import React, { useMemo } from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import KakaoStatusChip from '../trade-plan/KakaoStatusChip';
import {
  buildTodayHeadline,
  groupRowsByTier,
  needsCheckRows,
  pendingOrderCounts,
} from '../../utils/todayViewModel';
import UrgentSection from '../today/UrgentSection';
import TodaySection from '../today/TodaySection';
import PrepareSection from '../today/PrepareSection';
import NeedsCheckSection from '../today/NeedsCheckSection';
import PlanlessHoldingsSection from '../today/PlanlessHoldingsSection';
import PendingOrdersSection from '../today/PendingOrdersSection';
import WatchSection from '../today/WatchSection';

const TodayView: React.FC = () => {
  const { data, status, derived, actions } = usePortfolio();

  const headline = useMemo(
    () => buildTodayHeadline(derived.tradePlanRows, derived.tradePlanSummary),
    [derived.tradePlanRows, derived.tradePlanSummary]
  );
  const tiers = useMemo(() => groupRowsByTier(derived.tradePlanRows), [derived.tradePlanRows]);
  const needsCheck = useMemo(() => needsCheckRows(derived.tradePlanRows), [derived.tradePlanRows]);
  const pendingCounts = useMemo(() => pendingOrderCounts(data.actionQueue), [data.actionQueue]);
  const hasNoPlansAtAll = derived.tradePlanRows.length === 0;

  return (
    <div className="max-w-3xl mx-auto px-1 sm:px-0 pb-16 space-y-4">
      {/* 헤더 — 한 줄 요약 + 데이터 기준시각/새로고침 + 카톡 상태칩 + 새 매수 계획 */}
      <header className="space-y-2">
        <p className="text-base sm:text-lg font-semibold text-white leading-snug">{headline.text}</p>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-gray-500">데이터 기준 {derived.priceFreshnessLabel}</span>
            <button
              type="button"
              onClick={() => actions.refreshAllPrices(false)}
              disabled={status.isLoading}
              className="text-[11px] text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status.isLoading ? '갱신 중...' : '새로고침'}
            </button>
            <KakaoStatusChip />
          </div>
          <button
            type="button"
            onClick={() => actions.openTradePlanPlanner()}
            className="text-xs font-medium text-white bg-primary hover:bg-primary-dark px-3 py-1.5 rounded-md transition-colors"
          >
            + 새 매수 계획
          </button>
        </div>
      </header>

      <UrgentSection rows={tiers.urgent} />
      <TodaySection rows={tiers.today} />
      <PrepareSection rows={tiers.prepare} />
      <NeedsCheckSection needsCheck={needsCheck} />
      <PlanlessHoldingsSection planless={derived.planlessSatellites} hasNoPlansAtAll={hasNoPlansAtAll} />
      <PendingOrdersSection counts={pendingCounts} />
      <WatchSection />
    </div>
  );
};

export default TodayView;
