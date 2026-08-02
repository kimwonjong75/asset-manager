// scripts/backtest/lectureSignals/launchpad.ts
// ---------------------------------------------------------------------------
// 보조 트랙 — 런치패드 / MA 수렴 돌파 (§10). 매수 가설(방향 양수):
//   MA20·MA60·MA150 수렴 상태에서 직전 20일 고점을 거래량 2배와 함께 상향 돌파한 종목은
//   대조군보다 126일 시장초과수익이 높다.
//
// 수렴 정의(계획서 미확정 → 사전 고정·명시):
//   maCompression = (max(MA20,MA60,MA150) − min(MA20,MA60,MA150)) / adjClose × 100  (앱 산식 동일)
//   수렴 = maCompression ≤ 임계(주결론 5%, 민감도 3%/7%).
//   **평가 시점: 돌파 직전일 D-1**(수렴 "상태에서" 돌파 — 돌파 당일 급등 종가가 분모를 부풀려
//   수렴을 인위적으로 통과시키는 것을 방지). 계획서 이탈/사전고정 항목으로 문서에 명시.
//
// 돌파(당일 D): adjClose[D] > max(adjHigh[D-20..D-1])  AND  adjVolume[D] ≥ 2 × mean(adjVolume[D-20..D-1]).
//
// 이벤트화: "처음 되는 날"(상향 전이) + 126거래일(주호라이즌) 중복제거. 이벤트 스터디는 batch2Common.
//
// 규칙: `any`·`console.*`·`Math.random` 금지. 순수 로직.
// ---------------------------------------------------------------------------

import type { SamplePeriod, SecurityBars } from './configTypes';
import { CONST } from './configTypes';
import type { LectureDataset, RegimeSeries } from './dataAccess';
import { priorMean, smaInclusive } from './features';
import type { IndexLevelLookup } from './forwardReturns';
import {
  CrossSectionCache,
  makeControlForwardCache,
  runBatch2Signal,
  type Batch2SignalResult,
} from './batch2Common';

export const LAUNCHPAD_CONST = {
  maShort: 20,
  maMid: 60,
  maLong: 150,
  breakoutHighWindow: 20,
  volWindow: 20,
  volMultiple: 2,
  compressionMainPct: 5,
  compressionSensitivityPct: [3, 7] as const,
  dedupHorizon: 126,
  primaryHorizon: 126,
  minEventsRequired: 100, // §10.3
} as const;

/** 신호 코드(임계값별). */
export type LaunchpadCode = 'LAUNCHPAD_C5' | 'LAUNCHPAD_C3' | 'LAUNCHPAD_C7';

export const LAUNCHPAD_CODES: readonly LaunchpadCode[] = [
  'LAUNCHPAD_C5',
  'LAUNCHPAD_C3',
  'LAUNCHPAD_C7',
];

export function launchpadThresholdPct(code: LaunchpadCode): number {
  return code === 'LAUNCHPAD_C3' ? 3 : code === 'LAUNCHPAD_C7' ? 7 : 5;
}

/**
 * maCompression(%) = (max−min of MA20/MA60/MA150) / adjClose × 100. 세 MA 중 하나라도 창부족이면 null.
 */
export function maCompressionPct(close: readonly number[], i: number): number | null {
  const m20 = smaInclusive(close, i, LAUNCHPAD_CONST.maShort);
  const m60 = smaInclusive(close, i, LAUNCHPAD_CONST.maMid);
  const m150 = smaInclusive(close, i, LAUNCHPAD_CONST.maLong);
  if (m20 === null || m60 === null || m150 === null) return null;
  const px = close[i];
  if (!(px > 0)) return null;
  const mx = Math.max(m20, m60, m150);
  const mn = Math.min(m20, m60, m150);
  return ((mx - mn) / px) * 100;
}

/** 직전 window일(당일 제외, [i-window, i-1]) adjHigh 최대. 창부족이면 null. */
export function priorHigh(bars: SecurityBars, i: number, window = LAUNCHPAD_CONST.breakoutHighWindow): number | null {
  const start = i - window;
  if (start < 0) return null;
  let mx = -Infinity;
  for (let t = start; t <= i - 1; t++) if (bars.adjHigh[t] > mx) mx = bars.adjHigh[t];
  return Number.isFinite(mx) ? mx : null;
}

/** 돌파 판정(당일 D): 종가 > 직전20일 고점 AND 거래량 ≥ 2×직전20일 평균. 창부족이면 null. */
export function isBreakoutAt(bars: SecurityBars, i: number): boolean | null {
  const ph = priorHigh(bars, i);
  if (ph === null) return null;
  const volBase = priorMean(bars.adjVolume, i, LAUNCHPAD_CONST.volWindow);
  if (volBase === null || volBase <= 0) return null;
  const priceBreak = bars.adjClose[i] > ph;
  const volBreak = bars.adjVolume[i] >= LAUNCHPAD_CONST.volMultiple * volBase;
  return priceBreak && volBreak;
}

/**
 * 런치패드 조건: 수렴(D-1) AND 돌파(D). 판정불가(웜업)면 null.
 *   수렴은 돌파 직전일 D-1의 maCompression으로 평가(사전 고정).
 */
export function launchpadConditionAt(
  bars: SecurityBars,
  i: number,
  thresholdPct: number
): boolean | null {
  if (i < 1) return null;
  const comp = maCompressionPct(bars.adjClose, i - 1);
  if (comp === null) return null;
  if (!(comp <= thresholdPct)) return false;
  const br = isBreakoutAt(bars, i);
  if (br === null) return null;
  return br;
}

/**
 * 종목 단위 파생계열 메모(성능). 임계값 3종 × 표본 2구간 = 6회 스캔이 같은 종목에 대해
 * MA20/60/150·직전20일 고점·직전20일 평균거래량을 반복 계산하는 것을 막는다.
 * 값은 `maCompressionPct`·`isBreakoutAt`과 **정확히 동일**하다(같은 함수를 그대로 호출).
 */
interface LaunchpadSeries {
  comp: (number | null)[]; // maCompressionPct(i)
  brk: (boolean | null)[]; // isBreakoutAt(i)
}
const seriesMemo = new WeakMap<SecurityBars, LaunchpadSeries>();

export function launchpadSeriesOf(bars: SecurityBars): LaunchpadSeries {
  const hit = seriesMemo.get(bars);
  if (hit) return hit;
  const n = bars.dates.length;
  const comp: (number | null)[] = new Array(n);
  const brk: (boolean | null)[] = new Array(n);
  for (let i = 0; i < n; i++) {
    comp[i] = maCompressionPct(bars.adjClose, i);
    // 수렴이 절대 성립할 수 없는 구간(comp null)에서도 돌파는 독립적으로 필요하므로 모두 계산.
    brk[i] = isBreakoutAt(bars, i);
  }
  const s = { comp, brk };
  seriesMemo.set(bars, s);
  return s;
}

export function launchpadCondFactory(
  code: LaunchpadCode
): (bars: SecurityBars) => (i: number) => boolean | null {
  const thr = launchpadThresholdPct(code);
  return (bars: SecurityBars) => {
    const s = launchpadSeriesOf(bars);
    return (i: number): boolean | null => {
      if (i < 1) return null;
      const comp = s.comp[i - 1];
      if (comp === null || comp === undefined) return null;
      if (!(comp <= thr)) return false;
      const br = s.brk[i];
      if (br === null || br === undefined) return null;
      return br;
    };
  };
}

export interface LaunchpadFamilyResult {
  period: SamplePeriod['name'];
  bySignal: Batch2SignalResult[];
}

export function runLaunchpadFamily(
  ds: LectureDataset,
  regime: RegimeSeries,
  index: IndexLevelLookup,
  period: SamplePeriod
): LaunchpadFamilyResult {
  const csCache = new CrossSectionCache(ds, CONST.liquidityMainMinAmountKRW);
  const controlFwd = makeControlForwardCache(ds, index);
  const bySignal: Batch2SignalResult[] = [];
  let seed = CONST.masterSeed + 30000;
  for (const code of LAUNCHPAD_CODES) {
    bySignal.push(
      runBatch2Signal(
        code,
        ds,
        regime,
        index,
        period,
        csCache,
        controlFwd,
        launchpadCondFactory(code),
        LAUNCHPAD_CONST.dedupHorizon,
        LAUNCHPAD_CONST.primaryHorizon,
        seed
      )
    );
    seed += 100;
  }
  return { period: period.name, bySignal };
}
