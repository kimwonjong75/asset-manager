import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { alignLatestPriorSession, alignSameSession, computeReturnMetrics, foreignProxyInKrw, hkdKrwCross, parseYahooChart } from './dataProcessing';
import { buildRuleTraces, compareRuleTraces } from './signalGate';
import type { OhlcRow, ReturnMetrics, RuleGateMetrics, YahooSeries } from './types';

const root = path.dirname(fileURLToPath(import.meta.url));
const rawDir = path.join(root, 'data', 'raw');
const outputDir = path.join(root, 'output');
mkdirSync(outputDir, { recursive: true });

interface Config {
  preregistration: { path: string; freezeCommit: string; gitBlob: string; sha256: string };
  period: { overlapStart: string; end: string; warmupCompletedBars: number };
  gates: {
    returnCorrelationMin: number;
    betaMin: number;
    betaMax: number;
    trackingErrorAnnualMax: number;
    directionMatchMin: number;
    stateMatchMin: number;
    eventMatchMin: number;
    eventWindowKrxTradingDays: number;
  };
  actual: Array<{ assetId: string; name: string; symbol: string }>;
  proxies: Array<{ assetId: string; kind: 'identity' | 'foreign' | 'krx-gold'; symbol: string; currency: string; fxSymbol?: string }>;
}

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(path.join(rawDir, name), 'utf8')) as unknown;
}

function yahoo(symbol: string): YahooSeries {
  const safe = symbol.replace(/[^A-Za-z0-9_.=-]/g, '_');
  const envelope = readJson(`yahoo_${safe}.json`) as { response?: unknown };
  return parseYahooChart(envelope.response);
}

function range(rows: OhlcRow[], start: string, end: string): OhlcRow[] {
  return rows.filter(row => row.date >= start && row.date <= end);
}

function parseNumber(text: string): number | null {
  const normalized = text.replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, '').replace(/[,+원\s]/g, '');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function parseGoldNow(): Map<string, { high: number; low: number }> {
  const html = readFileSync(path.join(rawDir, 'goldnow_krx_gold_ohlc.html'), 'utf8');
  const out = new Map<string, { high: number; low: number }>();
  for (const match of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(cell => cell[1]);
    if (cells.length !== 7) continue;
    const date = cells[0].replace(/<[^>]+>/g, '').trim();
    const high = parseNumber(cells[3]);
    const low = parseNumber(cells[4]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && high !== null && low !== null) out.set(date, { high, low });
  }
  return out;
}

function naverGoldRows(): OhlcRow[] {
  const envelope = readJson('naver_krx_gold_close.json') as { rows?: Array<Record<string, unknown>> };
  const hl = parseGoldNow();
  return (envelope.rows ?? []).flatMap(row => {
    const date = String(row.localTradedAt ?? '').slice(0, 10);
    const close = parseNumber(String(row.closePrice ?? ''));
    if (!date || close === null) return [];
    return [{
      date,
      timestampUtc: null,
      open: null,
      high: hl.get(date)?.high ?? null,
      low: hl.get(date)?.low ?? null,
      close,
      volume: null,
    } satisfies OhlcRow];
  }).sort((a, b) => a.date.localeCompare(b.date));
}

function returnPass(metrics: ReturnMetrics, gates: Config['gates']): { pass: boolean; failures: string[] } {
  const failures: string[] = [];
  if (metrics.correlation === null || metrics.correlation < gates.returnCorrelationMin) failures.push('correlation');
  if (metrics.beta === null || metrics.beta < gates.betaMin || metrics.beta > gates.betaMax) failures.push('beta');
  if (metrics.trackingErrorAnnual === null || metrics.trackingErrorAnnual > gates.trackingErrorAnnualMax) failures.push('trackingErrorAnnual');
  if (metrics.directionMatch === null || metrics.directionMatch < gates.directionMatchMin) failures.push('directionMatch');
  return { pass: failures.length === 0, failures };
}

function commonKrxDates(actual: Map<string, YahooSeries>, config: Config): string[] {
  const sets = config.actual.map(item => new Set(range(actual.get(item.assetId)!.rows, config.period.overlapStart, config.period.end).map(row => row.date)));
  return [...sets[0]].filter(date => sets.every(set => set.has(date))).sort();
}

const configText = readFileSync(path.join(root, 'config.json'), 'utf8');
const config = JSON.parse(configText) as Config;
const actual = new Map(config.actual.map(item => [item.assetId, yahoo(item.symbol)]));
const dates = commonKrxDates(actual, config);
const fxUsd = yahoo('KRW=X');
const fxHkd = yahoo('HKDKRW=X');
const usdHkd = yahoo('HKD=X');
const goldRows = naverGoldRows();

interface AssetGateResult {
  assetId: string;
  name: string;
  actualSymbol: string;
  proxySymbol: string;
  approximation: 'outer-hl' | 'fixed-fx-hl';
  returnMetrics: ReturnMetrics;
  returnGatePass: boolean;
  returnGateFailures: string[];
  ruleGates: RuleGateMetrics[];
  pairedCloses: Array<{ date: string; actual: number; proxy: number }>;
  pass: boolean;
  blockingIssues: string[];
  caveats: string[];
}

function evaluate(mode: 'outer-hl' | 'fixed-fx-hl'): AssetGateResult[] {
  return config.actual.map(item => {
    const proxyDef = config.proxies.find(proxy => proxy.assetId === item.assetId)!;
    const actualRows = alignSameSession(range(actual.get(item.assetId)!.rows, config.period.overlapStart, config.period.end), dates);
    let proxyRows: OhlcRow[];
    const blockingIssues: string[] = [];
    const caveats: string[] = [];
    if (proxyDef.kind === 'identity') {
      proxyRows = actualRows.map(row => ({ ...row }));
      if (item.assetId === '385560') caveats.push('identity proxy checks series consistency, not independent economic replication');
    } else if (proxyDef.kind === 'krx-gold') {
      proxyRows = alignSameSession(range(goldRows, config.period.overlapStart, config.period.end), dates);
      const completeHl = proxyRows.filter(row => row.high !== null && row.low !== null).length;
      if (completeHl < dates.length) blockingIssues.push(`KRX gold H/L incomplete: ${completeHl}/${dates.length} common dates`);
    } else {
      const fx = proxyDef.fxSymbol === 'HKDKRW=X' ? fxHkd : fxUsd;
      const converted = foreignProxyInKrw(yahoo(proxyDef.symbol), fx, mode);
      proxyRows = alignLatestPriorSession(range(converted, '2023-01-01', config.period.end), dates);
      blockingIssues.push('daily FX bars lack verifiable observation/publication timestamps for strict as-of conversion');
    }
    const returnMetrics = computeReturnMetrics(actualRows, proxyRows);
    const proxyClose = new Map(proxyRows.map(row => [row.date, row.close]));
    const pairedCloses = actualRows.flatMap(row => {
      const proxyValue = proxyClose.get(row.date);
      return proxyValue === undefined ? [] : [{ date: row.date, actual: row.close, proxy: proxyValue }];
    });
    const returnGate = returnPass(returnMetrics, config.gates);
    const ruleGates = compareRuleTraces(
      buildRuleTraces(actualRows),
      buildRuleTraces(proxyRows),
      dates,
      config.period.warmupCompletedBars,
      {
        state: config.gates.stateMatchMin,
        event: config.gates.eventMatchMin,
        window: config.gates.eventWindowKrxTradingDays,
      }
    );
    const pass = returnGate.pass && ruleGates.every(gate => gate.pass) && blockingIssues.length === 0;
    return {
      assetId: item.assetId,
      name: item.name,
      actualSymbol: item.symbol,
      proxySymbol: proxyDef.symbol,
      approximation: mode,
      returnMetrics,
      returnGatePass: returnGate.pass,
      returnGateFailures: returnGate.failures,
      ruleGates,
      pairedCloses,
      pass,
      blockingIssues,
      caveats,
    };
  });
}

const main = evaluate('outer-hl');
const sensitivity = evaluate('fixed-fx-hl');

function fxCrossCheck(): Record<string, unknown> {
  const direct = new Map(fxHkd.rows.map(row => [row.date, row.close]));
  const usdKrw = new Map(fxUsd.rows.map(row => [row.date, row.close]));
  const usdHkdMap = new Map(usdHkd.rows.map(row => [row.date, row.close]));
  const diffs: number[] = [];
  for (const [date, directValue] of direct) {
    const uKrw = usdKrw.get(date);
    const uHkd = usdHkdMap.get(date);
    if (uKrw && uHkd && directValue > 0) diffs.push(hkdKrwCross(uKrw, uHkd) / directValue - 1);
  }
  const meanAbs = diffs.length ? diffs.reduce((sum, value) => sum + Math.abs(value), 0) / diffs.length : null;
  const maxAbs = diffs.length ? Math.max(...diffs.map(Math.abs)) : null;
  return { observations: diffs.length, meanAbsoluteRelativeDifference: meanAbs, maxAbsoluteRelativeDifference: maxAbs };
}

const ecos = readJson('ecos_cd91.json') as { rows?: Array<Record<string, unknown>> };
const cdRows = (ecos.rows ?? []).map(row => ({ date: String(row.TIME ?? ''), valuePct: Number(row.DATA_VALUE) })).filter(row => row.date && Number.isFinite(row.valuePct));
const rawChecksums = readJson('checksums.json');
const gate = {
  schemaVersion: 1,
  generatedAtUtc: new Date().toISOString(),
  stage: 'data-and-proxy-fidelity-only',
  strategyPerformanceComputed: false,
  preregistration: config.preregistration,
  configSha256: sha256(configText),
  commonKrxDates: { count: dates.length, first: dates[0] ?? null, last: dates.at(-1) ?? null },
  cashYield: {
    rows: cdRows.length,
    first: cdRows[0]?.date ?? null,
    last: cdRows.at(-1)?.date ?? null,
    transformedMinPct: cdRows.length ? Math.min(...cdRows.map(row => Math.max(row.valuePct - 0.25, 0))) : null,
    transformedMaxPct: cdRows.length ? Math.max(...cdRows.map(row => Math.max(row.valuePct - 0.25, 0))) : null,
    note: 'Collected and transformation range checked only; no cash return path was simulated.',
  },
  hkdKrwDirectVsCross: fxCrossCheck(),
  mainApproximation: main,
  fixedFxHlSensitivity: sensitivity,
  approximationChangedRulePass: main.flatMap((asset, assetIndex) => asset.ruleGates.flatMap((rule, ruleIndex) =>
    rule.pass !== sensitivity[assetIndex].ruleGates[ruleIndex].pass
      ? [{ assetId: asset.assetId, rule: rule.rule, mainPass: rule.pass, sensitivityPass: sensitivity[assetIndex].ruleGates[ruleIndex].pass }]
      : []
  )),
  overallPass: main.every(asset => asset.pass),
  decision: main.every(asset => asset.pass) ? '데이터·프록시 단계 통과' : '연구 중단',
  stopReasons: main.flatMap(asset => [
    ...asset.returnGateFailures.map(gateName => `${asset.assetId}: ${gateName} gate failed`),
    ...asset.ruleGates.filter(rule => !rule.pass).map(rule => `${asset.assetId}: ${rule.rule} fidelity gate failed${rule.reason ? ` (${rule.reason})` : ''}`),
    ...asset.blockingIssues.map(issue => `${asset.assetId}: ${issue}`),
  ]),
  rawChecksums,
};

const gateText = JSON.stringify(gate, null, 2);
writeFileSync(path.join(outputDir, 'gate_raw_results.json'), gateText);
writeFileSync(path.join(outputDir, 'gate_raw_results.sha256'), `${sha256(gateText)}  gate_raw_results.json\n`);
console.log(JSON.stringify({ decision: gate.decision, overallPass: gate.overallPass, stopReasons: gate.stopReasons }, null, 2));
