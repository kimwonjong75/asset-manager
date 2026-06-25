// tests/climaxDistributionParity.ts
// ---------------------------------------------------------------------------
// Parity 회귀 테스트 — 클라이맥스/디스트리뷰션 공통 카운팅 함수의 동작을 고정한다.
//
// 배경: 클라이맥스 플래그 카운팅은 과거 riskMatrix·smartFilterLogic에 복제돼 있었고,
//   디스트리뷰션 카운팅도 smartFilterLogic이 marketDistribution.countDistributionDays를
//   인라인 복제했다. 이를 공통 함수(utils/climaxFlags.countClimaxFlags + countDistributionDays)로
//   합쳤으며(4단계 완료), 이 테스트가 추출 전후 동작 동일성을 보증하는 회귀 핀이다.
//
// 설계 원칙(리뷰 합의):
//   1) 운영 함수를 직접 호출 — 계산식을 테스트에 복제하지 않는다. fixture(입력)만 만든다.
//      · utils/riskMatrix.computeRiskTier        → climaxFlagCount / distributionCount
//      · utils/smartFilterLogic.matchesSingleFilter → CLIMAX_TOP / DISTRIBUTION_HIGH (boolean)
//      · utils/marketDistribution.countDistributionDays → 공유 디스트리뷰션 카운터
//   2) fixture별 명시적 골든 기대값(절대값)에 두 경로를 모두 핀한다.
//      ⚠ 단순 경로-대-경로 동등성(distMatches === countDistributionDays(...)>=T)만 비교하면,
//      공통 함수 추출로 두 경로가 같은 함수를 호출하는 지금은 식이 자기참조 타우톨로지가 되어
//      공통 함수가 틀려도 통과한다. 골든 절대값은 리팩터 후에도 실제 출력 변화를 잡는다.
//   3) 임계 경계값(바로 아래 / 같음 / 바로 위)을 핀한다.
//   4) null / OHLCV 미수신 / 빈 메타데이터를 핀한다.
//   5) 엔진별 정책 차이(양봉 게이트, 장기상승 게이트 토글)로 의도적으로 결과가 갈리는
//      경우도 고정한다 — 추출(및 향후 변경)이 이 차이를 보존함을 강제.
//
// 수동 실행(CI 미통합): npm run test:parity   (tsx)
// 통과 시 exit 0, 불일치 1건이라도 있으면 exit 1.

import { computeRiskTier, DEFAULT_RISK_MATRIX_THRESHOLDS } from '../utils/riskMatrix';
import { matchesSingleFilter } from '../utils/smartFilterLogic';
import type { ExtraFilterConfig } from '../types/smartFilter';
import { countDistributionDays } from '../utils/marketDistribution';
import type { DistributionDayMeta } from '../utils/marketDistribution';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';
import type { EnrichedAsset } from '../types/ui';

// CLIMAX_TOP (c)의 거래량 보조 임계 — climaxFlags.CLIMAX_C_VOL_SURGE_RATIO 와 동일(2.0).
// 운영 상수를 직접 import하지 않고 경계 fixture로 1.99/2.0/2.01을 핀해 drift를 잡는다.
const PRICE = 1000;

// ── 미니 단언기 ──────────────────────────────────────────────────────────────
let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) pass++;
  else fails.push(`✗ ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// ── fixture 헬퍼 (입력만 생성 — 계산 로직 없음) ──────────────────────────────
function mkEnriched(o: Partial<EnrichedIndicatorData> = {}): EnrichedIndicatorData {
  return {
    ma: {}, prevMa: {}, rsi: null, prevRsi: null, maCrossDays: {},
    prevClose: null, priceCrossMaDays: {}, priceBreakBelowMaDays: {},
    rsiBounceDay: null, rsiOverheatEntryDay: null,
    atr14: null, high52w: null, volume52wMax: null,
    slopeRatio: null, dayRangeOverAtr: null,
    priceIsAt52wHigh: false, volumeIsAt52wMax: false,
    distributionDayMeta: [], ohlcvAvailable: true,
    isBullishCandle: null, longTrendUp: null, recentSwingLow: null,
    ...o,
  };
}

function dday(
  volRatio: number | null,
  churn: { bearish?: boolean | null; lowerHalf?: boolean | null; change?: number } = {},
): DistributionDayMeta {
  return {
    volRatio,
    isBearish: churn.bearish ?? null,
    isLowerHalfClose: churn.lowerHalf ?? null,
    changeRatio: churn.change ?? 0.01, // 기본 0.01 = 정체(<0.002) 아님
  };
}

// asset은 CLIMAX_TOP/DISTRIBUTION_HIGH 분기에서 사용되지 않으므로 최소 스텁으로 충분.
const STUB_ASSET = { priceOriginal: PRICE, indicators: {}, metrics: {} } as unknown as EnrichedAsset;

const climaxMatches = (e: EnrichedIndicatorData, cfg: ExtraFilterConfig): boolean =>
  matchesSingleFilter(STUB_ASSET, 'CLIMAX_TOP', 0, 20, 60, e, 5, cfg);
const distMatches = (e: EnrichedIndicatorData, cfg: ExtraFilterConfig): boolean =>
  matchesSingleFilter(STUB_ASSET, 'DISTRIBUTION_HIGH', 0, 20, 60, e, 5, cfg);
const riskFlags = (e: EnrichedIndicatorData): number =>
  computeRiskTier(e, PRICE, DEFAULT_RISK_MATRIX_THRESHOLDS).climaxFlagCount;
const riskDist = (e: EnrichedIndicatorData): number =>
  computeRiskTier(e, PRICE, DEFAULT_RISK_MATRIX_THRESHOLDS).distributionCount;

// ════════════════════════════════════════════════════════════════════════════
// 1. CLIMAX — 기본 프로필에서 CLIMAX_TOP 카운트 == computeRiskTier().climaxFlagCount
//    (경계값 fixture 포함: slope 2.5 / atr 2.5 / volRatio 2.0 의 ±)
// ════════════════════════════════════════════════════════════════════════════
// flags = 명시적 골든 기대 플래그 수(절대값). 두 운영 경로를 모두 이 값에 핀한다.
const climaxFixtures: Array<{ name: string; flags: number; e: EnrichedIndicatorData }> = [
  { name: 'none', flags: 0, e: mkEnriched({ longTrendUp: true }) },
  { name: 'a-below(2.49)', flags: 0, e: mkEnriched({ longTrendUp: true, slopeRatio: 2.49 }) },
  { name: 'a-eq(2.5)', flags: 1, e: mkEnriched({ longTrendUp: true, slopeRatio: 2.5 }) },
  { name: 'a-above(2.51)', flags: 1, e: mkEnriched({ longTrendUp: true, slopeRatio: 2.51 }) },
  { name: 'b-below(2.49)', flags: 0, e: mkEnriched({ longTrendUp: true, dayRangeOverAtr: 2.49, isBullishCandle: true }) },
  { name: 'b-eq(2.5)', flags: 1, e: mkEnriched({ longTrendUp: true, dayRangeOverAtr: 2.5, isBullishCandle: true }) },
  { name: 'c-volMax', flags: 1, e: mkEnriched({ longTrendUp: true, priceIsAt52wHigh: true, volumeIsAt52wMax: true }) },
  { name: 'c-volRatio-eq(2.0)', flags: 1, e: mkEnriched({ longTrendUp: true, priceIsAt52wHigh: true, distributionDayMeta: [dday(2.0)] }) },
  { name: 'c-volRatio-below(1.99)', flags: 0, e: mkEnriched({ longTrendUp: true, priceIsAt52wHigh: true, distributionDayMeta: [dday(1.99)] }) },
  { name: 'ab(2flags)', flags: 2, e: mkEnriched({ longTrendUp: true, slopeRatio: 3, dayRangeOverAtr: 3, isBullishCandle: true }) },
  { name: 'abc(3flags)', flags: 3, e: mkEnriched({ longTrendUp: true, slopeRatio: 3, dayRangeOverAtr: 3, isBullishCandle: true, priceIsAt52wHigh: true, volumeIsAt52wMax: true }) },
  // 게이트: longTrendUp=false → riskMatrix 0 (양 경로 기본 프로필 0)
  { name: 'longTrendUp-false', flags: 0, e: mkEnriched({ longTrendUp: false, slopeRatio: 3 }) },
  // 게이트: OHLCV 미수신(dayRangeOverAtr=null)이면 (b) 평가 불가 → (a)만 = 1
  { name: 'ohlcv-missing-b', flags: 1, e: mkEnriched({ longTrendUp: true, slopeRatio: 3, dayRangeOverAtr: null, ohlcvAvailable: false }) },
  // null 데이터(longTrendUp=null): riskMatrix는 false만 0처리 → null은 통과 → (a)만 = 1
  { name: 'longTrendUp-null', flags: 1, e: mkEnriched({ longTrendUp: null, slopeRatio: 3 }) },
];

for (const { name, flags, e } of climaxFixtures) {
  // 절대 골든: computeRiskTier 의 플래그 카운트가 명시 기대값과 일치 (리팩터 후에도 타우톨로지 아님)
  check(`climax golden flags: ${name}`, riskFlags(e), flags);
  for (const N of [1, 2, 3]) {
    // smartFilter 경로도 동일 명시 기대값에 핀 (두 경로가 함께 틀려도 잡힘)
    check(`climax match==golden: ${name} (N=${N})`, climaxMatches(e, { climaxFlagsRequired: N }), flags >= N);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 2. CLIMAX — 엔진별 정책 차이(요구 5). 토글을 끄면 smartFilter는 게이트를 무시 →
//    riskMatrix(무조건 게이트)와 의도적으로 갈린다. 4단계는 이 차이를 보존해야 한다.
// ════════════════════════════════════════════════════════════════════════════
// D1: 장기상승 게이트 — longTrendUp=false + (a) 충족
{
  const e = mkEnriched({ longTrendUp: false, slopeRatio: 3 });
  check('divergence D1: riskMatrix zeroes on longTrendUp=false', riskFlags(e), 0);
  check('divergence D1: smartFilter default(requireLongUp) agrees=false', climaxMatches(e, { climaxFlagsRequired: 1 }), false);
  check('divergence D1: smartFilter requireLongUp=false → diverges=true', climaxMatches(e, { climaxFlagsRequired: 1, climaxRequireLongTrendUp: false }), true);
}
// D2: 양봉 게이트 — isBullishCandle=false + (b) 충족
{
  const e = mkEnriched({ longTrendUp: true, dayRangeOverAtr: 3, isBullishCandle: false });
  check('divergence D2: riskMatrix gates (b) on non-bullish', riskFlags(e), 0);
  check('divergence D2: smartFilter default(requireBullish) agrees=false', climaxMatches(e, { climaxFlagsRequired: 1 }), false);
  check('divergence D2: smartFilter requireBullish=false → diverges=true', climaxMatches(e, { climaxFlagsRequired: 1, climaxRequireBullishCandle: false }), true);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. DISTRIBUTION — DISTRIBUTION_HIGH(인라인) == countDistributionDays(공유)
//    + computeRiskTier().distributionCount == countDistributionDays(meta, 13, 1.5)
// ════════════════════════════════════════════════════════════════════════════
const churn = (vr: number) => dday(vr, { bearish: true });           // 음봉 churn
const noChurn = (vr: number) => dday(vr, { bearish: false, lowerHalf: false, change: 0.01 }); // 고거래량이나 churn 아님
const stagnation = (vr: number) => dday(vr, { bearish: null, lowerHalf: null, change: 0.001 }); // OHLCV 미수신 + 정체

// defaultCount = (13,1.5) 윈도우의 명시적 골든 카운트. cases[].count = 해당 (W,R)의 골든 카운트.
const distFixtures: Array<{
  name: string;
  meta: DistributionDayMeta[];
  defaultCount: number;
  cases: Array<{ W: number; R: number; T: number; count: number }>;
}> = [
  { name: 'empty', meta: [], defaultCount: 0, cases: [{ W: 13, R: 1.5, T: 1, count: 0 }] },
  {
    name: 'churn5+noChurn3',
    meta: [noChurn(2), noChurn(2), noChurn(2), churn(2), churn(2), churn(2), churn(2), churn(2)],
    defaultCount: 5,
    cases: [
      { W: 13, R: 1.5, T: 4, count: 5 }, // 5>=4 true
      { W: 13, R: 1.5, T: 5, count: 5 }, // 5>=5 true (경계 같음)
      { W: 13, R: 1.5, T: 6, count: 5 }, // 5>=6 false (경계 위)
    ],
  },
  {
    name: 'volRatio-boundary(1.5)',
    meta: [churn(1.5), churn(1.49), churn(1.5)], // 1.5 두 개만 카운트(>=), 1.49 제외
    defaultCount: 2,
    cases: [
      { W: 13, R: 1.5, T: 2, count: 2 }, // 2>=2 true
      { W: 13, R: 1.5, T: 3, count: 2 }, // 2>=3 false
    ],
  },
  {
    name: 'window-excludes-old',
    meta: [churn(2), churn(2), churn(2), noChurn(2), noChurn(2)], // churn은 앞(오래된)쪽
    defaultCount: 3, // 윈도우 13(=전체 5)에서 churn 3
    cases: [
      { W: 2, R: 1.5, T: 1, count: 0 }, // 최근 2일=noChurn → 0
      { W: 5, R: 1.5, T: 3, count: 3 }, // 전체 → 3
    ],
  },
  {
    name: 'stagnation-ohlcv-missing',
    meta: [stagnation(2), stagnation(2)], // 음봉/윗꼬리 null이지만 정체(change<0.002)로 churn
    defaultCount: 2,
    cases: [{ W: 13, R: 1.5, T: 2, count: 2 }], // 2>=2 true
  },
  {
    name: 'null-volRatio-skipped',
    meta: [dday(null, { bearish: true }), churn(2)], // null volRatio 일자는 제외 → 1
    defaultCount: 1,
    cases: [
      { W: 13, R: 1.5, T: 1, count: 1 }, // 1>=1 true
      { W: 13, R: 1.5, T: 2, count: 1 }, // 1>=2 false
    ],
  },
];

for (const { name, meta, defaultCount, cases } of distFixtures) {
  const e = mkEnriched({ distributionDayMeta: meta });
  // 절대 골든: 공유 카운터와 computeRiskTier 둘 다 명시 기대값에 핀 (리팩터 후에도 타우톨로지 아님)
  check(`dist golden default(13,1.5): ${name}`, countDistributionDays(meta, 13, 1.5), defaultCount);
  check(`dist riskMatrix==golden: ${name}`, riskDist(e), defaultCount);
  for (const { W, R, T, count } of cases) {
    check(`dist golden count: ${name} (W${W},R${R})`, countDistributionDays(meta, W, R), count);
    // smartFilter DISTRIBUTION_HIGH 도 명시 골든에 핀
    check(
      `dist match==golden: ${name} (W${W},R${R},T${T})`,
      distMatches(e, { distributionWindow: W, distributionVolumeRatio: R, distributionThreshold: T }),
      count >= T,
    );
  }
}

// ── 결과 ─────────────────────────────────────────────────────────────────────
console.log(`\nclimax/distribution parity: ${pass} passed, ${fails.length} failed`);
if (fails.length > 0) {
  for (const f of fails) console.log(f);
  process.exitCode = 1;
} else {
  console.log('✓ 모든 parity 핀 통과 — 공통 함수(climaxFlags/countDistributionDays) 동작 고정됨');
}
