// scripts/backtest/holdingsTurtleCycle/aggregate.ts
// 순수 집계 함수 — 평균/중앙/분위수, 구간 분류, 최대 기여 종목 제거 민감도.

import { CellResult } from './engine';

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function median(xs: number[]): number {
  return percentile(xs, 0.5);
}

export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function fractionTrue(bs: boolean[]): number {
  return bs.length ? bs.filter(Boolean).length / bs.length : 0;
}

/** 시작일 기준 리서치 구간(§보고 범위) — 전체 기간을 4개로 나눈 고정 경계. */
export type PeriodBucket = '2015-2019' | '2020-2022' | '2023-present';

export function periodBucketOf(dateISO: string): PeriodBucket {
  const y = Number(dateISO.slice(0, 4));
  if (y <= 2019) return '2015-2019';
  if (y <= 2022) return '2020-2022';
  return '2023-present';
}

export interface CellStats {
  n: number;
  medianCagrBh: number;
  meanCagrBh: number;
  medianCagrTurtle: number;
  meanCagrTurtle: number;
  p10FinalRatioRatio: number;
  p50FinalRatioRatio: number;
  p90FinalRatioRatio: number;
  turtleWinRate: number;
  medianMddBh: number;
  medianMddTurtle: number;
  medianTimeInMarketPct: number;
  medianRoundTrips: number;
  medianWhipsaws: number;
  worst50RateBh: number;
  worst50RateTurtle: number;
}

export function summarize(cells: readonly CellResult[]): CellStats {
  return {
    n: cells.length,
    medianCagrBh: median(cells.map(c => c.bhCagr)),
    meanCagrBh: mean(cells.map(c => c.bhCagr)),
    medianCagrTurtle: median(cells.map(c => c.turtleCagr)),
    meanCagrTurtle: mean(cells.map(c => c.turtleCagr)),
    p10FinalRatioRatio: percentile(cells.map(c => c.finalRatioRatio), 0.1),
    p50FinalRatioRatio: percentile(cells.map(c => c.finalRatioRatio), 0.5),
    p90FinalRatioRatio: percentile(cells.map(c => c.finalRatioRatio), 0.9),
    turtleWinRate: fractionTrue(cells.map(c => c.turtleBeatsBh)),
    medianMddBh: median(cells.map(c => c.bhMdd)),
    medianMddTurtle: median(cells.map(c => c.turtleMdd)),
    medianTimeInMarketPct: median(cells.map(c => c.timeInMarketPct)),
    medianRoundTrips: median(cells.map(c => c.roundTrips)),
    medianWhipsaws: median(cells.map(c => c.whipsaws)),
    worst50RateBh: fractionTrue(cells.map(c => c.bhWorst50)),
    worst50RateTurtle: fractionTrue(cells.map(c => c.turtleWorst50)),
  };
}

export function groupBy<T, K extends string>(items: readonly T[], keyFn: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = keyFn(it);
    const arr = m.get(k);
    if (arr) arr.push(it); else m.set(k, [it]);
  }
  return m;
}

export interface LeaveOneOutResult {
  droppedTicker: string;
  /** 제거 전 median(finalRatioRatio). */
  before: number;
  /** 제거 후 median(finalRatioRatio). */
  after: number;
  /** "터틀이 우위(median>1)"라는 방향 결론이 제거 후에도 유지되는지. */
  directionUnchanged: boolean;
}

/**
 * 종목별 기여도 = 그 종목 셀들의 (finalRatioRatio-1) 합. 절댓값 최대 기여 종목을 제거했을 때
 * 전체 median(finalRatioRatio) 방향(>1 vs <=1)이 뒤집히는지 확인한다 (§13-2 BTC 교훈 — 최대 기여 종목 민감도).
 */
export function leaveOneOutMaxContributor(cells: readonly CellResult[]): LeaveOneOutResult | null {
  if (cells.length === 0) return null;
  const byTicker = groupBy(cells, c => c.ticker);
  let maxTicker = '', maxAbs = -1;
  for (const [ticker, cs] of byTicker) {
    const contrib = cs.reduce((s, c) => s + (c.finalRatioRatio - 1), 0);
    if (Math.abs(contrib) > maxAbs) { maxAbs = Math.abs(contrib); maxTicker = ticker; }
  }
  const before = median(cells.map(c => c.finalRatioRatio));
  const remaining = cells.filter(c => c.ticker !== maxTicker);
  const after = remaining.length ? median(remaining.map(c => c.finalRatioRatio)) : before;
  return {
    droppedTicker: maxTicker, before, after,
    directionUnchanged: (before > 1) === (after > 1),
  };
}
