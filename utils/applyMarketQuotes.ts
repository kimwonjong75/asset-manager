import type { WatchlistItem } from '../types';

/** 요청 중에도 보유자별 거래·분할·수정은 계속된다. 같은 ID와 시세 조회 조건이 유지된 최신 행만 갱신한다. */
export function applyMarketQuotes<T extends Pick<WatchlistItem, 'id' | 'ticker' | 'exchange' | 'currency' | 'categoryId'>>(
  latest: readonly T[],
  requested: readonly T[],
  update: (row: T) => T,
): T[] {
  const targets = new Map(requested.map(row => [row.id, row]));
  return latest.map(row => {
    const original = targets.get(row.id);
    if (!original || original.ticker !== row.ticker || original.exchange !== row.exchange ||
        original.currency !== row.currency || original.categoryId !== row.categoryId) return row;
    return update(row);
  });
}
