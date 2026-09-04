// tests/priceFreshnessParity.ts
// utils/priceFreshness.ts 골든 테스트 — 각 시나리오는 손으로 계산한 절대 instant를 쓰고
// 기대 reason을 명시한다(marketHours 함수 자체의 정확성은 tests/marketHoursParity.ts가 별도로 고정).
// 수동 실행: npm run test:freshness (tsx). 통과 시 exit 0.

import { shouldRefreshPrices, describeFreshness } from '../utils/priceFreshness';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

const NO_HOLD = { hasKR: false, hasUS: false, hasCrypto: false };

// ════════════════════════════════════════════════════════════════════════════
// 1. never — 기록 없음은 무조건 refresh
// ════════════════════════════════════════════════════════════════════════════
check('lastRefreshAt null → never', shouldRefreshPrices({ lastRefreshAt: null, now: '2026-09-07T00:00:00.000Z', holdings: NO_HOLD }), { refresh: true, reason: 'never' });
check('보유 있어도 null → never', shouldRefreshPrices({ lastRefreshAt: null, now: '2026-09-07T00:00:00.000Z', holdings: { hasKR: true, hasUS: false, hasCrypto: false } }), { refresh: true, reason: 'never' });
check('잘못된 날짜 문자열 → never(안전측)', shouldRefreshPrices({ lastRefreshAt: 'not-a-date', now: '2026-09-07T00:00:00.000Z', holdings: NO_HOLD }), { refresh: true, reason: 'never' });

// ════════════════════════════════════════════════════════════════════════════
// 2. 보유 종목 없음 → 항상 fresh(기록이 있으면)
// ════════════════════════════════════════════════════════════════════════════
check('보유 없음 → fresh', shouldRefreshPrices({ lastRefreshAt: '2026-09-01T00:00:00.000Z', now: '2026-09-07T00:00:00.000Z', holdings: NO_HOLD }), { refresh: false, reason: 'fresh' });

// ════════════════════════════════════════════════════════════════════════════
// 3. market-open-stale — 개장 중 30분 경과
// ════════════════════════════════════════════════════════════════════════════
check('KR 개장중 35분 경과 → stale', shouldRefreshPrices({
  lastRefreshAt: '2026-09-07T00:00:00.000Z', // KST 09:00 (월)
  now: '2026-09-07T00:35:00.000Z', // KST 09:35
  holdings: { hasKR: true, hasUS: false, hasCrypto: false },
}), { refresh: true, reason: 'market-open-stale' });

check('KR 개장중 20분 경과 → fresh(30분 미만)', shouldRefreshPrices({
  lastRefreshAt: '2026-09-07T00:00:00.000Z', // KST 09:00
  now: '2026-09-07T00:20:00.000Z', // KST 09:20
  holdings: { hasKR: true, hasUS: false, hasCrypto: false },
}), { refresh: false, reason: 'fresh' });

check('CRYPTO 24시간 상시 개장 — 31분 경과 → stale', shouldRefreshPrices({
  lastRefreshAt: '2026-09-07T00:00:00.000Z',
  now: '2026-09-07T00:31:00.000Z',
  holdings: { hasKR: false, hasUS: false, hasCrypto: true },
}), { refresh: true, reason: 'market-open-stale' });

check('CRYPTO 10분 경과 → fresh', shouldRefreshPrices({
  lastRefreshAt: '2026-09-07T00:00:00.000Z', // KST 09:00
  now: '2026-09-07T00:10:00.000Z', // KST 09:10
  holdings: { hasKR: false, hasUS: false, hasCrypto: true },
}), { refresh: false, reason: 'fresh' });

check('KR·US 동시 보유 — KR 장외·US 개장중 40분 경과 → stale(US 기준)', shouldRefreshPrices({
  lastRefreshAt: '2026-09-07T13:20:00.000Z',
  now: '2026-09-07T14:00:00.000Z', // ET 2026-09-07 10:00 EDT(개장), KST 23:00(KR 장외)
  holdings: { hasKR: true, hasUS: true, hasCrypto: false },
}), { refresh: true, reason: 'market-open-stale' });

// ════════════════════════════════════════════════════════════════════════════
// 4. closed-since-refresh — 마감 확정 시각이 마지막 갱신 이후 지남
// ════════════════════════════════════════════════════════════════════════════
check('KR 장중 갱신 → 마감 후(16:00 KST) → 확정 종가 미반영', shouldRefreshPrices({
  lastRefreshAt: '2026-09-04T05:00:00.000Z', // KST 09-04(금) 14:00
  now: '2026-09-04T07:00:00.000Z', // KST 09-04 16:00 (마감 15:30 이후, 확정 15:40 이후)
  holdings: { hasKR: true, hasUS: false, hasCrypto: false },
}), { refresh: true, reason: 'closed-since-refresh' });

check('KR 마감 확정 이후 갱신 → fresh(이미 반영)', shouldRefreshPrices({
  lastRefreshAt: '2026-09-04T06:45:00.000Z', // KST 09-04 15:45 (마감 확정 15:40 이후)
  now: '2026-09-04T09:00:00.000Z', // KST 09-04 18:00
  holdings: { hasKR: true, hasUS: false, hasCrypto: false },
}), { refresh: false, reason: 'fresh' });

check('주말 — 금요일 마감 확정 후 갱신했으면 fresh 유지', shouldRefreshPrices({
  lastRefreshAt: '2026-09-04T06:45:00.000Z', // KST 09-04(금) 15:45
  now: '2026-09-06T03:00:00.000Z', // KST 09-06(일) 12:00
  holdings: { hasKR: true, hasUS: false, hasCrypto: false },
}), { refresh: false, reason: 'fresh' });

check('주말 — 목요일 이후 미갱신이면 금요일 마감분 catch-up', shouldRefreshPrices({
  lastRefreshAt: '2026-09-03T05:00:00.000Z', // KST 09-03(목) 14:00
  now: '2026-09-05T01:00:00.000Z', // KST 09-05(토) 10:00
  holdings: { hasKR: true, hasUS: false, hasCrypto: false },
}), { refresh: true, reason: 'closed-since-refresh' });

check('CRYPTO 09:00 KST 경계 이전 갱신은 아직 fresh(경계 전)', shouldRefreshPrices({
  lastRefreshAt: '2026-09-07T00:00:00.000Z', // KST 09-07 09:00
  now: '2026-09-07T00:10:00.000Z', // KST 09-07 09:10 (다음 경계는 09-08 09:00)
  holdings: { hasKR: false, hasUS: false, hasCrypto: true },
}), { refresh: false, reason: 'fresh' });

// ════════════════════════════════════════════════════════════════════════════
// 5. describeFreshness
// ════════════════════════════════════════════════════════════════════════════
check('기록 없음', describeFreshness(null, '2026-09-07T00:00:00.000Z'), '기준 시각 없음');
check('잘못된 날짜', describeFreshness('not-a-date', '2026-09-07T00:00:00.000Z'), '기준 시각 없음');
check('장중 라벨 — 스펙 예시 그대로', describeFreshness('2026-09-03T05:20:00.000Z', '2026-09-03T05:20:00.000Z'), '09-03 14:20 (장중)');
check('마감 후 라벨 — 스펙 예시 그대로', describeFreshness('2026-09-02T10:00:00.000Z', '2026-09-02T10:00:00.000Z'), '09-02 마감 후');
check('주말 마감 후 라벨', describeFreshness('2026-09-05T03:00:00.000Z', '2026-09-05T03:00:00.000Z'), '09-05 마감 후');

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ priceFreshness parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ priceFreshness parity 전체 통과 (${pass} 단언)`);
