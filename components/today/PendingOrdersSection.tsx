// components/today/PendingOrdersSection.tsx
// "대기 주문" — 실행 큐(리밸런싱/대청소) 잔존 기능 이식. 렌더 전용(RULES.md §2).
// `ExecutionView embedded`가 카드 목록(실행하기/건너뜀/내일) + 3개 실행 모달을 그대로 그린다
// (터틀 kind가 섞여 있어도 안전잠금 배지는 카드별로 유지된다 — types/turtleLock 무변경).
// 건수는 utils/todayViewModel.pendingOrderCounts(data.actionQueue) — 터틀 kind는 집계 제외.

import React from 'react';
import { Clock } from 'lucide-react';
import SectionHeader from '../common/SectionHeader';
import ExecutionView from '../execution/ExecutionView';
import type { PendingOrderCounts } from '../../utils/todayViewModel';

export interface PendingOrdersSectionProps {
  counts: PendingOrderCounts;
}

const PendingOrdersSection: React.FC<PendingOrdersSectionProps> = ({ counts }) => {
  if (counts.rebalance === 0 && counts.cleanup === 0) return null;
  return (
    <section>
      <div className="mb-2">
        <SectionHeader
          title="대기 주문"
          icon={<Clock className="h-4 w-4 text-gray-400" aria-hidden="true" />}
          actions={
            <span className="text-xs text-gray-400">리밸런싱 {counts.rebalance} · 대청소 {counts.cleanup}</span>
          }
        />
      </div>
      <ExecutionView embedded />
    </section>
  );
};

export default PendingOrdersSection;
