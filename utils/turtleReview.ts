// utils/turtleReview.ts
// ---------------------------------------------------------------------------
// 터틀 자동 검토 요약 (자동 검토 Phase A/B, 순수 함수).
// 실행 큐(저장본)의 대기 현황 + 진단(diagnoseTurtleActions) 결과를 상단 배지·투자 브리핑
// 표시용 숫자로 요약한다. **읽기 전용** — 생성·저장 경로(buildTurtleActions/refreshActionQueue)와
// 완전 분리되며, previewCount는 진단의 generatedCount(≡ build 길이, 테스트 앵커)를 그대로 쓴다.

import { ActionItem, isActiveAction, TurtleActionDiagnostics } from '../types/actionQueue';
import { actionEscalationLevel } from './actionQueueGenerator';
import { isActionExecutionLocked, isTurtleOrderLocked } from '../types/turtleLock';

/** 저장된 실행 큐의 대기 현황 (Phase A — 계산·fetch 불필요, 항상 즉시 산출 가능). */
export interface ActiveQueueCounts {
  /** 대기 중(pending/snoozed) 주문 수 */
  activeCount: number;
  /** 그중 에스컬레이션(3일+ 미실행 또는 스누즈 2회+, level≥1) 주문 수 */
  escalatedCount: number;
}

/**
 * 대기 현황 요약 — **잠금을 모르는 순수 집계**.
 * 안전잠금은 여기가 아니라 `buildTurtleReviewSummary`(합성 지점)에서 적용한다:
 * 이 함수와 `summarizePreview`는 생성기(buildTurtleActions)와의 parity 앵커
 * (`previewCount ≡ build.length`)를 지키는 drift 방지 장치라, 정책을 섞으면 앵커가 무력화된다.
 */
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

/** 대기 중이면서 **실행이 잠긴** 터틀 항목 수 (큐 기록은 보존 — 표시·집계에서만 분리). */
export function countLockedActive(queue: ActionItem[]): number {
  let n = 0;
  for (const it of queue) {
    if (isActiveAction(it.status) && isActionExecutionLocked(it.kind)) n++;
  }
  return n;
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
 * **잠금을 모르는 순수 집계** — 안전잠금은 `buildTurtleReviewSummary`에서 적용한다(parity 앵커 보존).
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
  /**
   * 배지 '실행 M' = 대기 + 오늘 생성 가능 (중복 없음 — 진단이 대기 중 주문을 duplicate-pending으로 배제).
   * **터틀 안전잠금 중에는 터틀 대기·프리뷰가 전부 빠진다** → 잠금 상태에서 이 값은 비터틀(리밸런싱·대청소)만 센다.
   */
  actionableCount: number;
  /** 터틀 주문 잠금 여부 (UI 가 사유를 표시) */
  turtleLocked: boolean;
  /** 잠금으로 실행 대기에서 제외된 터틀 큐 항목 수 (기록은 보존됨 — 표시용) */
  lockedCount: number;
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
  const locked = isTurtleOrderLocked();
  const lockedCount = countLockedActive(params.queue);
  // ── **안전잠금 적용 지점 (C-2)** ────────────────────────────────────────
  // 공개 요약(TurtleReviewSummary)의 **원시 숫자까지** 잠긴 터틀을 뺀다 — 소비처(AlertPopup/App 배지)가
  // activeCount·escalatedCount·preview* 를 직접 읽으므로, actionableCount 만 걸러선 새어 나간다.
  //   · 대기 집계: 잠긴 kind 를 **제외한 큐**로 집계 → 비터틀만 남는다(큐 원본은 불변).
  //   · 프리뷰: 잠금 중엔 생성이 금지되므로 "오늘 생성 가능"이 존재할 수 없다 → 전부 0.
  //   · 잠긴 터틀 기록 수는 `lockedCount` 에만 보존(표시 문구: "기존 터틀 기록 N건 · 현재 실행 잠금").
  // 순수 함수(summarizeActiveQueue/summarizePreview)는 잠금을 모른 채 유지된다 —
  // 생성기 parity 앵커(previewCount ≡ buildTurtleActions().length)를 지키기 위함.
  const visibleQueue = locked
    ? params.queue.filter(it => !isActionExecutionLocked(it.kind))
    : params.queue;
  const active = summarizeActiveQueue(visibleQueue, params.today);
  const preview = locked
    ? { previewCount: 0, previewEntry: 0, previewPyramid: 0, previewStop: 0, previewExit: 0 }
    : summarizePreview(params.diagnostics);
  return {
    ...active,
    ...preview,
    actionableCount: active.activeCount + preview.previewCount,
    turtleLocked: locked,
    lockedCount,
    turtleCandidateCount: params.turtleCandidateCount,
    budgetMissing: params.budgetMissing,
    isChecking: params.isChecking,
    reviewPending: params.reviewPending,
    reviewFailed: params.reviewFailed,
    checkedAt: params.checkedAt,
  };
}
