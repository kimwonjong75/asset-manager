/**
 * POST-HOC EXPLORATORY DIAGNOSTIC ONLY.
 *
 * This program diagnoses V1 proxy/date alignment. It does not alter the V1
 * decision and does not calculate portfolio or strategy performance.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseYahooChart, foreignProxyInKrw } from '../core6SignalRotation/dataProcessing';
import { buildRuleTraces, compareRuleTraces } from '../core6SignalRotation/signalGate';
import type { OhlcRow, ReturnMetrics, YahooSeries } from '../core6SignalRotation/types';

const root = path.dirname(fileURLToPath(import.meta.url));
const v1Root = path.resolve(root, '../core6SignalRotation');
const rawDir = path.join(v1Root, 'data/raw');
const outputDir = path.join(root, 'output');
const overlapStart = '2023-08-22';
const end = '2026-09-30';
const shifts = [-2, -1, 0, 1, 2] as const;
const frequencies = ['daily', 'weekly', 'monthly'] as const;
type Frequency = typeof frequencies[number];

interface AssetDefinition {
  assetId: string;
  actualSymbol: string;
  proxySymbol: string;
  kind: 'identity' | 'foreign' | 'gold';
  fxSymbol?: string;
}

const assets: AssetDefinition[] = [
  { assetId: '069500', actualSymbol: '069500.KS', proxySymbol: '069500.KS', kind: 'identity' },
  { assetId: '379800', actualSymbol: '379800.KS', proxySymbol: 'SPY', kind: 'foreign', fxSymbol: 'KRW=X' },
  { assetId: '283580', actualSymbol: '283580.KS', proxySymbol: '3188.HK', kind: 'foreign', fxSymbol: 'HKDKRW=X' },
  { assetId: '385560', actualSymbol: '385560.KS', proxySymbol: '385560.KS', kind: 'identity' },
  { assetId: '464470', actualSymbol: '464470.KS', proxySymbol: 'TLT', kind: 'foreign', fxSymbol: 'KRW=X' },
  { assetId: '411060', actualSymbol: '411060.KS', proxySymbol: 'M04020000', kind: 'gold' },
];

interface MetricInterval {
  low: number | null;
  high: number | null;
  method: string;
}

interface MetricResult extends ReturnMetrics {
  intervals95: {
    correlation: MetricInterval;
    beta: MetricInterval;
    trackingErrorAnnual: MetricInterval;
    directionMatch: MetricInterval;
  };
}

interface PairedReturn {
  actual: number;
  proxy: number;
}

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(path.join(rawDir, name), 'utf8')) as unknown;
}

function yahoo(symbol: string): YahooSeries {
  const safe = symbol.replace(/[^A-Za-z0-9_.=-]/g, '_');
  const envelope = readJson(`yahoo_${safe}.json`) as { response?: unknown };
  return parseYahooChart(envelope.response);
}

function inRange(rows: OhlcRow[]): OhlcRow[] {
  return rows.filter(row => row.date >= overlapStart && row.date <= end);
}

function goldRows(): OhlcRow[] {
  const envelope = readJson('naver_krx_gold_close.json') as { rows?: Array<Record<string, unknown>> };
  return (envelope.rows ?? []).flatMap(row => {
    const date = String(row.localTradedAt ?? '').slice(0, 10);
    const close = Number(String(row.closePrice ?? '').replace(/,/g, ''));
    return date && Number.isFinite(close) && close > 0
      ? [{ date, timestampUtc: null, open: null, high: null, low: null, close, volume: null } satisfies OhlcRow]
      : [];
  }).sort((a, b) => a.date.localeCompare(b.date));
}

function commonDates(series: Map<string, YahooSeries>): string[] {
  const sets = assets.map(asset => new Set(inRange(series.get(asset.assetId)!.rows).map(row => row.date)));
  return [...sets[0]].filter(date => sets.every(set => set.has(date))).sort();
}

function alignActual(rows: OhlcRow[], dates: string[]): OhlcRow[] {
  const byDate = new Map(inRange(rows).map(row => [row.date, row]));
  return dates.flatMap(date => {
    const row = byDate.get(date);
    return row ? [{ ...row, date }] : [];
  });
}

function alignBySourceShift(
  rows: OhlcRow[],
  dates: string[],
  shift: number,
  sameSessionBaseline: boolean,
): { rows: OhlcRow[]; futureLinks: number } {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const aligned: OhlcRow[] = [];
  let futureLinks = 0;
  let cursor = 0;
  for (const date of dates) {
    while (cursor < sorted.length && (sameSessionBaseline ? sorted[cursor].date <= date : sorted[cursor].date < date)) cursor++;
    const baseline = cursor - 1;
    const target = baseline + shift;
    const row = sorted[target];
    if (!row) continue;
    if (row.date > date || (!sameSessionBaseline && row.date === date)) futureLinks++;
    aligned.push({ ...row, date });
  }
  return { rows: aligned, futureLinks };
}

function periodKey(date: string, frequency: Frequency): string {
  if (frequency === 'daily') return date;
  if (frequency === 'monthly') return date.slice(0, 7);
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDay();
  const offset = day <= 5 ? 5 - day : 12 - day;
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function returns(actual: OhlcRow[], proxy: OhlcRow[], frequency: Frequency): PairedReturn[] {
  const proxyByDate = new Map(proxy.map(row => [row.date, row.close]));
  const paired = actual.flatMap(row => {
    const proxyClose = proxyByDate.get(row.date);
    return proxyClose === undefined ? [] : [{ date: row.date, actual: row.close, proxy: proxyClose }];
  });
  const endpoints = new Map<string, typeof paired[number]>();
  for (const row of paired) endpoints.set(periodKey(row.date, frequency), row);
  const levels = [...endpoints.values()].sort((a, b) => a.date.localeCompare(b.date));
  const out: PairedReturn[] = [];
  for (let i = 1; i < levels.length; i++) {
    out.push({
      actual: levels[i].actual / levels[i - 1].actual - 1,
      proxy: levels[i].proxy / levels[i - 1].proxy - 1,
    });
  }
  return out;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function metrics(pairs: PairedReturn[], frequency: Frequency): MetricResult {
  const n = pairs.length;
  const empty: MetricInterval = { low: null, high: null, method: 'insufficient sample' };
  if (n < 3) {
    return {
      observations: n,
      correlation: null,
      beta: null,
      trackingErrorAnnual: null,
      directionMatch: null,
      intervals95: { correlation: empty, beta: empty, trackingErrorAnnual: empty, directionMatch: empty },
    };
  }
  const a = pairs.map(pair => pair.actual);
  const p = pairs.map(pair => pair.proxy);
  const ma = mean(a);
  const mp = mean(p);
  const sxx = p.reduce((sum, value) => sum + (value - mp) ** 2, 0);
  const syy = a.reduce((sum, value) => sum + (value - ma) ** 2, 0);
  const sxy = a.reduce((sum, value, i) => sum + (value - ma) * (p[i] - mp), 0);
  const correlation = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
  const beta = sxx > 0 ? sxy / sxx : null;
  const periodsPerYear = frequency === 'daily' ? 252 : frequency === 'weekly' ? 52 : 12;
  const differences = pairs.map(pair => pair.actual - pair.proxy);
  const md = mean(differences);
  const variance = differences.reduce((sum, value) => sum + (value - md) ** 2, 0) / (n - 1);
  const trackingErrorAnnual = Math.sqrt(variance * periodsPerYear);
  const matched = pairs.filter(pair => Math.sign(pair.actual) === Math.sign(pair.proxy)).length;
  const directionMatch = matched / n;
  const fisher = correlation === null || Math.abs(correlation) >= 1
    ? correlation === null ? empty : { low: correlation, high: correlation, method: 'exact boundary' }
    : (() => {
        const z = Math.atanh(correlation);
        const half = 1.96 / Math.sqrt(n - 3);
        return { low: Math.tanh(z - half), high: Math.tanh(z + half), method: 'Fisher z' };
      })();
  const residualVariance = beta === null || n <= 2
    ? null
    : pairs.reduce((sum, pair) => sum + (pair.actual - (ma - beta * mp) - beta * pair.proxy) ** 2, 0) / (n - 2);
  const betaSe = residualVariance === null || sxx <= 0 ? null : Math.sqrt(residualVariance / sxx);
  const betaInterval = beta === null || betaSe === null
    ? empty
    : { low: beta - 1.96 * betaSe, high: beta + 1.96 * betaSe, method: 'OLS normal approximation' };
  const teSe = trackingErrorAnnual / Math.sqrt(2 * (n - 1));
  const teInterval = {
    low: Math.max(0, trackingErrorAnnual - 1.96 * teSe),
    high: trackingErrorAnnual + 1.96 * teSe,
    method: 'normal approximation for standard deviation',
  };
  const z = 1.96;
  const denominator = 1 + z ** 2 / n;
  const center = (directionMatch + z ** 2 / (2 * n)) / denominator;
  const half = z * Math.sqrt(directionMatch * (1 - directionMatch) / n + z ** 2 / (4 * n ** 2)) / denominator;
  return {
    observations: n,
    correlation,
    beta,
    trackingErrorAnnual,
    directionMatch,
    intervals95: {
      correlation: fisher,
      beta: betaInterval,
      trackingErrorAnnual: teInterval,
      directionMatch: { low: center - half, high: center + half, method: 'Wilson score' },
    },
  };
}

const actualSeries = new Map(assets.map(asset => [asset.assetId, yahoo(asset.actualSymbol)]));
const dates = commonDates(actualSeries);
const usdKrw = yahoo('KRW=X');
const hkdKrw = yahoo('HKDKRW=X');
const gold = goldRows();

const results = assets.map(asset => {
  const actual = alignActual(actualSeries.get(asset.assetId)!.rows, dates);
  let source: OhlcRow[];
  if (asset.kind === 'identity') source = actualSeries.get(asset.assetId)!.rows;
  else if (asset.kind === 'gold') source = gold;
  else source = foreignProxyInKrw(yahoo(asset.proxySymbol), asset.fxSymbol === 'HKDKRW=X' ? hkdKrw : usdKrw, 'fixed-fx-hl');
  const lagResults = shifts.map(shift => {
    const aligned = alignBySourceShift(source, dates, shift, asset.kind !== 'foreign');
    const frequencyMetrics = Object.fromEntries(frequencies.map(frequency => [frequency, metrics(returns(actual, aligned.rows, frequency), frequency)]));
    const ruleGates = compareRuleTraces(
      buildRuleTraces(actual),
      buildRuleTraces(aligned.rows),
      dates,
      55,
      { state: 0, event: 0, window: 2 },
    );
    return {
      shift,
      futureDataUsed: aligned.futureLinks > 0,
      futureLinks: aligned.futureLinks,
      alignedLevels: aligned.rows.length,
      metrics: frequencyMetrics,
      signals: ruleGates.map(rule => ({
        rule: rule.rule,
        observations: rule.observations,
        stateMatch: rule.stateMatch,
        actualEvents: rule.actualEvents,
        proxyEvents: rule.proxyEvents,
        matchedEvents: rule.matchedEvents,
        eventMatch: rule.eventMatch,
      })),
    };
  });
  const eligible = lagResults.filter(result => !result.futureDataUsed);
  const bestEligibleDaily = eligible.reduce((best, current) =>
    (current.metrics.daily.correlation ?? -Infinity) > (best.metrics.daily.correlation ?? -Infinity) ? current : best
  );
  const bestObservedDaily = lagResults.reduce((best, current) =>
    (current.metrics.daily.correlation ?? -Infinity) > (best.metrics.daily.correlation ?? -Infinity) ? current : best
  );
  return {
    assetId: asset.assetId,
    actualSymbol: asset.actualSymbol,
    proxySymbol: asset.proxySymbol,
    baselineDefinition: asset.kind === 'foreign'
      ? 'latest completed foreign session strictly before the KRX calendar date'
      : 'same KRX session',
    bestEligibleDailyShift: bestEligibleDaily.shift,
    bestObservedDailyShift: bestObservedDaily.shift,
    bestObservedUsesFutureData: bestObservedDaily.futureDataUsed,
    lags: lagResults,
  };
});

const payload = {
  schemaVersion: 1,
  label: '사후 탐색적 진단 — V1 판정 변경에 사용 금지',
  generatedAtUtc: new Date().toISOString(),
  strategyPerformanceComputed: false,
  sourcePeriod: { start: overlapStart, end, commonKrxDates: dates.length },
  shiftDefinition: {
    foreignZero: 'latest completed source session strictly before the KRX calendar date',
    domesticZero: 'same KRX session',
    negative: 'older completed source sessions',
    positive: 'later source sessions; flagged and excluded whenever unavailable at the KRX close',
  },
  results,
};

mkdirSync(outputDir, { recursive: true });
writeFileSync(path.join(outputDir, 'exploratory_metrics.json'), JSON.stringify(payload, null, 2));
console.log(JSON.stringify({
  label: payload.label,
  output: path.join(outputDir, 'exploratory_metrics.json'),
  best: results.map(result => ({
    assetId: result.assetId,
    bestEligibleDailyShift: result.bestEligibleDailyShift,
    bestObservedDailyShift: result.bestObservedDailyShift,
    bestObservedUsesFutureData: result.bestObservedUsesFutureData,
  })),
}, null, 2));

