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
