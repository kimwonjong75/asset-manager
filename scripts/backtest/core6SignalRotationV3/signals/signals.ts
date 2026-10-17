// scripts/backtest/core6SignalRotationV3/signals/signals.ts
// 코어 6종 신호 로테이션 V3 — 신호 6종(§8). 순수 함수: 비중·포트폴리오 상태를 받지 않는다(§16-11 자동 보장).
//
// 약속
//  - '완료봉' = fresh=true 이고 source!='absent' 이고 고/저/종가가 모두 숫자인 행. fresh=false 행은
//    지표 창·워밍업·이벤트로 세지 않고 상태(active/valid/atr20)를 이월한다(이벤트는 false).
//  - source='absent' 행은 valid=false, atr20=null, active=true(최초 상태), 이벤트 false.
//  - 인덱스 i의 모든 값은 i일 종가 확정 후 상태다. 체결(i+1 시가)은 포트폴리오 모듈 책임.
//  - 상태기계: 최초 상태 active. active에서만 매도 판정, inactive에서만 재진입 판정 → 같은 날 동시 발생 없음.
//    valid=false 구간은 active=true, 이벤트 false로 고정하고 첫 valid 완료봉부터 상태기계를 시작한다.

import type { AssetBars, SignalRuleId, SignalSeries } from '../types';

const REENTRY_LOOKBACK = 55;
const ATR_PERIOD = 20;
const ATR_MULTIPLE = 3;

/**
 * 규칙이 유효해지기 전에 필요한 직전 완료봉 수(= 첫 valid 완료봉의 0-기반 순번).
 *  - D*/55·ATR3/55: 55 — 재진입 채널(직전 55개)이 항상 필요(매도 채널이 10/20이어도 동일). ATR3/55는 ATR20(순번 20부터 유효)도 55에 포함된다.
 *  - MA20: 20 — 21번째 완료봉에서 SMA20(20개)과 직전 SMA20(직전 봉 기준 20개)이 모두 계산된다.
 *  - MA50: 50 — 51번째 완료봉부터.
 */
export function warmupBars(rule: SignalRuleId): number {
  switch (rule) {
    case 'D10/55':
    case 'D20/55':
    case 'D55/55':
    case 'ATR3/55':
      return REENTRY_LOOKBACK;
    case 'MA20':
      return 20;
    case 'MA50':
      return 50;
  }
}

function donchianSellLookback(rule: SignalRuleId): number | null {
  if (rule === 'D10/55') return 10;
  if (rule === 'D20/55') return 20;
  if (rule === 'D55/55') return 55;
  return null;
}

function smaPeriod(rule: SignalRuleId): number | null {
  if (rule === 'MA20') return 20;
  if (rule === 'MA50') return 50;
  return null;
}

/** 완료봉만 모은 압축 배열(원래 인덱스 보존). */
interface Completed {
  idx: number[];
  high: number[];
  low: number[];
  close: number[];
}

function isNum(v: number | null): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function collectCompleted(bars: AssetBars): Completed {
  const c: Completed = { idx: [], high: [], low: [], close: [] };
  const n = bars.close.length;
  for (let i = 0; i < n; i++) {
    if (!bars.fresh[i] || bars.source[i] === 'absent') continue;
    const h = bars.high[i];
    const l = bars.low[i];
    const cl = bars.close[i];
    if (!isNum(h) || !isNum(l) || !isNum(cl)) continue;
    c.idx.push(i);
    c.high.push(h);
    c.low.push(l);
    c.close.push(cl);
  }
  return c;
}

/** 압축 순번 k의 Wilder ATR20. k<20이면 null. 첫 값(k=20)은 TR_1..TR_20의 산술평균. */
function wilderAtr(c: Completed): (number | null)[] {
  const n = c.close.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (n <= ATR_PERIOD) return out;
  const tr = (k: number): number => {
    const prevClose = c.close[k - 1];
    return Math.max(c.high[k] - c.low[k], Math.abs(c.high[k] - prevClose), Math.abs(c.low[k] - prevClose));
  };
  let sum = 0;
  for (let k = 1; k <= ATR_PERIOD; k++) sum += tr(k);
  let atr = sum / ATR_PERIOD;
  out[ATR_PERIOD] = atr;
  for (let k = ATR_PERIOD + 1; k < n; k++) {
    atr = ((ATR_PERIOD - 1) * atr + tr(k)) / ATR_PERIOD;
    out[k] = atr;
  }
  return out;
}

/** 직전 count개 완료봉(순번 k-count..k-1)의 최솟값/최댓값. */
function priorMin(arr: number[], k: number, count: number): number {
  let m = Infinity;
  for (let j = k - count; j < k; j++) if (arr[j] < m) m = arr[j];
  return m;
}
function priorMax(arr: number[], k: number, count: number): number {
  let m = -Infinity;
  for (let j = k - count; j < k; j++) if (arr[j] > m) m = arr[j];
  return m;
}
/** 순번 k를 포함한 최근 p개 완료봉 종가의 산술평균. */
function sma(close: number[], k: number, p: number): number {
  let s = 0;
  for (let j = k - p + 1; j <= k; j++) s += close[j];
  return s / p;
}

export function computeSignals(bars: AssetBars, rule: SignalRuleId): SignalSeries {
  const n = bars.close.length;
  if (bars.high.length !== n || bars.low.length !== n || bars.open.length !== n || bars.fresh.length !== n || bars.source.length !== n) {
    throw new Error(`computeSignals(${bars.code}): AssetBars 배열 길이가 서로 다릅니다.`);
  }

  const c = collectCompleted(bars);
  const atrC = wilderAtr(c);
  const warmup = warmupBars(rule);
  const sellN = donchianSellLookback(rule);
  const maP = smaPeriod(rule);

  const valid: boolean[] = new Array(n).fill(false);
  const active: boolean[] = new Array(n).fill(true);
  const sellEvent: boolean[] = new Array(n).fill(false);
  const reentryEvent: boolean[] = new Array(n).fill(false);
  const atr20: (number | null)[] = new Array(n).fill(null);

  // 압축 순번 → 원래 인덱스 처리. 비완료 행은 아래 이월 루프에서 채운다.
  const completedAt = new Map<number, number>();
  c.idx.forEach((orig, k) => completedAt.set(orig, k));

  let state = true; // active
  let runningHigh = 0; // ATR 규칙 전용
  let trail = -Infinity;
  let lastValid = false;
  let lastAtr: number | null = null;

  for (let i = 0; i < n; i++) {
    const k = completedAt.get(i);
    if (k === undefined) {
      // 비완료 행: 상태 이월, 이벤트 없음. absent는 valid=false·atr=null로 끊는다.
      if (bars.source[i] === 'absent') {
        valid[i] = false;
        atr20[i] = null;
      } else {
        valid[i] = lastValid;
        atr20[i] = lastAtr;
      }
      active[i] = state;
      continue;
    }

    atr20[i] = atrC[k];
    lastAtr = atrC[k];
    const isValid = k >= warmup;
    valid[i] = isValid;
    lastValid = isValid;
    if (!isValid) {
      active[i] = true; // 워밍업 중에는 최초 상태 고정
      continue;
    }

    const close = c.close[k];
    let sell = false;
    let reentry = false;

    if (sellN !== null) {
      if (state) sell = close <= priorMin(c.low, k, sellN);
      else reentry = close >= priorMax(c.high, k, REENTRY_LOOKBACK);
    } else if (maP !== null) {
      const smaNow = sma(c.close, k, maP);
      const smaPrev = sma(c.close, k - 1, maP);
      const prevClose = c.close[k - 1];
      if (state) sell = close <= smaNow && prevClose > smaPrev;
      else reentry = close >= smaNow && prevClose < smaPrev;
    } else {
      // ATR3/55
      const atr = atrC[k];
      if (state) {
        if (k === warmup) {
          // 첫 valid일 — 최초 active의 진입일 고가에서 시작
          runningHigh = c.high[k];
          trail = -Infinity;
        } else if (c.high[k] > runningHigh) {
          runningHigh = c.high[k];
        }
        if (atr !== null) {
          const cand = runningHigh - ATR_MULTIPLE * atr;
          if (cand > trail) trail = cand;
        }
        sell = close <= trail;
      } else {
        reentry = close >= priorMax(c.high, k, REENTRY_LOOKBACK);
        if (reentry) {
          // 재진입일 D의 고가에서 새로 시작(당일에는 매도 판정 없음)
          runningHigh = c.high[k];
          trail = atr !== null ? runningHigh - ATR_MULTIPLE * atr : -Infinity;
        }
      }
    }

    if (sell) {
      state = false;
      sellEvent[i] = true;
    } else if (reentry) {
      state = true;
      reentryEvent[i] = true;
    }
    active[i] = state;
  }

  return { rule, code: bars.code, valid, active, sellEvent, reentryEvent, atr20 };
}
