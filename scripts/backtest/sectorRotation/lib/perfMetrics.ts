// scripts/backtest/sectorRotation/lib/perfMetrics.ts
// Phase 2 성과 지표(순수). 앱의 scripts/backtest/lib/metrics.ts 는 무접촉·미임포트(별도 구현).
// 사전등록 §8: CAGR/MDD/Sharpe/Sortino/Calmar/연도별/최악 1·3년/회전율/비용/국면.
// 월수익은 "체결월" 단위(open-to-open). 연율화는 12개월 기준.

export interface CoreMetrics {
  nMonths: number;
  totalReturn: number;
  cagr: number;
  mdd: number; // 음수(예: -0.35)
  vol: number; // 연율화 표준편차
  sharpe: number; // 무위험 대비, 연율화
  sortino: number;
  calmar: number;
  bestMonth: number;
  worstMonth: number;
  worst1yr: number; // 롤링 12개월 최악(복리)
  worst3yr: number; // 롤링 36개월 최악(연율화 CAGR)
  hitRate: number; // 월 승률
}

/** 자산곡선(길이 nMonths+1, [0]=1.0)과 월수익 배열로 핵심 지표 계산. */
export function coreMetrics(
  equity: number[],
  monthlyReturns: number[],
  rfMonthly: number[]
): CoreMetrics {
  const nMonths = monthlyReturns.length;
  const totalReturn = equity[equity.length - 1] / equity[0] - 1;
  const cagr = nMonths > 0 ? Math.pow(equity[equity.length - 1] / equity[0], 12 / nMonths) - 1 : 0;

  // MDD
  let peak = equity[0];
  let mdd = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    const dd = v / peak - 1;
    if (dd < mdd) mdd = dd;
  }

  const mean = avg(monthlyReturns);
  const sd = stdev(monthlyReturns);
  const vol = sd * Math.sqrt(12);

  // Sharpe: 무위험(현금) 초과, 연율화.
  const excess = monthlyReturns.map((r, i) => r - (rfMonthly[i] ?? 0));
  const exMean = avg(excess);
  const exSd = stdev(excess);
  const sharpe = exSd > 0 ? (exMean / exSd) * Math.sqrt(12) : 0;

  // Sortino: 하방(초과수익<0)만.
  const downside = excess.filter(r => r < 0);
  const dd =
    downside.length > 0
      ? Math.sqrt(downside.reduce((a, b) => a + b * b, 0) / excess.length)
      : 0;
  const sortino = dd > 0 ? (exMean / dd) * Math.sqrt(12) : 0;

  const calmar = mdd < 0 ? cagr / Math.abs(mdd) : 0;

  const worst1yr = worstRollingCompound(monthlyReturns, 12);
  const worst3yr = worstRolling3yrCagr(monthlyReturns, 36);

  const wins = monthlyReturns.filter(r => r > 0).length;

  return {
    nMonths,
    totalReturn,
    cagr,
    mdd,
    vol,
    sharpe,
    sortino,
    calmar,
    bestMonth: nMonths ? Math.max(...monthlyReturns) : 0,
    worstMonth: nMonths ? Math.min(...monthlyReturns) : 0,
    worst1yr,
    worst3yr,
    hitRate: nMonths ? wins / nMonths : 0,
  };
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = avg(xs);
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

/** 롤링 window개월 복리 수익의 최솟값(표본 부족이면 전체 복리). */
export function worstRollingCompound(returns: number[], window: number): number {
  if (returns.length < window) {
    return returns.reduce((acc, r) => acc * (1 + r), 1) - 1;
  }
  let worst = Infinity;
  for (let i = 0; i + window <= returns.length; i++) {
    let c = 1;
    for (let j = i; j < i + window; j++) c *= 1 + returns[j];
    const ret = c - 1;
    if (ret < worst) worst = ret;
  }
  return worst === Infinity ? 0 : worst;
}

/** 롤링 window(=36)개월의 최악 연율화 CAGR. */
export function worstRolling3yrCagr(returns: number[], window: number): number {
  if (returns.length < window) {
    const c = returns.reduce((acc, r) => acc * (1 + r), 1);
    return returns.length > 0 ? Math.pow(c, 12 / returns.length) - 1 : 0;
  }
  let worst = Infinity;
  for (let i = 0; i + window <= returns.length; i++) {
    let c = 1;
    for (let j = i; j < i + window; j++) c *= 1 + returns[j];
    const cagr = Math.pow(c, 12 / window) - 1;
    if (cagr < worst) worst = cagr;
  }
  return worst === Infinity ? 0 : worst;
}

/** 연도별 수익률(체결월 라벨 YYYY-MM 로 그룹핑). */
export function annualReturns(
  months: string[],
  monthlyReturns: number[]
): { year: number; ret: number; nMonths: number }[] {
  const map = new Map<number, number[]>();
  for (let i = 0; i < months.length; i++) {
    const y = Number(months[i].slice(0, 4));
    if (!map.has(y)) map.set(y, []);
    map.get(y)!.push(monthlyReturns[i]);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([year, rs]) => ({
      year,
      ret: rs.reduce((acc, r) => acc * (1 + r), 1) - 1,
      nMonths: rs.length,
    }));
}

/** 연회전율(편도) = 월평균 회전율 × 12. */
export function annualizedTurnover(turnoverSeries: number[]): number {
  return avg(turnoverSeries) * 12;
}

/** 총비용 차감폭(단순 합)과 연율화. */
export function costDrag(costSeries: number[]): { total: number; annualized: number } {
  const total = costSeries.reduce((a, b) => a + b, 0);
  const annualized = costSeries.length ? total * (12 / costSeries.length) : 0;
  return { total, annualized };
}

// ─── 국면 슬라이싱(고정 창) ──────────────────────────────────
export interface RegimeWindow {
  key: string;
  label: string;
  from: string; // YYYY-MM inclusive
  to: string; // YYYY-MM inclusive
}

export const FIXED_REGIMES: RegimeWindow[] = [
  { key: 'covid', label: '코로나 급락(2020-02~2020-04)', from: '2020-02', to: '2020-04' },
  { key: 'recover2020', label: '급반등(2020-05~2020-12)', from: '2020-05', to: '2020-12' },
  { key: 'bear2022', label: '2022 약세장', from: '2022-01', to: '2022-12' },
];

/** 특정 월 구간의 복리 수익. */
export function windowReturn(
  months: string[],
  monthlyReturns: number[],
  from: string,
  to: string
): { ret: number; nMonths: number } {
  let c = 1;
  let n = 0;
  for (let i = 0; i < months.length; i++) {
    if (months[i] >= from && months[i] <= to) {
      c *= 1 + monthlyReturns[i];
      n++;
    }
  }
  return { ret: n ? c - 1 : 0, nMonths: n };
}

/** 벤치마크(예: SPY) 월수익 부호로 상승/하락장 분리 평균(시장 포착). */
export function upDownCapture(
  stratReturns: number[],
  benchReturns: number[]
): { upAvgStrat: number; upAvgBench: number; downAvgStrat: number; downAvgBench: number; upN: number; downN: number } {
  const up: number[] = [];
  const upB: number[] = [];
  const down: number[] = [];
  const downB: number[] = [];
  for (let i = 0; i < stratReturns.length; i++) {
    if ((benchReturns[i] ?? 0) >= 0) {
      up.push(stratReturns[i]);
      upB.push(benchReturns[i]);
    } else {
      down.push(stratReturns[i]);
      downB.push(benchReturns[i]);
    }
  }
  return {
    upAvgStrat: avg(up),
    upAvgBench: avg(upB),
    downAvgStrat: avg(down),
    downAvgBench: avg(downB),
    upN: up.length,
    downN: down.length,
  };
}

// ─── 고정 시기 분할 ──────────────────────────────────────────
/** months/monthlyReturns 를 [from,to] 구간으로 잘라 (equity 재구성) 반환. */
export function slicePeriod(
  months: string[],
  monthlyReturns: number[],
  rfMonthly: number[],
  from: string,
  to: string
): { months: string[]; equity: number[]; monthlyReturns: number[]; rf: number[] } {
  const mm: string[] = [];
  const rr: number[] = [];
  const rf: number[] = [];
  for (let i = 0; i < months.length; i++) {
    if (months[i] >= from && months[i] <= to) {
      mm.push(months[i]);
      rr.push(monthlyReturns[i]);
      rf.push(rfMonthly[i] ?? 0);
    }
  }
  const eq: number[] = [1];
  for (const r of rr) eq.push(eq[eq.length - 1] * (1 + r));
  return { months: mm, equity: eq, monthlyReturns: rr, rf };
}

// ─── 강건성: 단일 자산 기여 / 상위 거래 제거 ─────────────────
export interface Trade {
  symbol: string;
  execMonth: string;
  weight: number;
  assetReturn: number;
  contribution: number;
}

/** 자산별 산술 기여(Σ w*r) 합. */
export function contributionByAsset(trades: Trade[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of trades) m.set(t.symbol, (m.get(t.symbol) ?? 0) + t.contribution);
  return m;
}

/**
 * 상위 k개 기여 거래(월×자산)를 제거(수익 0으로)했을 때의 월수익 재구성.
 * 반환: 재구성 월수익 배열(months 순서). 원 전략의 월별 target 구조를 반영해
 * 해당 월의 그 자산 기여만 빼고(비용은 유지 근사) 재계산.
 */
export function dropTopTrades(
  months: string[],
  grossMonthlyReturns: number[],
  costSeries: number[],
  trades: Trade[],
  k: number
): { monthlyReturns: number[]; removed: Trade[] } {
  const sorted = [...trades].sort((a, b) => b.contribution - a.contribution).slice(0, k);
  const removeByMonth = new Map<string, number>();
  for (const t of sorted) {
    removeByMonth.set(t.execMonth, (removeByMonth.get(t.execMonth) ?? 0) + t.contribution);
  }
  const out: number[] = [];
  for (let i = 0; i < months.length; i++) {
    const removed = removeByMonth.get(months[i]) ?? 0;
    const grossAdj = grossMonthlyReturns[i] - removed;
    const cost = costSeries[i] ?? 0;
    out.push((1 - cost) * (1 + grossAdj) - 1);
  }
  return { monthlyReturns: out, removed: sorted };
}

/** 월수익 배열 → equity(시작 1.0). */
export function equityFromReturns(returns: number[]): number[] {
  const eq: number[] = [1];
  for (const r of returns) eq.push(eq[eq.length - 1] * (1 + r));
  return eq;
}
