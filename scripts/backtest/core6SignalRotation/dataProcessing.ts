import type { OhlcRow, ReturnMetrics, YahooSeries } from './types';

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function localDate(epochSeconds: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochSeconds * 1000));
  const get = (type: string): string => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

interface YahooChartResult {
  meta?: {
    currency?: string;
    symbol?: string;
    exchangeName?: string;
    exchangeTimezoneName?: string;
  };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: Array<number | null>;
      high?: Array<number | null>;
      low?: Array<number | null>;
      close?: Array<number | null>;
      volume?: Array<number | null>;
    }>;
    adjclose?: Array<{ adjclose?: Array<number | null> }>;
  };
  events?: {
    dividends?: Record<string, { date?: number; amount?: number }>;
    splits?: Record<string, { date?: number; numerator?: number; denominator?: number }>;
  };
}

export function parseYahooChart(raw: unknown): YahooSeries {
  const root = raw as { chart?: { result?: YahooChartResult[]; error?: unknown } };
  const result = root.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo chart result missing: ${JSON.stringify(root.chart?.error ?? null)}`);
  const symbol = result.meta?.symbol ?? 'unknown';
  const timezone = result.meta?.exchangeTimezoneName ?? 'UTC';
  const ts = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose ?? [];
  const rows: OhlcRow[] = [];
  for (let i = 0; i < ts.length; i++) {
    const rawClose = quote.close?.[i];
    const adjClose = adjusted[i];
    if (!finite(rawClose) || rawClose === 0 || !finite(adjClose)) continue;
    const factor = adjClose / rawClose;
    const adjust = (value: unknown): number | null => finite(value) ? value * factor : null;
    rows.push({
      date: localDate(ts[i], timezone),
      timestampUtc: new Date(ts[i] * 1000).toISOString(),
      open: adjust(quote.open?.[i]),
      high: adjust(quote.high?.[i]),
      low: adjust(quote.low?.[i]),
      close: adjClose,
      volume: finite(quote.volume?.[i]) ? quote.volume![i] as number : null,
      rawClose,
      adjustmentFactor: factor,
    });
  }
  const dividends = Object.values(result.events?.dividends ?? {}).flatMap(event =>
    finite(event.date) && finite(event.amount)
      ? [{ date: localDate(event.date, timezone), amount: event.amount, currency: result.meta?.currency ?? null }]
      : []
  );
  const splits = Object.values(result.events?.splits ?? {}).flatMap(event =>
    finite(event.date)
      ? [{
          date: localDate(event.date, timezone),
          numerator: finite(event.numerator) ? event.numerator : null,
          denominator: finite(event.denominator) ? event.denominator : null,
        }]
      : []
  );
  return {
    symbol,
    currency: result.meta?.currency ?? 'unknown',
    exchange: result.meta?.exchangeName ?? 'unknown',
    timezone,
    rows: rows.sort((a, b) => a.date.localeCompare(b.date)),
    dividends,
    splits,
  };
}

export function foreignProxyInKrw(
  asset: YahooSeries,
  fx: YahooSeries,
  mode: 'outer-hl' | 'fixed-fx-hl'
): OhlcRow[] {
  const fxByDate = new Map(fx.rows.map(row => [row.date, row]));
  let lastFx: OhlcRow | null = null;
  const out: OhlcRow[] = [];
  for (const row of asset.rows) {
    const sameDayFx = fxByDate.get(row.date) ?? null;
    const fxRow = sameDayFx ?? lastFx;
    if (!fxRow) continue;
    const fixed = lastFx?.close ?? fxRow.close;
    const openFx = mode === 'fixed-fx-hl' ? fixed : fxRow.open ?? fxRow.close;
    const highFx = mode === 'fixed-fx-hl' ? fixed : fxRow.high ?? fxRow.close;
    const lowFx = mode === 'fixed-fx-hl' ? fixed : fxRow.low ?? fxRow.close;
    out.push({
      date: row.date,
      timestampUtc: row.timestampUtc,
      open: row.open === null ? null : row.open * openFx,
      high: row.high === null ? null : row.high * highFx,
      low: row.low === null ? null : row.low * lowFx,
      close: row.close * fxRow.close,
      volume: row.volume,
    });
    if (sameDayFx) lastFx = sameDayFx;
  }
  return out;
}

export function alignLatestPriorSession(proxy: OhlcRow[], krxDates: string[]): OhlcRow[] {
  const out: OhlcRow[] = [];
  let cursor = 0;
  let latest: OhlcRow | null = null;
  for (const date of krxDates) {
    while (cursor < proxy.length && proxy[cursor].date < date) {
      latest = proxy[cursor++];
    }
    if (latest) out.push({ ...latest, date });
  }
  return out;
}

export function alignSameSession(proxy: OhlcRow[], krxDates: string[]): OhlcRow[] {
  const byDate = new Map(proxy.map(row => [row.date, row]));
  return krxDates.flatMap(date => {
    const row = byDate.get(date);
    return row ? [{ ...row, date }] : [];
  });
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStd(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1));
}

export function computeReturnMetrics(actual: OhlcRow[], proxy: OhlcRow[]): ReturnMetrics {
  const actualByDate = new Map(actual.map(row => [row.date, row.close]));
  const proxyByDate = new Map(proxy.map(row => [row.date, row.close]));
  const dates = [...actualByDate.keys()].filter(date => proxyByDate.has(date)).sort();
  const ar: number[] = [];
  const pr: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const a0 = actualByDate.get(dates[i - 1]);
    const a1 = actualByDate.get(dates[i]);
    const p0 = proxyByDate.get(dates[i - 1]);
    const p1 = proxyByDate.get(dates[i]);
    if (![a0, a1, p0, p1].every(value => finite(value) && value > 0)) continue;
    ar.push(a1! / a0! - 1);
    pr.push(p1! / p0! - 1);
  }
  if (ar.length < 2) {
    return { observations: ar.length, correlation: null, beta: null, trackingErrorAnnual: null, directionMatch: null };
  }
  const ma = mean(ar);
  const mp = mean(pr);
  const covariance = ar.reduce((sum, value, i) => sum + (value - ma) * (pr[i] - mp), 0) / (ar.length - 1);
  const va = ar.reduce((sum, value) => sum + (value - ma) ** 2, 0) / (ar.length - 1);
  const vp = pr.reduce((sum, value) => sum + (value - mp) ** 2, 0) / (pr.length - 1);
  const diff = ar.map((value, i) => value - pr[i]);
  return {
    observations: ar.length,
    correlation: va > 0 && vp > 0 ? covariance / Math.sqrt(va * vp) : null,
    beta: vp > 0 ? covariance / vp : null,
    trackingErrorAnnual: sampleStd(diff) === null ? null : sampleStd(diff)! * Math.sqrt(252),
    directionMatch: ar.filter((value, i) => Math.sign(value) === Math.sign(pr[i])).length / ar.length,
  };
}

export function hkdKrwCross(usdKrw: number, usdHkd: number): number {
  if (!(usdKrw > 0) || !(usdHkd > 0)) throw new Error('FX inputs must be positive');
  return usdKrw / usdHkd;
}
