import type { AlertRule, AlertResult, AlertMatchedAsset } from '../types/alertRules';
import type { EnrichedAsset } from '../types/ui';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';
import { matchesSingleFilter } from './smartFilterLogic';

/**
 * 단일 규칙에 대해 자산 매칭 여부 판정
 * 규칙의 모든 filters를 AND로 적용 (스마트필터의 그룹 OR과 다름)
 */
const matchesRule = (
  asset: EnrichedAsset,
  rule: AlertRule,
  enriched?: EnrichedIndicatorData
): boolean => {
  const { filters, filterConfig } = rule;
  const maShort = filterConfig.maShortPeriod ?? 20;
  const maLong = filterConfig.maLongPeriod ?? 60;
  const dropThreshold = filterConfig.dropFromHighThreshold ?? 20;
  const lossThreshold = filterConfig.lossThreshold ?? 5;

  return filters.every(filterKey =>
    matchesSingleFilter(asset, filterKey, dropThreshold, maShort, maLong, enriched, lossThreshold)
  );
};

/**
 * 매칭된 자산의 상세 정보 문자열 생성
 */
const buildDetails = (
  asset: EnrichedAsset,
  rule: AlertRule,
  enriched?: EnrichedIndicatorData
): string => {
  const parts: string[] = [];
  const rsi = enriched?.rsi ?? asset.indicators?.rsi;

  if (typeof rsi === 'number') {
    parts.push(`RSI ${rsi.toFixed(1)}`);
  }

  if (typeof asset.changeRate === 'number' && asset.changeRate !== 0) {
    parts.push(`당일 ${asset.changeRate >= 0 ? '+' : ''}${asset.changeRate.toFixed(1)}%`);
  }

  if (asset.metrics.returnPercentage !== 0) {
    parts.push(`수익률 ${asset.metrics.returnPercentage >= 0 ? '+' : ''}${asset.metrics.returnPercentage.toFixed(1)}%`);
  }

  if (asset.metrics.dropFromHigh < 0) {
    parts.push(`고점대비 ${asset.metrics.dropFromHigh.toFixed(1)}%`);
  }

  // MA 관련 정보
  const maShort = rule.filterConfig.maShortPeriod;
  const maLong = rule.filterConfig.maLongPeriod;
  if (maShort && enriched?.ma[maShort] != null) {
    parts.push(`MA${maShort} ${enriched.ma[maShort]!.toLocaleString()}`);
  }
  if (maLong && enriched?.ma[maLong] != null) {
    parts.push(`MA${maLong} ${enriched.ma[maLong]!.toLocaleString()}`);
  }

  return parts.join(' · ');
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
          details: buildDetails(asset, rule, enriched),
        });
      }
    }

    if (matchedAssets.length > 0) {
      results.push({ rule, matchedAssets });
    }
  }

  return results;
};
