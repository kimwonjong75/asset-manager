// components/today/WatchSection.tsx
// "관찰" — 일반 알림/과열 + '오늘의 터틀 확인'을 참고 신호로 강등한 섹션
// (계획서 §4.3: 계획이 있는 종목은 계획이 우선이므로 이쪽은 항상 표시 계층만 — 계산/발화 불변).
// Stage A(2026-09-14): 접힘 1단계 — 섹션 토글이 곧바로 터틀 내용을 보여준다(중첩 접힘 카드 제거).
//   · 펼침 상태는 호출부(TodayActionCenter)가 들고 있다 — 요약 칩 "55일 돌파 N"이 이 섹션을 열어야 해서.
//   · 터틀 모델도 호출부가 `useTodayTurtle()`을 한 번만 호출해 내려준다(시세 조회 중복 방지).
//   · 접혀 있어도 알림·과열·55일 돌파 건수는 헤더에 항상 보인다(신호 은폐 금지 규약).
//   · 터틀 판정은 계정 선택을 따르므로 "계정: X" 범위 칩을 따로 단다(브리핑 전체는 '모든 계정').
// 렌더 전용(RULES.md §2) — 건수는 utils/todayViewModel.

import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import TodayTurtleCard from '../dashboard/TodayTurtleCard';
import ScopeChip from '../common/ScopeChip';
import Button from '../common/Button';
import type { TodayTurtleModel } from '../../types/todayTurtle';
import type { ObserveCounts } from '../../utils/todayViewModel';
import { countPlanPriorityObserved } from '../../utils/todayViewModel';

export const WATCH_SECTION_ID = 'home-watch';

export interface WatchSectionProps {
  model: TodayTurtleModel;
  counts: ObserveCounts;
  /** "55일 돌파 N" / "55일 돌파 확인 중…" 등 — 호출부가 로딩·부분실패를 반영해 만든 라벨 */
  breakoutLabel: string;
  accountLabel: string;
  open: boolean;
  onToggle: () => void;
}

const WatchSection: React.FC<WatchSectionProps> = ({ model, counts, breakoutLabel, accountLabel, open, onToggle }) => {
  const { data, derived, actions } = usePortfolio();

  // "계획 기준 우선" — 표시 전용 배지. 알림/리스크 계산 자체는 건드리지 않는다.
  const plannedAssetIds = new Set(data.assets.filter(a => a.tradePlan?.status === 'active').map(a => a.id));
  const priorityCount = countPlanPriorityObserved(derived.alertResults, derived.riskMatrix, plannedAssetIds);

  return (
    <section id={WATCH_SECTION_ID} className="scroll-mt-20">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex items-center gap-2 min-h-9 text-sm font-semibold text-gray-300 hover:text-white"
        >
          <ChevronDown className={`h-4 w-4 text-gray-500 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
          <span>관찰</span>
          <span className="text-xs text-gray-500 font-normal">
            (알림 {counts.alertCount} · 과열 {counts.riskCount} · {breakoutLabel})
          </span>
        </button>
        <ScopeChip label={`계정: ${accountLabel}`} title="오늘의 터틀 확인은 위 계정 선택을 따릅니다." />
        {priorityCount > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded border border-primary/40 bg-primary/10 text-primary-light">
            계획 기준 우선 {priorityCount}
          </span>
        )}
        {/* P6: 접혀 있어도 "알림 발화 N건 → 브리핑 보기"는 계속 보인다(신호 은폐 금지 규약) */}
        {counts.alertCount > 0 && (
          <Button variant="warning" onClick={actions.showBriefingPopup} iconRight={<ChevronRight />}>
            알림 발화 {counts.alertCount}건 · 브리핑 보기
          </Button>
        )}
      </div>
      {open && <TodayTurtleCard model={model} />}
    </section>
  );
};

export default WatchSection;
