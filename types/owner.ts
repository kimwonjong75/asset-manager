// types/owner.ts
// 계정(소유자) 축 — 카테고리/버킷과 직교(orthogonal)하는 "누구의 자산인가" 축.
//   · WONJONG(원종): 사용자 본인 자산 — 리밸런싱·터틀·대청소 등 전략 의사결정 대상
//   · YUSEON(유선): 가족(와이프) 자산 — 보유 현황만 관리, 전략 대상에서 상시 제외
// 시세/환율/카테고리에는 영향이 없다. '통합' 뷰는 저장값이 아니라 화면 필터(OwnerFilter='ALL')로만 존재한다.
// 기본값은 WONJONG — 레거시(미지정) 자산은 전부 원종으로 간주한다.
// ※ 이름을 'account'로 하지 않은 이유: App.tsx의 Google 계정 메뉴(showAccountMenu)와 용어 충돌 방지.

export type OwnerId = 'WONJONG' | 'YUSEON';

export const DEFAULT_OWNER: OwnerId = 'WONJONG';

export const ALL_OWNERS: OwnerId[] = ['WONJONG', 'YUSEON'];

export const OWNER_LABELS: Record<OwnerId, string> = {
  WONJONG: '원종',
  YUSEON: '유선',
};

export const OWNER_DESCRIPTIONS: Record<OwnerId, string> = {
  WONJONG: '본인 자산 — 리밸런싱·터틀 등 전략 대상',
  YUSEON: '가족 자산 — 보유 현황만 관리, 전략 대상에서 제외',
};

/** 화면 계정 필터 — 'ALL'(통합)은 표시 전용이며 자산에 저장되지 않는다. */
export type OwnerFilter = 'ALL' | OwnerId;

export const OWNER_FILTER_OPTIONS: OwnerFilter[] = ['ALL', 'WONJONG', 'YUSEON'];

export const OWNER_FILTER_LABELS: Record<OwnerFilter, string> = {
  ALL: '통합',
  WONJONG: '원종',
  YUSEON: '유선',
};

/** 자산의 계정 (미지정 레거시 자산은 원종으로 간주) */
export function getAssetOwner(asset: { owner?: OwnerId }): OwnerId {
  return asset.owner ?? DEFAULT_OWNER;
}

/** 계정 표시명 (undefined → 원종) */
export function getOwnerLabel(owner: OwnerId | undefined): string {
  return OWNER_LABELS[owner ?? DEFAULT_OWNER];
}

/**
 * 이름/커스텀명/메모 텍스트로 계정 추론 — 마이그레이션 백필 전용.
 * '유선'이 포함되면 YUSEON, 아니면 WONJONG. 기존 owner 값이 있으면 호출부가 ??로 보존해야 한다.
 */
export function inferOwnerFromText(...texts: (string | undefined)[]): OwnerId {
  return texts.some(t => typeof t === 'string' && t.includes('유선')) ? 'YUSEON' : 'WONJONG';
}

/** 화면 계정 필터 매칭 — 'ALL'(통합)은 전부 통과 */
export function matchesOwnerFilter(asset: { owner?: OwnerId }, filter: OwnerFilter): boolean {
  return filter === 'ALL' || getAssetOwner(asset) === filter;
}

/**
 * 전략(리밸런싱·터틀·대청소) 대상 여부 — 유선 자산은 화면 필터와 무관하게 **상시 제외**.
 * (터틀 적용 여부가 사용자 본인 의사가 아닌 자산을 실행 큐/주문 생성에서 보호)
 */
export function isStrategyManaged(asset: { owner?: OwnerId }): boolean {
  return getAssetOwner(asset) !== 'YUSEON';
}

/** 전략 대상 자산만 추출 (isStrategyManaged 필터) */
export function filterStrategyAssets<T extends { owner?: OwnerId }>(assets: T[]): T[] {
  return assets.filter(isStrategyManaged);
}
