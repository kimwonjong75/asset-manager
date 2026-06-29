// tests/alertFailSafeParity.ts
// ---------------------------------------------------------------------------
// fail-safe(매도 data-gap) 회귀 테스트 — 매도 규칙이 '데이터 누락으로만' 침묵(unknown)한 경우를 분리 노출.
//   · 동치성: evaluateRule(...)==='matched'  ⟺  matchesRule(...)===true  (firing 불변).
//   · collectSellRuleDataGaps: 매도(action==='sell') + enabled + evaluateRule==='unknown' 만 수집.
//     - 진짜 미충족(false 존재)='unmatched'는 미수집(노이즈 방지).
//     - 매수 규칙은 fail-open 유지 — unknown이어도 미수집(부실 데이터 매수 진입 방지).
//   · checkAlertRules 발화 불변(additive): gap 종목은 매칭 0건 그대로.
// 수동 실행: npm run test:failsafe (tsx). 통과 시 exit 0.

import { matchesRule, evaluateRule, collectSellRuleDataGaps, checkAlertRules } from '../utils/alertChecker';
import type { AlertRule } from '../types/alertRules';
import type { EnrichedAsset, AssetMetrics } from '../types/ui';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';

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
function mkAsset(o: { id?: string; ticker?: string; name?: string; priceOriginal?: number; metrics?: Partial<AssetMetrics> } = {}): EnrichedAsset {
  return {
    id: o.id ?? 'id', ticker: o.ticker ?? 'TST', name: o.name ?? '종목',
    priceOriginal: o.priceOriginal ?? 0, changeRate: undefined,
    indicators: undefined, metrics: { ...BASE_METRICS, ...o.metrics },
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
function mkRule(o: Partial<AlertRule>): AlertRule {
  return { id: 'r', name: '규칙', description: '', severity: 'info', action: 'sell', enabled: true, filters: [], filterConfig: {}, ...o };
}
const mapOf = (ticker: string, e: EnrichedIndicatorData) => new Map<string, EnrichedIndicatorData>([[ticker, e]]);

// ════════════════════════════════════════════════════════════════════════════
// 1. 동치성 — evaluateRule==='matched'  ⟺  matchesRule===true  (firing 불변)
// ════════════════════════════════════════════════════════════════════════════
const equivCases: Array<{ name: string; asset: EnrichedAsset; rule: AlertRule; enriched?: EnrichedIndicatorData }> = [
  { name: 'matched(둘 충족)', asset: mkAsset({ priceOriginal: 110, metrics: { returnPercentage: 5 } }), rule: mkRule({ filters: ['PRICE_ABOVE_SHORT_MA', 'PROFIT_POSITIVE'] }), enriched: mkEnriched({ ma: { 20: 100 } }) },
  { name: 'unmatched(하나 false)', asset: mkAsset({ priceOriginal: 90, metrics: { returnPercentage: 5 } }), rule: mkRule({ filters: ['PRICE_ABOVE_SHORT_MA', 'PROFIT_POSITIVE'] }), enriched: mkEnriched({ ma: { 20: 100 } }) },
  { name: 'unknown(no false + null)', asset: mkAsset({ metrics: { returnPercentage: 5 } }), rule: mkRule({ filters: ['PROFIT_POSITIVE', 'RSI_OVERBOUGHT'] }), enriched: mkEnriched() },
  { name: '빈 filters(matched)', asset: mkAsset(), rule: mkRule({ filters: [] }) },
  { name: 'unmatched-with-null(false 우선)', asset: mkAsset({ metrics: { returnPercentage: 5 } }), rule: mkRule({ filters: ['PROFIT_NEGATIVE', 'RSI_OVERBOUGHT'] }), enriched: mkEnriched() },
];
let equivMiss = 0;
for (const c of equivCases) {
  const a = evaluateRule(c.asset, c.rule, c.enriched) === 'matched';
  const b = matchesRule(c.asset, c.rule, c.enriched);
  if (a !== b) { equivMiss++; fails.push(`✗ equiv[${c.name}]: matched=${a} vs matchesRule=${b}`); }
}
check('동치성(matched ⟺ matchesRule)', equivMiss, 0);
check('eval matched', evaluateRule(equivCases[0].asset, equivCases[0].rule, equivCases[0].enriched), 'matched');
check('eval unmatched', evaluateRule(equivCases[1].asset, equivCases[1].rule, equivCases[1].enriched), 'unmatched');
check('eval unknown', evaluateRule(equivCases[2].asset, equivCases[2].rule, equivCases[2].enriched), 'unknown');
check('eval 빈 filters=matched', evaluateRule(mkAsset(), mkRule({ filters: [] })), 'matched');
check('eval false 우선(null 있어도 unmatched)', evaluateRule(equivCases[4].asset, equivCases[4].rule, equivCases[4].enriched), 'unmatched');

// ════════════════════════════════════════════════════════════════════════════
// 2. collectSellRuleDataGaps — 매도 unknown만 수집
// ════════════════════════════════════════════════════════════════════════════
// (a) 매도 규칙 unknown → gap 1건, missingFilters 정확
{
  const rule = mkRule({ id: 'sell-overheat', action: 'sell', filters: ['PROFIT_POSITIVE', 'RSI_OVERBOUGHT'] });
  const asset = mkAsset({ ticker: 'TST', metrics: { returnPercentage: 5 } }); // PROFIT_POSITIVE=true, RSI=null
  const gaps = collectSellRuleDataGaps([asset], mapOf('TST', mkEnriched()), [rule]);
  check('gap 1건(매도 unknown)', gaps.length, 1);
  check('gap ruleId', gaps[0]?.rule.id, 'sell-overheat');
  check('gap affected ticker', gaps[0]?.affectedAssets.map(a => a.ticker), ['TST']);
  check('gap missingFilters(null 필터만)', gaps[0]?.affectedAssets[0]?.missingFilters, ['RSI_OVERBOUGHT']);
  // 발화 불변: 같은 상태에서 matchesRule=false, checkAlertRules 매칭 0건
  check('firing 불변: matchesRule=false', matchesRule(asset, rule, mkEnriched()), false);
  check('firing 불변: checkAlertRules 0건', checkAlertRules([asset], mapOf('TST', mkEnriched()), [rule]).length, 0);
}
// (b) 다중 null 필터 → missingFilters 모두 나열
{
  const rule = mkRule({ id: 'sell-multi', action: 'sell', filters: ['PROFIT_POSITIVE', 'RSI_OVERBOUGHT', 'VOLUME_HIGH'] });
  const asset = mkAsset({ ticker: 'TST', metrics: { returnPercentage: 5 } });
  const gaps = collectSellRuleDataGaps([asset], mapOf('TST', mkEnriched()), [rule]);
  check('gap 다중 missingFilters', gaps[0]?.affectedAssets[0]?.missingFilters, ['RSI_OVERBOUGHT', 'VOLUME_HIGH']);
}
// (c) 진짜 미충족(unmatched) → 미수집
{
  const rule = mkRule({ id: 'sell-neg', action: 'sell', filters: ['PROFIT_NEGATIVE', 'RSI_OVERBOUGHT'] });
  const asset = mkAsset({ ticker: 'TST', metrics: { returnPercentage: 5 } }); // PROFIT_NEGATIVE=false → unmatched
  check('unmatched 미수집', collectSellRuleDataGaps([asset], mapOf('TST', mkEnriched()), [rule]).length, 0);
}
// (d) 완전 매칭(matched) → 미수집(정상 발화)
{
  const rule = mkRule({ id: 'sell-ok', action: 'sell', filters: ['PROFIT_POSITIVE'] });
  const asset = mkAsset({ ticker: 'TST', metrics: { returnPercentage: 5 } });
  check('matched 미수집', collectSellRuleDataGaps([asset], mapOf('TST', mkEnriched()), [rule]).length, 0);
}
// (e) 매수 규칙 unknown → fail-open 유지(미수집)
{
  const rule = mkRule({ id: 'buy-x', action: 'buy', filters: ['PROFIT_POSITIVE', 'RSI_OVERSOLD'] });
  const asset = mkAsset({ ticker: 'TST', metrics: { returnPercentage: 5 } }); // RSI_OVERSOLD=null → unknown
  check('매수 unknown fail-open(미수집)', collectSellRuleDataGaps([asset], mapOf('TST', mkEnriched()), [rule]).length, 0);
}
// (f) disabled 매도 규칙 → 미수집
{
  const rule = mkRule({ id: 'sell-off', action: 'sell', enabled: false, filters: ['PROFIT_POSITIVE', 'RSI_OVERBOUGHT'] });
  const asset = mkAsset({ ticker: 'TST', metrics: { returnPercentage: 5 } });
  check('disabled 매도 미수집', collectSellRuleDataGaps([asset], mapOf('TST', mkEnriched()), [rule]).length, 0);
}
// (g) 여러 종목 — unknown 종목만 affectedAssets에
{
  const rule = mkRule({ id: 'sell-mix', action: 'sell', filters: ['PROFIT_POSITIVE', 'RSI_OVERBOUGHT'] });
  const a1 = mkAsset({ id: 'a1', ticker: 'AAA', metrics: { returnPercentage: 5 } }); // RSI null → unknown
  const a2 = mkAsset({ id: 'a2', ticker: 'BBB', metrics: { returnPercentage: 5 } }); // RSI 충족 → matched(미수집)
  const map = new Map<string, EnrichedIndicatorData>([['AAA', mkEnriched()], ['BBB', mkEnriched({ rsi: 75 })]]);
  const gaps = collectSellRuleDataGaps([a1, a2], map, [rule]);
  check('여러 종목 중 unknown만', gaps[0]?.affectedAssets.map(a => a.ticker), ['AAA']);
}

console.log(`\nalert fail-safe: ${pass} passed, ${fails.length} failed`);
if (fails.length > 0) {
  for (const f of fails) console.log(f);
  process.exitCode = 1;
} else {
  console.log('✓ 동치성(matched ⟺ matchesRule) + 매도 unknown만 수집(unmatched/matched/매수/disabled 제외) + 발화 불변(additive)');
}
