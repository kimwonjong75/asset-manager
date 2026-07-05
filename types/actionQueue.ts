// types/actionQueue.ts
// ---------------------------------------------------------------------------
// "오늘의 주문서" 실행 큐 (Phase 2, 90/10).
// 신호가 아니라 **주문**을 담는다 — 종목·수량·기준가·근거가 확정된 실행 항목.
// 팝업(휘발)과 별개 축: 큐는 Drive에 영속되고, 처리(done/skipped)할 때까지 사라지지 않는다.
//
// 생성원(kind): 터틀 엔진(진입/불타기/손절/청산) + 리밸런싱 밴드(Phase 4) + 대청소(Phase 3).
// 통화 규약(D6): refPrice와 ruleSnapshot의 가격 필드는 종목 통화(priceOriginal), 금액(*KRW)은 KRW.

export type ActionKind =
  | 'TURTLE_ENTRY'    // 55일 신고가 돌파 신규 매수
  | 'TURTLE_PYRAMID'  // 불타기(피라미딩) 추가 매수
  | 'TURTLE_STOP'     // 2N 손절 전량 매도
  | 'TURTLE_EXIT'     // 20일 최저가 청산 전량 매도
  | 'REBALANCE_SELL'  // 코어 리밸런싱 매도 (Phase 4)
  | 'REBALANCE_BUY'   // 코어 리밸런싱 매수 (Phase 4)
  | 'CLEANUP_SELL';   // 대청소 청산 (Phase 3)

export type ActionStatus = 'pending' | 'done' | 'skipped' | 'snoozed';

/** 매수 계열 주문인지 (매수 모달 prefill) — 나머지는 매도 계열. */
export const BUY_ACTION_KINDS: ActionKind[] = ['TURTLE_ENTRY', 'TURTLE_PYRAMID', 'REBALANCE_BUY'];

export interface ActionItem {
  id: string;
  createdDate: string;            // YYYY-MM-DD (생성일 — daysIgnored 파생 기준)
  kind: ActionKind;
  ticker: string;
  name: string;
  assetId?: string;              // 매도 계열: 대상 보유 자산 id (모달 prefill·SellRecord 연결)
  positionId?: string;           // 터틀 포지션 연결 (stop/exit/pyramid)
  quantity: number;              // 주문 수량 (매도=전량 또는 부분, 매수=사이징 결과)
  refPrice: number;              // 생성 시점 기준가 (종목 통화, priceOriginal)
  reasonText: string;            // 사람이 읽는 근거 ("55일 신고가 12,340 돌파 · 손절 11,760")
  ruleSnapshot: Record<string, number>; // 생성 당시 파라미터 (stopPrice/n/donchianHigh/riskKRW/fxRate 등)
  status: ActionStatus;
  resolvedDate?: string;         // done/skipped 처리일
  skipReason?: string;           // 건너뜀 사유 (필수)
  snoozedUntil?: string;         // "내일 재알림" — 이 일자 이후 pending으로 복귀
  snoozeCount?: number;          // 연속 스누즈 횟수 (에스컬레이션 반영)
  linkedSellRecordId?: string;   // 매도 실행 시 SellRecord와 연결
}

/** 큐에서 아직 사용자 행동을 기다리는 상태 (pending 또는 스누즈 중). */
export function isActiveAction(status: ActionStatus): boolean {
  return status === 'pending' || status === 'snoozed';
}

// ── "왜 주문이 안 생겼나" 진단 (Phase 2b-6, 표시 전용) ──
// 생성 경로(buildTurtleActions)와 분리된 순수 진단(diagnoseTurtleActions)의 산출 타입.
// generated 계열 사유는 실제로 주문이 생성됐음을 뜻한다(진단≡생성 parity 앵커).

/** 진입 후보별 판정 사유. */
export type TurtleEntryDiagReason =
  | 'generated'             // 진입 주문 생성됨
  | 'already-open'          // 이미 보유(진입 대상 아님 — 피라미딩 축)
  | 'duplicate-pending'     // 이미 대기 중 진입 주문 존재
  | 'no-market'             // 시장입력 없음(OHLCV/N 산출 실패)
  | 'no-n'                  // N 미산출(데이터 부족)
  | 'no-breakout'           // 55일 신고가 미돌파(정상 대기 — 중립)
  | 'zero-qty'              // 사이징 0주
  | 'insufficient-budget'   // 예산 잔여로 1유닛도 불가
  | 'risk-limit';           // 동시 전멸 한도(12%) 초과

/** 오픈 포지션별 판정 사유. */
export type TurtlePositionDiagReason =
  | 'stop-generated'
  | 'exit-generated'
  | 'pyramid-generated'
  | 'no-market'
  | 'duplicate-pending'
  | 'no-trigger';           // 손절/청산/피라미딩 조건 미충족(정상)

export interface TurtleEntryDiag { ticker: string; name: string; reason: TurtleEntryDiagReason; }
export interface TurtlePositionDiag { ticker: string; name: string; positionId: string; reason: TurtlePositionDiagReason; }

/** 생성기(diagnoseTurtleActions) 진단 결과. generatedCount는 buildTurtleActions(...).length와 동치. */
export interface TurtleActionDiagnostics {
  positions: TurtlePositionDiag[];
  candidates: TurtleEntryDiag[];
  generatedCount: number;
}

/**
 * refreshActionQueue가 반환하는 종합 진단 (훅 레벨 사실 + 생성기 진단).
 * 훅 레벨: 예산 0·터틀 후보 없음·시세 미갱신(생성기에 도달하기 전 스킵된 사유).
 */
export interface RefreshDiagnostics {
  budgetKRW: number;
  budgetMissing: boolean;         // satelliteBudgetKRW <= 0
  turtleCandidateCount: number;   // isTurtleCandidate 표시된 관심종목 수(가격 무관)
  stalePriceTickers: string[];    // 후보인데 priceOriginal<=0 → 시세 미갱신으로 스킵됨
  openPositionCount: number;
  actions: TurtleActionDiagnostics;
}
