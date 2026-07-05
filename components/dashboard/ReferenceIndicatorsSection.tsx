// 대시보드 "참고 지표" 접힘 섹션 (Phase 5 — 신호 다이어트)
// ---------------------------------------------------------------------------
// 행동 신호(주문 생성 권한)의 단일 소스는 실행 큐다. 예측형 참고 신호(리스크 매트릭스 등)는
// 이 접힘 섹션으로 강등해, 기본 화면에서 시각적 우선순위를 낮춘다.
// 계산·발화·저장은 전혀 바뀌지 않는다(표시 계층 전용).
//
// - 위치: 구루 신호 엔진 카드 바로 아래(DashboardView).
// - 구루 신호 카드는 여기에 넣지 않는다(상단 카드가 항상 노출되므로 중복 방지).
//   이 섹션은 리스크 매트릭스 등 참고형 지표만 컴팩트하게 담는다.
// 펼침/접힘 상태는 localStorage에 기억한다(RiskCalculatorCard 패턴 동일).

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import RiskMatrixPanel from './RiskMatrixPanel';

const REF_SECTION_OPEN_KEY = 'asset-manager-reference-indicators-open';

function loadOpen(): boolean {
  try { return localStorage.getItem(REF_SECTION_OPEN_KEY) === 'true'; } catch { return false; }
}
function saveOpen(v: boolean): void {
  try { localStorage.setItem(REF_SECTION_OPEN_KEY, String(v)); } catch { /* ignore */ }
}

const ReferenceIndicatorsSection: React.FC = () => {
  const { derived } = usePortfolio();
  const [open, setOpen] = useState<boolean>(loadOpen);
  const toggleOpen = () => setOpen(prev => { const next = !prev; saveOpen(next); return next; });

  // 접힘 상태에서도 "오늘 과열 종목 있나?"를 펼치지 않고 훑을 수 있는 muted 카운트 배지(표시 전용).
  // 구루 신호는 바로 위 상단 카드가 담당하므로 여기 배지는 리스크 매트릭스(과열)만 집계(중복/혼동 방지).
  const riskTieredCount = derived.riskMatrix.filter(r => r.assessment.tier !== null).length;
  const hasSummary = riskTieredCount > 0;

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg p-4 sm:p-5">
      <div className={`flex items-center justify-between ${open ? 'mb-4' : ''}`}>
        <button
          type="button"
          onClick={toggleOpen}
          className="flex items-center gap-2 text-left min-w-0"
          aria-expanded={open}
        >
          <ChevronDown
            className={`h-4 w-4 text-gray-400 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
          />
          <div className="min-w-0">
            <h3 className="text-base font-bold text-white">📊 참고 지표</h3>
            {open && (
              <p className="text-xs text-gray-500 mt-0.5">
                리스크 매트릭스는 참고용입니다. 실행할 주문은 <span className="text-gray-400">실행 큐</span>를 기준으로 하세요.
              </p>
            )}
          </div>
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* muted 카운트 배지 — 강등 유지(눈에 안 띄게)하되 완전히 숨기진 않음 (과열=리스크 매트릭스) */}
          {hasSummary && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400/80 font-medium">
              과열 {riskTieredCount}
            </span>
          )}
          {!open && !hasSummary && (
            <span className="text-xs text-gray-500">클릭하여 펼치기</span>
          )}
        </div>
      </div>

      {open && (
        <div className="space-y-4">
          <RiskMatrixPanel />
        </div>
      )}
    </div>
  );
};

export default ReferenceIndicatorsSection;
