// components/today/TodayActionCenter.tsx
// 홈 '오늘의 브리핑' — 과거 '오늘' 탭(TodayView)의 본문을 홈 좌측 강조 컨테이너로 흡수(Stage A, 2026-09-14).
// 계산은 utils/todayViewModel(순수) + 이미 산출된 derived 상태만 소비한다 — 렌더 전용(RULES.md §2).
//
// · 매매 계획 행은 계정 선택과 무관하게 전체가 표시된다 → 헤더 ScopeChip "모든 계정".
// · 데이터 기준시각/새로고침은 앱 헤더가 담당하므로 여기서는 제거했다.
// · `useTodayTurtle()`은 여기서 **한 번만** 호출해 요약 칩과 관찰 섹션에 같은 모델을 내려준다
//   (읽기 전용, POST /history 최대 2건 — 과거 대시보드 마운트와 동일). 홈 탭 재진입 시 재조회된다.

import React, { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { useTodayTurtle } from '../../hooks/useTodayTurtle';
import { OWNER_FILTER_LABELS } from '../../types/owner';
import KakaoStatusChip from '../trade-plan/KakaoStatusChip';
import TradePlanIntro, { hasSeenTradePlanIntro } from '../trade-plan/TradePlanIntro';
import ScopeChip from '../common/ScopeChip';
import {
  buildTodayHeadline,
  groupRowsByTier,
  needsCheckRows,
  observeCounts,
  pendingOrderCounts,
} from '../../utils/todayViewModel';
import UrgentSection from './UrgentSection';
import TodaySection from './TodaySection';
import PrepareSection from './PrepareSection';
import NeedsCheckSection from './NeedsCheckSection';
import PlanlessHoldingsSection from './PlanlessHoldingsSection';
import PendingOrdersSection from './PendingOrdersSection';
import WatchSection, { WATCH_SECTION_ID } from './WatchSection';

/** 홈 '전략 점검' 섹션 id — DashboardView가 같은 값을 쓴다 */
export const HOME_STRATEGY_SECTION_ID = 'home-strategy';

const WATCH_OPEN_KEY = 'asset-manager-today-watch-open';
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function formatBriefingDate(d: Date): string {
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

function scrollToId(id: string): void {
  // 펼침 직후 레이아웃이 반영된 다음 프레임에 스크롤
  requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

const CHIP_CLASS =
  'inline-flex items-center gap-1 min-h-9 px-3 rounded-full border border-border-subtle bg-surface-muted text-xs sm:text-sm text-gray-200 hover:bg-gray-700 transition-colors';

const TodayActionCenter: React.FC = () => {
  const { data, derived, actions, ui } = usePortfolio();
  const turtle = useTodayTurtle();

  // 첫 화면에서부터 "매매 계획이란?"을 보여준다(계획 0건일 때만).
  const [showIntro, setShowIntro] = useState<boolean>(() => !hasSeenTradePlanIntro());
  const [watchOpen, setWatchOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(WATCH_OPEN_KEY) === 'true'; } catch { return false; }
  });
  const [dateLabel] = useState<string>(() => formatBriefingDate(new Date()));

  const setWatch = (next: boolean) => {
    setWatchOpen(next);
    try { localStorage.setItem(WATCH_OPEN_KEY, String(next)); } catch { /* ignore */ }
  };

  const headline = useMemo(
    () => buildTodayHeadline(derived.tradePlanRows, derived.tradePlanSummary),
    [derived.tradePlanRows, derived.tradePlanSummary]
  );
  const tiers = useMemo(() => groupRowsByTier(derived.tradePlanRows), [derived.tradePlanRows]);
  const needsCheck = useMemo(() => needsCheckRows(derived.tradePlanRows), [derived.tradePlanRows]);
  const pendingCounts = useMemo(() => pendingOrderCounts(data.actionQueue), [data.actionQueue]);
  const counts = useMemo(
    () => observeCounts({
      alertResults: derived.alertResults,
      riskMatrix: derived.riskMatrix,
      turtleWatchBreakouts: turtle.summary.breakout,
    }),
    [derived.alertResults, derived.riskMatrix, turtle.summary.breakout]
  );
  const hasNoPlansAtAll = derived.tradePlanRows.length === 0;
  const accountLabel = OWNER_FILTER_LABELS[ui.accountView];

  // 로딩·부분실패를 숨기지 않는다 — 0으로 보이면 "돌파 없음"으로 오인된다.
  const breakoutLabel = turtle.isLoading
    ? '55일 돌파 확인 중…'
    : turtle.partialFailure
      ? `55일 돌파 ${counts.breakoutCount} (일부 조회 실패)`
      : `55일 돌파 ${counts.breakoutCount}`;

  const openWatch = () => {
    setWatch(true);
    scrollToId(WATCH_SECTION_ID);
  };

  return (
    <section
      className="rounded-card border border-primary/40 bg-primary/5 p-4 sm:p-5 space-y-4"
      aria-label="오늘의 브리핑"
    >
      <header className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-primary-light">오늘의 브리핑 · {dateLabel}</span>
          <ScopeChip label="모든 계정" title="매매 계획은 계정 선택과 무관하게 전체가 표시됩니다" />
        </div>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <p className="text-base sm:text-lg font-semibold text-white leading-snug min-w-0 flex-1 basis-60">{headline.text}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <KakaoStatusChip />
            <button
              type="button"
              onClick={() => actions.openTradePlanPlanner()}
              className="inline-flex items-center gap-1 min-h-9 text-xs sm:text-sm font-medium text-gray-100 border border-border-subtle bg-surface-muted hover:bg-gray-700 px-3 rounded-md transition-colors"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              새 매수 계획
            </button>
          </div>
        </div>
      </header>

      {hasNoPlansAtAll && showIntro && (
        <TradePlanIntro onDismiss={() => setShowIntro(false)} />
      )}

      <UrgentSection rows={tiers.urgent} />
      <TodaySection rows={tiers.today} />
      <NeedsCheckSection needsCheck={needsCheck} />
      <PendingOrdersSection counts={pendingCounts} />
      <PrepareSection rows={tiers.prepare} />
      <PlanlessHoldingsSection planless={derived.planlessSatellites} hasNoPlansAtAll={hasNoPlansAtAll} />

      {/* 요약 칩 — 참고 신호 건수. 누르면 해당 위치로 이동 */}
      <div className="flex flex-wrap gap-2" aria-label="참고 신호 요약">
        <button type="button" onClick={openWatch} className={CHIP_CLASS} title="관찰 섹션을 펼치고 이동합니다">
          {breakoutLabel}
        </button>
        <button type="button" onClick={actions.showBriefingPopup} className={CHIP_CLASS} title="알림 브리핑을 엽니다">
          알림 {counts.alertCount}
        </button>
        <button type="button" onClick={() => scrollToId(HOME_STRATEGY_SECTION_ID)} className={CHIP_CLASS} title="전략 점검의 참고 지표로 이동합니다">
          과열 {counts.riskCount}
        </button>
        <button type="button" onClick={() => scrollToId(HOME_STRATEGY_SECTION_ID)} className={CHIP_CLASS} title="전략 점검의 구루 신호로 이동합니다">
          구루 신호
        </button>
      </div>

      <WatchSection
        model={turtle}
        counts={counts}
        breakoutLabel={breakoutLabel}
        accountLabel={accountLabel}
        open={watchOpen}
        onToggle={() => setWatch(!watchOpen)}
      />
    </section>
  );
};

export default TodayActionCenter;
