// tests/enrichedRefreshPolicyParity.ts
// 시세 갱신 직후 enriched 재조회 판정(순수) — 명시적 골든값.
import { shouldRefetchEnrichedAfterPriceRefresh, ENRICHED_REFRESH_TOLERANCE_MS } from '../utils/enrichedRefreshPolicy';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

const T = 1_000_000_000_000;
const tol = ENRICHED_REFRESH_TOLERANCE_MS;
const f = (last: number | null) =>
  shouldRefetchEnrichedAfterPriceRefresh({ lastEnrichedFetchStartedAt: last, priceRefreshStartedAt: T, toleranceMs: tol });

check('허용오차 상수 = 60000', tol, 60000);
check('조회 이력 없음(null) → 재조회', f(null), true);
check('10초 전 시작 → 재조회 안 함', f(T - 10_000), false);
check('갱신 시작 이후 시작 → 재조회 안 함', f(T + 5_000), false);
check('정확히 허용오차만큼 전 → 재조회 안 함', f(T - tol), false);
check('허용오차+1ms 전 → 재조회', f(T - tol - 1), true);
check('10분 전 → 재조회', f(T - 10 * 60_000), true);
check('갱신 시작과 동시 → 재조회 안 함', f(T), false);

if (fails.length > 0) {
  console.error(`\n❌ enriched 재조회 정책 테스트 실패 (${fails.length}건 / 통과 ${pass}건)\n`);
  fails.forEach(x => console.error('  ' + x));
  process.exit(1);
}
console.log(`✅ enriched 재조회 정책 테스트 통과 — ${pass}건 단언`);
