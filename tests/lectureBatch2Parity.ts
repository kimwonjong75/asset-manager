// tests/lectureBatch2Parity.ts
// ---------------------------------------------------------------------------
// 2차 배치(D4 보유열화 H3/H4/H5 · D5 런치패드 · D6 동적자산배분) 골든/불변식 테스트.
//
// RULES §13: 명시적 **절대 골든값**을 손계산해 못박는다. 경로A-vs-경로B 자기참조 금지.
//   · H3 변동성비는 독립 폐형식(√(63/20) 등)으로 유도한 값을 고정한다.
//   · H5 상태기계는 8개 종가의 전개를 손으로 따라가 완료일 index를 못박는다.
//   · DAA 체결 타이밍은 "전일종가→시가(구 비중) / 시가→종가(신 비중)"로 쪼갠 수익률을
//     손계산해 고정한다 — 같은 봉(신호일) 체결이나 종가체결이면 값이 달라져 실패한다.
//
// 실행: npx tsx tests/lectureBatch2Parity.ts   (package.json 등록하지 않음)
// ---------------------------------------------------------------------------

import type { SecurityBars } from '../scripts/backtest/lectureSignals/configTypes';
import {
  DETERIORATION_CONST,
  boomBustCompletions,
  boomBustCountAt,
  h3ConditionAt,
  h3VolRatio,
  h4ConditionAt,
  isUpperWickDay,
  makeH5Condition,
  upperWickCount,
} from '../scripts/backtest/lectureSignals/deterioration';
import {
  LAUNCHPAD_CONST,
  isBreakoutAt,
  launchpadConditionAt,
  launchpadSeriesOf,
  launchpadThresholdPct,
  maCompressionPct,
  priorHigh,
} from '../scripts/backtest/lectureSignals/launchpad';
import { scanCrossingEvents, factorDecomposition } from '../scripts/backtest/lectureSignals/batch2Common';
import { FACTOR_DECOMP_AXES } from '../scripts/backtest/lectureSignals/pipeline';
import type { PriceTable, Weights } from '../scripts/backtest/lectureSignals/daa';
import {
  DAA_ASSUMPTIONS,
  bondDaaWeights,
  dualMomentumSignal,
  dualOriginalWeights,
  dualVariantWeights,
  isAnnualRebalance,
  momentum,
  monthlyRebalanceDays,
  simulate,
  yearlyReturns,
} from '../scripts/backtest/lectureSignals/daa';

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const ok = Object.is(actual, expected);
  if (ok) pass++;
  else {
    fail++;
    console.error(`  x ${name}\n      기대=${String(expected)} 실제=${String(actual)}`);
  }
}
function checkClose(name: string, actual: number, expected: number, tol = 1e-9): void {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
  if (ok) pass++;
  else {
    fail++;
    console.error(`  x ${name}\n      기대=${expected} 실제=${actual} (tol ${tol})`);
  }
}
function checkArr(name: string, actual: readonly number[], expected: readonly number[]): void {
  const ok = actual.length === expected.length && actual.every((v, i) => Object.is(v, expected[i]));
  if (ok) pass++;
  else {
    fail++;
    console.error(`  x ${name}\n      기대=[${expected.join(',')}] 실제=[${actual.join(',')}]`);
  }
}

/** 테스트 전용 SecurityBars 조립. */
function makeBars(
  code: string,
  adjClose: number[],
  opts: Partial<{
    adjOpen: number[];
    adjHigh: number[];
    adjLow: number[];
    adjVolume: number[];
    amount: number[];
    market: string[];
    dates: string[];
  }> = {}
): SecurityBars {
  const dates = opts.dates ?? adjClose.map((_, i) => `D${String(i).padStart(4, '0')}`);
  const dateIndex = new Map<string, number>();
  dates.forEach((d, i) => dateIndex.set(d, i));
  return {
    code,
    name: code,
    dates,
    adjClose,
    adjOpen: opts.adjOpen ?? [...adjClose],
    adjHigh: opts.adjHigh ?? [...adjClose],
    adjLow: opts.adjLow ?? [...adjClose],
    adjVolume: opts.adjVolume ?? adjClose.map(() => 100),
    amount: opts.amount ?? adjClose.map(() => 1e9),
    market: opts.market ?? adjClose.map(() => 'KOSPI'),
    dateIndex,
  };
}

/** 수익률 시퀀스에서 종가 시계열 생성(close[0]=base). rets[t]는 t번째 바의 수익률(t>=1). */
function closesFromReturns(base: number, rets: readonly number[]): number[] {
  const out = [base];
  for (const r of rets) out.push(out[out.length - 1] * (1 + r));
  return out;
}

console.log('2차 배치(D4 보유열화 · D5 런치패드 · D6 자산배분) 골든/불변식 테스트\n');

// ════════════════════════════════════════════════════════════════════════════
console.log('1. H3 롤링 변동성비 — 폐형식 골든 + 1.5배 경계 + 당일 제외');
{
  // i=64 에서 realizedVol(·,20)은 수익률 t∈[44,63], realizedVol(·,63)은 t∈[1,63].
  // 두 창 모두 **당일(i=64) 종가를 쓰지 않는다**(당일 제외 규약).
  const a = 0.01;
  // (A) 앞 43개 수익률 0, 뒤 20개 ±a 교대  →  sd20 = a, sd63 = a√(20/63)
  //     ⇒ 비율 = √(63/20) = 1.7748239349… (독립 폐형식)
  const retsA: number[] = [];
  for (let t = 1; t <= 43; t++) retsA.push(0);
  for (let t = 44; t <= 63; t++) retsA.push(t % 2 === 0 ? a : -a);
  const closeA = closesFromReturns(100, retsA); // length 64 (index 0..63)
  closeA.push(closeA[63] * 1.5); // index 64 = 당일 D (지표에 쓰이면 안 됨)
  const ratioA = h3VolRatio(closeA, 64) as number;
  checkClose('H3 비율 = √(63/20)', ratioA, Math.sqrt(63 / 20), 1e-8);
  check('H3 1.774 ≥ 1.5 → true', h3ConditionAt(closeA, 64), true);

  // 당일 종가를 크게 바꿔도 비율이 불변이어야 한다(룩어헤드/당일오염 방지).
  const closeA2 = [...closeA];
  closeA2[64] = closeA[63] * 0.2;
  checkClose('H3 당일 종가 무관(당일 제외)', h3VolRatio(closeA2, 64) as number, ratioA, 1e-12);

  // (B) 경계: 앞 42개 ±c 교대 + 1개 0, 뒤 20개 ±a 교대 (모두 합 0)
  //     sd20 = a, sd63 = √((42c²+20a²)/63) ⇒ 비율 1.5가 되는 c* = a·√(4/21)
  const cStar = a * Math.sqrt(4 / 21);
  const build = (c: number): number[] => {
    const r: number[] = [];
    for (let t = 1; t <= 42; t++) r.push(t % 2 === 0 ? c : -c);
    r.push(0); // t=43
    for (let t = 44; t <= 63; t++) r.push(t % 2 === 0 ? a : -a);
    const cl = closesFromReturns(100, r);
    cl.push(cl[cl.length - 1]);
    return cl;
  };
  checkClose('H3 c=c* → 비율 정확히 1.5', h3VolRatio(build(cStar), 64) as number, 1.5, 1e-8);
  // c가 커지면 분모(63일 변동성)가 커져 비율이 내려간다.
  check('H3 c=1.02·c* → 1.5 미만 → false', h3ConditionAt(build(cStar * 1.02), 64), false);
  check('H3 c=0.98·c* → 1.5 초과 → true', h3ConditionAt(build(cStar * 0.98), 64), true);

  // 창 부족 → null(판정불가)
  check('H3 창부족 → null', h3ConditionAt(closeA, 60), null);
  check('H3 상수 = 1.5배', DETERIORATION_CONST.h3Multiple, 1.5);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('2. H4 윗꼬리 군집 — 5% 경계 · 60일 창 경계 · "5회 초과" 경계');
{
  // (hi-cl)/hi >= 5%
  const b1 = makeBars('W', [95, 95], { adjHigh: [100, 100] });
  check('윗꼬리 정확히 5% → true', isUpperWickDay(b1, 0), true);
  const b2 = makeBars('W', [95.01, 95.01], { adjHigh: [100, 100] });
  check('윗꼬리 4.99% → false', isUpperWickDay(b2, 0), false);
  const b3 = makeBars('W', [100], { adjHigh: [0] });
  check('adjHigh<=0 → false', isUpperWickDay(b3, 0), false);

  // 60일 창 [i-59, i] 안에 정확히 5개 → count>5 실패, 6개 → 성공
  const mk = (wickIdx: readonly number[], n = 61): SecurityBars => {
    const close = new Array(n).fill(100);
    const high = new Array(n).fill(100);
    for (const k of wickIdx) high[k] = 200; // (200-100)/200 = 50% ≥ 5%
    return makeBars('W', close, { adjHigh: high });
  };
  const five = mk([55, 56, 57, 58, 59]);
  check('60일 창 윗꼬리 5개 count', upperWickCount(five, 60), 5);
  check('5개 → "5회 초과" 아님 → false', h4ConditionAt(five, 60), false);
  const six = mk([54, 55, 56, 57, 58, 59]);
  check('60일 창 윗꼬리 6개 count', upperWickCount(six, 60), 6);
  check('6개 → true', h4ConditionAt(six, 60), true);

  // 창 밖(i-60)에 있는 윗꼬리는 세지 않는다. i=60 창 = [1,60].
  const outside = mk([0, 54, 55, 56, 57, 58]); // index 0 은 창 밖
  check('창 밖(i-60) 윗꼬리 제외 → 5개', upperWickCount(outside, 60), 5);
  check('창 밖 제외로 false', h4ConditionAt(outside, 60), false);

  check('H4 창부족 → null', upperWickCount(mk([], 61), 58), null);
  check('H4 임계 5회 초과', DETERIORATION_CONST.h4CountThreshold, 5);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('3. H5 붐버스트 상태기계 — 손계산 골든 + 비미래참조 + 창 경계');
{
  // 손계산 전개(러닝저점×1.5 상향 → 러닝고점×0.7 하향 = 1사이클):
  //  t0 100  UP  runLow=100
  //  t1  90  UP  runLow=90              (90 < 135)
  //  t2 135  UP→DOWN  135 ≥ 90×1.5=135  runHigh=135
  //  t3 200  DOWN runHigh=200
  //  t4 140  DOWN→완료  140 ≤ 200×0.7   ★사이클1 완료 index=4, runLow=140
  //  t5 130  UP  runLow=130
  //  t6 195  UP→DOWN  195 ≥ 130×1.5=195 runHigh=195
  //  t7 136  DOWN→완료  136 ≤ 195×0.7=136.5 ★사이클2 완료 index=7
  const close = [100, 90, 135, 200, 140, 130, 195, 136];
  checkArr('H5 완료 사이클 index = [4,7]', boomBustCompletions(close), [4, 7]);

  // 비미래참조: 접두사만 줘도 그 시점까지의 완료 index가 동일해야 한다.
  checkArr('H5 접두사[0..4] → [4]', boomBustCompletions(close.slice(0, 5)), [4]);
  checkArr('H5 접두사[0..6] → [4]', boomBustCompletions(close.slice(0, 7)), [4]);
  checkArr('H5 접두사[0..3] → []', boomBustCompletions(close.slice(0, 4)), []);

  // +50% 직전(미달)이면 사이클이 시작되지 않는다(러닝저점 90 → 임계 135, 최고가 134.9).
  checkArr('H5 +49.9%는 미발동', boomBustCompletions([100, 90, 134.9, 134, 130]), []);
  // 같은 계열에서 나중에 135 이상이 나오면 그때 발동한다(러닝저점은 90 유지).
  checkArr('H5 이후 135 도달 시 발동→완료', boomBustCompletions([100, 90, 134.9, 200, 140]), [4]);
  // -30% 직전(미달)이면 완료되지 않는다. 200×0.7=140 → 140.1 은 미완료.
  checkArr('H5 -29.9%는 미완료', boomBustCompletions([100, 90, 135, 200, 140.1]), []);

  // 창 경계: completions=[4,7], i=7
  check('H5 창 252 → 2건', boomBustCountAt([4, 7], 7, 252), 2);
  check('H5 창 4 → [4,7] 포함 2건', boomBustCountAt([4, 7], 7, 4), 2);
  check('H5 창 3 → [5,7]만 → 1건', boomBustCountAt([4, 7], 7, 3), 1);

  // 웜업 가드: i < 251 이면 null(부분창 오탐 방지)
  const cond = makeH5Condition(new Array(400).fill(100));
  check('H5 i=250 → null(웜업)', cond(250), null);
  check('H5 i=251 → 판정 가능(false)', cond(251), false);
  check('H5 상수(252일/2사이클)', `${DETERIORATION_CONST.h5Window}/${DETERIORATION_CONST.h5CycleThreshold}`, '252/2');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('4. 이벤트화 — 상향 전이(crossing) + 중복제거 규약');
{
  // cond: index 5,6,7 과 9,20,21 에서 true
  const trueAt = new Set([5, 6, 7, 9, 20, 21]);
  const bars = makeBars('X', new Array(40).fill(100));
  const cond = (i: number): boolean | null => (i < 1 ? null : trueAt.has(i));
  // dedup=10 → 5에서 발화, 15까지 차단 → 9 무시, 20 발화, 21 무시
  const evs = scanCrossingEvents(bars, cond, 10, 0, 39, () => true);
  checkArr(
    '전이+중복제거(dedup10) → barIndex [5,20]',
    evs.map((e) => e.barIndex),
    [5, 20]
  );
  // cond(i-1)===null 인 경계는 발화하지 않는다(보수적).
  const cond2 = (i: number): boolean | null => (i === 0 ? null : i === 1 ? true : false);
  check('cond(i-1)=null 경계 미발화', scanCrossingEvents(bars, cond2, 5, 0, 39, () => true).length, 0);
  // 자격 미달 바는 발화하지 않고 **중복제거 차단창도 시작하지 않는다**.
  // i=5 탈락 → 6·7은 전이 아님(직전이 true) → 8에서 false로 내려간 뒤 9가 새 전이로 발화.
  // 9 발화로 19까지 차단 → 20 발화, 21은 전이 아님.
  const evs3 = scanCrossingEvents(bars, cond, 10, 0, 39, (i) => i !== 5);
  checkArr(
    '자격 미달일(5) 제외 → [9,20]',
    evs3.map((e) => e.barIndex),
    [9, 20]
  );
}

// ════════════════════════════════════════════════════════════════════════════
console.log('5. §5.6 분해 축 12개 — batch2Common 축 배열 일치(P0-1 재발 방지)');
{
  check('FACTOR_DECOMP_AXES 12축', FACTOR_DECOMP_AXES.length, 12);
  check('ret5Tertile 포함', FACTOR_DECOMP_AXES.includes('ret5Tertile'), true);
  check('vol20Tertile 포함', FACTOR_DECOMP_AXES.includes('vol20Tertile'), true);
  // 빈 이벤트로 호출해도 축 검증(불일치 시 throw)을 통과하고 12축을 돌려준다.
  const decomp = factorDecomposition([], 63);
  checkArr(
    'batch2 분해 축 개수 12',
    [decomp.length],
    [12]
  );
  check(
    'batch2 분해 축 순서 == §5.6 선언',
    decomp.map((d) => d.axis).join(','),
    FACTOR_DECOMP_AXES.join(',')
  );
}

// ════════════════════════════════════════════════════════════════════════════
console.log('6. 런치패드 수렴(maCompression) — 5% 경계 골든');
{
  // close[0..74]=110, close[75..149]=100, i=149:
  //   MA20  = mean[130..149] = 100
  //   MA60  = mean[90..149]  = 100
  //   MA150 = (75×110 + 75×100)/150 = 105
  //   compression = (105-100)/100×100 = 5.00 (정확)
  const mk = (early: number): number[] => {
    const c: number[] = [];
    for (let i = 0; i < 75; i++) c.push(early);
    for (let i = 75; i < 150; i++) c.push(100);
    return c;
  };
  checkClose('maCompression 정확히 5.00%', maCompressionPct(mk(110), 149) as number, 5, 1e-12);
  const bars5 = makeBars('L', mk(110));
  check('수렴 5.0 ≤ 5 → 통과(경계 포함)', (maCompressionPct(bars5.adjClose, 149) as number) <= 5, true);
  // early=110.2 → MA150 = 0.5×110.2+50 = 105.1 → compression 5.10%
  checkClose('maCompression 5.10%', maCompressionPct(mk(110.2), 149) as number, 5.1, 1e-12);
  check('수렴 5.1 > 5 → 탈락', (maCompressionPct(mk(110.2), 149) as number) <= 5, false);
  // early=110 이고 close[i]=100 이므로 3% 임계는 탈락, 7% 임계는 통과
  check('임계 3%/5%/7% 매핑', `${launchpadThresholdPct('LAUNCHPAD_C3')}/${launchpadThresholdPct('LAUNCHPAD_C5')}/${launchpadThresholdPct('LAUNCHPAD_C7')}`, '3/5/7');
  check('MA150 창부족 → null', maCompressionPct(mk(110), 148), null);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('7. 런치패드 돌파 — 가격 경계 · 거래량 경계');
{
  const n = 30;
  const close = new Array(n).fill(100);
  const high = new Array(n).fill(100);
  const vol = new Array(n).fill(100);
  // 직전 20일([i-20, i-1] = [5,24]) 중 고점 120
  const i = 25;
  high[10] = 120;
  checkClose('priorHigh([5,24]) = 120', priorHigh(makeBars('B', close, { adjHigh: high }), i) as number, 120);

  // 가격 경계: 종가 120 → 초과 아님(> 엄격), 120.01 → 초과
  const mkB = (c: number, v: number): SecurityBars => {
    const cl = [...close];
    cl[i] = c;
    const vv = [...vol];
    vv[i] = v;
    return makeBars('B', cl, { adjHigh: high, adjVolume: vv });
  };
  check('종가=직전고점 → 돌파 아님', isBreakoutAt(mkB(120, 300), i), false);
  check('종가>직전고점 → 돌파', isBreakoutAt(mkB(120.01, 300), i), true);

  // 거래량 경계: 직전20일 평균 100 → 임계 200
  check('거래량 200 = 2× → 돌파(경계 포함)', isBreakoutAt(mkB(130, 200), i), true);
  check('거래량 199.9 → 미달', isBreakoutAt(mkB(130, 199.9), i), false);
  check('돌파 창부족 → null', isBreakoutAt(mkB(130, 300), 5), null);
  check('LAUNCHPAD 상수(20일고점·20일거래량·2배)', `${LAUNCHPAD_CONST.breakoutHighWindow}/${LAUNCHPAD_CONST.volWindow}/${LAUNCHPAD_CONST.volMultiple}`, '20/20/2');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('8. 런치패드 수렴 평가시점 = D-1 (돌파 당일 종가로 수렴을 통과시키지 않음)');
{
  // close[0..89]=110, close[90..149]=100 → i=149: MA20=MA60=100, MA150=(90×110+60×100)/150=106
  //   ⇒ D-1(=149) compression = (106-100)/100×100 = 6.00%  → 5% 임계 탈락
  // D(=150) 에 종가 130 급등:
  //   MA20  = (19×100+130)/20 = 101.5
  //   MA60  = (59×100+130)/60 = 100.5
  //   MA150 = (89×110+60×100+130)/150 = 15920/150 = 106.1333…
  //   compression = (106.1333…-100.5)/130×100 = 4.3333…%  → 5% 임계 통과(!)
  // ⇒ D 기준이면 통과, D-1 기준이면 탈락. 구현은 **D-1**이므로 false여야 한다.
  const c: number[] = [];
  for (let k = 0; k < 90; k++) c.push(110);
  for (let k = 90; k < 150; k++) c.push(100);
  c.push(130); // index 150
  const high = c.map(() => 100);
  for (let k = 130; k < 150; k++) high[k] = 120; // 직전20일 고점 120
  high[150] = 130;
  const vol = c.map(() => 100);
  vol[150] = 300;
  const bars = makeBars('P', c, { adjHigh: high, adjVolume: vol });

  checkClose('D-1(149) compression = 6.00%', maCompressionPct(c, 149) as number, 6, 1e-12);
  checkClose('D(150) compression = 4.3333%', maCompressionPct(c, 150) as number, (106.1333333333333333 - 100.5) / 130 * 100, 1e-9);
  check('D에 돌파 자체는 성립', isBreakoutAt(bars, 150), true);
  check('임계 5% → D-1 기준이라 탈락(false)', launchpadConditionAt(bars, 150, 5), false);
  check('임계 7% → D-1 6.00% 통과 → true', launchpadConditionAt(bars, 150, 7), true);

  // 메모(성능 최적화) 계열이 직접 함수와 정확히 동일해야 한다.
  const s = launchpadSeriesOf(bars);
  let memoOk = true;
  for (let k = 0; k < c.length; k++) {
    if (!Object.is(s.comp[k], maCompressionPct(c, k))) memoOk = false;
    if (!Object.is(s.brk[k], isBreakoutAt(bars, k))) memoOk = false;
  }
  check('런치패드 메모 계열 == 직접 계산', memoOk, true);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('9. DAA 월말신호 → 익월 첫 거래일 (같은 봉 체결 금지)');
{
  const dates = [
    '2020-01-30',
    '2020-01-31',
    '2020-02-03',
    '2020-02-04',
    '2020-02-28',
    '2020-03-02',
    '2020-03-03',
  ];
  const rebs = monthlyRebalanceDays(dates);
  checkArr(
    '월말 신호일 index',
    rebs.map((r) => r.signalIdx),
    [1, 4]
  );
  checkArr(
    '체결일 index(= 신호일+1)',
    rebs.map((r) => r.tradeIdx),
    [2, 5]
  );
  check('체결일 == 신호일+1 (같은 봉 체결 불가)', rebs.every((r) => r.tradeIdx === r.signalIdx + 1), true);
  check('신호일 2020-01-31 → 체결일 2020-02-03', `${dates[rebs[0].signalIdx]}→${dates[rebs[0].tradeIdx]}`, '2020-01-31→2020-02-03');
  check('연1회 필터: 1월말→2월초는 연도 동일 → false', isAnnualRebalance(dates, rebs[0]), false);
  const ye = [{ signalIdx: 0, tradeIdx: 1 }];
  check('연1회 필터: 12월말→1월초 → true', isAnnualRebalance(['2019-12-31', '2020-01-02'], ye[0]), true);

  // ---- 체결 타이밍 손계산 골든 ----
  // A: idx1 종가 100 → idx2 시가 110 → idx2 종가 121
  // 현금에서 진입(첫 체결) ⇒ 전일종가→시가 구간 수익 0, 비용 0.001×|Δw|=0.001×1
  //   당일수익 = (1+0) × (1-0.001) × (121/110) = 0.999 × 1.1 = 1.0989 → +9.89%
  //   ※ 같은 봉 종가체결이었다면 0.999×(121/100)-1 = +20.879% 로 크게 달라진다.
  // idx5: A 전일종가 121 → 시가 132(+9.0909%, **구 비중 A**), B로 전량 교체(Δw 합 2 → 비용 0.002),
  //       B 시가 50 → 종가 55(+10%, **신 비중 B**)
  //   당일수익 = (132/121) × (1-0.002) × (55/50) - 1 = 12×0.998×1.1/11 - 1 = 0.1976
  const aClose = [100, 100, 121, 121, 121, 121, 121];
  const aOpen = [100, 100, 110, 121, 121, 132, 121];
  const bClose = [50, 50, 50, 50, 50, 55, 55];
  const bOpen = [50, 50, 50, 50, 50, 50, 55];
  const table: PriceTable = {
    symbols: ['A', 'B'],
    dates,
    adjClose: new Map([
      ['A', aClose],
      ['B', bClose],
    ]),
    adjOpen: new Map([
      ['A', aOpen],
      ['B', bOpen],
    ]),
  };
  const wf = (signalIdx: number): Weights =>
    signalIdx === 1 ? new Map([['A', 1]]) : new Map([['B', 1]]);
  const sim = simulate('T', table, wf, rebs, () => true, 0);
  check('시뮬 시작 index = 첫 체결일(2)', sim.startIdx, 2);
  checkClose('체결일 수익 = 0.999×(121/110)-1', sim.dailyReturns[0], 0.999 * (121 / 110) - 1, 1e-12);
  checkClose('전환일 수익 = (132/121)×0.998×(55/50)-1', sim.dailyReturns[3], (132 / 121) * 0.998 * (55 / 50) - 1, 1e-12);
  checkClose('비체결일(idx3) 수익 0', sim.dailyReturns[1], 0, 1e-12);
  check('리밸런싱 2회(첫 진입 포함)', sim.rebalances, 2);
  // 신호일(idx1·idx4)에는 어떤 수익도 계상되지 않는다 — 시뮬은 체결일부터 시작.
  check('신호일은 성과구간에 미포함', sim.dates[0], '2020-02-03');
  check('편도비용 0.1%', DAA_ASSUMPTIONS.costOneWay, 0.001);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('10. 듀얼모멘텀 스위칭 — 손계산 골든(절대 0 경계 포함)');
{
  /** 길이 253(index 0..252). [0..126]=100, [127..252]=100×(1+m) → 126일·252일 모멘텀 모두 m. */
  const step = (m: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i <= 126; i++) out.push(100);
    for (let i = 127; i <= 252; i++) out.push(100 * (1 + m));
    return out;
  };
  const mkTable = (spec: Record<string, number>): PriceTable => {
    const adjClose = new Map<string, number[]>();
    const adjOpen = new Map<string, number[]>();
    for (const [sym, m] of Object.entries(spec)) {
      const c = step(m);
      adjClose.set(sym, c);
      adjOpen.set(sym, [...c]);
    }
    return {
      symbols: Object.keys(spec),
      dates: step(0).map((_, i) => `2020-01-${String((i % 28) + 1).padStart(2, '0')}`),
      adjClose,
      adjOpen,
    };
  };

  const base: Record<string, number> = {
    SPY: 0.5,
    VEU: 0.2,
    AGG: 0.03,
    TLT: 0.1,
    IEF: 0.05,
    SHY: 0.01,
    LQD: -0.02,
    HYG: 0.08,
    TIP: 0.03,
    EMB: -0.05,
    BWX: -0.1,
    BIL: 0.001,
  };
  const t1 = mkTable(base);
  checkClose('momentum(SPY,252) = 0.5', momentum(t1, 'SPY', 252, 252) as number, 0.5, 1e-12);
  checkClose('momentum(TLT,126) = 0.1', momentum(t1, 'TLT', 252, 126) as number, 0.1, 1e-12);

  // (i) 위험 ON: SPY(0.5) > VEU(0.2), 우세 모멘텀 양수
  const d1 = dualMomentumSignal(t1, 252);
  check('우세 = SPY', d1.winner, 'SPY');
  check('riskOn = true', d1.riskOn, true);
  check('오리지널 비중: SPY 100%', dualOriginalWeights(t1, 252).w.get('SPY'), 1);
  check('변형 비중: SPY 100%', dualVariantWeights(t1, 252).w.get('SPY'), 1);

  // (ii) VEU 우세 + 위험 OFF: SPY -0.10, VEU -0.05 → 우세 VEU, 모멘텀 음수
  const t2 = mkTable({ ...base, SPY: -0.1, VEU: -0.05 });
  const d2 = dualMomentumSignal(t2, 252);
  check('우세 = VEU', d2.winner, 'VEU');
  check('riskOn = false', d2.riskOn, false);
  check('오리지널 위험OFF → AGG 100%', dualOriginalWeights(t2, 252).w.get('AGG'), 1);

  // (iii) 절대 경계: 우세 모멘텀 정확히 0 → riskOn=false(> 0 엄격)
  const t3 = mkTable({ ...base, SPY: 0, VEU: -0.2 });
  const d3 = dualMomentumSignal(t3, 252);
  check('우세 SPY, 모멘텀 0', d3.momWinner, 0);
  check('모멘텀 0 → riskOn=false(엄격 초과)', d3.riskOn, false);
  const t4 = mkTable({ ...base, SPY: 0.0001, VEU: -0.2 });
  check('모멘텀 +0.01% → riskOn=true', dualMomentumSignal(t4, 252).riskOn, true);

  // (iv) 채권 DAA 상위3: TLT .10 > HYG .08 > IEF .05 (전부 양수) → 각 1/3, 현금 0
  const b1 = bondDaaWeights(t1, 252);
  checkArr(
    '채권 상위3 = TLT/HYG/IEF',
    b1.detail.picks.map((p) => (p.toCash ? 1 : 0)),
    [0, 0, 0]
  );
  check('picks 심볼 순서', b1.detail.picks.map((p) => p.symbol).join(','), 'TLT,HYG,IEF');
  checkClose('TLT 비중 1/3', b1.w.get('TLT') as number, 1 / 3, 1e-12);
  check('BIL 미배정', b1.w.has('BIL'), false);

  // (v) 음수 슬롯 → 그 1/3 만 BIL. TLT만 양수, 나머지 7종 음수
  const t5 = mkTable({
    ...base,
    TLT: 0.1, IEF: -0.05, SHY: -0.01, LQD: -0.02, HYG: -0.08, TIP: -0.03, EMB: -0.06, BWX: -0.1,
  });
  const b5 = bondDaaWeights(t5, 252);
  check('상위1 TLT 양수', b5.detail.picks[0].toCash, false);
  check('상위2 음수 → 현금', b5.detail.picks[1].toCash, true);
  check('상위3 음수 → 현금', b5.detail.picks[2].toCash, true);
  checkClose('TLT 1/3', b5.w.get('TLT') as number, 1 / 3, 1e-12);
  checkClose('BIL 2/3', b5.w.get('BIL') as number, 2 / 3, 1e-12);

  // (vi) 변형 듀얼모멘텀 위험OFF → 채권 DAA 비중을 그대로 사용
  const t6 = mkTable({
    ...base,
    SPY: -0.1, VEU: -0.2,
    TLT: 0.1, IEF: -0.05, SHY: -0.01, LQD: -0.02, HYG: -0.08, TIP: -0.03, EMB: -0.06, BWX: -0.1,
  });
  const v6 = dualVariantWeights(t6, 252);
  check('변형 위험OFF → AGG 미사용', v6.w.has('AGG'), false);
  checkClose('변형 위험OFF → TLT 1/3', v6.w.get('TLT') as number, 1 / 3, 1e-12);
  checkClose('변형 위험OFF → BIL 2/3', v6.w.get('BIL') as number, 2 / 3, 1e-12);
  check('오리지널은 같은 상황에서 AGG 100%', dualOriginalWeights(t6, 252).w.get('AGG'), 1);
  check('가정 티커 채권 8종', DAA_ASSUMPTIONS.bonds8.length, 8);
  check('모멘텀 창 252/126', `${DAA_ASSUMPTIONS.lookback12M}/${DAA_ASSUMPTIONS.lookback6M}`, '252/126');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('11. 연도별 수익률 집계 골든');
{
  const ys = yearlyReturns(
    ['2020-12-30', '2020-12-31', '2021-01-04'],
    [0.1, 0.1, -0.5]
  );
  check('연도 2개', ys.length, 2);
  checkClose('2020 = 1.1×1.1-1 = 0.21', ys[0].ret, 0.21, 1e-12);
  checkClose('2021 = -0.5', ys[1].ret, -0.5, 1e-12);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
if (fail > 0) process.exit(1);
