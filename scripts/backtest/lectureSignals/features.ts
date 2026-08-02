// scripts/backtest/lectureSignals/features.ts
// ---------------------------------------------------------------------------
// 순수 시계열 특성 계산(§5.6, §6, §7). 배열은 bar index 공간(i = 거래일 D).
//
// 룩어헤드 규율(§4.3, §15):
//   · 이동평균(MA)·이동최대는 계산 정의에 따라 당일 포함/제외를 명시한다.
//   · "직전 N일 평균"(거래량·거래대금·변동성 기준선)은 반드시 당일 D를 제외한다(§15-18).
//   · 전방수익은 forwardReturns.ts에서만 다룬다(여기엔 미래참조 없음).
//
// 규칙: `any`·`console.*`·`Math.random` 금지. 순수 함수만.
// ---------------------------------------------------------------------------

/** 산술 평균. 빈 배열이면 NaN. */
export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** 모표준편차(분모 n). 표본이 2개 미만이면 NaN. */
export function stddevPop(xs: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / n);
}

/**
 * 이동평균(당일 포함): values[i-period+1 .. i] 평균. 창이 부족하면 null.
 * KOSPI MA150/MA200 등 "종가 < MA150" 판정에 쓴다(신호일 종가는 지표에도 반영).
 */
export function smaInclusive(values: readonly number[], i: number, period: number): number | null {
  if (period <= 0) return null;
  const start = i - period + 1;
  if (start < 0) return null;
  let s = 0;
  for (let k = start; k <= i; k++) s += values[k];
  return s / period;
}

/**
 * MA 기울기 방향(§6.2 KR150_SLOPE): smaInclusive(i,period) - smaInclusive(i-lag,period) < 0.
 * 둘 중 하나라도 창 부족이면 null(판정 불가).
 */
export function smaSlopeIsNegative(
  values: readonly number[],
  i: number,
  period: number,
  lag: number
): boolean | null {
  const now = smaInclusive(values, i, period);
  const past = smaInclusive(values, i - lag, period);
  if (now === null || past === null) return null;
  return now - past < 0;
}

/** k거래일 수익률 close[i]/close[i-k]-1. i-k<0 이면 null. */
export function returnK(close: readonly number[], i: number, k: number): number | null {
  const j = i - k;
  if (j < 0) return null;
  const base = close[j];
  if (!(base > 0)) return null;
  return close[i] / base - 1;
}

/**
 * k거래일 가격비 close[i]/close[i-k](수익률+1). i-k<0 또는 base<=0 이면 null.
 * 임계값 비교는 비율 형태(ratio >= 1+t)로 해야 부동소수 경계 절벽을 피한다.
 * 예: 140/100-1 은 0.3999…이지만 140/100 은 1.4 리터럴과 동일 double → `>= 1.4` 정확.
 */
export function ratioK(close: readonly number[], i: number, k: number): number | null {
  const j = i - k;
  if (j < 0) return null;
  const base = close[j];
  if (!(base > 0)) return null;
  return close[i] / base;
}

/** 1일 가격비 close[i]/close[i-1]. i<1 또는 base<=0 이면 null. */
export function dailyRatio(close: readonly number[], i: number): number | null {
  return ratioK(close, i, 1);
}

/** 1일 수익률(부호 있음) close[i]/close[i-1]-1. i<1 이면 null. */
export function dailyReturn(close: readonly number[], i: number): number | null {
  return returnK(close, i, 1);
}

/**
 * 직전 N일 평균(당일 D 제외, §15-18): values[i-window .. i-1] 평균.
 * 거래량·거래대금 기준선용. 창 부족이면 null.
 */
export function priorMean(values: readonly number[], i: number, window: number): number | null {
  const start = i - window;
  if (start < 0) return null;
  let s = 0;
  for (let k = start; k <= i - 1; k++) s += values[k];
  return s / window;
}

/**
 * 거래량 과다 배수(§5.6): adjVolume[i] / priorMean(adjVolume, i, window). 기준선은 당일 제외.
 * 기준선이 0 또는 창 부족이면 null.
 */
export function volumeMultiple(
  adjVolume: readonly number[],
  i: number,
  window = 20
): number | null {
  const base = priorMean(adjVolume, i, window);
  if (base === null || base <= 0) return null;
  return adjVolume[i] / base;
}

/**
 * 연환산 실현변동성(§5.6): D-window .. D-1 구간의 일간수익률 표준편차 × sqrt(252).
 * 일간수익률 r[t]=close[t]/close[t-1]-1 를 t ∈ [i-window, i-1] 에서 window개 취한다(당일 D 제외).
 * 창 부족이면 null.
 */
export function realizedVol(close: readonly number[], i: number, window: number): number | null {
  const firstRetDay = i - window; // r[firstRetDay] 계산에 close[firstRetDay-1] 필요
  if (firstRetDay - 1 < 0) return null;
  const rets: number[] = [];
  for (let t = firstRetDay; t <= i - 1; t++) {
    const prev = close[t - 1];
    if (!(prev > 0)) return null;
    rets.push(close[t] / prev - 1);
  }
  const sd = stddevPop(rets);
  if (!Number.isFinite(sd)) return null;
  return sd * Math.sqrt(252);
}

/**
 * 최근 window일(당일 D 포함) 최대값 판정: values[i] === max(values[i-window+1 .. i]).
 * S5(거래대금 최근 63일 최대)용. 창 부족이면 null(판정 불가로 이벤트 미발생).
 * 동률(최대와 같은 값이 과거에 또 있어도) 당일이 최대와 같으면 true.
 */
export function isRollingMaxInclusive(
  values: readonly number[],
  i: number,
  window: number
): boolean | null {
  const start = i - window + 1;
  if (start < 0) return null;
  let mx = -Infinity;
  for (let k = start; k <= i; k++) if (values[k] > mx) mx = values[k];
  return values[i] >= mx;
}
