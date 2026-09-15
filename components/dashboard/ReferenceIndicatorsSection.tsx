// 대시보드 "참고 지표" 접힘 섹션 (Phase 5 — 신호 다이어트)
// ---------------------------------------------------------------------------
// 행동 신호(주문 생성 권한)의 단일 소스는 실행 큐다. 예측형 참고 신호(리스크 매트릭스 등)는
// 이 접힘 섹션으로 강등해, 기본 화면에서 시각적 우선순위를 낮춘다.
// 계산·발화·저장은 전혀 바뀌지 않는다(표시 계층 전용).
//
// - 위치: 구루 신호 엔진 카드 바로 아래(DashboardView).
// - 구루 신호 카드는 여기에 넣지 않는다(상단 카드가 항상 노출되므로 중복 방지).
//   이 섹션은 리스크 매트릭스 등 참고형 지표만 컴팩트하게 담는다.
// Stage C: 공용 Card(collapsible)로 전환 — 펼침 상태 키 문자열은 그대로(기본 접힘).
//   접힌 헤더의 summary에 "과열 N"을 항상 표시한다(0건 포함).

import React from 'react';
import { BarChart3 } from 'lucide-react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import Card from '../common/Card';
import RiskMatrixPanel from './RiskMatrixPanel';

const REF_SECTION_OPEN_KEY = 'asset-manager-reference-indicators-open';

const ReferenceIndicatorsSection: React.FC = () => {
  const { derived } = usePortfolio();

  // 접힘 상태에서도 "오늘 과열 종목 있나?"를 펼치지 않고 훑을 수 있는 muted 카운트 배지(표시 전용).
  // 구루 신호는 바로 위 상단 카드가 담당하므로 여기 배지는 리스크 매트릭스(과열)만 집계(중복/혼동 방지).
  const riskTieredCount = derived.riskMatrix.filter(r => r.assessment.tier !== null).length;
  const hasSummary = riskTieredCount > 0;
  // 0건도 "과열 0"으로 표시 — 접힌 헤더가 항상 건수를 보여야 한다(홈 Stage A 규약).

  return (
    <Card
      collapsible
      defaultCollapsed
      storageKey={REF_SECTION_OPEN_KEY}
      title={
        <span className="inline-flex items-center gap-1.5">
          <BarChart3 className="h-4 w-4 text-gray-300" aria-hidden="true" />
          참고 지표
        </span>
      }
      description="리스크 매트릭스는 참고용입니다. 실행할 주문은 홈 오늘의 브리핑을 기준으로 하세요."
      summary={
        <span
          className={`px-1.5 py-0.5 rounded font-medium ${
            hasSummary ? 'bg-amber-900/30 text-amber-400/80' : 'bg-surface-muted text-gray-400'
          }`}
        >
          과열 {riskTieredCount}
        </span>
      }
    >
      <RiskMatrixPanel />
    </Card>
  );
};

export default ReferenceIndicatorsSection;
