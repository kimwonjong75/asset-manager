import type { ConditionalTradeRecord, IsoDate } from '../../../../types/backtestConditionalChannel';

export interface EquityPoint {
  date: IsoDate;
  equity: number;
  cash: number;
}

export interface KrSizePerformanceMetrics {
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  startEquity: number;
  endEquity: number;
  totalReturnPct: number;
  cagrPct: number | null;
  annualVolatilityPct: number | null;
  sharpe: number | null;
  maxDrawdownPct: number;
  calmar: number | null;
  tradeCount: number;
  winRatePct: number | null;
  averageR: number | null;
  medianR: number | null;
  profitFactor: number | null;
  averageHoldingDays: number | null;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function elapsedYears(startDate: IsoDate, endDate: IsoDate): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.max(0, end - start) / (365.2425 * 24 * 60 * 60 * 1000);
}

export function calculateKrSizePerformance(
  equityCurve: readonly EquityPoint[],
  trades: readonly ConditionalTradeRecord[],
  periodStart: IsoDate,
  periodEnd: IsoDate,
  initialEquity: number
): KrSizePerformanceMetrics {
  const curve = equityCurve.filter((point) => point.date >= periodStart && point.date <= periodEnd);
  const startDate = curve[0]?.date ?? null;
  const endDate = curve[curve.length - 1]?.date ?? null;
  const startEquity = initialEquity;
  const endEquity = curve[curve.length - 1]?.equity ?? initialEquity;
  const totalReturn = startEquity > 0 ? endEquity / startEquity - 1 : 0;
  const years = startDate && endDate ? elapsedYears(startDate, endDate) : 0;
  const cagr = years > 0 && startEquity > 0 && endEquity > 0
    ? (endEquity / startEquity) ** (1 / years) - 1
    : null;

  const dailyReturns: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const previous = curve[i - 1].equity;
    if (previous > 0) dailyReturns.push(curve[i].equity / previous - 1);
  }
  const dailyMean = mean(dailyReturns);
  const dailyVariance = dailyReturns.length > 1 && dailyMean !== null
    ? dailyReturns.reduce((sum, value) => sum + (value - dailyMean) ** 2, 0) /
      (dailyReturns.length - 1)
    : null;
  const dailyStd = dailyVariance === null ? null : Math.sqrt(dailyVariance);
  const annualVolatility = dailyStd === null ? null : dailyStd * Math.sqrt(252);
  const sharpe = dailyStd !== null && dailyStd > 0 && dailyMean !== null
    ? dailyMean / dailyStd * Math.sqrt(252)
    : null;

  let peak = startEquity;
  let maxDrawdown = 0;
  for (const point of curve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDrawdown = Math.min(maxDrawdown, point.equity / peak - 1);
  }

  const periodTrades = trades.filter((trade) =>
    trade.entrySignal.signalDate >= periodStart && trade.entrySignal.signalDate <= periodEnd
  );
  const returns = periodTrades
    .map((trade) => trade.netReturn)
    .filter((value): value is number => value !== null);
  const rMultiples = periodTrades
    .map((trade) => trade.rMultiple)
    .filter((value): value is number => value !== null);
  const holdingDays = periodTrades
    .map((trade) => trade.holdingDays)
    .filter((value): value is number => value !== null);
  const grossProfit = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));

  return {
    startDate,
    endDate,
    startEquity,
    endEquity,
    totalReturnPct: totalReturn * 100,
    cagrPct: cagr === null ? null : cagr * 100,
    annualVolatilityPct: annualVolatility === null ? null : annualVolatility * 100,
    sharpe,
    maxDrawdownPct: maxDrawdown * 100,
    calmar: cagr !== null && maxDrawdown < 0 ? cagr / Math.abs(maxDrawdown) : null,
    tradeCount: periodTrades.length,
    winRatePct: returns.length > 0
      ? returns.filter((value) => value > 0).length / returns.length * 100
      : null,
    averageR: mean(rMultiples),
    medianR: median(rMultiples),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    averageHoldingDays: mean(holdingDays),
  };
}
