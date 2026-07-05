// components/portfolio-table/TurtleRiskGauge.tsx
// ---------------------------------------------------------------------------
// 터틀 오픈 리스크 게이지 (Phase 2b-5, 렌더 전용).
//
// 돈-공간(D6): 오픈리스크·예산·12% 한도 전부 KRW. per-position fxRate로 환산된 값(모델)을 표시만.
// fail-safe(Codex): 환율 미확보 포지션이 있으면 게이지를 과소평가로 오인하지 않도록
//   "≥" + 경고를 노출한다(실제 리스크는 표시값보다 큼).
// 오픈 포지션이 없으면 아무것도 렌더하지 않는다(비터틀 사용자 무영향).

import React from 'react';
import { TurtleRiskGaugeModel } from '../../utils/turtlePositionView';
import { formatKRW } from './utils';

interface Props {
  gauge: TurtleRiskGaugeModel;
}

const TurtleRiskGauge: React.FC<Props> = ({ gauge }) => {
  if (gauge.openPositionCount <= 0) return null;

  const { riskPct, limitPct, hasUnresolved } = gauge;
  // 게이지 바: 한도(limitPct) 대비 현재 리스크 비율. riskPct null(예산 0)이면 미표시.
  const fillRatio = riskPct != null && limitPct > 0 ? Math.min(1, riskPct / limitPct) : 0;
  const over = riskPct != null && riskPct >= limitPct;
  const near = riskPct != null && !over && riskPct >= limitPct * 0.75;
  const barColor = over ? 'bg-red-500' : near ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className="mx-3 sm:mx-6 mt-2 sm:mt-3 rounded-md border border-gray-700 bg-gray-800/60 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-xs font-semibold text-gray-200 inline-flex items-center gap-1">
          <span role="img" aria-label="터틀">🐢</span> 오픈 리스크 (동시 손절 시 손실, KRW)
        </span>
        <span className="text-[11px] text-gray-500">{gauge.resolvedCount}/{gauge.openPositionCount} 포지션</span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-sm font-bold text-gray-100">
          {hasUnresolved ? '≥ ' : ''}{formatKRW(gauge.openRiskKRW)}
        </span>
        {riskPct != null && (
          <span className={`text-xs font-medium ${over ? 'text-red-400' : near ? 'text-amber-400' : 'text-gray-400'}`}>
            {hasUnresolved ? '≥ ' : ''}{riskPct.toFixed(1)}% / 한도 {limitPct}%
          </span>
        )}
      </div>

      {/* 한도 대비 게이지 바 */}
      <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-700 overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${fillRatio * 100}%` }} />
      </div>

      {hasUnresolved && (
        <p className="text-[11px] text-amber-300 mt-1.5">
          환율 미확보 {gauge.unresolved.length}종목({gauge.unresolved.map(u => u.ticker).join(', ')})은 합산에서 제외됨 — 실제 리스크는 표시값보다 큽니다. 시세 갱신 후 재계산됩니다.
        </p>
      )}
      {gauge.budgetKRW <= 0 && (
        <p className="text-[11px] text-gray-500 mt-1.5">위성 예산이 설정되면 한도 대비 비율이 표시됩니다.</p>
      )}
    </div>
  );
};

export default TurtleRiskGauge;
