// components/today/WatchSection.tsx
// "관찰" — 일반 알림/구루/리스크 매트릭스 + '오늘의 터틀 확인'을 참고 신호로 강등한 섹션
// (계획서 §4.3: 계획이 있는 종목은 계획이 우선이므로 이쪽은 항상 표시 계층만 — 계산/발화 불변).
// 기본 접힘. `TodayTurtleCard`를 대시보드에서 이식(마운트는 앱 전체에서 여기 한 곳뿐).
// 렌더 전용(RULES.md §2) — 계산은 utils/todayViewModel.

import React, { useState } from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import TodayTurtleCard from '../dashboard/TodayTurtleCard';
import { observeCounts, countPlanPriorityObserved } from '../../utils/todayViewModel';

const STORAGE_KEY = 'asset-manager-today-watch-open';

const WatchSection: React.FC = () => {
  const { data, derived, actions } = usePortfolio();
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
  });

  // turtleWatchBreakouts: TodayTurtleCard가 자체 useTodayTurtle()로 55일 돌파를 계산해 항상
  // 노출되는 요약 줄에 표시한다 — 같은 훅을 여기서 다시 호출하면 시세 조회가 중복되므로 0으로
  // 둔다(헤더 배지는 알림·과열만; 돌파 건수는 카드 자신의 요약 줄이 담당).
  const counts = observeCounts({ alertResults: derived.alertResults, riskMatrix: derived.riskMatrix, turtleWatchBreakouts: 0 });

  // "계획 기준 우선" — 표시 전용 배지. 알림/리스크 계산 자체는 건드리지 않는다.
  const plannedAssetIds = new Set(data.assets.filter(a => a.tradePlan?.status === 'active').map(a => a.id));
  const priorityCount = countPlanPriorityObserved(derived.alertResults, derived.riskMatrix, plannedAssetIds);

  const toggle = () => setOpen(prev => {
    const next = !prev;
    try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* ignore */ }
    return next;
  });

  return (
    <section>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex items-center gap-2 text-sm font-semibold text-gray-300"
        >
          <span className={`text-gray-500 transition-transform ${open ? '' : '-rotate-90'}`}>▾</span>
          <span>■ 관찰</span>
          <span className="text-[11px] text-gray-500 font-normal">(알림 {counts.alertCount} · 과열 {counts.riskCount})</span>
        </button>
        {priorityCount > 0 && (
          <span className="text-[11px] px-1.5 py-0.5 rounded border border-primary/40 bg-primary/10 text-primary-light">
            계획 기준 우선 {priorityCount}
          </span>
        )}
        {/* P6: 접혀 있어도 "알림 발화 N건 → 브리핑 보기" 배너는 계속 보인다(신호 은폐 금지 규약) —
            섹션 자체는 접혀도 이 버튼만 헤더 옆에 남는다 */}
        {counts.alertCount > 0 && (
          <button
            type="button"
            onClick={actions.showBriefingPopup}
            className="text-xs text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 px-2.5 py-1.5 rounded-md transition-colors"
          >
            알림 발화 {counts.alertCount}건 → 브리핑 보기
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-2.5">
          <TodayTurtleCard collapsible defaultCollapsed storageKey="asset-manager-today-turtle-open" />
        </div>
      )}
    </section>
  );
};

export default WatchSection;
