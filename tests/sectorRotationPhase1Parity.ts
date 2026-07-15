// tests/sectorRotationPhase1Parity.ts
// Phase 1 현상검증 순수함수 골든값 패리티 테스트.
// 합성(수작업 구성) 데이터로 명시적 절대 골든값을 고정한다(패리티 규율:
// path-A-vs-path-B 자기참조가 아니라 손으로 계산한 절대값에 못 박는다).
// 실행: npx --yes tsx tests/sectorRotationPhase1Parity.ts

import type { AdjSeries } from '../scripts/backtest/sectorRotation/lib/yahooData';
import {
  truncateGaps,
  toMonthEnd,
  restrictToCommonMonths,
  capMonths,
} from '../scripts/backtest/sectorRotation/lib/monthly';
import type { MonthlyPanel } from '../scripts/backtest/sectorRotation/lib/monthly';
import {
  terciles,
  transitionMatrix,
  predictabilitySpread,
} from '../scripts/backtest/sectorRotation/lib/phenomenonStats';

let pass = 0;
let fail = 0;

function ok(cond: boolean, msg: string): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

function eqArr(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// 최소 AdjSeries 헬퍼(테스트 전용). close만 의미있게 채운다.
function mkSeries(dates: string[], close: (number | null)[]): AdjSeries {
  return {
    symbol: 'TEST',
    source: 'yahoo-v8',
    dates,
    adjOpen: close.slice(),
    adjHigh: close.slice(),
    adjLow: close.slice(),
    adjClose: close,
    volume: dates.map(() => 1),
    rawClose: close.slice(),
    ok: true,
  };
}

console.log('Phase 1 파리티 — 합성 골든값');
console.log('─'.repeat(60));

// ── 1. truncateGaps ───────────────────────────────────────────
// (a) 단일 800일급 갭: 앞쪽 고립점 폐기, 이후 연속구간만 유지.
{
  const s = mkSeries(
    ['2007-02-07', '2009-04-17', '2009-04-24', '2009-05-01'],
    [10, 20, 21, 22]
  );
  const t = truncateGaps(s);
  ok(t.dates.length === 3, `truncateGaps(a) length: got ${t.dates.length}, want 3`);
  ok(t.dates[0] === '2009-04-17', `truncateGaps(a) first: got ${t.dates[0]}, want 2009-04-17`);
  ok(t.adjClose[0] === 20, `truncateGaps(a) firstClose: got ${t.adjClose[0]}, want 20`);
}
// (b) 두 개의 큰 갭 → "마지막" 갭 이후만 유지.
{
  const s = mkSeries(
    ['2001-01-02', '2003-01-02', '2003-01-09', '2005-05-05', '2005-05-12'],
    [1, 2, 3, 4, 5]
  );
  const t = truncateGaps(s);
  ok(t.dates.length === 2, `truncateGaps(b) length: got ${t.dates.length}, want 2`);
  ok(t.dates[0] === '2005-05-05', `truncateGaps(b) first: got ${t.dates[0]}, want 2005-05-05`);
}
// (c) 갭 없음 → 원본 그대로.
{
  const s = mkSeries(['2020-01-10', '2020-01-20', '2020-01-30'], [1, 2, 3]);
  const t = truncateGaps(s);
  ok(t.dates.length === 3, `truncateGaps(c) length unchanged: got ${t.dates.length}, want 3`);
}

// ── 2. toMonthEnd ─────────────────────────────────────────────
// 각 달의 마지막 유효일. 2020-02-28 close=null → 2020-02 월말은 2020-02-05.
{
  const s = mkSeries(
    ['2020-01-10', '2020-01-31', '2020-02-05', '2020-02-28', '2020-03-02'],
    [100, 110, 120, null, 130]
  );
  const me = toMonthEnd(s);
  ok(eqArrStr(me.dates, ['2020-01-31', '2020-02-05', '2020-03-02']),
    `toMonthEnd dates: got ${JSON.stringify(me.dates)}`);
  ok(eqArr(me.adjClose, [110, 120, 130]),
    `toMonthEnd closes: got ${JSON.stringify(me.adjClose)}`);
}

// ── 3. terciles ───────────────────────────────────────────────
// thirds, 9종: scores by index [9,1,8,2,7,3,6,4,5]
{
  const scores = [9, 1, 8, 2, 7, 3, 6, 4, 5];
  const { top, bottom } = terciles(scores, 'thirds');
  ok(eqArr(top, [0, 2, 4]), `terciles thirds top: got ${JSON.stringify(top)}, want [0,2,4]`);
  ok(eqArr(bottom, [5, 3, 1]), `terciles thirds bottom: got ${JSON.stringify(bottom)}, want [5,3,1]`);
}
// halves, 6종: [10,20,30,40,50,60]
{
  const scores = [10, 20, 30, 40, 50, 60];
  const { top, bottom } = terciles(scores, 'halves');
  ok(eqArr(top, [5, 4, 3]), `terciles halves top: got ${JSON.stringify(top)}, want [5,4,3]`);
  ok(eqArr(bottom, [2, 1, 0]), `terciles halves bottom: got ${JSON.stringify(bottom)}, want [2,1,0]`);
}
// halves, null 포함 4종 scored: [5,null,3,1,4] → floor(4/2)=2
{
  const scores = [5, null, 3, 1, 4];
  const { top, bottom } = terciles(scores, 'halves');
  ok(eqArr(top, [0, 4]), `terciles halves(null) top: got ${JSON.stringify(top)}, want [0,4]`);
  ok(eqArr(bottom, [2, 3]), `terciles halves(null) bottom: got ${JSON.stringify(bottom)}, want [2,3]`);
}

// ── 4. transitionMatrix ───────────────────────────────────────
// leaders=[0,0,1,2,2,null,1,1], nSymbols=3
{
  const leaders: (number | null)[] = [0, 0, 1, 2, 2, null, 1, 1];
  const m = transitionMatrix(leaders, 3);
  const want = [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 1],
  ];
  let matEq = true;
  for (let i = 0; i < 3; i++) if (!eqArr(m[i], want[i])) matEq = false;
  ok(matEq, `transitionMatrix: got ${JSON.stringify(m)}, want ${JSON.stringify(want)}`);
}

// ── 5. predictabilitySpread ───────────────────────────────────
// 3종 패널, mode thirds(group=1), h=1. 상위=A, 하위=C. 스프레드 각 월 0.2.
{
  const panel: MonthlyPanel = {
    months: ['2020-01', '2020-02', '2020-03'],
    symbols: ['A', 'B', 'C'],
    close: [
      [100, 100, 100],
      [110, 100, 90],
      [121, 100, 81],
    ],
  };
  const scoresByMonth: (number | null)[][] = [
    [1, 0, -1],
    [1, 0, -1],
    [1, 0, -1],
  ];
  const { spreadByMonth, meanSpread } = predictabilitySpread(panel, scoresByMonth, 1, 'thirds');
  ok(spreadByMonth.length === 2, `predSpread length: got ${spreadByMonth.length}, want 2`);
  ok(approx(spreadByMonth[0], 0.2), `predSpread[0]: got ${spreadByMonth[0]}, want 0.2`);
  ok(approx(spreadByMonth[1], 0.2), `predSpread[1]: got ${spreadByMonth[1]}, want 0.2`);
  ok(approx(meanSpread, 0.2), `predSpread mean: got ${meanSpread}, want 0.2`);
}

function eqArrStr(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// ── 6. restrictToCommonMonths ─────────────────────────────────
// 심볼 B가 처음 2개월 null → 그 두 달은 버리고 모두 non-null인 달만 유지.
{
  const panel: MonthlyPanel = {
    months: ['2011-01', '2011-02', '2011-03', '2011-04'],
    symbols: ['A', 'B'],
    close: [
      [10, null],
      [11, null],
      [12, 100],
      [13, 101],
    ],
  };
  const r = restrictToCommonMonths(panel);
  ok(eqArrStr(r.months, ['2011-03', '2011-04']),
    `restrictToCommon months: got ${JSON.stringify(r.months)}, want [2011-03,2011-04]`);
  ok(r.close.length === 2, `restrictToCommon rows: got ${r.close.length}, want 2`);
  ok(r.close[0][0] === 12 && r.close[0][1] === 100,
    `restrictToCommon row0: got ${JSON.stringify(r.close[0])}, want [12,100]`);
  ok(r.close[1][0] === 13 && r.close[1][1] === 101,
    `restrictToCommon row1: got ${JSON.stringify(r.close[1])}, want [13,101]`);
  // 원본 불변 확인
  ok(panel.months.length === 4, `restrictToCommon leaves source intact: got ${panel.months.length}`);
}

// ── 7. capMonths ──────────────────────────────────────────────
// maxMonth='2026-06' 초과(2026-07) 달을 버린다.
{
  const panel: MonthlyPanel = {
    months: ['2026-05', '2026-06', '2026-07'],
    symbols: ['A'],
    close: [[1], [2], [3]],
  };
  const c = capMonths(panel, '2026-06');
  ok(eqArrStr(c.months, ['2026-05', '2026-06']),
    `capMonths months: got ${JSON.stringify(c.months)}, want [2026-05,2026-06]`);
  ok(c.close.length === 2 && c.close[1][0] === 2,
    `capMonths rows: got ${JSON.stringify(c.close)}, want [[1],[2]]`);
  // 경계 포함(<=), 초과만 제거
  ok(panel.months.length === 3, `capMonths leaves source intact: got ${panel.months.length}`);
}

console.log('─'.repeat(60));
console.log(`PASS ${pass} · FAIL ${fail}`);
if (fail > 0) {
  console.error('파리티 실패 — 골든값 불일치.');
  process.exit(1);
}
console.log('모든 골든 단언 통과 ✓');
process.exit(0);
