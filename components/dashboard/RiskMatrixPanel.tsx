// 대시보드 "참고 지표" 섹션의 컴팩트 리스크 매트릭스 패널 (Phase 5 — 신호 다이어트)
// ---------------------------------------------------------------------------
// derived.riskMatrix(useAutoAlert가 computeRiskTier로 산출)를 읽어 티어별로 표시만 한다.
// 계산/발화/저장 로직은 전혀 건드리지 않는다(표시 계층 전용). AlertPopup의 배너와
// 동일 데이터를 공유하되, 대시보드에서는 접힘 섹션 안의 상시 참고용으로 노출한다.
// 종목 클릭 → 해당 탭으로 이동(포트폴리오/관심종목) + 포커스.

import React from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';

const RISK_TIER_STYLES = {
  red: { badge: 'bg-red-600 text-white', label: '🔴 강한 위험 · 정리 검토', bg: 'bg-red-950/60', border: 'border-red-700/60' },
  amber: { badge: 'bg-amber-600 text-white', label: '🟡 비중 축소', bg: 'bg-amber-950/40', border: 'border-amber-700/50' },
  blue: { badge: 'bg-blue-600 text-white', label: '🔵 신규 진입 금지/관찰', bg: 'bg-blue-950/40', border: 'border-blue-700/50' },
} as const;

const RiskMatrixPanel: React.FC = () => {
  const { derived, actions } = usePortfolio();
  const riskMatrix = derived.riskMatrix;

  const tieredRows = {
    red: riskMatrix.filter(r => r.assessment.tier === 'red'),
    amber: riskMatrix.filter(r => r.assessment.tier === 'amber'),
    blue: riskMatrix.filter(r => r.assessment.tier === 'blue'),
  };
  const tieredCount = tieredRows.red.length + tieredRows.amber.length + tieredRows.blue.length;

  const handleAssetClick = (assetId: string, source: 'portfolio' | 'watchlist') => {
    if (source === 'watchlist') {
      actions.setActiveTab('watchlist');
      actions.setFocusedWatchItemId(assetId);
    } else {
      actions.setActiveTab('portfolio');
      actions.setFocusedAssetId(assetId);
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <h4 className="text-sm font-semibold text-amber-300">⚠️ 과열 리스크 경고</h4>
        <span className="text-xs text-gray-500">({tieredCount}종목)</span>
      </div>

      {tieredCount === 0 ? (
        <p className="text-xs text-gray-500 py-2">현재 과열 리스크로 분류된 종목이 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {(['red', 'amber', 'blue'] as const).map(tier => {
            const rows = tieredRows[tier];
            if (rows.length === 0) return null;
            const styles = RISK_TIER_STYLES[tier];
            return (
              <div key={tier} className={`${styles.bg} border ${styles.border} rounded-lg p-2.5`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${styles.badge} font-medium`}>{styles.label}</span>
                  <span className="text-gray-400 text-[11px]">{rows.length}종목</span>
                </div>
                <div className="space-y-1">
                  {rows.map(row => (
                    <div
                      key={`${row.assetId}-${row.source}`}
                      className="flex items-center justify-between text-xs cursor-pointer hover:bg-white/5 rounded px-1 py-0.5 transition-colors"
                      onClick={() => handleAssetClick(row.assetId, row.source)}
                      title={row.source === 'watchlist' ? '관심종목으로 이동' : '포트폴리오로 이동'}
                    >
                      <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                        {row.source === 'watchlist' && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-teal-600/30 text-teal-400 font-medium shrink-0">관심</span>
                        )}
                        <span className="text-white truncate">{row.assetName}</span>
                        <span className="text-gray-600 text-[10px] shrink-0">{row.ticker}</span>
                      </div>
                      <span className="text-gray-400 text-[10px] shrink-0 ml-2">
                        {row.assessment.reasons.join(' · ')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-gray-500 text-[10px] mt-2 italic">
        참고용 경고이며 투자자문이 아닙니다. 예측이 아닌 과열 리스크 경고입니다.
      </p>
    </div>
  );
};

export default RiskMatrixPanel;
