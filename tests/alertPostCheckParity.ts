// tests/alertPostCheckParity.ts
// ---------------------------------------------------------------------------
// scripts/backtest/alertPostCheck/simulate.ts 골든 테스트 — "알림대로 했다면" 전 과정(매도 신호 → 체결 → 현금 대기 →
// 55일 재진입 신호 → 재매수) 간이 추정. 명시적 절대값만 고정한다(RULES §13 — 경로A-vs-경로B 비교 금지).
//
// 특히 ④ "실제 알림 수신 이후 체결 기준": 2026-09~10월 실제 카톡은 신호가 하루 늦게 도착했다. 그 알림을 받고
// 다음 거래일 시가에 주문하면 체결은 "신호 봉 + 2거래일" 시가다(execDelay=2). 이상적 경우(신호 다음 거래일,
// execDelay=1)와 결과가 어떻게 갈리는지 손계산 값으로 고정한다.
//
// 실행: npx tsx tests/alertPostCheckParity.ts

import { DEFAULT_TURTLE_HOLDINGS_SETTINGS } from '../types/turtleHoldings';
import type { DailyBar } from '../utils/todayTurtle';
import { simulateAlertPath } from '../scripts/backtest/alertPostCheck/simulate';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function near(name: string, actual: number | null, expected: number, eps = 1e-9): void {
  if (actual !== null && Math.abs(actual - expected) <= eps) pass++; else fails.push(`✗ ${name}: got ${actual}, expected ${expected}`);
}

function iso(i: number): string {
  return new Date(Date.parse('2026-01-01T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10);
}
const S = DEFAULT_TURTLE_HOLDINGS_SETTINGS; // 청산 20일 최저가 · 재진입 55일 최고가

// 0~59: 평탄(고110·저100·시종105) → 청산선 100, 재진입선 110
// 60: 종가 99 ≤ 청산선 100 → 매도 신호 / 61·62: 더 하락 / 63: 종가 111 ≥ 재진입선 110 → 재진입 신호 / 64: 상승
const bars: DailyBar[] = [];
for (let i = 0; i < 60; i++) bars.push({ date: iso(i), open: 105, high: 110, low: 100, close: 105 });
bars.push({ date: iso(60), open: 104, high: 105, low: 95, close: 99 });
bars.push({ date: iso(61), open: 98, high: 99, low: 94, close: 95 });
bars.push({ date: iso(62), open: 96, high: 97, low: 90, close: 92 });
bars.push({ date: iso(63), open: 93, high: 112, low: 92, close: 111 });
bars.push({ date: iso(64), open: 113, high: 116, low: 112, close: 115 });
const START = iso(59); // 알림이 처음 가능했던 시점 = 59번 봉
const QTY = 10;

// ════════════════════════════════════════════════════════════════════════════
// 1. 이상적 체결(신호 다음 거래일 시가, execDelay=1)
// ════════════════════════════════════════════════════════════════════════════
{
  const r = simulateAlertPath(bars, QTY, { settings: S, startOnOrBefore: START, execDelay: 1 });
  check('d1 status', r.status, 'ok');
  check('d1 첫 신호일 = 60번 봉', r.firstSignalDate, iso(60));
  check('d1 이벤트 순서', r.events.map(e => `${e.kind}@${e.date}:${e.price}`), [
    `signal-sell@${iso(60)}:99`, `sell@${iso(61)}:98`, `signal-buy@${iso(63)}:111`, `buy@${iso(64)}:113`,
  ]);
  check('d1 매도 신호의 청산선 = 100', r.events[0].line, 100);
  check('d1 재진입 신호선 = 110', r.events[2].line, 110);
  check('d1 첫 매도가 = 61번 봉 시가 98', r.firstSellPrice, 98);
  check('d1 매도 후 최저 종가 = 92', r.minCloseAfterSell, 92);
  check('d1 끝 상태 = 다시 보유', r.endState, 'holding');
  near('d1 알림대로 가치 = 980/113×115', r.turtleValueOrig, 112_700 / 113);
  check('d1 그대로 보유 가치 = 10×115', r.holdValueOrig, 1150);
  check('d1 현재 재진입 기준선 = 직전 55봉 최고가 112', r.reentryBaselineNow, 112);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. ④ 실제 알림 수신 이후 체결(하루 늦게 받은 알림 → 그다음 거래일 시가, execDelay=2)
// ════════════════════════════════════════════════════════════════════════════
{
  const r = simulateAlertPath(bars, QTY, { settings: S, startOnOrBefore: START, execDelay: 2 });
  check('d2 이벤트 — 62번 봉 시가 96에 매도, 재진입 신호는 마지막 봉까지 체결 못 함', r.events.map(e => `${e.kind}@${e.date}`), [
    `signal-sell@${iso(60)}`, `sell@${iso(62)}`, `signal-buy@${iso(63)}`, `signal-buy@${iso(64)}`,
  ]);
  check('d2 첫 매도가 = 96(이상적 98보다 2 낮음)', r.firstSellPrice, 96);
  check('d2 끝 상태 = 현금', r.endState, 'cash');
  check('d2 알림대로 가치 = 현금 960', r.turtleValueOrig, 960);
  check('d2 매도 후 최저 종가 = 92', r.minCloseAfterSell, 92);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 경계 — 신호 없음 / 봉 부족 / 자료 없음
// ════════════════════════════════════════════════════════════════════════════
{
  const flat = bars.slice(0, 60);
  const r = simulateAlertPath(flat, QTY, { settings: S, startOnOrBefore: START, execDelay: 1 });
  check('신호 없음 → never-sold', r.endState, 'never-sold');
  check('신호 없음 → 알림대로 = 그대로 보유 = 1050', [r.turtleValueOrig, r.holdValueOrig], [1050, 1050]);
  check('신호 없음 → 이벤트 0건', r.events.length, 0);

  const early = simulateAlertPath(bars, QTY, { settings: S, startOnOrBefore: iso(10), execDelay: 1 });
  check('시작 전 봉이 청산 기간(20)보다 적음 → insufficient', early.status, 'insufficient');

  const none = simulateAlertPath([], QTY, { settings: S, startOnOrBefore: START, execDelay: 1 });
  check('자료 없음 → no-data', none.status, 'no-data');
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ alertPostCheck parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ alertPostCheck parity 전체 통과 (${pass} 단언)`);
