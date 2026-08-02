// utils/watchlistSort.ts
// ---------------------------------------------------------------------------
// 관심종목 테이블 헤더 정렬 — **순수 함수**(컴포넌트는 렌더만 담당).
//
// 정렬 규칙(포트폴리오 테이블 `usePortfolioData.requestSort`와 동일 관례):
//   · 같은 컬럼을 처음 누르면 오름차순, 한 번 더 누르면 내림차순 (2-state 토글)
//   · 다른 컬럼을 누르면 그 컬럼 오름차순부터 시작
//   · 값이 없는 행(가격 미수신·최고가 미기록)은 **방향과 무관하게 항상 맨 뒤**
//     (내림차순에서 '-'가 위로 몰려 실제 값이 밀리는 것을 방지)
//   · 값이 같으면 원래 순서 유지(안정 정렬 — 인덱스 tiebreak로 명시)
//
// 입력 배열을 변형하지 않는다(복사 후 정렬).

export type WatchlistSortKey = 'name' | 'currentPrice' | 'yesterdayChange' | 'dropFromHigh';
export type WatchlistSortDirection = 'ascending' | 'descending';

export interface WatchlistSortConfig {
  key: WatchlistSortKey;
  direction: WatchlistSortDirection;
}

/** 정렬에 필요한 최소 필드 — WatchlistPage가 파생값(dropFromHigh/yesterdayChange)을 붙인 행 형태. */
export interface WatchlistSortRow {
  name: string;
  currentPrice?: number | null;
  yesterdayChange?: number | null;
  dropFromHigh?: number | null;
}

/** 헤더 클릭 시 다음 정렬 상태 — 같은 키면 방향 토글, 다른 키면 오름차순부터. */
export function nextWatchlistSort(
  current: WatchlistSortConfig | null,
  key: WatchlistSortKey,
): WatchlistSortConfig {
  if (current && current.key === key && current.direction === 'ascending') {
    return { key, direction: 'descending' };
  }
  return { key, direction: 'ascending' };
}

/** 숫자 컬럼 값 추출 — 유한수가 아니면 null(=맨 뒤). */
function numericValue(row: WatchlistSortRow, key: WatchlistSortKey): number | null {
  const raw =
    key === 'currentPrice' ? row.currentPrice
    : key === 'yesterdayChange' ? row.yesterdayChange
    : row.dropFromHigh;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * 관심종목 행 정렬. config가 null이면 원본 순서 그대로(복사본) 반환.
 */
export function sortWatchlistRows<T extends WatchlistSortRow>(
  rows: T[],
  config: WatchlistSortConfig | null,
): T[] {
  if (!config) return [...rows];

  const { key, direction } = config;
  const dir = direction === 'ascending' ? 1 : -1;

  // 인덱스를 함께 들고 정렬해 동값 시 원래 순서를 보장(엔진 안정성에 의존하지 않음).
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      if (key === 'name') {
        const cmp = a.row.name.localeCompare(b.row.name, 'ko');
        return cmp !== 0 ? cmp * dir : a.index - b.index;
      }

      const av = numericValue(a.row, key);
      const bv = numericValue(b.row, key);

      // 값 없음은 방향 무관 항상 뒤
      if (av === null && bv === null) return a.index - b.index;
      if (av === null) return 1;
      if (bv === null) return -1;

      if (av !== bv) return (av < bv ? -1 : 1) * dir;
      return a.index - b.index;
    })
    .map(entry => entry.row);
}
