// constants/tabMeta.ts
// 앱 셸(App.tsx 앱바)이 탭별로 무엇을 보여줄지 선언하는 단일 표 (Stage B, 2026-09-15).
// 이전에는 `ui.activeTab !== 'dashboard' && !== 'today' && …` 연쇄 조건과 별도 `MORE_MENU_TABS` 배열로
// 흩어져 있었다 — 탭을 추가/변경할 때는 **이 표 한 곳만** 고친다. 표시 전용(데이터·계산 무관).

import type { UIState } from '../types/store';
import { resolveTabAlias } from '../utils/deepLink';

/** 실제 화면이 있는 탭 — 'today'/'execution'은 별칭 입력값이라(resolveTabAlias → 'dashboard') 제외 */
export type AppTab = Exclude<UIState['activeTab'], 'today' | 'execution'>;

export interface TabMeta {
  /** 화면 이름 (모바일 상단바 제목 등) */
  title: string;
  /** 모바일(<md) 상단바 좌측에 화면 제목을 표시할지 — 홈은 표시하지 않는다 */
  mobileTitle: boolean;
  /** 앱바에 계정 뷰 세그먼트(통합/원종/유선)를 표시할지 (데스크탑 전용) — 홈은 본문 상단 자체 세그먼트 */
  showAccountView: boolean;
  /** 앱바에 PeriodSelector(dropdown)를 표시할지 (데스크탑 전용) — 홈은 '손익 추이' 카드에 내장 */
  showPeriod: boolean;
  /** 더보기 메뉴로 진입하는 화면인지 — '더보기' 버튼 활성 강조 판정에 쓴다 */
  inMoreMenu: boolean;
}

export const TAB_META: Record<AppTab, TabMeta> = {
  dashboard: { title: '홈', mobileTitle: false, showAccountView: false, showPeriod: false, inMoreMenu: false },
  portfolio: { title: '보유자산', mobileTitle: true, showAccountView: true, showPeriod: true, inMoreMenu: false },
  // 관심종목 인라인 차트(AssetTrendChart)가 globalPeriod를 쓰므로 기간 선택 유지
  watchlist: { title: '관심종목', mobileTitle: true, showAccountView: false, showPeriod: true, inMoreMenu: false },
  analytics: { title: '수익 통계', mobileTitle: true, showAccountView: false, showPeriod: false, inMoreMenu: true },
  // P3(터틀 재정비, 2026-09-26): 'cleanup' 탭 화면은 TurtleCleanupView로 교체됐다(App.tsx) — 라벨도 맞춘다.
  cleanup: { title: '터틀 정리', mobileTitle: true, showAccountView: false, showPeriod: false, inMoreMenu: true },
  guide: { title: '투자 가이드', mobileTitle: true, showAccountView: false, showPeriod: false, inMoreMenu: true },
  replay: { title: '연구실', mobileTitle: true, showAccountView: false, showPeriod: false, inMoreMenu: true },
  settings: { title: '설정', mobileTitle: true, showAccountView: false, showPeriod: false, inMoreMenu: true },
};

/** 별칭('today'/'execution')까지 받아 실제 탭의 메타를 돌려준다. */
export function getTabMeta(tab: UIState['activeTab']): TabMeta {
  return TAB_META[resolveTabAlias(tab) as AppTab];
}

/** 더보기 메뉴 진입 화면 목록 — TAB_META에서 파생 */
export const MORE_MENU_TABS: readonly AppTab[] = (Object.keys(TAB_META) as AppTab[]).filter(t => TAB_META[t].inMoreMenu);
