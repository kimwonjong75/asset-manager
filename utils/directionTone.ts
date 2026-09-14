// utils/directionTone.ts
// ---------------------------------------------------------------------------
// 가격·손익 "방향" 색의 단일 결정점 (Stage B, 2026-09-14 사용자 확정 규약).
//
//   빨강(up)   = 오름·이익·매수
//   파랑(down) = 내림·손실·매도
//   회색(flat) = 변화 없음 / 값 없음
//
// 위험·긴급은 이 헬퍼가 아니라 warning(주황)+아이콘+문구, 삭제·오류는 danger(핑크)+아이콘.
// 순수 함수 — 상태/부작용 없음. 반환하는 클래스 문자열은 tailwind content(./utils/**)가 스캔한다.
// 문자열을 조합(`text-${x}`)하지 말 것 — JIT 스캐너가 못 찾는다. 전체 리터럴로만 쓴다.
// ---------------------------------------------------------------------------

export type Direction = 'up' | 'down' | 'flat';

/** 기본 허용오차 — |v| ≤ eps 는 flat. 0.004% 같은 부동소수 잡음이 빨강/파랑으로 튀지 않게. */
export const DIRECTION_EPSILON = 1e-9;

/**
 * 값의 방향. null/undefined/NaN/±Infinity 가 아닌 유한수만 판정하고 나머지는 flat.
 * -0 은 0 과 같게 flat. |v| ≤ eps 도 flat.
 */
export function getDirection(value: number | null | undefined, eps: number = DIRECTION_EPSILON): Direction {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'flat';
  if (value > eps) return 'up';
  if (value < -eps) return 'down';
  return 'flat';
}

const TEXT_CLASS: Record<Direction, string> = {
  up: 'text-up',
  down: 'text-down',
  flat: 'text-gray-400',
};

const SOFT_CLASS: Record<Direction, string> = {
  up: 'bg-up-soft text-up',
  down: 'bg-down-soft text-down',
  flat: 'bg-gray-700/60 text-gray-300',
};

/** 방향 → 글자색 클래스 */
export function directionTextClassOf(direction: Direction): string {
  return TEXT_CLASS[direction];
}

/** 값 → 글자색 클래스 (`text-up` / `text-down` / `text-gray-400`) */
export function directionTextClass(value: number | null | undefined, eps: number = DIRECTION_EPSILON): string {
  return TEXT_CLASS[getDirection(value, eps)];
}

/** 값 → 옅은 배경+글자색 클래스 (배지·칩용) */
export function directionSoftClass(value: number | null | undefined, eps: number = DIRECTION_EPSILON): string {
  return SOFT_CLASS[getDirection(value, eps)];
}

/** 매수/매도 행동 색 — 한국 증권사 관례(매수=빨강, 매도=파랑). */
export function tradeSideTextClass(side: 'buy' | 'sell'): string {
  return side === 'buy' ? TEXT_CLASS.up : TEXT_CLASS.down;
}
