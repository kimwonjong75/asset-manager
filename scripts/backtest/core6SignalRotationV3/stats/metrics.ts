// scripts/backtest/core6SignalRotationV3/stats/metrics.ts
// 코어 6종 신호 로테이션 V3 — 성과 지표(§14, V2 §14.1). 순수 함수.

/** CAGR = (end/start)^(365.2425/경과 달력일) − 1. start<=0 또는 일수<=0이면 NaN, end<=0이면 −1(전손). */
export function cagr(startEquity: number, endEquity: number, elapsedCalendarDays: number): number {
  if (!(startEquity > 0) || !(elapsedCalendarDays > 0)) return NaN;
  if (endEquity <= 0) return -1;
  return Math.pow(endEquity / startEquity, 365.2425 / elapsedCalendarDays) - 1;
}

/** 최대 낙폭. **음수 또는 0**(예: -0.25). 첫 값도 고점 후보. 보고 시 abs를 쓴다. */
export function maxDrawdown(equity: readonly number[]): number {
  let peak = -Infinity;
  let mdd = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = v / peak - 1;
      if (dd < mdd) mdd = dd;
    }
  }
  return mdd;
}

/** Calmar = CAGR/|MDD|. MDD=0이면 CAGR>0→+Infinity, ==0→0, <0→−Infinity (V1 특수값 정의). */
export function calmar(cagrValue: number, mdd: number): number {
  if (Number.isNaN(cagrValue) || Number.isNaN(mdd)) return NaN;
  if (mdd === 0) {
    if (cagrValue > 0) return Infinity;
    if (cagrValue < 0) return -Infinity;
    return 0;
  }
  return cagrValue / Math.abs(mdd);
}

/** 일별 단순수익률 e[i]/e[i-1]−1 (길이 n−1). */
export function dailyReturns(equity: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < equity.length; i++) out.push(equity[i] / equity[i - 1] - 1);
  return out;
}

/** 연환산 변동성 = 표본표준편차(n−1) × √252. 관측 2개 미만이면 NaN. */
export function annualizedVolatility(returns: readonly number[]): number {
  const n = returns.length;
  if (n < 2) return NaN;
  let mean = 0;
  for (const r of returns) mean += r;
  mean /= n;
  let ss = 0;
  for (const r of returns) ss += (r - mean) * (r - mean);
  return Math.sqrt(ss / (n - 1)) * Math.sqrt(252);
}

/** MDD 상대 감소 = (|B&H| − |전략|)/|B&H|. B&H MDD가 0이면 null. 양수 = 전략이 얕음. */
export function mddRelativeReduction(mddBH: number, mddStrategy: number): number | null {
  const bh = Math.abs(mddBH);
  if (bh === 0) return null;
  return (bh - Math.abs(mddStrategy)) / bh;
}
