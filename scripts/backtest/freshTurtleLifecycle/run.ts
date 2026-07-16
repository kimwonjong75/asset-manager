// scripts/backtest/freshTurtleLifecycle/run.ts
// fresh-turtle-lifecycle-v1 실행 드라이버 (CLI — console 허용, gate0Audit 관례).

import { configHash } from './configHash';
import { parseConfig } from './configTypes';
import { loadData } from './data';
import { runBacktest, StrategyRules, RunResult, CompletedTrade } from './engine';

const { hash, config } = configHash();
const C = parseConfig(config);   // unknown → 런타임 검증 후 타입 확정 (any 미사용)

const TICKERS: string[] = C.universe.tickers;
const CRYPTO: string[] = C.rules.quantityGranularity.cryptoTickers;
const BASE_COST: number = C.costs.baseOneWayRate;
const COSTS: number[] = [0, BASE_COST, ...C.costs.sensitivityRates.filter(r => r !== 0)].sort((a, b) => a - b);

function rules(maxUnits: number, pyramid: boolean, cost: number): StrategyRules {
  return {
    entryLookback: C.rules.entryLookback, exitLookback: C.rules.exitLookback,
    atrPeriod: C.rules.atrPeriod, stopMultipleN: C.rules.stopMultipleN,
    pyramidStepN: C.rules.pyramidStepN, riskPerUnitPct: C.rules.riskPerUnitPct,
    maxTotalRiskPct: C.rules.maxTotalRiskPct, positionValueCapPct: C.rules.positionValueCapPct,
    maxUnitsPerPosition: maxUnits, pyramidEnabled: pyramid,
    budgetKRW: C.account.satelliteBudgetKRW, initialCashKRW: C.account.initialCashKRW,
    costOneWay: cost,
  };
}

function pct(x: number): string { return (x * 100).toFixed(2) + '%'; }
function krw(x: number): string { return Math.round(x).toLocaleString('en-US'); }
function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function profitFactor(ts: CompletedTrade[]): number {
  const g = ts.filter(t => t.netPnlKRW > 0).reduce((s, t) => s + t.netPnlKRW, 0);
  const l = Math.abs(ts.filter(t => t.netPnlKRW < 0).reduce((s, t) => s + t.netPnlKRW, 0));
  return l > 0 ? g / l : (g > 0 ? Infinity : 0);
}

console.log('='.repeat(100));
console.log('fresh-turtle-lifecycle-v1 — T1(1유닛) vs T2(불타기 1회)   [EXPLORATORY]');
console.log('='.repeat(100));
console.log(`설정 해시 (결과 확인 전 동결): ${hash}`);
console.log(`전체 기간: ${C.periods.full.start} ~ ${C.periods.full.end}`);
console.log(`계좌: 위성예산 ${krw(C.account.satelliteBudgetKRW)} KRW 전액 현금 시작 · 외부입출금·리밸런싱·트림·낙폭축소 없음`);
console.log(`비용: 기본 편도 ${BASE_COST} (연구용 가정 — 실제 증권사 비용 아님) · 민감도 ${JSON.stringify(C.costs.sensitivityRates)}`);
console.log(`증거등급: ${C.evidenceGrade} — ${C.evidenceGradeReason}\n`);

// ── 데이터 ──
const data = loadData({
  tickers: TICKERS, cryptoTickers: CRYPTO,
  start: C.periods.full.start, end: C.periods.full.end,
  atrPeriod: C.rules.atrPeriod, entryLookback: C.rules.entryLookback, exitLookback: C.rules.exitLookback,
});
if (data.missing.length > 0) {
  console.error('✗ 필수 데이터 손상/누락 — 실행 중단. 누락 항목:');
  for (const m of data.missing) console.error(`   - ${m.ticker}: ${m.detail}`);
  process.exit(1);
}
console.log(`데이터: ${data.securities.length}종 · 달력 ${data.calendar.length}일 (${data.calendar[0]} ~ ${data.calendar[data.calendar.length - 1]}) · 환율 KRW=X 정렬 완료`);

// AMENDED-1 #1: 비정상 행은 실제 거래일로 취급하지 않고 제거 — 제거 내역을 명시한다.
console.log(`\n── 제외된 비정상 OHLC 행 (실제 거래일로 취급하지 않음) ──`);
if (data.excludedRows.length === 0) console.log('   없음');
else for (const e of data.excludedRows) console.log(`   ${e.ticker.padEnd(9)} ${e.date}  사유=${e.reason}`);
console.log(`   합계 ${data.excludedRows.length}행 — 이 행들은 ATR·55/20 채널 계산에서도 세지 않으며, 신호 다음날이 이 행이면 건너뛰고 다음 유효 시가에 체결한다.\n`);

const run = (maxUnits: number, pyr: boolean, cost: number, s: string, e: string): RunResult =>
  runBacktest({ calendar: data.calendar, securities: data.securities, fx: data.fx, rules: rules(maxUnits, pyr, cost), windowStart: s, windowEnd: e });

const FULL_S = C.periods.full.start, FULL_E = C.periods.full.end;
const t1 = run(1, false, BASE_COST, FULL_S, FULL_E);
const t2 = run(2, true, BASE_COST, FULL_S, FULL_E);

// ── 3. T1·T2 비교표 ──
console.log('── T1 vs T2 (전체기간, 기본비용 0.1%) ──');
console.log('   지표                  |            T1 |            T2');
console.log('   ' + '-'.repeat(50));
const row = (label: string, a: string, b: string): void => console.log(`   ${label.padEnd(21)} | ${a.padStart(13)} | ${b.padStart(13)}`);
row('CAGR', pct(t1.cagr), pct(t2.cagr));
row('총수익률', pct(t1.totalReturn), pct(t2.totalReturn));
row('MDD', pct(t1.mdd), pct(t2.mdd));
row('Calmar', t1.calmar.toFixed(3), t2.calmar.toFixed(3));
row('평균 R', mean(t1.trades.map(t => t.r)).toFixed(3), mean(t2.trades.map(t => t.r)).toFixed(3));
row('중앙 R', median(t1.trades.map(t => t.r)).toFixed(3), median(t2.trades.map(t => t.r)).toFixed(3));
row('최대 R', Math.max(...t1.trades.map(t => t.r)).toFixed(1), Math.max(...t2.trades.map(t => t.r)).toFixed(1));
row('Profit Factor', profitFactor(t1.trades).toFixed(3), profitFactor(t2.trades).toFixed(3));
row('완료거래 수', String(t1.trades.length), String(t2.trades.length));
row('실제 노출도', pct(t1.meanExposure), pct(t2.meanExposure));
row('매매비용(KRW)', krw(t1.totalCostKRW), krw(t2.totalCostKRW));
row('최종 평가액(KRW)', krw(t1.finalEquityKRW), krw(t2.finalEquityKRW));
row('불타기 체결', String(t1.pyramidFills), String(t2.pyramidFills));

// ── 4. 신호 흐름표 ──
console.log('\n── 신호 흐름 (전체기간, 기본비용) ──');
for (const [name, r] of [['T1', t1], ['T2', t2]] as [string, RunResult][]) {
  console.log(`   [${name}] 가격조건 발생 → 주문 생성 → 실제 체결`);
  for (const k of ['entry', 'pyramid', 'stop', 'exit'] as const) {
    console.log(`      ${k.padEnd(8)} : ${String(r.flow.priceCondition[k]).padStart(5)} → ${String(r.flow.orderCreated[k]).padStart(5)} → ${String(r.flow.filled[k]).padStart(5)}`);
  }
  const b = r.flow.blocked;
  console.log(`      차단/취소 사유: ${Object.entries(b).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join(' · ') || '없음'}`);
}

// ── 5. 구간 · 비용 ──
console.log('\n── 비용 민감도 (전체기간) ──');
console.log('   비용     |   T1 CAGR |   T2 CAGR |  Δ(T2−T1) |  T1 평균R |  T2 평균R | T1거래 | T2거래');
console.log('   ' + '-'.repeat(88));
const byCost = new Map<number, { a: RunResult; b: RunResult }>();
for (const c of COSTS) {
  const a = run(1, false, c, FULL_S, FULL_E);
  const b = run(2, true, c, FULL_S, FULL_E);
  byCost.set(c, { a, b });
  console.log(`   ${String(c).padEnd(8)} | ${pct(a.cagr).padStart(9)} | ${pct(b.cagr).padStart(9)} | ${pct(b.cagr - a.cagr).padStart(9)} | ${mean(a.trades.map(t => t.r)).toFixed(3).padStart(9)} | ${mean(b.trades.map(t => t.r)).toFixed(3).padStart(9)} | ${String(a.trades.length).padStart(6)} | ${String(b.trades.length).padStart(6)}`);
}

console.log('\n── 강건성 구간 (각각 현금 상태 독립 실행, 기본비용) ──');
console.log('   구간 | 기간                    |   T1 CAGR |   T2 CAGR |  Δ(T2−T1) |  T1 평균R |  T2 평균R | T1거래 | T2거래');
console.log('   ' + '-'.repeat(104));
const windows: { a: RunResult; b: RunResult; id: string }[] = [];
for (const w of C.periods.robustness) {
  const a = run(1, false, BASE_COST, w.start, w.end);
  const b = run(2, true, BASE_COST, w.start, w.end);
  windows.push({ a, b, id: w.id });
  console.log(`   ${w.id}   | ${w.start} ~ ${w.end} | ${pct(a.cagr).padStart(9)} | ${pct(b.cagr).padStart(9)} | ${pct(b.cagr - a.cagr).padStart(9)} | ${mean(a.trades.map(t => t.r)).toFixed(3).padStart(9)} | ${mean(b.trades.map(t => t.r)).toFixed(3).padStart(9)} | ${String(a.trades.length).padStart(6)} | ${String(b.trades.length).padStart(6)}`);
}

// ── 6. 최대 기여 종목 제거 ──
console.log('\n── 종목별 기여 (전체기간, 기본비용) ──');
console.log('   종목      | T1 거래 |    T1 순손익 | T2 거래 |    T2 순손익 | T2−T1 증분');
console.log('   ' + '-'.repeat(74));
const pnlBy = (r: RunResult, t: string): number => r.trades.filter(x => x.ticker === t).reduce((s, x) => s + x.netPnlKRW, 0);
const incrBy = new Map<string, number>();
for (const t of TICKERS) {
  const a = pnlBy(t1, t), b = pnlBy(t2, t);
  incrBy.set(t, b - a);
  console.log(`   ${t.padEnd(9)} | ${String(t1.trades.filter(x => x.ticker === t).length).padStart(7)} | ${krw(a).padStart(12)} | ${String(t2.trades.filter(x => x.ticker === t).length).padStart(7)} | ${krw(b).padStart(12)} | ${krw(b - a).padStart(11)}`);
}
const totalIncr = [...incrBy.values()].reduce((s, v) => s + v, 0);
let maxIncrTicker = '', maxIncrAbs = -1;
for (const [t, v] of incrBy) if (Math.abs(v) > maxIncrAbs) { maxIncrAbs = Math.abs(v); maxIncrTicker = t; }
const maxIncrShare = totalIncr !== 0 ? Math.abs(incrBy.get(maxIncrTicker)!) / Math.abs(totalIncr) : 0;
console.log(`   T2 증분손익 합계 ${krw(totalIncr)} · 최대 증분기여 종목 ${maxIncrTicker} (${krw(incrBy.get(maxIncrTicker)!)}, 비중 ${pct(maxIncrShare)})`);

// 최대 기여 종목 제거 후 재실행
const looSecs = data.securities.filter(s => s.ticker !== maxIncrTicker);
const looT1 = runBacktest({ calendar: data.calendar, securities: looSecs, fx: data.fx, rules: rules(1, false, BASE_COST), windowStart: FULL_S, windowEnd: FULL_E });
const looT2 = runBacktest({ calendar: data.calendar, securities: looSecs, fx: data.fx, rules: rules(2, true, BASE_COST), windowStart: FULL_S, windowEnd: FULL_E });
console.log(`   ${maxIncrTicker} 제거: T1 CAGR ${pct(looT1.cagr)} · T2 CAGR ${pct(looT2.cagr)} · Δ ${pct(looT2.cagr - looT1.cagr)} · T1 평균R ${mean(looT1.trades.map(t => t.r)).toFixed(3)}`);

// ── 7. 안전 불변식 ──
console.log('\n── 안전·회계 불변식 ──');
const invSum = (r: RunResult): number => Object.values(r.invariants).reduce((s, v) => s + v, 0);
for (const [name, r] of [['T1', t1], ['T2', t2]] as [string, RunResult][]) {
  const i = r.invariants;
  console.log(`   [${name}] 현금음수 ${i.negativeCash} · 예산음수 ${i.negativeBudget} · 25%초과 ${i.positionCapBreach} · 12%초과 ${i.totalRiskBreach} · 유닛초과 ${i.maxUnitsBreach} · 중복포지션 ${i.duplicatePosition} · 중복주문 ${i.duplicateOrder} · 같은봉체결 ${i.sameBarFill} · 휴장체결 ${i.holidayFill}  → 합계 ${invSum(r)}`);
}

// ── 8. 미실현 ──
console.log('\n── 종료 시 미청산 포지션 (강제청산 없음) ──');
for (const [name, r] of [['T1', t1], ['T2', t2]] as [string, RunResult][]) {
  console.log(`   [${name}] ${r.openPositionsAtEnd.length}종 · 미실현손익 ${krw(r.unrealizedKRW)} KRW`);
  for (const p of r.openPositionsAtEnd) console.log(`      ${p.ticker.padEnd(9)} ${p.units}유닛 · 미실현 ${krw(p.unrealizedKRW)}`);
}

// ════════════════════════════════════════════════════════════════════
// 고정 판정 기준 (동결 §adoptionCriteria — 결과 후 변경 없음)
// ════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(100));
console.log('고정 판정 기준');
console.log('='.repeat(100));

const t1R = mean(t1.trades.map(t => t.r));
const t1R2x = mean(byCost.get(0.002)!.a.trades.map(t => t.r));
const t1WinR = windows.filter(w => mean(w.a.trades.map(t => t.r)) > 0).length;
const t1Inv = invSum(t1) === 0;

console.log('\n[T1 신규진입 신호 사용 조건]');
const t1c1 = t1.trades.length >= 30;
console.log(`   완료거래 ≥ 30건                  : ${t1c1 ? 'PASS' : 'FAIL'} (${t1.trades.length}건)`);
if (!t1c1) {
  console.log('   → 완료거래 30건 미만 → INCONCLUSIVE 종료 (설정 변경·종목 추가 금지)');
}
const t1c2 = t1R > 0;
const t1c3 = t1R2x > 0;
const t1c4 = t1.cagr > 0;
const t1c5 = t1WinR >= 2;
console.log(`   기본비용 평균 순손익 R > 0        : ${t1c2 ? 'PASS' : 'FAIL'} (${t1R.toFixed(3)})`);
console.log(`   2배비용 평균 순손익 R > 0         : ${t1c3 ? 'PASS' : 'FAIL'} (${t1R2x.toFixed(3)})`);
console.log(`   기본비용 CAGR > 0                 : ${t1c4 ? 'PASS' : 'FAIL'} (${pct(t1.cagr)})`);
console.log(`   3구간 중 ≥2 에서 평균 R > 0       : ${t1c5 ? 'PASS' : 'FAIL'} (${t1WinR}/3)`);
console.log(`   회계·안전 불변식 위반 0           : ${t1Inv ? 'PASS' : 'FAIL'} (${invSum(t1)}건)`);
const T1_PASS = t1c1 && t1c2 && t1c3 && t1c4 && t1c5 && t1Inv;
const T1_INCONCLUSIVE = !t1c1;
console.log(`   → T1 판정: ${T1_INCONCLUSIVE ? 'INCONCLUSIVE' : T1_PASS ? 'PASS' : 'FAIL'}`);

console.log('\n[T2 불타기 채택 조건]');
const t2Pyr = t2.pyramidFills;
const t2c0 = T1_PASS;
const t2c1 = t2Pyr >= 20;
const dCagrBase = t2.cagr - t1.cagr;
const c2x = byCost.get(0.002)!;
const dCagr2x = c2x.b.cagr - c2x.a.cagr;
const t2c2 = dCagrBase >= 0.01;
const t2c3 = dCagr2x > 0;
const t2c4 = t2.calmar > t1.calmar;
const t2c5 = t2.mdd - t1.mdd <= 0.02;
const t2WinD = windows.filter(w => w.b.cagr - w.a.cagr > 0).length;
const t2c6 = t2WinD >= 2;
const t2c7 = looT2.cagr - looT1.cagr > 0;
const t2c8 = maxIncrShare <= 0.5;
const t2Inv = invSum(t2) === 0;
console.log(`   T1 통과가 선결                    : ${t2c0 ? 'PASS' : 'FAIL'}`);
console.log(`   실제 불타기 체결 ≥ 20건           : ${t2c1 ? 'PASS' : 'FAIL'} (${t2Pyr}건)`);
if (!t2c1) console.log('   → 불타기 체결 20건 미만 → INCONCLUSIVE, 불타기 기본 OFF');
console.log(`   기본비용 ΔCAGR ≥ +1.0%p           : ${t2c2 ? 'PASS' : 'FAIL'} (${pct(dCagrBase)})`);
console.log(`   2배비용 ΔCAGR > 0                 : ${t2c3 ? 'PASS' : 'FAIL'} (${pct(dCagr2x)})`);
console.log(`   T2 Calmar > T1 Calmar             : ${t2c4 ? 'PASS' : 'FAIL'} (${t2.calmar.toFixed(3)} vs ${t1.calmar.toFixed(3)})`);
console.log(`   T2 MDD 악화 ≤ 2.0%p               : ${t2c5 ? 'PASS' : 'FAIL'} (${pct(t2.mdd - t1.mdd)})`);
console.log(`   3구간 중 ≥2 에서 ΔCAGR > 0        : ${t2c6 ? 'PASS' : 'FAIL'} (${t2WinD}/3)`);
console.log(`   최대 증분기여 종목 제거 후 Δ > 0   : ${t2c7 ? 'PASS' : 'FAIL'} (${pct(looT2.cagr - looT1.cagr)})`);
console.log(`   한 종목이 증분손익 50% 초과 안 함  : ${t2c8 ? 'PASS' : 'FAIL'} (${maxIncrTicker} ${pct(maxIncrShare)})`);
console.log(`   회계·안전 불변식 위반 0           : ${t2Inv ? 'PASS' : 'FAIL'} (${invSum(t2)}건)`);
const T2_INCONCLUSIVE = !t2c1;
const T2_PASS = t2c0 && t2c1 && t2c2 && t2c3 && t2c4 && t2c5 && t2c6 && t2c7 && t2c8 && t2Inv;
console.log(`   → T2 판정: ${T2_INCONCLUSIVE ? 'INCONCLUSIVE' : T2_PASS ? 'PASS' : 'FAIL'}`);

console.log('\n' + '='.repeat(100));
const verdict = T1_INCONCLUSIVE || !T1_PASS
  ? '신규진입 추천 보류 / 불타기 끔'
  : T2_PASS ? '신규진입 신호 사용 / 불타기 켬' : '신규진입 신호 사용 / 불타기 끔';
console.log(`최종 판정: ${verdict}`);
console.log('("신호 사용" = 관찰용 매수 후보로 사용 가능. 실제 주문 자동승인 아님.)');
console.log('='.repeat(100));
