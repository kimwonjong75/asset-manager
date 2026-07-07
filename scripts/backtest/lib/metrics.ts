// scripts/backtest/lib/metrics.ts
// 백테스트 평가 지표 — 순수 함수. CAGR/MDD/Calmar/손익비/연속손실/최악 3년 롤링/연도별 수익률.

export interface EquityPoint {
  date: string;
  value: number;
}

export interface ClosedTrade {
  ticker: string;
  openDate: string;
  closeDate: string;
  pnlKRW: number; // 실현손익 (비용 반영 후, KRW)
}

export function cagr(equity: EquityPoint[]): number {
  if (equity.length < 2) return 0;
  const first = equity[0].value;
  const last = equity[equity.length - 1].value;
  if (!(first > 0) || !(last > 0)) return 0;
  const years = yearsBetween(equity[0].date, equity[equity.length - 1].date);
  if (!(years > 0)) return 0;
  return Math.pow(last / first, 1 / years) - 1;
}

export function maxDrawdown(equity: EquityPoint[]): number {
  let peak = -Infinity;
  let mdd = 0;
  for (const p of equity) {
    if (p.value > peak) peak = p.value;
    if (peak > 0) {
      const dd = (p.value - peak) / peak;
      if (dd < mdd) mdd = dd;
    }
  }
  return mdd; // 음수 (예: -0.25 = -25%)
}

export function calmar(cagrValue: number, mddValue: number): number {
  if (!(Math.abs(mddValue) > 0)) return 0;
  return cagrValue / Math.abs(mddValue);
}

export function profitFactor(trades: ClosedTrade[]): number {
  let gains = 0;
  let losses = 0;
  for (const t of trades) {
    if (t.pnlKRW > 0) gains += t.pnlKRW;
    else losses += -t.pnlKRW;
  }
  if (losses === 0) return gains > 0 ? Infinity : 0;
  return gains / losses;
}

export function winRate(trades: ClosedTrade[]): number {
  if (trades.length === 0) return 0;
  const wins = trades.filter(t => t.pnlKRW > 0).length;
  return wins / trades.length;
}

/** 종료일 순서 기준 최대 연속 손실 거래 수. */
export function maxConsecutiveLosses(trades: ClosedTrade[]): number {
  const sorted = [...trades].sort((a, b) => a.closeDate.localeCompare(b.closeDate));
  let max = 0;
  let cur = 0;
  for (const t of sorted) {
    if (t.pnlKRW < 0) {
      cur++;
      if (cur > max) max = cur;
    } else {
      cur = 0;
    }
  }
  return max;
}

/** 최악의 3년(약 756 거래일) 롤링 누적 수익률. */
export function worstRollingReturn(equity: EquityPoint[], years: number = 3): number {
  if (equity.length < 2) return 0;
  const windowDays = Math.round(years * 252);
  let worst = Infinity;
  for (let i = 0; i + windowDays < equity.length; i++) {
    const start = equity[i].value;
    const end = equity[i + windowDays].value;
    if (!(start > 0)) continue;
    const ret = end / start - 1;
    if (ret < worst) worst = ret;
  }
  if (worst === Infinity) {
    // 전체 구간이 windowDays보다 짧으면 전체 구간 수익률로 대체
    const start = equity[0].value;
    const end = equity[equity.length - 1].value;
    return start > 0 ? end / start - 1 : 0;
  }
  return worst;
}

/** 연도별 수익률 (연말 대비 연말, 첫해는 시작일 대비). */
export function annualReturns(equity: EquityPoint[]): Array<{ year: string; returnPct: number }> {
  if (equity.length === 0) return [];
  const byYear = new Map<string, EquityPoint[]>();
  for (const p of equity) {
    const y = p.date.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(p);
  }
  const years = Array.from(byYear.keys()).sort();
  const result: Array<{ year: string; returnPct: number }> = [];
  let prevYearEnd: number | null = null;
  for (const y of years) {
    const pts = byYear.get(y)!;
    const start = prevYearEnd ?? pts[0].value;
    const end = pts[pts.length - 1].value;
    result.push({ year: y, returnPct: start > 0 ? (end / start - 1) * 100 : 0 });
    prevYearEnd = end;
  }
  return result;
}

function yearsBetween(d1: string, d2: string): number {
  const t1 = Date.parse(d1);
  const t2 = Date.parse(d2);
  return (t2 - t1) / (365.25 * 24 * 3600 * 1000);
}

export interface ReportMetrics {
  cagrPct: number;
  mddPct: number;
  calmar: number;
  profitFactor: number;
  winRatePct: number;
  tradeCount: number;
  maxConsecutiveLosses: number;
  worst3yRollingPct: number;
  annualReturns: Array<{ year: string; returnPct: number }>;
}

export function computeReportMetrics(equity: EquityPoint[], trades: ClosedTrade[]): ReportMetrics {
  const c = cagr(equity);
  const m = maxDrawdown(equity);
  return {
    cagrPct: c * 100,
    mddPct: m * 100,
    calmar: calmar(c, m),
    profitFactor: profitFactor(trades),
    winRatePct: winRate(trades) * 100,
    tradeCount: trades.length,
    maxConsecutiveLosses: maxConsecutiveLosses(trades),
    worst3yRollingPct: worstRollingReturn(equity, 3) * 100,
    annualReturns: annualReturns(equity),
  };
}
