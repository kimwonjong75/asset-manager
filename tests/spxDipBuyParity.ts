// tests/spxDipBuyParity.ts
// ---------------------------------------------------------------------------
// S&P500 하락 분할매수 × 이평선 백테스트 엔진(scripts/backtest/spxDipBuy/engine) 회귀 테스트.
// 손으로 계산 가능한 합성 시계열로 체결 규약을 **절대값**으로 고정한다(경로 대조 아님).
//
//   · 신호는 종가 확정 → 다음 거래일 종가 체결, 마지막 관측일 신호는 미체결
//   · 하루에 여러 하락 구간을 지나면 합산해 다음 날 한 번에 체결, 한 번 실행한 구간은 재실행 없음
//   · 매수금액은 초기원금 기준, 전고점은 시계열 처음부터(시작일 리셋 없음)
//   · 이평선 이탈 → 다음 날 전량 매도 → 현금은 이자 계산 대상
// 수동 실행: npx tsx tests/spxDipBuyParity.ts. 통과 시 exit 0.

import { prepare, runStrategy, defaultStrategies, DEFAULT_COMMON, type SpxSeries } from '../scripts/backtest/spxDipBuy/engine';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: number | null, expected: number | null, tol = 1e-6): void {
  const ok = actual === expected || (actual !== null && expected !== null && Math.abs(actual - expected) <= tol);
  if (ok) pass++; else fails.push(`✗ ${name}: got ${actual}, expected ${expected}`);
}

function series(px: number[], rate = 0): SpxSeries {
  const dates = px.map((_, i) => `2020-01-${String(i + 1).padStart(2, '0')}`);
  return { dates, px, perf: px.slice(), cashRate: px.map(() => rate) };
}

const [A, , C, D, E] = defaultStrategies(2);

// 1. 일시매수: 시작 다음 날(100) 매수 → 마지막 121
{
  const p = prepare(series([100, 100, 110, 121]));
  const r = runStrategy(p, A, DEFAULT_COMMON, 0, 3);
  check('lump 최종가치', r?.finalValue ?? null, 121);
  check('lump 첫 매수까지(일)', r?.daysToFirstBuy ?? null, 1);
}

// 2. 하락 분할: i=3 에서 -16% → i=4(84) 20% 매수, i=5 에서 -20% → i=6(100) 20% 매수
//    shares = 20/84 + 20/100, 현금 60 → 60 + 100*(20/84+0.2) = 103.80952380952381
{
  const p = prepare(series([100, 100, 90, 84, 84, 80, 100]));
  const r = runStrategy(p, C, DEFAULT_COMMON, 0, 6);
  check('dip 최종가치', r?.finalValue ?? null, 60 + 100 * (20 / 84 + 0.2));
  check('dip 매수 횟수', r?.buys ?? null, 2);
  check('dip 첫 매수까지(일)', r?.daysToFirstBuy ?? null, 4);
  check('dip 전액투입 미도달', r?.daysToFullInvest ?? null, null);
}

// 3. 하루에 전 구간 통과(-30%) → 다음 날 100% 합산 체결(70에 100/70주), 마지막 70 → 100
{
  const p = prepare(series([100, 100, 70, 70, 70]));
  const r = runStrategy(p, C, DEFAULT_COMMON, 0, 4);
  check('합산 체결 최종가치', r?.finalValue ?? null, 100);
  check('합산 체결 매수 1회', r?.buys ?? null, 1);
  check('합산 전액투입 일수', r?.daysToFullInvest ?? null, 3);
}

// 4. 마지막 관측일에 난 신호는 미체결
{
  const p = prepare(series([100, 90, 84]));
  const r = runStrategy(p, C, DEFAULT_COMMON, 0, 2);
  check('마지막날 신호 미체결 매수 0', r?.buys ?? null, 0);
  check('마지막날 신호 미체결 가치', r?.finalValue ?? null, 100);
}

// 5. 시작 전 고점이 전고점에 포함된다(시작일 리셋 없음): 이력상 고점 200, 시작일 100 → 이미 -50% → 합산 100% 매수
{
  const p = prepare(series([200, 100, 100, 100, 110]));
  const r = runStrategy(p, C, DEFAULT_COMMON, 1, 4);
  check('시작 전 고점 반영 → 즉시 전액 매수 최종', r?.finalValue ?? null, 110);
}

// 6. 이평선만(D, MA2): i=1 에서 11>10.5 → i=2(12) 전액 매수, i=3 에서 11<11.5 매도 신호 → i=4(10.5) 매도
//    100/12*10.5 = 87.5 현금으로 종료
{
  const p = prepare(series([10, 11, 12, 11, 10.5, 10.4]));
  const r = runStrategy(p, D, DEFAULT_COMMON, 0, 5);
  check('MA만 최종가치', r?.finalValue ?? null, 87.5);
  check('MA만 매도 1회', r?.sells ?? null, 1);
}

// 7. 거래비용: 편도 100bp, 일시매수 100 → 99 어치 매수 후 가격 불변이면 99
{
  const p = prepare(series([100, 100, 100]));
  const r = runStrategy(p, A, { costBps: 100, principal: 100 }, 0, 2);
  check('거래비용 반영', r?.finalValue ?? null, 99);
}

// 8. 현금이자: 연 3.65%(일 0.01%) 고정, 매수 없이 2일 → 100 × (1+0.0365/365)^... 달력 1일 간격×2회
{
  const p = prepare(series([100, 100, 100], 3.65));
  const r = runStrategy(p, C, DEFAULT_COMMON, 0, 2);
  check('현금이자 2일', r?.finalValue ?? null, 100 * 1.0001 * 1.0001, 1e-9);
}

// 9. E(하락분할+MA 매도): 이평선 아래에서 산 직후에는 매도 규칙이 무장되기 전이라 팔지 않는다
//    px: 고점 100 → 80 (dd -20%, MA2 아래) 에서 20%+20% 합산 매수 후에도 MA 위로 회복 전엔 매도 0
{
  const p = prepare(series([100, 100, 80, 79, 78, 77, 76]));
  const r = runStrategy(p, E, DEFAULT_COMMON, 0, 6);
  check('E 무장 전 매도 없음', r?.sells ?? null, 0);
  check('E 매수 1회(합산 40)', r?.buys ?? null, 1);
}

if (fails.length) {
  process.stderr.write(fails.join('\n') + `\n${pass} passed, ${fails.length} failed\n`);
  process.exit(1);
}
process.stdout.write(`spxDipBuyParity: ${pass} assertions passed\n`);
