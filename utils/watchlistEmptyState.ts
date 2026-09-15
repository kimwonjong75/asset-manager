// utils/watchlistEmptyState.ts
// ---------------------------------------------------------------------------
// 관심종목 목록이 비었을 때 "왜 비었는지"와 할 수 있는 행동을 고르는 **순수 함수**.
// 데스크탑 표·모바일 카드 목록이 같은 결과를 렌더한다(컴포넌트는 문구·버튼 렌더만).
//
// 원인 판정 순서(여러 필터가 동시에 켜져 있으면 앞의 것이 원인으로 표시 — 해제 버튼은 필터 전부를 푼다):
//   1) noItems   — 관심종목 자체가 0개 (필터 무관)            → actions ['addItem']
//   2) search    — 검색어가 있음                              → actions ['clearFilters']
//   3) category  — 카테고리 필터가 '전체'가 아님              → actions ['clearFilters']
//   4) pinnedOnly — '중요 종목만' 보기가 켜져 있음            → actions ['clearFilters']
// 표시할 행이 1개 이상이면 null. 항목은 있는데 필터도 없는데 0행(이론상 불가)이면 null.

export type WatchlistEmptyCause = 'noItems' | 'search' | 'category' | 'pinnedOnly';
export type WatchlistEmptyAction = 'addItem' | 'clearFilters';

export interface WatchlistEmptyStateInput {
  /** 필터 적용 전 관심종목 수 */
  totalCount: number;
  /** 필터 적용 후 표시 행 수 */
  visibleCount: number;
  /** 검색어(원문 — 페이지 필터와 같은 기준으로 빈 문자열만 '검색 없음') */
  search: string;
  /** 카테고리 필터 이름 — '전체'면 null */
  categoryName: string | null;
  pinnedOnly: boolean;
}

export interface WatchlistEmptyState {
  cause: WatchlistEmptyCause;
  message: string;
  actions: WatchlistEmptyAction[];
}

export function getWatchlistEmptyState(input: WatchlistEmptyStateInput): WatchlistEmptyState | null {
  const { totalCount, visibleCount, search, categoryName, pinnedOnly } = input;
  if (visibleCount > 0) return null;

  if (totalCount <= 0) {
    return {
      cause: 'noItems',
      message: '아직 관심 종목이 없습니다. 종목 추가로 지켜볼 종목을 등록해 보세요.',
      actions: ['addItem'],
    };
  }
  if (search.length > 0) {
    return {
      cause: 'search',
      message: `'${search.trim()}' 검색 결과가 없습니다.`,
      actions: ['clearFilters'],
    };
  }
  if (categoryName !== null) {
    return {
      cause: 'category',
      message: `'${categoryName}' 카테고리에 관심 종목이 없습니다.`,
      actions: ['clearFilters'],
    };
  }
  if (pinnedOnly) {
    return {
      cause: 'pinnedOnly',
      message: '중요 표시한 종목이 없습니다. 별표를 눌러 중요 종목을 지정할 수 있습니다.',
      actions: ['clearFilters'],
    };
  }
  return null;
}
