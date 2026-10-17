// scripts/backtest/core6SignalRotationV3/stats/bootstrap.ts
// 코어 6종 신호 로테이션 V3 — stationary block bootstrap(V2 §13.2)과 Wilson 구간. 순수 함수, 재현 가능(seed 고정).

import { cagr, calmar, maxDrawdown } from './metrics';

export const DEFAULT_SEED = 260101;
export const DEFAULT_MEAN_BLOCK = 21;
export const DEFAULT_ITERATIONS = 10_000;

/** mulberry32 PRNG. [0,1) 균등. 같은 seed -> 같은 열. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stationary bootstrap(Politis-Romano) 인덱스 열: 길이 length.
 * 첫 인덱스는 균등 추출, 이후 매 스텝 확률 p=1/meanBlock로 새 블록(균등 새 시작점), 아니면 직전+1(원형 래핑).
 * 블록 길이는 평균 meanBlock의 기하분포.
 */
export function stationaryBootstrapIndices(length: number, meanBlock: number, rng: () => number): number[] {
  if (!(length > 0)) return [];
  const p = 1 / meanBlock;
  const out: number[] = new Array(length);
  let cur = Math.floor(rng() * length);
  out[0] = cur;
  for (let i = 1; i < length; i++) {
    if (rng() < p) cur = Math.floor(rng() * length);
    else cur = (cur + 1) % length;
    out[i] = cur;
  }
  return out;
}

export interface ConfidenceInterval {
  /** 2.5% 분위수. */
  lo: number;
  /** 97.5% 분위수. */
  hi: number;
  /** 원표본 점추정(재표본 아님). */
  point: number;
}

export interface BootstrapDiffResult {
  seed: number;
  iterations: number;
  meanBlock: number;
  /** 전략 - B&H CAGR 차이. */
  cagrDiff: ConfidenceInterval;
  /** 전략 - B&H MDD 차이(MDD는 음수이므로 양수 = 전략이 얕음). */
  mddDiff: ConfidenceInterval;
  /** 전략 - B&H Calmar 차이(둘 다 같은 값(+-Infinity 포함)이면 0). */
  calmarDiff: ConfidenceInterval;
  /** 재표본 중 NaN이라 분위수에서 제외된 횟수(정상 입력이면 0). */
  nanDropped: { cagr: number; mdd: number; calmar: number };
}

export interface BootstrapOptions {
  seed?: number;
  iterations?: number;
  meanBlock?: number;
  /** 원표본의 경과 달력일(재표본도 같은 길이이므로 동일하게 쓴다). 필수. */
  elapsedCalendarDays: number;
}

function equityFromReturns(returns: readonly number[], indices: readonly number[]): number[] {
  const eq: number[] = new Array(indices.length + 1);
  eq[0] = 1;
  for (let i = 0; i < indices.length; i++) eq[i + 1] = eq[i] * (1 + returns[indices[i]]);
  return eq;
}

function identityIndices(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** a===b(+-Infinity 포함)이면 0, 아니면 a-b. Infinity-Infinity=NaN 방지. */
function safeDiff(a: number, b: number): number {
  if (a === b) return 0;
  return a - b;
}

/** 정렬된 배열의 nearest-rank 분위수: idx = clamp(ceil(q*n) - 1). */
function nearestRank(sorted: readonly number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const idx = Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1));
  return sorted[idx];
}

function summarize(values: number[], point: number): { ci: ConfidenceInterval; dropped: number } {
  const finite = values.filter(v => !Number.isNaN(v));
  finite.sort((a, b) => a - b);
  return {
    ci: { lo: nearestRank(finite, 0.025), hi: nearestRank(finite, 0.975), point },
    dropped: values.length - finite.length,
  };
}

/**
 * 전략/B&H 일별 수익률 쌍에 **같은 재표본 인덱스**를 적용해 CAGR·MDD·Calmar 차이(전략-B&H)의 95% percentile CI를 구한다.
 * 같은 seed -> 비트 동일 결과.
 */
export function bootstrapPairedDiff(
  strategyReturns: readonly number[],
  buyHoldReturns: readonly number[],
  opts: BootstrapOptions,
): BootstrapDiffResult {
  if (strategyReturns.length !== buyHoldReturns.length) throw new Error('bootstrapPairedDiff: 수익률 쌍의 길이가 다릅니다.');
  const n = strategyReturns.length;
  if (n < 2) throw new Error('bootstrapPairedDiff: 관측이 2개 미만입니다.');
  const seed = opts.seed ?? DEFAULT_SEED;
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  const meanBlock = opts.meanBlock ?? DEFAULT_MEAN_BLOCK;
  const days = opts.elapsedCalendarDays;

  const stats = (idx: readonly number[]) => {
    const se = equityFromReturns(strategyReturns, idx);
    const be = equityFromReturns(buyHoldReturns, idx);
    const sc = cagr(1, se[se.length - 1], days);
    const bc = cagr(1, be[be.length - 1], days);
    const sm = maxDrawdown(se);
    const bm = maxDrawdown(be);
    return {
      cagr: safeDiff(sc, bc),
      mdd: safeDiff(sm, bm),
      calmar: safeDiff(calmar(sc, sm), calmar(bc, bm)),
    };
  };

  const point = stats(identityIndices(n));
  const rng = mulberry32(seed);
  const cagrs: number[] = [];
  const mdds: number[] = [];
  const calmars: number[] = [];
  for (let b = 0; b < iterations; b++) {
    const idx = stationaryBootstrapIndices(n, meanBlock, rng);
    const s = stats(idx);
    cagrs.push(s.cagr);
    mdds.push(s.mdd);
    calmars.push(s.calmar);
  }
  const c = summarize(cagrs, point.cagr);
  const m = summarize(mdds, point.mdd);
  const k = summarize(calmars, point.calmar);
  return {
    seed, iterations, meanBlock,
    cagrDiff: c.ci, mddDiff: m.ci, calmarDiff: k.ci,
    nanDropped: { cagr: c.dropped, mdd: m.dropped, calmar: k.dropped },
  };
}

export interface WilsonInterval {
  p: number;
  lo: number;
  hi: number;
}

/** Wilson 95% 구간(z=1.959963984540054). n=0이면 null. */
export function wilsonInterval(k: number, n: number): WilsonInterval | null {
  if (!(n > 0) || k < 0 || k > n) return null;
  const z = 1.959963984540054;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}
