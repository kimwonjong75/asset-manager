// tests/sectorRotationPhase2Parity.ts
// Phase 2 전략 로직 골든값 패리티(합성 데이터·손계산 절대값).
// 자기참조(path-A vs path-B) 금지 — 손으로 계산한 절대 골든값에 못 박는다.
// 검증 대상(사전등록 §11):
//   ① 익일 시가 체결(T+1 첫 거래일 adjOpen, T 종가 아님)
//   ② 회전 완충(보유가 상위 bufferTop 이내면 유지)
//   ③ 듀얼모멘텀 현금 대피(자산 12m 절대수익 ≤ 현금이면 슬롯→현금)
//   ④ 편도 비용의 회전율 차감
//   ⑤ 회전율 계산
// 실행: npx --yes tsx tests/sectorRotationPhase2Parity.ts

import type { AdjSeries } from '../scripts/backtest/sectorRotation/lib/yahooData';
import {
  simulate,
  selectWithBuffer,
  firstOpenByMonth,
  nextMonthKey,
  type StrategyParams,
} from '../scripts/backtest/sectorRotation/lib/strategy';

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}
function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

// 합성 시계열: 각 달 2거래일(01=첫날, 28=말일). 첫날 adjOpen=open(체결가),
// 말일 adjClose=close(월말 종가=신호용). 이렇게 하면 open-to-open 체결과
// close 기반 신호가 서로 다른 날에서 나와 "익일시가 체결"을 구분 검증할 수 있다.
interface MonthlyBar {
  month: string; // YYYY-MM
  open: number; // 첫 거래일 adjOpen
  close: number; // 월말 adjClose
}
function mkSeries(symbol: string, bars: MonthlyBar[]): AdjSeries {
  const dates: string[] = [];
  const adjOpen: (number | null)[] = [];
  const adjClose: (number | null)[] = [];
  for (const b of bars) {
    dates.push(`${b.month}-01`);
    adjOpen.push(b.open);
    adjClose.push(b.close);
    dates.push(`${b.month}-28`);
    adjOpen.push(b.open);
    adjClose.push(b.close);
  }
  return {
    symbol,
    source: 'yahoo-v8',
    dates,
    adjOpen,
    adjHigh: adjClose.slice(),
    adjLow: adjClose.slice(),
    adjClose,
    volume: dates.map(() => 1),
    rawClose: adjClose.slice(),
    ok: true,
  };
}

console.log('Phase 2 파리티 — 합성 골든값');
console.log('─'.repeat(64));

// ── Test A: selectWithBuffer (완충 규칙 격리) ─────────────────
{
  // scores: A0=0.5, B1=0.3, C2=0.1, D3=-0.2 → 순위 A>B>C>D
  const scores = [0.5, 0.3, 0.1, -0.2];
  // (a) 보유 없음, topN=2 → [0,1]
  ok(
    JSON.stringify(selectWithBuffer(scores, [], 2, 3)) === JSON.stringify([0, 1]),
    'buffer(a) no-hold top2 → [0,1]'
  );
  // (b) 보유 C(rank3, 상위3 이내) → 유지되고 A로 채움 → [2,0] (rank2 B는 밀려남)
  ok(
    JSON.stringify(selectWithBuffer(scores, [2], 2, 3)) === JSON.stringify([2, 0]),
    'buffer(b) held rank3 stays over rank2 → [2,0]'
  );
  // (c) 보유 D(rank4, 상위3 밖) → 탈락, 신규 상위 → [0,1]
  ok(
    JSON.stringify(selectWithBuffer(scores, [3], 2, 3)) === JSON.stringify([0, 1]),
    'buffer(c) held rank4 dropped → [0,1]'
  );
  // (d) 보유 B,C 둘 다 상위3 이내 → 둘 다 유지 → [1,2]
  ok(
    JSON.stringify(selectWithBuffer(scores, [1, 2], 2, 3)) === JSON.stringify([1, 2]),
    'buffer(d) both held in-buffer stay → [1,2]'
  );
}

// ── Test B: firstOpenByMonth / nextMonthKey ──────────────────
{
  const s = mkSeries('X', [
    { month: '2020-01', open: 10, close: 11 },
    { month: '2020-02', open: 20, close: 22 },
  ]);
  const m = firstOpenByMonth(s);
  ok(m.get('2020-01')?.open === 10, 'firstOpen 2020-01 open=10');
  ok(m.get('2020-01')?.date === '2020-01-01', 'firstOpen 2020-01 date=first trading day');
  ok(m.get('2020-02')?.open === 20, 'firstOpen 2020-02 open=20');
  ok(nextMonthKey('2020-12') === '2021-01', 'nextMonthKey wraps year');
  ok(nextMonthKey('2020-03') === '2020-04', 'nextMonthKey interior');
}

// ── Test C: simulate 통합(익일체결·듀얼모멘텀·전량회전 비용) ──
// 유니버스 A,B,C · 현금 Z · windows=[1] · absLookback=1 · topN=1 · bufferTop=1 · cost=0.001.
{
  const params: StrategyParams = {
    universe: ['A', 'B', 'C'],
    cashSymbol: 'Z',
    topN: 1,
    bufferTop: 1,
    rebalance: 'monthly',
    costRate: 0.001,
    windows: [1],
    absLookback: 1,
    lastCompleteMonth: '2020-05',
  };
  // 월말 종가(신호) / 첫날 시가(체결). 값은 위 주석의 손계산과 일치.
  const seriesMap = new Map<string, AdjSeries>([
    ['A', mkSeries('A', [
      { month: '2020-01', open: 100, close: 100 },
      { month: '2020-02', open: 100, close: 120 },
      { month: '2020-03', open: 50, close: 118.8 },
      { month: '2020-04', open: 55, close: 124.74 },
      { month: '2020-05', open: 55, close: 124.74 },
      { month: '2020-06', open: 55, close: 55 },
    ])],
    ['B', mkSeries('B', [
      { month: '2020-01', open: 100, close: 100 },
      { month: '2020-02', open: 100, close: 100 },
      { month: '2020-03', open: 100, close: 97 },
      { month: '2020-04', open: 100, close: 97 },
      { month: '2020-05', open: 100, close: 97 },
      { month: '2020-06', open: 100, close: 97 },
    ])],
    ['C', mkSeries('C', [
      { month: '2020-01', open: 100, close: 100 },
      { month: '2020-02', open: 100, close: 80 },
      { month: '2020-03', open: 100, close: 76 },
      { month: '2020-04', open: 100, close: 76 },
      { month: '2020-05', open: 100, close: 76 },
      { month: '2020-06', open: 100, close: 76 },
    ])],
    ['Z', mkSeries('Z', [
      { month: '2020-01', open: 200, close: 100 },
      { month: '2020-02', open: 200, close: 101 },
      { month: '2020-03', open: 200, close: 103.02 },
      { month: '2020-04', open: 200, close: 104.05 },
      { month: '2020-05', open: 202, close: 104.05 },
      { month: '2020-06', open: 202, close: 104.05 },
    ])],
  ]);
  const r = simulate({ seriesMap }, params);

  ok(r.records.length === 3, `C: 3 exec months (got ${r.records.length})`);

  // 체결 첫달 2020-03: 신호=2020-02(A +20% rel 최상), 듀얼(A abs +20% > Z 1%) → A 보유.
  const r0 = r.records[0];
  ok(r0.execMonth === '2020-03', `C0 execMonth (got ${r0.execMonth})`);
  ok(r0.signalMonth === '2020-02', `C0 signalMonth (got ${r0.signalMonth})`);
  ok(r0.entryDate === '2020-03-01', `C0 entry=T+1 첫 거래일 (got ${r0.entryDate})`);
  ok(r0.holdings.length === 1 && r0.holdings[0].symbol === 'A' && !r0.holdings[0].isCash,
    `C0 holding=A`);
  // ① 익일시가 체결: gross = open 55/50-1 = 0.10 (NOT close 118.8/120-1 = -0.01)
  ok(approx(r0.grossReturn, 0.10), `C0 gross open-to-open=0.10 (got ${r0.grossReturn})`);
  // ⑤ 회전율 전량 스위치 Z→A: 0.5*(|1|+|1|)=1 · ④ cost=0.001*2=0.002
  ok(approx(r0.turnover, 1), `C0 turnover=1 (got ${r0.turnover})`);
  ok(approx(r0.cost, 0.002), `C0 cost=0.002 (got ${r0.cost})`);
  // net = (1-0.002)*(1.10)-1 = 0.0978
  ok(approx(r0.netReturn, 0.0978, 1e-12), `C0 net=0.0978 (got ${r0.netReturn})`);
  ok(approx(r.equity[1], 1.0978, 1e-12), `C0 equity=1.0978 (got ${r.equity[1]})`);

  // 둘째달 2020-04: 신호=2020-03(A rel 최상), 그러나 A 12m abs=-1% ≤ Z 12m=+2%
  //  ③ 듀얼모멘텀 → 현금(Z) 대피.
  const r1 = r.records[1];
  ok(r1.execMonth === '2020-04', `C1 execMonth (got ${r1.execMonth})`);
  ok(JSON.stringify(r1.selectedRaw) === JSON.stringify(['A']),
    `C1 selectedRaw=[A] before cash swap (got ${JSON.stringify(r1.selectedRaw)})`);
  ok(r1.holdings.length === 1 && r1.holdings[0].symbol === 'Z' && r1.holdings[0].isCash,
    `C1 dual-momentum → cash Z (got ${JSON.stringify(r1.holdings)})`);
  // gross = Z open 202/200-1 = 0.01
  ok(approx(r1.grossReturn, 0.01, 1e-12), `C1 gross cash=0.01 (got ${r1.grossReturn})`);
  ok(approx(r1.turnover, 1), `C1 turnover=1 (A→Z full switch, got ${r1.turnover})`);
  ok(approx(r1.cost, 0.002), `C1 cost=0.002 (got ${r1.cost})`);
  // net = (1-0.002)*(1.01)-1 = 0.00798
  ok(approx(r1.netReturn, 0.00798, 1e-12), `C1 net=0.00798 (got ${r1.netReturn})`);
}

// ── Test D: 부분 회전율(0.5) + 완충 유지/교체 통합 ────────────
// 유니버스 A,B,C,D · 현금 Z · topN=2 · bufferTop=2 · cost=0.001.
{
  const params: StrategyParams = {
    universe: ['A', 'B', 'C', 'D'],
    cashSymbol: 'Z',
    topN: 2,
    bufferTop: 2,
    rebalance: 'monthly',
    costRate: 0.001,
    windows: [1],
    absLookback: 1,
    lastCompleteMonth: '2020-05',
  };
  const seriesMap = new Map<string, AdjSeries>([
    ['A', mkSeries('A', [
      { month: '2020-01', open: 100, close: 100 },
      { month: '2020-02', open: 100, close: 140 },
      { month: '2020-03', open: 100, close: 154 },
      { month: '2020-04', open: 110, close: 169.4 },
      { month: '2020-05', open: 121, close: 169.4 },
      { month: '2020-06', open: 121, close: 169.4 },
    ])],
    ['B', mkSeries('B', [
      { month: '2020-01', open: 100, close: 100 },
      { month: '2020-02', open: 100, close: 130 },
      { month: '2020-03', open: 50, close: 130 },
      { month: '2020-04', open: 55, close: 130 },
      { month: '2020-05', open: 55, close: 130 },
      { month: '2020-06', open: 55, close: 130 },
    ])],
    ['C', mkSeries('C', [
      { month: '2020-01', open: 100, close: 100 },
      { month: '2020-02', open: 100, close: 120 },
      { month: '2020-03', open: 100, close: 180 },
      { month: '2020-04', open: 100, close: 198 },
      { month: '2020-05', open: 100, close: 198 },
      { month: '2020-06', open: 100, close: 198 },
    ])],
    ['D', mkSeries('D', [
      { month: '2020-01', open: 100, close: 100 },
      { month: '2020-02', open: 100, close: 110 },
      { month: '2020-03', open: 100, close: 120 },
      { month: '2020-04', open: 100, close: 120 },
      { month: '2020-05', open: 100, close: 120 },
      { month: '2020-06', open: 100, close: 120 },
    ])],
    ['Z', mkSeries('Z', [
      { month: '2020-01', open: 100, close: 100 },
      { month: '2020-02', open: 100, close: 100.5 },
      { month: '2020-03', open: 100, close: 101 },
      { month: '2020-04', open: 100, close: 101.5 },
      { month: '2020-05', open: 100, close: 101.5 },
      { month: '2020-06', open: 100, close: 101.5 },
    ])],
  ]);
  const r = simulate({ seriesMap }, params);
  ok(r.records.length === 3, `D: 3 exec months (got ${r.records.length})`);

  // 첫 리밸런싱 2020-03: 신호 2020-02 rel top2 = A,B(각 0.5). 전량 진입 → turnover=1.
  const d0 = r.records[0];
  ok(d0.holdings.length === 2, `D0 two holdings`);
  const d0syms = d0.holdings.map(h => h.symbol).sort().join(',');
  ok(d0syms === 'A,B', `D0 holdings A,B (got ${d0syms})`);
  ok(approx(d0.turnover, 1), `D0 turnover=1 (got ${d0.turnover})`);

  // 둘째 리밸런싱 2020-04: 신호 2020-03 rel top2 = C,A. 보유 A(top2) 유지·B(top2 밖) 교체→C.
  //  드리프트 후 직전 {A:0.5,B:0.5}(A·B 3월 수익 동일 +10%) → 목표 {A:0.5,C:0.5}.
  //  Σ|Δw| = |A0|+|C .5|+|B .5| = 1 → turnover=0.5, cost=0.001*1=0.001.
  const d1 = r.records[1];
  const d1syms = d1.holdings.map(h => h.symbol).sort().join(',');
  ok(d1syms === 'A,C', `D1 buffer keep A, replace B→C (got ${d1syms})`);
  ok(JSON.stringify(d1.selectedRaw.slice().sort()) === JSON.stringify(['A', 'C']),
    `D1 selectedRaw {A,C} (got ${JSON.stringify(d1.selectedRaw)})`);
  ok(approx(d1.turnover, 0.5, 1e-12), `D1 partial turnover=0.5 (got ${d1.turnover})`);
  ok(approx(d1.cost, 0.001, 1e-12), `D1 cost=0.001 (got ${d1.cost})`);
  // gross = 0.5*(A open 121/110-1=0.10) + 0.5*(C open 100/100-1=0) = 0.05
  ok(approx(d1.grossReturn, 0.05, 1e-12), `D1 gross=0.05 (got ${d1.grossReturn})`);
}

console.log('─'.repeat(64));
console.log(`PASS ${pass} · FAIL ${fail}`);
if (fail > 0) {
  console.error('파리티 실패 — 골든값 불일치.');
  process.exit(1);
}
console.log('모든 골든 단언 통과 ✓');
process.exit(0);
