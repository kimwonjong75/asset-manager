// utils/turtleReview.ts
// ---------------------------------------------------------------------------
// 터틀 자동 검토 요약 (자동 검토 Phase A/B, 순수 함수).
// 실행 큐(저장본)의 대기 현황 + 진단(diagnoseTurtleActions) 결과를 상단 배지·투자 브리핑
// 표시용 숫자로 요약한다. **읽기 전용** — 생성·저장 경로(buildTurtleActions/refreshActionQueue)와
// 완전 분리되며, previewCount는 진단의 generatedCount(≡ build 길이, 테스트 앵커)를 그대로 쓴다.

import { ActionItem, isActiveAction, TurtleActionDiagnostics } from '../types/actionQueue';
import { actionEscalationLevel } from './actionQueueGenerator';

/** 저장된 실행 큐의 대기 현황 (Phase A — 계산·fetch 불필요, 항상 즉시 산출 가능). */
export interface ActiveQueueCounts {
  /** 대기 중(pending/snoozed) 주문 수 */
  activeCount: number;
  /** 그중 에스컬레이션(3일+ 미실행 또는 스누즈 2회+, level≥1) 주문 수 */
  escalatedCount: number;
}

export function summarizeActiveQueue(queue: ActionItem[], today: string): ActiveQueueCounts {
  let activeCount = 0;
  let escalatedCount = 0;
  for (const it of queue) {
    if (!isActiveAction(it.status)) continue;
    activeCount++;
    if (actionEscalationLevel(it, today) >= 1) escalatedCount++;
  }
  return { activeCount, escalatedCount };
}

/** 오늘 새로 생성 가능한 주문 프리뷰 (Phase B — 진단 결과의 표시용 분해). */
export interface PreviewCounts {
  /** 오늘 「오늘 주문 생성」 시 생성될 건수 = diagnostics.generatedCount (build 길이와 동치) */
  previewCount: number;
  previewEntry: number;   // 신규 진입
  previewPyramid: number; // 불타기 추가
  previewStop: number;    // 손절 매도
  previewExit: number;    // 청산 매도
}

/**
 * 진단 사유를 kind별 건수로 분해한다. previewCount는 generatedCount를 그대로 사용(단일 소스) —
 * 분해 합계와 generatedCount의 일치는 tests/turtleReviewParity.ts가 강제한다.
 */
export function summarizePreview(diag: TurtleActionDiagnostics | null): PreviewCounts {
  const counts: PreviewCounts = { previewCount: 0, previewEntry: 0, previewPyramid: 0, previewStop: 0, previewExit: 0 };
  if (!diag) return counts;
  for (const c of diag.candidates) {
    if (c.reason === 'generated') counts.previewEntry++;
  }
  for (const p of diag.positions) {
    if (p.reason === 'stop-generated') counts.previewStop++;
    else if (p.reason === 'exit-generated') counts.previewExit++;
    else if (p.reason === 'pyramid-generated') counts.previewPyramid++;
  }
  counts.previewCount = diag.generatedCount;
  return counts;
}

/** 상단 배지·브리핑 카드가 소비하는 통합 요약 (derived.actionQueueSummary). */
export interface TurtleReviewSummary extends ActiveQueueCounts, PreviewCounts {
  /** 배지 '실행 M' = 대기 + 오늘 생성 가능 (중복 없음 — 진단이 대기 중 주문을 duplicate-pending으로 배제) */
  actionableCount: number;
  /** isTurtleCandidate 표시된 관심종목 수 (가격 무관) */
  turtleCandidateCount: number;
  /** 위성 예산 미설정(0) — 진입 프리뷰가 항상 0인 이유 표시용 */
  budgetMissing: boolean;
  /** 자동 검토 fetch 진행 중 */
  isChecking: boolean;
  /** 자동 검토 미완료 — 자동 팝업 게이트가 일자 기록 없이 대기해야 함 */
  reviewPending: boolean;
  /** 자동 검토 실패 (프리뷰 0으로 폴백 — 실행 큐 수동 생성은 영향 없음) */
  reviewFailed: boolean;
  /** 검토 기준 시각 'HH:MM' (장중 가격 변동 캐비엇 표시용). 미검토면 null */
  checkedAt: string | null;
}

export function buildTurtleReviewSummary(params: {
  queue: ActionItem[];
  today: string;
  diagnostics: TurtleActionDiagnostics | null;
  turtleCandidateCount: number;
  budgetMissing: boolean;
  isChecking: boolean;
  reviewPending: boolean;
  reviewFailed: boolean;
  checkedAt: string | null;
}): TurtleReviewSummary {
  const active = summarizeActiveQueue(params.queue, params.today);
  const preview = summarizePreview(params.diagnostics);
  return {
    ...active,
    ...preview,
    actionableCount: active.activeCount + preview.previewCount,
    turtleCandidateCount: params.turtleCandidateCount,
    budgetMissing: params.budgetMissing,
    isChecking: params.isChecking,
    reviewPending: params.reviewPending,
    reviewFailed: params.reviewFailed,
    checkedAt: params.checkedAt,
  };
}
