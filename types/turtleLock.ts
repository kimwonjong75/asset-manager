// types/turtleLock.ts
// ---------------------------------------------------------------------------
// 터틀 주문 안전잠금 — **단일 정책 소스**.
//
// 배경: 백테스트 검증 결과 55/20 신규진입(T1)은 "관찰용 후보"까지만 지지되고, 불타기(T2)는
// 탈락했으며(BTC 한 종목이 증분손익의 77% — 제거 시 부호 반전), 기존 보유분 편입(P2)도 탈락했다.
// 또한 앱 주문 경로에는 예산·총위험·종목상한·중복진입 관련 결함(D-1~D-4)이 남아 있다.
// 따라서 **터틀 주문의 생성·자동생성·실행을 전부 잠근다**. 화면 버튼만 숨기지 않고
// 내부 공통 경계에서 fail-closed 로 막는다.
//
// 이 파일이 유일한 정책 지점이다 — 잠금 해제는 여기 한 곳만 바꾸면 된다.
// **주의**: 저장본의 `turtleSettings.autoGenerateQueue` 값은 **덮어쓰거나 마이그레이션하지 않는다.**
// 값이 true 여도 잠금 상태에서는 무시한다(사용자 설정 보존).

import { ActionKind } from './actionQueue';

/** 터틀 주문 정책 상태. */
export type TurtleOrderPolicy = 'OBSERVE_ONLY' | 'ENABLED';

/** 현재 정책 — 관찰 전용(전 터틀 주문 잠금). */
export const TURTLE_ORDER_POLICY: TurtleOrderPolicy = 'OBSERVE_ONLY';

/** 잠금 여부 (모든 호출부가 이 함수만 본다). */
export function isTurtleOrderLocked(): boolean {
  return TURTLE_ORDER_POLICY === 'OBSERVE_ONLY';
}

/** 잠금 사유 코드 — 호출자가 분기·표시에 사용. */
export type TurtleLockReason = 'observe-only';

/** 잠금 결과 (호출자에게 조용한 빈 배열 대신 사유를 전달). */
export interface TurtleLockResult {
  locked: boolean;
  reason: TurtleLockReason | null;
  /** 사용자에게 보여줄 한 문장 */
  message: string;
}

/** 사용자 표시 문구 — 화면·호출자 공통. */
export const TURTLE_LOCK_MESSAGE =
  '터틀 주문은 현재 잠겨 있습니다. 검증에서 확인된 것은 관찰용 신호까지이며, 주문 계산에 남은 문제가 정리될 때까지 자동 주문을 만들지 않습니다.';

/** 짧은 배지용 문구. */
export const TURTLE_LOCK_BADGE = '관찰 전용 · 터틀 자동주문 잠금';

export function turtleLockState(): TurtleLockResult {
  return isTurtleOrderLocked()
    ? { locked: true, reason: 'observe-only', message: TURTLE_LOCK_MESSAGE }
    : { locked: false, reason: null, message: '' };
}

/** 잠금 대상 주문 종류 (진입·불타기·손절·청산). 비터틀 kind 는 영향받지 않는다. */
export const LOCKED_ACTION_KINDS: ActionKind[] = [
  'TURTLE_ENTRY', 'TURTLE_PYRAMID', 'TURTLE_STOP', 'TURTLE_EXIT',
];

/** 이 kind 가 잠금 대상인가 (리밸런싱·대청소는 false). */
export function isLockedActionKind(kind: ActionKind): boolean {
  return LOCKED_ACTION_KINDS.includes(kind);
}

/** 이 kind 의 실행이 지금 차단되는가. */
export function isActionExecutionLocked(kind: ActionKind): boolean {
  return isTurtleOrderLocked() && isLockedActionKind(kind);
}
