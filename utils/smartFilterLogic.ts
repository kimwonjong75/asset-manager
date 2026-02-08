import type { SmartFilterState, SmartFilterKey, SmartFilterGroup } from '../types/smartFilter';
import { FILTER_KEY_TO_GROUP } from '../types/smartFilter';
import type { EnrichedAsset } from '../types/ui';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';

/**
 * 단일 필터 키에 대해 자산이 조건을 충족하는지 판정
 */
const matchesSingleFilter = (
  asset: EnrichedAsset,
  key: SmartFilterKey,
  dropFromHighThreshold: number,
  maShortPeriod: number,
  maLongPeriod: number,
  enriched?: EnrichedIndicatorData
): boolean => {
  const ind = asset.indicators;
  const m = asset.metrics;

  switch (key) {
    // ── MA: enriched 데이터 우선, 없으면 기존 indicators 폴백 ──
    case 'PRICE_ABOVE_SHORT_MA': {
      const maVal = enriched?.ma[maShortPeriod];
      if (typeof maVal === 'number') return asset.priceOriginal > maVal;
      // 폴백: 기존 indicators (maShortPeriod === 20일 때만)
      if (maShortPeriod === 20 && typeof ind?.ma20 === 'number') return asset.priceOriginal > ind.ma20;
      if (maShortPeriod === 60 && typeof ind?.ma60 === 'number') return asset.priceOriginal > ind.ma60;
      return false;
    }
    case 'PRICE_ABOVE_LONG_MA': {
      const maVal = enriched?.ma[maLongPeriod];
      if (typeof maVal === 'number') return asset.priceOriginal > maVal;
      if (maLongPeriod === 20 && typeof ind?.ma20 === 'number') return asset.priceOriginal > ind.ma20;
      if (maLongPeriod === 60 && typeof ind?.ma60 === 'number') return asset.priceOriginal > ind.ma60;
      return false;
    }
    case 'MA_BULLISH_ALIGN': {
      const shortMa = enriched?.ma[maShortPeriod];
      const longMa = enriched?.ma[maLongPeriod];
      if (typeof shortMa === 'number' && typeof longMa === 'number') return shortMa > longMa;
      // 폴백: 기존 ma20 > ma60 (기본값일 때)
      if (maShortPeriod === 20 && maLongPeriod === 60 &&
          typeof ind?.ma20 === 'number' && typeof ind?.ma60 === 'number') {
        return ind.ma20 > ind.ma60;
      }
      return false;
    }
    case 'MA_BEARISH_ALIGN': {
      const shortMa = enriched?.ma[maShortPeriod];
      const longMa = enriched?.ma[maLongPeriod];
      if (typeof shortMa === 'number' && typeof longMa === 'number') return shortMa < longMa;
      if (maShortPeriod === 20 && maLongPeriod === 60 &&
          typeof ind?.ma20 === 'number' && typeof ind?.ma60 === 'number') {
        return ind.ma20 < ind.ma60;
      }
      return false;
    }

    // ── 골든크로스/데드크로스: enriched 필수 ──
    case 'MA_GOLDEN_CROSS': {
      if (!enriched) return false;
      const todayShort = enriched.ma[maShortPeriod];
      const todayLong = enriched.ma[maLongPeriod];
      const prevShort = enriched.prevMa[maShortPeriod];
      const prevLong = enriched.prevMa[maLongPeriod];
      if (typeof todayShort !== 'number' || typeof todayLong !== 'number' ||
          typeof prevShort !== 'number' || typeof prevLong !== 'number') return false;
      return prevShort <= prevLong && todayShort > todayLong;
    }
    case 'MA_DEAD_CROSS': {
      if (!enriched) return false;
      const todayShort = enriched.ma[maShortPeriod];
      const todayLong = enriched.ma[maLongPeriod];
      const prevShort = enriched.prevMa[maShortPeriod];
      const prevLong = enriched.prevMa[maLongPeriod];
      if (typeof todayShort !== 'number' || typeof todayLong !== 'number' ||
          typeof prevShort !== 'number' || typeof prevLong !== 'number') return false;
      return prevShort >= prevLong && todayShort < todayLong;
    }

    // ── RSI: 기존 + enriched 전환감지 ──
    case 'RSI_OVERBOUGHT':
      // enriched 우선, 폴백 indicators
      if (typeof enriched?.rsi === 'number') return enriched.rsi >= 70;
      return typeof ind?.rsi === 'number' && ind.rsi >= 70;
    case 'RSI_OVERSOLD':
      if (typeof enriched?.rsi === 'number') return enriched.rsi <= 30;
      return typeof ind?.rsi === 'number' && ind.rsi <= 30;
    case 'RSI_BOUNCE': {
      if (!enriched) return false;
      const { rsi, prevRsi } = enriched;
      if (typeof rsi !== 'number' || typeof prevRsi !== 'number') return false;
      return prevRsi <= 30 && rsi > 30;
    }
    case 'RSI_OVERHEAT_ENTRY': {
      if (!enriched) return false;
      const { rsi, prevRsi } = enriched;
      if (typeof rsi !== 'number' || typeof prevRsi !== 'number') return false;
      return prevRsi < 70 && rsi >= 70;
    }

    // ── Signal ──
    case 'SIGNAL_STRONG_BUY':
      return ind?.signal === 'STRONG_BUY';
    case 'SIGNAL_BUY':
      return ind?.signal === 'BUY';
    case 'SIGNAL_SELL':
      return ind?.signal === 'SELL';
    case 'SIGNAL_STRONG_SELL':
      return ind?.signal === 'STRONG_SELL';

    // ── 포트폴리오 지표 ──
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
  filter: SmartFilterState,
  enrichedMap?: Map<string, EnrichedIndicatorData>
): boolean => {
  const { activeFilters, dropFromHighThreshold, maShortPeriod, maLongPeriod } = filter;
  if (activeFilters.size === 0) return true;

  const enriched = enrichedMap?.get(asset.ticker);

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
      matchesSingleFilter(asset, key, dropFromHighThreshold, maShortPeriod, maLongPeriod, enriched)
    );
    if (!groupPassed) return false;
  }

  return true;
};
