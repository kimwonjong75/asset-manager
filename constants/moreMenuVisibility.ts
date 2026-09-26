// constants/moreMenuVisibility.ts
// ---------------------------------------------------------------------------
// 단일 상수 — "더보기" 메뉴에서 숨길 항목 id 목록(계획서 PLAN_터틀중심_앱재정비_260925 §4.6·§6 P3).
//
// 코드는 삭제하지 않는다(types/satelliteTurtleVisibility.ts와 동일 패턴) — 탭·모달·액션은 그대로 두고
// App.tsx의 moreMenuItems 배열에서 이 id에 해당하는 항목만 필터링해 뺀다. 되돌리려면 이 배열에서
// 항목을 빼면 된다(딥링크로 직접 진입하는 경로는 이 배열과 무관하게 계속 동작한다 — deepLink.ts는
// activeTab을 직접 바꿀 뿐 이 메뉴를 거치지 않는다).

export type MoreMenuItemId =
  | 'analytics'      // 수익 통계
  | 'cleanup'        // 터틀 정리(구 대청소)
  | 'tradePlanner'   // 매매 계획 세우기
  | 'assistant'      // AI 어시스턴트
  | 'guide'          // 투자 가이드
  | 'replay'         // 연구실 · 신호 리플레이
  | 'settings';      // 설정

/**
 * 숨길 항목 — 터틀 중심 재정비 이후 더보기는 "수익 통계 · 터틀 정리 · 설정"만 남긴다(§4.6).
 * 되돌리려면 이 Set에서 빼면 된다(코드는 그대로 — 탭/모달/액션 전부 보존).
 */
export const HIDDEN_MORE_MENU_ITEM_IDS: ReadonlySet<MoreMenuItemId> = new Set<MoreMenuItemId>([
  'tradePlanner', 'assistant', 'guide', 'replay',
]);

export function isMoreMenuItemHidden(id: MoreMenuItemId): boolean {
  return HIDDEN_MORE_MENU_ITEM_IDS.has(id);
}
