// utils/deepLink.ts
// URL 쿼리 파라미터 → 앱 내 이동 목표로 변환하는 순수 파서. 로그인 완료 후 1회만
// `App.tsx`가 호출하고, 처리 후 `history.replaceState`로 파라미터를 제거한다(P4 계획서 §4.4).
// 카카오톡 버튼 딥링크(`?tab=today&asset=<id>`)와 수동 URL 공유 모두 이 파서를 공유한다.
//
// P3: 'today'는 이제 실제 탭(기본 탭)이라 화이트리스트에 그대로 들어간다(더는 'dashboard' 자리표시자
// 매핑이 아니다). `tab` 파라미터가 없어도 `asset`만 있으면 'portfolio'를 기본값으로 삼는다 —
// 카톡 링크가 아닌 손매수 URL 공유(`?asset=005930:KRX`)에서도 종목으로 바로 이동하게 하기 위함.
// `execution`/`replay`는 여전히 화이트리스트 밖(실행 큐는 UI에서 도달 불가, 리플레이는 더보기 전용).
import type { UIState } from '../types/store';

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
