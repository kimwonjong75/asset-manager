// scripts/backtest/usRoughCheck/stats.ts
// ---------------------------------------------------------------------------
// 미국 약식 사전점검 — 통계(날짜 블록 부트스트랩 · 요약통계).
//
// 재사용: `conditionalChannel/statistics.ts`의 `mulberry32`·`randomInt`·`percentileSorted`·
// `holmAdjust`를 그대로 import 한다(그 파일은 읽기 전용 공용 모듈, 수정하지 않음).
// `Math.random`은 절대 쓰지 않는다(시드 재현성).
//
// 부트스트랩 규약(한국 `quality.ts`의 `bootstrapTwoGroupDiff`와 동일):
//   이벤트를 날짜별로 묶고, 시작 날짜를 무작위로 골라 **84 캘린더일** 블록을 통째로 채택하는 식으로
//   원 표본 크기만큼 재표집한다. 같은 시기 이벤트의 동시성(시장 공통충격)을 보존하기 위함이며,
//   이벤트를 개별적으로 흔드는 단순 부트스트랩보다 CI가 넓게(보수적으로) 나온다.
//
// 규칙: `any`·`console.*`·`Math.random` 금지. 순수 로직.
// ---------------------------------------------------------------------------

import { mulberry32, percentileSorted, randomInt } from '../conditionalChannel/statistics';

export { holmAdjust } from '../conditionalChannel/statistics';

/** 마스터 시드(작업 지시). 하위 검정은 이 값 + 오프셋을 쓴다. */
export const MASTER_SEED = 20260726;
export const BOOTSTRAP_ITERATIONS = 2000;
export const BLOCK_CALENDAR_DAYS = 84;

export interface DiffEstimate {
  point: number;
  ciLower: number;
  ciUpper: number;
  pValue: number;
  nA: number;
  nB: number;
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** 중앙값(정렬 사본 사용, 원배열 불변). 빈 배열이면 NaN. */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function quantile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return NaN;
  return percentileSorted([...xs].sort((a, b) => a - b), p);
}

export function shareAbove(xs: readonly number[], threshold: number): number {
  if (xs.length === 0) return NaN;
  let c = 0;
  for (const x of xs) if (x > threshold) c++;
  return c / xs.length;
}

export interface GroupSummary {
  n: number;
  mean: number;
  median: number;
  q25: number;
  q75: number;
  positiveShare: number;
}

export function summarize(xs: readonly number[]): GroupSummary {
  return {
    n: xs.length,
    mean: mean(xs),
    median: median(xs),
    q25: quantile(xs, 25),
    q75: quantile(xs, 75),
    positiveShare: shareAbove(xs, 0),
  };
}

type Stat = 'mean' | 'median';

function statOf(xs: readonly number[], stat: Stat): number {
  return stat === 'mean' ? mean(xs) : median(xs);
}

/** 양측 p값: 부트스트랩 분포에서 0의 반대편 비율 × 2(한국 규약과 동일). */
function twoSidedP(samples: readonly number[]): number {
  const n = samples.length;
  if (n === 0) return 1;
  let leq = 0;
  let geq = 0;
  for (const s of samples) {
    if (s <= 0) leq++;
    if (s >= 0) geq++;
  }
  return Math.min(1, 2 * Math.min(leq / n, geq / n));
}

export interface GroupEvent {
  date: string;
  group: 'A' | 'B';
  value: number;
}

/**
 * 두 그룹(A−B) 통계량 차의 날짜 블록 부트스트랩.
 * 그룹 배정은 호출부에서 **결과를 보기 전에** 고정한다(여기서는 재표집만 한다).
 */
export function bootstrapTwoGroupDiff(
  events: readonly GroupEvent[],
  seed: number,
  stat: Stat = 'mean'
): DiffEstimate {
  const aAll = events.filter((e) => e.group === 'A').map((e) => e.value);
  const bAll = events.filter((e) => e.group === 'B').map((e) => e.value);
  const point = statOf(aAll, stat) - statOf(bAll, stat);
  const base: DiffEstimate = {
    point: Number.isFinite(point) ? point : NaN,
    ciLower: NaN,
    ciUpper: NaN,
    pValue: 1,
    nA: aAll.length,
    nB: bAll.length,
  };
  if (aAll.length < 5 || bAll.length < 5) return base;

  const byDate = new Map<string, GroupEvent[]>();
  for (const e of events) {
    const arr = byDate.get(e.date) ?? [];
    arr.push(e);
    byDate.set(e.date, arr);
  }
  const dates = [...byDate.keys()].sort();
  const dayNum = dates.map((d) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000));
  const perDate = dates.map((d) => byDate.get(d) ?? []);
  const target = events.length;
  const rng = mulberry32(seed);
  const samples: number[] = [];

  for (let it = 0; it < BOOTSTRAP_ITERATIONS; it++) {
    const aBuf: number[] = [];
    const bBuf: number[] = [];
    let collected = 0;
    let guard = 0;
    while (collected < target && guard < target * 4 + 10) {
      const startIdx = randomInt(rng, dates.length);
      const start = dayNum[startIdx];
      for (let j = startIdx; j < dates.length; j++) {
        if (dayNum[j] - start > BLOCK_CALENDAR_DAYS) break;
        for (const e of perDate[j]) {
          if (e.group === 'A') aBuf.push(e.value);
          else bBuf.push(e.value);
          collected++;
        }
        guard++;
        if (collected >= target) break;
      }
      guard++;
    }
    if (aBuf.length < 2 || bBuf.length < 2) continue;
    samples.push(statOf(aBuf, stat) - statOf(bBuf, stat));
  }
  if (samples.length < 100) return base;
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    point: base.point,
    ciLower: percentileSorted(sorted, 2.5),
    ciUpper: percentileSorted(sorted, 97.5),
    pValue: twoSidedP(sorted),
    nA: aAll.length,
    nB: bAll.length,
  };
}

export interface PairedEvent {
  date: string;
  /** 신호 종목 − 같은 날 대조군 평균 (이미 짝지어진 차). */
  diff: number;
}

/**
 * 짝지어진 차(신호 − 대조군)의 날짜 블록 부트스트랩. E1의 코호트 매칭 검정용.
 * 반환의 nA=이벤트 수, nB=0.
 */
export function bootstrapPairedDiff(
  events: readonly PairedEvent[],
  seed: number,
  stat: Stat = 'median'
): DiffEstimate {
  const all = events.map((e) => e.diff);
  const point = statOf(all, stat);
  const base: DiffEstimate = {
    point: Number.isFinite(point) ? point : NaN,
    ciLower: NaN,
    ciUpper: NaN,
    pValue: 1,
    nA: all.length,
    nB: 0,
  };
  if (all.length < 10) return base;

  const byDate = new Map<string, number[]>();
  for (const e of events) {
    const arr = byDate.get(e.date) ?? [];
    arr.push(e.diff);
    byDate.set(e.date, arr);
  }
  const dates = [...byDate.keys()].sort();
  const dayNum = dates.map((d) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000));
  const perDate = dates.map((d) => byDate.get(d) ?? []);
  const target = events.length;
  const rng = mulberry32(seed);
  const samples: number[] = [];

  for (let it = 0; it < BOOTSTRAP_ITERATIONS; it++) {
    const buf: number[] = [];
    let guard = 0;
    while (buf.length < target && guard < target * 4 + 10) {
      const startIdx = randomInt(rng, dates.length);
      const start = dayNum[startIdx];
      for (let j = startIdx; j < dates.length; j++) {
        if (dayNum[j] - start > BLOCK_CALENDAR_DAYS) break;
        for (const v of perDate[j]) buf.push(v);
        guard++;
        if (buf.length >= target) break;
      }
      guard++;
    }
    if (buf.length < 2) continue;
    samples.push(statOf(buf, stat));
  }
  if (samples.length < 100) return base;
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    point: base.point,
    ciLower: percentileSorted(sorted, 2.5),
    ciUpper: percentileSorted(sorted, 97.5),
    pValue: twoSidedP(sorted),
    nA: all.length,
    nB: 0,
  };
}
