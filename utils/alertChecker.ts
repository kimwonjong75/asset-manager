import type { AlertRule, AlertResult, AlertMatchedAsset, AlertDataGap, AlertDataGapAsset } from '../types/alertRules';
import type { EnrichedAsset } from '../types/ui';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';
import type { WatchlistItem } from '../types';
import { Currency } from '../types';
import { matchesSingleFilter, evaluateSingleFilter } from './smartFilterLogic';
import type { ExtraFilterConfig } from '../types/smartFilter';

/**
 * 단일 규칙에 대해 자산 매칭 여부 판정
 * 규칙의 모든 filters를 AND로 적용 (스마트필터의 그룹 OR과 다름)
 */
/** AlertRuleFilterConfig → ExtraFilterConfig 매핑 (단일 소스). matchesRule·alertDiagnostics 공용 — drift 차단. */
export const buildExtraConfig = (filterConfig: AlertRule['filterConfig']): ExtraFilterConfig => ({
  profitTargetThreshold: filterConfig.profitTargetThreshold,
  dailySurgeThreshold: filterConfig.dailySurgeThreshold,
  dailyCrashThreshold: filterConfig.dailyCrashThreshold,
  maCrossPeriod: filterConfig.maCrossPeriod,
  withinDays: filterConfig.withinDays,
  maxLookbackTradingDays: filterConfig.maxLookbackTradingDays,
  climaxFlagsRequired: filterConfig.climaxFlagsRequired,
  climaxSlopeMultiplier: filterConfig.climaxSlopeMultiplier,
  climaxAtrMultiple: filterConfig.climaxAtrMultiple,
  climaxRequireBullishCandle: filterConfig.climaxRequireBullishCandle,
  climaxRequireLongTrendUp: filterConfig.climaxRequireLongTrendUp,
  distributionWindow: filterConfig.distributionWindow,
  distributionVolumeRatio: filterConfig.distributionVolumeRatio,
  distributionThreshold: filterConfig.distributionThreshold,
});

/** 규칙 기본 임계값(maShort/maLong/drop/loss) 추출 — alertDiagnostics와 공용. */
export const ruleThresholds = (filterConfig: AlertRule['filterConfig']) => ({
  maShort: filterConfig.maShortPeriod ?? 20,
  maLong: filterConfig.maLongPeriod ?? 60,
  dropThreshold: filterConfig.dropFromHighThreshold ?? 20,
  lossThreshold: filterConfig.lossThreshold ?? 5,
});

export const matchesRule = (
  asset: EnrichedAsset,
  rule: AlertRule,
  enriched?: EnrichedIndicatorData
): boolean => {
  const { maShort, maLong, dropThreshold, lossThreshold } = ruleThresholds(rule.filterConfig);
  const extraConfig = buildExtraConfig(rule.filterConfig);

  return rule.filters.every(filterKey =>
    matchesSingleFilter(asset, filterKey, dropThreshold, maShort, maLong, enriched, lossThreshold, extraConfig)
  );
};

/**
 * 규칙 3치 평가 — filters AND. 하나라도 false → 'unmatched' / null 없이 전부 true → 'matched' /
 * false 없고 null 있음 → 'unknown'(데이터 누락으로 판정 불가). 빈 filters는 'matched'.
 * **evaluateRule(...)==='matched'  ⟺  matchesRule(...)===true** (firing 불변, alertFailSafeParity가 강제).
 * matchesRule을 대체하지 않는다 — fail-safe 진단(collectSellRuleDataGaps)이 not-met과 데이터 누락을 구분하기 위한 additive 레이어.
 */
export type RuleEvaluation = 'matched' | 'unmatched' | 'unknown';
export const evaluateRule = (
  asset: EnrichedAsset,
  rule: AlertRule,
  enriched?: EnrichedIndicatorData
): RuleEvaluation => {
  const { maShort, maLong, dropThreshold, lossThreshold } = ruleThresholds(rule.filterConfig);
  const extraConfig = buildExtraConfig(rule.filterConfig);
  let hasNull = false;
  for (const filterKey of rule.filters) {
    const r = evaluateSingleFilter(asset, filterKey, dropThreshold, maShort, maLong, enriched, lossThreshold, extraConfig).result;
    if (r === false) return 'unmatched';
    if (r === null) hasNull = true;
  }
  return hasNull ? 'unknown' : 'matched';
};

/**
 * 매칭된 자산의 상세 정보 (구조화 + 문자열)
 */
const buildAssetInfo = (
  asset: EnrichedAsset,
  rule: AlertRule,
  enriched?: EnrichedIndicatorData
): Omit<AlertMatchedAsset, 'assetId' | 'assetName' | 'ticker'> => {
  const rsi = enriched?.rsi ?? asset.indicators?.rsi;
  const dailyChange = asset.metrics.yesterdayChange;
  const returnPct = asset.metrics.returnPercentage;
  const dropFromHigh = asset.metrics.dropFromHigh;

  // 기존 details 문자열도 유지 (하위호환)
  const parts: string[] = [];
  if (typeof rsi === 'number') parts.push(`RSI ${rsi.toFixed(1)}`);
  if (dailyChange !== 0) parts.push(`당일 ${dailyChange >= 0 ? '+' : ''}${dailyChange.toFixed(1)}%`);
  if (returnPct !== 0) parts.push(`수익률 ${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(1)}%`);
  if (dropFromHigh < 0) parts.push(`고점대비 ${dropFromHigh.toFixed(1)}%`);

  const maShort = rule.filterConfig.maShortPeriod;
  const maLong = rule.filterConfig.maLongPeriod;
  const maCross = rule.filterConfig.maCrossPeriod;
  if (maShort && enriched?.ma[maShort] != null) parts.push(`MA${maShort} ${enriched.ma[maShort]!.toLocaleString()}`);
  if (maLong && enriched?.ma[maLong] != null) parts.push(`MA${maLong} ${enriched.ma[maLong]!.toLocaleString()}`);
  if (maCross && enriched?.ma[maCross] != null) parts.push(`MA${maCross} ${enriched.ma[maCross]!.toLocaleString()}`);

  // MA 교차 경과일
  if (maShort && maLong) {
    const crossDays = enriched?.maCrossDays?.[maShort]?.[maLong];
    if (typeof crossDays === 'number') {
      const days = Math.abs(crossDays);
      const label = crossDays < 0 ? 'DC' : 'GC';
      parts.push(`${label} ${days === 0 ? '오늘' : `${days}일전`}`);
    }
  }

  // 가격 vs MA 상향돌파 경과일
  if (maCross && enriched?.priceCrossMaDays) {
    const crossDay = enriched.priceCrossMaDays[maCross];
    if (typeof crossDay === 'number') {
      parts.push(`돌파 ${crossDay === 0 ? '오늘' : `${crossDay}일전`}`);
    }
  }

  // RSI 이벤트 경과일
  if (rule.filters.includes('RSI_BOUNCE') && enriched?.rsiBounceDay != null) {
    parts.push(`반등 ${enriched.rsiBounceDay === 0 ? '오늘' : `${enriched.rsiBounceDay}일전`}`);
  }
  if (rule.filters.includes('RSI_OVERHEAT_ENTRY') && enriched?.rsiOverheatEntryDay != null) {
    parts.push(`과열진입 ${enriched.rsiOverheatEntryDay === 0 ? '오늘' : `${enriched.rsiOverheatEntryDay}일전`}`);
  }

  return {
    details: parts.join(' · '),
    dailyChange: dailyChange || undefined,
    returnPct: returnPct || undefined,
    dropFromHigh: dropFromHigh < 0 ? dropFromHigh : undefined,
    rsi: typeof rsi === 'number' ? rsi : undefined,
  };
};

/**
 * 전체 알림 규칙을 자산 목록에 대해 실행
 * @returns 매칭 결과가 있는 규칙만 반환
 */
export const checkAlertRules = (
  assets: EnrichedAsset[],
  enrichedMap: Map<string, EnrichedIndicatorData>,
  rules: AlertRule[]
): AlertResult[] => {
  const results: AlertResult[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;

    const matchedAssets: AlertMatchedAsset[] = [];

    for (const asset of assets) {
      const enriched = enrichedMap.get(asset.ticker);
      if (matchesRule(asset, rule, enriched)) {
        matchedAssets.push({
          assetId: asset.id,
          assetName: asset.name,
          ticker: asset.ticker,
          ...buildAssetInfo(asset, rule, enriched),
        });
      }
    }

    if (matchedAssets.length > 0) {
      results.push({ rule, matchedAssets });
    }
  }

  return results;
};

/**
 * fail-safe(매도 data-gap): 매도(action==='sell') 규칙이 **데이터 누락으로만 판정 불가**(evaluateRule==='unknown')인
 * 종목을 수집한다. matchesRule===false 그대로지만(checkAlertRules 발화 불변), "진짜 미충족(not-met)"과 달리
 * 갭·거래정지 등으로 매도 가드를 **평가하지 못한 침묵**을 호출부가 '데이터 불완전 — 수동 확인' 주의로 노출하게 한다.
 * 매수 규칙은 fail-open 유지(부실 데이터 매수 진입 방지) — 매도만 fail-safe.
 * 순수 함수(additive) — checkAlertRules/matchesRule 동작을 바꾸지 않는다.
 */
export const collectSellRuleDataGaps = (
  assets: EnrichedAsset[],
  enrichedMap: Map<string, EnrichedIndicatorData>,
  rules: AlertRule[]
): AlertDataGap[] => {
  const gaps: AlertDataGap[] = [];

  for (const rule of rules) {
    if (!rule.enabled || rule.action !== 'sell') continue;
    const { maShort, maLong, dropThreshold, lossThreshold } = ruleThresholds(rule.filterConfig);
    const extraConfig = buildExtraConfig(rule.filterConfig);

    const affectedAssets: AlertDataGapAsset[] = [];
    for (const asset of assets) {
      const enriched = enrichedMap.get(asset.ticker);
      if (evaluateRule(asset, rule, enriched) !== 'unknown') continue;
      const missingFilters = rule.filters.filter(filterKey =>
        evaluateSingleFilter(asset, filterKey, dropThreshold, maShort, maLong, enriched, lossThreshold, extraConfig).result === null
      );
      affectedAssets.push({ assetId: asset.id, assetName: asset.name, ticker: asset.ticker, missingFilters });
    }

    if (affectedAssets.length > 0) gaps.push({ rule, affectedAssets });
  }

  return gaps;
};

/**
 * 관심종목을 pseudo-EnrichedAsset으로 변환 (매수 규칙 체크용). 진단 패널도 관심종목 buy 규칙 진단에 재사용.
 */
export const watchlistToPseudoAsset = (w: WatchlistItem): EnrichedAsset => ({
  id: w.id,
  categoryId: w.categoryId,
  ticker: w.ticker,
  exchange: w.exchange,
  name: w.name,
  quantity: 0,
  purchasePrice: 0,
  purchaseDate: '',
  currency: w.currency || Currency.KRW,
  currentPrice: w.currentPrice || 0,
  priceOriginal: w.priceOriginal || w.currentPrice || 0,
  highestPrice: w.highestPrice || 0,
  changeRate: w.changeRate,
  indicators: w.indicators,
  metrics: {
    purchasePrice: 0,
    currentPrice: w.currentPrice || 0,
    currentPriceKRW: w.currentPrice || 0,
    purchasePriceKRW: 0,
    purchaseValue: 0,
    currentValue: 0,
    purchaseValueKRW: 0,
    currentValueKRW: 0,
    returnPercentage: 0,
    allocation: 0,
    dropFromHigh: 0,
    profitLoss: 0,
    profitLossKRW: 0,
    diffFromHigh: 0,
    yesterdayChange: w.yesterdayChange || 0,
    diffFromYesterday: 0,
  },
});

/**
 * 관심종목에 대해 매수 규칙만 실행
 * @param portfolioTickers 포트폴리오에 이미 있는 ticker (중복 방지)
 */
export const checkBuyRulesForWatchlist = (
  watchlistItems: WatchlistItem[],
  enrichedMap: Map<string, EnrichedIndicatorData>,
  rules: AlertRule[],
  portfolioTickers: Set<string>
): AlertResult[] => {
  const buyRules = rules.filter(r => r.action === 'buy' && r.enabled);
  const results: AlertResult[] = [];

  for (const rule of buyRules) {
    const matchedAssets: AlertMatchedAsset[] = [];

    for (const item of watchlistItems) {
      if (portfolioTickers.has(item.ticker)) continue;

      const enriched = enrichedMap.get(item.ticker);
      const pseudoAsset = watchlistToPseudoAsset(item);

      if (matchesRule(pseudoAsset, rule, enriched)) {
        const rsi = enriched?.rsi ?? item.indicators?.rsi;
        const dailyChange = item.yesterdayChange || 0;
        const parts: string[] = [];
        if (typeof rsi === 'number') parts.push(`RSI ${rsi.toFixed(1)}`);
        if (dailyChange !== 0) parts.push(`당일 ${dailyChange >= 0 ? '+' : ''}${dailyChange.toFixed(1)}%`);

        matchedAssets.push({
          assetId: item.id,
          assetName: item.name,
          ticker: item.ticker,
          details: parts.join(' · '),
          dailyChange: dailyChange || undefined,
          rsi: typeof rsi === 'number' ? rsi : undefined,
          source: 'watchlist',
        });
      }
    }

    if (matchedAssets.length > 0) {
      results.push({ rule, matchedAssets });
    }
  }

  return results;
};
