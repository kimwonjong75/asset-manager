// tests/winRateDiagnosticsParity.ts
// ---------------------------------------------------------------------------
// 손익비×승률 진단 회귀 테스트 — 운영 함수만 호출(계산식 복제 없음). 수동 실행: npm run test:winrate (tsx)
// 핵심:
//   ① 판정(verdict.kind) → 승/패/제외 매핑 핀(good=승, false/too-late/too-early=패, missed-*=제외).
//   ② 손익분기 수학 핀: 손익비 2:1→33.3%, 3:1→25%, 2.33:1(7/3)→30%. (W_be = 1/(1+R))
//   ③ 절대값 크기 — "good" 매도(ret<0)도 |ret|로 승 크기에 기여.
//   ④ 0 분모/소표본/무한대 손익비 가드 — 착시 배지 방지(payoff/breakeven/edge null).
//   ⑤ 기대값·edge(수익권/손익분기/손실권) 경계.
// 통과 시 exit 0, 실패 1건이라도 있으면 exit 1.

import {
  computeWinRateDiagnostics, classifyVerdict, MIN_RELIABLE_SAMPLE,
  type VerdictReturn,
} from '../utils/winRateDiagnostics';
import type { SignalVerdictKind } from '../types/signalReplay';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function checkTrue(name: string, cond: boolean): void {
  if (cond) pass++; else fails.push(`✗ ${name}: expected true`);
}
function near(name: string, actual: number | null, expected: number, eps = 1e-9): void {
  if (actual != null && Math.abs(actual - expected) < eps) pass++;
  else fails.push(`✗ ${name}: got ${actual}, expected ≈ ${expected}`);
}

const s = (kind: SignalVerdictKind, ret: number | null): VerdictReturn => ({ kind, ret });

// ── ① 판정 → 승/패/제외 매핑 ───────────────────────────────────────────────────
check('classify: good → win', classifyVerdict('good'), 'win');
check('classify: false → loss', classifyVerdict('false'), 'loss');
check('classify: too-late → loss', classifyVerdict('too-late'), 'loss');
check('classify: too-early → loss', classifyVerdict('too-early'), 'loss');
check('classify: missed-buy → excluded', classifyVerdict('missed-buy'), 'excluded');
check('classify: missed-sell → excluded', classifyVerdict('missed-sell'), 'excluded');

// ── ② 손익분기 수학 핀 (W_be = 1/(1+R)) ────────────────────────────────────────
{
  // 손익비 2:1 — 승 |2|, 패 |1| → breakeven 33.3%.
  const d = computeWinRateDiagnostics([s('good', 2), s('false', -1)]);
  near('payoff 2:1', d.payoff, 2);
  near('breakeven 2:1 ≈ 0.3333', d.breakevenWinRate, 1 / 3);
  check('2:1 avgWin', d.avgWinPct, 2);
  check('2:1 avgLoss', d.avgLossPct, 1);
}
{
  // 손익비 3:1 — 승 |3|, 패 |1| → breakeven 25%.
  const d = computeWinRateDiagnostics([s('good', 3), s('false', 1)]);
  near('payoff 3:1', d.payoff, 3);
  near('breakeven 3:1 = 0.25', d.breakevenWinRate, 0.25);
}
{
  // 손익비 2.33:1(=7/3) — 승 |7/3|, 패 |1| → breakeven 30%.
  const d = computeWinRateDiagnostics([s('good', 7 / 3), s('false', -1)]);
  near('payoff 7/3', d.payoff, 7 / 3);
  near('breakeven 7/3 = 0.30', d.breakevenWinRate, 0.3);
}

// ── ③ 절대값 크기 — "good" 매도(ret<0)도 |ret|로 승 크기 ────────────────────────
{
  // good 매도경고(가격 하락 = 올바른 콜, ret -8) → 승 크기 |8|. false 매도(가격 상승, ret +2) → 패 크기 |2|.
  const d = computeWinRateDiagnostics([s('good', -8), s('false', 2)]);
  check('abs: avgWin from |−8|', d.avgWinPct, 8);
  check('abs: avgLoss from |2|', d.avgLossPct, 2);
  near('abs: payoff 8/2 = 4', d.payoff, 4);
}

// ── ④ 0 분모 / 소표본 / 무한대 가드 ─────────────────────────────────────────────
{
  const empty = computeWinRateDiagnostics([]);
  check('empty: n', empty.n, 0);
  check('empty: winRate null', empty.winRate, null);
  check('empty: payoff null', empty.payoff, null);
  check('empty: breakeven null', empty.breakevenWinRate, null);
  check('empty: edge null', empty.edge, null);
  check('empty: expectancy null', empty.expectancy, null);
  check('empty: not smallSample', empty.smallSample, false);
}
{
  // 승만 있고 패 없음 → 손익비 무한대 방지(null). "승률 100%(2건)" 착시 차단.
  const d = computeWinRateDiagnostics([s('good', 5), s('good', 3)]);
  check('all-wins: winRate 1', d.winRate, 1);
  check('all-wins: losses 0', d.losses, 0);
  check('all-wins: avgLoss null', d.avgLossPct, null);
  check('all-wins: payoff null (무한대 가드)', d.payoff, null);
  check('all-wins: breakeven null', d.breakevenWinRate, null);
  check('all-wins: edge null (산출 불가)', d.edge, null);
  check('all-wins: expectancy null', d.expectancy, null);
  check('all-wins: smallSample(n=2)', d.smallSample, true);
}
{
  // 패 평균이 정확히 0(|ret|=0) → 0 나눗셈 방지(payoff null).
  const d = computeWinRateDiagnostics([s('good', 4), s('false', 0)]);
  check('zero-avgLoss: avgLoss 0', d.avgLossPct, 0);
  check('zero-avgLoss: payoff null', d.payoff, null);
}
{
  // 소표본 경계: n=9 경고, n=10 비경고.
  const nine = Array.from({ length: 9 }, () => s('good', 1));
  const ten = Array.from({ length: 10 }, () => s('good', 1));
  check('smallSample: n=9 true', computeWinRateDiagnostics(nine).smallSample, true);
  check('smallSample: n=10 false', computeWinRateDiagnostics(ten).smallSample, false);
  check('MIN_RELIABLE_SAMPLE is 10', MIN_RELIABLE_SAMPLE, 10);
}

// ── ⑤ missed-* 제외 + 크기 표본 분리 ───────────────────────────────────────────
{
  const d = computeWinRateDiagnostics([
    s('good', 2), s('false', -1),
    s('missed-buy', null), s('missed-sell', 5), // 제외 — n·승률에 영향 없음
  ]);
  check('missed: n excludes missed (=2)', d.n, 2);
  check('missed: excludedMissed count', d.excludedMissed, 2);
  check('missed: winRate 0.5 (1/2)', d.winRate, 0.5);
}
{
  // ret 없는 최근 승 판정 → 승률 표본(n)엔 들어가지만 크기 평균엔 빠짐.
  const d = computeWinRateDiagnostics([s('good', null), s('good', 4), s('false', -2)]);
  check('ret-missing: wins (count) = 2', d.wins, 2);
  check('ret-missing: winsWithReturn = 1', d.winsWithReturn, 1);
  check('ret-missing: avgWin from the one with ret', d.avgWinPct, 4);
  check('ret-missing: lossesWithReturn = 1', d.lossesWithReturn, 1);
  near('ret-missing: winRate 2/3', d.winRate, 2 / 3);
}

// ── ⑥ edge(수익권/손익분기/손실권) + 기대값 ────────────────────────────────────
{
  // 25% 승률 + 손익비 3:1 → breakeven 25% → 정확히 손익분기, 기대값 0.
  const d = computeWinRateDiagnostics([
    s('good', 3),                                  // 승 1, |3|
    s('false', 1), s('too-late', 1), s('too-early', 1), // 패 3, 각 |1|
  ]);
  check('edge: winRate 0.25', d.winRate, 0.25);
  near('edge: payoff 3', d.payoff, 3);
  near('edge: breakeven 0.25', d.breakevenWinRate, 0.25);
  check('edge: at breakeven', d.edge, 'breakeven');
  near('edge: expectancy 0', d.expectancy, 0);
}
{
  // 승률 50% + 손익비 2:1(33.3% 손익분기) → 수익권, 기대값 +0.5%.
  const d = computeWinRateDiagnostics([s('good', 2), s('false', -1)]);
  check('profitable: winRate 0.5 > breakeven 0.333', d.edge, 'profitable');
  near('profitable: expectancy = .5*2 − .5*1 = 0.5', d.expectancy, 0.5);
}
{
  // 승률 20%(1승4패) + 손익비 2:1(33.3% 손익분기) → 손실권, 기대값 음수.
  const d = computeWinRateDiagnostics([
    s('good', 2),
    s('false', -1), s('false', -1), s('false', -1), s('false', -1),
  ]);
  check('losing: winRate 0.2 < breakeven 0.333', d.edge, 'losing');
  checkTrue('losing: expectancy negative', (d.expectancy ?? 0) < 0);
  near('losing: expectancy = .2*2 − .8*1 = −0.4', d.expectancy, -0.4);
}

// ── 결과 ─────────────────────────────────────────────────────────────────────
console.log(`\n손익비×승률 진단 테스트: ${pass} 통과, ${fails.length} 실패`);
if (fails.length) { fails.forEach(f => console.log('  ' + f)); process.exit(1); }
console.log('✓ 전부 통과');
