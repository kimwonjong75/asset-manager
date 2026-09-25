// scripts/backtest/portfolioTurtle/metrics.ts
// 순수 집계 함수 — 여러 시작일 실행결과를 하나의 조합 요약으로 압축한다.
// holdingsTurtleCycle/aggregate.ts와 동일한 통계 헬퍼(median/percentile 등)를 재사용 정신으로 재작성
// (그 파일의 CellStats는 이번 셀 구조와 달라 그대로 import할 수 없다 — 로컬 사본).

import type { PortfolioRunResult, CompletedTradeRecord } from './engine';

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

/**
 * 최대낙폭(MDD) 발생 이후 그 낙폭 직전 고점을 다시 회복하는 데 걸린 일수(달력일).
 * 기간 종료까지 회복 못 하면 null(사후에 더 걸릴 수 있음 — 보수적으로 미회복 처리).
 */
export function recoveryDays(dates: readonly string[], curve: readonly number[]): number | null {
  if (dates.length !== curve.length || curve.length === 0) return null;
  let peak = -Infinity, peakIdx = -1, mdd = 0, troughIdx = -1, peakAtTrough = -Infinity, peakIdxAtTrough = -1;
  for (let i = 0; i < curve.length; i++) {
    if (curve[i] > peak) { peak = curve[i]; peakIdx = i; }
    const dd = peak > 0 ? (peak - curve[i]) / peak : 0;
    if (dd > mdd) { mdd = dd; troughIdx = i; peakAtTrough = peak; peakIdxAtTrough = peakIdx; }
  }
  if (mdd <= 1e-12) return 0; // 낙폭 자체가 없었음 — 회복도 즉시(0일)로 취급
  if (troughIdx < 0 || peakAtTrough <= 0 || peakIdxAtTrough < 0) return null;
  for (let i = troughIdx; i < curve.length; i++) {
    if (curve[i] >= peakAtTrough) {
      const days = (Date.parse(`${dates[i]}T00:00:00Z`) - Date.parse(`${dates[peakIdxAtTrough]}T00:00:00Z`)) / 86_400_000;
      return days;
    }
  }
  return null;
}

export type PeriodBucket = '2016-2019' | '2020-2022' | '2023-present';

/** 시작일("YYYY-MM") → 구간. holdingsTurtleCycle periodBucketOf와 동일 경계(하한만 2016으로 이동). */
export function periodBucketOfStart(startYyyyMm: string): PeriodBucket {
  const y = Number(startYyyyMm.slice(0, 4));
  if (y <= 2019) return '2016-2019';
  if (y <= 2022) return '2020-2022';
  return '2023-present';
}

export interface StartRunEntry {
  startYyyyMm: string;
  turtle: PortfolioRunResult;
  bh: PortfolioRunResult;
  sellOnly: PortfolioRunResult;
}

export interface ComboSummary {
  n: number;
  medianCagrTurtle: number;
  medianCagrBh: number;
  medianCagrSellOnly: number;
  medianMddTurtle: number;
  medianMddBh: number;
  medianCalmarTurtle: number;
  medianFinalRatioVsBh: number;   // 터틀최종가치 ÷ B&H최종가치, 중앙값
  p10FinalRatioVsBh: number;
  p90FinalRatioVsBh: number;
  turtleWinRateVsBh: number;      // 터틀최종가치 > B&H최종가치 비율
  medianReentryFillsPerYear: number;
  medianAvgCashPct: number;
  totalLambdaScaleDays: number;
  maxConcurrentReenteredAcrossStarts: number;
  totalInvariantViolations: number;
  completedRoundTrips: number;
  /** MDD 이후 직전 고점 회복까지 걸린 일수 — null(미회복) 제외한 중앙값. */
  medianRecoveryDaysTurtle: number | null;
  medianRecoveryDaysBh: number | null;
  unrecoveredRateTurtle: number;
  unrecoveredRateBh: number;
}

export function summarizeCombo(entries: readonly StartRunEntry[]): ComboSummary {
  const finalRatios = entries.map(e => e.bh.finalEquityKRW > 0 ? e.turtle.finalEquityKRW / e.bh.finalEquityKRW : 0);
  const invSum = (inv: PortfolioRunResult['invariants']): number =>
    inv.negativeCash + inv.positionCapBreach + inv.totalRiskBreach + inv.maxUnitsBreach +
    inv.duplicatePosition + inv.duplicateOrder + inv.sameBarFill + inv.holidayFill;
  const recTurtle = entries.map(e => recoveryDays(e.turtle.dates, e.turtle.equityCurve));
  const recBh = entries.map(e => recoveryDays(e.bh.dates, e.bh.equityCurve));
  const validRecTurtle = recTurtle.filter((v): v is number => v !== null);
  const validRecBh = recBh.filter((v): v is number => v !== null);
  return {
    n: entries.length,
    medianCagrTurtle: median(entries.map(e => e.turtle.cagr)),
    medianCagrBh: median(entries.map(e => e.bh.cagr)),
    medianCagrSellOnly: median(entries.map(e => e.sellOnly.cagr)),
    medianMddTurtle: median(entries.map(e => e.turtle.mdd)),
    medianMddBh: median(entries.map(e => e.bh.mdd)),
    medianCalmarTurtle: median(entries.map(e => e.turtle.calmar)),
    medianFinalRatioVsBh: median(finalRatios),
    p10FinalRatioVsBh: percentile(finalRatios, 0.1),
    p90FinalRatioVsBh: percentile(finalRatios, 0.9),
    turtleWinRateVsBh: entries.filter(e => e.turtle.finalEquityKRW > e.bh.finalEquityKRW).length / (entries.length || 1),
    medianReentryFillsPerYear: median(entries.map(e => e.turtle.years > 0 ? e.turtle.totalReentryFills / e.turtle.years : 0)),
    medianAvgCashPct: median(entries.map(e => e.turtle.avgCashPct)),
    totalLambdaScaleDays: entries.reduce((s, e) => s + e.turtle.lambdaScaleDays, 0),
    maxConcurrentReenteredAcrossStarts: Math.max(0, ...entries.map(e => e.turtle.maxConcurrentReentered)),
    totalInvariantViolations: entries.reduce((s, e) => s + invSum(e.turtle.invariants), 0),
    completedRoundTrips: entries.reduce((s, e) => s + e.turtle.completedRoundTrips, 0),
    medianRecoveryDaysTurtle: validRecTurtle.length ? median(validRecTurtle) : null,
    medianRecoveryDaysBh: validRecBh.length ? median(validRecBh) : null,
    unrecoveredRateTurtle: entries.length ? (entries.length - validRecTurtle.length) / entries.length : 0,
    unrecoveredRateBh: entries.length ? (entries.length - validRecBh.length) / entries.length : 0,
  };
}

/** 3구간별 터틀-BH 초과 CAGR 평균(승패 프레이밍·서술용 — 판정기준 4는 아래 periodAbsoluteConsistency). */
export function periodConsistency(
  entries: readonly StartRunEntry[]
): Record<PeriodBucket, { n: number; meanExcessCagr: number }> {
  const buckets: Record<PeriodBucket, number[]> = { '2016-2019': [], '2020-2022': [], '2023-present': [] };
  for (const e of entries) {
    const b = periodBucketOfStart(e.startYyyyMm);
    buckets[b].push(e.turtle.cagr - e.bh.cagr);
  }
  const out = {} as Record<PeriodBucket, { n: number; meanExcessCagr: number }>;
  for (const k of Object.keys(buckets) as PeriodBucket[]) out[k] = { n: buckets[k].length, meanExcessCagr: mean(buckets[k]) };
  return out;
}

/**
 * 3구간별 터틀 **자체** 평균 CAGR(절대치, B&H 대비 아님) — 판정기준 4("3개 구간 중 ≥2개에서
 * 평균 R > 0")를 CAGR 기준으로 근사(구간별 완료거래 수가 적어 R 자체의 구간별 평균은 표본이
 * 작을 수 있어, 포트폴리오 CAGR을 1차 지표로 쓰고 meanRMultipleByPeriod를 보조 지표로 병기한다).
 */
export function periodAbsoluteConsistency(
  entries: readonly StartRunEntry[]
): Record<PeriodBucket, { n: number; meanCagr: number }> {
  const buckets: Record<PeriodBucket, number[]> = { '2016-2019': [], '2020-2022': [], '2023-present': [] };
  for (const e of entries) buckets[periodBucketOfStart(e.startYyyyMm)].push(e.turtle.cagr);
  const out = {} as Record<PeriodBucket, { n: number; meanCagr: number }>;
  for (const k of Object.keys(buckets) as PeriodBucket[]) out[k] = { n: buckets[k].length, meanCagr: mean(buckets[k]) };
  return out;
}

/** 재매수분(REENTERED) 완료거래의 평균 R(pnl÷1R). 정의 안 되는 거래(rMultiple=null)는 제외. */
export function meanRMultiple(entries: readonly StartRunEntry[]): { n: number; meanR: number } {
  const rs: number[] = [];
  for (const e of entries) for (const t of e.turtle.trades as CompletedTradeRecord[]) if (t.rMultiple !== null) rs.push(t.rMultiple);
  return { n: rs.length, meanR: mean(rs) };
}

/** 구간별 평균 R — 판정기준 4의 원 정의(R 기준) 보조 지표. */
export function meanRMultipleByPeriod(entries: readonly StartRunEntry[]): Record<PeriodBucket, { n: number; meanR: number }> {
  const buckets: Record<PeriodBucket, number[]> = { '2016-2019': [], '2020-2022': [], '2023-present': [] };
  for (const e of entries) {
    const b = periodBucketOfStart(e.startYyyyMm);
    for (const t of e.turtle.trades as CompletedTradeRecord[]) if (t.rMultiple !== null) buckets[b].push(t.rMultiple);
  }
  const out = {} as Record<PeriodBucket, { n: number; meanR: number }>;
  for (const k of Object.keys(buckets) as PeriodBucket[]) out[k] = { n: buckets[k].length, meanR: mean(buckets[k]) };
  return out;
}

/** 재매수분(REENTERED) 완료거래 pnl 합 — 종목별. 증분기여·집중도 계산의 기초 재료. */
export function reenteredPnlByTicker(entries: readonly StartRunEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) {
    for (const t of e.turtle.trades as CompletedTradeRecord[]) {
      if (t.kind !== 'reentered') continue;
      m.set(t.ticker, (m.get(t.ticker) ?? 0) + t.pnlKRW);
    }
  }
  return m;
}

export interface IncrementalContribution {
  ticker: string;
  incrementalPnlKRW: number;
}

/**
 * 변형(A/C/G) vs 베이스라인(B) 종목별 재매수분 손익 차 — "불타기 증분손익"의 종목별 기여.
 * §13-2 BTC 교훈과 동일 정의(변형 - 베이스라인, 종목별).
 */
export function incrementalContributions(
  variantEntries: readonly StartRunEntry[], baselineEntries: readonly StartRunEntry[]
): IncrementalContribution[] {
  const v = reenteredPnlByTicker(variantEntries);
  const b = reenteredPnlByTicker(baselineEntries);
  const tickers = new Set([...v.keys(), ...b.keys()]);
  return Array.from(tickers).map(ticker => ({
    ticker, incrementalPnlKRW: (v.get(ticker) ?? 0) - (b.get(ticker) ?? 0),
  }));
}

/** 최대 |증분기여| 종목과 그 비중(분모=모든 종목 증분손익의 절댓값 합). */
export function maxContributorConcentration(contribs: readonly IncrementalContribution[]): {
  ticker: string; shareOfTotal: number; totalIncrementalPnlKRW: number;
} | null {
  if (contribs.length === 0) return null;
  let maxTicker = '', maxAbs = -1, totalAbs = 0, total = 0;
  for (const c of contribs) {
    totalAbs += Math.abs(c.incrementalPnlKRW);
    total += c.incrementalPnlKRW;
    if (Math.abs(c.incrementalPnlKRW) > maxAbs) { maxAbs = Math.abs(c.incrementalPnlKRW); maxTicker = c.ticker; }
  }
  return { ticker: maxTicker, shareOfTotal: totalAbs > 0 ? maxAbs / totalAbs : 0, totalIncrementalPnlKRW: total };
}

/** 자산군별 기여 — 재매수분 pnl 합(KRW), 자산군 라벨은 CompletedTradeRecord.assetClass. */
export function pnlByAssetClass(entries: readonly StartRunEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) {
    for (const t of e.turtle.trades as CompletedTradeRecord[]) {
      m.set(t.assetClass, (m.get(t.assetClass) ?? 0) + t.pnlKRW);
    }
  }
  return m;
}
