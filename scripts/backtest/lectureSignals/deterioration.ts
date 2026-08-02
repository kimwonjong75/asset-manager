// scripts/backtest/lectureSignals/deterioration.ts
// ---------------------------------------------------------------------------
// 2차 배치 — 보유 중 열화 경고 H3/H4/H5 (§8, RS 불필요). 순수 판정 함수 + 이벤트 스터디 실행.
//
// 계획서 §8.1의 H3는 "진입일 고정 분모"이나 진입 코호트 정의가 없어 **롤링 변형으로 재정의**한다
// (계획서 이탈 항목 — 결과 문서에 명시). H4/H5는 원 정의를 비미래참조로 구현.
//
//   H3_VOL_SPIKE_ROLLING : realizedVol(20) ≥ 1.5 × realizedVol(63)  (둘 다 당일 D 제외, 기존 규약)
//   H4_UPPER_WICK_CLUSTER: 최근 60일(당일 포함) (adjHigh-adjClose)/adjHigh ≥ 5% 인 날 수 > 5
//   H5_BOOM_BUST_REPEAT  : 비미래참조 상태기계 완료 사이클(러닝저점+50%→러닝고점 추적→고점-30%)
//                          이 최근 252일(당일 포함) 내 ≥ 2
//
// 각 조건은 "처음 되는 날"(상향 전이) + 63거래일 중복제거로 이벤트화(scanCrossingEvents).
// 나머지 이벤트 스터디는 batch2Common(=D2 파이프라인 재사용).
//
// 규칙: `any`·`console.*`·`Math.random` 금지. 순수 로직.
// ---------------------------------------------------------------------------

import type { SecurityBars } from './configTypes';
import { CONST } from './configTypes';
import type { LectureDataset, RegimeSeries } from './dataAccess';
import { realizedVol } from './features';
import type { IndexLevelLookup } from './forwardReturns';
import type { SamplePeriod } from './configTypes';
import {
  CrossSectionCache,
  makeControlForwardCache,
  runBatch2Signal,
  type Batch2SignalResult,
} from './batch2Common';
import { holmAdjust } from './eventStats';

export type DeteriorationCode =
  | 'H3_VOL_SPIKE_ROLLING'
  | 'H4_UPPER_WICK_CLUSTER'
  | 'H5_BOOM_BUST_REPEAT';

export const DETERIORATION_CODES: readonly DeteriorationCode[] = [
  'H3_VOL_SPIKE_ROLLING',
  'H4_UPPER_WICK_CLUSTER',
  'H5_BOOM_BUST_REPEAT',
];

export const DETERIORATION_CONST = {
  h3Window: 20,
  h3BaselineWindow: 63,
  h3Multiple: 1.5,
  h4Window: 60,
  h4WickThreshold: 0.05,
  h4CountThreshold: 5, // "5회 초과" → count > 5 (즉 ≥6)
  h5Window: 252,
  h5UpMultiple: 1.5, // 러닝저점 대비 +50%
  h5DownMultiple: 0.7, // 러닝고점 대비 -30%
  h5CycleThreshold: 2, // 완료 사이클 ≥ 2
  dedupHorizon: 63,
  primaryHorizon: 63,
} as const;

// ===========================================================================
// H3 — 롤링 변동성 급등
// ===========================================================================

/** H3 변동성비 = realizedVol(close,i,20) / realizedVol(close,i,63). 둘 중 하나라도 null이면 null. */
export function h3VolRatio(close: readonly number[], i: number): number | null {
  const v20 = realizedVol(close, i, DETERIORATION_CONST.h3Window);
  const v63 = realizedVol(close, i, DETERIORATION_CONST.h3BaselineWindow);
  if (v20 === null || v63 === null || !(v63 > 0)) return null;
  return v20 / v63;
}

/** H3 조건: 변동성비 ≥ 1.5. null이면 null(판정불가). */
export function h3ConditionAt(close: readonly number[], i: number): boolean | null {
  const r = h3VolRatio(close, i);
  if (r === null) return null;
  return r >= DETERIORATION_CONST.h3Multiple;
}

// ===========================================================================
// H4 — 윗꼬리 군집
// ===========================================================================

/** 윗꼬리 날 판정: (adjHigh-adjClose)/adjHigh ≥ 5%. adjHigh<=0이면 false. */
export function isUpperWickDay(bars: SecurityBars, t: number): boolean {
  const hi = bars.adjHigh[t];
  const cl = bars.adjClose[t];
  if (!(hi > 0)) return false;
  return (hi - cl) / hi >= DETERIORATION_CONST.h4WickThreshold;
}

/** 최근 window일(당일 i 포함, [i-window+1, i]) 윗꼬리 날 수. 창 부족이면 null. */
export function upperWickCount(
  bars: SecurityBars,
  i: number,
  window: number = DETERIORATION_CONST.h4Window
): number | null {
  const start = i - window + 1;
  if (start < 0) return null;
  let c = 0;
  for (let t = start; t <= i; t++) if (isUpperWickDay(bars, t)) c++;
  return c;
}

/** H4 조건: 최근 60일 윗꼬리 날 수 > 5 (즉 ≥6). */
export function h4ConditionAt(bars: SecurityBars, i: number): boolean | null {
  const c = upperWickCount(bars, i);
  if (c === null) return null;
  return c > DETERIORATION_CONST.h4CountThreshold;
}

// ===========================================================================
// H5 — 붐버스트 반복(비미래참조 상태기계)
// ===========================================================================

/**
 * 붐버스트 상태기계(§8.1 H5). close 전 구간을 앞에서부터 1회 통과하며 완료 사이클의 bar index를 수집.
 *   SEEK_UP  : 러닝저점 추적. close ≥ 러닝저점×1.5 → SEEK_DOWN 전환(러닝고점=현재가).
 *   SEEK_DOWN: 러닝고점 추적. close ≤ 러닝고점×0.7 → 1사이클 완료(그날 index 기록), 현재일부터 새 SEEK_UP.
 * 미래참조 없음(현재·과거 종가만). 반환은 완료일 index 오름차순 배열.
 */
export function boomBustCompletions(close: readonly number[]): number[] {
  const out: number[] = [];
  const n = close.length;
  if (n === 0) return out;
  let phase: 'UP' | 'DOWN' = 'UP';
  let runLow = close[0];
  let runHigh = close[0];
  for (let t = 0; t < n; t++) {
    const c = close[t];
    if (!(c > 0)) continue;
    if (phase === 'UP') {
      if (c < runLow) runLow = c;
      if (c >= runLow * DETERIORATION_CONST.h5UpMultiple) {
        phase = 'DOWN';
        runHigh = c;
      }
    } else {
      if (c > runHigh) runHigh = c;
      if (c <= runHigh * DETERIORATION_CONST.h5DownMultiple) {
        out.push(t); // 사이클 완료
        phase = 'UP';
        runLow = c; // 현재일부터 새 사이클
      }
    }
  }
  return out;
}

/** 최근 window일(당일 i 포함, [i-window+1, i]) 내 완료 사이클 수. completions는 오름차순. */
export function boomBustCountAt(
  completions: readonly number[],
  i: number,
  window: number = DETERIORATION_CONST.h5Window
): number {
  const lo = i - window + 1;
  let c = 0;
  for (const t of completions) {
    if (t >= lo && t <= i) c++;
    else if (t > i) break;
  }
  return c;
}

/** H5 조건 팩토리(종목 단위로 상태기계를 1회만 돌리고 인덱스에서 count). */
export function makeH5Condition(close: readonly number[]): (i: number) => boolean | null {
  const completions = boomBustCompletions(close);
  return (i: number): boolean | null => {
    // 최근 252일 창을 다 관측하려면 i ≥ window-1 (당일 포함 창). 그전엔 판정불가로 두어
    // 웜업 경계에서 부분창 오탐을 막는다.
    if (i < DETERIORATION_CONST.h5Window - 1) return null;
    return boomBustCountAt(completions, i) >= DETERIORATION_CONST.h5CycleThreshold;
  };
}

// ===========================================================================
// condFactory (batch2Common 주입용)
// ===========================================================================

export function deteriorationCondFactory(
  code: DeteriorationCode
): (bars: SecurityBars) => (i: number) => boolean | null {
  return (bars: SecurityBars) => {
    switch (code) {
      case 'H3_VOL_SPIKE_ROLLING':
        return (i: number) => h3ConditionAt(bars.adjClose, i);
      case 'H4_UPPER_WICK_CLUSTER':
        return (i: number) => h4ConditionAt(bars, i);
      case 'H5_BOOM_BUST_REPEAT':
        return makeH5Condition(bars.adjClose);
      default:
        return () => null;
    }
  };
}

// ===========================================================================
// 실행 (한 표본기간 3신호 + Holm)
// ===========================================================================

export interface DeteriorationFamilyResult {
  period: SamplePeriod['name'];
  bySignal: Batch2SignalResult[];
  holmAdjustedP: Record<string, number>;
}

export function runDeteriorationFamily(
  ds: LectureDataset,
  regime: RegimeSeries,
  index: IndexLevelLookup,
  period: SamplePeriod
): DeteriorationFamilyResult {
  const csCache = new CrossSectionCache(ds, CONST.liquidityMainMinAmountKRW);
  const controlFwd = makeControlForwardCache(ds, index);
  const bySignal: Batch2SignalResult[] = [];
  let seed = CONST.masterSeed + 20000;
  for (const code of DETERIORATION_CODES) {
    bySignal.push(
      runBatch2Signal(
        code,
        ds,
        regime,
        index,
        period,
        csCache,
        controlFwd,
        deteriorationCondFactory(code),
        DETERIORATION_CONST.dedupHorizon,
        DETERIORATION_CONST.primaryHorizon,
        seed
      )
    );
    seed += 100;
  }
  const ps = bySignal.map((s) => s.primaryBootstrapMedian.pValue);
  const adj = holmAdjust(ps);
  const holmAdjustedP: Record<string, number> = {};
  bySignal.forEach((s, k) => (holmAdjustedP[s.signal] = adj[k]));
  return { period: period.name, bySignal, holmAdjustedP };
}
