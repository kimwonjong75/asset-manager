// tests/core6V3StatsParity.ts
// 코어 6종 신호 로테이션 V3 — 성과 지표·bootstrap·Wilson 골든. 오프라인·합성 데이터.
// 실행: npx tsx tests/core6V3StatsParity.ts

import {
  annualizedVolatility, cagr, calmar, dailyReturns, maxDrawdown, mddRelativeReduction,
} from '../scripts/backtest/core6SignalRotationV3/stats/metrics';
import {
  bootstrapPairedDiff, mulberry32, stationaryBootstrapIndices, wilsonInterval,
} from '../scripts/backtest/core6SignalRotationV3/stats/bootstrap';

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  if (Object.is(actual, expected)) pass++;
  else { fail++; console.error(`  FAIL ${name}\n      기대=${String(expected)} 실제=${String(actual)}`); }
}
function checkClose(name: string, actual: number | null, expected: number, tol = 1e-9): void {
  if (actual !== null && Number.isFinite(actual) && Math.abs(actual - expected) <= tol) pass++;
  else { fail++; console.error(`  FAIL ${name}\n      기대=${expected} 실제=${String(actual)} (tol ${tol})`); }
}

console.log('core6 V3 지표·bootstrap 골든 테스트\n');

// ── CAGR (손계산) ───────────────────────────────────────────────────────
// 일수 = 2*365.2425 -> 지수 0.5 -> sqrt(1.21)-1 = 0.1
checkClose('cagr 2년 +21%', cagr(100, 121, 730.485), 0.1, 1e-12);
checkClose('cagr 1년 2배', cagr(100, 200, 365.2425), 1, 1e-12);
checkClose('cagr 1년 -50%', cagr(100, 50, 365.2425), -0.5, 1e-12);
// 일수 = 365.2425/2 -> 지수 2 -> 1.1^2-1 = 0.21
checkClose('cagr 반년 +10%', cagr(100, 110, 182.62125), 0.21, 1e-12);
check('cagr 전손', cagr(100, 0, 365), -1);
check('cagr 일수 0 -> NaN', Number.isNaN(cagr(100, 110, 0)), true);
check('cagr 시작 0 -> NaN', Number.isNaN(cagr(0, 110, 365)), true);

// ── MDD (손계산) ────────────────────────────────────────────────────────
// 100,120,90,110,60,130: 고점 120 -> 90 = -25%, 이후 60 = 60/120-1 = -50% (최대), 130은 신고점
checkClose('mdd 골든', maxDrawdown([100, 120, 90, 110, 60, 130]), -0.5, 1e-12);
checkClose('mdd 단일 -25%', maxDrawdown([100, 120, 90]), -0.25, 1e-12);
check('mdd 단조 증가 = 0', maxDrawdown([100, 101, 102, 150]), 0);
check('mdd 빈/단일 = 0', maxDrawdown([100]), 0);
check('mdd 음수 또는 0 부호', maxDrawdown([100, 80]) < 0, true);

// ── Calmar 특수값 ──────────────────────────────────────────────────────
checkClose('calmar 일반', calmar(0.1, -0.25), 0.4, 1e-12);
checkClose('calmar 양수 mdd 입력도 abs', calmar(0.2, 0.5), 0.4, 1e-12);
check('calmar mdd=0 cagr>0 -> +Inf', calmar(0.1, 0), Infinity);
check('calmar mdd=0 cagr=0 -> 0', calmar(0, 0), 0);
check('calmar mdd=0 cagr<0 -> -Inf', calmar(-0.1, 0), -Infinity);
checkClose('calmar 음의 cagr', calmar(-0.1, -0.5), -0.2, 1e-12);

// ── 일별 수익률·변동성 ───────────────────────────────────────────────────
{
  const r = dailyReturns([100, 110, 99]);
  check('dailyReturns 길이', r.length, 2);
  checkClose('dailyReturns[0]', r[0], 0.1, 1e-12);
  checkClose('dailyReturns[1]', r[1], -0.1, 1e-12);
}
// [0.01,-0.01]: 평균 0, 제곱합 2e-4, /(n-1=1) -> sd=0.0141421356..., x sqrt(252) = sqrt(0.0504)
checkClose('vol 골든', annualizedVolatility([0.01, -0.01]), Math.sqrt(0.0504), 1e-12);
checkClose('vol 골든 절대값', annualizedVolatility([0.01, -0.01]), 0.2244994432064365, 1e-12);
// [0.01,-0.01,0.02,0]: 평균 0.005, 편차 제곱합 5e-4, /3 -> sd=0.012909944487358, x sqrt(252)=0.20493901531919
checkClose('vol 4개', annualizedVolatility([0.01, -0.01, 0.02, 0]), 0.20493901531919, 1e-9);
check('vol 상수 수익률 = 0', annualizedVolatility([0.01, 0.01, 0.01]), 0);
check('vol 관측 1개 -> NaN', Number.isNaN(annualizedVolatility([0.01])), true);

// ── MDD 상대 감소 ───────────────────────────────────────────────────────
checkClose('mddReduction 40%', mddRelativeReduction(-0.5, -0.3) ?? NaN, 0.4, 1e-12);
checkClose('mddReduction 악화 -50%', mddRelativeReduction(-0.2, -0.3) ?? NaN, -0.5, 1e-12);
check('mddReduction bh=0 -> null', mddRelativeReduction(0, -0.1), null);
checkClose('mddReduction 전략 0 = 100%', mddRelativeReduction(-0.4, 0) ?? NaN, 1, 1e-12);

// ── PRNG ────────────────────────────────────────────────────────────────
// 아래 3개 값은 구현 출력으로 고정한 회귀 골든(손계산 불가). mulberry32 알고리즘이 바뀌면 깨진다.
{
  const r = mulberry32(260101);
  check('mulberry32 #1', r(), 0.4776892017107457);
  check('mulberry32 #2', r(), 0.38493418181315064);
  check('mulberry32 #3', r(), 0.8546148878522217);
  const a = mulberry32(1), b = mulberry32(1), c = mulberry32(2);
  const va = [a(), a(), a()], vb = [b(), b(), b()], vc = [c(), c(), c()];
  check('같은 seed 같은 열', JSON.stringify(va), JSON.stringify(vb));
  check('다른 seed 다른 열', JSON.stringify(va) === JSON.stringify(vc), false);
  check('범위 [0,1)', va.every(v => v >= 0 && v < 1), true);
}

// ── stationary bootstrap 인덱스 ─────────────────────────────────────────
{
  // p=1/1e12 ~ 0 -> 블록이 끊기지 않아 (start+i) mod L (원형 래핑)
  const rng = mulberry32(7);
  const idx = stationaryBootstrapIndices(10, 1e12, rng);
  let wrap = true;
  for (let i = 1; i < idx.length; i++) if (idx[i] !== (idx[0] + i) % 10) wrap = false;
  check('긴 블록: 연속 + 원형 래핑', wrap, true);
  check('범위 0..L-1', idx.every(v => v >= 0 && v < 10), true);

  // 평균 블록 길이 ~21: 길이 200000에서 비연속 지점(블록 경계 중 우연히 연속인 것 제외) 수는 약 200000/21 * ~ 9524
  const T = 200000; // 길이=T이므로 래핑 모듈러스도 T
  const big = stationaryBootstrapIndices(T, 21, mulberry32(260101));
  let breaks = 0;
  for (let i = 1; i < T; i++) if (big[i] !== (big[i - 1] + 1) % T) breaks++;
  check('평균 블록 길이 ~21 (경계 수 9000~10100)', breaks > 9000 && breaks < 10100, true);
  check('빈 길이 -> []', stationaryBootstrapIndices(0, 21, mulberry32(1)).length, 0);
}

// ── Wilson 구간 (문헌 값) ───────────────────────────────────────────────
{
  const w05 = wilsonInterval(5, 10);
  checkClose('wilson 5/10 하한', w05?.lo ?? NaN, 0.2366, 5e-5);
  checkClose('wilson 5/10 상한', w05?.hi ?? NaN, 0.7634, 5e-5);
  checkClose('wilson 5/10 p', w05?.p ?? NaN, 0.5, 1e-12);
  const w0 = wilsonInterval(0, 10);
  check('wilson 0/10 하한 정확히 0', w0?.lo, 0);
  checkClose('wilson 0/10 상한', w0?.hi ?? NaN, 0.2775327998628892, 1e-12);
  const w10 = wilsonInterval(10, 10);
  checkClose('wilson 10/10 하한', w10?.lo ?? NaN, 0.7224672001371107, 1e-12);
  checkClose('wilson 10/10 상한', w10?.hi ?? NaN, 1, 1e-12);
  check('wilson n=0 -> null', wilsonInterval(0, 0), null);
  check('wilson k>n -> null', wilsonInterval(11, 10), null);
}

// ── bootstrapPairedDiff ────────────────────────────────────────────────
const N = 60;
const rs = Array.from({ length: N }, (_, i) => 0.001 * (((i * 7) % 11) - 5));
const rb = Array.from({ length: N }, (_, i) => 0.002 * (((i * 5) % 13) - 6));
const OPT = { iterations: 200, elapsedCalendarDays: 90 };
{
  const a = bootstrapPairedDiff(rs, rb, OPT);
  const b = bootstrapPairedDiff(rs, rb, OPT);
  check('같은 seed 2회: 비트 동일', JSON.stringify(a), JSON.stringify(b));
  check('기본 seed 260101', a.seed, 260101);
  check('기본 평균 블록 21', a.meanBlock, 21);
  const c = bootstrapPairedDiff(rs, rb, { ...OPT, seed: 1 });
  check('다른 seed: 결과 다름', JSON.stringify(c) === JSON.stringify(a), false);
  check('lo <= hi (cagr)', a.cagrDiff.lo <= a.cagrDiff.hi, true);
  check('lo <= hi (mdd)', a.mddDiff.lo <= a.mddDiff.hi, true);
  check('lo <= hi (calmar)', a.calmarDiff.lo <= a.calmarDiff.hi, true);
  check('NaN 제외 0건', a.nanDropped.cagr + a.nanDropped.mdd + a.nanDropped.calmar, 0);
  // 회귀 골든(구현 출력 고정, 손계산 아님): seed 260101, 200회, 위 합성 수익률 쌍
  checkClose('회귀 골든 cagrDiff.point', a.cagrDiff.point, 0.0015840361371739498, 1e-12);
  checkClose('회귀 골든 cagrDiff.lo', a.cagrDiff.lo, -0.19588632992109267, 1e-12);
  checkClose('회귀 골든 cagrDiff.hi', a.cagrDiff.hi, 0.13291755789294335, 1e-12);
  checkClose('회귀 골든 mddDiff.lo', a.mddDiff.lo, -0.0008713268824636078, 1e-12);
  checkClose('회귀 골든 mddDiff.hi', a.mddDiff.hi, 0.032134930175925835, 1e-12);
  checkClose('회귀 골든 calmarDiff.lo', a.calmarDiff.lo, -11.720330002941513, 1e-9);
  checkClose('회귀 골든 calmarDiff.hi', a.calmarDiff.hi, 7.396628706393237, 1e-9);
}
{
  // 전략 = B&H(같은 열): 같은 재표본 인덱스를 쓰면 모든 재표본에서 차이가 정확히 0 -> CI [0,0]
  const a = bootstrapPairedDiff(rb, rb, OPT);
  for (const [k, ci] of [['cagr', a.cagrDiff], ['mdd', a.mddDiff], ['calmar', a.calmarDiff]] as const) {
    check(`동일 쌍 ${k} lo=0`, ci.lo, 0);
    check(`동일 쌍 ${k} hi=0`, ci.hi, 0);
    check(`동일 쌍 ${k} point=0`, ci.point, 0);
  }
}
{
  // 상수 양의 수익률 쌍이 같으면 MDD=0 -> Calmar 둘 다 +Infinity. 차이는 0(NaN 아님).
  const cst = Array.from({ length: N }, () => 0.001);
  const a = bootstrapPairedDiff(cst, cst, OPT);
  check('상수 쌍 calmar lo=0', a.calmarDiff.lo, 0);
  check('상수 쌍 calmar hi=0', a.calmarDiff.hi, 0);
  check('상수 쌍 NaN 제외 0건', a.nanDropped.calmar, 0);
}
{
  // 서로 다른 상수 수익률: 어떤 재표본도 같은 자산곡선 -> lo == hi == point (CAGR 차이는 손계산: 아래)
  const s = Array.from({ length: N }, () => 0.001);
  const b = Array.from({ length: N }, () => 0.0005);
  const a = bootstrapPairedDiff(s, b, OPT);
  const expect = Math.pow(1.001, 60 * 365.2425 / 90) - Math.pow(1.0005, 60 * 365.2425 / 90);
  checkClose('상수 쌍 cagr point 손계산', a.cagrDiff.point, expect, 1e-9);
  checkClose('상수 쌍 cagr lo=point', a.cagrDiff.lo, expect, 1e-9);
  checkClose('상수 쌍 cagr hi=point', a.cagrDiff.hi, expect, 1e-9);
  check('상수 쌍 mdd 차이 0', a.mddDiff.hi, 0);
}
{
  // 길이 불일치/관측 부족은 throw
  let t1 = false, t2 = false;
  try { bootstrapPairedDiff([0.1, 0.2], [0.1], OPT); } catch { t1 = true; }
  try { bootstrapPairedDiff([0.1], [0.1], OPT); } catch { t2 = true; }
  check('길이 불일치 throw', t1, true);
  check('관측 1개 throw', t2, true);
}

console.log(`\n통과 ${pass} / 실패 ${fail}`);
if (fail > 0) process.exit(1);
