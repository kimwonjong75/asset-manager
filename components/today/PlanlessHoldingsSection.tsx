// components/today/PlanlessHoldingsSection.tsx
// "계획 없는 투더문 보유" — derived.planlessSatellites 요약 + [일괄 계획 만들기].
// 활성 계획이 앱 전체에 하나도 없으면(첫 사용) §4.6 "오늘 화면 빈 상태" 카피로 대체한다.
// 렌더 전용(RULES.md §2) — 대상 산출은 utils/tradePlan.isEligibleForBulkPlan(훅에서 이미 계산됨).

import React from 'react';
import { Plus } from 'lucide-react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import Button from '../common/Button';
import type { Asset } from '../../types';

export interface PlanlessHoldingsSectionProps {
  planless: Asset[];
  /** 앱 전체에 활성 계획이 하나도 없음 (derived.tradePlanRows.length === 0) */
  hasNoPlansAtAll: boolean;
}

const MAX_NAMES = 5;

const PlanlessHoldingsSection: React.FC<PlanlessHoldingsSectionProps> = ({ planless, hasNoPlansAtAll }) => {
  const { actions } = usePortfolio();

  if (hasNoPlansAtAll) {
    return (
      <section className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 text-center">
        <p className="text-sm text-gray-300">계획이 없으면 알림도 없어요</p>
        <div className="mt-2.5 flex items-center justify-center gap-2 flex-wrap">
          <Button variant="primary" onClick={actions.openTradePlanBulk}>
            일괄 계획 만들기
          </Button>
          <Button variant="secondary" icon={<Plus />} onClick={() => actions.openTradePlanPlanner()}>
            새 매수 계획
          </Button>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          계획을 만들면 손절선·익절선에 닿을 때 카카오톡으로도 알려드릴 수 있어요(1회 설정 필요).
        </p>
        <button
          type="button"
          onClick={() => actions.setActiveTab('settings')}
          className="text-xs text-amber-300 hover:text-amber-200 underline underline-offset-2 mt-1"
        >
          설정에서 카카오톡 알림 켜기 →
        </button>
      </section>
    );
  }

  if (planless.length === 0) return null;

  const names = planless.slice(0, MAX_NAMES).map(a => a.name);
  const remaining = planless.length - names.length;

  return (
    <section className="rounded-lg border border-gray-700 bg-gray-800/40 p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-gray-200">
          ■ 계획 없는 투더문 보유 <span className="text-gray-400 font-normal">{planless.length}</span>
        </h2>
        <Button variant="primary" onClick={actions.openTradePlanBulk}>
          일괄 계획 만들기
        </Button>
      </div>
      <p className="text-xs text-gray-400 mt-1">
        {names.join(', ')}{remaining > 0 && ` 외 ${remaining}`}
      </p>
    </section>
  );
};

export default PlanlessHoldingsSection;
