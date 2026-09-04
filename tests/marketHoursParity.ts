// tests/marketHoursParity.ts
// utils/marketHours.ts 골든 테스트 — 명시적 절대값(KST/UTC epoch instant)만 고정한다.
// 모든 instant는 손으로 환산해 검증했다(KST=UTC+9 상시, US는 DST 규칙):
//   · 2026-03-08(일) = 2026년 3월 둘째 일요일(DST 시작), 2026-11-01(일) = 11월 첫째 일요일(DST 종료)
//   · 2026-09-04(금)/2026-09-05(토)/2026-09-06(일)/2026-09-07(월) 요일은 Date.UTC(...).getUTCDay()로 확인됨
// 수동 실행: npm run test:markethours (tsx). 통과 시 exit 0.

import { isMarketOpen, isQuietHours, lastSessionDate, closeConfirmTime } from '../utils/marketHours';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

// ════════════════════════════════════════════════════════════════════════════
// 1. isMarketOpen — KR (평일 09:00–15:30 KST)
// ════════════════════════════════════════════════════════════════════════════
check('KR 월요일 09:00 KST 개장(경계 포함)', isMarketOpen('KR', '2026-09-07T00:00:00.000Z'), true);
check('KR 월요일 08:59 KST 개장 전', isMarketOpen('KR', '2026-09-06T23:59:00.000Z'), false);
check('KR 금요일 15:29 KST 개장중', isMarketOpen('KR', '2026-09-04T06:29:00.000Z'), true);
check('KR 금요일 15:30 KST 마감(경계 제외)', isMarketOpen('KR', '2026-09-04T06:30:00.000Z'), false);
check('KR 토요일 휴장', isMarketOpen('KR', '2026-09-05T03:00:00.000Z'), false);
check('KR 일요일 휴장', isMarketOpen('KR', '2026-09-06T03:00:00.000Z'), false);

// ════════════════════════════════════════════════════════════════════════════
// 2. isMarketOpen — US (09:30–16:00 ET, DST 경계 포함)
// ════════════════════════════════════════════════════════════════════════════
// DST 시작 전(2026-03-06 금, EST=UTC-5): 09:30 ET = 14:30 UTC
check('US 표준시(EST) 09:30 ET 개장', isMarketOpen('US', '2026-03-06T14:30:00.000Z'), true);
check('US 표준시(EST) 09:29 ET 개장 전', isMarketOpen('US', '2026-03-06T14:29:00.000Z'), false);
check('US 표준시(EST) 16:00 ET 마감(경계 제외)', isMarketOpen('US', '2026-03-06T21:00:00.000Z'), false);
check('US 표준시(EST) 15:59 ET 개장중', isMarketOpen('US', '2026-03-06T20:59:00.000Z'), true);
// DST 시작 후(2026-03-09 월, EDT=UTC-4): 09:30 ET = 13:30 UTC
check('US 서머타임(EDT) 시작 직후 09:30 ET 개장', isMarketOpen('US', '2026-03-09T13:30:00.000Z'), true);
// DST 종료 전(2026-10-30 금, EDT): 09:30 ET = 13:30 UTC
check('US 서머타임(EDT) 종료 전 09:30 ET 개장', isMarketOpen('US', '2026-10-30T13:30:00.000Z'), true);
// DST 종료 후(2026-11-02 월, EST): 09:30 ET = 14:30 UTC
check('US 표준시(EST) 복귀 후 09:30 ET 개장', isMarketOpen('US', '2026-11-02T14:30:00.000Z'), true);
// 주말(ET 토요일, EDT 구간)
check('US 토요일 휴장(ET)', isMarketOpen('US', '2026-09-05T18:00:00.000Z'), false); // ET 2026-09-05 14:00 (토)

// ════════════════════════════════════════════════════════════════════════════
// 3. isMarketOpen — CRYPTO (24시간 상시)
// ════════════════════════════════════════════════════════════════════════════
check('CRYPTO 일요일 새벽도 개장', isMarketOpen('CRYPTO', '2026-09-06T12:00:00.000Z'), true);
check('CRYPTO 평일 심야도 개장', isMarketOpen('CRYPTO', '2026-09-07T15:00:00.000Z'), true);

// ════════════════════════════════════════════════════════════════════════════
// 4. isQuietHours — 00:00–07:00 KST
// ════════════════════════════════════════════════════════════════════════════
check('정숙시간 KST 00:00 경계 포함', isQuietHours('2026-09-04T15:00:00.000Z'), true); // KST 09-05 00:00
check('정숙시간 KST 06:59 포함', isQuietHours('2026-09-04T21:59:00.000Z'), true); // KST 09-05 06:59
check('정숙시간 KST 07:00 경계 제외', isQuietHours('2026-09-04T22:00:00.000Z'), false); // KST 09-05 07:00
check('정숙시간 KST 낮 시간 제외', isQuietHours('2026-09-04T13:00:00.000Z'), false); // KST 09-04 22:00

// ════════════════════════════════════════════════════════════════════════════
// 5. lastSessionDate — KR
// ════════════════════════════════════════════════════════════════════════════
check('KR 월요일 개장 후 → 오늘', lastSessionDate('KR', '2026-09-07T01:00:00.000Z'), '2026-09-07'); // KST 10:00
check('KR 월요일 개장 전 → 직전 금요일', lastSessionDate('KR', '2026-09-06T23:00:00.000Z'), '2026-09-04'); // KST 09-07 08:00
check('KR 토요일 → 직전 금요일', lastSessionDate('KR', '2026-09-05T03:00:00.000Z'), '2026-09-04');
check('KR 일요일 → 직전 금요일', lastSessionDate('KR', '2026-09-06T03:00:00.000Z'), '2026-09-04');

// ════════════════════════════════════════════════════════════════════════════
// 6. lastSessionDate — US (반환값은 ET 거래일=KST 세션 시작일과 동일)
// ════════════════════════════════════════════════════════════════════════════
check('US 월요일 개장 후 → 오늘(ET)', lastSessionDate('US', '2026-09-07T14:00:00.000Z'), '2026-09-07'); // ET 10:00 EDT
check('US 월요일 개장 전 → 직전 금요일(ET)', lastSessionDate('US', '2026-09-07T12:00:00.000Z'), '2026-09-04'); // ET 08:00 EDT
check('US 토요일 → 직전 금요일(ET)', lastSessionDate('US', '2026-09-05T16:00:00.000Z'), '2026-09-04'); // ET 12:00 EDT

// ════════════════════════════════════════════════════════════════════════════
// 7. lastSessionDate — CRYPTO (09:00 KST 경계, 주말 스킵 없음)
// ════════════════════════════════════════════════════════════════════════════
check('CRYPTO 09:00 KST 이후 → 오늘', lastSessionDate('CRYPTO', '2026-09-07T01:00:00.000Z'), '2026-09-07'); // KST 10:00
check('CRYPTO 09:00 KST 이전 → 전날', lastSessionDate('CRYPTO', '2026-09-06T20:00:00.000Z'), '2026-09-06'); // KST 09-07 05:00
check('CRYPTO 주말도 스킵 없음', lastSessionDate('CRYPTO', '2026-09-06T06:00:00.000Z'), '2026-09-06'); // KST 09-06(일) 15:00

// ════════════════════════════════════════════════════════════════════════════
// 8. closeConfirmTime
// ════════════════════════════════════════════════════════════════════════════
check('KR 마감 확정 15:40 KST', closeConfirmTime('KR', '2026-09-07'), '2026-09-07T06:40:00.000Z');
check('US 마감 확정 16:40 ET(EDT, 서머타임 중)', closeConfirmTime('US', '2026-09-07'), '2026-09-07T20:40:00.000Z');
check('US 마감 확정 — DST 시작 당일(2026-03-08, EDT 적용)', closeConfirmTime('US', '2026-03-08'), '2026-03-08T20:40:00.000Z');
check('US 마감 확정 — DST 시작 전날(2026-03-07, EST)', closeConfirmTime('US', '2026-03-07'), '2026-03-07T21:40:00.000Z');
check('US 마감 확정 — DST 종료 당일(2026-11-01, EST 복귀)', closeConfirmTime('US', '2026-11-01'), '2026-11-01T21:40:00.000Z');
check('US 마감 확정 — DST 종료 전날(2026-10-31, EDT)', closeConfirmTime('US', '2026-10-31'), '2026-10-31T20:40:00.000Z');
check('CRYPTO 마감 확정 = D+1 09:00 KST', closeConfirmTime('CRYPTO', '2026-09-07'), '2026-09-08T00:00:00.000Z');
check('CRYPTO 마감 확정 — 월말 롤오버', closeConfirmTime('CRYPTO', '2026-09-30'), '2026-10-01T00:00:00.000Z');

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ marketHours parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ marketHours parity 전체 통과 (${pass} 단언)`);
