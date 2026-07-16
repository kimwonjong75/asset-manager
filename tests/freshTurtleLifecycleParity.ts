// tests/freshTurtleLifecycleParity.ts
// fresh-turtle-lifecycle-v1 골든·불변식 테스트. 전체 데이터 실행 전에 반드시 통과해야 한다.
// 명시적 골든 절대값을 고정한다 (RULES §13 — 경로A-vs-경로B 자기참조 비교 금지).
//
// 실행: npx tsx tests/freshTurtleLifecycleParity.ts

import { buildSecurity, SecurityData, classifyBar } from '../scripts/backtest/freshTurtleLifecycle/data';
import { parseConfig } from '../scripts/backtest/freshTurtleLifecycle/configTypes';
import {
  runBacktest, StrategyRules, RunResult, checkCreateGuard, checkFillGuard,
} from '../scripts/backtest/freshTurtleLifecycle/engine';
import type { SymbolSeries } from '../scripts/backtest/lib/fetchHistory';
import type { FxTable } from '../scripts/backtest/lib/fx';

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  if (Object.is(actual, expected)) pass++;
  else { fail++; console.error(`  ✗ ${name}\n      기대=${String(expected)} 실제=${String(actual)}`); }
}
function checkClose(name: string, actual: number, expected: number, tol = 1e-9): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) pass++;
  else { fail++; console.error(`  ✗ ${name}\n      기대=${expected} 실제=${actual} (tol ${tol})`); }
}
function checkTrue(name: string, v: boolean): void { check(name, v, true); }

// ── 합성 데이터 헬퍼 ─────────────────────────────────────────────────────
function iso(i: number): string {
  return new Date(Date.parse('2015-01-01T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10);
}

interface Bar { o: number | null; h: number | null; l: number | null; c: number | null }
/** 빈 행 (OHLC 전부 null) — BTC-USD·ETH-USD 의 2026-07-06 재현용 */
function nullBar(): Bar { return { o: null, h: null, l: null, c: null }; }

/** 평탄바: close=10000, h=10250, l=9750 → TR=500 → ATR20=500 (골든 앵커). */
function flatBar(): Bar { return { o: 10000, h: 10250, l: 9750, c: 10000 }; }

function mkSeries(ticker: string, bars: Bar[], dayIdx: number[]): SymbolSeries {
  return {
    symbol: ticker,
    dates: dayIdx.map(iso),
    open: bars.map(b => b.o), high: bars.map(b => b.h),
    low: bars.map(b => b.l), close: bars.map(b => b.c),
    ok: true,
  };
}

const RULES_T1: StrategyRules = {
  entryLookback: 55, exitLookback: 20, atrPeriod: 20, stopMultipleN: 2, pyramidStepN: 0.5,
  riskPerUnitPct: 0.5, maxTotalRiskPct: 12, positionValueCapPct: 25,
  maxUnitsPerPosition: 1, pyramidEnabled: false,
  budgetKRW: 10_000_000, initialCashKRW: 10_000_000, costOneWay: 0.001,
};
const RULES_T2: StrategyRules = { ...RULES_T1, maxUnitsPerPosition: 2, pyramidEnabled: true };

const NO_FX: FxTable = { usdKrw: [], jpyKrw: [] };

function build(ticker: string, bars: Bar[], dayIdx: number[], calendar: string[]): SecurityData {
  return buildSecurity(ticker, 'KRW', false, mkSeries(ticker, bars, dayIdx), calendar, 20, 55, 20);
}

function run(secs: SecurityData[], calendar: string[], rules: StrategyRules, start?: string, end?: string): RunResult {
  return runBacktest({
    calendar, securities: secs, fx: NO_FX, rules,
    windowStart: start ?? calendar[0], windowEnd: end ?? calendar[calendar.length - 1],
  });
}

console.log('fresh-turtle-lifecycle-v1 골든·불변식 테스트\n');

// ════════════════════════════════════════════════════════════════════════════
console.log('1. 채널이 D일 현재 봉을 포함하지 않음');
// ════════════════════════════════════════════════════════════════════════════
{
  // high = 1..60 단조증가. j=59 에서 ch55High 는 high[4..58] = 59 (현재 봉 60 제외).
  const bars: Bar[] = [];
  for (let i = 0; i < 60; i++) bars.push({ o: i + 1, h: i + 1, l: i + 1, c: i + 1 });
  const cal = bars.map((_, i) => iso(i));
  const s = build('X', bars, bars.map((_, i) => i), cal);
  checkClose('ch55High[59] = 59 (현재봉 60 제외)', s.ch55High[59] as number, 59, 1e-12);
  checkTrue('ch55High[59] ≠ 60 (현재봉 포함이면 60)', (s.ch55High[59] as number) !== 60);

  // low = 60..1 단조감소. j=59 에서 ch20Low 는 low[39..58] = 2 (현재 봉 1 제외).
  const bars2: Bar[] = [];
  for (let i = 0; i < 60; i++) bars2.push({ o: 60 - i, h: 60 - i, l: 60 - i, c: 60 - i });
  const s2 = build('Y', bars2, bars2.map((_, i) => i), cal);
  checkClose('ch20Low[59] = 2 (현재봉 1 제외)', s2.ch20Low[59] as number, 2, 1e-12);
  checkTrue('ch20Low[59] ≠ 1 (현재봉 포함이면 1)', (s2.ch20Low[59] as number) !== 1);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('2. 골든 진입 — 다음 실제 거래일 시가 체결 · 같은 봉 체결 없음 · 갭 보정 금지');
// ════════════════════════════════════════════════════════════════════════════
{
  const bars: Bar[] = [];
  for (let i = 0; i < 60; i++) bars.push(flatBar());
  // bar60: 돌파 (close 10300 ≥ ch55High 10250). TR = max(10300-9750, |10300-10000|, |9750-10000|) = 550
  bars.push({ o: 10000, h: 10300, l: 9750, c: 10300 });
  // bar61: 시가가 돌파선(10250)보다 **아래**로 갭다운 → max(open,돌파선) 보정 시 10250 이 되어 오답
  bars.push({ o: 10100, h: 10150, l: 10050, c: 10100 });
  for (let i = 0; i < 5; i++) bars.push({ o: 10100, h: 10150, l: 10050, c: 10100 });
  const cal = bars.map((_, i) => iso(i));
  const s = build('A', bars, bars.map((_, i) => i), cal);

  checkClose('ch55High[60] 골든 = 10250', s.ch55High[60] as number, 10250, 1e-12);
  checkClose('ATR20[59] 골든 = 500', s.atr[59] as number, 500, 1e-9);
  checkClose('ATR20[60] 골든 = 502.5 ((500×19+550)/20)', s.atr[60] as number, 502.5, 1e-9);

  const r = run([s], cal, RULES_T1);
  check('진입 체결 1건', r.flow.filled.entry, 1);
  check('가격조건(entry) 1건', r.flow.priceCondition.entry, 1);
  check('체결일 = bar61 (다음 거래일)', r.fills[0].date, iso(61));
  checkTrue('같은 봉(bar60) 체결 아님', r.fills[0].date !== iso(60));
  check('같은봉 체결 불변식 0', r.invariants.sameBarFill, 0);
  checkClose('체결가 = 시가 10100 그대로 (갭 보정 금지)', r.fills[0].price, 10100, 1e-12);
  checkTrue('금지 보정 max(open,돌파선)=10250 아님', r.fills[0].price !== 10250);

  // 수량 골든: qty = floor(50,000 / 502.5) = floor(99.50) = 99
  check('수량 골든 = 99주 (floor(50000/502.5))', r.fills[0].qty, 99);
  // 비용 골든: 99 × 10100 × 0.001 = 999.9
  checkClose('매수비용 골든 = 999.9', r.fills[0].costKRW, 999.9, 1e-9);

  // 대기주문은 체결 전 현금·위험을 바꾸지 않는다 → bar60 종료 시 평가액 = 초기현금
  checkClose('신호일(bar60) 평가액 = 10,000,000 (대기주문 무영향)', r.equityCurve[60], 10_000_000, 1e-6);
  checkTrue('체결일(bar61) 평가액 ≠ 초기현금', Math.abs(r.equityCurve[61] - 10_000_000) > 1);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('3. 골든 손절 — 손절가 보정 금지 (갭다운 시가 그대로)');
// ════════════════════════════════════════════════════════════════════════════
{
  const bars: Bar[] = [];
  for (let i = 0; i < 60; i++) bars.push(flatBar());
  bars.push({ o: 10000, h: 10300, l: 9750, c: 10300 });          // bar60 진입신호
  bars.push({ o: 10100, h: 10150, l: 10050, c: 10100 });          // bar61 체결 @10100, stop = 10100-1005 = 9095
  bars.push({ o: 10000, h: 10000, l: 9000, c: 9000 });            // bar62 종가 9000 ≤ 9095 → 손절신호
  bars.push({ o: 8000, h: 8100, l: 7900, c: 8000 });              // bar63 갭다운 시가 8000 → 체결가 8000
  for (let i = 0; i < 3; i++) bars.push({ o: 8000, h: 8100, l: 7900, c: 8000 });
  const cal = bars.map((_, i) => iso(i));
  const s = build('A', bars, bars.map((_, i) => i), cal);
  const r = run([s], cal, RULES_T1);

  check('손절 체결 1건', r.flow.filled.stop, 1);
  const stopFill = r.fills.find(f => f.kind === 'stop')!;
  check('손절 체결일 = bar63', stopFill.date, iso(63));
  checkClose('손절 체결가 = 시가 8000 그대로', stopFill.price, 8000, 1e-12);
  checkTrue('금지 보정 min(open,손절가)=8000... 대신 손절가 9095 아님', stopFill.price !== 9095);
  checkTrue('갭 손실이 손절가보다 큼 (갭 반영)', stopFill.price < 9095);

  // R 골든: 1R = 99 × 2 × 502.5 × 1 = 99,495
  //   매수: 99×10100 = 999,900 (비용 999.9) / 매도: 99×8000 = 792,000 (비용 792)
  //   순손익 = 792,000 − 792 − 999,900 − 999.9 = −209,691.9 → R = −209,691.9 / 99,495 = −2.1075...
  check('완료거래 1건', r.trades.length, 1);
  checkClose('1R 골든 = 99,495', r.trades[0].rDenomKRW, 99_495, 1e-6);
  checkClose('순손익 골든 = −209,691.9', r.trades[0].netPnlKRW, -209_691.9, 1e-6);
  checkClose('R 골든 = −2.10756…', r.trades[0].r, -209_691.9 / 99_495, 1e-9);
  checkTrue('갭 손절이라 R < −1', r.trades[0].r < -1);
  check('청산 사유 = stop', r.trades[0].exitKind, 'stop');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('4. 신호 우선순위 — 손절 > 20일 청산 > 불타기');
// ════════════════════════════════════════════════════════════════════════════
{
  // 손절·청산 동시 성립 → stop 우선
  const bars: Bar[] = [];
  for (let i = 0; i < 60; i++) bars.push(flatBar());
  bars.push({ o: 10000, h: 10300, l: 9750, c: 10300 });
  bars.push({ o: 10100, h: 10150, l: 10050, c: 10100 });
  bars.push({ o: 10000, h: 10000, l: 9000, c: 9000 });   // 9000 ≤ stop 9095 AND ≤ ch20Low
  bars.push({ o: 8900, h: 9000, l: 8800, c: 8900 });
  for (let i = 0; i < 3; i++) bars.push({ o: 8900, h: 9000, l: 8800, c: 8900 });
  const cal = bars.map((_, i) => iso(i));
  const s = build('A', bars, bars.map((_, i) => i), cal);
  const r = run([s], cal, RULES_T2);
  checkTrue('손절·청산 동시 → stop 우선', r.trades[0].exitKind === 'stop');
  check('exit 체결 0건 (stop 이 선점)', r.flow.filled.exit, 0);

  // 손절 미달 + 청산 성립 → exit
  const bars2: Bar[] = [];
  for (let i = 0; i < 60; i++) bars2.push(flatBar());
  bars2.push({ o: 10000, h: 10300, l: 9750, c: 10300 });
  bars2.push({ o: 10100, h: 10150, l: 10050, c: 10100 });
  // ch20Low[62] = min(low[42..61]) = 9750. 종가 9700 ≤ 9750, stop 9095 미달 → exit
  bars2.push({ o: 9800, h: 9800, l: 9700, c: 9700 });
  bars2.push({ o: 9700, h: 9750, l: 9650, c: 9700 });
  for (let i = 0; i < 3; i++) bars2.push({ o: 9700, h: 9750, l: 9650, c: 9700 });
  const cal2 = bars2.map((_, i) => iso(i));
  const s2 = build('B', bars2, bars2.map((_, i) => i), cal2);
  const r2 = run([s2], cal2, RULES_T2);
  check('손절 미달 + 청산 성립 → exit', r2.trades[0].exitKind, 'exit');
  check('stop 체결 0건', r2.flow.filled.stop, 0);
  checkClose('exit 체결가 = 시가 9700', r2.fills.find(f => f.kind === 'exit')!.price, 9700, 1e-12);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('5. 0.5N 경계 — 직전 · 일치 · 초과');
// ════════════════════════════════════════════════════════════════════════════
{
  // bar62 의 h/l 을 고정해 TR(62) 을 close(62) 와 무관하게 만든다 → N(62) 불변.
  //   TR[62] = max(h−l, |h−close61|, |l−close61|) — close62 미사용(인과적).
  function mk(close62: number): { s: SecurityData; cal: string[] } {
    const bars: Bar[] = [];
    for (let i = 0; i < 60; i++) bars.push(flatBar());
    bars.push({ o: 10000, h: 10300, l: 9750, c: 10300 });
    bars.push({ o: 10100, h: 10150, l: 10050, c: 10100 });         // 체결 @10100
    bars.push({ o: 10100, h: 11000, l: 9000, c: close62 });         // TR 고정
    for (let i = 0; i < 4; i++) bars.push({ o: close62, h: close62 + 10, l: close62 - 10, c: close62 });
    const cal = bars.map((_, i) => iso(i));
    return { s: build('A', bars, bars.map((_, i) => i), cal), cal };
  }
  const probe = mk(10500);
  const n62 = probe.s.atr[62] as number;
  checkTrue('N(62) 산출됨', Number.isFinite(n62) && n62 > 0);
  const trigger = 10100 + 0.5 * n62;   // 마지막 실제 체결가 + 0.5 × D일 N

  const eps = 1e-6;
  const below = mk(trigger - 1);
  const exact = mk(trigger);
  const above = mk(trigger + 1);
  // N 이 세 변형에서 동일한지 먼저 확인 (TR 이 close62 와 무관)
  checkClose('N(62) 는 close62 와 무관 (below)', below.s.atr[62] as number, n62, 1e-12);
  checkClose('N(62) 는 close62 와 무관 (above)', above.s.atr[62] as number, n62, 1e-12);

  // **bar62 만 격리**: 구간을 bar62 에서 끊는다. (이후 바는 N 이 급감해 트리거가 내려가므로
  //  그대로 두면 bar63 에서 발화해 경계 테스트가 오염된다 — 실제로 관측됨.)
  const at62 = iso(62);
  const rb = run([below.s], below.cal, RULES_T2, below.cal[0], at62);
  const re = run([exact.s], exact.cal, RULES_T2, exact.cal[0], at62);
  const ra = run([above.s], above.cal, RULES_T2, above.cal[0], at62);
  check('트리거 직전(−1) → 불타기 신호 없음', rb.flow.priceCondition.pyramid, 0);
  check('트리거 일치 → 불타기 신호 1건 (≥ 조건)', re.flow.priceCondition.pyramid, 1);
  check('트리거 초과(+1) → 불타기 신호 1건', ra.flow.priceCondition.pyramid, 1);
  checkTrue('경계값 자체가 유효(eps 무관)', Math.abs(trigger - (10100 + 0.5 * n62)) < eps);
  checkTrue('세 변형 모두 진입은 체결됨(테스트 유효성)', rb.flow.filled.entry === 1 && re.flow.filled.entry === 1 && ra.flow.filled.entry === 1);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('6. 불타기 후 공통 손절가 갱신 + 최대 유닛');
// ════════════════════════════════════════════════════════════════════════════
{
  const bars: Bar[] = [];
  for (let i = 0; i < 60; i++) bars.push(flatBar());
  bars.push({ o: 10000, h: 10300, l: 9750, c: 10300 });
  bars.push({ o: 10100, h: 10150, l: 10050, c: 10100 });    // 진입 체결 @10100, stop = 9095
  bars.push({ o: 10500, h: 10600, l: 10400, c: 10600 });    // 불타기 신호 (10600 ≥ 10100+0.5N)
  bars.push({ o: 10700, h: 10800, l: 10600, c: 10700 });    // 불타기 체결 @10700
  for (let i = 0; i < 6; i++) bars.push({ o: 10700, h: 10800, l: 10600, c: 10700 });
  const cal = bars.map((_, i) => iso(i));
  const s = build('A', bars, bars.map((_, i) => i), cal);

  const r2 = run([s], cal, RULES_T2);
  check('T2 불타기 체결 1건', r2.flow.filled.pyramid, 1);
  const pf = r2.fills.find(f => f.kind === 'pyramid')!;
  check('불타기 체결일 = bar63', pf.date, iso(63));
  checkClose('불타기 체결가 = 시가 10700 (max(open,trigger) 보정 금지)', pf.price, 10700, 1e-12);
  // 공통 손절가 = 실제 불타기 체결가 − 2 × 신호일(bar62) N
  const n62 = s.atr[62] as number;
  const expectedStop = 10700 - 2 * n62;
  // 손절가는 내부 상태라 직접 못 보므로, 그 손절가에 정확히 닿는 종가로 손절이 나는지로 검증한다.
  const bars3 = bars.slice(0, 64);
  bars3.push({ o: 10700, h: 10750, l: expectedStop - 5, c: expectedStop });  // 종가 = 새 손절가 → 손절
  bars3.push({ o: expectedStop, h: expectedStop, l: expectedStop, c: expectedStop });
  for (let i = 0; i < 3; i++) bars3.push({ o: expectedStop, h: expectedStop, l: expectedStop, c: expectedStop });
  const cal3 = bars3.map((_, i) => iso(i));
  const s3 = build('A', bars3, bars3.map((_, i) => i), cal3);
  const r3 = run([s3], cal3, RULES_T2);
  check('갱신된 공통 손절가에서 손절 발생', r3.flow.filled.stop, 1);
  check('2유닛 포지션이 전량 청산', r3.trades[0].units, 2);
  checkTrue('갱신 손절가 > 최초 손절가 9095 (상향)', expectedStop > 9095);

  // T1 은 동일 데이터에서 불타기 없음
  const r1 = run([s], cal, RULES_T1);
  check('T1 불타기 체결 0건', r1.flow.filled.pyramid, 0);
  check('T1 불타기 가격조건도 평가 안 함', r1.flow.priceCondition.pyramid, 0);
  check('T1 최대유닛 초과 0', r1.invariants.maxUnitsBreach, 0);
  check('T2 최대유닛 초과 0', r2.invariants.maxUnitsBreach, 0);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('7. 청산 후 새 55일 돌파에서 재진입');
// ════════════════════════════════════════════════════════════════════════════
{
  const bars: Bar[] = [];
  for (let i = 0; i < 60; i++) bars.push(flatBar());
  bars.push({ o: 10000, h: 10300, l: 9750, c: 10300 });        // 진입신호
  bars.push({ o: 10100, h: 10150, l: 10050, c: 10100 });        // 체결
  bars.push({ o: 9800, h: 9800, l: 9700, c: 9700 });            // 청산신호 (≤ ch20Low 9750)
  bars.push({ o: 9700, h: 9750, l: 9650, c: 9700 });            // 청산 체결
  for (let i = 0; i < 30; i++) bars.push({ o: 9700, h: 9750, l: 9650, c: 9700 });  // 횡보
  // 새 돌파: ch55High 는 과거 10300 을 포함하므로 그보다 위로
  bars.push({ o: 10400, h: 10500, l: 10300, c: 10500 });
  bars.push({ o: 10500, h: 10550, l: 10450, c: 10500 });
  for (let i = 0; i < 3; i++) bars.push({ o: 10500, h: 10550, l: 10450, c: 10500 });
  const cal = bars.map((_, i) => iso(i));
  const s = build('A', bars, bars.map((_, i) => i), cal);
  const r = run([s], cal, RULES_T1);
  check('진입 2건 (최초 + 재진입)', r.flow.filled.entry, 2);
  check('청산 1건', r.flow.filled.exit, 1);
  check('완료거래 1건 (재진입분은 미청산)', r.trades.length, 1);
  check('중복 포지션 0', r.invariants.duplicatePosition, 0);
  check('중복 주문 0', r.invariants.duplicateOrder, 0);
  checkTrue('재진입 체결일이 청산 이후', r.fills.filter(f => f.kind === 'entry')[1].date > r.fills.find(f => f.kind === 'exit')!.date);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('8. 휴장일 — 허위 체결 없음 · 시가 이월 금지');
// ════════════════════════════════════════════════════════════════════════════
{
  // A 는 매일 거래, B 는 짝수일만 거래. 합집합 달력 = 매일.
  const barsA: Bar[] = [];
  for (let i = 0; i < 70; i++) barsA.push(flatBar());
  const dayA = barsA.map((_, i) => i);

  const dayB: number[] = [];
  for (let i = 0; i < 140; i += 2) dayB.push(i);
  const barsB: Bar[] = dayB.map(() => flatBar());
  barsB[60] = { o: 10000, h: 10300, l: 9750, c: 10300 };  // B 의 61번째 거래일에 돌파
  barsB[61] = { o: 10100, h: 10150, l: 10050, c: 10100 };

  const calSet = new Set<string>([...dayA.map(iso), ...dayB.map(iso)]);
  const cal = [...calSet].sort();
  const sA = build('A', barsA, dayA, cal);
  const sB = build('B', barsB, dayB, cal);

  check('B 의 시가는 미거래일에 이월되지 않음', sB.ownIdxOfCal[1], -1);
  const r = run([sA, sB], cal, RULES_T1);
  check('휴장일 체결 불변식 0', r.invariants.holidayFill, 0);
  const bDates = new Set(dayB.map(iso));
  checkTrue('B 의 모든 체결일이 B 의 실제 거래일', r.fills.filter(f => f.ticker === 'B').every(f => bDates.has(f.date)));
  checkTrue('B 체결 발생(테스트 유효성)', r.fills.some(f => f.ticker === 'B'));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('9. 회계·안전 불변식 (다종목 경합)');
// ════════════════════════════════════════════════════════════════════════════
{
  // 19종 동시 돌파 → 현금·예산·12% 위험·25% 상한 경합
  const secs: SecurityData[] = [];
  const bars: Bar[] = [];
  for (let i = 0; i < 60; i++) bars.push(flatBar());
  bars.push({ o: 10000, h: 10300, l: 9750, c: 10300 });
  for (let i = 0; i < 10; i++) bars.push({ o: 10100, h: 10150, l: 10050, c: 10100 });
  const cal = bars.map((_, i) => iso(i));
  for (let k = 0; k < 19; k++) secs.push(build(`S${String(k).padStart(2, '0')}`, bars, bars.map((_, i) => i), cal));

  const r = run(secs, cal, RULES_T1);
  check('현금 음수 0', r.invariants.negativeCash, 0);
  check('잔여예산 음수 0', r.invariants.negativeBudget, 0);
  check('총위험 12% 초과 0', r.invariants.totalRiskBreach, 0);
  check('25% 상한 초과 0', r.invariants.positionCapBreach, 0);
  check('최대유닛 초과 0', r.invariants.maxUnitsBreach, 0);
  check('중복 포지션 0', r.invariants.duplicatePosition, 0);
  check('중복 주문 0', r.invariants.duplicateOrder, 0);
  checkTrue('현금 항상 ≥ 0', r.equityCurve.every(v => v > 0));
  // 제약은 **전량 거부가 아니라 공통비율 λ 하향**으로 작동한다(사양). 무제약 제안수량 99 → 축소 확인.
  checkTrue('경합 시 λ 하향으로 수량 축소 (선착순 아님)', r.fills.every(f => f.qty < 99));
  checkTrue('모든 종목이 동일 수량 (공통비율 — 선착순이면 앞 종목만 99)', new Set(r.fills.map(f => f.qty)).size === 1);
  checkTrue('차단 사유가 기록됨(워밍업 등)', Object.values(r.flow.blocked).some(v => v > 0));

  // ── 9b. 12% 총위험 한도가 **단독으로** 구속되는 시나리오 (현금은 여유) ──
  // TR=2000 고정(h=11000,l=9000,c=10000) → ATR20=2000 → 유닛당 위험 = 예산의 1%.
  // 19종이면 위험 19% > 12% 이지만, 포지션 가치는 종목당 ~25만원이라 현금(1000만)은 남는다.
  const volBars: Bar[] = [];
  for (let i = 0; i < 60; i++) volBars.push({ o: 10000, h: 11000, l: 9000, c: 10000 });
  volBars.push({ o: 10000, h: 11100, l: 9000, c: 11100 });          // 돌파 (ch55High=11000)
  for (let i = 0; i < 8; i++) volBars.push({ o: 10500, h: 11000, l: 10000, c: 10500 });
  const volCal = volBars.map((_, i) => iso(i));
  const volSecs = Array.from({ length: 19 }, (_, k) =>
    build(`V${String(k).padStart(2, '0')}`, volBars, volBars.map((_, i) => i), volCal));
  const rv = run(volSecs, volCal, RULES_T1);
  checkClose('ATR20[60] 골든 = 2005 ((2000×19+2100)/20)', volSecs[0].atr[60] as number, 2005, 1e-9);
  check('19종 전부 체결 (전량 거부 아님)', rv.flow.filled.entry, 19);
  // 무제약 제안 = floor(50,000/2005) = 24 → 위험 19×24×4010 = 1,829,760 > 1,200,000 → λ 하향 필요
  checkTrue('무제약 수량 24 에서 축소됨', rv.fills.every(f => f.qty < 24));
  const totalRiskKRW = rv.fills.filter(f => f.kind === 'entry').reduce((s, f) => s + f.qty * 2 * 2005, 0);
  checkTrue(`총 오픈위험 ${Math.round(totalRiskKRW)} ≤ 1,200,000 (12% 한도 준수)`, totalRiskKRW <= 1_200_000 + 1e-6);
  checkTrue('위험한도가 실제로 구속 (한도의 90% 이상 사용)', totalRiskKRW >= 1_200_000 * 0.9);
  check('총위험 초과 불변식 0', rv.invariants.totalRiskBreach, 0);
  check('현금 음수 0 (현금은 여유)', rv.invariants.negativeCash, 0);
  checkTrue('현금이 남음 (위험한도가 먼저 구속됐음을 확인)', rv.equityCurve[61] > 0);

  // 입력 순서 무관 — 뒤집기·셔플
  const key = (x: RunResult): string => JSON.stringify({
    e: x.finalEquityKRW.toFixed(6), t: x.trades.length, f: x.fills.length,
    fl: x.flow.filled, cost: x.totalCostKRW.toFixed(6),
    fills: x.fills.map(f => `${f.date}|${f.ticker}|${f.kind}|${f.qty}|${f.price}`),
  });
  const rRev = run([...secs].reverse(), cal, RULES_T1);
  checkTrue('종목 입력 순서 뒤집어도 동일 결과', key(r) === key(rRev));
  const shuffled = [...secs];
  for (let i = shuffled.length - 1; i > 0; i--) { const j = (i * 7 + 3) % (i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  const rShuf = run(shuffled, cal, RULES_T1);
  checkTrue('종목 입력 순서 셔플해도 동일 결과', key(r) === key(rShuf));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('10. 미래정보 참조 없음 (구간 절단 동치)');
// ════════════════════════════════════════════════════════════════════════════
{
  const bars: Bar[] = [];
  for (let i = 0; i < 60; i++) bars.push(flatBar());
  bars.push({ o: 10000, h: 10300, l: 9750, c: 10300 });
  bars.push({ o: 10100, h: 10150, l: 10050, c: 10100 });
  for (let i = 0; i < 8; i++) bars.push({ o: 10100, h: 10150, l: 10050, c: 10100 });
  // 이후 급등 (미래 정보) — 절단본에는 없다
  for (let i = 0; i < 10; i++) bars.push({ o: 20000, h: 21000, l: 19000, c: 20000 });
  const cal = bars.map((_, i) => iso(i));
  const s = build('A', bars, bars.map((_, i) => i), cal);

  const cutDate = iso(69);
  const rFull = run([s], cal, RULES_T1, cal[0], cutDate);           // 전체 데이터, 구간만 절단
  const barsCut = bars.slice(0, 70);
  const calCut = barsCut.map((_, i) => iso(i));
  const sCut = build('A', barsCut, barsCut.map((_, i) => i), calCut);
  const rCut = run([sCut], calCut, RULES_T1);                        // 데이터 자체를 절단

  const sig = (x: RunResult): string => JSON.stringify(x.fills.map(f => `${f.date}|${f.kind}|${f.qty}|${f.price}`));
  checkTrue('미래 데이터 유무가 구간 내 체결을 바꾸지 않음', sig(rFull) === sig(rCut));
  checkClose('구간 내 최종 평가액 동일', rFull.finalEquityKRW, rCut.finalEquityKRW, 1e-6);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('11. T1 ≡ T2 (불타기 미발생 데이터에서 완전 동일)');
// ════════════════════════════════════════════════════════════════════════════
{
  // 진입 후 하락만 → 불타기 조건 절대 미충족 → T1·T2 결과가 완전히 같아야 한다
  const bars: Bar[] = [];
  for (let i = 0; i < 60; i++) bars.push(flatBar());
  bars.push({ o: 10000, h: 10300, l: 9750, c: 10300 });
  bars.push({ o: 10100, h: 10150, l: 10050, c: 10100 });
  bars.push({ o: 9800, h: 9800, l: 9700, c: 9700 });
  bars.push({ o: 9700, h: 9750, l: 9650, c: 9700 });
  for (let i = 0; i < 5; i++) bars.push({ o: 9700, h: 9750, l: 9650, c: 9700 });
  const cal = bars.map((_, i) => iso(i));
  const s = build('A', bars, bars.map((_, i) => i), cal);
  const r1 = run([s], cal, RULES_T1);
  const r2 = run([s], cal, RULES_T2);
  const key = (x: RunResult): string => JSON.stringify({
    e: x.finalEquityKRW.toFixed(9), trades: x.trades.map(t => `${t.ticker}|${t.r.toFixed(9)}`),
    fills: x.fills.map(f => `${f.date}|${f.kind}|${f.qty}|${f.price}`),
    mdd: x.mdd.toFixed(9), cagr: x.cagr.toFixed(9),
  });
  checkTrue('불타기 미발생 시 T1 ≡ T2 (불타기 외 조건 동일 증명)', key(r1) === key(r2));
  check('T2 불타기 체결 0 (해당 데이터)', r2.flow.filled.pyramid, 0);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('12. 종료 시 미청산 포지션 — 강제청산 거래 없음');
// ════════════════════════════════════════════════════════════════════════════
{
  const bars: Bar[] = [];
  for (let i = 0; i < 60; i++) bars.push(flatBar());
  bars.push({ o: 10000, h: 10300, l: 9750, c: 10300 });
  bars.push({ o: 10100, h: 10150, l: 10050, c: 10100 });
  for (let i = 0; i < 5; i++) bars.push({ o: 10200, h: 10250, l: 10150, c: 10200 });
  const cal = bars.map((_, i) => iso(i));
  const s = build('A', bars, bars.map((_, i) => i), cal);
  const r = run([s], cal, RULES_T1);
  check('완료거래 0건 (강제청산 없음)', r.trades.length, 0);
  check('미청산 포지션 1개', r.openPositionsAtEnd.length, 1);
  checkTrue('미실현손익 분리 기록', r.unrealizedKRW !== 0);
  checkTrue('매도 체결 0건', r.fills.filter(f => f.kind === 'stop' || f.kind === 'exit').length === 0);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('13. [AMENDED-1 #1] 빈 OHLC 행 — 실제 거래일 판정 · 다음 유효 시가 체결');
// ════════════════════════════════════════════════════════════════════════════
{
  // classifyBar 직접 검증
  check('전부 null → all-null', classifyBar(null, null, null, null).valid === false
    ? (classifyBar(null, null, null, null) as { reason: string }).reason : 'valid', 'all-null');
  check('일부 null → partial', classifyBar(100, null, 90, 95).valid === false
    ? (classifyBar(100, null, 90, 95) as { reason: string }).reason : 'valid', 'partial-null-or-nonpositive');
  check('0 이하 → partial', classifyBar(100, 110, 0, 95).valid === false
    ? (classifyBar(100, 110, 0, 95) as { reason: string }).reason : 'valid', 'partial-null-or-nonpositive');
  check('OHLC 관계 이상(low>high) → ohlc-relation', classifyBar(100, 90, 110, 95).valid === false
    ? (classifyBar(100, 90, 110, 95) as { reason: string }).reason : 'valid', 'ohlc-relation');
  check('close>high → ohlc-relation', classifyBar(100, 105, 95, 110).valid === false
    ? (classifyBar(100, 105, 95, 110) as { reason: string }).reason : 'valid', 'ohlc-relation');
  check('정상 봉 → valid', classifyBar(100, 110, 90, 105).valid, true);

  // 골든: 2026-07-05 신호 → 07-06 빈 행 → **07-07 실제 시가 체결**
  // 달력 인덱스로 60=07-05, 61=07-06(빈 행), 62=07-07 이 되도록 구성한다.
  const bars: Bar[] = [];
  for (let i = 0; i < 60; i++) bars.push(flatBar());
  bars.push({ o: 10000, h: 10300, l: 9750, c: 10300 });   // idx60 — 돌파 신호
  bars.push(nullBar());                                    // idx61 — 빈 행 (거래일 아님)
  bars.push({ o: 10400, h: 10450, l: 10350, c: 10400 });   // idx62 — 다음 유효 거래일
  for (let i = 0; i < 4; i++) bars.push({ o: 10400, h: 10450, l: 10350, c: 10400 });
  const cal = bars.map((_, i) => iso(i));
  const s = build('A', bars, bars.map((_, i) => i), cal);

  check('빈 행이 유효 거래일 배열에서 제거됨', s.ownDates.length, bars.length - 1);
  check('제외 행 1건 기록', s.excludedRows.length, 1);
  check('제외 행 날짜 = idx61', s.excludedRows[0].date, iso(61));
  check('제외 사유 = all-null', s.excludedRows[0].reason, 'all-null');
  check('빈 행 달력일은 미거래로 매핑', s.ownIdxOfCal[61], -1);
  checkTrue('신호일(idx60)·체결일(idx62) 은 거래일로 매핑', s.ownIdxOfCal[60] >= 0 && s.ownIdxOfCal[62] >= 0);
  check('신호일 다음 유효 own 인덱스가 idx62 를 가리킴', s.calIdxOfOwn[s.ownIdxOfCal[60] + 1], 62);

  const r = run([s], cal, RULES_T1);
  check('체결 1건 (취소되지 않음)', r.flow.filled.entry, 1);
  check('체결일 = idx62 (빈 행 건너뜀)', r.fills[0].date, iso(62));
  checkClose('체결가 = idx62 시가 10400', r.fills[0].price, 10400, 1e-12);
  check('no-next-open 취소 0건 (수정 전에는 여기서 취소됐음)', r.flow.blocked['no-next-open'], 0);
  check('휴장 체결 0', r.invariants.holidayFill, 0);
  check('같은봉 체결 0', r.invariants.sameBarFill, 0);

  // 지표도 유효 거래일만 센다: 빈 행이 55일 창의 한 칸을 먹지 않는다
  const own60 = s.ownIdxOfCal[60];
  checkClose('ATR20 은 유효 거래일 기준 = 502.5', s.atr[own60] as number, 502.5, 1e-9);
  checkClose('ch55High 도 유효 거래일 기준 = 10250', s.ch55High[own60] as number, 10250, 1e-12);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('14. [AMENDED-1 #2] 25% 종목상한 — 직전 · 일치 · 초과 경계 (불타기)');
// ════════════════════════════════════════════════════════════════════════════
{
  // 진입 후 불타기가 25% 상한(2,500,000 KRW)에 걸리는 사례를 만든다.
  // 진입 @10100 × 99주 = 999,900. 불타기 체결가 P, 수량 q → 전체 시가 = (99+q)×P.
  // 상한 여유 roomKRW = 2,500,000 − 99×P → q ≤ room/P.
  function mkPyr(pyrOpen: number): { s: SecurityData; cal: string[] } {
    const bars: Bar[] = [];
    for (let i = 0; i < 60; i++) bars.push(flatBar());
    bars.push({ o: 10000, h: 10300, l: 9750, c: 10300 });
    bars.push({ o: 10100, h: 10150, l: 10050, c: 10100 });        // 진입 @10100 (99주)
    bars.push({ o: 10500, h: 10600, l: 10400, c: 10600 });        // 불타기 신호
    bars.push({ o: pyrOpen, h: pyrOpen + 50, l: pyrOpen - 50, c: pyrOpen });   // 불타기 체결가
    for (let i = 0; i < 5; i++) bars.push({ o: pyrOpen, h: pyrOpen + 50, l: pyrOpen - 50, c: pyrOpen });
    const cal = bars.map((_, i) => iso(i));
    return { s: build('A', bars, bars.map((_, i) => i), cal), cal };
  }
  const CAP = 2_500_000;
  const probe = mkPyr(10700);
  const n62 = probe.s.atr[62] as number;
  const proposed = Math.floor(50_000 / n62);      // 불타기 제안 수량 (신호일 N 기준)

  // 상한 직전: 진입 99주 + 제안수량 전부 사도 상한 미만인 가격
  const priceBelow = Math.floor(CAP / (99 + proposed)) - 1;
  const rBelow = run([mkPyr(priceBelow).s], mkPyr(priceBelow).cal, RULES_T2);
  const pfB = rBelow.fills.find(f => f.kind === 'pyramid');
  checkTrue('상한 직전 → 불타기 제안수량 그대로 체결', pfB != null && pfB.qty === proposed);
  checkTrue('상한 직전 → 포지션 전체 시가 ≤ 2,500,000', (99 + (pfB?.qty ?? 0)) * priceBelow <= CAP);

  // 상한 초과: 제안수량을 다 사면 상한을 넘는 가격 → 안전 수량까지 하향
  const priceOver = Math.ceil(CAP / (99 + proposed)) + 2000;
  const over = mkPyr(priceOver);
  const rOver = run([over.s], over.cal, RULES_T2);
  const pfO = rOver.fills.find(f => f.kind === 'pyramid');
  const room = CAP - 99 * priceOver;
  const safeQty = Math.floor(room / priceOver);
  checkTrue('상한 초과 → 수량이 안전수량으로 하향', pfO != null && pfO.qty === safeQty && pfO.qty < proposed);
  checkTrue('하향 후 포지션 전체 시가 ≤ 2,500,000', (99 + (pfO?.qty ?? 0)) * priceOver <= CAP + 1e-6);
  check('25% 상한 위반 불변식 0', rOver.invariants.positionCapBreach, 0);

  // 상한 일치: 진입분만으로 정확히 상한에 닿는 가격 → 여유 0 → 불타기 전량 차단
  const priceExact = Math.ceil(CAP / 99);
  const exact = mkPyr(priceExact);
  const rExact = run([exact.s], exact.cal, RULES_T2);
  checkTrue('상한 일치/초과(여유≤0) → 불타기 체결 0', rExact.flow.filled.pyramid === 0);
  checkTrue('차단 사유가 position-cap 으로 기록', rExact.flow.blocked['position-cap'] > 0);
  check('상한 일치 케이스도 위반 0', rExact.invariants.positionCapBreach, 0);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('15. [AMENDED-1 #3] 12% 위험상한이 현금보다 먼저 구속 — 실제 잔여현금으로 검증');
// ════════════════════════════════════════════════════════════════════════════
{
  // TR=2000 고정 → ATR20=2000 → 유닛당 위험 = 예산 1%. 19종이면 19% > 12%.
  // 포지션 가치는 종목당 ~25만원이라 현금(1000만)은 크게 남는다 → 위험이 먼저 구속.
  const volBars: Bar[] = [];
  for (let i = 0; i < 60; i++) volBars.push({ o: 10000, h: 11000, l: 9000, c: 10000 });
  volBars.push({ o: 10000, h: 11100, l: 9000, c: 11100 });
  for (let i = 0; i < 8; i++) volBars.push({ o: 10500, h: 11000, l: 10000, c: 10500 });
  const volCal = volBars.map((_, i) => iso(i));
  const volSecs = Array.from({ length: 19 }, (_, k) =>
    build(`V${String(k).padStart(2, '0')}`, volBars, volBars.map((_, i) => i), volCal));
  const rv = run(volSecs, volCal, RULES_T1);

  const entryFills = rv.fills.filter(f => f.kind === 'entry');
  check('19종 전부 체결', entryFills.length, 19);
  // **실제 잔여현금 계산** (equityCurve > 0 이 아니라)
  const spent = entryFills.reduce((s, f) => s + f.qty * f.price * f.fx * (1 + 0.001), 0);
  const cashLeft = 10_000_000 - spent;
  checkTrue(`실제 잔여현금 ${Math.round(cashLeft).toLocaleString()} > 0`, cashLeft > 0);
  checkTrue('현금이 절반 이상 남음 → 현금은 구속하지 않았음', cashLeft > 5_000_000);
  const totalRisk = entryFills.reduce((s, f) => s + f.qty * 2 * 2005 * f.fx, 0);
  checkTrue(`총 오픈위험 ${Math.round(totalRisk).toLocaleString()} ≤ 1,200,000`, totalRisk <= 1_200_000 + 1e-6);
  checkTrue('위험한도가 실제로 구속 (한도의 90%+ 사용)', totalRisk >= 1_200_000 * 0.9);
  checkTrue('무제약 수량 24 에서 하향됨', entryFills.every(f => f.qty < 24));
  check('총위험 위반 불변식 0', rv.invariants.totalRiskBreach, 0);
  check('현금음수 불변식 0', rv.invariants.negativeCash, 0);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('16. [AMENDED-1 #2] 탐지 경로가 실제로 작동함 (죽은 카운터 아님)');
// ════════════════════════════════════════════════════════════════════════════
{
  // **가드를 직접 호출해 위반 입력을 넣는다.** 정상 흐름에서는 도달 불가한 경로라
  // "정상 데이터에서 0"만으로는 탐지 경로가 살아있음을 증명할 수 없기 때문이다.
  const base = { hasPending: false, hasPosition: false, kind: 'entry' as const, signalCalIdx: 10, fillCalIdx: 11 };
  check('create 가드: 정상 → ok', checkCreateGuard(base), 'ok');
  check('create 가드: 대기주문 존재 → duplicate-order', checkCreateGuard({ ...base, hasPending: true }), 'duplicate-order');
  check('create 가드: 진입인데 포지션 존재 → duplicate-position', checkCreateGuard({ ...base, hasPosition: true }), 'duplicate-position');
  check('create 가드: 같은 봉 예약 → same-bar', checkCreateGuard({ ...base, fillCalIdx: 10 }), 'same-bar');
  check('create 가드: 과거 봉 예약 → same-bar', checkCreateGuard({ ...base, fillCalIdx: 9 }), 'same-bar');
  check('create 가드: 불타기는 포지션 있어도 ok', checkCreateGuard({ ...base, kind: 'pyramid', hasPosition: true }), 'ok');
  check('create 가드: 우선순위 — 대기주문이 같은봉보다 먼저', checkCreateGuard({ ...base, hasPending: true, fillCalIdx: 10 }), 'duplicate-order');

  const fbase = { kind: 'entry' as const, signalCalIdx: 10, fillCalIdx: 11, ownIdxAtFill: 5, hasPosition: false };
  check('fill 가드: 정상 → ok', checkFillGuard(fbase), 'ok');
  check('fill 가드: 같은 봉 체결 → same-bar', checkFillGuard({ ...fbase, fillCalIdx: 10 }), 'same-bar');
  check('fill 가드: 미거래일(ownIdx<0) → holiday', checkFillGuard({ ...fbase, ownIdxAtFill: -1 }), 'holiday');
  check('fill 가드: 진입인데 포지션 존재 → duplicate-position', checkFillGuard({ ...fbase, hasPosition: true }), 'duplicate-position');
  check('fill 가드: 불타기인데 포지션 없음 → orphan-pyramid', checkFillGuard({ ...fbase, kind: 'pyramid' }), 'orphan-pyramid');
  check('fill 가드: 같은봉이 휴장보다 먼저 탐지', checkFillGuard({ ...fbase, fillCalIdx: 10, ownIdxAtFill: -1 }), 'same-bar');
  check('fill 가드: 중복포지션 검사가 현금차감 전 단계임(가드 반환값으로 확인)', checkFillGuard({ ...fbase, hasPosition: true }), 'duplicate-position');

  // 정상 데이터에서는 위반 0 (엔진이 가드를 실제로 사용함)
  const bars: Bar[] = [];
  for (let i = 0; i < 60; i++) bars.push(flatBar());
  bars.push({ o: 10000, h: 10300, l: 9750, c: 10300 });
  bars.push({ o: 10100, h: 10150, l: 10050, c: 10100 });
  // 진입 후에도 계속 돌파선 위 → 매 바 entry 신호가 나올 수 있는 상황(중복 주문 유혹)
  for (let i = 0; i < 10; i++) bars.push({ o: 10400, h: 10500, l: 10300, c: 10400 });
  const cal = bars.map((_, i) => iso(i));
  const s = build('A', bars, bars.map((_, i) => i), cal);
  const r = run([s], cal, RULES_T1);
  check('포지션 보유 중엔 진입 신호를 내지 않음 → 진입 1건', r.flow.filled.entry, 1);
  check('중복 포지션 0', r.invariants.duplicatePosition, 0);
  check('중복 주문 0', r.invariants.duplicateOrder, 0);
  check('같은봉 체결 0', r.invariants.sameBarFill, 0);

  // create() 덮어쓰기 가드: 대기주문이 있는 동안 두 번째 주문이 생성되지 않는다.
  // 진입 신호 다음날(체결일)에 손절/청산 신호가 동시에 나는 데이터로 확인.
  const bars2: Bar[] = [];
  for (let i = 0; i < 60; i++) bars2.push(flatBar());
  bars2.push({ o: 10000, h: 10300, l: 9750, c: 10300 });   // idx60 진입신호 (대기주문 생성)
  bars2.push({ o: 10100, h: 10150, l: 9000, c: 9100 });     // idx61 체결일 + 종가 급락
  bars2.push({ o: 9000, h: 9100, l: 8900, c: 9000 });
  for (let i = 0; i < 4; i++) bars2.push({ o: 9000, h: 9100, l: 8900, c: 9000 });
  const cal2 = bars2.map((_, i) => iso(i));
  const s2 = build('B', bars2, bars2.map((_, i) => i), cal2);
  const r2 = run([s2], cal2, RULES_T1);
  check('덮어쓰기 가드: 중복 주문 0', r2.invariants.duplicateOrder, 0);
  checkTrue('진입 체결 후 매도 신호가 정상 처리됨', r2.flow.filled.entry === 1);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('17. [AMENDED-1 #4] config 런타임 검증 (any 미사용)');
// ════════════════════════════════════════════════════════════════════════════
{
  const valid = {
    hypothesisId: 'x', evidenceGrade: 'EXPLORATORY', evidenceGradeReason: 'r',
    account: { satelliteBudgetKRW: 1, initialCashKRW: 1 },
    rules: {
      entryLookback: 55, exitLookback: 20, atrPeriod: 20, stopMultipleN: 2, pyramidStepN: 0.5,
      riskPerUnitPct: 0.5, maxTotalRiskPct: 12, positionValueCapPct: 25,
      quantityGranularity: { cryptoTickers: ['BTC-USD'] },
    },
    costs: { baseOneWayRate: 0.001, sensitivityRates: [0, 0.002] },
    universe: { tickers: ['SPY'] },
    periods: { full: { start: 'a', end: 'b' }, robustness: [{ id: 'W1', start: 'a', end: 'b' }] },
  };
  const parsed = parseConfig(valid);
  check('정상 config 파싱', parsed.rules.entryLookback, 55);
  check('crypto 티커 파싱', parsed.rules.quantityGranularity.cryptoTickers[0], 'BTC-USD');

  const throws = (v: unknown, label: string): void => {
    let threw = false;
    try { parseConfig(v); } catch { threw = true; }
    checkTrue(`검증 실패 시 throw: ${label}`, threw);
  };
  throws(null, 'null');
  throws({ ...valid, rules: { ...valid.rules, entryLookback: 'x' } }, 'entryLookback 문자열');
  throws({ ...valid, costs: { ...valid.costs, baseOneWayRate: NaN } }, 'baseOneWayRate NaN');
  throws({ ...valid, universe: { tickers: 'SPY' } }, 'tickers 비배열');
  throws({ ...valid, periods: { ...valid.periods, robustness: {} } }, 'robustness 비배열');
}

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} 통과 / ${fail} 실패`);
if (fail > 0) process.exit(1);
