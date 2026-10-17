// scripts/backtest/core6SignalRotationV3/data/gates.ts
// 데이터 게이트(DG1·DG3·DG4·DG2 비교기) + 464470 프록시 충실도(§10). 순수 함수만(fs·네트워크 없음).
// 전략 성과(MDD·CAGR·수익 등)는 계산하지 않는다 — 자료 정합과 사전등록 임계값 판정만 한다.
// 임계값은 사전등록(§9·§10)에 고정되어 있으며 이 파일에서 바꾸지 않는다.

import type { AssetBars, AssetCode, Panel } from '../types';
import { indexRowsByDate } from './yahoo';
import type { YahooParsed, YahooRow } from './yahoo';
import type { DroppedDay } from './panel';

export type GateStatus = 'PASS' | 'FAIL' | 'REPORT' | 'PARTIAL' | 'UNAVAILABLE';

export interface GateCheck {
  name: string;
  status: GateStatus;
  detail: string;
  /** true = 판정이 "세션 달력" 해석에 의존한다. 사람이 최종 판단해야 한다. */
  interpretationDependent?: boolean;
}

export const DG1_MAX_MISSING_RATIO = 0.01;
export const DG1_BIG_MOVE = 0.2;
export const DG3_FACTOR_TOLERANCE = 1e-6;
export const DG2_CLOSE_TOLERANCE = 0.001;
export const DG2_MIN_MATCH_RATE = 0.99;

function worst(statuses: GateStatus[]): GateStatus {
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('UNAVAILABLE')) return 'UNAVAILABLE';
  if (statuses.includes('PARTIAL')) return 'PARTIAL';
  if (statuses.every(s => s === 'REPORT')) return 'REPORT';
  return 'PASS';
}

function pct(x: number, digits = 2): string {
  return `${(x * 100).toFixed(digits)}%`;
}

// ===========================================================================
// DG1 — 결측률, 불가능 OHLC, 중복·역순·비양수, 일간 ±20% 초과
// ===========================================================================

export interface ImpossibleBar {
  date: string;
  kind: 'H<L' | 'O>H' | 'O<L' | 'C>H' | 'C<L';
}

export interface Dg1Result {
  asset: string;
  effectiveFrom: string;
  to: string;
  primary: { sessions: number; missing: number; missingRatio: number; missingDates: string[] };
  strict: { sessions: number; missing: number; missingRatio: number; missingDates: string[] };
  impossibleOhlc: ImpossibleBar[];
  duplicateDates: string[];
  outOfOrderDates: string[];
  nonPositive: Array<{ date: string; field: string }>;
  bigMoves: Array<{ date: string; prevDate: string; ret: number }>;
  checks: GateCheck[];
  status: GateStatus;
}

export interface Dg1Input {
  asset: string;
  parsed: YahooParsed;
  from: string;
  to: string;
  /** 주 달력(majority-valid)의 세션 */
  primarySessions: string[];
  /** 엄격 해석 달력(yahoo-rows): Yahoo가 행을 만든 날은 값이 null이어도 세션으로 센다 */
  strictSessions: string[];
}

export function impossibleOhlc(rows: YahooRow[]): ImpossibleBar[] {
  const out: ImpossibleBar[] = [];
  for (const r of rows) {
    if (!r.valid || r.open === null || r.high === null || r.low === null || r.close === null) continue;
    const eps = Math.max(1e-10, Math.abs(r.close) * 1e-12);
    if (r.high < r.low - eps) out.push({ date: r.date, kind: 'H<L' });
    if (r.open > r.high + eps) out.push({ date: r.date, kind: 'O>H' });
    if (r.open < r.low - eps) out.push({ date: r.date, kind: 'O<L' });
    if (r.close > r.high + eps) out.push({ date: r.date, kind: 'C>H' });
    if (r.close < r.low - eps) out.push({ date: r.date, kind: 'C<L' });
  }
  return out;
}

function missingFor(sessions: string[], index: Map<string, YahooRow>, effFrom: string) {
  const eligible = sessions.filter(d => d >= effFrom);
  const missingDates = eligible.filter(d => !(index.get(d)?.valid ?? false));
  return {
    sessions: eligible.length,
    missing: missingDates.length,
    missingRatio: eligible.length > 0 ? missingDates.length / eligible.length : 0,
    missingDates,
  };
}

export function dg1Series(input: Dg1Input): Dg1Result {
  const { parsed, from, to } = input;
  const index = indexRowsByDate(parsed);
  const firstValid = parsed.rows.filter(r => r.valid).map(r => r.date).sort()[0] ?? null;
  const effectiveFrom = firstValid !== null && firstValid > from ? firstValid : from;
  const inPeriod = parsed.rows.filter(r => r.date >= effectiveFrom && r.date <= to);

  const duplicateDates: string[] = [];
  const outOfOrderDates: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < inPeriod.length; i++) {
    const d = inPeriod[i].date;
    if (seen.has(d)) duplicateDates.push(d);
    seen.add(d);
    if (i > 0 && d < inPeriod[i - 1].date) outOfOrderDates.push(d);
  }

  const nonPositive: Array<{ date: string; field: string }> = [];
  for (const r of inPeriod) {
    const fields: Array<[string, number | null]> = [
      ['rawOpen', r.rawOpen], ['rawHigh', r.rawHigh], ['rawLow', r.rawLow], ['rawClose', r.rawClose], ['adjClose', r.adjClose],
    ];
    for (const [name, value] of fields) if (value !== null && value <= 0) nonPositive.push({ date: r.date, field: name });
  }

  const bigMoves: Array<{ date: string; prevDate: string; ret: number }> = [];
  const validSorted = [...index.values()].filter(r => r.valid && r.date >= effectiveFrom && r.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < validSorted.length; i++) {
    const prev = validSorted[i - 1].close!;
    const cur = validSorted[i].close!;
    const ret = cur / prev - 1;
    if (Math.abs(ret) > DG1_BIG_MOVE) bigMoves.push({ date: validSorted[i].date, prevDate: validSorted[i - 1].date, ret });
  }

  const imp = impossibleOhlc(inPeriod);
  const primary = missingFor(input.primarySessions, index, effectiveFrom);
  const strict = missingFor(input.strictSessions, index, effectiveFrom);

  const checks: GateCheck[] = [];
  const primaryOk = primary.missingRatio <= DG1_MAX_MISSING_RATIO;
  const strictOk = strict.missingRatio <= DG1_MAX_MISSING_RATIO;
  checks.push({
    name: 'OHLC 결측 비율 ≤ 1%',
    status: primaryOk && strictOk ? 'PASS' : 'FAIL',
    detail: `주 달력(과반 유효일 기준) ${primary.missing}/${primary.sessions} = ${pct(primary.missingRatio)} ${primaryOk ? '통과' : '실패'}; ` +
      `엄격 해석(Yahoo가 행을 만든 모든 날) ${strict.missing}/${strict.sessions} = ${pct(strict.missingRatio)} ${strictOk ? '통과' : '실패'}`,
    interpretationDependent: primaryOk !== strictOk,
  });
  checks.push({ name: '불가능 OHLC 0건', status: imp.length === 0 ? 'PASS' : 'FAIL', detail: `${imp.length}건` });
  checks.push({
    name: '중복·역순·비양수 0건',
    status: duplicateDates.length + outOfOrderDates.length + nonPositive.length === 0 ? 'PASS' : 'FAIL',
    detail: `중복 ${duplicateDates.length} / 역순 ${outOfOrderDates.length} / 비양수 ${nonPositive.length}`,
  });
  checks.push({ name: '일간 |수익률|>20% 목록(보고)', status: 'REPORT', detail: `${bigMoves.length}건` });

  return {
    asset: input.asset,
    effectiveFrom,
    to,
    primary,
    strict,
    impossibleOhlc: imp,
    duplicateDates,
    outOfOrderDates,
    nonPositive,
    bigMoves,
    checks,
    status: worst(checks.map(c => c.status)),
  };
}

// ===========================================================================
// DG3 — 조정계수(adjclose/close) 변화일 = 분배 이벤트(ex-date)
// ===========================================================================
//
// 해석: Yahoo adjclose는 "현재 시점 기준" 소급 조정이라, 분배락일(ex-date) 이전의 모든 날은 계수가 (1 − 분배/전일종가)만큼
// 낮고 ex-date 당일부터는 그 계수가 빠진다. 즉 factor_t는 구간별 상수이고, 값이 바뀌는 곳은 "ex-date 직전 유효일 → ex-date(또는 그 뒤 첫 유효일)" 한 쌍뿐이다.
// 검사: 인접한 유효 행 (p, c) 쌍마다 factor 변화율 rel = factor_c/factor_p − 1 을 구하고,
//   (a) |rel| > 1e-6 이면 변화점이다. 이벤트 날짜가 구간 (p, c] 안에 있어야 한다(결측 행이 끼어 있으면 ex-date가 그 사이에 있을 수 있다).
//   (b) 구간 (p, c]에 이벤트가 없으면 |rel| ≤ 1e-6 이어야 한다(Yahoo 반올림 잡음 한도).
//   (c) 반대로 모든 분배 이벤트는 자신을 포함하는 구간에서 |rel| > 1e-6 인 변화점을 가져야 한다.

export interface Dg3ChangePoint {
  prevDate: string;
  date: string;
  rel: number;
  /** 1 − factor_p/factor_c : 계수가 말하는 분배 수익률 */
  impliedYield: number;
  eventDates: string[];
}

export interface Dg3Result {
  asset: string;
  from: string;
  to: string;
  eventsInPeriod: number;
  splitEventsTotal: number;
  changePoints: Dg3ChangePoint[];
  /** 이벤트 없는 구간인데 계수가 바뀐 곳 */
  unexplainedChanges: Dg3ChangePoint[];
  /** 분배 이벤트가 있는데 계수가 안 바뀐 곳 */
  eventsWithoutChange: Array<{ date: string; amount: number }>;
  /** 이벤트 없는 구간에서의 |계수 변화율| 최댓값 (한도 1e-6) */
  maxNoEventRelChange: number;
  /** 참고(판정 아님): 계수 내재 분배수익률 vs Yahoo 분배금/전일 원시종가 의 최대 차이(bp) */
  maxAmountMismatchBp: number | null;
  checks: GateCheck[];
  status: GateStatus;
}

export function dg3Series(asset: string, parsed: YahooParsed, from: string, to: string, tol: number = DG3_FACTOR_TOLERANCE): Dg3Result {
  const index = indexRowsByDate(parsed);
  const rows = [...index.values()].filter(r => r.factor !== null).sort((a, b) => a.date.localeCompare(b.date));
  const firstFactorDate = rows.length > 0 ? rows[0].date : null;
  const events = parsed.dividends.filter(e => e.date >= from && e.date <= to && firstFactorDate !== null && e.date > firstFactorDate);

  const changePoints: Dg3ChangePoint[] = [];
  const unexplained: Dg3ChangePoint[] = [];
  let maxNoEvent = 0;
  let maxMismatch: number | null = null;
  const eventHasChange = new Map<number, boolean>();
  events.forEach((_, i) => eventHasChange.set(i, false));

  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1];
    const c = rows[i];
    if (c.date < from || c.date > to) continue;
    const rel = c.factor! / p.factor! - 1;
    const inside: number[] = [];
    events.forEach((e, k) => {
      if (e.date > p.date && e.date <= c.date) inside.push(k);
    });
    const changed = Math.abs(rel) > tol;
    if (changed) {
      const cp: Dg3ChangePoint = {
        prevDate: p.date,
        date: c.date,
        rel,
        impliedYield: 1 - p.factor! / c.factor!,
        eventDates: inside.map(k => events[k].date),
      };
      changePoints.push(cp);
      if (inside.length === 0) unexplained.push(cp);
      for (const k of inside) eventHasChange.set(k, true);
      if (inside.length === 1 && p.rawClose !== null && p.rawClose > 0) {
        const diffBp = Math.abs(cp.impliedYield - events[inside[0]].amount / p.rawClose) * 1e4;
        if (maxMismatch === null || diffBp > maxMismatch) maxMismatch = diffBp;
      }
    } else if (inside.length === 0) {
      maxNoEvent = Math.max(maxNoEvent, Math.abs(rel));
    }
  }
  const eventsWithoutChange = events.filter((_, k) => !eventHasChange.get(k)).map(e => ({ date: e.date, amount: e.amount }));

  const checks: GateCheck[] = [
    {
      name: '계수 변화점 = 분배 이벤트 일자',
      status: unexplained.length === 0 && eventsWithoutChange.length === 0 ? 'PASS' : 'FAIL',
      detail: `이벤트 ${events.length}건, 변화점 ${changePoints.length}개, 이벤트 없는 변화점 ${unexplained.length}개, 변화 없는 이벤트 ${eventsWithoutChange.length}건`,
    },
    {
      name: '이벤트 없는 구간 계수 변화 ≤ 1e-6',
      status: unexplained.length === 0 && maxNoEvent <= tol ? 'PASS' : 'FAIL',
      detail: `최대 ${maxNoEvent.toExponential(2)}`,
    },
  ];

  return {
    asset,
    from,
    to,
    eventsInPeriod: events.length,
    splitEventsTotal: parsed.splitCount,
    changePoints,
    unexplainedChanges: unexplained,
    eventsWithoutChange,
    maxNoEventRelChange: maxNoEvent,
    maxAmountMismatchBp: maxMismatch,
    checks,
    status: worst(checks.map(c => c.status)),
  };
}

// ===========================================================================
// DG4 — 결측·이월 보고, 연속 결측 ≥3 세션
// ===========================================================================

export interface MissingRun {
  start: string;
  end: string;
  length: number;
}

export function findRuns(sessions: string[], isMissing: (d: string) => boolean, minLen: number): MissingRun[] {
  const runs: MissingRun[] = [];
  let start = -1;
  for (let i = 0; i <= sessions.length; i++) {
    const miss = i < sessions.length && isMissing(sessions[i]);
    if (miss && start < 0) start = i;
    if (!miss && start >= 0) {
      const length = i - start;
      if (length >= minLen) runs.push({ start: sessions[start], end: sessions[i - 1], length });
      start = -1;
    }
  }
  return runs;
}

export interface Dg4AssetReport {
  code: AssetCode;
  /** 주 달력의 이월 세션(source=actual, fresh=false) */
  carriedSessions: string[];
  carriedRunsGE3: MissingRun[];
  absentSessions: number;
  syntheticSessions: number;
  syntheticNonFreshSessions: number;
  /** 엄격 달력에서 이 자산이 유효 봉이 없는 세션 */
  strictMissingSessions: string[];
  strictMissingRunsGE3: MissingRun[];
}

export interface Dg4Result {
  /** 주 달력에서 빠진(= 전 종목 값 없음) Yahoo 행/날짜 */
  droppedFromCalendar: Array<{ date: string; weekday: number; status: Record<AssetCode, string> }>;
  droppedRunsGE3: MissingRun[];
  perAsset: Dg4AssetReport[];
  checks: GateCheck[];
  status: GateStatus;
}

export function dg4Report(
  panel: Panel,
  dropped: DroppedDay[],
  strictSessions: string[],
  kr: Record<AssetCode, YahooParsed>
): Dg4Result {
  const perAsset: Dg4AssetReport[] = [];
  for (const code of Object.keys(panel.assets) as AssetCode[]) {
    const a: AssetBars = panel.assets[code];
    const carried: string[] = [];
    let absent = 0;
    let synth = 0;
    let synthNonFresh = 0;
    for (let i = 0; i < panel.dates.length; i++) {
      if (a.source[i] === 'actual' && !a.fresh[i]) carried.push(panel.dates[i]);
      if (a.source[i] === 'absent') absent++;
      if (a.source[i] === 'synthetic') {
        synth++;
        if (!a.fresh[i]) synthNonFresh++;
      }
    }
    const carriedSet = new Set(carried);
    const index = indexRowsByDate(kr[code]);
    const firstValid = [...index.values()].filter(r => r.valid).map(r => r.date).sort()[0] ?? null;
    const strictMissing = strictSessions.filter(d => firstValid !== null && d >= firstValid && !(index.get(d)?.valid ?? false));
    const strictMissingSet = new Set(strictMissing);
    perAsset.push({
      code,
      carriedSessions: carried,
      carriedRunsGE3: findRuns(panel.dates, d => carriedSet.has(d), 3),
      absentSessions: absent,
      syntheticSessions: synth,
      syntheticNonFreshSessions: synthNonFresh,
      strictMissingSessions: strictMissing,
      strictMissingRunsGE3: findRuns(strictSessions, d => strictMissingSet.has(d), 3),
    });
  }
  const droppedDates = new Set(dropped.map(d => d.date));
  const merged = [...new Set([...strictSessions, ...dropped.map(d => d.date)])].sort();
  const droppedRunsGE3 = findRuns(merged, d => droppedDates.has(d), 3);
  const carriedTotal = perAsset.reduce((s, a) => s + a.carriedSessions.length, 0);
  const strictRunTotal = perAsset.reduce((s, a) => s + a.strictMissingRunsGE3.length, 0);
  const checks: GateCheck[] = [
    { name: '주 달력에서 제외된 날(전 종목 값 없음)', status: 'REPORT', detail: `${dropped.length}일 (연속 3일 이상 구간 ${droppedRunsGE3.length}개)` },
    { name: '주 달력의 이월 세션(자산별 합)', status: 'REPORT', detail: `${carriedTotal}건` },
    { name: '엄격 달력 기준 연속 결측 ≥3 세션 구간(자산별 합)', status: 'REPORT', detail: `${strictRunTotal}개` },
  ];
  return {
    droppedFromCalendar: dropped.map(d => ({ date: d.date, weekday: d.weekday, status: d.status })),
    droppedRunsGE3,
    perAsset,
    checks,
    status: 'REPORT',
  };
}

// ===========================================================================
// DG2 비교기 — 앱 백엔드 /history 종가 vs Yahoo 원시 종가 (조회는 buildData.ts)
// ===========================================================================

export interface AppSeriesLike {
  dates: string[];
  close: (number | null)[];
}

export type Dg2Basis = 'raw' | 'adjusted';

export interface Dg2Compare {
  asset: string;
  /** raw = Yahoo 원시 종가(close), adjusted = Yahoo 배당조정 종가(adjclose) */
  basis: Dg2Basis;
  compared: number;
  matched: number;
  matchRate: number | null;
  maxRelDiff: number | null;
  yahooSessionsInRange: number;
  coverage: number | null;
  appFirstDate: string | null;
  appLastDate: string | null;
  mismatches: Array<{ date: string; app: number; yahoo: number; relDiff: number }>;
  mismatchCount: number;
  status: GateStatus;
}

export function dg2Compare(
  asset: string,
  app: AppSeriesLike,
  yahoo: YahooParsed,
  from: string,
  to: string,
  basis: Dg2Basis = 'raw',
  tol: number = DG2_CLOSE_TOLERANCE
): Dg2Compare {
  const yMap = new Map<string, number>();
  for (const r of yahoo.rows) {
    const v = basis === 'raw' ? r.rawClose : r.adjClose;
    if (v !== null && v > 0 && r.date >= from && r.date <= to) yMap.set(r.date, v);
  }
  let compared = 0;
  let matched = 0;
  let maxRel = 0;
  const mism: Dg2Compare['mismatches'] = [];
  let appFirst: string | null = null;
  let appLast: string | null = null;
  for (let i = 0; i < app.dates.length; i++) {
    const d = app.dates[i];
    const a = app.close[i];
    if (d < from || d > to || a === null || !Number.isFinite(a)) continue;
    if (appFirst === null || d < appFirst) appFirst = d;
    if (appLast === null || d > appLast) appLast = d;
    const y = yMap.get(d);
    if (y === undefined) continue;
    compared++;
    const rel = Math.abs(a - y) / y;
    maxRel = Math.max(maxRel, rel);
    if (rel <= tol) matched++;
    else mism.push({ date: d, app: a, yahoo: y, relDiff: rel });
  }
  const matchRate = compared > 0 ? matched / compared : null;
  const coverage = yMap.size > 0 ? compared / yMap.size : null;
  let status: GateStatus;
  if (compared === 0) status = 'UNAVAILABLE';
  else if (matchRate! < DG2_MIN_MATCH_RATE) status = 'FAIL';
  else if (coverage! < 0.95) status = 'PARTIAL';
  else status = 'PASS';
  return {
    asset,
    basis,
    compared,
    matched,
    matchRate,
    maxRelDiff: compared > 0 ? maxRel : null,
    yahooSessionsInRange: yMap.size,
    coverage,
    appFirstDate: appFirst,
    appLastDate: appLast,
    mismatches: mism.slice(0, 50),
    mismatchCount: mism.length,
    status,
  };
}

// ===========================================================================
// §10 프록시 충실도 — 합성 vs 실제 464470 (겹침 구간, 주간·월간 판정 / 일간 보고)
// ===========================================================================

export interface ReturnStats {
  frequency: 'daily' | 'weekly' | 'monthly';
  observations: number;
  correlation: number | null;
  /** actual = alpha + beta × proxy 회귀의 기울기 */
  beta: number | null;
  alpha: number | null;
  trackingErrorAnnual: number | null;
  directionMatch: number | null;
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function sampleVar(values: number[]): number {
  const m = mean(values);
  return values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
}

/** actual 수익률을 proxy 수익률에 회귀한 통계. ppy = 연율화 기간 수(일 252·주 52·월 12). */
export function compareReturns(
  frequency: ReturnStats['frequency'],
  actual: number[],
  proxy: number[],
  periodsPerYear: number
): ReturnStats {
  const n = Math.min(actual.length, proxy.length);
  if (n < 3) {
    return { frequency, observations: n, correlation: null, beta: null, alpha: null, trackingErrorAnnual: null, directionMatch: null };
  }
  const a = actual.slice(0, n);
  const p = proxy.slice(0, n);
  const ma = mean(a);
  const mp = mean(p);
  const cov = a.reduce((s, v, i) => s + (v - ma) * (p[i] - mp), 0) / (n - 1);
  const va = sampleVar(a);
  const vp = sampleVar(p);
  const diff = a.map((v, i) => v - p[i]);
  const beta = vp > 0 ? cov / vp : null;
  return {
    frequency,
    observations: n,
    correlation: va > 0 && vp > 0 ? cov / Math.sqrt(va * vp) : null,
    beta,
    alpha: beta === null ? null : ma - beta * mp,
    trackingErrorAnnual: Math.sqrt(sampleVar(diff)) * Math.sqrt(periodsPerYear),
    directionMatch: a.filter((v, i) => Math.sign(v) === Math.sign(p[i])).length / n,
  };
}

/** ISO 8601 주 키 (월요일 시작, 'YYYY-Www'). 연말·연초 경계는 목요일이 속한 해를 따른다. */
export function isoWeekKey(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dayFromMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayFromMonday + 3); // 그 주의 목요일
  const isoYear = d.getUTCFullYear();
  const jan1 = Date.UTC(isoYear, 0, 1);
  const dayOfYear = Math.floor((d.getTime() - jan1) / 86400000) + 1;
  const week = Math.floor((dayOfYear - 1) / 7) + 1;
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export interface AlignedPoint {
  date: string;
  actual: number;
  proxy: number;
}

/** 기간 키별로 마지막 세션의 (실제, 합성) 종가 쌍을 뽑는다. */
export function periodEndPoints(points: AlignedPoint[], key: (date: string) => string): AlignedPoint[] {
  const out: AlignedPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i === points.length - 1 || key(points[i + 1].date) !== key(points[i].date)) out.push(points[i]);
  }
  return out;
}

function returnsOf(points: AlignedPoint[]): { actual: number[]; proxy: number[] } {
  const actual: number[] = [];
  const proxy: number[] = [];
  for (let i = 1; i < points.length; i++) {
    actual.push(points[i].actual / points[i - 1].actual - 1);
    proxy.push(points[i].proxy / points[i - 1].proxy - 1);
  }
  return { actual, proxy };
}

export interface FidelityCriterion {
  name: string;
  value: number | null;
  threshold: string;
  pass: boolean;
}

export interface ProxyFidelity {
  from: string;
  to: string;
  sessions: number;
  daily: ReturnStats;
  weekly: ReturnStats;
  monthly: ReturnStats;
  criteria: FidelityCriterion[];
  /** 모든 판정 기준(주간·월간) 충족 시 true → P가 주 분석. false → 합성 폐기, P5 자동 승격. */
  pass: boolean;
  status: GateStatus;
}

/**
 * @param sessions 오름차순 KRX 세션
 * @param actualClose 실제 464470 TR 종가(없으면 null)
 * @param proxyClose 같은 날짜의 합성 종가(스케일 무관 — 수익률만 쓴다)
 */
export function proxyFidelity(
  sessions: string[],
  actualClose: (number | null)[],
  proxyClose: (number | null)[],
  from: string,
  to: string
): ProxyFidelity {
  const points: AlignedPoint[] = [];
  for (let i = 0; i < sessions.length; i++) {
    const a = actualClose[i];
    const p = proxyClose[i];
    if (sessions[i] < from || sessions[i] > to || a === null || p === null || !(a > 0) || !(p > 0)) continue;
    points.push({ date: sessions[i], actual: a, proxy: p });
  }
  const daily = returnsOf(points);
  const weeklyPts = periodEndPoints(points, isoWeekKey);
  const monthlyPts = periodEndPoints(points, monthKey);
  const w = returnsOf(weeklyPts);
  const m = returnsOf(monthlyPts);
  const dailyStats = compareReturns('daily', daily.actual, daily.proxy, 252);
  const weekly = compareReturns('weekly', w.actual, w.proxy, 52);
  const monthly = compareReturns('monthly', m.actual, m.proxy, 12);

  const crit = (name: string, value: number | null, threshold: string, ok: (v: number) => boolean): FidelityCriterion => ({
    name,
    value,
    threshold,
    pass: value !== null && ok(value),
  });
  const criteria: FidelityCriterion[] = [
    crit('주간 상관', weekly.correlation, '>= 0.80', v => v >= 0.8),
    crit('주간 베타', weekly.beta, '0.70 ~ 1.30', v => v >= 0.7 && v <= 1.3),
    crit('월간 상관', monthly.correlation, '>= 0.90', v => v >= 0.9),
    crit('월간 베타', monthly.beta, '0.80 ~ 1.20', v => v >= 0.8 && v <= 1.2),
    crit('월간 추적오차(연율)', monthly.trackingErrorAnnual, '<= 6%', v => v <= 0.06),
  ];
  const pass = criteria.every(c => c.pass);
  return {
    from,
    to,
    sessions: points.length,
    daily: dailyStats,
    weekly,
    monthly,
    criteria,
    pass,
    status: pass ? 'PASS' : 'FAIL',
  };
}
