// scripts/backtest/core6SignalRotationV3/data/amendment2.ts
// Amendment 2 (docs/backtest/PREREG_코어6종_신호로테이션_V3_AMENDMENT_2.md) — 순수 함수만(fs·네트워크 없음).
//  A2-1 TR 시세의 기준 출처 = 앱 백엔드 /history 조정 OHLC. 세션 달력은 Yahoo 행이 있는 모든 날(엄격) 그대로, 백엔드에 값이 없는 날은 이월.
//  A2-2 DG2 = 백엔드 조정 종가 vs Yahoo(이벤트 원장 TR) 종가. 기준 미달이어도 알려진 분배 오류 3건으로 구간 단위로 전부 설명되면 '사유 확인 통과'.
// 전략 성과(MDD·CAGR 등)는 계산하지 않는다. 임의 계수 보정은 하지 않는다.

import type { AssetCode } from '../types';
import { indexBackend } from './amendment';
import type { BackendImplied, BackendSeries, LedgerEvent } from './amendment';
import { impossibleOhlc } from './gates';
import type { ImpossibleBar } from './gates';
import { indexRowsByDate } from './yahoo';
import type { YahooParsed, YahooRow } from './yahoo';

/** DG2와 같은 허용치(0.1%). */
export const DG2_TOL = 1e-3;
/** 구간 안에서 비율이 중앙값에서 이 이상 벗어나면 '단계형 차이가 아님'(가격 반올림 잡음 한도). */
export const INTERVAL_FLAT_TOL = 5e-4;
/** 구간 경계의 단계 크기(측정)와 기대 분배 수익률이 이보다(bp) 벌어지면 '그 사건으로 설명되지 않음'. */
export const STEP_MATCH_TOL_BP = 5;

// ---------------------------------------------------------------------------
// A2-1 백엔드 기준 TR 시계열
// ---------------------------------------------------------------------------

export interface BackendBuild {
  parsed: YahooParsed;
  /** Yahoo 행은 있는데(그 자산의 백엔드 첫 봉 이후) 백엔드 값이 없어 이월되는 날 */
  carriedDates: string[];
  /** 백엔드 봉이 있는데 Yahoo 행이 없어 달력에 들어가지 않는 날(패널 기간 안) */
  backendOnlyDates: string[];
  /** 기간 안 불가능 OHLC (H<L, O>H, O<L, C>H, C<L) */
  impossible: ImpossibleBar[];
  /** 기간 안 백엔드 봉 수 */
  barsInRange: number;
  /** 기간 안 백엔드 봉 중 O/H/L/C가 전부 정수인 봉 수(백엔드 값이 원 단위로 반올림돼 있는지 보고용) */
  integerValuedBars: number;
}

/**
 * Yahoo 행(달력·원시값 보존)에 백엔드 배당조정 O/H/L/C를 그대로 입힌다. 백엔드 값은 이미 TR 조정 단위라 계수를 곱하지 않는다.
 * 백엔드에 값이 없는 Yahoo 행은 valid=false(패널에서 이월, fresh=false). factor는 null(백엔드 계수는 별도로 쓰지 않는다).
 */
export function buildBackendParsed(yahoo: YahooParsed, backend: BackendSeries, from: string, to: string): BackendBuild {
  const bIndex = indexBackend(backend);
  const bDates = [...bIndex.keys()].sort();
  const firstBackend = bDates[0] ?? null;
  const rows: YahooRow[] = yahoo.rows.map(r => {
    const base: YahooRow = { ...r, yahooAdjClose: r.adjClose, yahooFactor: r.factor };
    const b = bIndex.get(r.date);
    if (!b) return { ...base, valid: false, source: 'backend' as const, factor: null, adjClose: null, open: null, high: null, low: null, close: null };
    return { ...base, valid: true, source: 'backend' as const, factor: null, adjClose: b.close, open: b.open, high: b.high, low: b.low, close: b.close };
  });
  const yDates = new Set(yahoo.rows.map(r => r.date));
  const carried = [...yDates].filter(d => d >= from && d <= to && firstBackend !== null && d >= firstBackend && !bIndex.has(d)).sort();
  const backendOnly = bDates.filter(d => d >= from && d <= to && !yDates.has(d));
  const inRange = rows.filter(r => r.valid && r.date >= from && r.date <= to);
  const integerValued = inRange.filter(r => [r.open, r.high, r.low, r.close].every(v => v !== null && Number.isInteger(v))).length;
  return {
    parsed: { ...yahoo, rows },
    carriedDates: carried,
    backendOnlyDates: backendOnly,
    impossible: impossibleOhlc(inRange),
    barsInRange: bDates.filter(d => d >= from && d <= to).length,
    integerValuedBars: integerValued,
  };
}

export interface OhlcConsistency {
  n: number;
  /** max | (backend 시가/원장TR 시가) ÷ (backend 종가/원장TR 종가) − 1 | 등. 같은 계수로 조정됐다면 0 근처(반올림 잡음만). */
  maxDevOpen: number;
  maxDevHigh: number;
  maxDevLow: number;
}

/** 백엔드 O/H/L이 종가와 같은 계수로 조정됐는지: 원장 TR(원시×계수)의 O/H/L/C와 날짜별 비율을 비교한다. */
export function ohlcCoefficientConsistency(backend: BackendSeries, ledger: YahooParsed, from: string, to: string): OhlcConsistency {
  const bIndex = indexBackend(backend);
  let n = 0;
  let mo = 0;
  let mh = 0;
  let ml = 0;
  for (const r of indexRowsByDate(ledger).values()) {
    if (!r.valid || r.date < from || r.date > to) continue;
    const b = bIndex.get(r.date);
    if (!b || r.open === null || r.high === null || r.low === null || r.close === null) continue;
    const rc = b.close / r.close;
    n++;
    mo = Math.max(mo, Math.abs(b.open / r.open / rc - 1));
    mh = Math.max(mh, Math.abs(b.high / r.high / rc - 1));
    ml = Math.max(ml, Math.abs(b.low / r.low / rc - 1));
  }
  return { n, maxDevOpen: mo, maxDevHigh: mh, maxDevLow: ml };
}

// ---------------------------------------------------------------------------
// A2-2 DG2 구간 단위 설명
// ---------------------------------------------------------------------------

export type KnownErrorKind = 'missing-event' | 'misdated-event';

export interface KnownLedgerError {
  asset: AssetCode;
  kind: KnownErrorKind;
  /** 단계가 일어나는 날짜(새 수준이 처음 나타나는 날)가 속해야 하는 창 */
  windowFrom: string;
  windowTo: string;
  description: string;
}

/** 정정 2 §1·A2-2가 명시한 알려진 Yahoo 분배 원장 오류 3건. 이 목록은 데이터를 보고 늘리지 않는다. */
export const KNOWN_LEDGER_ERRORS: readonly KnownLedgerError[] = [
  { asset: '069500', kind: 'missing-event', windowFrom: '2022-07-01', windowTo: '2022-07-31', description: '069500 2022-07 분배가 Yahoo 원장에 없음(백엔드는 2022-07-28 단계)' },
  { asset: '069500', kind: 'misdated-event', windowFrom: '2022-10-27', windowTo: '2022-10-27', description: '069500 2022-07 분배가 Yahoo 원장에서 2022-10-27로 날짜가 잘못 기재됨' },
  { asset: '464470', kind: 'missing-event', windowFrom: '2025-03-28', windowTo: '2025-03-28', description: '464470 2025-03-28 분배가 Yahoo 원장에 없음' },
];

export interface RatioPoint {
  date: string;
  /** 백엔드 조정 종가 ÷ 원장 TR 종가 */
  ratio: number;
}

/** 두 계열이 모두 값을 가진 날의 비율. ledger는 applyEventLedger 결과(원시값이 있는 행만 valid). */
export function ratioPoints(backend: BackendSeries, ledger: YahooParsed, from: string, to: string): RatioPoint[] {
  const bIndex = indexBackend(backend);
  const out: RatioPoint[] = [];
  for (const r of indexRowsByDate(ledger).values()) {
    if (!r.valid || r.close === null || !(r.close > 0) || r.date < from || r.date > to) continue;
    const b = bIndex.get(r.date);
    if (b) out.push({ date: r.date, ratio: b.close / r.close });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface Dg2Interval {
  from: string;
  to: string;
  rows: number;
  medianRatio: number;
  /** 구간 중앙값에서 가장 많이 벗어난 정도 */
  maxDevFromMedian: number;
  flat: boolean;
  /** 허용치(0.1%)를 넘어 어긋난 날 수 */
  mismatchDays: number;
  /** 구간의 모든 날이 허용치 안 */
  clean: boolean;
  /** 오른쪽 경계(다음 구간 시작)의 단계가 알려진 사건으로 확인됐고, 그 뒤가 깨끗하거나 설명 가능 */
  explainable: boolean;
}

export interface Dg2Step {
  error: KnownLedgerError;
  /** 단계 날짜(새 수준 첫날). 창 안에서 사건을 못 찾으면 null */
  date: string | null;
  /** 사건이 말하는 단계 크기 (측정치와 같은 정의: 1 − 이전구간 중앙값/이후구간 중앙값) */
  expectedStep: number | null;
  measuredStep: number | null;
  diffBp: number | null;
  ok: boolean;
  note: string;
}

export interface Dg2Explanation {
  asset: string;
  intervals: Dg2Interval[];
  steps: Dg2Step[];
  /** 알려진 사건으로 설명되지 않는 어긋난 날(허용치 초과) */
  unexplainedDates: string[];
  /** 알려진 사건과 무관한 원장·백엔드 불일치(이벤트 수익률 5bp 초과 차이, 원장에 없는 백엔드 단계) */
  extraDisagreements: string[];
  explained: boolean;
}

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 어긋남이 알려진 분배 오류로 전부 설명되는지 구간 단위로 판정한다.
 *  1) 알려진 오류마다 창 안에서 사건 날짜를 찾는다: missing-event = 원장에 없는 백엔드 단계(implied.backendOnlySteps), misdated-event = 원장 이벤트일.
 *  2) 그 날짜들로 비율 시계열을 구간으로 자른다. 구간 안에서는 비율이 거의 일정(INTERVAL_FLAT_TOL)해야 한다 — 단계형 차이.
 *  3) 구간 경계의 단계 크기(1 − 이전 중앙값/이후 중앙값)가 사건이 말하는 크기와 5bp 안에서 같아야 한다.
 *     missing: 단계 = 백엔드 분배 수익률 y. misdated: 원장이 날짜가 틀린 분배 y를 이른 구간에 잘못 적용했으므로 단계 = 1 − 1/(1 − y).
 *  4) 마지막 구간(모든 알려진 사건 이후)은 전부 허용치 안이어야 한다. 앞 구간의 어긋남은 위 조건을 만족하면서 다음 구간이 깨끗하거나 설명 가능할 때만 인정한다.
 * 알려진 사건과 무관한 원장·백엔드 불일치가 하나라도 남으면 explained=false.
 */
export function explainDg2(
  asset: string,
  points: RatioPoint[],
  errors: readonly KnownLedgerError[],
  events: LedgerEvent[],
  implied: BackendImplied,
  tol: number = DG2_TOL
): Dg2Explanation {
  const steps: Dg2Step[] = errors.map(e => {
    let date: string | null = null;
    let expected: number | null = null;
    let note = '';
    if (e.kind === 'missing-event') {
      const hit = implied.backendOnlySteps.filter(s => s.date >= e.windowFrom && s.date <= e.windowTo);
      if (hit.length === 1) {
        date = hit[0].date;
        expected = hit[0].backendYield;
      } else note = `창 ${e.windowFrom}~${e.windowTo} 안의 '원장에 없는 백엔드 단계'가 ${hit.length}개(1개여야 함)`;
    } else {
      const hit = events.filter(x => x.exDate >= e.windowFrom && x.exDate <= e.windowTo && x.yield !== null);
      if (hit.length === 1) {
        date = hit[0].exDate;
        expected = 1 - 1 / (1 - hit[0].yield!);
      } else note = `창 ${e.windowFrom}~${e.windowTo} 안의 원장 이벤트가 ${hit.length}개(1개여야 함)`;
    }
    return { error: e, date, expectedStep: expected, measuredStep: null, diffBp: null, ok: false, note };
  });

  // 구간 자르기 — 해결된 사건 날짜만 쓴다.
  const cuts = [...new Set(steps.flatMap(s => (s.date !== null ? [s.date] : [])))].sort();
  const buckets: RatioPoint[][] = [[]];
  let ci = 0;
  for (const p of points) {
    while (ci < cuts.length && p.date >= cuts[ci]) {
      ci++;
      buckets.push([]);
    }
    buckets[buckets.length - 1].push(p);
  }
  const base = buckets.map(b => {
    if (b.length === 0) return null;
    const med = medianOf(b.map(x => x.ratio));
    const maxDev = b.reduce((m, x) => Math.max(m, Math.abs(x.ratio / med - 1)), 0);
    const mismatches = b.filter(x => Math.abs(x.ratio - 1) > tol);
    return { b, med, maxDev, mismatches };
  });

  // 단계 측정: 사건 날짜 s에서 시작하는 구간(after)과 그 바로 앞 구간(before)의 중앙값
  const startIdx = (s: string): number => base.findIndex(x => x !== null && x.b[0].date === s);
  const stepOkByAfterStart = new Map<string, boolean>();
  for (const st of steps) {
    if (st.date === null) continue;
    const ai = startIdx(st.date);
    const after = ai >= 0 ? base[ai] : null;
    const before = ai > 0 ? base[ai - 1] : null;
    if (!after) {
      st.note = `사건일 ${st.date}부터 시작하는 비교 가능한 날이 없다`;
      continue;
    }
    if (!before) {
      st.note = `사건일 ${st.date} 앞에 비교 가능한 구간이 없다`;
      continue;
    }
    st.measuredStep = 1 - before.med / after.med;
    st.diffBp = (st.measuredStep - st.expectedStep!) * 1e4;
    st.ok = Math.abs(st.diffBp) <= STEP_MATCH_TOL_BP;
    st.note = st.ok ? '측정 단계 = 사건이 말하는 단계' : `측정 단계가 사건과 ${st.diffBp.toFixed(1)}bp 다름`;
    // 같은 날짜에 사건이 둘 이상이면 모두 ok여야 통과
    stepOkByAfterStart.set(st.date, (stepOkByAfterStart.get(st.date) ?? true) && st.ok);
  }

  // 뒤에서 앞으로: 설명 가능 여부
  const intervals: Dg2Interval[] = [];
  const explainable: boolean[] = new Array<boolean>(base.length).fill(false);
  for (let k = base.length - 1; k >= 0; k--) {
    const x = base[k];
    if (!x) continue;
    const flat = x.maxDev <= INTERVAL_FLAT_TOL;
    const nextIdx = base.findIndex((y, j) => j > k && y !== null);
    const next = nextIdx >= 0 ? base[nextIdx] : null;
    const stepOk = next !== null ? (stepOkByAfterStart.get(next.b[0].date) ?? false) : false;
    const nextFine = next !== null && (next.mismatches.length === 0 || explainable[nextIdx]);
    explainable[k] = flat && next !== null && stepOk && nextFine;
  }
  base.forEach((x, k) => {
    if (!x) return;
    intervals.push({
      from: x.b[0].date,
      to: x.b[x.b.length - 1].date,
      rows: x.b.length,
      medianRatio: x.med,
      maxDevFromMedian: x.maxDev,
      flat: x.maxDev <= INTERVAL_FLAT_TOL,
      mismatchDays: x.mismatches.length,
      clean: x.mismatches.length === 0,
      explainable: explainable[k],
    });
  });

  const unexplainedDates: string[] = [];
  base.forEach((x, k) => {
    if (!x) return;
    if (x.mismatches.length > 0 && !explainable[k]) unexplainedDates.push(...x.mismatches.map(m => m.date));
  });

  const known = new Set(cuts);
  const extra: string[] = [];
  for (const e of implied.events) {
    if (e.flag === 'mismatch' && !known.has(e.exDate)) {
      extra.push(`${asset} ${e.exDate} 분배 ${e.amount}원: 원장 ${e.ledgerYield === null ? '-' : (e.ledgerYield * 100).toFixed(4)}% vs 백엔드 ${e.backendYield === null ? '-' : (e.backendYield * 100).toFixed(4)}% (${e.diffBp?.toFixed(1)}bp)`);
    }
  }
  for (const s of implied.backendOnlySteps) {
    if (!known.has(s.date)) extra.push(`${asset} ${s.prevDate}→${s.date}: 원장에 없는 백엔드 단계 ${(s.backendYield * 100).toFixed(4)}%`);
  }

  const unresolved = steps.filter(s => s.date !== null && !s.ok);
  const explained = unexplainedDates.length === 0 && extra.length === 0 && unresolved.length === 0;
  return { asset, intervals, steps, unexplainedDates, extraDisagreements: extra, explained };
}
