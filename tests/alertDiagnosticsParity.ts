// tests/alertDiagnosticsParity.ts
// ---------------------------------------------------------------------------
// 5B-① 알림 진단 회귀 테스트 — additive 보장 + 3축 정확성.
//   · 매치셋 동일성: diagnoseAlertRule(...).evaluation==='matched' === matchesRule(...)===true.
//   · dataQuality(complete/partial/missing) 직교 — climax/distribution OHLC 품질이 미충족에 숨지 않음.
//   · describeAlertRuleStatus 정밀 라벨 + evaluateAutoPopupGate(규칙 발화와 직교) + buy-only 정책.
// 수동 실행: npm run test:alertdiag (tsx). 통과 시 exit 0.

import {
  diagnoseAlertRule, diagnoseAssetAlerts, classifyFilterQuality, describeAlertRuleStatus, evaluateAutoPopupGate,
} from '../utils/alertDiagnostics';
import { matchesRule } from '../utils/alertChecker';
import type { AlertRule } from '../types/alertRules';
import type { EnrichedAsset, AssetMetrics } from '../types/ui';
import type { Indicators } from '../types/api';
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
function mkAsset(o: { priceOriginal?: number; changeRate?: number; metrics?: Partial<AssetMetrics>; indicators?: Indicators } = {}): EnrichedAsset {
  return {
    id: 'id', ticker: 'TST', name: '종목',
    priceOriginal: o.priceOriginal ?? 0, changeRate: o.changeRate,
    indicators: o.indicators, metrics: { ...BASE_METRICS, ...o.metrics },
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

// ════════════════════════════════════════════════════════════════════════════
// 1. 매치셋 동일성 — evaluation==='matched' === matchesRule()===true
// ════════════════════════════════════════════════════════════════════════════
const climaxEnriched = mkEnriched({ slopeRatio: 3, dayRangeOverAtr: 3, isBullishCandle: true, priceIsAt52wHigh: true, volumeIsAt52wMax: true, longTrendUp: true });
const parityCases: Array<{ name: string; asset: EnrichedAsset; rule: AlertRule; enriched?: EnrichedIndicatorData }> = [
  { name: 'AND 둘 충족', asset: mkAsset({ priceOriginal: 110, metrics: { returnPercentage: 5 } }), rule: mkRule({ filters: ['PRICE_ABOVE_SHORT_MA', 'PROFIT_POSITIVE'] }), enriched: mkEnriched({ ma: { 20: 100 } }) },
  { name: 'AND 하나 미충족', asset: mkAsset({ priceOriginal: 90, metrics: { returnPercentage: 5 } }), rule: mkRule({ filters: ['PRICE_ABOVE_SHORT_MA', 'PROFIT_POSITIVE'] }), enriched: mkEnriched({ ma: { 20: 100 } }) },
  { name: 'null 필터 포함(no-data)', asset: mkAsset({ metrics: { returnPercentage: 5 } }), rule: mkRule({ filters: ['PROFIT_POSITIVE', 'RSI_OVERBOUGHT'] }), enriched: mkEnriched() },
  { name: 'climax 매칭', asset: mkAsset(), rule: mkRule({ filters: ['CLIMAX_TOP'], filterConfig: { climaxFlagsRequired: 2 } }), enriched: climaxEnriched },
  { name: 'climax 미수신', asset: mkAsset(), rule: mkRule({ filters: ['CLIMAX_TOP'] }), enriched: undefined },
  { name: 'config 전달(loss=8)', asset: mkAsset({ metrics: { returnPercentage: -10 } }), rule: mkRule({ filters: ['LOSS_THRESHOLD'], filterConfig: { lossThreshold: 8 } }) },
];
let parityMiss = 0;
for (const c of parityCases) {
  const evalMatched = diagnoseAlertRule(c.asset, c.rule, c.enriched).evaluation === 'matched';
  const fired = matchesRule(c.asset, c.rule, c.enriched);
  if (evalMatched !== fired) { parityMiss++; fails.push(`✗ parity[${c.name}]: matched=${evalMatched} vs matchesRule=${fired}`); }
}
check('매치셋 동일성(matched === matchesRule)', parityMiss, 0);
// 개별 evaluation 핀
check('eval matched', diagnoseAlertRule(mkAsset({ priceOriginal: 110, metrics: { returnPercentage: 5 } }), mkRule({ filters: ['PRICE_ABOVE_SHORT_MA', 'PROFIT_POSITIVE'] }), mkEnriched({ ma: { 20: 100 } })).evaluation, 'matched');
check('eval unmatched', diagnoseAlertRule(mkAsset({ priceOriginal: 90, metrics: { returnPercentage: 5 } }), mkRule({ filters: ['PRICE_ABOVE_SHORT_MA', 'PROFIT_POSITIVE'] }), mkEnriched({ ma: { 20: 100 } })).evaluation, 'unmatched');
check('eval unknown(no false, null 있음)', diagnoseAlertRule(mkAsset({ metrics: { returnPercentage: 5 } }), mkRule({ filters: ['PROFIT_POSITIVE', 'RSI_OVERBOUGHT'] }), mkEnriched()).evaluation, 'unknown');

// ════════════════════════════════════════════════════════════════════════════
// 2. dataQuality — complete / partial(OHLC) / missing, evaluation과 직교
// ════════════════════════════════════════════════════════════════════════════
const climaxFull = mkEnriched({ slopeRatio: 3, dayRangeOverAtr: 3, ohlcvAvailable: true });
check('quality no-data=missing', classifyFilterQuality('CLIMAX_TOP', 'no-data', mkEnriched()), 'missing');
check('quality climax 완전 입력+ohlcv true=complete', classifyFilterQuality('CLIMAX_TOP', 'met', climaxFull), 'complete');
check('quality climax+ohlcv false=partial', classifyFilterQuality('CLIMAX_TOP', 'not-met', mkEnriched({ slopeRatio: 3, dayRangeOverAtr: 3, ohlcvAvailable: false })), 'partial');
check('quality 비OHLC 필터=complete(ohlcv false여도)', classifyFilterQuality('RSI_OVERBOUGHT', 'met', mkEnriched({ ohlcvAvailable: false })), 'complete');
check('quality event-not-found=complete', classifyFilterQuality('SWING_LOW_BREAK', 'event-not-found', mkEnriched()), 'complete');
// P2-1: 복합 필터 입력 가용성 — ohlcvAvailable=true여도 핵심 입력이 전부 null이면 과대평가 금지
check('quality climax 정량입력 전부 null=missing', classifyFilterQuality('CLIMAX_TOP', 'not-met', mkEnriched({ slopeRatio: null, dayRangeOverAtr: null, ohlcvAvailable: true })), 'missing');
check('quality climax 일부 입력 null=partial', classifyFilterQuality('CLIMAX_TOP', 'not-met', mkEnriched({ slopeRatio: 3, dayRangeOverAtr: null, ohlcvAvailable: true })), 'partial');
check('quality distribution volRatio 전부 null=missing', classifyFilterQuality('DISTRIBUTION_HIGH', 'not-met', mkEnriched({ distributionDayMeta: [{ volRatio: null, isBearish: false, isLowerHalfClose: false, changeRatio: 0 }] })), 'missing');
check('quality distribution volRatio 일부 null=partial', classifyFilterQuality('DISTRIBUTION_HIGH', 'not-met', mkEnriched({ distributionDayMeta: [{ volRatio: 2, isBearish: true, isLowerHalfClose: false, changeRatio: -0.01 }, { volRatio: null, isBearish: false, isLowerHalfClose: false, changeRatio: 0 }] })), 'partial');
check('quality distribution volRatio 전부 있음+ohlcv true=complete', classifyFilterQuality('DISTRIBUTION_HIGH', 'met', mkEnriched({ distributionDayMeta: [{ volRatio: 2, isBearish: true, isLowerHalfClose: false, changeRatio: -0.01 }] })), 'complete');
// 규칙 레벨 dataQuality
{
  const d = diagnoseAlertRule(mkAsset(), mkRule({ filters: ['CLIMAX_TOP'], filterConfig: { climaxFlagsRequired: 2 } }), mkEnriched({ ohlcvAvailable: false, slopeRatio: 1 }));
  check('rule dataQuality partial(climax ohlcv false)', d.dataQuality, 'partial');
  // partial이 미충족에 숨지 않음: evaluation은 unmatched이지만 dataQuality는 partial로 별도 노출
  check('rule eval unmatched + quality partial 공존', [d.evaluation, d.dataQuality], ['unmatched', 'partial']);
}
{
  const d = diagnoseAlertRule(mkAsset(), mkRule({ filters: ['DISTRIBUTION_HIGH'] }), mkEnriched()); // 빈 메타 → no-data
  check('rule dataQuality missing(빈 메타)', d.dataQuality, 'missing');
  check('rule eval unknown(빈 메타)', d.evaluation, 'unknown');
}

// ════════════════════════════════════════════════════════════════════════════
// 3. describeAlertRuleStatus — 정밀 라벨 (disabled 최우선, matched 보존)
// ════════════════════════════════════════════════════════════════════════════
const statusOf = (asset: EnrichedAsset, rule: AlertRule, enriched?: EnrichedIndicatorData) =>
  describeAlertRuleStatus(diagnoseAlertRule(asset, rule, enriched)).kind;
check('status firing', statusOf(mkAsset({ metrics: { returnPercentage: 5 } }), mkRule({ filters: ['PROFIT_POSITIVE'] })), 'firing');
check('status not-met', statusOf(mkAsset({ metrics: { returnPercentage: -5 } }), mkRule({ filters: ['PROFIT_POSITIVE'] })), 'not-met');
check('status data-missing', statusOf(mkAsset(), mkRule({ filters: ['RSI_OVERBOUGHT'] }), mkEnriched()), 'data-missing');
check('status disabled(우선)', statusOf(mkAsset({ metrics: { returnPercentage: 5 } }), mkRule({ filters: ['PROFIT_POSITIVE'], enabled: false })), 'disabled');
check('status firing-partial(climax matched+ohlcv false)', statusOf(mkAsset(), mkRule({ filters: ['CLIMAX_TOP'], filterConfig: { climaxFlagsRequired: 1, climaxRequireLongTrendUp: false, climaxRequireBullishCandle: false } }), mkEnriched({ ohlcvAvailable: false, priceIsAt52wHigh: true, volumeIsAt52wMax: true })), 'firing-partial');
check('status not-met-partial(climax 미충족+ohlcv false)', statusOf(mkAsset(), mkRule({ filters: ['CLIMAX_TOP'], filterConfig: { climaxFlagsRequired: 2 } }), mkEnriched({ ohlcvAvailable: false, slopeRatio: 1 })), 'not-met-partial');

// ════════════════════════════════════════════════════════════════════════════
// 4. evaluateAutoPopupGate — useAutoAlert와 공유하는 순수 게이트 (규칙 발화와 직교, side effect 없음)
// ════════════════════════════════════════════════════════════════════════════
const gate = (o: Partial<Parameters<typeof evaluateAutoPopupGate>[0]> = {}) =>
  evaluateAutoPopupGate({ enableAutoPopup: true, hasAutoUpdated: true, isLoading: false, assetCount: 5, lastCheckedDate: '2026-06-25', today: '2026-06-26', matchedRuleCount: 2, ...o });
check('gate disabled', gate({ enableAutoPopup: false }), { willAutoShow: false, reason: 'auto-popup-disabled', matchedRuleCount: 2 });
check('gate not-ready(자산 0)', gate({ assetCount: 0 }).reason, 'not-ready');
check('gate not-ready(로딩)', gate({ isLoading: true }).reason, 'not-ready');
check('gate not-ready(자동업데이트 전)', gate({ hasAutoUpdated: false }).reason, 'not-ready');
// P1-2 핵심: 일자 키는 0건이어도 기록되므로 lastChecked===today는 "표시함"이 아니라 "확인 완료"
check('gate already-checked(0건이어도 not "표시함")', gate({ lastCheckedDate: '2026-06-26', matchedRuleCount: 0 }), { willAutoShow: false, reason: 'already-checked-today', matchedRuleCount: 0 });
check('gate no-matches(확인했고 0건)', gate({ matchedRuleCount: 0 }), { willAutoShow: false, reason: 'no-matches', matchedRuleCount: 0 });
check('gate will-show', gate({}), { willAutoShow: true, reason: 'will-show', matchedRuleCount: 2 });

// ════════════════════════════════════════════════════════════════════════════
// 5. buy-only 정책 — 관심종목 source는 매수 규칙만 진단
// ════════════════════════════════════════════════════════════════════════════
{
  const rules = [mkRule({ id: 'sell-x', action: 'sell', filters: ['PROFIT_NEGATIVE'] }), mkRule({ id: 'buy-x', action: 'buy', filters: ['PROFIT_POSITIVE'] })];
  const asset = mkAsset({ metrics: { returnPercentage: 5 } });
  check('portfolio: 전 규칙 진단', diagnoseAssetAlerts({ asset, rules, source: 'portfolio' }).map(d => d.ruleId), ['sell-x', 'buy-x']);
  check('watchlist: 매수 규칙만 진단', diagnoseAssetAlerts({ asset, rules, source: 'watchlist' }).map(d => d.ruleId), ['buy-x']);
}

console.log(`\nalert diagnostics: ${pass} passed, ${fails.length} failed`);
if (fails.length > 0) {
  for (const f of fails) console.log(f);
  process.exitCode = 1;
} else {
  console.log('✓ 매치셋 동일성 + dataQuality(복합필터 입력가용성 포함) + describeAlertRuleStatus + 자동팝업 게이트(공유·0건도 확인기록) + buy-only 고정');
}
