// types/bucket.ts
// 전략 버킷 — 카테고리(자산 종류)와 직교(orthogonal)하는 투자 전략 축.
//   · CORE(코어): 자산배분 비율로 운용하는 본체
//   · SATELLITE(투더문): 개별적으로 골라 일정 비율만 담는 위성 종목
// 가격/환율/시세/거래소는 전적으로 categoryId(baseType)가 결정한다. bucket은 배분/리밸런싱 "표시·집계"에만
// 영향을 주며, 종목 종류가 섞인 위성도 categoryId는 각자 정확히 유지하므로 시세는 정상 동작한다.
// 기본값은 CORE — 레거시(미지정) 자산은 전부 코어로 간주한다.

export type BucketId = 'CORE' | 'SATELLITE';

export const DEFAULT_BUCKET: BucketId = 'CORE';

export const ALL_BUCKETS: BucketId[] = ['CORE', 'SATELLITE'];

export const BUCKET_LABELS: Record<BucketId, string> = {
  CORE: '코어',
  SATELLITE: '투더문',
};

export const BUCKET_DESCRIPTIONS: Record<BucketId, string> = {
  CORE: '자산배분 비율로 운용하는 본체',
  SATELLITE: '개별적으로 골라 일정 비율만 담는 위성 종목',
};

/** 자산의 버킷 (미지정 레거시 자산은 코어로 간주) */
export function getAssetBucket(asset: { bucket?: BucketId }): BucketId {
  return asset.bucket ?? DEFAULT_BUCKET;
}

/** 버킷 표시명 (undefined → 코어) */
export function getBucketLabel(bucket: BucketId | undefined): string {
  return BUCKET_LABELS[bucket ?? DEFAULT_BUCKET];
}
