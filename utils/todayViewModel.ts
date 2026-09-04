// utils/todayViewModel.ts
// ---------------------------------------------------------------------------
// "오늘" 화면(P3, 계획서 §4.3)의 표시 모델 — 전부 순수 함수. 입력은 이미 계산된
// 파생값(hooks/useTradePlanSignals의 rows/summary, useAutoAlert의 alertResults,
// useAutoAlert의 riskMatrix, data.actionQueue)이고, 여기서는 그룹핑·문구 조립만 한다.
// 계산 재구현 금지(신호/등급 판정은 utils/tradePlan.evaluateTradePlan이 유일한 소스).
//
// components/layouts/TodayView.tsx + components/today/* 가 소비한다 — 렌더는 컴포넌트,
// 계산은 여기(RULES.md §2).

import type { TradePlanSignalRow } from '../hooks/useTradePlanSignals';
import type { TradePlanSignalSummary } from './tradePlanMarket';
import type { PlanAction } from '../types/tradePlan';
import type { AlertResult } from '../types/alertRules';
import type { RiskMatrixRow } from './riskMatrix';
import type { ActionItem } from '../types/actionQueue';
import { isActiveAction } from '../types/actionQueue';

// ═══════════════════════════════════════════════════════════════════════════
// 1. 오늘 할 일 한 줄 요약
// ═══════════════════════════════════════════════════════════════════════════

/** evaluation.action → 헤드라인용 짧은 행동 명사구. */
const ACTION_SHORT_LABEL: Record<PlanAction, string> = {
  'sell-all': '전량 매도',
  'sell-half': '절반 매도',
  'buy-add': '추가매수 검토',
  'arm-exit': '추세선 확인',
  check: '확인',
  wait: '확인',
  none: '확인',
};

export interface TodayHeadline {
  /** 긴급+오늘 실행 등급 합계 */
  count: number;
  text: string;
}

/** 헤드라인에 이름을 나열할 최대 종목 수 (넘으면 "외 N"). */
const HEADLINE_MAX_NAMES = 3;

const EMPTY_HEADLINE_TEXT = '오늘은 할 일이 없습니다. 기다리는 것도 계획입니다.';

/**
 * 오늘 화면 최상단 한 줄 요약. 긴급+오늘 실행 등급 행만 대상 —
 * '풍산 전량 매도 · NAVER 절반 매도' 식으로 최대 3개, 넘으면 '외 N'.
 * 두 등급 합계가 0이면 빈 상태 문구.
 */
export function buildTodayHeadline(rows: TradePlanSignalRow[], summary: TradePlanSignalSummary): TodayHeadline {
  const count = summary.urgent + summary.today;
  if (count === 0) {
    return { count: 0, text: EMPTY_HEADLINE_TEXT };
  }
  const actionable = rows.filter(r => r.evaluation.tier === 'urgent' || r.evaluation.tier === 'today');
  const shown = actionable.slice(0, HEADLINE_MAX_NAMES);
  const names = shown.map(r => `${r.asset.name} ${ACTION_SHORT_LABEL[r.evaluation.action]}`);
  const remaining = actionable.length - shown.length;
  const namesText = remaining > 0 ? `${names.join(' · ')} 외 ${remaining}` : names.join(' · ');
  return { count, text: `오늘 할 일 ${count}건 — ${namesText}` };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. 등급별 그룹핑
// ═══════════════════════════════════════════════════════════════════════════

export interface TieredRows {
  urgent: TradePlanSignalRow[];
  today: TradePlanSignalRow[];
  prepare: TradePlanSignalRow[];
  /** tier==='none' — 대기 중(신호 없음) */
  waiting: TradePlanSignalRow[];
}

/** 활성 계획 평가 행을 등급별로 나눈다. 입력 순서(긴급→오늘→준비→여유% 오름차순)는 보존. */
export function groupRowsByTier(rows: TradePlanSignalRow[]): TieredRows {
  const result: TieredRows = { urgent: [], today: [], prepare: [], waiting: [] };
  for (const row of rows) {
    switch (row.evaluation.tier) {
      case 'urgent': result.urgent.push(row); break;
      case 'today': result.today.push(row); break;
      case 'prepare': result.prepare.push(row); break;
      default: result.waiting.push(row);
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. 확인 필요(시세 결측/오래됨/손절주문 미등록)
// ═══════════════════════════════════════════════════════════════════════════

export interface NeedsCheckRows {
  /** 시세 결측(evaluation.signal==='unavailable') */
  unavailable: TradePlanSignalRow[];
  /** 시세가 세션일보다 오래됨(evaluation.stale) */
  stale: TradePlanSignalRow[];
  /** 증권사 손절 예약주문 미등록 */
  brokerStopMissing: TradePlanSignalRow[];
}

/** 세 목록은 서로 배타적이지 않을 수 있다(예: 손절주문 미등록 + 시세 결측 동시) — 각자 독립 필터. */
export function needsCheckRows(rows: TradePlanSignalRow[]): NeedsCheckRows {
  return {
    unavailable: rows.filter(r => r.evaluation.signal === 'unavailable'),
    stale: rows.filter(r => r.evaluation.stale),
    brokerStopMissing: rows.filter(r => !r.plan.brokerStopOrderRegistered),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. 관찰 섹션 건수(구루/알림/과열 — 강등된 참고 신호)
// ═══════════════════════════════════════════════════════════════════════════

export interface ObserveCountsInput {
  alertResults: AlertResult[];
  riskMatrix: RiskMatrixRow[];
  /** 55일 돌파 확인 건수 — 호출부가 주입(중복 fetch 방지, TodayView 참고 주석) */
  turtleWatchBreakouts: number;
}

export interface ObserveCounts {
  alertCount: number;
  riskCount: number;
  breakoutCount: number;
}

/** 오늘 화면 '관찰' 섹션 헤더 배지 건수. 계산 재구현 없음 — 이미 산출된 배열 길이만 합산. */
export function observeCounts(input: ObserveCountsInput): ObserveCounts {
  return {
    alertCount: input.alertResults.reduce((sum, r) => sum + r.matchedAssets.length, 0),
    riskCount: input.riskMatrix.length,
    breakoutCount: input.turtleWatchBreakouts,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. 대기 주문(리밸런싱/대청소) 건수 — 실행큐 이식 섹션 헤더용
// ═══════════════════════════════════════════════════════════════════════════

export interface PendingOrderCounts {
  rebalance: number;
  cleanup: number;
}

/** 터틀(잠김) 이외 대기(pending/snoozed) 주문 건수 — REBALANCE_BUY/SELL·CLEANUP_SELL만. */
export function pendingOrderCounts(actionQueue: ActionItem[]): PendingOrderCounts {
  let rebalance = 0;
  let cleanup = 0;
  for (const item of actionQueue) {
    if (!isActiveAction(item.status)) continue;
    if (item.kind === 'REBALANCE_BUY' || item.kind === 'REBALANCE_SELL') rebalance++;
    else if (item.kind === 'CLEANUP_SELL') cleanup++;
  }
  return { rebalance, cleanup };
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. "계획 기준 우선" 배지 건수 — 활성 계획이 있는 종목의 일반 알림/리스크 항목 수
//    (표시 계층 전용 — 알림/리스크 계산 자체는 건드리지 않는다)
// ═══════════════════════════════════════════════════════════════════════════

/** 알림 결과 + 리스크 매트릭스에서, 활성 계획이 있는 자산(id)에 해당하는 건수(중복 없이 자산 단위). */
export function countPlanPriorityObserved(
  alertResults: AlertResult[],
  riskMatrix: RiskMatrixRow[],
  plannedAssetIds: ReadonlySet<string>
): number {
  if (plannedAssetIds.size === 0) return 0;
  const ids = new Set<string>();
  for (const result of alertResults) {
    for (const asset of result.matchedAssets) {
      if (plannedAssetIds.has(asset.assetId)) ids.add(asset.assetId);
    }
  }
  for (const row of riskMatrix) {
    if (plannedAssetIds.has(row.assetId)) ids.add(row.assetId);
  }
  return ids.size;
}
