// scripts/backtest/lectureSignals/eventStats.ts
// ---------------------------------------------------------------------------
// 이벤트 스터디 통계(§5.5). 기존 conditionalChannel/statistics.ts의 mulberry32·
// percentileSorted·holmAdjust를 재사용한다. 날짜 군집 보존 블록 부트스트랩:
// 이벤트 날짜를 ~60거래일(≈84 캘린더일) 블록으로 재표집해 종목·날짜 동시성을 보존한다.
//
// 규칙: `any`·`console.*`·`Math.random` 금지. 순수 로직(외부 I/O 없음).
// ---------------------------------------------------------------------------

import { holmAdjust, mulberry32, percentileSorted, randomInt } from '../conditionalChannel/statistics';
import type { AcuteSignalCode } from './configTypes';
import { CONST } from './configTypes';
import { mean } from './features';

/** 통계 입력용 이벤트(팩터·비용 등은 별도 유지, 여기선 수치만). */
export interface StatEvent {
  code: string;
  signal: AcuteSignalCode;
  date: string;
  year: number;
  excess: number | null; // 신호 종목 시장초과수익(해당 호라이즌)
  controlExcess: number | null; // 매칭 대조군 평균 시장초과수익
  stockReturn: number | null;
  mae: number | null;
  mfe: number | null;
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return percentileSorted(s, 50);
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000
  );
}

export interface DiffEstimate {
  point: number;
  ciLower: number;
  ciUpper: number;
  pValue: number;
}

/** 유효 이벤트(둘 다 non-null)의 (신호중앙 − 대조중앙) 및 평균 매칭차. */
function statOn(events: readonly StatEvent[]): { medianDiff: number; meanMatchedDiff: number } {
  const sig: number[] = [];
  const ctl: number[] = [];
  const matched: number[] = [];
  for (const e of events) {
    if (e.excess === null || e.controlExcess === null) continue;
    sig.push(e.excess);
    ctl.push(e.controlExcess);
    matched.push(e.excess - e.controlExcess);
  }
  return { medianDiff: median(sig) - median(ctl), meanMatchedDiff: mean(matched) };
}

/**
 * 날짜 군집 보존 블록 부트스트랩(§5.5). uniqueDates를 ~84캘린더일(≈60거래일) 블록으로
 * 순환 재표집해 목표 이벤트 수를 채우고, 각 반복의 통계량 분포로 CI·p를 구한다.
 * 결정론적(seed 고정).
 */
export function bootstrapDiff(
  events: readonly StatEvent[],
  seed: number,
  which: 'median' | 'meanMatched'
): DiffEstimate {
  const valid = events.filter((e) => e.excess !== null && e.controlExcess !== null);
  const point = which === 'median' ? statOn(valid).medianDiff : statOn(valid).meanMatchedDiff;
  if (valid.length < 2) {
    return { point: Number.isFinite(point) ? point : 0, ciLower: NaN, ciUpper: NaN, pValue: 1 };
  }
  // 날짜별 그룹
  const byDate = new Map<string, StatEvent[]>();
  for (const e of valid) {
    const arr = byDate.get(e.date) ?? [];
    arr.push(e);
    byDate.set(e.date, arr);
  }
  const dates = [...byDate.keys()].sort();
  const target = valid.length;
  const blockCalDays = 84; // ≈60 거래일
  const rng = mulberry32(seed);
  const samples: number[] = [];
  for (let it = 0; it < CONST.bootstrapIterations; it++) {
    const collected: StatEvent[] = [];
    let guard = 0;
    while (collected.length < target && guard < target * 4 + 10) {
      const startIdx = randomInt(rng, dates.length);
      const startDate = dates[startIdx];
      for (let j = startIdx; j < dates.length; j++) {
        if (daysBetween(startDate, dates[j]) > blockCalDays) break;
        const arr = byDate.get(dates[j]);
        if (arr) for (const e of arr) collected.push(e);
        guard++;
        if (collected.length >= target) break;
      }
      guard++;
    }
    const s = which === 'median' ? statOn(collected).medianDiff : statOn(collected).meanMatchedDiff;
    if (Number.isFinite(s)) samples.push(s);
  }
  samples.sort((a, b) => a - b);
  const alpha = (1 - CONST.confidenceLevel) / 2;
  const ciLower = percentileSorted(samples, alpha * 100);
  const ciUpper = percentileSorted(samples, (1 - alpha) * 100);
  let leq = 0;
  let geq = 0;
  for (const s of samples) {
    if (s <= 0) leq++;
    if (s >= 0) geq++;
  }
  const n = samples.length;
  const pValue = n > 0 ? Math.min(1, 2 * Math.min(leq / n, geq / n)) : 1;
  return { point, ciLower, ciUpper, pValue };
}

export interface EventSummary {
  events: number;
  uniqueCodes: number;
  years: number;
  signalMean: number;
  signalMedian: number;
  controlMean: number;
  controlMedian: number;
  medianExcessDiff: number; // 신호중앙 − 대조중앙
  meanMatchedDiff: number;
  maeMean: number;
  mfeMean: number;
  p10StockReturn: number; // 전방수익 10% 하위분위
  matchRate: number; // controlExcess non-null 비율
}

export function summarize(events: readonly StatEvent[]): EventSummary {
  const valid = events.filter((e) => e.excess !== null);
  const withCtl = valid.filter((e) => e.controlExcess !== null);
  const sig = withCtl.map((e) => e.excess as number);
  const ctl = withCtl.map((e) => e.controlExcess as number);
  const codes = new Set(events.map((e) => e.code));
  const years = new Set(events.map((e) => e.year));
  const maes = valid.map((e) => e.mae).filter((v): v is number => v !== null);
  const mfes = valid.map((e) => e.mfe).filter((v): v is number => v !== null);
  const stockRets = valid.map((e) => e.stockReturn).filter((v): v is number => v !== null);
  const sortedRets = [...stockRets].sort((a, b) => a - b);
  return {
    events: valid.length,
    uniqueCodes: codes.size,
    years: years.size,
    signalMean: mean(sig),
    signalMedian: median(sig),
    controlMean: mean(ctl),
    controlMedian: median(ctl),
    medianExcessDiff: median(sig) - median(ctl),
    meanMatchedDiff: mean(withCtl.map((e) => (e.excess as number) - (e.controlExcess as number))),
    maeMean: mean(maes),
    mfeMean: mean(mfes),
    p10StockReturn: sortedRets.length ? percentileSorted(sortedRets, 10) : NaN,
    matchRate: valid.length ? withCtl.length / valid.length : 0,
  };
}

/** 연도별 기여 + 임의 1개 연도 제거 후 방향 유지 여부(§5.5). */
export interface YearDecomposition {
  byYear: { year: number; events: number; medianExcessDiff: number }[];
  leaveOneYearOut: { removedYear: number; medianExcessDiff: number; directionKept: boolean }[];
  regimeConcentrated: boolean;
}

export function decomposeByYear(events: readonly StatEvent[]): YearDecomposition {
  const valid = events.filter((e) => e.excess !== null && e.controlExcess !== null);
  const full = statOn(valid).medianDiff;
  const dir = Math.sign(full);
  const years = [...new Set(valid.map((e) => e.year))].sort();
  const byYear = years.map((y) => {
    const ye = valid.filter((e) => e.year === y);
    return { year: y, events: ye.length, medianExcessDiff: statOn(ye).medianDiff };
  });
  const leaveOneYearOut = years.map((y) => {
    const rest = valid.filter((e) => e.year !== y);
    const d = statOn(rest).medianDiff;
    return {
      removedYear: y,
      medianExcessDiff: d,
      directionKept: dir === 0 ? false : Math.sign(d) === dir,
    };
  });
  const regimeConcentrated = leaveOneYearOut.some((x) => !x.directionKept);
  return { byYear, leaveOneYearOut, regimeConcentrated };
}

/** 상위 기여 종목 1개 제거 후 방향 유지(§5.5). 종목별 기여 = 그 종목 이벤트 제거 시 통계 변화. */
export function topContributorRemoval(events: readonly StatEvent[]): {
  removedCode: string | null;
  medianExcessDiff: number;
  directionKept: boolean;
} {
  const valid = events.filter((e) => e.excess !== null && e.controlExcess !== null);
  const full = statOn(valid).medianDiff;
  const dir = Math.sign(full);
  const codes = [...new Set(valid.map((e) => e.code))];
  let worst: { code: string; delta: number } | null = null;
  for (const c of codes) {
    const rest = valid.filter((e) => e.code !== c);
    if (rest.length === 0) continue;
    const d = statOn(rest).medianDiff;
    const delta = Math.abs(d - full);
    if (worst === null || delta > worst.delta) worst = { code: c, delta };
  }
  if (worst === null) return { removedCode: null, medianExcessDiff: full, directionKept: true };
  const rest = valid.filter((e) => e.code !== worst!.code);
  const d = statOn(rest).medianDiff;
  return {
    removedCode: worst.code,
    medianExcessDiff: d,
    directionKept: dir === 0 ? false : Math.sign(d) === dir,
  };
}

export { holmAdjust, median };
