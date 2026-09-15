// components/settings/TurtleSettingsSection.tsx
// 터틀(위성) 실행 설정 — 설정 탭 신설 섹션(P3). `TurtleSettingsPanel`(위성 예산 입력 + 완료 주문
// 정리)을 그대로 감싸되, 잠금 배지/설명을 덧붙인다. 실행 큐 탭이 사라지면서 대기 주문 처리는
// "오늘" 화면(PendingOrdersSection)으로 옮겨갔다는 것을 안내한다. 렌더 전용(RULES.md §2).
//
// `WhyNoOrderPanel`은 여기서 렌더하지 않는다 — "오늘 주문 생성" 직후에만 의미가 있는 진단이라
// 설정 화면에 상시 노출할 이유가 없다(ExecutionView 자신의 embedded 아닌 경로에서는 그대로 유지).

import React from 'react';
import TurtleSettingsPanel from '../execution/TurtleSettingsPanel';
import { TURTLE_LOCK_BADGE, TURTLE_LOCK_MESSAGE, isTurtleOrderLocked } from '../../types/turtleLock';
import Badge from '../common/Badge';

const TurtleSettingsSection: React.FC = () => {
  const locked = isTurtleOrderLocked();

  return (
    <div className="bg-gray-800 rounded-lg">
      <div className="px-6 py-5 border-b border-gray-700">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-xl font-bold text-white">터틀(위성) 실행</h2>
          {locked && <Badge tone="warning" size="md">{TURTLE_LOCK_BADGE}</Badge>}
        </div>
        <p className="text-gray-400 text-sm mt-1 leading-relaxed">
          터틀 자동주문은 현재 관찰 전용 잠금 — 대기 주문은 홈 '오늘의 브리핑'에서 처리합니다.
          {locked && ` ${TURTLE_LOCK_MESSAGE}`}
        </p>
      </div>
      <div className="px-6 py-4">
        <TurtleSettingsPanel />
      </div>
    </div>
  );
};

export default TurtleSettingsSection;
