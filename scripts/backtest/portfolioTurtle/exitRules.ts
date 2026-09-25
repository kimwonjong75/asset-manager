// scripts/backtest/portfolioTurtle/exitRules.ts
// 순수 함수 — 청산 후보 W1~W4 판정. 보유분(HOLD_INITIAL)·재매수분(HOLD_REENTERED) 공통으로 쓴다.
// W1/W2=도치안(당일 제외) · W3=ATR 트레일링(래칫, 상태 필요) · W4=SMA50(당일 포함, movingAverage.ts 관례).

import type { ExitRuleConfig } from './configTypes';
import type { PortfolioSecurity } from './data';

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** W3 전용 상태 — 진입(보유분은 시작일, 재매수분은 체결일)부터 누적하는 최고 종가/트레일선. */
export interface TrailState {
  runningHigh: number;
  trailStop: number;
}

/** 진입일(own idx)의 고가로 트레일 상태를 초기화한다. */
export function initTrailState(sec: PortfolioSecurity, entryOwnIdx: number, multiple: number): TrailState {
  const h = sec.ownHigh[entryOwnIdx];
  const c = sec.ownClose[entryOwnIdx];
  const runningHigh = isNum(h) ? h : (isNum(c) ? c : 0);
  const n = sec.atr[entryOwnIdx];
  const trailStop = isNum(n) ? runningHigh - multiple * n : -Infinity;
  return { runningHigh, trailStop };
}

/** 매일 갱신 — 최고가는 상향만, 트레일선은 하향 금지(래칫). */
export function updateTrailState(state: TrailState, sec: PortfolioSecurity, ownIdx: number, multiple: number): TrailState {
  const h = sec.ownHigh[ownIdx];
  const newHigh = isNum(h) && h > state.runningHigh ? h : state.runningHigh;
  const n = sec.atr[ownIdx];
  let newTrail = state.trailStop;
  if (isNum(n)) {
    const candidate = newHigh - multiple * n;
    if (candidate > newTrail) newTrail = candidate;
  }
  return { runningHigh: newHigh, trailStop: newTrail };
}

/**
 * 오늘(ownIdx) 청산 신호 여부(D일 종가 기준). W3는 그날 갱신된 trail(업데이트 후 상태)을 넘겨야 한다.
 */
export function checkExitSignal(
  rule: ExitRuleConfig, sec: PortfolioSecurity, ownIdx: number, trail: TrailState | null
): boolean {
  const close = sec.ownClose[ownIdx];
  if (!isNum(close)) return false;
  if (rule.method === 'donchian') {
    const arr = rule.lookback === 20 ? sec.lowChannel20 : rule.lookback === 55 ? sec.lowChannel55 : null;
    if (!arr) throw new Error(`checkExitSignal: 지원하지 않는 도치안 lookback ${rule.lookback}`);
    const v = arr[ownIdx];
    return isNum(v) && close <= v;
  }
  if (rule.method === 'atrTrailing') {
    if (!trail) return false;
    return close <= trail.trailStop;
  }
  // smaCross
  const v = sec.sma50[ownIdx];
  return isNum(v) && close <= v;
}

/** 재진입(신규 매수) 신호 — 55일 신고가 돌파, 청산 방식과 무관하게 고정. */
export function checkEntrySignal(sec: PortfolioSecurity, ownIdx: number): boolean {
  const close = sec.ownClose[ownIdx];
  const hi = sec.highChannel55[ownIdx];
  return isNum(close) && isNum(hi) && close >= hi;
}

/** 이 청산 방식·이 날짜에 워밍업(지표 유효)이 끝났는지. */
export function isWarmedUp(rule: ExitRuleConfig, sec: PortfolioSecurity, ownIdx: number): boolean {
  if (ownIdx < 0 || ownIdx >= sec.ownDates.length) return false;
  if (!isNum(sec.atr[ownIdx])) return false;               // 재진입 2N 손절·W3에 공통 필요
  if (!isNum(sec.highChannel55[ownIdx])) return false;      // 재진입 채널
  if (rule.method === 'donchian') {
    const arr = rule.lookback === 20 ? sec.lowChannel20 : sec.lowChannel55;
    if (!isNum(arr[ownIdx])) return false;
  } else if (rule.method === 'smaCross') {
    if (!isNum(sec.sma50[ownIdx])) return false;
  }
  return true;
}
