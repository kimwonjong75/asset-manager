// scripts/backtest/onboardingPolicy/simulator.ts
// 편입정책(P1 관찰전용 vs P2 오늘부터 편입) 순수 시뮬레이터. console/Math.random/Date.now 금지.
// 앱 런타임 코드는 수정하지 않고 순수 함수(calculateATR)만 재사용한다.
//
// 체결 규약(동결): 종가[t] 판정 → 다음 실제 거래일 시가[t+1] 체결 + 비용.
//   min(open,stop)·min(open,exitLow)·max(open,trigger) **사용 금지** — 갭은 익일 실제 시가에 이미 반영됨.
//
// 척도 무관: P1·P2 는 동일 종목·동일 수량(전량 보존)이므로 수량이 소거된다.
//   수익률 = 최종가/편입가 − 1,  R = (최종가 − 편입가) / 2N.  → 수량·환율·총자산 불필요.

import { calculateATR } from '../../../utils/maCalculations';

export interface Series {
  ticker: string;
  dates: string[];
  open: (number | null)[];
  high: (number | null)[];
  low: (number | null)[];
  close: (number | null)[];
}

export interface RuleConfig {
  exitLookback: number;
  entryLookback: number;
  stopMultipleN: number;
  pyramidStepN: number;
  atrPeriod: number;
  riskPerUnitPct: number;   // 사이징 값 (0.5)
  costOneWay: number;       // 편도 비용률
  evalWindowBars: number;   // 500
  legacyValuePctOfBudget: number; // 100 — LEGACY_EXCESS 배수 산출 참조값
}

export type P2ExitReason = 'stop' | 'channel-exit' | 'immediate-exit' | 'forced-eod';

export type SkipReason = 'no-warmup' | 'no-n' | 'no-exit-low' | 'no-fill-bar' | 'bad-price';

export interface CellResult {
  ticker: string;
  admissionDate: string;
  fillDate: string;
  windowEndDate: string;
  windowBars: number;
  admissionPrice: number;
  n: number;
  stopPrice: number;
  exitLowAtD: number;
  /** 실손절위험 ÷ 1유닛 규격 위험 — 기존수량 보존의 크기 */
  legacyExcessMultiple: number;
  legacyExcess: boolean;
  immediateExit: boolean;
  p1Return: number;
  p2Return: number;
  p1MDD: number;
  p2MDD: number;
  p1R: number;
  p2R: number;
  p2ExitReason: P2ExitReason;
  p2ExitDate: string;
  p2HoldBars: number;
  /** 불타기 가격조건 충족했으나 잔여예산 0 으로 차단 (SIGNAL_BLOCKED_BY_BUDGET) */
  pyramidBlocked: boolean;
}

export interface SkipRecord {
  ticker: string;
  admissionDate: string;
  reason: SkipReason;
}

export interface PrecomputedSeries {
  series: Series;
  firstValid: number;
  /** atr[i] = i 시점 ATR20 (인과적 — i 까지의 데이터만 사용) */
  atr: (number | null)[];
  /** low20[i] = min(low[i-20 .. i-1]) — 당일 제외 */
  low20: (number | null)[];
  /** high55[i] = max(high[i-55 .. i-1]) — 당일 제외 (기록용) */
  high55: (number | null)[];
  /** validBefore[i] = [firstValid, i] 구간의 유효 종가 개수 */
  validUpTo: number[];
}

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function firstValidIndexOf(closes: (number | null)[]): number {
  for (let i = 0; i < closes.length; i++) if (isNum(closes[i])) return i;
  return -1;
}

/** 당일 제외 rolling 극값. 창 내 유효값이 하나라도 있으면 반환 (app calculateDonchianLow/High 와 동일 의미). */
function rollingExtreme(
  values: (number | null)[],
  lookback: number,
  mode: 'min' | 'max',
  firstValid: number
): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    const end = i; // exclusive — 당일 제외
    const start = Math.max(firstValid, end - lookback);
    let acc = mode === 'min' ? Infinity : -Infinity;
    let found = false;
    for (let k = start; k < end; k++) {
      const v = values[k];
      if (!isNum(v)) continue;
      found = true;
      if (mode === 'min') { if (v < acc) acc = v; } else { if (v > acc) acc = v; }
    }
    out[i] = found ? acc : null;
  }
  return out;
}

/**
 * 종목 시계열 사전계산 (O(n)).
 * ATR 은 firstValid 부터 슬라이스해 계산한다 — calculateATR 은 워밍업 창에 null 이 있으면
 * 이후 전 구간 null 을 반환하므로(앱 코드라 수정 불가) 상장일부터 잘라 우회한다.
 */
export function precompute(series: Series, cfg: RuleConfig): PrecomputedSeries | null {
  const firstValid = firstValidIndexOf(series.close);
  if (firstValid < 0) return null;

  const atrSlice = calculateATR(
    series.high.slice(firstValid),
    series.low.slice(firstValid),
    series.close.slice(firstValid),
    cfg.atrPeriod
  );
  const atr: (number | null)[] = new Array(series.close.length).fill(null);
  for (let i = 0; i < atrSlice.length; i++) atr[firstValid + i] = atrSlice[i];

  const useLow = series.low.some(isNum) ? series.low : series.close;
  const useHigh = series.high.some(isNum) ? series.high : series.close;

  const validUpTo: number[] = new Array(series.close.length).fill(0);
  let c = 0;
  for (let i = 0; i < series.close.length; i++) {
    if (i >= firstValid && isNum(series.close[i])) c++;
    validUpTo[i] = c;
  }

  return {
    series,
    firstValid,
    atr,
    low20: rollingExtreme(useLow, cfg.exitLookback, 'min', firstValid),
    high55: rollingExtreme(useHigh, cfg.entryLookback, 'max', firstValid),
    validUpTo,
  };
}

function maxDrawdown(path: number[]): number {
  let peak = -Infinity;
  let mdd = 0;
  for (const v of path) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (peak - v) / peak;
      if (dd > mdd) mdd = dd;
    }
  }
  return mdd;
}

/**
 * 한 셀(종목 × 편입일 D) 시뮬레이션.
 * @param dIdx 편입 판정일 D 의 인덱스 (이 날 종가로 판정, D+1 시가에 편입 기준가 확정)
 * @param lastIdx 평가 구간 상한 인덱스 (학습구간 말 — 홀드아웃 바 참조 금지)
 */
export function simulateCell(
  pre: PrecomputedSeries,
  dIdx: number,
  lastIdx: number,
  cfg: RuleConfig
): CellResult | SkipRecord {
  const s = pre.series;
  const skip = (reason: SkipReason): SkipRecord => ({ ticker: s.ticker, admissionDate: s.dates[dIdx], reason });

  // 워밍업 게이트: 유효봉 ≥ entryLookback(55) AND N AND 20일 최저가
  const validBars = pre.validUpTo[dIdx] ?? 0;
  if (validBars < cfg.entryLookback) return skip('no-warmup');
  const n = pre.atr[dIdx];
  if (!isNum(n) || !(n > 0)) return skip('no-n');
  const exitLowAtD = pre.low20[dIdx];
  if (!isNum(exitLowAtD)) return skip('no-exit-low');

  const fillIdx = dIdx + 1;
  if (fillIdx > lastIdx) return skip('no-fill-bar');
  const admissionPrice = s.open[fillIdx];
  if (!isNum(admissionPrice) || !(admissionPrice > 0)) return skip('bad-price');

  const stopPrice = admissionPrice - cfg.stopMultipleN * n;
  const windowEnd = Math.min(fillIdx + cfg.evalWindowBars, lastIdx);
  const cost = cfg.costOneWay;

  // 기존수량 보존의 크기: 실손절위험 ÷ 1유닛 규격 위험.
  //   legacy 수량 = 예산 × legacyValuePctOfBudget% ÷ 편입가
  //   1유닛 수량   = 예산 × riskPerUnitPct% ÷ N
  //   배수 = (legacyPct/100 ÷ 편입가) ÷ (riskPct/100 ÷ N) = (legacyPct × N) / (riskPct × 편입가)
  const legacyExcessMultiple =
    (cfg.legacyValuePctOfBudget * n) / (cfg.riskPerUnitPct * admissionPrice);

  const closeD = s.close[dIdx];
  const immediateExit = isNum(closeD) && closeD <= exitLowAtD;

  // ── P1: 관찰 전용 (평가창 끝까지 보유 → 마지막 종가 강제청산, 비용 동일 적용) ──
  const p1Path: number[] = [1];
  for (let t = fillIdx; t <= windowEnd; t++) {
    const c = s.close[t];
    if (isNum(c)) p1Path.push(c / admissionPrice);
  }
  const p1Last = s.close[windowEnd];
  if (!isNum(p1Last)) return skip('bad-price');
  const p1Final = (p1Last * (1 - cost)) / admissionPrice;
  p1Path[p1Path.length - 1] = p1Final;
  const p1Return = p1Final - 1;
  const p1MDD = maxDrawdown(p1Path);
  const p1R = (p1Last * (1 - cost) - admissionPrice) / (cfg.stopMultipleN * n);

  // ── P2: 편입 (손절 > 20일 청산 > 불타기(예산차단)) ──
  let p2ExitReason: P2ExitReason = 'forced-eod';
  let p2ExitIdx = windowEnd;
  let p2ExitPrice = p1Last;
  let pyramidBlocked = false;

  if (immediateExit) {
    // D 종가가 이미 20일 최저가 이탈 → 편입과 동시에 청산 신호 → D+1 시가 매도
    p2ExitReason = 'immediate-exit';
    p2ExitIdx = fillIdx;
    p2ExitPrice = admissionPrice;
  } else {
    let done = false;
    for (let t = fillIdx; t < windowEnd && !done; t++) {
      const ct = s.close[t];
      if (!isNum(ct)) continue;

      // 우선순위: 손절 > 청산 (엔진 순서)
      if (ct <= stopPrice) {
        const f = s.open[t + 1];
        if (!isNum(f)) continue;
        p2ExitReason = 'stop'; p2ExitIdx = t + 1; p2ExitPrice = f; done = true; break;
      }
      const lo = pre.low20[t];
      if (isNum(lo) && ct <= lo) {
        const f = s.open[t + 1];
        if (!isNum(f)) continue;
        p2ExitReason = 'channel-exit'; p2ExitIdx = t + 1; p2ExitPrice = f; done = true; break;
      }

      // 불타기 가격조건 — 현재 market N 기준 (evaluatePyramid 와 동일, nAtLastFill 금지)
      if (!pyramidBlocked) {
        const nt = pre.atr[t];
        if (isNum(nt) && nt > 0 && ct >= admissionPrice + cfg.pyramidStepN * nt) {
          pyramidBlocked = true; // 잔여예산 0 → 실행 금지, 기록만 (SIGNAL_BLOCKED_BY_BUDGET)
        }
      }
    }
  }

  const p2Realized = p2ExitPrice * (1 - cost);
  const p2Final = p2Realized / admissionPrice;
  const p2Return = p2Final - 1;
  const p2R = (p2Realized - admissionPrice) / (cfg.stopMultipleN * n);

  const p2Path: number[] = [1];
  for (let t = fillIdx; t < p2ExitIdx; t++) {
    const c = s.close[t];
    if (isNum(c)) p2Path.push(c / admissionPrice);
  }
  p2Path.push(p2Final); // 청산 후 현금 — 이후 평평
  const p2MDD = maxDrawdown(p2Path);

  return {
    ticker: s.ticker,
    admissionDate: s.dates[dIdx],
    fillDate: s.dates[fillIdx],
    windowEndDate: s.dates[windowEnd],
    windowBars: windowEnd - fillIdx + 1,
    admissionPrice,
    n,
    stopPrice,
    exitLowAtD,
    legacyExcessMultiple,
    legacyExcess: legacyExcessMultiple > 1,
    immediateExit,
    p1Return,
    p2Return,
    p1MDD,
    p2MDD,
    p1R,
    p2R,
    p2ExitReason,
    p2ExitDate: s.dates[p2ExitIdx],
    p2HoldBars: p2ExitIdx - fillIdx,
    pyramidBlocked,
  };
}

export function isSkip(r: CellResult | SkipRecord): r is SkipRecord {
  return (r as SkipRecord).reason !== undefined;
}

/** 각 월의 첫 실제 거래일 인덱스 (구간 내). 결정론. */
export function monthlyFirstTradingDays(dates: string[], startISO: string, endISO: string): number[] {
  const out: number[] = [];
  let lastKey = '';
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    if (d < startISO || d > endISO) continue;
    const key = d.slice(0, 7);
    if (key !== lastKey) { out.push(i); lastKey = key; }
  }
  return out;
}

/** 구간 말 인덱스 (endISO 이하의 마지막 바). */
export function lastIndexAtOrBefore(dates: string[], endISO: string): number {
  let idx = -1;
  for (let i = 0; i < dates.length; i++) if (dates[i] <= endISO) idx = i;
  return idx;
}

// ── 집계 (순수) ──

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 결정론 PRNG (conditionalChannel/statistics 관례와 동일 mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 연환산 (AMENDED-1 #2) ──
// 거래봉 수 × 252 금지 — 암호화폐는 연 ~365바라 252/bars 가 연수를 과소평가해 연환산을 부풀린다.
// 실제 경과 달력일 ÷ 365.2425 를 쓴다. P1·P2 모두 동일 평가종료일까지(청산 후 현금 포함) 연환산.

/** fillDate → windowEndDate 실제 경과일 ÷ 365.2425. */
export function yearsBetween(fillDateISO: string, endDateISO: string): number {
  const a = Date.parse(`${fillDateISO}T00:00:00Z`);
  const b = Date.parse(`${endDateISO}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return (b - a) / 86_400_000 / 365.2425;
}

/** 연환산 수익률. years ≤ 0 이면 0. 총수익 ≤ −100% 는 −100% 로 클램프(복리 정의 붕괴 방지). */
export function annualizeReturn(totalReturn: number, years: number): number {
  if (!(years > 0)) return 0;
  const growth = 1 + totalReturn;
  if (growth <= 0) return -1;
  return Math.pow(growth, 1 / years) - 1;
}

// ── 블록 부트스트랩 (AMENDED-1 #1) ──
// 동결 설정의 bootstrap.method='block', blockTradingDays=60 을 실제로 구현한다.
// IID 셀 재표집 금지 — 셀은 (a) 같은 편입월의 종목 간 동시충격, (b) 인접 편입월 간 시계열 상관을
// 모두 가진다. 따라서 **편입월을 군집으로 묶고**, 연속된 편입월을 **60거래일 범위 블록**으로 재표집한다.
// paired 차이(P2−P1)는 셀 수준에서 유지된 채 군집째 이동한다.

/** 한 편입월 = 하나의 군집. refIdx 는 기준 거래일 달력에서의 위치(블록 길이 산정용). */
export interface MonthCluster {
  monthKey: string;   // 'YYYY-MM'
  refIdx: number;     // 기준 달력 거래일 인덱스
  values: number[];   // 이 월에 속한 셀들의 paired 차이 (종목 간 동시충격 보존)
}

/**
 * 이동 블록 구성: 블록 i = refIdx 가 [refIdx(i), refIdx(i) + blockTradingDays) 안에 드는 연속 월들.
 * blockTradingDays 가 실제 계산에 들어간다 — 값을 바꾸면 블록 구성이 바뀐다.
 */
export function buildBlocks(clusters: MonthCluster[], blockTradingDays: number): number[][] {
  const blocks: number[][] = [];
  for (let i = 0; i < clusters.length; i++) {
    const limit = clusters[i].refIdx + blockTradingDays;
    const b: number[] = [];
    for (let j = i; j < clusters.length && clusters[j].refIdx < limit; j++) b.push(j);
    if (b.length === 0) b.push(i); // 방어 — 항상 자기 자신 포함
    blocks.push(b);
  }
  return blocks;
}

function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * 블록 부트스트랩 95% CI (고정 시드·결정론).
 * 블록을 복원추출로 뽑아 원표본과 같은 월 수가 될 때까지 이어붙이고, 그 월들의 셀 차이를 풀링해 평균을 낸다.
 */
export function blockBootstrapCI(
  clusters: MonthCluster[],
  blockTradingDays: number,
  iterations: number,
  seed: number
): { lo: number; hi: number; blocks: number } {
  if (clusters.length === 0) return { lo: 0, hi: 0, blocks: 0 };
  const blocks = buildBlocks(clusters, blockTradingDays);
  const targetMonths = clusters.length;
  const rnd = mulberry32(seed);
  const means: number[] = [];

  for (let it = 0; it < iterations; it++) {
    let sum = 0, n = 0, months = 0;
    while (months < targetMonths) {
      const b = blocks[Math.floor(rnd() * blocks.length)];
      for (const m of b) {
        if (months >= targetMonths) break;
        for (const v of clusters[m].values) { sum += v; n++; }
        months++;
      }
    }
    means.push(n > 0 ? sum / n : 0);
  }
  means.sort((a, b) => a - b);
  return { lo: percentileSorted(means, 0.025), hi: percentileSorted(means, 0.975), blocks: blocks.length };
}
