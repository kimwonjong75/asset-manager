import type { SmartFilterState, SmartFilterKey, SmartFilterGroup } from '../types/smartFilter';
import { FILTER_KEY_TO_GROUP } from '../types/smartFilter';
import type { EnrichedAsset } from '../types/ui';

/**
 * 단일 필터 키에 대해 자산이 조건을 충족하는지 판정
 */
const matchesSingleFilter = (
  asset: EnrichedAsset,
  key: SmartFilterKey,
  dropFromHighThreshold: number
): boolean => {
  const ind = asset.indicators;
  const m = asset.metrics;

  switch (key) {
    // MA: priceOriginal과 비교 (동일 통화 보장)
    case 'PRICE_ABOVE_MA20':
      return typeof ind?.ma20 === 'number' && asset.priceOriginal > ind.ma20;
    case 'PRICE_ABOVE_MA60':
      return typeof ind?.ma60 === 'number' && asset.priceOriginal > ind.ma60;
    case 'MA_BULLISH_ALIGN':
      return typeof ind?.ma20 === 'number' && typeof ind?.ma60 === 'number' && ind.ma20 > ind.ma60;
    case 'MA_BEARISH_ALIGN':
      return typeof ind?.ma20 === 'number' && typeof ind?.ma60 === 'number' && ind.ma20 < ind.ma60;

    // RSI
    case 'RSI_OVERBOUGHT':
      return typeof ind?.rsi === 'number' && ind.rsi >= 70;
    case 'RSI_OVERSOLD':
      return typeof ind?.rsi === 'number' && ind.rsi <= 30;

    // Signal
    case 'SIGNAL_STRONG_BUY':
      return ind?.signal === 'STRONG_BUY';
    case 'SIGNAL_BUY':
      return ind?.signal === 'BUY';
    case 'SIGNAL_SELL':
      return ind?.signal === 'SELL';
    case 'SIGNAL_STRONG_SELL':
      return ind?.signal === 'STRONG_SELL';

    // 포트폴리오 지표
    case 'PROFIT_POSITIVE':
      return m.returnPercentage > 0;
    case 'PROFIT_NEGATIVE':
      return m.returnPercentage < 0;
    case 'DROP_FROM_HIGH':
      return m.dropFromHigh <= -dropFromHighThreshold;

    default:
      return false;
  }
};

/**
 * 스마트 필터 매칭 판정
 * - 그룹 내: OR (하나라도 충족하면 통과)
 * - 그룹 간: AND (모든 활성 그룹을 통과해야 최종 통과)
 */
export const matchesSmartFilter = (
  asset: EnrichedAsset,
  filter: SmartFilterState
): boolean => {
  const { activeFilters, dropFromHighThreshold } = filter;
  if (activeFilters.size === 0) return true;

  // 활성 필터를 그룹별로 분류
  const groupedFilters = new Map<SmartFilterGroup, SmartFilterKey[]>();
  for (const key of activeFilters) {
    const group = FILTER_KEY_TO_GROUP[key];
    const existing = groupedFilters.get(group);
    if (existing) {
      existing.push(key);
    } else {
      groupedFilters.set(group, [key]);
    }
  }

  // 각 그룹별 OR, 그룹 간 AND
  for (const [, keys] of groupedFilters) {
    const groupPassed = keys.some(key =>
      matchesSingleFilter(asset, key, dropFromHighThreshold)
    );
    if (!groupPassed) return false;
  }

  return true;
};
