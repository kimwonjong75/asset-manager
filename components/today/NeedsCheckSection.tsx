// components/today/NeedsCheckSection.tsx
// "확인 필요" — 시세 결측/오래됨 + 증권사 손절 예약주문 미등록. 계산은 utils/todayViewModel.needsCheckRows,
// 여기는 렌더 + 손절주문 등록 토글만 담당(렌더 전용, RULES.md §2). 계획서 §4.6 "확인 필요 섹션" 카피.

import React from 'react';
import { ListChecks } from 'lucide-react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import type { NeedsCheckRows } from '../../utils/todayViewModel';
import SectionHeader from '../common/SectionHeader';
import Button from '../common/Button';

export interface NeedsCheckSectionProps {
  needsCheck: NeedsCheckRows;
}

const NeedsCheckSection: React.FC<NeedsCheckSectionProps> = ({ needsCheck }) => {
  const { actions } = usePortfolio();
  const { unavailable, stale, brokerStopMissing } = needsCheck;
  const priceIssues = [...unavailable, ...stale];
  if (priceIssues.length === 0 && brokerStopMissing.length === 0) return null;

  return (
    <section className="rounded-lg border border-warning/30 bg-warning-soft p-3">
      <div className="mb-2">
        <SectionHeader
          title="확인 필요"
          tone="warning"
          icon={<ListChecks className="h-4 w-4 text-warning" aria-hidden="true" />}
          actions={
            <span className="text-xs font-normal text-gray-300">
              시세 문제 {priceIssues.length} · 손절주문 미등록 {brokerStopMissing.length}
            </span>
          }
        />
      </div>

      {priceIssues.length > 0 && (
        <div className="mb-2.5">
          <p className="text-xs text-gray-300 mb-1">
            시세 없음 — 새로고침 후에도 없으면 종목 코드를 확인하세요
          </p>
          <ul className="space-y-1">
            {priceIssues.map(row => (
              <li key={row.asset.id} className="text-xs text-gray-300 flex items-center gap-1.5">
                <span className="font-medium text-white">{row.asset.name}</span>
                <span className="text-xs text-gray-500">
                  {row.evaluation.signal === 'unavailable' ? '시세 없음' : '시세 오래됨'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {brokerStopMissing.length > 0 && (
        <div>
          <p className="text-xs text-gray-300 mb-1">
            증권사 앱에서 '손절(스탑로스) 예약주문'을 손절선 가격으로 걸어 두세요. 카톡은 알려줄 뿐 대신 팔아주지 않습니다
          </p>
          <ul className="space-y-1">
            {brokerStopMissing.map(row => (
              <li key={row.asset.id} className="text-xs text-gray-300 flex items-center gap-2">
                <span className="font-medium text-white">{row.asset.name}</span>
                <Button variant="warning" onClick={() => actions.setTradePlanBrokerStop(row.asset.id, true)}>
                  등록했어요
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

export default NeedsCheckSection;
