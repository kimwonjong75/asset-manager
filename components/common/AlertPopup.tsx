import React, { useState } from 'react';
import type { AlertResult, AlertMatchedAsset, AlertDataGap } from '../../types/alertRules';
import type { RiskMatrixRow } from '../../utils/riskMatrix';
import type { DistributionTier } from '../../utils/distributionTierState';
import type { TurtleReviewSummary } from '../../utils/turtleReview';
import Tooltip from './Tooltip';
import {
  BRIEFING_SECTION_TOOLTIPS,
  BRIEFING_COLUMN_TOOLTIPS,
  BRIEFING_RULE_TOOLTIPS,
  RISK_TIER_TOOLTIPS,
  CLIMAX_SIGNAL_TOOLTIP,
} from '../../constants/briefingDescriptions';

// P4.5 D1: distribution-high 단계별 뱃지 — 'new'는 컬러, 'ongoing'은 회색
const TIER_NEW_STYLES: Record<DistributionTier, { bg: string; label: string }> = {
  3: { bg: 'bg-yellow-500/80 text-black', label: '주의 (3)' },
  4: { bg: 'bg-orange-500/80 text-white', label: '약세 (4)' },
  5: { bg: 'bg-red-600/90 text-white', label: '위험 (5+)' },
};

const TIER_ONGOING_STYLES: Record<DistributionTier, { bg: string; label: string }> = {
  3: { bg: 'bg-gray-700/60 text-gray-400', label: '지속 (3)' },
  4: { bg: 'bg-gray-700/60 text-gray-400', label: '지속 (4)' },
  5: { bg: 'bg-gray-700/60 text-gray-400', label: '지속 (5+)' },
};

interface AlertPopupProps {
  results: AlertResult[];
  /** 종합 리스크 매트릭스 — 위험 우선 정렬된 배열. 빈 배열이면 배너 미표시 */
  riskMatrix: RiskMatrixRow[];
  /** fail-safe(매도 data-gap) — 데이터 누락으로 평가 불가였던 매도 규칙·종목. 발화 아님(주의 노출용) */
  sellDataGaps: AlertDataGap[];
  /** 터틀 실행 요약 (자동 검토 Phase A/B) — 실행 큐 대기 + 오늘 생성 가능. 실행할 게 있을 때만 카드 표시 */
  executionSummary: TurtleReviewSummary;
  /** 리스크 매트릭스 배너를 기본 펼침으로 표시할지 (Phase 5, 설정 토글). false면 접힘 — 클릭 시 펼침 */
  showRiskMatrixExpanded: boolean;
  onClose: () => void;
  onAssetClick: (assetId: string, source?: 'portfolio' | 'watchlist') => void;
  /** 실행 큐 탭으로 이동 (Phase 5 — 행동 신호의 단일 소스) */
  onOpenExecution: () => void;
}

const RISK_TIER_STYLES = {
  red: {
    badge: 'bg-red-600 text-white',
    label: '🔴 강한 위험 · 정리 검토',
    bg: 'bg-red-950/60',
    border: 'border-red-700/60',
  },
  amber: {
    badge: 'bg-amber-600 text-white',
    label: '🟡 비중 축소',
    bg: 'bg-amber-950/40',
    border: 'border-amber-700/50',
  },
  blue: {
    badge: 'bg-blue-600 text-white',
    label: '🔵 신규 진입 금지/관찰',
    bg: 'bg-blue-950/40',
    border: 'border-blue-700/50',
  },
} as const;

const SEVERITY_STYLES: Record<string, { bg: string; border: string; badge: string }> = {
  critical: { bg: 'bg-red-950/50', border: 'border-red-800/60', badge: 'bg-red-600' },
  warning: { bg: 'bg-amber-950/30', border: 'border-amber-800/40', badge: 'bg-amber-600' },
  info: { bg: 'bg-blue-950/30', border: 'border-blue-800/40', badge: 'bg-blue-600' },
};

const fmtPct = (v: number | undefined): string => {
  if (v == null) return '-';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
};

const pctColor = (v: number | undefined): string => {
  if (v == null) return 'text-gray-500';
  if (v > 0) return 'text-red-400';
  if (v < 0) return 'text-blue-400';
  return 'text-gray-400';
};

const AlertPopup: React.FC<AlertPopupProps> = ({ results, riskMatrix, sellDataGaps, executionSummary, showRiskMatrixExpanded, onClose, onAssetClick, onOpenExecution }) => {
  const [isMinimized, setIsMinimized] = useState(false);
  // 리스크 매트릭스 배너 펼침 상태 — 기본값은 설정(showRiskMatrixExpanded) 따름 (Phase 5, 표시 전용)
  const [riskExpanded, setRiskExpanded] = useState(showRiskMatrixExpanded);

  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
  });

  const sellResults = results.filter(r => r.rule.action === 'sell');
  const buyResults = results.filter(r => r.rule.action === 'buy');
  const hasResults = results.length > 0 || riskMatrix.length > 0;
  const totalCount = results.reduce((sum, r) => sum + r.matchedAssets.length, 0);
  const riskTieredCount = riskMatrix.filter(r => r.assessment.tier !== null).length;
  // fail-safe(매도 data-gap) — 발화가 아니라 '데이터 누락으로 평가 불가'. 발화 알림과 별개 주의 섹션으로 표시.
  const hasDataGaps = sellDataGaps.length > 0;
  const dataGapAssetCount = new Set(sellDataGaps.flatMap(g => g.affectedAssets.map(a => a.assetId))).size;

  // 터틀 실행 카드 (자동 검토 Phase A/B) — 실행할 게 있거나 검토 진행 중일 때만. 신호(참고)와 별개의 "행동" 축.
  const exec = executionSummary;
  const showExecCard = exec.actionableCount > 0 || exec.isChecking;
  const hasSellSignalPreview = exec.previewStop > 0 || exec.previewExit > 0;
  const execCard = showExecCard ? (
    <div className={`rounded-lg border p-2.5 ${hasSellSignalPreview || exec.escalatedCount > 0 ? 'border-red-500/50 bg-red-950/30' : 'border-primary/40 bg-primary/10'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-white">🐢 터틀 실행 대기</span>
        {exec.checkedAt && <span className="text-[10px] text-gray-500">{exec.checkedAt} 검토 기준</span>}
      </div>
      {exec.isChecking ? (
        <p className="text-[11px] text-gray-400 mt-1.5">오늘 신호를 자동 검토하는 중입니다...</p>
      ) : (
        <div className="mt-1.5 space-y-1 text-[11px] text-gray-300">
          {exec.activeCount > 0 && (
            <p>
              실행 큐에 <span className="text-white font-semibold">{exec.activeCount}건</span> 대기 중
              {exec.escalatedCount > 0 && <span className="text-red-300 font-medium"> · {exec.escalatedCount}건 3일+ 미실행 ⚠</span>}
            </p>
          )}
          {exec.previewCount > 0 && (
            <p>
              오늘 새로 생성 가능 <span className="text-white font-semibold">{exec.previewCount}건</span>
              <span className="text-gray-400">
                {' '}(
                {[
                  exec.previewEntry > 0 ? `진입 ${exec.previewEntry}` : null,
                  exec.previewPyramid > 0 ? `불타기 ${exec.previewPyramid}` : null,
                  exec.previewStop > 0 ? `손절 ${exec.previewStop}` : null,
                  exec.previewExit > 0 ? `청산 ${exec.previewExit}` : null,
                ].filter(Boolean).join(' · ')}
                )
              </span>
              {' '}— 「오늘 주문 생성」으로 확정
            </p>
          )}
          {exec.budgetMissing && exec.turtleCandidateCount > 0 && (
            <p className="text-amber-300">위성 예산 미설정 — 신규 진입은 검토되지 않습니다.</p>
          )}
          {exec.reviewFailed && (
            <p className="text-amber-300">자동 검토 실패 — 실행 큐에서 수동으로 생성하세요.</p>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={onOpenExecution}
        className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded bg-primary/90 hover:bg-primary text-white transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        실행 큐 열기
      </button>
    </div>
  ) : null;

  // 리스크 매트릭스 — 티어별 그룹
  const tieredRows = {
    red: riskMatrix.filter(r => r.assessment.tier === 'red'),
    amber: riskMatrix.filter(r => r.assessment.tier === 'amber'),
    blue: riskMatrix.filter(r => r.assessment.tier === 'blue'),
  };

  const renderAssetRow = (asset: AlertMatchedAsset) => {
    const isWatchlist = asset.source === 'watchlist';
    const tier = asset.distributionTier;
    const tierStyle = tier
      ? (tier.status === 'new' ? TIER_NEW_STYLES[tier.tier] : TIER_ONGOING_STYLES[tier.tier])
      : null;
    const isOngoing = tier?.status === 'ongoing';
    return (
      <tr
        key={`${asset.assetId}-${asset.source || 'p'}`}
        className={`border-b border-gray-800/30 last:border-b-0 cursor-pointer hover:bg-white/5 transition-colors ${
          isOngoing ? 'opacity-60' : ''
        }`}
        onClick={() => onAssetClick(asset.assetId, asset.source)}
        title={isWatchlist ? '클릭하면 관심종목으로 이동합니다' : '클릭하면 포트폴리오에서 해당 종목으로 이동합니다'}
      >
        <td className="py-1.5 pr-2 overflow-hidden">
          <div className="flex items-center gap-1 min-w-0">
            {isWatchlist && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-teal-600/30 text-teal-400 font-medium shrink-0">
                관심
              </span>
            )}
            {tierStyle && (
              <span className={`text-[9px] px-1 py-0.5 rounded font-medium shrink-0 ${tierStyle.bg}`}>
                {tierStyle.label}
              </span>
            )}
            <span className="text-white font-medium truncate">{asset.assetName}</span>
            <span className="text-gray-600 text-[10px] shrink-0">{asset.ticker}</span>
          </div>
        </td>
        <td className={`text-right py-1.5 px-1 tabular-nums ${pctColor(asset.dailyChange)}`}>
          {fmtPct(asset.dailyChange)}
        </td>
        <td className={`text-right py-1.5 px-1 tabular-nums ${pctColor(asset.returnPct)}`}>
          {fmtPct(asset.returnPct)}
        </td>
        <td className={`text-right py-1.5 pl-1 tabular-nums ${
          asset.rsi != null
            ? asset.rsi < 30 ? 'text-blue-400' : asset.rsi > 70 ? 'text-red-400' : 'text-gray-300'
            : 'text-gray-500'
        }`}>
          {asset.rsi != null ? asset.rsi.toFixed(1) : '-'}
        </td>
        <td className="py-1.5 pl-1">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </td>
      </tr>
    );
  };

  const renderSection = (sectionResults: AlertResult[], title: string, icon: React.ReactNode, titleColor: string, tooltip: string) => {
    if (sectionResults.length === 0) return null;
    return (
      <div>
        <h3 className={`text-xs font-semibold ${titleColor} mb-2 flex items-center gap-1.5`}>
          <Tooltip content={tooltip} wrap className="cursor-help">
            <span className="flex items-center gap-1.5">
              {icon}
              {title}
            </span>
          </Tooltip>
          <span className="text-gray-500 font-normal">
            ({sectionResults.reduce((sum, r) => sum + r.matchedAssets.length, 0)}종목)
          </span>
        </h3>
        <div className="space-y-2">
          {sectionResults.map(({ rule, matchedAssets }) => {
            const styles = SEVERITY_STYLES[rule.severity];

            // P4.5 D1: distribution-high 룰은 신규 자산을 위로, 지속 자산을 아래로 정렬
            let displayAssets = matchedAssets;
            let newCount = 0;
            let ongoingCount = 0;
            if (rule.id === 'distribution-high') {
              const newAssets = matchedAssets.filter(a => a.distributionTier?.status === 'new');
              const ongoingAssets = matchedAssets.filter(a => a.distributionTier?.status === 'ongoing');
              const untagged = matchedAssets.filter(a => !a.distributionTier);
              displayAssets = [...newAssets, ...ongoingAssets, ...untagged];
              newCount = newAssets.length;
              ongoingCount = ongoingAssets.length;
            }

            return (
              <div key={rule.id} className={`${styles.bg} border ${styles.border} rounded-lg p-2.5`}>
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  {BRIEFING_RULE_TOOLTIPS[rule.id] ? (
                    <Tooltip content={BRIEFING_RULE_TOOLTIPS[rule.id]} wrap className="cursor-help">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${styles.badge} text-white font-medium`}>
                        {rule.name}
                      </span>
                    </Tooltip>
                  ) : (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${styles.badge} text-white font-medium`}>
                      {rule.name}
                    </span>
                  )}
                  {rule.id === 'distribution-high' && (newCount > 0 || ongoingCount > 0) && (
                    <span className="text-[10px] flex items-center gap-1.5">
                      {newCount > 0 && <span className="text-amber-300 font-medium">신규 {newCount}건</span>}
                      {newCount > 0 && ongoingCount > 0 && <span className="text-gray-600">·</span>}
                      {ongoingCount > 0 && <span className="text-gray-500">지속 {ongoingCount}건</span>}
                    </span>
                  )}
                  <span className="text-gray-400 text-[11px]">{rule.description}</span>
                </div>
                <table className="w-full text-xs table-fixed">
                  <colgroup>
                    <col />
                    <col className="w-14" />
                    <col className="w-14" />
                    <col className="w-11" />
                    <col className="w-5" />
                  </colgroup>
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-700/50">
                      <th className="text-left py-1 pr-2 font-medium truncate">
                        <Tooltip content={BRIEFING_COLUMN_TOOLTIPS.asset} position="bottom" wrap className="cursor-help">
                          <span>종목</span>
                        </Tooltip>
                      </th>
                      <th className="text-right py-1 px-1 font-medium">
                        <Tooltip content={BRIEFING_COLUMN_TOOLTIPS.daily} position="bottom" wrap className="cursor-help">
                          <span>당일</span>
                        </Tooltip>
                      </th>
                      <th className="text-right py-1 px-1 font-medium">
                        <Tooltip content={BRIEFING_COLUMN_TOOLTIPS.return} position="bottom" wrap className="cursor-help">
                          <span>수익률</span>
                        </Tooltip>
                      </th>
                      <th className="text-right py-1 pl-1 font-medium">
                        <Tooltip content={BRIEFING_COLUMN_TOOLTIPS.rsi} position="bottom" wrap className="cursor-help">
                          <span>RSI</span>
                        </Tooltip>
                      </th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayAssets.map(renderAssetRow)}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 z-[60] w-auto sm:w-96 flex flex-col shadow-2xl rounded-xl border border-gray-700 overflow-hidden">
      {/* 헤더 — 클릭으로 최소화/복원 토글 */}
      <div
        className="bg-gray-900 px-4 py-3 flex items-center justify-between border-b border-gray-700 shrink-0 cursor-pointer select-none hover:bg-gray-800/60 transition-colors"
        onClick={() => setIsMinimized(v => !v)}
        title={isMinimized ? '펼치기' : '최소화'}
      >
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <div>
            <span className="text-sm font-semibold text-white">오늘의 투자 브리핑</span>
            {hasResults && (
              <span className="ml-2 text-xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-medium">
                {totalCount}건
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* 접기/펼치기 화살표 */}
          <span className="text-gray-400 p-1">
            {isMinimized ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </span>
          {/* 닫기 — 버블링 방지 */}
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="text-gray-400 hover:text-white transition p-1 rounded"
            title="닫기"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* 본문 (최소화 시 숨김) */}
      {!isMinimized && (
        <div className="bg-gray-900 flex flex-col" style={{ maxHeight: '70vh' }}>
          <p className="text-gray-500 text-[11px] px-4 pt-2">{today}</p>
          <div className="px-4 py-3 overflow-y-auto space-y-4 flex-1 min-h-0">
            {(hasResults || hasDataGaps) ? (
              <>
                {/* 터틀 실행 카드 — 행동 축 최상단 (실행할 게 있을 때만) */}
                {execCard}

                {/* 참고 지표 안내 — 실행할 주문의 단일 소스는 실행 큐 (Phase 5). CTA는 실행 카드가 있으면 중복이라 숨김 */}
                <div className="bg-gray-800/60 border border-gray-700/60 rounded-lg p-2.5">
                  <p className="text-[11px] text-gray-400 leading-snug">
                    <span className="text-gray-300 font-medium">이 브리핑은 참고 지표입니다.</span> 실제 실행할 주문(진입·손절·청산·리밸런싱·정리)은{' '}
                    <span className="text-gray-300">실행 큐</span>가 단일 기준입니다.
                  </p>
                  {!showExecCard && (
                    <button
                      type="button"
                      onClick={onOpenExecution}
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded bg-primary/90 hover:bg-primary text-white transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                      실행 큐 열기
                    </button>
                  )}
                </div>

                {/* 종합 리스크 매트릭스 — 클라이맥스 + 디스트리뷰션 합성 (예측 아닌 과열 경고). Phase 5: 기본 접힘 */}
                {riskTieredCount > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-amber-300 mb-2 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setRiskExpanded(v => !v)}
                        className="flex items-center gap-1 hover:text-amber-200 transition-colors"
                        aria-expanded={riskExpanded}
                        title={riskExpanded ? '접기' : '펼치기'}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 transition-transform ${riskExpanded ? '' : '-rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      <Tooltip content={BRIEFING_SECTION_TOOLTIPS.riskWarning} wrap className="cursor-help">
                        <span>⚠️ 과열 리스크 경고</span>
                      </Tooltip>
                      <span className="text-gray-500 font-normal">({riskTieredCount}종목)</span>
                      {riskExpanded && (
                        <Tooltip content={CLIMAX_SIGNAL_TOOLTIP} position="bottom" wrap className="cursor-help">
                          <span className="text-[10px] text-gray-500 font-normal underline decoration-dotted underline-offset-2">
                            클라이맥스란? ⓘ
                          </span>
                        </Tooltip>
                      )}
                    </h3>
                    {riskExpanded && (
                    <>
                    <div className="space-y-2">
                      {(['red', 'amber', 'blue'] as const).map(tier => {
                        const rows = tieredRows[tier];
                        if (rows.length === 0) return null;
                        const styles = RISK_TIER_STYLES[tier];
                        return (
                          <div key={tier} className={`${styles.bg} border ${styles.border} rounded-lg p-2.5`}>
                            <div className="flex items-center gap-2 mb-1.5">
                              <Tooltip content={RISK_TIER_TOOLTIPS[tier]} wrap className="cursor-help">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${styles.badge} font-medium`}>
                                  {styles.label}
                                </span>
                              </Tooltip>
                              <span className="text-gray-400 text-[11px]">{rows.length}종목</span>
                            </div>
                            <div className="space-y-1">
                              {rows.map(row => (
                                <div
                                  key={`${row.assetId}-${row.source}`}
                                  className="flex items-center justify-between text-xs cursor-pointer hover:bg-white/5 rounded px-1 py-0.5 transition-colors"
                                  onClick={() => onAssetClick(row.assetId, row.source)}
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
                    <p className="text-gray-500 text-[10px] mt-1.5 italic">참고용 경고이며 투자자문이 아닙니다. 예측이 아닌 과열 리스크 경고입니다.</p>
                    </>
                    )}
                  </div>
                )}

                {hasDataGaps && (
                  <div>
                    <h3 className="text-xs font-semibold text-orange-300 mb-2 flex items-center gap-1.5">
                      <span>🟠 데이터 불완전 — 수동 확인</span>
                      <span className="text-gray-500 font-normal">({dataGapAssetCount}종목)</span>
                    </h3>
                    <div className="space-y-2">
                      {sellDataGaps.map(gap => (
                        <div key={gap.rule.id} className="bg-orange-950/30 border border-orange-800/40 rounded-lg p-2.5">
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-600/80 text-white font-medium">{gap.rule.name}</span>
                            <span className="text-gray-400 text-[11px]">데이터 누락으로 매도 가드 평가 불가</span>
                          </div>
                          <div className="space-y-1">
                            {gap.affectedAssets.map(a => (
                              <div
                                key={a.assetId}
                                className="flex items-center justify-between text-xs cursor-pointer hover:bg-white/5 rounded px-1 py-0.5 transition-colors"
                                onClick={() => onAssetClick(a.assetId, 'portfolio')}
                                title="포트폴리오로 이동"
                              >
                                <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                                  <span className="text-white truncate">{a.assetName}</span>
                                  <span className="text-gray-600 text-[10px] shrink-0">{a.ticker}</span>
                                </div>
                                <span className="text-gray-500 text-[10px] shrink-0 ml-2">미평가 {a.missingFilters.length}개 조건</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-gray-500 text-[10px] mt-1.5 italic">발화가 아니라 "평가 불가" 알림입니다 — 데이터 보강 후 수동 확인하세요.</p>
                  </div>
                )}

                {renderSection(
                  sellResults,
                  '매도 감지',
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>,
                  'text-red-400',
                  BRIEFING_SECTION_TOOLTIPS.sell
                )}
                {renderSection(
                  buyResults,
                  '매수 기회',
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>,
                  'text-blue-400',
                  BRIEFING_SECTION_TOOLTIPS.buy
                )}
                <p className="text-gray-600 text-[10px] text-center pb-1">종목을 클릭하면 해당 탭으로 이동합니다</p>
              </>
            ) : (
              <>
                {/* 알림 발화 0건이어도 실행할 게 있으면 카드 표시 (게이트가 실행 축으로 will-show 가능) */}
                {execCard}
                <div className="text-center py-6">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mx-auto text-gray-600 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-gray-400 text-sm">현재 특이 시그널이 없습니다.</p>
                  <p className="text-gray-500 text-xs mt-1">모든 보유 종목이 정상 범위 내에 있습니다.</p>
                </div>
              </>
            )}
          </div>

          {/* "징후 ≠ 방아쇠" 고정 footer — 사용자 과신 방지 (스크롤되지 않음) */}
          {hasResults && (
            <div className="shrink-0 px-4 py-2 border-t border-gray-800 bg-gray-950/50">
              <p className="text-gray-500 text-[10px] leading-snug">
                <span className="text-gray-400">💡 과열 상태 알림</span>이지 폭락 시점 예측이 아닙니다.
                신호 후에도 며칠~몇 주는 계속 오를 수 있고, 실제 하락은 외부 악재가 방아쇠가 됩니다.
                분할매도 / 비중조절 참고용.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AlertPopup;
