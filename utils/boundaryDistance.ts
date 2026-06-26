// utils/boundaryDistance.ts
// 조건 leaf "통과 경계까지의 거리" (근접도) — 순수 함수.
// "왜 거의 떴는데 안 떴나"를 지표 단위(부호 포함)로 보여주기 위함. 신규 계산(코드에 없던 유일한 부분).
//
// 부호 규약: 양수 = 통과 여유(이미 충족, 경계에서 얼마나 떨어져 있나),
//            음수 = 통과까지 부족분(미충족, 경계까지 얼마나 더 필요한가), 0 = 경계 정확히.
// (actual−threshold)/threshold 같은 비율식은 between·음수·0 임계값에서 깨지므로 쓰지 않는다.
// 숫자로 환산 불가(string 지표, '='/'in'/'crosses*')이면 null.

import type { ConditionOperator } from '../types/knowledge';

export function boundaryDistance(
  value: number | string | undefined | null,
  operator: ConditionOperator,
  threshold: number | number[] | string | string[],
): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;

  switch (operator) {
    case '>=':
    case '>':
      // 경계 = threshold. value ≥/> threshold면 통과. 거리 = value − threshold.
      return typeof threshold === 'number' ? value - threshold : null;
    case '<=':
    case '<':
      // 경계 = threshold. value ≤/< threshold면 통과. 거리 = threshold − value.
      return typeof threshold === 'number' ? threshold - value : null;
    case 'between': {
      if (!Array.isArray(threshold) || threshold.length !== 2) return null;
      const [lo, hi] = threshold;
      if (typeof lo !== 'number' || typeof hi !== 'number') return null;
      if (value >= lo && value <= hi) return Math.min(value - lo, hi - value); // 내부: 가장 가까운 경계까지 여유(+)
      if (value < lo) return value - lo; // 아래로 벗어남: 부족분(−)
      return hi - value;                 // 위로 벗어남: 부족분(−)
    }
    // 시계열 교차/동등/포함은 수치 근접도 정의 불가.
    case '=':
    case 'in':
    case 'crossesAbove':
    case 'crossesBelow':
    default:
      return null;
  }
}
