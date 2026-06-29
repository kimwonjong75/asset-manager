// tests/guruFailOpenParity.ts
// ---------------------------------------------------------------------------
// 구루 buy-watch 0-degrade fail-open 회귀 테스트.
//   문제: buildMetricValues가 climaxFlags/distributionCount를 computeRiskTier(OHLCV 결손 시 보수적 0)에서
//         null-가드 없이 number로 대입 → 종가만 있고 vol/OHLC 결손이면 `climaxFlags<2`/`distributionCount≤4`
//         안전게이트가 0으로 통과 → 매수 관찰 신호 오발화.
//   수정: 입력 결손(hasClimaxInputs/hasDistributionInputs=false) 시 metric 미설정 → evaluateLeaf=null →
//         evaluateCondition(all)=null(≠true) → 미발화(fail-closed). 입력 있으면 종전대로 발화.
// 수동 실행: npm run test:gurufailopen (tsx). 통과 시 exit 0.

import { buildMetricValues, evaluateCondition } from '../utils/guruSignalEngine';
import type { ConditionNode } from '../types/knowledge';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';
import type { DistributionDayMeta } from '../utils/marketDistribution';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

function mkEnriched(o: Partial<EnrichedIndicatorData> = {}): EnrichedIndicatorData {
  return {
    ma: {}, prevMa: {}, rsi: null, prevRsi: null, maCrossDays: {},
    prevClose: null, priceCrossMaDays: {}, priceBreakBelowMaDays: {},
    rsiBounceDay: null, rsiOverheatEntryDay: null,
    atr14: null, high52w: null, volume52wMax: null, slopeRatio: null, dayRangeOverAtr: null,
    priceIsAt52wHigh: false, volumeIsAt52wMax: false, distributionDayMeta: [], ohlcvAvailable: true,
    isBullishCandle: null, longTrendUp: null, recentSwingLow: null, ...o,
  };
}
const distMeta = (volRatio: number | null): DistributionDayMeta =>
  ({ volRatio, isBearish: false, isLowerHalfClose: false, changeRatio: 0 });

// buy-watch 규칙이 실제로 쓰는 안전게이트(knowledgeBase.ts와 동일 의미):
const DIST_GATE: ConditionNode = { all: [{ metric: 'distributionCount', operator: '<=', value: 4 }] };
const CLIMAX_GATE: ConditionNode = { all: [{ metric: 'climaxFlags', operator: '<', value: 2 }] };
// sell-warning(climax-top) 규칙:
const CLIMAX_SELL: ConditionNode = { all: [{ metric: 'climaxFlags', operator: '>=', value: 2 }] };

const PRICE = 1000;

// ════════════════════════════════════════════════════════════════════════════
// 1. buildMetricValues — 입력 결손 시 metric 미설정(undefined), 있으면 number
// ════════════════════════════════════════════════════════════════════════════
{
  // 거래량/OHLC 결손: distributionDayMeta 비어있고 slope/atr null
  const m = buildMetricValues(mkEnriched(), PRICE);
  check('결손: climaxFlags 미설정', m.climaxFlags, undefined);
  check('결손: distributionCount 미설정', m.distributionCount, undefined);
}
{
  // volRatio 전부 null (거래량만 결손) → distribution 미설정
  const m = buildMetricValues(mkEnriched({ distributionDayMeta: [distMeta(null), distMeta(null)] }), PRICE);
  check('volRatio 전부 null: distributionCount 미설정', m.distributionCount, undefined);
}
{
  // climax 입력 일부라도 있으면 설정 (slopeRatio만 있어도)
  const m = buildMetricValues(mkEnriched({ slopeRatio: 1.0 }), PRICE);
  check('slopeRatio 있음: climaxFlags 설정(number)', typeof m.climaxFlags, 'number');
}
{
  // distribution volRatio 산출일 하나라도 있으면 설정
  const m = buildMetricValues(mkEnriched({ distributionDayMeta: [distMeta(1.0)] }), PRICE);
  check('volRatio 있음: distributionCount 설정(number)', typeof m.distributionCount, 'number');
}

// ════════════════════════════════════════════════════════════════════════════
// 2. fail-open 차단 — 입력 결손 시 buy-watch 안전게이트가 통과(true)되지 않음
// ════════════════════════════════════════════════════════════════════════════
{
  const m = buildMetricValues(mkEnriched(), PRICE); // distribution 입력 결손
  check('결손: distributionCount≤4 게이트 = null(미발화)', evaluateCondition(DIST_GATE, m), null);
  check('결손: climaxFlags<2 게이트 = null(미발화)', evaluateCondition(CLIMAX_GATE, m), null);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 정상 경로 보존 — 입력 있으면 종전대로 평가/발화
// ════════════════════════════════════════════════════════════════════════════
{
  // 저(低) distribution(0건)이지만 입력은 있음 → 0 ≤ 4 = true (정당한 발화)
  const m = buildMetricValues(mkEnriched({ distributionDayMeta: [distMeta(1.0)] }), PRICE);
  check('정상: distributionCount=0(입력O) → 게이트 true', evaluateCondition(DIST_GATE, m), true);
}
{
  // 클라이맥스 입력 충분 + 과열 아님(낮은 slope) → climaxFlags<2 = true
  const m = buildMetricValues(mkEnriched({ slopeRatio: 1.0, dayRangeOverAtr: 1.0 }), PRICE);
  check('정상: climaxFlags 낮음(입력O) → <2 게이트 true', evaluateCondition(CLIMAX_GATE, m), true);
}
{
  // 클라이맥스 3플래그 충족(과열) → 매도경고 발화 + buy-watch 게이트는 false(차단)
  const hot = mkEnriched({
    slopeRatio: 3, dayRangeOverAtr: 3, isBullishCandle: true,
    priceIsAt52wHigh: true, volumeIsAt52wMax: true, longTrendUp: true,
  });
  const m = buildMetricValues(hot, PRICE);
  check('과열: climaxFlags≥2 매도경고 발화', evaluateCondition(CLIMAX_SELL, m), true);
  check('과열: climaxFlags<2 buy-watch 게이트 false(차단)', evaluateCondition(CLIMAX_GATE, m), false);
}

console.log(`\nguru fail-open: ${pass} passed, ${fails.length} failed`);
if (fails.length > 0) {
  for (const f of fails) console.log(f);
  process.exitCode = 1;
} else {
  console.log('✓ 입력 결손→metric 미설정→buy-watch 게이트 null(미발화) / 입력 있으면 정상 발화 / 매도경고 보존');
}
