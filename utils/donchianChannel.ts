// utils/donchianChannel.ts
// ---------------------------------------------------------------------------
// 돈치안 채널 — 터틀 진입(55일 최고가 돌파)/청산(20일 최저가 이탈) 판정용 순수 함수.
// 규칙 원전: 터틀트레이딩_통합검증_최종본.md §5(진입)·§8(청산).
//
// 핵심: **당일 제외(excludeToday)** 가 기본 — 오늘 값을 채널에 포함하면 "오늘 최고가를
//       오늘이 돌파"가 자기참조가 되어 돌파 판정이 불가능해진다. 채널은 항상 "직전 N일"로 만들고
//       오늘 가격이 그 채널을 넘었는지 비교한다.
//
// OHLC 미수신 종목 대비: high/low 배열이 전부 null이면 close 배열로 폴백 (buildDonchianChannels).

export interface DonchianOptions {
  /** 마지막(당일) 값을 채널 계산에서 제외 (기본 true) */
  excludeToday?: boolean;
}

/**
 * 끝에서 lookback개 값의 최댓값 (rolling high).
 * excludeToday=true면 마지막 값을 제외한 직전 lookback개에서 계산.
 * 유효(number) 값이 하나도 없으면 null.
 */
export function calculateDonchianHigh(
  values: (number | null | undefined)[],
  lookback: number,
  opts: DonchianOptions = {}
): number | null {
  return reduceWindow(values, lookback, opts.excludeToday ?? true, 'max');
}

/**
 * 끝에서 lookback개 값의 최솟값 (rolling low).
 * excludeToday=true면 마지막 값을 제외한 직전 lookback개에서 계산.
 * 유효(number) 값이 하나도 없으면 null.
 */
export function calculateDonchianLow(
  values: (number | null | undefined)[],
  lookback: number,
  opts: DonchianOptions = {}
): number | null {
  return reduceWindow(values, lookback, opts.excludeToday ?? true, 'min');
}

function reduceWindow(
  values: (number | null | undefined)[],
  lookback: number,
  excludeToday: boolean,
  mode: 'max' | 'min'
): number | null {
  if (!Array.isArray(values) || values.length === 0 || lookback <= 0) return null;
  // 윈도우 끝 인덱스: excludeToday면 마지막 직전까지
  const end = excludeToday ? values.length - 1 : values.length; // exclusive
  const start = Math.max(0, end - lookback);
  let acc = mode === 'max' ? -Infinity : Infinity;
  let found = false;
  for (let i = start; i < end; i++) {
    const v = values[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    found = true;
    if (mode === 'max') { if (v > acc) acc = v; }
    else { if (v < acc) acc = v; }
  }
  return found ? acc : null;
}

export interface DonchianChannels {
  entryHigh: number | null;   // entryLookback 일 최고가 (당일 제외)
  exitLow: number | null;     // exitLookback 일 최저가 (당일 제외)
  highFallback: boolean;      // 고가 미수신 → 종가로 대체했는지
  lowFallback: boolean;       // 저가 미수신 → 종가로 대체했는지
}

/**
 * OHLC 시계열(날짜 오름차순)로 진입/청산 채널을 한 번에 계산.
 * highs/lows가 전부 null(백엔드 OHLC 미수신)이면 closes로 폴백하고 폴백 여부를 반환한다.
 * 폴백 시에도 채널은 유효하지만, 종가 기반이라 원본(고가/저가 기반)보다 다소 보수적일 수 있다.
 */
export function buildDonchianChannels(
  highs: (number | null | undefined)[],
  lows: (number | null | undefined)[],
  closes: (number | null | undefined)[],
  entryLookback: number,
  exitLookback: number
): DonchianChannels {
  const hasHigh = hasAnyFinite(highs);
  const hasLow = hasAnyFinite(lows);
  const highSeries = hasHigh ? highs : closes;
  const lowSeries = hasLow ? lows : closes;
  return {
    entryHigh: calculateDonchianHigh(highSeries, entryLookback, { excludeToday: true }),
    exitLow: calculateDonchianLow(lowSeries, exitLookback, { excludeToday: true }),
    highFallback: !hasHigh,
    lowFallback: !hasLow,
  };
}

function hasAnyFinite(arr: (number | null | undefined)[]): boolean {
  if (!Array.isArray(arr)) return false;
  for (const v of arr) {
    if (typeof v === 'number' && Number.isFinite(v)) return true;
  }
  return false;
}
