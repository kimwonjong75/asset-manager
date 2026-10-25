// scripts/backtest/alertPostCheck/simulate.ts
// "알림대로 했다면" 전 과정 시뮬레이션 — 순수 함수(파일·네트워크 없음). run.ts와 tests/alertPostCheckParity.ts가 공유한다.
// 매도 신호(앱과 같은 청산선 판정) → execDelay번째 다음 봉 시가 매도 → 현금 대기 → 55일 재진입 신호 →
// execDelay번째 다음 봉 시가 재매수 → 다시 청산선 … 을 일봉 위에서 그대로 따라간다.
// 간이 추정이다: 재매수분 2N 손절·매수금액 제한(종목 한도·유닛 사이징)·수수료·세금·현금 이자는 반영하지 않는다
// (재매수 = 판 돈 전액). 실제 앱 운용의 재매수 수량과 다를 수 있다.

import { computeExitLine, computeReentryLine, evaluateLegacyHoldingsStatus } from '../../../utils/turtleHoldings';
import type { TurtleHoldingsSettings } from '../../../types/turtleHoldings';
import type { DailyBar } from '../../../utils/todayTurtle';

export interface TurtleEvent { kind: 'signal-sell' | 'sell' | 'signal-buy' | 'buy'; date: string; price: number; line?: number }

export interface PathResult {
  status: 'ok' | 'no-data' | 'insufficient';
  firstSignalDate: string | null;
  events: TurtleEvent[];
  endState: 'holding' | 'cash' | 'never-sold';
  turtleValueOrig: number; holdValueOrig: number;
  lastClose: number | null; lastDate: string | null;
  firstSellPrice: number | null; minCloseAfterSell: number | null;
  reentryBaselineNow: number | null;
}

export interface SimulateOptions {
  settings: TurtleHoldingsSettings;
  /** 판정 시작 봉 = 이 날짜 이하의 마지막 봉(알림이 처음 가능했던 시점). */
  startOnOrBefore: string;
  /**
   * 신호 봉 다음 몇 번째 봉의 시가에 체결하나.
   * 1 = 다음 거래일 시가(신호를 그날 밤·다음 날 아침에 알았다고 가정).
   * 2 = 그다음 거래일 시가 — 2026-09~10월 실제 카톡처럼 신호가 하루 늦게 도착해 받은 뒤 다음 거래일에 주문한 경우.
   */
  execDelay: number;
}

export function simulateAlertPath(bars: readonly DailyBar[], qty: number, opts: SimulateOptions): PathResult {
  const { settings, startOnOrBefore, execDelay } = opts;
  const empty: PathResult = {
    status: 'no-data', firstSignalDate: null, events: [], endState: 'never-sold', turtleValueOrig: 0, holdValueOrig: 0,
    lastClose: null, lastDate: null, firstSellPrice: null, minCloseAfterSell: null, reentryBaselineNow: null,
  };
  if (bars.length === 0) return empty;
  let start = -1;
  for (let i = 0; i < bars.length; i++) if (bars[i].date <= startOnOrBefore) start = i;
  if (start < settings.exitLookback) return { ...empty, status: 'insufficient' };

  let state: 'holding' | 'cash' = 'holding';
  let units = qty;
  let cash = 0;
  let firstSignalDate: string | null = null;
  let firstSellPrice: number | null = null;
  let minCloseAfterSell: number | null = null;
  const events: TurtleEvent[] = [];
  const last = bars.length - 1;
  // 체결 대기: 신호 봉 i → 체결 봉 i+execDelay. 대기 중에는 새 판정을 하지 않는다(주문 한 번 = 신호 한 번).
  let pending: { kind: 'sell' | 'buy'; at: number } | null = null;
  for (let i = start; i <= last; i++) {
    if (pending && pending.at === i) {
      const px = bars[i].open;
      if (pending.kind === 'sell') {
        cash = units * px; units = 0; state = 'cash';
        events.push({ kind: 'sell', date: bars[i].date, price: px });
        firstSellPrice ??= px;
      } else {
        units = cash / px; cash = 0; state = 'holding';
        events.push({ kind: 'buy', date: bars[i].date, price: px });
      }
      pending = null;
    }
    const sub = bars.slice(0, i + 1);
    const close = bars[i].close;
    if (firstSellPrice !== null) minCloseAfterSell = minCloseAfterSell === null ? close : Math.min(minCloseAfterSell, close);
    if (pending) continue;
    if (state === 'holding') {
      const exitLine = computeExitLine({ bars: sub, settings });
      if (evaluateLegacyHoldingsStatus(close, exitLine) === 'sell-check') {
        events.push({ kind: 'signal-sell', date: bars[i].date, price: close, line: exitLine ?? undefined });
        firstSignalDate ??= bars[i].date;
        if (i + execDelay <= last) pending = { kind: 'sell', at: i + execDelay };
      }
    } else {
      const line = computeReentryLine(sub, settings);
      if (line !== null && close >= line) {
        events.push({ kind: 'signal-buy', date: bars[i].date, price: close, line });
        if (i + execDelay <= last) pending = { kind: 'buy', at: i + execDelay };
      }
    }
  }
  const lastClose = bars[last].close;
  const soldEver = events.some(e => e.kind === 'sell');
  return {
    status: 'ok', firstSignalDate, events,
    endState: !soldEver ? 'never-sold' : state === 'cash' ? 'cash' : 'holding',
    turtleValueOrig: cash + units * lastClose, holdValueOrig: qty * lastClose,
    lastClose, lastDate: bars[last].date, firstSellPrice, minCloseAfterSell,
    reentryBaselineNow: computeReentryLine(bars, settings),
  };
}
