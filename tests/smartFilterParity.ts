// tests/smartFilterParity.ts
// ---------------------------------------------------------------------------
// 5B 일반알림 진단 회귀 테스트 — 두 층을 고정한다(자기참조 타우톨로지 방지: 명시적 기대 boolean 사용).
//   ① 필터 층: 32개 SmartFilterKey의 기존 boolean 동작 골든 핀(matchesSingleFilter).
//      → evaluateSingleFilter(tri-state) 도입 후 matchesSingleFilter(null→false) wrapper가
//        "발화 결과 불변"임을 이 핀이 강제한다.
//   ② 규칙 층: matchesRule(필터 AND) + checkAlertRules/checkBuyRulesForWatchlist(발화 집합).
//      → 포트폴리오 전체 규칙 / 관심종목 buy-only 정책 고정.
//
// 수동 실행: npm run test:filters  (tsx). 통과 시 exit 0, 불일치 1건이라도 exit 1.

import { matchesSingleFilter, evaluateSingleFilter } from '../utils/smartFilterLogic';
import { matchesRule, checkAlertRules, checkBuyRulesForWatchlist } from '../utils/alertChecker';
import { DEFAULT_ALERT_RULES } from '../constants/alertRules';
import { FILTER_KEY_TO_GROUP, type SmartFilterKey, type FilterEvalReason, type ExtraFilterConfig } from '../types/smartFilter';
import type { AlertRule } from '../types/alertRules';
import type { EnrichedAsset, AssetMetrics } from '../types/ui';
import type { Indicators } from '../types/api';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';
import type { WatchlistItem } from '../types';
import { Currency } from '../types';

// ── 단언기 ───────────────────────────────────────────────────────────────────
let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
const sortedKeys = (ks: string[]): string[] => [...ks].sort();

// ── fixture ──────────────────────────────────────────────────────────────────
const BASE_METRICS: AssetMetrics = {
  purchasePrice: 0, currentPrice: 0, currentPriceKRW: 0, purchasePriceKRW: 0,
  purchaseValue: 0, currentValue: 0, purchaseValueKRW: 0, currentValueKRW: 0,
  returnPercentage: 0, allocation: 0, dropFromHigh: 0, profitLoss: 0, profitLossKRW: 0,
  diffFromHigh: 0, yesterdayChange: 0, diffFromYesterday: 0,
};

function mkAsset(o: {
  id?: string; ticker?: string; name?: string;
  priceOriginal?: number; changeRate?: number;
  metrics?: Partial<AssetMetrics>; indicators?: Indicators;
} = {}): EnrichedAsset {
  return {
    id: o.id ?? 'id', ticker: o.ticker ?? 'TST', name: o.name ?? '종목',
    priceOriginal: o.priceOriginal ?? 0,
    changeRate: o.changeRate,
    indicators: o.indicators,
    metrics: { ...BASE_METRICS, ...o.metrics },
  } as unknown as EnrichedAsset;
}

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

// matchesSingleFilter 축약 (drop=20, maShort=20, maLong=60, loss=5 기본)
function M(
  key: SmartFilterKey, asset: EnrichedAsset, enriched?: EnrichedIndicatorData,
  extra?: ExtraFilterConfig,
  opts: { drop?: number; maShort?: number; maLong?: number; loss?: number } = {},
): boolean {
  return matchesSingleFilter(
    asset, key, opts.drop ?? 20, opts.maShort ?? 20, opts.maLong ?? 60, enriched, opts.loss ?? 5, extra,
  );
}
// evaluateSingleFilter 축약 (tri-state)
function E(
  key: SmartFilterKey, asset: EnrichedAsset, enriched?: EnrichedIndicatorData,
  extra?: ExtraFilterConfig,
  opts: { drop?: number; maShort?: number; maLong?: number; loss?: number } = {},
): { result: boolean | null; reason: FilterEvalReason } {
  const r = evaluateSingleFilter(
    asset, key, opts.drop ?? 20, opts.maShort ?? 20, opts.maLong ?? 60, enriched, opts.loss ?? 5, extra,
  );
  return { result: r.result, reason: r.reason };
}

// ════════════════════════════════════════════════════════════════════════════
// ① 필터 층 — 32개 키 boolean 골든 (true 케이스 + 데이터없음 false 케이스)
// ════════════════════════════════════════════════════════════════════════════

// ── MA (10) ──
check('PRICE_ABOVE_SHORT_MA true', M('PRICE_ABOVE_SHORT_MA', mkAsset({ priceOriginal: 110 }), mkEnriched({ ma: { 20: 100 } })), true);
check('PRICE_ABOVE_SHORT_MA false(below)', M('PRICE_ABOVE_SHORT_MA', mkAsset({ priceOriginal: 90 }), mkEnriched({ ma: { 20: 100 } })), false);
check('PRICE_ABOVE_SHORT_MA false(no data)', M('PRICE_ABOVE_SHORT_MA', mkAsset({ priceOriginal: 110 }), mkEnriched()), false);
check('PRICE_ABOVE_SHORT_MA fallback ind.ma20', M('PRICE_ABOVE_SHORT_MA', mkAsset({ priceOriginal: 110, indicators: { ma20: 100 } })), true);
check('PRICE_ABOVE_LONG_MA true', M('PRICE_ABOVE_LONG_MA', mkAsset({ priceOriginal: 110 }), mkEnriched({ ma: { 60: 100 } })), true);
check('PRICE_BELOW_SHORT_MA true', M('PRICE_BELOW_SHORT_MA', mkAsset({ priceOriginal: 90 }), mkEnriched({ ma: { 20: 100 } })), true);
check('PRICE_BELOW_LONG_MA true', M('PRICE_BELOW_LONG_MA', mkAsset({ priceOriginal: 90 }), mkEnriched({ ma: { 60: 100 } })), true);
check('MA_BULLISH_ALIGN true', M('MA_BULLISH_ALIGN', mkAsset(), mkEnriched({ ma: { 20: 110, 60: 100 } })), true);
check('MA_BULLISH_ALIGN false(no data)', M('MA_BULLISH_ALIGN', mkAsset(), mkEnriched()), false);
check('MA_BEARISH_ALIGN true', M('MA_BEARISH_ALIGN', mkAsset(), mkEnriched({ ma: { 20: 90, 60: 100 } })), true);
check('MA_GOLDEN_CROSS true', M('MA_GOLDEN_CROSS', mkAsset(), mkEnriched({ ma: { 20: 110, 60: 100 } })), true);
check('MA_GOLDEN_CROSS false(no enriched)', M('MA_GOLDEN_CROSS', mkAsset()), false);
check('MA_DEAD_CROSS true', M('MA_DEAD_CROSS', mkAsset(), mkEnriched({ ma: { 20: 90, 60: 100 } })), true);
check('MA_DEAD_CROSS lookback in-range', M('MA_DEAD_CROSS', mkAsset(), mkEnriched({ ma: { 20: 90, 60: 100 }, maCrossDays: { 20: { 60: -3 } } }), { maxLookbackTradingDays: 5 }), true);
check('MA_DEAD_CROSS lookback out-of-range', M('MA_DEAD_CROSS', mkAsset(), mkEnriched({ ma: { 20: 90, 60: 100 }, maCrossDays: { 20: { 60: -10 } } }), { maxLookbackTradingDays: 5 }), false);
check('PRICE_CROSS_ABOVE_MA true(today)', M('PRICE_CROSS_ABOVE_MA', mkAsset({ priceOriginal: 110 }), mkEnriched({ ma: { 60: 100 }, prevMa: { 60: 100 }, prevClose: 95 })), true);
check('PRICE_CROSS_ABOVE_MA true(withinDays)', M('PRICE_CROSS_ABOVE_MA', mkAsset({ priceOriginal: 110 }), mkEnriched({ ma: { 60: 100 }, priceCrossMaDays: { 60: 2 } }), { withinDays: 3 }), true);
check('PRICE_CROSS_ABOVE_MA false(below ma)', M('PRICE_CROSS_ABOVE_MA', mkAsset({ priceOriginal: 90 }), mkEnriched({ ma: { 60: 100 } })), false);
check('PRICE_CROSS_BELOW_MA true(today)', M('PRICE_CROSS_BELOW_MA', mkAsset({ priceOriginal: 90 }), mkEnriched({ ma: { 60: 100 }, prevMa: { 60: 100 }, prevClose: 105 })), true);

// ── RSI (4) ──
check('RSI_OVERBOUGHT true', M('RSI_OVERBOUGHT', mkAsset(), mkEnriched({ rsi: 75 })), true);
check('RSI_OVERBOUGHT false', M('RSI_OVERBOUGHT', mkAsset(), mkEnriched({ rsi: 50 })), false);
check('RSI_OVERBOUGHT fallback ind', M('RSI_OVERBOUGHT', mkAsset({ indicators: { rsi: 75 } })), true);
check('RSI_OVERSOLD true', M('RSI_OVERSOLD', mkAsset(), mkEnriched({ rsi: 25 })), true);
check('RSI_BOUNCE true', M('RSI_BOUNCE', mkAsset(), mkEnriched({ rsi: 40, prevRsi: 25 })), true);
check('RSI_BOUNCE false(no enriched)', M('RSI_BOUNCE', mkAsset()), false);
check('RSI_OVERHEAT_ENTRY true', M('RSI_OVERHEAT_ENTRY', mkAsset(), mkEnriched({ rsi: 72, prevRsi: 68 })), true);

// ── Signal (4) ──
check('SIGNAL_STRONG_BUY true', M('SIGNAL_STRONG_BUY', mkAsset({ indicators: { signal: 'STRONG_BUY' } })), true);
check('SIGNAL_BUY true', M('SIGNAL_BUY', mkAsset({ indicators: { signal: 'BUY' } })), true);
check('SIGNAL_SELL true', M('SIGNAL_SELL', mkAsset({ indicators: { signal: 'SELL' } })), true);
check('SIGNAL_STRONG_SELL true', M('SIGNAL_STRONG_SELL', mkAsset({ indicators: { signal: 'STRONG_SELL' } })), true);
check('SIGNAL_BUY false(no indicators)', M('SIGNAL_BUY', mkAsset()), false);

// ── 포트폴리오 (8) ──
check('PROFIT_POSITIVE true', M('PROFIT_POSITIVE', mkAsset({ metrics: { returnPercentage: 5 } })), true);
check('PROFIT_NEGATIVE true', M('PROFIT_NEGATIVE', mkAsset({ metrics: { returnPercentage: -5 } })), true);
check('DROP_FROM_HIGH true', M('DROP_FROM_HIGH', mkAsset({ metrics: { dropFromHigh: -25 } })), true);
check('DROP_FROM_HIGH false', M('DROP_FROM_HIGH', mkAsset({ metrics: { dropFromHigh: -10 } })), false);
check('DAILY_DROP true', M('DAILY_DROP', mkAsset({ changeRate: -2 })), true);
check('DAILY_DROP false(positive)', M('DAILY_DROP', mkAsset({ changeRate: 2 })), false);
check('DAILY_DROP false(no changeRate)', M('DAILY_DROP', mkAsset()), false); // null→false (발화 불변)
check('PROFIT_TARGET true', M('PROFIT_TARGET', mkAsset({ metrics: { returnPercentage: 25 } }), undefined, { profitTargetThreshold: 20 }), true);
check('DAILY_SURGE true', M('DAILY_SURGE', mkAsset({ metrics: { yesterdayChange: 6 } }), undefined, { dailySurgeThreshold: 5 }), true);
check('DAILY_CRASH true', M('DAILY_CRASH', mkAsset({ metrics: { yesterdayChange: -6 } }), undefined, { dailyCrashThreshold: 5 }), true);
check('LOSS_THRESHOLD true', M('LOSS_THRESHOLD', mkAsset({ metrics: { returnPercentage: -6 } }), undefined, undefined, { loss: 5 }), true);

// ── 거래량 (3) ──
check('VOLUME_SURGE true', M('VOLUME_SURGE', mkAsset({ indicators: { volume_ratio: 2.5 } })), true);
check('VOLUME_HIGH true', M('VOLUME_HIGH', mkAsset({ indicators: { volume_ratio: 1.6 } })), true);
check('VOLUME_LOW true', M('VOLUME_LOW', mkAsset({ indicators: { volume_ratio: 0.3 } })), true);
check('VOLUME_SURGE false(no data)', M('VOLUME_SURGE', mkAsset()), false);

// ── signal 그룹 추가 3 (climax/swing/distribution) ──
const climaxEnriched = mkEnriched({
  slopeRatio: 3, dayRangeOverAtr: 3, isBullishCandle: true,
  priceIsAt52wHigh: true, volumeIsAt52wMax: true, longTrendUp: true,
});
check('CLIMAX_TOP true(3 flags)', M('CLIMAX_TOP', mkAsset(), climaxEnriched), true);
check('CLIMAX_TOP false(no enriched)', M('CLIMAX_TOP', mkAsset()), false);
check('SWING_LOW_BREAK true', M('SWING_LOW_BREAK', mkAsset({ priceOriginal: 90 }), mkEnriched({ recentSwingLow: 95 })), true);
check('SWING_LOW_BREAK false(no swing)', M('SWING_LOW_BREAK', mkAsset({ priceOriginal: 90 }), mkEnriched()), false);
const distEnriched = mkEnriched({
  distributionDayMeta: Array.from({ length: 5 }, () => ({ volRatio: 2, isBearish: true, isLowerHalfClose: false, changeRatio: -0.01 })),
});
check('DISTRIBUTION_HIGH true(5 days)', M('DISTRIBUTION_HIGH', mkAsset(), distEnriched), true);
check('DISTRIBUTION_HIGH false(no enriched)', M('DISTRIBUTION_HIGH', mkAsset()), false);

// ════════════════════════════════════════════════════════════════════════════
// ② evaluateSingleFilter — tri-state + reason. matchesSingleFilter와 발화 동일성(null→false).
// ════════════════════════════════════════════════════════════════════════════
const ALL_KEYS: SmartFilterKey[] = [
  'PRICE_ABOVE_SHORT_MA', 'PRICE_ABOVE_LONG_MA', 'PRICE_BELOW_SHORT_MA', 'PRICE_BELOW_LONG_MA',
  'MA_BULLISH_ALIGN', 'MA_BEARISH_ALIGN', 'MA_GOLDEN_CROSS', 'MA_DEAD_CROSS',
  'PRICE_CROSS_ABOVE_MA', 'PRICE_CROSS_BELOW_MA',
  'RSI_OVERBOUGHT', 'RSI_OVERSOLD', 'RSI_BOUNCE', 'RSI_OVERHEAT_ENTRY',
  'SIGNAL_STRONG_BUY', 'SIGNAL_BUY', 'SIGNAL_SELL', 'SIGNAL_STRONG_SELL',
  'PROFIT_POSITIVE', 'PROFIT_NEGATIVE', 'DROP_FROM_HIGH', 'DAILY_DROP', 'PROFIT_TARGET',
  'DAILY_SURGE', 'DAILY_CRASH', 'LOSS_THRESHOLD',
  'VOLUME_SURGE', 'VOLUME_HIGH', 'VOLUME_LOW',
  'CLIMAX_TOP', 'SWING_LOW_BREAK', 'DISTRIBUTION_HIGH',
];
check('32개 키 전부 정의됨', ALL_KEYS.length, 32);
// 집합 동일성 — ALL_KEYS === FILTER_KEY_TO_GROUP 키 (향후 키 추가 시 테스트 누락을 잡음)
check('ALL_KEYS === FILTER_KEY_TO_GROUP 키 집합', sortedKeys(ALL_KEYS), sortedKeys(Object.keys(FILTER_KEY_TO_GROUP)));

// 발화 동일성: 여러 (key, asset, enriched) 조합에서 matchesSingleFilter === (evaluateSingleFilter.result === true)
const parityCases: Array<{ key: SmartFilterKey; asset: EnrichedAsset; enriched?: EnrichedIndicatorData; extra?: ExtraFilterConfig }> = [
  { key: 'PRICE_ABOVE_SHORT_MA', asset: mkAsset({ priceOriginal: 110 }), enriched: mkEnriched({ ma: { 20: 100 } }) },
  { key: 'PRICE_ABOVE_SHORT_MA', asset: mkAsset({ priceOriginal: 110 }), enriched: mkEnriched() }, // no data
  { key: 'RSI_OVERBOUGHT', asset: mkAsset(), enriched: mkEnriched({ rsi: 75 }) },
  { key: 'RSI_OVERBOUGHT', asset: mkAsset(), enriched: mkEnriched() }, // no data
  { key: 'RSI_BOUNCE', asset: mkAsset(), enriched: mkEnriched({ rsi: 40, prevRsi: 25 }) },
  { key: 'RSI_BOUNCE', asset: mkAsset() }, // no enriched
  { key: 'SIGNAL_BUY', asset: mkAsset({ indicators: { signal: 'BUY' } }) },
  { key: 'SIGNAL_BUY', asset: mkAsset() }, // no indicators
  { key: 'DAILY_DROP', asset: mkAsset({ changeRate: -2 }) },
  { key: 'DAILY_DROP', asset: mkAsset() }, // undefined changeRate
  { key: 'CLIMAX_TOP', asset: mkAsset(), enriched: climaxEnriched },
  { key: 'CLIMAX_TOP', asset: mkAsset() }, // no enriched
  { key: 'DISTRIBUTION_HIGH', asset: mkAsset(), enriched: distEnriched },
  { key: 'MA_DEAD_CROSS', asset: mkAsset(), enriched: mkEnriched({ ma: { 20: 90, 60: 100 }, maCrossDays: { 20: { 60: -10 } } }), extra: { maxLookbackTradingDays: 5 } },
];
let parityMismatch = 0;
for (const c of parityCases) {
  const m = M(c.key, c.asset, c.enriched, c.extra);
  const e = E(c.key, c.asset, c.enriched, c.extra);
  if (m !== (e.result === true)) parityMismatch++;
}
check('evaluateSingleFilter→matchesSingleFilter 발화 동일성', parityMismatch, 0);

// reason code: 데이터 없음은 null + 'no-data' 계열, 평가됨은 met/not-met
check('reason: no-data(MA 없음)=null', E('PRICE_ABOVE_SHORT_MA', mkAsset({ priceOriginal: 110 }), mkEnriched()).result, null);
check('reason: 충족=true/met', E('RSI_OVERBOUGHT', mkAsset(), mkEnriched({ rsi: 75 })), { result: true, reason: 'met' });
check('reason: 미충족=false/not-met', E('RSI_OVERBOUGHT', mkAsset(), mkEnriched({ rsi: 50 })), { result: false, reason: 'not-met' });
check('reason: no-data=null/no-data', E('RSI_BOUNCE', mkAsset()), { result: null, reason: 'no-data' });

// no-data(판정 불가) vs event-not-found(지표 있으나 이벤트/구조 미발생) 구분 — "왜 안 떴나"의 원인 분리
check('reason: DAILY_DROP changeRate 없음=no-data', E('DAILY_DROP', mkAsset()), { result: null, reason: 'no-data' });
check('reason: RSI_BOUNCE 반등이벤트 없음=event-not-found',
  E('RSI_BOUNCE', mkAsset(), mkEnriched({ rsi: 40 }), { withinDays: 3 }), { result: false, reason: 'event-not-found' });
check('reason: RSI_OVERHEAT_ENTRY 진입이벤트 없음=event-not-found',
  E('RSI_OVERHEAT_ENTRY', mkAsset(), mkEnriched({ rsi: 72 }), { withinDays: 3 }), { result: false, reason: 'event-not-found' });
check('reason: PRICE_CROSS_BELOW_MA 이탈이벤트 없음=event-not-found',
  E('PRICE_CROSS_BELOW_MA', mkAsset({ priceOriginal: 90 }), mkEnriched({ ma: { 60: 100 } }), { withinDays: 5 }), { result: false, reason: 'event-not-found' });
check('reason: SWING_LOW_BREAK 저점 미형성=event-not-found',
  E('SWING_LOW_BREAK', mkAsset({ priceOriginal: 90 }), mkEnriched()), { result: false, reason: 'event-not-found' });
check('reason: MA_DEAD_CROSS 최근 교차 없음=event-not-found',
  E('MA_DEAD_CROSS', mkAsset(), mkEnriched({ ma: { 20: 90, 60: 100 }, maCrossDays: { 20: { 60: -300 } } }), { maxLookbackTradingDays: 252 }), { result: false, reason: 'event-not-found' });
check('reason: DISTRIBUTION_HIGH 빈 메타=no-data',
  E('DISTRIBUTION_HIGH', mkAsset(), mkEnriched()), { result: null, reason: 'no-data' });
// 발화 불변 재확인: event-not-found·no-data 모두 matchesSingleFilter=false
check('event-not-found→matches false', M('SWING_LOW_BREAK', mkAsset({ priceOriginal: 90 }), mkEnriched()), false);
check('no-data→matches false', M('DAILY_DROP', mkAsset()), false);

// ════════════════════════════════════════════════════════════════════════════
// ③ 규칙 층 — matchesRule(AND) + 발화 집합 parity (포트폴리오 전체 / 관심종목 buy-only)
// ════════════════════════════════════════════════════════════════════════════
function mkRule(o: Partial<AlertRule>): AlertRule {
  return {
    id: 'r', name: 'rule', description: '', severity: 'info', action: 'sell',
    enabled: true, filters: [], filterConfig: {}, ...o,
  };
}

// AND: 모든 필터 충족해야 매칭
{
  const asset = mkAsset({ priceOriginal: 110, metrics: { returnPercentage: 5 } });
  const enr = mkEnriched({ ma: { 20: 100 } });
  const ruleBoth = mkRule({ filters: ['PRICE_ABOVE_SHORT_MA', 'PROFIT_POSITIVE'] });
  check('rule AND: 둘 다 충족=true', matchesRule(asset, ruleBoth, enr), true);
  const ruleMixed = mkRule({ filters: ['PRICE_ABOVE_SHORT_MA', 'PROFIT_NEGATIVE'] });
  check('rule AND: 하나 미충족=false', matchesRule(asset, ruleMixed, enr), false);
  // null(데이터 없음) 필터는 false로 흡수 → AND 깨짐(발화 불변)
  const ruleNull = mkRule({ filters: ['PROFIT_POSITIVE', 'RSI_OVERBOUGHT'] });
  check('rule AND: null 필터는 false 흡수', matchesRule(asset, ruleNull, mkEnriched()), false);
}

// filterConfig 전달: maShortPeriod/lossThreshold 등이 matchesSingleFilter로 전달되는지
{
  const asset = mkAsset({ priceOriginal: 110, metrics: { returnPercentage: -10 } });
  const enr = mkEnriched({ ma: { 5: 100 } });
  const rule = mkRule({ filters: ['PRICE_ABOVE_SHORT_MA', 'LOSS_THRESHOLD'], filterConfig: { maShortPeriod: 5, lossThreshold: 8 } });
  check('rule filterConfig 전달(maShort=5, loss=8)', matchesRule(asset, rule, enr), true);
}

// checkAlertRules: enabled만, 매칭 결과 있는 규칙만 반환
{
  const assets = [
    mkAsset({ id: 'a1', ticker: 'AAA', name: 'A', metrics: { returnPercentage: 5 } }),   // profit+
    mkAsset({ id: 'a2', ticker: 'BBB', name: 'B', metrics: { returnPercentage: -5 } }),  // profit-
  ];
  const rules = [
    mkRule({ id: 'profit-pos', filters: ['PROFIT_POSITIVE'], enabled: true }),
    mkRule({ id: 'disabled', filters: ['PROFIT_NEGATIVE'], enabled: false }),
  ];
  const results = checkAlertRules(assets, new Map(), rules);
  check('checkAlertRules: enabled 규칙만', results.map(r => r.rule.id), ['profit-pos']);
  check('checkAlertRules: 매칭 자산 1개', results[0].matchedAssets.map(a => a.assetId), ['a1']);
}

// 관심종목 buy-only 정책: buy 규칙만, 포트폴리오 ticker 제외
{
  const watch: WatchlistItem[] = [
    { id: 'w1', categoryId: 1, ticker: 'WWW', exchange: 'NASDAQ', name: 'W', currency: Currency.USD, currentPrice: 100, priceOriginal: 100, indicators: { signal: 'BUY' } } as unknown as WatchlistItem,
    { id: 'w2', categoryId: 1, ticker: 'DUP', exchange: 'NASDAQ', name: 'D', currency: Currency.USD, currentPrice: 100, priceOriginal: 100, indicators: { signal: 'BUY' } } as unknown as WatchlistItem,
  ];
  const rules = [
    mkRule({ id: 'buy-sig', action: 'buy', filters: ['SIGNAL_BUY'], enabled: true }),
    mkRule({ id: 'sell-sig', action: 'sell', filters: ['SIGNAL_BUY'], enabled: true }), // buy-only라 제외돼야
  ];
  const results = checkBuyRulesForWatchlist(watch, new Map(), rules, new Set(['DUP']));
  check('watchlist: buy 규칙만 실행', results.map(r => r.rule.id), ['buy-sig']);
  check('watchlist: 포트폴리오 ticker(DUP) 제외', results[0].matchedAssets.map(a => a.ticker), ['WWW']);
  check('watchlist: source=watchlist 태깅', results[0].matchedAssets[0].source, 'watchlist');
}

// ════════════════════════════════════════════════════════════════════════════
// ④ DEFAULT_ALERT_RULES — 기본 21규칙 발화 집합 + filterConfig→ExtraFilterConfig 전달 경로 고정
// ════════════════════════════════════════════════════════════════════════════
check('기본 규칙 총 21개', DEFAULT_ALERT_RULES.length, 21);
check('매도 14개', DEFAULT_ALERT_RULES.filter(r => r.action === 'sell').length, 14);
check('매수 7개', DEFAULT_ALERT_RULES.filter(r => r.action === 'buy').length, 7);
check('활성 19개', DEFAULT_ALERT_RULES.filter(r => r.enabled).length, 19);
check('비활성 2개 id', sortedKeys(DEFAULT_ALERT_RULES.filter(r => !r.enabled).map(r => r.id)), sortedKeys(['strong-sell-signal', 'bullish-entry']));

// 규칙별 "발화 fixture" — 각 규칙을 충족시키는 (asset, enriched). 각 fixture가 규칙의 filterConfig가
// matchesRule→ExtraFilterConfig로 전달돼야만 발화하도록 설계됨(예: dead-cross=maShort5/maLong20/lookback252,
// weinstein=maCrossPeriod150, climax=5개 설정, distribution=3개 설정).
const FIRE: Record<string, { asset: EnrichedAsset; enriched?: EnrichedIndicatorData }> = {
  'stop-loss': { asset: mkAsset({ metrics: { returnPercentage: -10 } }) },
  'overheat-drop': { asset: mkAsset({ changeRate: -2 }), enriched: mkEnriched({ rsi: 75 }) },
  'dead-cross': { asset: mkAsset(), enriched: mkEnriched({ ma: { 5: 95, 20: 100 }, maCrossDays: { 5: { 20: -10 } } }) },
  'trend-break': { asset: mkAsset({ priceOriginal: 90, metrics: { returnPercentage: -5 } }), enriched: mkEnriched({ ma: { 20: 100 } }) },
  'long-decline': { asset: mkAsset({ metrics: { dropFromHigh: -25 } }), enriched: mkEnriched({ ma: { 20: 90, 60: 100 } }) },
  'profit-target': { asset: mkAsset({ metrics: { returnPercentage: 25 } }) },
  'overheat-profit': { asset: mkAsset({ metrics: { returnPercentage: 20 } }), enriched: mkEnriched({ rsi: 72, rsiOverheatEntryDay: 2 }) },
  'daily-crash': { asset: mkAsset({ metrics: { yesterdayChange: -6 } }) },
  'strong-sell-signal': { asset: mkAsset({ indicators: { signal: 'STRONG_SELL', volume_ratio: 1.6 } }) },
  'climax-top': { asset: mkAsset(), enriched: climaxEnriched },
  'distribution-high': { asset: mkAsset(), enriched: distEnriched },
  'weinstein-150-break': { asset: mkAsset({ priceOriginal: 90 }), enriched: mkEnriched({ ma: { 150: 100 }, priceBreakBelowMaDays: { 150: 3 } }) },
  'ma120-break': { asset: mkAsset({ priceOriginal: 90 }), enriched: mkEnriched({ ma: { 120: 100 }, priceBreakBelowMaDays: { 120: 2 } }) },
  'swing-low-break': { asset: mkAsset({ priceOriginal: 90 }), enriched: mkEnriched({ recentSwingLow: 95 }) },
  'pullback': { asset: mkAsset({ priceOriginal: 110 }), enriched: mkEnriched({ ma: { 60: 100 }, rsi: 25 }) },
  'golden-cross': { asset: mkAsset(), enriched: mkEnriched({ ma: { 5: 110, 20: 100 } }) },
  'bottom-bounce': { asset: mkAsset(), enriched: mkEnriched({ rsi: 40, rsiBounceDay: 2 }) },
  'volume-confirmed-buy': { asset: mkAsset({ indicators: { signal: 'STRONG_BUY', volume_ratio: 2.5 } }) },
  'crash-bounce': { asset: mkAsset({ indicators: { volume_ratio: 1.6 } }), enriched: mkEnriched({ rsi: 40, rsiBounceDay: 2 }) },
  'trend-reversal-buy': { asset: mkAsset({ priceOriginal: 110 }), enriched: mkEnriched({ ma: { 120: 100 }, priceCrossMaDays: { 120: 2 } }) },
  'bullish-entry': { asset: mkAsset({ indicators: { signal: 'BUY' } }), enriched: mkEnriched({ ma: { 20: 110, 60: 100 } }) },
};
const neutralAsset = mkAsset();
const neutralEnr = mkEnriched();
let fireMiss = 0, neutralMiss = 0;
for (const rule of DEFAULT_ALERT_RULES) {
  const f = FIRE[rule.id];
  if (!f) { fails.push(`✗ default-rule: fixture 없음 — ${rule.id}`); continue; }
  if (matchesRule(f.asset, rule, f.enriched) !== true) { fireMiss++; fails.push(`✗ default-rule: 발화 실패 — ${rule.id}`); }
  if (matchesRule(neutralAsset, rule, neutralEnr) !== false) { neutralMiss++; fails.push(`✗ default-rule: 중립 입력 오발화 — ${rule.id}`); }
}
check('모든 기본 규칙에 발화 fixture 존재', DEFAULT_ALERT_RULES.every(r => !!FIRE[r.id]), true);
check('기본 규칙 21개 전부 의도대로 발화(true)', fireMiss, 0);
check('기본 규칙 21개 전부 중립 입력엔 미발화(false)', neutralMiss, 0);

// 설정 전달 경계 — filterConfig 값이 결과를 바꾸는 경계로 ExtraFilterConfig 전달을 명시 검증
{
  const deadRule = DEFAULT_ALERT_RULES.find(r => r.id === 'dead-cross')!;
  check('config: dead-cross lookback(252) 초과 미발화',
    matchesRule(mkAsset(), deadRule, mkEnriched({ ma: { 5: 95, 20: 100 }, maCrossDays: { 5: { 20: -300 } } })), false);

  const climaxRule = DEFAULT_ALERT_RULES.find(r => r.id === 'climax-top')!;
  check('config: climax requireLongTrendUp=true → longTrendUp=false 미발화',
    matchesRule(mkAsset(), climaxRule, mkEnriched({
      slopeRatio: 3, dayRangeOverAtr: 3, isBullishCandle: true,
      priceIsAt52wHigh: true, volumeIsAt52wMax: true, longTrendUp: false,
    })), false);

  const weinRule = DEFAULT_ALERT_RULES.find(r => r.id === 'weinstein-150-break')!;
  // maCrossPeriod=150 미전달이면 period=maLong(60)이라 ma[150]만으론 평가 불가 → 발화=전달 증명
  check('config: weinstein maCrossPeriod=150 전달(발화)',
    matchesRule(mkAsset({ priceOriginal: 90 }), weinRule, mkEnriched({ ma: { 150: 100 }, priceBreakBelowMaDays: { 150: 3 } })), true);

  const distRule = DEFAULT_ALERT_RULES.find(r => r.id === 'distribution-high')!;
  check('config: distribution threshold=5 → 4일 미발화',
    matchesRule(mkAsset(), distRule, mkEnriched({
      distributionDayMeta: Array.from({ length: 4 }, () => ({ volRatio: 2, isBearish: true, isLowerHalfClose: false, changeRatio: -0.01 })),
    })), false);

  const bounceRule = DEFAULT_ALERT_RULES.find(r => r.id === 'bottom-bounce')!;
  // withinDays=3 전달 → bounceDay=4면 미발화(이벤트 범위 밖)
  check('config: bottom-bounce withinDays=3 → bounceDay=4 미발화',
    matchesRule(mkAsset(), bounceRule, mkEnriched({ rsi: 40, rsiBounceDay: 4 })), false);
}

// ── 결과 ─────────────────────────────────────────────────────────────────────
console.log(`\nsmart filter parity: ${pass} passed, ${fails.length} failed`);
if (fails.length > 0) {
  for (const f of fails) console.log(f);
  process.exitCode = 1;
} else {
  console.log('✓ 32키 골든 + tri-state(no-data/event-not-found 구분) + 발화 동일성 + 기본 21규칙 발화집합·설정전달·buy-only 고정');
}
