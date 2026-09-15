// tests/buyReadinessParity.ts
// ---------------------------------------------------------------------------
// 관심종목 '매수 점검'(utils/stockReview.computeBuyReadiness) 골든 회귀 — 명시적 절대값 핀(RULES §13).
//   · 매수 조건 3개(현재가>MA60 / 정배열 20>60 / RSI≤30) 충족·판정불가 카운트를 절대값으로 고정
//   · enriched 없음 → null
//   · 단일 소스: asset.indicators(오래된 값)가 있어도 enriched 가 비면 판정 불가(폴백 차단)
//   · 교차 확인: 같은 입력의 buildStockReviewViewModel 매수 조건과 met/unknown/라벨이 일치
//     (경로 A-vs-B 비교만으로는 공통 함수 추출 후 동어반복이 되므로 절대값도 함께 핀)
// 수동 실행: npx tsx tests/buyReadinessParity.ts. 통과 시 exit 0.

import { buildStockReviewViewModel, computeBuyReadiness } from '../utils/stockReview';
import type { EnrichedAsset, AssetMetrics } from '../types/ui';
import type { Indicators } from '../types/api';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';
import type { BuyReadiness } from '../types/stockReview';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

const BASE_METRICS: AssetMetrics = {
  purchasePrice: 0, currentPrice: 0, currentPriceKRW: 0, purchasePriceKRW: 0,
  purchaseValue: 0, currentValue: 0, purchaseValueKRW: 0, currentValueKRW: 0,
  returnPercentage: 0, allocation: 0, dropFromHigh: 0, profitLoss: 0, profitLossKRW: 0,
  diffFromHigh: 0, yesterdayChange: 0, diffFromYesterday: 0,
};
function mkAsset(o: { priceOriginal?: number; indicators?: Indicators } = {}): EnrichedAsset {
  return {
    id: 'w1', ticker: 'TST', exchange: 'NASDAQ', name: '관심',
    priceOriginal: o.priceOriginal ?? 0, changeRate: 0,
    indicators: o.indicators, metrics: { ...BASE_METRICS },
  } as unknown as EnrichedAsset;
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
const brief = (r: BuyReadiness | null) => r && { met: r.met, total: r.total, unknown: r.unknown };
const states = (r: BuyReadiness | null) => r?.conditions.map(c => c.state) ?? null;

// ════════════════════════════════════════════════════════════════════════════
// 1. 3개 모두 충족 — 가격 110 > MA60 90 · MA20 100 > MA60 90 · RSI 25 ≤ 30
// ════════════════════════════════════════════════════════════════════════════
const A1 = mkAsset({ priceOriginal: 110 });
const E1 = mkEnriched({ ma: { 20: 100, 60: 90 }, rsi: 25 });
const r1 = computeBuyReadiness(A1, E1);
check('1: 3/3 충족', brief(r1), { met: 3, total: 3, unknown: 0 });
check('1: 조건별 상태', states(r1), ['pass', 'pass', 'pass']);
check('1: 조건 키 순서(BUY_SPECS)', r1?.conditions.map(c => c.key), ['PRICE_ABOVE_LONG_MA', 'MA_BULLISH_ALIGN', 'RSI_OVERSOLD']);
check('1: 라벨', r1?.conditions.map(c => c.label), ['현재가 > 60일 이평선', '정배열(20일 > 60일) 상태', 'RSI 과매도(≤30)']);

// ════════════════════════════════════════════════════════════════════════════
// 2. 가격 비정상(0) → 가격 의존 조건만 판정 불가
// ════════════════════════════════════════════════════════════════════════════
const A2 = mkAsset({ priceOriginal: 0 });
const E2 = mkEnriched({ ma: { 20: 100, 60: 90 }, rsi: 25 });
const r2 = computeBuyReadiness(A2, E2);
check('2: 가격 0 → 2충족·1판정불가', brief(r2), { met: 2, total: 3, unknown: 1 });
check('2: 조건별 상태', states(r2), ['unknown', 'pass', 'pass']);
check('2: NaN 가격도 판정 불가', brief(computeBuyReadiness(mkAsset({ priceOriginal: NaN }), E2)), { met: 2, total: 3, unknown: 1 });

// ════════════════════════════════════════════════════════════════════════════
// 3. enriched 없음 → null
// ════════════════════════════════════════════════════════════════════════════
check('3: enriched undefined → null', computeBuyReadiness(A1, undefined), null);
check('3: enriched null → null', computeBuyReadiness(A1, null), null);

// ════════════════════════════════════════════════════════════════════════════
// 4. RSI 45 · MA20 80 < MA60 90 · 가격 100 > MA60 → 1/3
// ════════════════════════════════════════════════════════════════════════════
const A4 = mkAsset({ priceOriginal: 100 });
const E4 = mkEnriched({ ma: { 20: 80, 60: 90 }, rsi: 45 });
const r4 = computeBuyReadiness(A4, E4);
check('4: 1/3', brief(r4), { met: 1, total: 3, unknown: 0 });
check('4: 조건별 상태', states(r4), ['pass', 'fail', 'fail']);

// ════════════════════════════════════════════════════════════════════════════
// 5. 경계: RSI 정확히 30 → 충족 / 가격 == MA60 → 미충족(엄격 초과)
// ════════════════════════════════════════════════════════════════════════════
const r5 = computeBuyReadiness(mkAsset({ priceOriginal: 90 }), mkEnriched({ ma: { 20: 90, 60: 90 }, rsi: 30 }));
check('5: 경계값', brief(r5), { met: 1, total: 3, unknown: 0 });
check('5: 조건별 상태(가격=MA60 미충족·20=60 미충족·RSI 30 충족)', states(r5), ['fail', 'fail', 'pass']);

// ════════════════════════════════════════════════════════════════════════════
// 6. 단일 소스 — enriched 코어 비어 있고 asset.indicators 만 있음 → 폴백 없이 전부 판정 불가
// ════════════════════════════════════════════════════════════════════════════
const A6 = mkAsset({ priceOriginal: 110, indicators: { rsi: 20, ma20: 100, ma60: 90 } as unknown as Indicators });
const r6 = computeBuyReadiness(A6, mkEnriched());
check('6: stale indicators 폴백 차단 → 0/3·판정불가 3', brief(r6), { met: 0, total: 3, unknown: 3 });
check('6: 조건별 상태', states(r6), ['unknown', 'unknown', 'unknown']);
check('6: 입력 asset.indicators 불변(strip 은 복사본)', (A6.indicators as unknown as { rsi: number }).rsi, 20);

// ════════════════════════════════════════════════════════════════════════════
// 7. 교차 확인 — 종목 검토 ViewModel 매수 조건과 일치 (경로 분기 방지)
// ════════════════════════════════════════════════════════════════════════════
const samples: Array<{ name: string; asset: EnrichedAsset; enriched: EnrichedIndicatorData; expectMet: number; expectUnknown: number }> = [
  { name: '1', asset: A1, enriched: E1, expectMet: 3, expectUnknown: 0 },
  { name: '2', asset: A2, enriched: E2, expectMet: 2, expectUnknown: 1 },
  { name: '4', asset: A4, enriched: E4, expectMet: 1, expectUnknown: 0 },
];
for (const s of samples) {
  const r = computeBuyReadiness(s.asset, s.enriched);
  const vm = buildStockReviewViewModel({ asset: s.asset, enriched: s.enriched, source: 'watchlist', name: '관심', asOfLabel: '2026-09-15' });
  const vmMet = vm.buyConditions.filter(c => c.evaluation === '충족').length;
  const vmUnknown = vm.buyConditions.filter(c => c.evaluation === '판정불가' || c.evaluation === '해당 없음').length;
  check(`7-${s.name}: met == 종목 검토 충족 수`, r?.met, vmMet);
  check(`7-${s.name}: unknown == 종목 검토 판정불가+해당없음`, r?.unknown, vmUnknown);
  check(`7-${s.name}: summary.buy.met 와도 일치`, r?.met, vm.summary.buy.met);
  check(`7-${s.name}: total == 매수 조건 수`, r?.total, vm.buyConditions.length);
  check(`7-${s.name}: 조건 키·라벨 일치`, r?.conditions.map(c => [c.key, c.label]), vm.buyConditions.map(c => [c.key, c.label]));
  check(`7-${s.name}: met 절대값 핀`, r?.met, s.expectMet);
  check(`7-${s.name}: unknown 절대값 핀`, r?.unknown, s.expectUnknown);
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ buyReadiness parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ buyReadiness parity 전체 통과 (${pass} 단언)`);
