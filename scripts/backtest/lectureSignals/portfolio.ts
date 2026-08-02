// scripts/backtest/lectureSignals/portfolio.ts
// ---------------------------------------------------------------------------
// 거래 반사실(§7.3 A/B) + D1 노출 오버레이 포트폴리오(§6.3)와 레짐 전방검정(§6.1·§6.4).
//
// 비용: conditionalChannel 매도세 스케줄 + 변동비용(30bps) 재사용(§4.3, run-kr-size 동일).
//   · C/D(앱 매도규칙 재현)는 이번 범위에서 구현하지 않는다(계획서 지시).
//
// 규칙: `any`·`console.*`·`Math.random` 금지.
// ---------------------------------------------------------------------------

import { getKrSellTaxBps } from '../conditionalChannel/pipeline/corporateActions';
import { mulberry32, percentileSorted, randomInt } from '../conditionalChannel/statistics';
import type { SecurityBars } from './configTypes';
import { CONST, KR_VARIABLE_COST_BPS } from './configTypes';
import { mean, stddevPop } from './features';

/** 매도 1회 비용 비율(변동비용 30bps + 그 시점 매도세). tier=BASE. */
export function sellCostFraction(date: string): number {
  const variableBps =
    KR_VARIABLE_COST_BPS.commissionBps +
    KR_VARIABLE_COST_BPS.spreadBps +
    KR_VARIABLE_COST_BPS.slippageBps +
    KR_VARIABLE_COST_BPS.marketImpactBps;
  const taxBps = getKrSellTaxBps(date) ?? 0;
  return (variableBps + taxBps) / 10_000;
}

export interface TradeCf {
  returnA: number | null; // D+1 시가 매도 후 현금
  returnB: number | null; // h거래일 보유 후 시가 매도
  advantageOfSelling: number | null; // A − B (양수=매도가 유리)
}

/**
 * §7.3 A/B 거래 반사실. 기준가=신호일 종가. 둘 다 매도 1회 비용 반영.
 * A: D+1 시가 매도. B: D+1+h 시가 매도(보유 유지). 데이터 끝을 넘으면 해당 값 null.
 */
export function tradeCounterfactual(bars: SecurityBars, i: number, h: number): TradeCf {
  const { adjClose, adjOpen, dates } = bars;
  const n = adjClose.length;
  const ref = adjClose[i];
  if (!(ref > 0) || i + 1 >= n) {
    return { returnA: null, returnB: null, advantageOfSelling: null };
  }
  const sellADate = dates[i + 1];
  const returnA = (adjOpen[i + 1] / ref) * (1 - sellCostFraction(sellADate)) - 1;
  let returnB: number | null = null;
  const endIdx = i + 1 + h;
  if (endIdx < n) {
    returnB = (adjOpen[endIdx] / ref) * (1 - sellCostFraction(dates[endIdx])) - 1;
  }
  const advantageOfSelling = returnB === null ? null : returnA - returnB;
  return { returnA, returnB, advantageOfSelling };
}

/** 반사실 집계(중앙값·10% 하위). */
export interface TradeCfSummary {
  n: number;
  medianA: number;
  medianB: number;
  medianAdvantage: number;
  p10A: number; // A 하위10%(현금화 시 최악)
  p10B: number; // B 하위10%(보유 시 최악)
}

export function summarizeTradeCf(cfs: readonly TradeCf[]): TradeCfSummary {
  const both = cfs.filter((c) => c.returnA !== null && c.returnB !== null);
  const as = both.map((c) => c.returnA as number).sort((x, y) => x - y);
  const bs = both.map((c) => c.returnB as number).sort((x, y) => x - y);
  const adv = both.map((c) => c.advantageOfSelling as number).sort((x, y) => x - y);
  return {
    n: both.length,
    medianA: as.length ? percentileSorted(as, 50) : NaN,
    medianB: bs.length ? percentileSorted(bs, 50) : NaN,
    medianAdvantage: adv.length ? percentileSorted(adv, 50) : NaN,
    p10A: as.length ? percentileSorted(as, 10) : NaN,
    p10B: bs.length ? percentileSorted(bs, 10) : NaN,
  };
}

// ===========================================================================
// D1 포트폴리오 — 노출 오버레이 + 성과지표
// ===========================================================================

export interface PerfStats {
  cagr: number;
  sharpe: number;
  mdd: number; // 최대낙폭(양수, 예: 0.35 = -35%)
  finalEquity: number;
}

/** 일간수익률 시퀀스의 CAGR·연환산 Sharpe·MDD. */
export function perfStats(dailyReturns: readonly number[]): PerfStats {
  const n = dailyReturns.length;
  if (n === 0) return { cagr: NaN, sharpe: NaN, mdd: NaN, finalEquity: 1 };
  let equity = 1;
  let peak = 1;
  let mdd = 0;
  for (const r of dailyReturns) {
    equity *= 1 + r;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? 1 - equity / peak : 0;
    if (dd > mdd) mdd = dd;
  }
  const m = mean(dailyReturns);
  const sd = stddevPop(dailyReturns);
  const sharpe = sd > 0 ? (m / sd) * Math.sqrt(252) : NaN;
  const cagr = equity > 0 ? Math.pow(equity, 252 / n) - 1 : -1;
  return { cagr, sharpe, mdd, finalEquity: equity };
}

export type OverlayMode = 'BASELINE' | 'BLOCK' | 'HALVE';

/**
 * 노출 오버레이(§6.3). regimeRisk[t]는 t일 종가 기준 위험여부(사전 정보).
 * t+1 수익률에 노출을 적용한다(같은 날 종가 신호를 같은 날에 쓰지 않음).
 *   BASELINE: 항상 1. BLOCK: 위험이면 0. HALVE: 위험이면 0.5.
 */
export function applyOverlay(
  ewDailyReturns: readonly number[],
  regimeRisk: readonly (boolean | null)[],
  mode: OverlayMode
): number[] {
  const out: number[] = [];
  for (let t = 0; t < ewDailyReturns.length; t++) {
    const prevRisk = t >= 1 ? regimeRisk[t - 1] : null;
    let e = 1;
    if (mode !== 'BASELINE' && prevRisk === true) e = mode === 'BLOCK' ? 0 : 0.5;
    out.push(e * ewDailyReturns[t]);
  }
  return out;
}

export interface RegimeForwardTest {
  nRisk: number;
  nNormal: number;
  meanFwdRisk: number;
  meanFwdNormal: number;
  medianFwdRisk: number;
  medianFwdNormal: number;
  diffMean: number; // risk − normal (음수 기대)
  ciLower: number;
  ciUpper: number;
  pValue: number;
}

/**
 * 레짐별 전방수익 차이(§6.1). 등가중 유니버스 일간수익 rEw로 h거래일 전방 누적수익을 만들고
 * regimeRisk[t]로 분류, (risk − normal) 평균차를 60일 이동블록 부트스트랩으로 검정.
 */
export function regimeForwardTest(
  ewDailyReturns: readonly number[],
  regimeRisk: readonly (boolean | null)[],
  horizon: number,
  seed: number
): RegimeForwardTest {
  const n = ewDailyReturns.length;
  // 누적 지수
  const cum: number[] = new Array(n + 1);
  cum[0] = 1;
  for (let t = 0; t < n; t++) cum[t + 1] = cum[t] * (1 + ewDailyReturns[t]);
  // 각 t의 전방 h수익(t..t+h), t의 레짐으로 라벨
  const risk: number[] = [];
  const normal: number[] = [];
  const labeled: { fwd: number; isRisk: boolean; t: number }[] = [];
  for (let t = 0; t < n - horizon; t++) {
    const lab = regimeRisk[t];
    if (lab === null) continue;
    const fwd = cum[t + horizon] / cum[t] - 1; // t시점(종가) 이후 h일
    if (lab) risk.push(fwd);
    else normal.push(fwd);
    labeled.push({ fwd, isRisk: lab, t });
  }
  const diffMean = mean(risk) - mean(normal);
  // 60일 이동블록 부트스트랩(라벨 보존, 동시성 보존)
  const block = CONST.blockDays;
  const rng = mulberry32(seed);
  const samples: number[] = [];
  const L = labeled.length;
  if (L >= block) {
    for (let it = 0; it < CONST.bootstrapIterations; it++) {
      const rSum = { s: 0, c: 0 };
      const nSum = { s: 0, c: 0 };
      let filled = 0;
      while (filled < L) {
        const start = randomInt(rng, L);
        for (let k = 0; k < block && filled < L; k++) {
          const idx = (start + k) % L;
          const e = labeled[idx];
          if (e.isRisk) {
            rSum.s += e.fwd;
            rSum.c++;
          } else {
            nSum.s += e.fwd;
            nSum.c++;
          }
          filled++;
        }
      }
      if (rSum.c > 0 && nSum.c > 0) samples.push(rSum.s / rSum.c - nSum.s / nSum.c);
    }
  }
  samples.sort((a, b) => a - b);
  const alpha = (1 - CONST.confidenceLevel) / 2;
  const ciLower = samples.length ? percentileSorted(samples, alpha * 100) : NaN;
  const ciUpper = samples.length ? percentileSorted(samples, (1 - alpha) * 100) : NaN;
  let leq = 0;
  let geq = 0;
  for (const s of samples) {
    if (s <= 0) leq++;
    if (s >= 0) geq++;
  }
  const pValue = samples.length ? Math.min(1, 2 * Math.min(leq / samples.length, geq / samples.length)) : 1;
  return {
    nRisk: risk.length,
    nNormal: normal.length,
    meanFwdRisk: mean(risk),
    meanFwdNormal: mean(normal),
    medianFwdRisk: risk.length ? percentileSorted([...risk].sort((a, b) => a - b), 50) : NaN,
    medianFwdNormal: normal.length ? percentileSorted([...normal].sort((a, b) => a - b), 50) : NaN,
    diffMean,
    ciLower,
    ciUpper,
    pValue,
  };
}
