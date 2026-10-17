// scripts/backtest/core6SignalRotationV3/data/amendment.ts
// Amendment 1 (docs/backtest/PREREG_코어6종_신호로테이션_V3_AMENDMENT_1.md) — 순수 함수만(fs·네트워크 없음).
//  A1-1 결측일 보충: Yahoo가 비운 21개 KRX 거래일을 앱 백엔드 /history 값으로 채운다(보충 전 단위 검증 포함).
//  A1-2 조정계수 재계산: TR 계수를 Yahoo adjclose 비율이 아니라 events.dividends 원장에서 직접 만든다.
// 전략 성과(MDD·CAGR 등)는 계산하지 않는다.

import { indexRowsByDate } from './yahoo';
import type { YahooDividend, YahooParsed, YahooRow } from './yahoo';

/** Amendment 1 §1: Yahoo가 전 종목에서 동시에 비운 실제 KRX 거래일 21일. */
export const FILL_DATES: readonly string[] = [
  '2022-02-14', '2022-05-02', '2023-05-18', '2023-05-24',
  '2023-07-03', '2023-07-04', '2023-07-05', '2023-07-06',
  '2023-07-11', '2023-07-12', '2023-07-13', '2023-07-18',
  '2023-07-25', '2023-07-27', '2023-07-31', '2023-08-01', '2023-08-02',
  '2024-01-18', '2024-08-27', '2024-10-30', '2024-11-05',
];

/** 단위 검증 허용치: DG2의 종가 일치 허용(0.1%)과 같다. 이를 넘으면 보충을 중단하고 보고한다. */
export const UNIT_CHECK_TOLERANCE = 1e-3;
/** 단위 검증 창: 보충일 앞뒤로 각각 유효 행 몇 개를 볼 것인가. */
export const UNIT_CHECK_WINDOW = 5;
/** 이벤트 원장 vs (Yahoo|백엔드) 구간 비교: 구간 중앙값 차이가 이 값을 넘으면 '맞지 않음'. */
export const SEGMENT_MISMATCH_TOLERANCE = 2e-4;

// ---------------------------------------------------------------------------
// 백엔드 /history 응답
// ---------------------------------------------------------------------------

export interface BackendSeries {
  dates: string[];
  open: (number | null)[];
  high: (number | null)[];
  low: (number | null)[];
  /** 백엔드의 'data' 필드 = 종가 */
  close: (number | null)[];
}

interface BackendEntryJson {
  data?: Record<string, number | null>;
  open?: Record<string, number | null>;
  high?: Record<string, number | null>;
  low?: Record<string, number | null>;
  error?: string;
}

function finiteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 응답 원문(JSON, NaN 허용)을 파싱한다. */
export function parseBackendHistory(text: string, symbol: string): BackendSeries {
  const json = JSON.parse(text.replace(/\bNaN\b/g, 'null')) as Record<string, BackendEntryJson | null>;
  const entry = json[symbol];
  if (!entry || entry.error || !entry.data) throw new Error(`백엔드 ${symbol}: ${entry?.error ?? 'no-data'}`);
  const dates = Object.keys(entry.data).sort();
  const pick = (m: Record<string, number | null> | undefined, d: string): number | null => {
    const v = m?.[d];
    return finiteNum(v) ? v : null;
  };
  return {
    dates,
    open: dates.map(d => pick(entry.open, d)),
    high: dates.map(d => pick(entry.high, d)),
    low: dates.map(d => pick(entry.low, d)),
    close: dates.map(d => pick(entry.data, d)),
  };
}

export interface BackendBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

export function indexBackend(b: BackendSeries): Map<string, BackendBar> {
  const m = new Map<string, BackendBar>();
  b.dates.forEach((d, i) => {
    const o = b.open[i];
    const h = b.high[i];
    const l = b.low[i];
    const c = b.close[i];
    if (o !== null && h !== null && l !== null && c !== null && o > 0 && h > 0 && l > 0 && c > 0) m.set(d, { open: o, high: h, low: l, close: c });
  });
  return m;
}

// ---------------------------------------------------------------------------
// A1-2 이벤트 원장 → TR 조정계수
// ---------------------------------------------------------------------------

function rawOk(r: YahooRow): boolean {
  return r.rawOpen !== null && r.rawHigh !== null && r.rawLow !== null && r.rawClose !== null && r.rawClose > 0;
}

export type PrevRawSource = 'yahoo' | 'backend-derived' | 'last-valid-fallback' | 'unavailable' | 'before-first-row';

export interface LedgerEvent {
  exDate: string;
  amount: number;
  /** 분배락일 직전 거래일(Yahoo 행·백엔드 날짜 중 가장 늦은 날짜 < exDate) */
  prevDate: string | null;
  prevRaw: number | null;
  prevRawSource: PrevRawSource;
  /** amount / prevRaw */
  yield: number | null;
  /** backend-derived 일 때만: 마지막 유효 원시 종가를 썼다면 나왔을 분배 수익률(비교용) */
  alternativeYield: number | null;
}

/**
 * 분배 원장에서 이벤트별 분배 수익률을 만든다. 직전 원시 종가는 ① Yahoo 원시 종가, ② Yahoo가 직전일을 비웠으면 백엔드 배당조정
 * 종가에서 역산(백엔드 = (원시 − 분배금) × 이후 이벤트 계수곱 이라는 정의로 raw = 조정/G + 분배금), ③ 그것도 없으면 마지막 유효 원시 종가(fallback, 표시).
 */
export function computeLedgerEvents(parsed: YahooParsed, backend?: BackendSeries): LedgerEvent[] {
  const index = indexRowsByDate(parsed);
  const yahooDates = [...index.keys()].sort();
  const validRawDates = yahooDates.filter(d => rawOk(index.get(d)!));
  const firstValid = validRawDates[0] ?? null;
  const bIndex = backend ? indexBackend(backend) : new Map<string, BackendBar>();
  const bDates = [...bIndex.keys()].sort();

  const lastBefore = (sorted: string[], date: string): string | null => {
    let out: string | null = null;
    for (const d of sorted) {
      if (d < date) out = d;
      else break;
    }
    return out;
  };

  const divs: YahooDividend[] = parsed.dividends.filter(e => e.amount > 0).sort((a, b) => b.date.localeCompare(a.date)); // 최신 → 과거
  const results: LedgerEvent[] = [];
  let G = 1; // 이미 처리한(더 늦은) 이벤트들의 (1 − y) 곱
  for (const e of divs) {
    if (firstValid === null || e.date <= firstValid) {
      results.push({ exDate: e.date, amount: e.amount, prevDate: null, prevRaw: null, prevRawSource: 'before-first-row', yield: null, alternativeYield: null });
      continue;
    }
    const prevY = lastBefore(yahooDates, e.date);
    const prevB = lastBefore(bDates, e.date);
    const prevDate = [prevY, prevB].filter((x): x is string => x !== null).sort().pop() ?? null;
    const lastValid = lastBefore(validRawDates, e.date);
    const lastValidRaw = lastValid !== null ? index.get(lastValid)!.rawClose! : null;

    let prevRaw: number | null = null;
    let source: PrevRawSource = 'unavailable';
    let alt: number | null = null;
    let usedDate: string | null = prevDate;
    const prevRow = prevDate !== null ? index.get(prevDate) : undefined;
    if (prevRow && rawOk(prevRow)) {
      prevRaw = prevRow.rawClose;
      source = 'yahoo';
    } else if (prevDate !== null && bIndex.has(prevDate)) {
      prevRaw = bIndex.get(prevDate)!.close / G + e.amount;
      source = 'backend-derived';
      alt = lastValidRaw !== null ? e.amount / lastValidRaw : null;
    } else if (lastValidRaw !== null) {
      prevRaw = lastValidRaw;
      source = 'last-valid-fallback';
      usedDate = lastValid;
    }
    const y = prevRaw !== null && prevRaw > 0 ? e.amount / prevRaw : null;
    results.push({ exDate: e.date, amount: e.amount, prevDate: usedDate, prevRaw, prevRawSource: source, yield: y, alternativeYield: alt });
    if (y !== null) G *= 1 - y;
  }
  return results.sort((a, b) => a.exDate.localeCompare(b.exDate));
}

/** 날짜 t 행에 곱할 TR 계수 = Π_{ex > t}(1 − y). */
export function ledgerFactorAt(events: LedgerEvent[], date: string): number {
  let f = 1;
  for (const e of events) if (e.yield !== null && e.exDate > date) f *= 1 - e.yield;
  return f;
}

/** 모든 원시 O/H/L/C가 있는 행에 이벤트 원장 계수를 적용한 사본. Yahoo 원래 adjclose·계수는 yahoo* 필드에 보존한다. */
export function applyEventLedger(parsed: YahooParsed, events: LedgerEvent[]): YahooParsed {
  const rows: YahooRow[] = parsed.rows.map(r => {
    const base: YahooRow = { ...r, yahooAdjClose: r.adjClose, yahooFactor: r.factor, source: 'yahoo' };
    if (!rawOk(r)) return { ...base, valid: false, factor: null, adjClose: null, open: null, high: null, low: null, close: null };
    const f = ledgerFactorAt(events, r.date);
    return {
      ...base,
      factor: f,
      adjClose: r.rawClose! * f,
      valid: true,
      open: r.rawOpen! * f,
      high: r.rawHigh! * f,
      low: r.rawLow! * f,
      close: r.rawClose! * f,
    };
  });
  return { ...parsed, rows };
}

// ---------------------------------------------------------------------------
// A1-1 단위 검증 + 보충
// ---------------------------------------------------------------------------

export interface UnitCheckRow {
  fillDate: string;
  neighbors: number;
  /** backend/ledger-TR 비율의 편차 max |ratio − 1| (O/H/L/C 각각) */
  maxDev: { open: number; high: number; low: number; close: number };
  closeRatioMin: number;
  closeRatioMax: number;
  pass: boolean;
}

export interface UnitCheckResult {
  rows: UnitCheckRow[];
  /** 전 구간 겹침(보충일 제외) 종가 비율 */
  overlap: { n: number; ratioMin: number; ratioMax: number; ratioMean: number; maxDev: number; within: number };
  pass: boolean;
}

/** ledger: applyEventLedger 결과(보충 전). 보충 대상일 = Yahoo 행이 있고 원시값이 비었고 백엔드에 값이 있는 날. */
export function unitCheck(ledger: YahooParsed, backend: BackendSeries, fillDates: readonly string[], from: string, to: string): UnitCheckResult {
  const index = indexRowsByDate(ledger);
  const bIndex = indexBackend(backend);
  const fillSet = new Set(fillDates);
  const valid = [...index.values()].filter(r => r.valid && !fillSet.has(r.date)).sort((a, b) => a.date.localeCompare(b.date));
  const dev = (a: number, b: number): number => Math.abs(a / b - 1);

  const rows: UnitCheckRow[] = [];
  for (const d of fillDates) {
    const row = index.get(d);
    if (!row || row.valid || !bIndex.has(d)) continue; // 보충 대상이 아님
    const before = valid.filter(r => r.date < d).slice(-UNIT_CHECK_WINDOW);
    const after = valid.filter(r => r.date > d).slice(0, UNIT_CHECK_WINDOW);
    const nb = [...before, ...after];
    const md = { open: 0, high: 0, low: 0, close: 0 };
    let rMin = Infinity;
    let rMax = -Infinity;
    for (const r of nb) {
      const b = bIndex.get(r.date);
      if (!b) continue;
      md.open = Math.max(md.open, dev(b.open, r.open!));
      md.high = Math.max(md.high, dev(b.high, r.high!));
      md.low = Math.max(md.low, dev(b.low, r.low!));
      md.close = Math.max(md.close, dev(b.close, r.close!));
      const ratio = b.close / r.close!;
      rMin = Math.min(rMin, ratio);
      rMax = Math.max(rMax, ratio);
    }
    const pass = nb.length > 0 && Math.max(md.open, md.high, md.low, md.close) <= UNIT_CHECK_TOLERANCE;
    rows.push({ fillDate: d, neighbors: nb.length, maxDev: md, closeRatioMin: rMin, closeRatioMax: rMax, pass });
  }

  let n = 0;
  let sum = 0;
  let rMin = Infinity;
  let rMax = -Infinity;
  let maxDev = 0;
  let within = 0;
  for (const r of valid) {
    if (r.date < from || r.date > to) continue;
    const b = bIndex.get(r.date);
    if (!b) continue;
    const ratio = b.close / r.close!;
    n++;
    sum += ratio;
    rMin = Math.min(rMin, ratio);
    rMax = Math.max(rMax, ratio);
    maxDev = Math.max(maxDev, Math.abs(ratio - 1));
    if (Math.abs(ratio - 1) <= UNIT_CHECK_TOLERANCE) within++;
  }
  return {
    rows,
    overlap: { n, ratioMin: rMin, ratioMax: rMax, ratioMean: n > 0 ? sum / n : NaN, maxDev, within },
    pass: rows.length > 0 && rows.every(r => r.pass),
  };
}

export interface FillRecord {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface FillSkip {
  date: string;
  reason: 'no-yahoo-row' | 'yahoo-row-already-valid' | 'no-backend-bar';
}

export interface FillResult {
  parsed: YahooParsed;
  filled: FillRecord[];
  skipped: FillSkip[];
}

/** 백엔드 O/H/L/C(이미 배당조정 단위)로 Yahoo 결측 행을 채운다. 원시값은 알 수 없으므로 null, 출처는 'backend-fill'. */
export function applyBackendFill(ledger: YahooParsed, backend: BackendSeries, fillDates: readonly string[]): FillResult {
  const bIndex = indexBackend(backend);
  const fillSet = new Set(fillDates);
  const filled: FillRecord[] = [];
  const skipped: FillSkip[] = [];
  const seen = new Set<string>();
  const hasRow = new Set(ledger.rows.map(r => r.date));
  for (const d of fillDates) if (!hasRow.has(d)) skipped.push({ date: d, reason: 'no-yahoo-row' });
  const rows: YahooRow[] = ledger.rows.map(r => {
    if (!fillSet.has(r.date) || seen.has(r.date)) return r;
    if (r.valid) {
      skipped.push({ date: r.date, reason: 'yahoo-row-already-valid' });
      return r;
    }
    const b = bIndex.get(r.date);
    if (!b) {
      skipped.push({ date: r.date, reason: 'no-backend-bar' });
      return r;
    }
    seen.add(r.date);
    filled.push({ date: r.date, ...b });
    return { ...r, source: 'backend-fill' as const, valid: true, factor: null, adjClose: b.close, open: b.open, high: b.high, low: b.low, close: b.close };
  });
  skipped.sort((a, b) => a.date.localeCompare(b.date));
  return { parsed: { ...ledger, rows }, filled, skipped };
}

// ---------------------------------------------------------------------------
// A1-2 비교: 이벤트 원장 vs Yahoo adjclose vs 백엔드
// ---------------------------------------------------------------------------

export interface FactorDiffStats {
  n: number;
  max: number;
  maxDate: string | null;
  mean: number;
}

export interface SegmentCompare {
  from: string;
  to: string;
  rows: number;
  medianVsYahoo: number | null;
  medianVsBackend: number | null;
  /** 둘 중 어느 것도 SEGMENT_MISMATCH_TOLERANCE 안에 들지 못함 */
  matchesNeither: boolean;
}

export interface FactorComparison {
  vsYahoo: FactorDiffStats;
  vsBackend: FactorDiffStats;
  segments: SegmentCompare[];
  /** 원장이 Yahoo와도 백엔드와도 맞지 않는 구간이 있는가 → true 면 중단 */
  hasUnexplainedSegment: boolean;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stats(items: Array<{ date: string; dev: number }>): FactorDiffStats {
  if (items.length === 0) return { n: 0, max: 0, maxDate: null, mean: 0 };
  let max = -1;
  let maxDate: string | null = null;
  let sum = 0;
  for (const it of items) {
    sum += it.dev;
    if (it.dev > max) {
      max = it.dev;
      maxDate = it.date;
    }
  }
  return { n: items.length, max, maxDate, mean: sum / items.length };
}

/** @param ledger applyEventLedger 결과(보충 전). 구간 = 원장 계수가 같은 연속 행(이후 이벤트 수가 같음). */
export function compareFactors(ledger: YahooParsed, events: LedgerEvent[], backend: BackendSeries, from: string, to: string): FactorComparison {
  const bIndex = indexBackend(backend);
  const rows = [...indexRowsByDate(ledger).values()].filter(r => r.valid && r.date >= from && r.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const vsY: Array<{ date: string; dev: number }> = [];
  const vsB: Array<{ date: string; dev: number }> = [];
  const segKey = (d: string): number => events.filter(e => e.yield !== null && e.exDate > d).length;
  const segMap = new Map<number, Array<{ date: string; y: number | null; b: number | null }>>();
  for (const r of rows) {
    const y = r.yahooFactor !== null && r.yahooFactor !== undefined ? Math.abs(r.factor! / r.yahooFactor - 1) : null;
    const b = bIndex.get(r.date);
    const bd = b ? Math.abs(r.close! / b.close - 1) : null;
    if (y !== null) vsY.push({ date: r.date, dev: y });
    if (bd !== null) vsB.push({ date: r.date, dev: bd });
    const k = segKey(r.date);
    if (!segMap.has(k)) segMap.set(k, []);
    segMap.get(k)!.push({ date: r.date, y, b: bd });
  }
  const segments: SegmentCompare[] = [...segMap.entries()]
    .sort((a, b) => b[0] - a[0]) // 이후 이벤트가 많은 구간(과거) 먼저
    .map(([, items]) => {
      const my = median(items.flatMap(i => (i.y !== null ? [i.y] : [])));
      const mb = median(items.flatMap(i => (i.b !== null ? [i.b] : [])));
      const okY = my !== null && my <= SEGMENT_MISMATCH_TOLERANCE;
      const okB = mb !== null && mb <= SEGMENT_MISMATCH_TOLERANCE;
      return { from: items[0].date, to: items[items.length - 1].date, rows: items.length, medianVsYahoo: my, medianVsBackend: mb, matchesNeither: !okY && !okB };
    });
  return { vsYahoo: stats(vsY), vsBackend: stats(vsB), segments, hasUnexplainedSegment: segments.some(s => s.matchesNeither) };
}

// ---------------------------------------------------------------------------
// 백엔드가 암시하는 분배 단계 vs 이벤트 원장
// ---------------------------------------------------------------------------

/** 원장 분배 수익률과 백엔드 암시 수익률이 이보다(bp) 벌어지면 '불일치'로 표시한다. */
export const IMPLIED_YIELD_TOLERANCE_BP = 5;
/** 이벤트 없이 백엔드 계수가 이 비율 이상 한 번에 바뀌면 '백엔드 단독 단계'로 표시한다. */
export const BACKEND_STEP_MIN = 5e-4;

export interface BackendYieldRow {
  exDate: string;
  amount: number;
  prevRawSource: PrevRawSource;
  ledgerYield: number | null;
  /** 1 − (백엔드/원시)_직전 ÷ (백엔드/원시)_이벤트일 — 두 행 모두 Yahoo 원시값과 백엔드 값이 있을 때만 */
  backendYield: number | null;
  diffBp: number | null;
  flag: 'ok' | 'mismatch' | 'not-comparable';
}

export interface BackendOnlyStep {
  prevDate: string;
  date: string;
  backendYield: number;
}

export interface BackendImplied {
  events: BackendYieldRow[];
  backendOnlySteps: BackendOnlyStep[];
}

/** @param ledger applyEventLedger 결과(보충 전: 원시값이 있는 행만 유효). */
export function backendImplied(ledger: YahooParsed, events: LedgerEvent[], backend: BackendSeries, from: string, to: string): BackendImplied {
  const bIndex = indexBackend(backend);
  const rows = [...indexRowsByDate(ledger).values()]
    .filter(r => r.valid && r.rawClose !== null && bIndex.has(r.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  const bf = rows.map(r => bIndex.get(r.date)!.close / r.rawClose!);
  const evs = events.filter(e => e.exDate >= from && e.exDate <= to && e.prevRawSource !== 'before-first-row');

  const out: BackendYieldRow[] = evs.map(e => {
    let c = rows.findIndex(r => r.date >= e.exDate);
    if (c < 0) c = rows.length;
    const p = c - 1;
    if (p < 0 || c >= rows.length) {
      return { exDate: e.exDate, amount: e.amount, prevRawSource: e.prevRawSource, ledgerYield: e.yield, backendYield: null, diffBp: null, flag: 'not-comparable' as const };
    }
    const by = 1 - bf[p] / bf[c];
    const diffBp = e.yield === null ? null : (by - e.yield) * 1e4;
    return {
      exDate: e.exDate,
      amount: e.amount,
      prevRawSource: e.prevRawSource,
      ledgerYield: e.yield,
      backendYield: by,
      diffBp,
      flag: diffBp !== null && Math.abs(diffBp) > IMPLIED_YIELD_TOLERANCE_BP ? ('mismatch' as const) : ('ok' as const),
    };
  });

  const steps: BackendOnlyStep[] = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].date < from || rows[i].date > to) continue;
    const step = 1 - bf[i - 1] / bf[i];
    if (Math.abs(step) < BACKEND_STEP_MIN) continue;
    const explained = events.some(e => e.exDate > rows[i - 1].date && e.exDate <= rows[i].date);
    if (!explained) steps.push({ prevDate: rows[i - 1].date, date: rows[i].date, backendYield: step });
  }
  return { events: out, backendOnlySteps: steps };
}

/** Yahoo 원래 계수·adjclose로 되돌린 사본(참고용 DG2/DG3 대조에 쓴다). */
export function withYahooFactors(ledger: YahooParsed): YahooParsed {
  const rows: YahooRow[] = ledger.rows.map(r => {
    const f = r.yahooFactor ?? null;
    const a = r.yahooAdjClose ?? null;
    const ok = r.rawOpen !== null && r.rawHigh !== null && r.rawLow !== null && r.rawClose !== null && r.rawClose > 0 && f !== null;
    return {
      ...r,
      factor: f,
      adjClose: a,
      valid: ok,
      open: ok ? r.rawOpen! * f! : null,
      high: ok ? r.rawHigh! * f! : null,
      low: ok ? r.rawLow! * f! : null,
      close: ok ? a : null,
    };
  });
  return { ...ledger, rows };
}
