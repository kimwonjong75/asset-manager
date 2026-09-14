// utils/deepLink.ts
// URL 쿼리 파라미터 → 앱 내 이동 목표로 변환하는 순수 파서. 로그인 완료 후 1회만
// `App.tsx`가 호출하고, 처리 후 `history.replaceState`로 파라미터를 제거한다(P4 계획서 §4.4).
// 카카오톡 버튼 딥링크(`?tab=dashboard&asset=<id>`, 구버전 `?tab=today&asset=<id>`)와 수동 URL 공유
// 모두 이 파서를 공유한다.
//
// 2026-09-14: 사용자가 P3 결정(기본 탭 '오늘')을 번복 — 홈은 대시보드('홈' 라벨)이고 독립 '오늘' 탭은
// 폐지됐다(내용은 홈 상단 '오늘의 브리핑'으로 흡수). 그래도 'today'는 화이트리스트에 **그대로 남는다**:
// 파서는 여전히 tab 'today'를 반환하고, 실제 탭으로의 변환은 `resolveTabAlias`가
// `setActiveTab` 시점(PortfolioContext)에서 한다 — 파서는 URL을 충실히 옮기는 역할만 한다.
// `tab` 파라미터가 없어도 `asset`만 있으면 'portfolio'를 기본값으로 삼는다 —
// 카톡 링크가 아닌 손매수 URL 공유(`?asset=005930:KRX`)에서도 종목으로 바로 이동하게 하기 위함.
// `execution`/`replay`는 여전히 화이트리스트 밖(실행 큐는 UI에서 도달 불가, 리플레이는 더보기 전용).
import type { UIState } from '../types/store';

/**
 * 폐지된 탭 id → 현재 탭 id 별칭. 'today'·'execution' → 'dashboard'(홈), 나머지는 그대로.
 *
 * **이 별칭은 영구히 유지해야 한다.** 이미 발송된 카카오톡 메시지에 `?tab=today&asset=…` 링크가
 * 들어 있고, 보낸 메시지는 회수할 수 없다 — 별칭을 지우면 그 버튼들이 조용히 엉뚱한 화면으로 간다.
 * 'execution'도 옛 세션/링크 방어용이다.
 *
 * 주의: `types/tradePlan.ts`의 `PlanTier 'today'`(등급 "오늘 실행")와 `TradePlanAnchor 'today'`
 * (오늘가 기준)는 **투자 도메인 값**이며 UI 탭과 무관하다. 탭 개명에 휩쓸려 절대 이름을 바꾸지 말 것
 * (저장된 계획 데이터·GAS 스크립트가 그 문자열을 그대로 쓴다).
 */
export function resolveTabAlias(tab: UIState['activeTab']): UIState['activeTab'] {
  if (tab === 'today' || tab === 'execution') return 'dashboard';
  return tab;
}

/** 딥링크로 이동 가능한 탭 화이트리스트. */
export type DeepLinkTab = Extract<UIState['activeTab'], 'today' | 'dashboard' | 'portfolio' | 'watchlist' | 'analytics' | 'settings' | 'guide' | 'cleanup'>;

const ALLOWED_TABS: readonly DeepLinkTab[] = ['today', 'dashboard', 'portfolio', 'watchlist', 'analytics', 'settings', 'guide', 'cleanup'];

/** asset 파라미터 참조 — 자산 id 그대로거나 `ticker:exchange` 형태 */
export type DeepLinkAssetRef =
  | { kind: 'id'; id: string }
  | { kind: 'ticker'; ticker: string; exchange: string };

export interface DeepLinkTarget {
  tab: DeepLinkTab;
  assetRef: DeepLinkAssetRef | null;
}

function isAllowedTab(v: string): v is DeepLinkTab {
  return (ALLOWED_TABS as readonly string[]).includes(v);
}

/**
 * `location.search`(선행 `?` 있어도/없어도 무방)를 파싱한다.
 * `tab`도 `asset`도 없으면 null(딥링크 아님 — 무시하고 정상 진입).
 * `tab`이 없고 `asset`만 있으면 기본값 'portfolio'.
 * `tab`이 있는데 화이트리스트 밖이면(예: execution/replay) null.
 */
export function parseDeepLink(search: string): DeepLinkTarget | null {
  if (!search) return null;
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (!raw) return null;
  const params = new URLSearchParams(raw);

  const rawTab = params.get('tab');
  const rawAsset = params.get('asset');
  if (!rawTab && !rawAsset) return null;
  const mappedTab = rawTab ?? 'portfolio';
  if (!isAllowedTab(mappedTab)) return null;

  let assetRef: DeepLinkAssetRef | null = null;
  if (rawAsset) {
    const idx = rawAsset.indexOf(':');
    if (idx > 0 && idx < rawAsset.length - 1) {
      assetRef = { kind: 'ticker', ticker: rawAsset.slice(0, idx), exchange: rawAsset.slice(idx + 1) };
    } else {
      assetRef = { kind: 'id', id: rawAsset };
    }
  }

  return { tab: mappedTab, assetRef };
}
