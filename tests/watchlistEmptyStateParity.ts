// tests/watchlistEmptyStateParity.ts
// ---------------------------------------------------------------------------
// 관심종목 빈 목록 원인 판정(utils/watchlistEmptyState) 골든 — 원인·문구·행동을 절대값으로 고정.
//   순서: noItems > search > category > pinnedOnly. 표시 행이 있으면 null.
// 수동 실행: npx tsx tests/watchlistEmptyStateParity.ts. 통과 시 exit 0.

import { getWatchlistEmptyState, type WatchlistEmptyStateInput } from '../utils/watchlistEmptyState';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

const base: WatchlistEmptyStateInput = { totalCount: 5, visibleCount: 0, search: '', categoryName: null, pinnedOnly: false };

check('표시 행 있음 → null', getWatchlistEmptyState({ ...base, visibleCount: 2, search: 'abc', pinnedOnly: true }), null);

check('관심종목 0개', getWatchlistEmptyState({ ...base, totalCount: 0 }), {
  cause: 'noItems',
  message: '아직 관심 종목이 없습니다. 종목 추가로 지켜볼 종목을 등록해 보세요.',
  actions: ['addItem'],
});
check('관심종목 0개면 필터가 켜져 있어도 noItems',
  getWatchlistEmptyState({ ...base, totalCount: 0, search: 'x', categoryName: '해외주식', pinnedOnly: true })?.cause, 'noItems');

check('검색', getWatchlistEmptyState({ ...base, search: '  삼성 ' }), {
  cause: 'search',
  message: "'삼성' 검색 결과가 없습니다.",
  actions: ['clearFilters'],
});
check('검색+카테고리+중요 → search 우선',
  getWatchlistEmptyState({ ...base, search: 'a', categoryName: '해외주식', pinnedOnly: true })?.cause, 'search');

check('카테고리', getWatchlistEmptyState({ ...base, categoryName: '해외주식' }), {
  cause: 'category',
  message: "'해외주식' 카테고리에 관심 종목이 없습니다.",
  actions: ['clearFilters'],
});
check('카테고리+중요 → category 우선',
  getWatchlistEmptyState({ ...base, categoryName: '국내주식', pinnedOnly: true })?.cause, 'category');

check('중요 종목만', getWatchlistEmptyState({ ...base, pinnedOnly: true }), {
  cause: 'pinnedOnly',
  message: '중요 표시한 종목이 없습니다. 별표를 눌러 중요 종목을 지정할 수 있습니다.',
  actions: ['clearFilters'],
});

check('항목 있음·필터 없음·0행(불가 상태) → null', getWatchlistEmptyState(base), null);

if (fails.length) {
  console.error(`\n❌ watchlistEmptyState parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ watchlistEmptyState parity 전체 통과 (${pass} 단언)`);
