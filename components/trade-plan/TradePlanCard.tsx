// components/trade-plan/TradePlanCard.tsx
// 활성 매매 계획 카드 — 렌더 전용(RULES.md §2). 값·등급은 evaluateTradePlan 결과(evaluation)를
// 그대로 표시하고, 손실 추정만 utils/tradePlanMarket.estimateTradePlanStopLoss(순수 함수)에 위임한다.
//
// P3: `variant="compact"`(오늘 화면 today/*Section 전용) — 헤드라인 행(종목명·행동문·현재가 vs
// 선 가격·수량) + 실행 줄만 기본 노출, 4선 상세/헤더/최근결정/데이터시각은 [자세히] 토글 뒤로 숨긴다.
// `variant` 생략 시(기존 TradePlanSection 소비처) 지금까지와 동일하게 전부 펼쳐 보인다.

import React, { useState } from 'react';
import { ArrowUpFromLine, Check, OctagonAlert, Target, TrendingDown, TriangleAlert } from 'lucide-react';
import { Currency } from '../../types';
import Tooltip from '../common/Tooltip';
import Badge, { type BadgeTone } from '../common/Badge';
import Button from '../common/Button';
import {
  consecutiveTomorrowCount,
  formatPlanPrice,
  nextPyramidStep,
} from '../../utils/tradePlan';
import { decisionHelpText, DECISION_REASON_PRESETS } from '../../utils/tradePlanLink';
import { estimateTradePlanStopLoss } from '../../utils/tradePlanMarket';
import type {
  PlanLineKey,
  PlanLineState,
  PlanLineStatus,
  TradePlan,
  TradePlanAnchor,
  TradePlanEvaluation,
} from '../../types/tradePlan';

const ANCHOR_LABELS: Record<TradePlanAnchor, string> = {
  today: '오늘가 기준',
  purchase: '매수가 기준',
  custom: '직접입력 기준',
};

// Stage C: 이모지 점 대신 lucide 아이콘 — 손절=위험(주황) / 익절·불타기=오름·매수 쪽(빨강) / 추세선 이탈=내림(파랑)
const LINE_ICON: Record<PlanLineKey, React.ReactNode> = {
  stop: <OctagonAlert className="h-4 w-4 text-warning" aria-hidden="true" />,
  takeProfit: <Target className="h-4 w-4 text-up" aria-hidden="true" />,
  exitLine: <TrendingDown className="h-4 w-4 text-down" aria-hidden="true" />,
  pyramid: <ArrowUpFromLine className="h-4 w-4 text-up" aria-hidden="true" />,
};

const LINE_ACTION_COPY: Record<PlanLineKey, string> = {
  stop: '여기 오면 전량 매도',
  takeProfit: '여기 오면 절반 매도',
  exitLine: '이탈 종가 확정 시 나머지 전량 매도',
  pyramid: '켜져 있으면 여기서 추가매수 검토',
};

const LINE_HELP: Record<PlanLineKey, string> = {
  stop: '손절선 = 계획의 안전장치입니다. 여기 닿으면 더 생각하지 않고 전량 매도해 큰 손실을 막습니다.',
  takeProfit: '익절선 = 손절폭의 배수만큼 오른 지점입니다. 절반만 팔아 이익을 확정하고 나머지는 더 태웁니다.',
  exitLine: '추세선 = 이동평균선입니다. 종가가 이 선 아래로 내려오면 상승 추세가 끝났다고 보고 나머지를 정리합니다.',
  pyramid: '불타기선 = 계획대로 오르고 있을 때만 추가매수를 검토하는 지점입니다. 내려갈 때 사는 물타기와는 다릅니다.',
};

const STATE_BADGE: Record<PlanLineState, { label: string; tone: BadgeTone }> = {
  // Stage B 색 규약: 선 도달 = 확인이 필요한 상태 → 주황(warning)+'도달' 문구. 빨강은 '오름' 전용.
  hit: { label: '도달', tone: 'warning' },
  near: { label: '근접', tone: 'warning' },
  waiting: { label: '대기', tone: 'neutral' },
  done: { label: '완료', tone: 'info' },
  disarmed: { label: '재돌파 대기', tone: 'neutral' },
  unavailable: { label: '확인 불가', tone: 'neutral' },
  inactive: { label: '미사용', tone: 'neutral' },
};

const DECISION_CHOICE_LABEL: Record<string, string> = {
  done: '실행함', skip: '건너뜀', tomorrow: '내일로 미룸',
};

function fmtKRW(n: number): string {
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
}

/** 컴팩트 헤드라인의 "현재가 vs 선 가격" 비교 대상 — 도달한 선, 없으면 근접한 선, 없으면 손절선. */
function primaryLineOf(lines: PlanLineStatus[]): PlanLineStatus | undefined {
  return lines.find(l => l.state === 'hit') ?? lines.find(l => l.state === 'near') ?? lines.find(l => l.key === 'stop');
}

/** 매매 계획 규칙의 백테스트 근거 한 줄 — 카드 목록 컨테이너가 화면당 1회만 표시한다 */
export const TRADE_PLAN_BASIS_NOTE =
  '근거: 백테스트에서 이 규칙은 큰 하락을 절반 이하로 줄였지만 수익률은 그냥 들고 있는 것보다 낮았습니다.';

export interface TradePlanCardProps {
  currency: Currency;
  plan: TradePlan;
  evaluation: TradePlanEvaluation;
  /** market.priceAsOf/isIntraday — 데이터 기준 시각 표시용 */
  priceAsOf: string;
  isIntraday: boolean;
  fxRateToKRW: number | null;
  onEdit: () => void;
  onClear: () => void;
  onArmExit: () => void;
  onToggleBrokerStop: (registered: boolean) => void;
  /**
   * 실행 버튼(P2b) — 넘기지 않으면 그 버튼이 렌더되지 않는다.
   * 관심종목(아직 보유 전) 카드는 넷 다 생략해 실행 줄 자체가 사라진다.
   */
  onSellRecord?: () => void;
  onBuyMoreRecord?: () => void;
  onSkip?: (reason: string) => void;
  onTomorrow?: () => void;
  className?: string;
  /**
   * 'compact'(P3, 오늘 화면) — 헤드라인 행 + 실행 줄만 기본 노출, 나머지는 [자세히] 뒤로 숨김.
   * 생략하면 기존과 동일하게 'full'(항상 펼침).
   */
  variant?: 'full' | 'compact';
  /** compact 헤드라인에 쓰는 종목명 — variant='compact'일 때만 참조 */
  assetName?: string;
  /** compact 헤드라인 "현재가 vs 선 가격" — market.price(원통화). null=시세 없음 */
  currentPrice?: number | null;
}

const TradePlanCard: React.FC<TradePlanCardProps> = ({
  currency, plan, evaluation, priceAsOf, isIntraday, fxRateToKRW,
  onEdit, onClear, onArmExit, onToggleBrokerStop,
  onSellRecord, onBuyMoreRecord, onSkip, onTomorrow, className = '',
  variant = 'full', assetName, currentPrice,
}) => {
  const isCompact = variant === 'compact';
  const lossEstimate = estimateTradePlanStopLoss(plan, fxRateToKRW);
  const py = nextPyramidStep(plan);
  const lastDecision = plan.decisions.length > 0 ? plan.decisions[plan.decisions.length - 1] : null;
  const tomorrowStreak = lastDecision ? consecutiveTomorrowCount(plan, lastDecision.signal) : 0;

  // 실행 줄(P2b). 미룸 경고는 **지금 신호** 기준 — 아래 '최근 결정'의 마지막 결정 기준과는 축이 다르다.
  const [skipping, setSkipping] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  // compact는 기본 접힘(헤드라인만), full은 항상 펼침 — 이 state는 compact에서만 참조된다.
  const [detailOpen, setDetailOpen] = useState(false);
  const currentSignalStreak = consecutiveTomorrowCount(plan, evaluation.signal);
  const helpText = decisionHelpText(evaluation.signal);
  const showDecisionButtons = !!(onSkip || onTomorrow) && evaluation.tier !== 'none';
  const showSellButton = !!onSellRecord && (evaluation.action === 'sell-all' || evaluation.action === 'sell-half');
  const showBuyButton = !!onBuyMoreRecord && evaluation.action === 'buy-add';
  const showDetail = !isCompact || detailOpen;

  const primaryLine = primaryLineOf(evaluation.lines);

  const compactHeadline = isCompact && (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold text-white text-sm">{assetName}</span>
          <span className="text-xs text-gray-300">{evaluation.sentence}</span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          현재 {currentPrice != null ? formatPlanPrice(currentPrice, currency) : '시세 없음'}
          {primaryLine && primaryLine.price !== null && (
            <> vs {primaryLine.label} {formatPlanPrice(primaryLine.price, currency)}</>
          )}
          {' · '}수량 {lossEstimate.remainingQuantity.toLocaleString('ko-KR')}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button type="button" onClick={onEdit} className="text-xs text-primary-light hover:underline">수정</button>
        <button
          type="button"
          onClick={() => setDetailOpen(v => !v)}
          className="text-xs text-gray-400 hover:text-gray-200"
          aria-expanded={detailOpen}
        >
          {detailOpen ? '접기' : '자세히'}
        </button>
      </div>
    </div>
  );

  const headerRow = !isCompact && (
    <div className="flex items-start justify-between gap-2">
      <div className="text-xs text-gray-400">
        매매 계획 · 기준 {plan.anchorDate.slice(5)} {ANCHOR_LABELS[plan.anchor]} {formatPlanPrice(plan.anchorPrice, currency)}
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <button type="button" onClick={onEdit} className="text-xs text-primary-light hover:underline">수정</button>
        <button type="button" onClick={onClear} className="text-xs text-gray-400 hover:text-danger hover:underline">해제</button>
      </div>
    </div>
  );

  const linesBlock = (
    <div className="space-y-2">
      {evaluation.lines.map(line => {
        const badge = STATE_BADGE[line.state];
        return (
          <div key={line.key} className="border-t border-gray-800 pt-2 first:border-t-0 first:pt-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="inline-flex shrink-0">{LINE_ICON[line.key]}</span>
              <Tooltip content={LINE_HELP[line.key]} position="top">
                <span className="font-medium text-gray-200 cursor-help border-b border-dotted border-gray-500">
                  {line.label}
                  {line.key === 'exitLine' && plan.exitLine.kind === 'ma' && ` ${plan.exitLine.period}일 이평`}
                </span>
              </Tooltip>
              {line.price !== null ? (
                <span className="text-gray-300">{formatPlanPrice(line.price, currency)}</span>
              ) : (
                line.key === 'pyramid' && !plan.pyramid.enabled ? <span className="text-gray-500">안 함</span> : null
              )}
              {line.distancePct !== null && (
                // 여유% = 선까지 남은 거리(위험 지표) — 방향 색이 아니라 주황(warning)으로 고정
                <span className="text-warning">
                  여유 {line.distancePct >= 0 ? '+' : ''}{line.distancePct.toFixed(1)}%
                </span>
              )}
              <Badge tone={badge.tone}>{badge.label}</Badge>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              → {LINE_ACTION_COPY[line.key]}
              {line.note && ` · ${line.note}`}
              {line.key === 'pyramid' && plan.pyramid.enabled && py && ` (${py.level}차 · 계획 ${py.plannedQuantity}${py.plannedQuantity > 0 ? '주' : ''})`}
            </p>

            {line.key === 'stop' && (
              <div className="mt-1 space-y-1">
                {lossEstimate.worstLossKRW !== null && lossEstimate.worstLossPct !== null ? (
                  <p className="text-xs text-gray-500">
                    예상 손실 {fmtKRW(lossEstimate.worstLossKRW)} (총자산 {Math.abs(lossEstimate.worstLossPct).toFixed(2)}%)
                    {lossEstimate.adverseLossKRW !== null && ` · 갭 하락 시 ${fmtKRW(lossEstimate.adverseLossKRW)}`}
                  </p>
                ) : (
                  <p className="text-xs text-gray-500">환율 없음 — 손실 금액을 계산할 수 없습니다</p>
                )}
                {!plan.brokerStopOrderRegistered ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-warning inline-flex items-center gap-1"><TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />증권사 손절 예약주문 미등록</span>
                    <Button variant="warning" onClick={() => onToggleBrokerStop(true)}>
                      등록했어요
                    </Button>
                  </div>
                ) : (
                  <span className="text-xs text-ok inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" aria-hidden="true" />증권사 손절 예약주문 등록됨</span>
                )}
              </div>
            )}

            {line.key === 'exitLine' && evaluation.action === 'arm-exit' && (
              <Button variant="secondary" onClick={onArmExit} className="mt-1">
                적용 시작
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );

  const actionBlock = (showSellButton || showBuyButton || showDecisionButtons) && (
    <div className="border-t border-gray-800 pt-2 space-y-1.5">
      {helpText && <p className="text-xs text-warning">{helpText}</p>}
      {showDecisionButtons && currentSignalStreak >= 3 && (
        <p className="text-xs text-warning flex items-start gap-1">
          <TriangleAlert className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden="true" />
          <span>{currentSignalStreak}번째 미루고 있습니다 — 계획을 바꿀지, 지킬지 지금 정하세요</span>
        </p>
      )}
      {/* 카드당 primary 1개 — 매도 기록/추가매수 기록은 action 이 서로 배타(sell-* vs buy-add)라 동시에 뜨지 않는다 */}
      <div className="flex items-center gap-2 flex-wrap">
        {showSellButton && (
          <Button variant="primary" onClick={onSellRecord}>
            매도 기록
          </Button>
        )}
        {showBuyButton && (
          <Button variant="primary" onClick={onBuyMoreRecord}>
            추가매수 기록
          </Button>
        )}
        {showDecisionButtons && !skipping && (
          <>
            {onSkip && (
              <Button variant="secondary" onClick={() => setSkipping(true)}>
                건너뜀
              </Button>
            )}
            {onTomorrow && (
              <Button variant="ghost" onClick={onTomorrow}>
                내일
              </Button>
            )}
          </>
        )}
      </div>

      {showDecisionButtons && skipping && onSkip && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {DECISION_REASON_PRESETS.map(preset => (
              <Button key={preset} variant="ghost" onClick={() => setSkipReason(preset)}>
                {preset}
              </Button>
            ))}
          </div>
          <input
            type="text"
            value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)}
            placeholder="사유를 입력하세요"
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { setSkipping(false); setSkipReason(''); }}>
              취소
            </Button>
            <Button
              variant="primary"
              disabled={skipReason.trim() === ''}
              onClick={() => { onSkip(skipReason.trim()); setSkipping(false); setSkipReason(''); }}
            >
              확인
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  const lastDecisionBlock = lastDecision && (
    <p className="text-xs text-gray-500 border-t border-gray-800 pt-2">
      최근 결정: {lastDecision.date.slice(5)} {DECISION_CHOICE_LABEL[lastDecision.choice] ?? lastDecision.choice}
      {tomorrowStreak >= 3 && (
        <span className="ml-1.5 text-warning"><TriangleAlert className="inline h-3.5 w-3.5 mr-0.5 align-[-3px]" aria-hidden="true" />{tomorrowStreak}번째 미루고 있습니다 — 계획을 바꿀지, 지킬지 지금 정하세요</span>
      )}
    </p>
  );

  const timestampBlock = (
    <p className={`text-xs ${evaluation.stale ? 'text-warning' : 'text-gray-500'} border-t border-gray-800 pt-2`}>
      데이터 {priceAsOf.slice(5)} {isIntraday ? '장중' : '확정'}
      {evaluation.stale && ' — 시세가 오래됐습니다. 새로고침 후 확인하세요.'}
    </p>
  );

  // 근거·면책 문구는 카드마다 반복하지 않는다(Stage C) — 종목 아코디언은 TradePlanSection 하단 1회,
  // 홈 브리핑 목록은 DashboardView 하단 통합 면책 한 줄이 대신한다. (TRADE_PLAN_BASIS_NOTE)

  return (
    <div className={`bg-gray-900/50 border border-border-subtle rounded-card p-3.5 space-y-3 text-sm ${className}`}>
      {compactHeadline}
      {showDetail && headerRow}
      {showDetail && linesBlock}
      {actionBlock}
      {showDetail && lastDecisionBlock}
      {showDetail && timestampBlock}
    </div>
  );
};

export default TradePlanCard;
