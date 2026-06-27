// utils/bucketRebalancing.ts
// 2단(2-tier) 리밸런싱 순수 계산.
//   ① 버킷 tier: 코어 vs 투더문 (전체 자산 기준)
//   ② 코어 카테고리 tier: 코어 버킷 내부에서만 카테고리별 (코어 합계 기준)
// 시세/환율은 categoryId가 결정하므로 여기서는 평가액 환산만 한다. side effect 없음 — useRebalancing이 래핑.

import { Asset, Currency, ExchangeRates } from '../types';
import { BucketId, getAssetBucket } from '../types/bucket';

/** 자산 1개의 원화 평가액 (KRW는 1, 외화는 환율 적용. 환율 미존재 시 0) */
export function assetValueKRW(asset: Asset, rates: ExchangeRates): number {
  const rate = asset.currency === Currency.KRW ? 1 : (rates[asset.currency as keyof ExchangeRates] || 0);
  return asset.currentPrice * asset.quantity * rate;
}

export interface BucketBreakdown {
  CORE: number;
  SATELLITE: number;
  total: number;
}

/** 버킷별 원화 평가액 합산 */
export function sumByBucket(assets: Asset[], rates: ExchangeRates): BucketBreakdown {
  const out: BucketBreakdown = { CORE: 0, SATELLITE: 0, total: 0 };
  assets.forEach(a => {
    const v = assetValueKRW(a, rates);
    out[getAssetBucket(a)] += v;
    out.total += v;
  });
  return out;
}

/** 특정 버킷에 속한 자산만 categoryId(string)별로 합산 */
export function sumCategoryValuesForBucket(
  assets: Asset[],
  rates: ExchangeRates,
  bucket: BucketId,
): Record<string, number> {
  const out: Record<string, number> = {};
  assets.forEach(a => {
    if (getAssetBucket(a) !== bucket) return;
    const v = assetValueKRW(a, rates);
    out[a.categoryId] = (out[a.categoryId] || 0) + v;
  });
  return out;
}

export interface RebalanceRow {
  key: string;          // 버킷 tier: 'CORE'|'SATELLITE' / 카테고리 tier: categoryId 문자열
  label: string;        // 표시명
  currentValue: number; // 현재 평가액 (KRW)
  currentWeight: number;// 현재 비중 (% of denominatorValue)
  targetWeight: number; // 목표 비중 (%)
  targetValue: number;  // 목표 평가액 (KRW)
  difference: number;   // targetValue - currentValue (+ 매수 / - 매도)
}

/**
 * 범용 리밸런싱 행 생성 — 버킷 tier / 코어 카테고리 tier 양쪽에서 재사용.
 *   currentWeight = currentValue / denominatorValue * 100
 *   targetValue   = targetTotalAmount * targetWeight / 100
 *   difference    = targetValue - currentValue
 * denominatorValue가 0이면 currentWeight=0 (0 나눗셈 방지).
 */
export function buildRebalanceRows(params: {
  keys: string[];
  valuesByKey: Record<string, number>;
  targetWeights: Record<string, number>;
  denominatorValue: number;
  targetTotalAmount: number;
  labelOf: (key: string) => string;
}): RebalanceRow[] {
  const { keys, valuesByKey, targetWeights, denominatorValue, targetTotalAmount, labelOf } = params;
  return keys.map(key => {
    const currentValue = valuesByKey[key] || 0;
    const currentWeight = denominatorValue > 0 ? (currentValue / denominatorValue) * 100 : 0;
    const targetWeight = targetWeights[key] || 0;
    const targetValue = (targetTotalAmount * targetWeight) / 100;
    return {
      key,
      label: labelOf(key),
      currentValue,
      currentWeight,
      targetWeight,
      targetValue,
      difference: targetValue - currentValue,
    };
  });
}

/** 합계 헬퍼 (목표비중 합/목표금액 합/편차 합) */
export function sumRows(rows: RebalanceRow[]): {
  totalTargetWeight: number;
  totalTargetValue: number;
  totalDifference: number;
} {
  return rows.reduce(
    (acc, r) => ({
      totalTargetWeight: acc.totalTargetWeight + r.targetWeight,
      totalTargetValue: acc.totalTargetValue + r.targetValue,
      totalDifference: acc.totalDifference + r.difference,
    }),
    { totalTargetWeight: 0, totalTargetValue: 0, totalDifference: 0 },
  );
}
