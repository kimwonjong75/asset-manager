// scripts/backtest/coreStopLoss/lib/movingAverage.ts
// 단순이동평균(SMA) 헬퍼 — 연구 전용(앱/백엔드 무접촉), 순수 함수.
//
// 입력은 공통 캘린더에 정렬된 (number|null)[] 시계열이다.
// null(상장 전/데이터 없음)을 만나면 누적을 리셋하고, 유효값이 period개 쌓이기 전까지는 null을 낸다.

/**
 * 단순이동평균 배열을 만든다.
 * @param values 공통 캘린더 정렬 시계열(값이 없는 구간은 null)
 * @param period 기간(일). 양의 정수.
 * @returns values와 같은 길이의 배열. 유효값이 period개 누적되기 전 구간은 null.
 */
export function simpleMovingAverage(values: (number | null)[], period: number): (number | null)[] {
  if (!Number.isInteger(period) || period <= 0) {
    throw new Error(`simpleMovingAverage: period는 양의 정수여야 함 (받은 값 ${period})`);
  }
  const out: (number | null)[] = new Array<number | null>(values.length).fill(null);
  let sum = 0;
  let count = 0; // 현재 연속 유효구간에서 창에 들어있는 값의 개수

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v !== 'number' || !isFinite(v)) {
      // 결측을 만나면 창을 리셋한다(결측을 건너뛰고 이어붙이지 않는다).
      sum = 0;
      count = 0;
      continue;
    }
    sum += v;
    count += 1;
    if (count > period) {
      // 창을 벗어난 값 제거. 연속 유효구간이므로 values[i - period]는 반드시 number.
      const dropped = values[i - period];
      if (typeof dropped !== 'number') {
        throw new Error(`simpleMovingAverage: 내부 불변식 위반 (index ${i - period} 결측)`);
      }
      sum -= dropped;
      count = period;
    }
    if (count === period) out[i] = sum / period;
  }

  return out;
}
