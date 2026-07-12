// tests/marketOverviewParity.ts
// ---------------------------------------------------------------------------
// 시장 요약(금 김치 프리미엄 + 환율) 순수 계산 골든 테스트.
//   · marketOverviewCalculations: 국제금 환산 / 프리미엄 / 유효환율 / 이상치 가드
//   · marketOverviewSeries: forward-fill 정렬 / 휴장일 불일치 / 환율 이상치 제외 / 초기구간 생략
//
// 골든 값은 구현을 되읽지 않고 손으로 유도한 절대값으로 고정한다(자기참조 금지).
// 환산 상수 31.1035를 상쇄하도록 입력을 설계해 값이 딱 떨어지게 했다:
//   intlGoldKRWPerG(3110.35, 1000) = 3110.35 × 1000 ÷ 31.1035 = 100000.
//
// 수동 실행: npm run test:overview (tsx). 통과 시 exit 0.
// ---------------------------------------------------------------------------

import {
  intlGoldKRWPerG,
  goldPremiumPct,
  effectiveUsdKrw,
  changePct,
  isSaneUsdKrw,
  isPositiveFinite,
} from '../utils/marketOverviewCalculations';
import {
  buildGoldPremiumSeries,
  buildFxSeries,
  DateSeries,
} from '../utils/marketOverviewSeries';

let pass = 0;
const fails: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function checkClose(name: string, actual: number | null, expected: number, eps = 1e-6): void {
  if (actual !== null && Math.abs(actual - expected) <= eps) pass++;
  else fails.push(`✗ ${name}: got ${actual}, expected ${expected}`);
}

// ── 1. 국제금 환산 (troy oz → g) ──────────────────────────────────────────
// 3110.35 USD/oz × 1000 KRW/USD ÷ 31.1035 g/oz = 100000 KRW/g
checkClose('intlGoldKRWPerG 정상', intlGoldKRWPerG(3110.35, 1000), 100000);
check('intlGoldKRWPerG intl 0', intlGoldKRWPerG(0, 1000), 0);
check('intlGoldKRWPerG 환율 0', intlGoldKRWPerG(3110.35, 0), 0);
check('intlGoldKRWPerG 환율 이상치(>3000)', intlGoldKRWPerG(3110.35, 5000), 0);

// ── 2. 프리미엄 % ──────────────────────────────────────────────────────────
checkClose('premium +10%', goldPremiumPct(110000, 100000), 10);
checkClose('premium 0%', goldPremiumPct(100000, 100000), 0);
checkClose('premium 역프 -5%', goldPremiumPct(95000, 100000), -5);
check('premium 국내금 0 → null', goldPremiumPct(0, 100000), null);
check('premium 국제금 0 → null', goldPremiumPct(100000, 0), null);

// ── 3. 유효 환율 선택 (override 우선, 이상치는 시장값으로) ─────────────────
check('effRate override 우선', effectiveUsdKrw(1400, 1498), 1400);
check('effRate override 0 → 시장', effectiveUsdKrw(0, 1498), 1498);
check('effRate override 이상치 → 시장', effectiveUsdKrw(5000, 1498), 1498);
check('effRate 둘 다 이상치 → null', effectiveUsdKrw(5000, 9999), null);
check('effRate 둘 다 0 → null', effectiveUsdKrw(0, 0), null);

// ── 4. 이상치/유효성 가드 ─────────────────────────────────────────────────
check('isSaneUsdKrw 1498 true', isSaneUsdKrw(1498), true);
check('isSaneUsdKrw 3000 경계 true', isSaneUsdKrw(3000), true);
check('isSaneUsdKrw 3001 false', isSaneUsdKrw(3001), false);
check('isSaneUsdKrw 0 false', isSaneUsdKrw(0), false);
check('isPositiveFinite NaN false', isPositiveFinite(NaN), false);
check('isPositiveFinite -1 false', isPositiveFinite(-1), false);

// ── 5. 전일 대비 변동률 ───────────────────────────────────────────────────
checkClose('changePct +10%', changePct(110, 100), 10);
check('changePct prev 0 → null', changePct(110, 0), null);

// ── 6. 금 프리미엄 시계열 (forward-fill + 휴장일 + 환율 이상치 제외) ────────
// gold(KRX 축) 3일, intl은 06-02 결측(미국 휴장), fx는 06-02에 이상치(999999) 삽입.
// 환율=1000 고정, intl 3110.35→100000 / 3141.4535→101000 KRW/g 로 환산되도록 설계.
const gold: DateSeries = {
  '2026-06-01': 100000,
  '2026-06-02': 101000,
  '2026-06-03': 102000,
};
const intl: DateSeries = {
  '2026-06-01': 3110.35,   // → 100000 KRW/g
  '2026-06-03': 3141.4535, // → 101000 KRW/g  (06-02 결측)
};
const fx: DateSeries = {
  '2026-06-01': 1000,
  '2026-06-02': 999999,    // 이상치 → 제외, 06-01(1000)로 forward-fill 되어야 함
  '2026-06-03': 1000,
};
const series = buildGoldPremiumSeries(gold, intl, fx);
check('시계열 길이 3', series.length, 3);
// 06-01: intl 100000, premium 0
check('06-01 date', series[0].date, '2026-06-01');
checkClose('06-01 intlKRWPerG', series[0].intlKRWPerG, 100000);
checkClose('06-01 premium', series[0].premiumPct, 0);
check('06-01 fxDate', series[0].fxDate, '2026-06-01');
// 06-02: intl forward-fill(06-01 100000), fx는 이상치 무시하고 06-01(1000) 사용 → premium (101000-100000)/100000 = 1%
checkClose('06-02 intlKRWPerG(ffill)', series[1].intlKRWPerG, 100000);
checkClose('06-02 premium', series[1].premiumPct, 1);
check('06-02 fxDate(이상치 제외 → 06-01)', series[1].fxDate, '2026-06-01');
// 06-03: intl 101000, premium (102000-101000)/101000×100
checkClose('06-03 intlKRWPerG', series[2].intlKRWPerG, 101000);
checkClose('06-03 premium', series[2].premiumPct, (102000 - 101000) / 101000 * 100);

// 초기구간 생략: gold가 intl/fx보다 앞서면 그 포인트 제외
const goldEarly: DateSeries = { '2026-05-30': 99000, '2026-06-01': 100000 };
const seriesEarly = buildGoldPremiumSeries(goldEarly, intl, fx);
check('초기구간(05-30) 생략 → 길이 1', seriesEarly.length, 1);
check('초기구간 생략 후 첫 날짜 06-01', seriesEarly[0].date, '2026-06-01');

// ── 7. 환율 시계열 (USD·JPY 합집합 + forward-fill) ─────────────────────────
const usd: DateSeries = { '2026-06-01': 1300, '2026-06-03': 1350 }; // 06-02 결측
const jpy: DateSeries = { '2026-06-01': 9.0, '2026-06-02': 9.1 };    // 06-03 결측
const fxSeries = buildFxSeries(usd, jpy);
check('환율 시계열 길이 3(합집합)', fxSeries.length, 3);
check('06-01 usd', fxSeries[0].usdKrw, 1300);
check('06-01 jpy', fxSeries[0].jpyKrw, 9.0);
check('06-02 usd(ffill 1300)', fxSeries[1].usdKrw, 1300);
check('06-02 jpy 9.1', fxSeries[1].jpyKrw, 9.1);
check('06-03 usd 1350', fxSeries[2].usdKrw, 1350);
check('06-03 jpy(ffill 9.1)', fxSeries[2].jpyKrw, 9.1);

// ── 결과 ──────────────────────────────────────────────────────────────────
if (fails.length === 0) {
  console.log(`✓ marketOverviewParity: ${pass} assertions passed`);
  process.exit(0);
} else {
  console.error(`✗ marketOverviewParity: ${fails.length} failed / ${pass} passed`);
  fails.forEach((f) => console.error('  ' + f));
  process.exit(1);
}
