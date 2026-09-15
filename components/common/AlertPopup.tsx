import React, { useState } from 'react';
import type { AlertResult, AlertMatchedAsset, AlertDataGap } from '../../types/alertRules';
import type { DistributionTier } from '../../utils/distributionTierState';
import type { TurtleReviewSummary } from '../../utils/turtleReview';
import Tooltip from './Tooltip';
import { Bell, ChevronDown, ChevronRight, ChevronUp, CircleCheck, Lightbulb, OctagonAlert, TrendingDown, TrendingUp, TriangleAlert, Turtle, X } from 'lucide-react';
import { clickableProps, onActivateKey } from './a11yKeys';
import {
  BRIEFING_SECTION_TOOLTIPS,
  BRIEFING_COLUMN_TOOLTIPS,
  BRIEFING_RULE_TOOLTIPS,
} from '../../constants/briefingDescriptions';
import { DISTRIBUTION_TIER_BADGE } from '../../constants/stateColorLadders';

// P4.5 D1: distribution-high 단계별 뱃지 — 'new'는 컬러, 'ongoing'은 회색
// Stage D2: 'new' 채움 색은 사다리 상수(constants/stateColorLadders) — 4단계 흰 글자 3.92(AA 미달) 교정
const TIER_NEW_STYLES: Record<DistributionTier, { bg: string; label: string }> = {
  3: { bg: DISTRIBUTION_TIER_BADGE[3], label: '주의 (3)' },
  4: { bg: DISTRIBUTION_TIER_BADGE[4], label: '약세 (4)' },
  5: { bg: DISTRIBUTION_TIER_BADGE[5], label: '위험 (5+)' },
};

const TIER_ONGOING_STYLES: Record<DistributionTier, { bg: string; label: string }> = {
  3: { bg: 'bg-gray-700/60 text-gray-400', label: '지속 (3)' },
  4: { bg: 'bg-gray-700/60 text-gray-400', label: '지속 (4)' },
  5: { bg: 'bg-gray-700/60 text-gray-400', label: '지속 (5+)' },
};

interface AlertPopupProps {
  results: AlertResult[];
  /** fail-safe(매도 data-gap) — 데이터 누락으로 평가 불가였던 매도 규칙·종목. 발화 아님(주의 노출용) */
  sellDataGaps: AlertDataGap[];
  /** 터틀 실행 요약 (자동 검토 Phase A/B) — 실행 큐 대기 + 오늘 생성 가능. 실행할 게 있을 때만 카드 표시 */
  executionSummary: TurtleReviewSummary;
  /** 활성 매매 계획이 있는 자산 id 집합(P3, App.tsx 계산) — "계획 기준 우선" 배지 표시 전용 */
  planPriorityAssetIds?: Set<string>;
  onClose: () => void;
  onAssetClick: (assetId: string, source?: 'portfolio' | 'watchlist') => void;
  /** 홈 탭으로 이동 + 맨 위 스크롤 (Stage A — '오늘' 탭 폐지, 행동 신호의 단일 소스는 홈 '오늘의 브리핑'의 대기 주문 섹션) */
  onOpenExecution: () => void;
}

// Stage D2 색 규약 — critical 은 warning 과 같은 토큰 계열. 구분은 불투명 border-warning + OctagonAlert + font-semibold.
// 배지 = 흰 글자 채움(-strong: warning 5.02 / info 5.93). 글자 굵기도 여기서 정한다(배지 span 에 font-* 를 겹치지 않게).
// 틴트(-soft) 위 보조 글자는 text-gray-400(#1E1E1E 합성 4.97) — gray-500 은 4.19 로 AA 미달이라 카드 안에서 쓰지 않는다.
const SEVERITY_STYLES: Record<string, { bg: string; border: string; badge: string }> = {
  critical: { bg: 'bg-warning-soft', border: 'border-warning', badge: 'bg-warning-strong font-semibold' },
  warning: { bg: 'bg-warning-soft', border: 'border-warning/30', badge: 'bg-warning-strong font-medium' },
  info: { bg: 'bg-info-soft', border: 'border-info/30', badge: 'bg-info-strong font-medium' },
};

const fmtPct = (v: number | undefined): string => {
  if (v == null) return '-';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
};

const pctColor = (v: number | undefined): string => {
  if (v == null) return 'text-gray-400';
  if (v > 0) return 'text-up';
  if (v < 0) return 'text-down';
  return 'text-gray-400';
};

const AlertPopup: React.FC<AlertPopupProps> = ({ results, sellDataGaps, executionSummary, planPriorityAssetIds, onClose, onAssetClick, onOpenExecution }) => {
  const [isMinimized, setIsMinimized] = useState(false);

  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
  });

  const sellResults = results.filter(r => r.rule.action === 'sell');
  const buyResults = results.filter(r => r.rule.action === 'buy');
  const hasResults = results.length > 0;
  const totalCount = results.reduce((sum, r) => sum + r.matchedAssets.length, 0);
  // fail-safe(매도 data-gap) — 발화가 아니라 '데이터 누락으로 평가 불가'. 발화 알림과 별개 주의 섹션으로 표시.
  const hasDataGaps = sellDataGaps.length > 0;
  const dataGapAssetCount = new Set(sellDataGaps.flatMap(g => g.affectedAssets.map(a => a.assetId))).size;

  // 터틀 실행 카드 (자동 검토 Phase A/B) — 실행할 게 있거나 검토 진행 중일 때만. 신호(참고)와 별개의 "행동" 축.
  const exec = executionSummary;
  // 잠긴 터틀은 실행 가능 건수에서 이미 빠져 있다(utils/turtleReview 합성 지점).
  // 잠금 기록만 있고 실행 가능 건이 없으면 카드를 띄우지 않는다 — 행동할 수 없는 걸 재촉하지 않기 위함.
  const showExecCard = exec.actionableCount > 0 || exec.isChecking;
  const hasSellSignalPreview = exec.previewStop > 0 || exec.previewExit > 0;
  // 손절·청산 프리뷰 또는 3일+ 미실행 = 강한 위험 — Stage D2: 불투명 border-warning + OctagonAlert (색만으로 구분하지 않음)
  const execRisky = hasSellSignalPreview || exec.escalatedCount > 0;
  const execCard = showExecCard ? (
    <div className={`rounded-lg border p-2.5 ${execRisky ? 'border-warning bg-warning-soft' : 'border-primary/40 bg-primary/10'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-white inline-flex items-center gap-1">
          <Turtle className="h-3.5 w-3.5" aria-hidden="true" />터틀 실행 대기
          {execRisky && <OctagonAlert className="h-3.5 w-3.5 text-warning" aria-label="위험: 손절·청산 또는 3일+ 미실행" />}
        </span>
        {exec.checkedAt && <span className="text-xs text-gray-400">{exec.checkedAt} 검토 기준</span>}
      </div>
      {exec.isChecking ? (
        <p className="text-xs text-gray-400 mt-1.5">오늘 신호를 자동 검토하는 중입니다...</p>
      ) : (
        <div className="mt-1.5 space-y-1 text-xs text-gray-300">
          {exec.activeCount > 0 && (
            <p>
              홈 브리핑에 <span className="text-white font-semibold">{exec.activeCount}건</span> 대기 중
              {exec.escalatedCount > 0 && <span className="text-warning font-medium"> · {exec.escalatedCount}건 3일+ 미실행 <TriangleAlert className="inline h-3 w-3 align-[-2px]" aria-label="경고" /></span>}
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
          {/* 잠긴 터틀 기록 — 허용된 문구만. 실행 가능 건수·프리뷰로 세지 않는다. */}
          {exec.lockedCount > 0 && (
            <p className="text-gray-400">기존 터틀 기록 {exec.lockedCount}건 · 현재 실행 잠금</p>
          )}
          {/* 예산 미설정 안내는 진입 검토가 실제로 돌 때만 의미가 있다(잠금 중엔 검토 자체를 안 함) */}
          {!exec.turtleLocked && exec.budgetMissing && exec.turtleCandidateCount > 0 && (
            <p className="text-warning">위성 예산 미설정 — 신규 진입은 검토되지 않습니다.</p>
          )}
          {!exec.turtleLocked && exec.reviewFailed && (
            <p className="text-warning">자동 검토 실패 — 홈 브리핑에서 수동으로 생성하세요.</p>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={onOpenExecution}
        className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded bg-primary/90 hover:bg-primary text-white transition-colors"
      >
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        홈에서 보기
      </button>
    </div>
  ) : null;

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
        className={`border-b border-gray-800/30 last:border-b-0 cursor-pointer hover:bg-white/5 transition-colors focus-ring ${
          isOngoing ? 'opacity-60' : ''
        }`}
        {...clickableProps(() => onAssetClick(asset.assetId, asset.source))}
        aria-label={`${asset.assetName} ${isWatchlist ? '관심종목으로' : '보유자산으로'} 이동`}
        title={isWatchlist ? '클릭하면 관심종목으로 이동합니다' : '클릭하면 포트폴리오에서 해당 종목으로 이동합니다'}
      >
        <td className="py-1.5 pr-2 overflow-hidden">
          <div className="flex items-center gap-1 min-w-0">
            {isWatchlist && (
              <span className="text-xs px-1 py-0.5 rounded whitespace-nowrap bg-teal-600/30 text-teal-400 font-medium shrink-0">
                관심
              </span>
            )}
            {tierStyle && (
              <span className={`inline-flex items-center gap-0.5 text-xs px-1 py-0.5 rounded whitespace-nowrap font-medium shrink-0 ${tierStyle.bg}`}>
                {tier?.tier === 5 && tier.status === 'new' && <OctagonAlert className="h-3 w-3" aria-hidden="true" />}
                {tierStyle.label}
              </span>
            )}
            {planPriorityAssetIds?.has(asset.assetId) && (
              <span className="text-xs px-1 py-0.5 rounded whitespace-nowrap bg-primary/20 text-primary-light font-medium shrink-0" title="이 종목은 활성 매매 계획이 있습니다 — 계획 기준(홈 '오늘의 브리핑')이 우선입니다">
                계획 기준 우선
              </span>
            )}
            <span className="text-white font-medium truncate">{asset.assetName}</span>
            <span className="text-gray-400 text-xs shrink-0">{asset.ticker}</span>
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
            ? asset.rsi < 30 ? 'text-down' : asset.rsi > 70 ? 'text-up' : 'text-gray-300'
            : 'text-gray-400'
        }`}>
          {asset.rsi != null ? asset.rsi.toFixed(1) : '-'}
        </td>
        <td className="py-1.5 pl-1">
          <ChevronRight className="h-3 w-3 text-gray-500" aria-hidden="true" />
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
            // Stage B 색 규약: 매수 기회 카드는 빨강(up) 틴트, 위험(critical)은 주황+아이콘. 배지 색은 severity 유지
            const severityStyles = SEVERITY_STYLES[rule.severity];
            const styles = rule.action === 'buy' ? { ...severityStyles, bg: 'bg-up-soft', border: 'border-up/30' } : severityStyles;

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
                      <span className={`text-xs px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${styles.badge} text-white`}>
                        {rule.severity === 'critical' && <OctagonAlert className="h-3 w-3" aria-hidden="true" />}
                        {rule.name}
                      </span>
                    </Tooltip>
                  ) : (
                    <span className={`text-xs px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${styles.badge} text-white`}>
                      {rule.severity === 'critical' && <OctagonAlert className="h-3 w-3" aria-hidden="true" />}
                      {rule.name}
                    </span>
                  )}
                  {rule.id === 'distribution-high' && (newCount > 0 || ongoingCount > 0) && (
                    <span className="text-xs flex items-center gap-1.5">
                      {newCount > 0 && <span className="text-warning font-medium">신규 {newCount}건</span>}
                      {newCount > 0 && ongoingCount > 0 && <span className="text-gray-400">·</span>}
                      {ongoingCount > 0 && <span className="text-gray-400">지속 {ongoingCount}건</span>}
                    </span>
                  )}
                  <span className="text-gray-400 text-xs">{rule.description}</span>
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
                    <tr className="text-gray-400 border-b border-gray-700/50">
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

  // P6: 모바일은 하단 탭바(BottomTabBar) 위로 띄운다
  return (
    <div className="fixed bottom-20 left-4 right-4 mb-[env(safe-area-inset-bottom)] md:bottom-4 sm:left-auto sm:right-4 z-popup w-auto sm:w-96 flex flex-col shadow-2xl rounded-xl border border-border-subtle overflow-hidden">
      {/* 헤더 — 클릭으로 최소화/복원 토글 */}
      <div
        className="bg-surface-elevated px-4 py-3 flex items-center justify-between border-b border-border-subtle shrink-0 cursor-pointer select-none hover:bg-surface-muted transition-colors focus-ring"
        role="button"
        tabIndex={0}
        aria-expanded={!isMinimized}
        onClick={() => setIsMinimized(v => !v)}
        onKeyDown={onActivateKey(() => setIsMinimized(v => !v))}
        title={isMinimized ? '펼치기' : '최소화'}
      >
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-warning shrink-0" aria-hidden="true" />
          <div>
            <span className="text-sm font-semibold text-white">알림 브리핑</span>
            {hasResults && (
              <span className="ml-2 text-xs bg-warning-soft text-warning px-1.5 py-0.5 rounded-full font-medium">
                {totalCount}건
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* 접기/펼치기 화살표 */}
          <span className="text-gray-400 p-1">
            {isMinimized ? (
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          {/* 닫기 — 버블링 방지 */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="text-gray-400 hover:text-white transition p-1 rounded focus-ring"
            title="닫기"
            aria-label="알림 브리핑 닫기"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* 본문 (최소화 시 숨김) */}
      {!isMinimized && (
        <div className="bg-surface-elevated flex flex-col" style={{ maxHeight: '70vh' }}>
          <p className="text-gray-500 text-xs px-4 pt-2">{today}</p>
          <div className="px-4 py-3 overflow-y-auto space-y-4 flex-1 min-h-0">
            {(hasResults || hasDataGaps) ? (
              <>
                {/* 터틀 실행 카드 — 행동 축 최상단 (실행할 게 있을 때만) */}
                {execCard}

                {/* 참고 지표 안내 — 실행할 주문의 단일 소스는 홈 '오늘의 브리핑' 대기 주문 섹션(Stage A). CTA는 실행 카드가 있으면 중복이라 숨김 */}
                <div className="bg-surface-muted border border-border-subtle rounded-lg p-2.5">
                  <p className="text-xs text-gray-400 leading-snug">
                    <span className="text-gray-300 font-medium">이 브리핑은 참고 지표입니다.</span> 실제 실행할 주문(진입·손절·청산·리밸런싱·정리)은{' '}
                    <span className="text-gray-300">홈의 오늘의 브리핑</span>이 단일 기준입니다.
                  </p>
                  {!showExecCard && (
                    <button
                      type="button"
                      onClick={onOpenExecution}
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded bg-primary/90 hover:bg-primary text-white transition-colors"
                    >
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      홈에서 보기
                    </button>
                  )}
                </div>

                {/* P6 정보 다이어트: 리스크 매트릭스 배너는 여기서 제거됐다 — 대시보드
                    "참고 지표"(components/dashboard/ReferenceIndicatorsSection.tsx)와
                    내용이 완전히 중복이었다. 계산·저장은 무변경, 표시 위치만 하나로 합쳤다. */}

                {hasDataGaps && (
                  <div>
                    <h3 className="text-xs font-semibold text-warning mb-2 flex items-center gap-1.5">
                      <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>데이터 불완전 — 수동 확인</span>
                      <span className="text-gray-500 font-normal">({dataGapAssetCount}종목)</span>
                    </h3>
                    <div className="space-y-2">
                      {sellDataGaps.map(gap => (
                        <div key={gap.rule.id} className="bg-warning-soft border border-warning/30 rounded-lg p-2.5">
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <span className="text-xs px-1.5 py-0.5 rounded bg-warning-strong text-white font-medium">{gap.rule.name}</span>
                            <span className="text-gray-400 text-xs">데이터 누락으로 매도 가드 평가 불가</span>
                          </div>
                          <div className="space-y-1">
                            {gap.affectedAssets.map(a => (
                              <button
                                type="button"
                                key={a.assetId}
                                className="w-full text-left flex items-center justify-between text-xs cursor-pointer hover:bg-white/5 rounded px-1 py-0.5 transition-colors focus-ring"
                                onClick={() => onAssetClick(a.assetId, 'portfolio')}
                                title="포트폴리오로 이동"
                              >
                                <span className="flex items-center gap-1 min-w-0 overflow-hidden">
                                  <span className="text-white truncate">{a.assetName}</span>
                                  <span className="text-gray-400 text-xs shrink-0">{a.ticker}</span>
                                </span>
                                <span className="text-gray-400 text-xs shrink-0 ml-2">미평가 {a.missingFilters.length}개 조건</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-gray-500 text-xs mt-1.5 italic">발화가 아니라 "평가 불가" 알림입니다 — 데이터 보강 후 수동 확인하세요.</p>
                  </div>
                )}

                {renderSection(
                  sellResults,
                  '매도 감지',
                  <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />,
                  'text-down',
                  BRIEFING_SECTION_TOOLTIPS.sell
                )}
                {renderSection(
                  buyResults,
                  '매수 기회',
                  <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />,
                  'text-up',
                  BRIEFING_SECTION_TOOLTIPS.buy
                )}
                <p className="text-gray-500 text-xs text-center pb-1">종목을 클릭하면 해당 탭으로 이동합니다</p>
              </>
            ) : (
              <>
                {/* 알림 발화 0건이어도 실행할 게 있으면 카드 표시 (게이트가 실행 축으로 will-show 가능) */}
                {execCard}
                <div className="text-center py-6">
                  <CircleCheck className="h-10 w-10 mx-auto text-gray-500 mb-2" aria-hidden="true" />
                  <p className="text-gray-400 text-sm">현재 특이 시그널이 없습니다.</p>
                  <p className="text-gray-500 text-xs mt-1">모든 보유 종목이 정상 범위 내에 있습니다.</p>
                </div>
              </>
            )}
          </div>

          {/* "징후 ≠ 방아쇠" 고정 footer — 사용자 과신 방지 (스크롤되지 않음) */}
          {hasResults && (
            <div className="shrink-0 px-4 py-2 border-t border-border-subtle bg-surface">
              <p className="text-gray-500 text-xs leading-snug">
                <span className="text-gray-400 inline-flex items-center gap-1 align-[-2px]"><Lightbulb className="h-3 w-3" aria-hidden="true" />과열 상태 알림</span>이지 폭락 시점 예측이 아닙니다.
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
