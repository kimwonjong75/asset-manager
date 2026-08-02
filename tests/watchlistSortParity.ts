// tests/watchlistSortParity.ts
// ---------------------------------------------------------------------------
// 관심종목 헤더 정렬(utils/watchlistSort) 회귀 테스트 — 순수 함수만 검증(React/DOM 없음).
//
// 고정 대상:
//   · 토글 관례: 같은 컬럼 재클릭 시 오름→내림, 다른 컬럼은 오름부터 (PortfolioTable과 동일)
//   · 값 없음(가격 미수신/최고가 미기록)은 **방향과 무관하게 항상 맨 뒤**
//   · 동값은 원래 순서 유지(안정 정렬) · 입력 배열 불변
//
// 수동 실행: npm run test:watchsort. 통과 시 exit 0.

import {
  nextWatchlistSort,
  sortWatchlistRows,
  type WatchlistSortConfig,
  type WatchlistSortRow,
} from '../utils/watchlistSort';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

interface Row extends WatchlistSortRow { id: string }

// 픽스처 — 값 없음(현재가 미수신 D / 최고가 미기록 C)을 섞어 둔다.
const ROWS: Row[] = [
  { id: 'A', name: '삼성전자', currentPrice: 70_000, yesterdayChange: 1.5, dropFromHigh: -10 },
  { id: 'B', name: '애플', currentPrice: 250_000, yesterdayChange: -2.0, dropFromHigh: -3.5 },
  { id: 'C', name: '가온칩스', currentPrice: 15_000, yesterdayChange: 0, dropFromHigh: null },
  { id: 'D', name: '테슬라', currentPrice: undefined, yesterdayChange: 1.5, dropFromHigh: -40 },
];
const ids = (rows: Row[]) => rows.map(r => r.id);

// ════════════════════════════════════════════════════════════════════════════
// 1. 토글 관례
// ════════════════════════════════════════════════════════════════════════════
{
  check('최초 클릭 → 오름차순', nextWatchlistSort(null, 'currentPrice'), { key: 'currentPrice', direction: 'ascending' });
  check('같은 컬럼 재클릭 → 내림차순',
    nextWatchlistSort({ key: 'currentPrice', direction: 'ascending' }, 'currentPrice'),
    { key: 'currentPrice', direction: 'descending' });
  check('내림차순에서 재클릭 → 오름차순(2-state 순환)',
    nextWatchlistSort({ key: 'currentPrice', direction: 'descending' }, 'currentPrice'),
    { key: 'currentPrice', direction: 'ascending' });
  check('다른 컬럼 클릭 → 그 컬럼 오름차순',
    nextWatchlistSort({ key: 'currentPrice', direction: 'descending' }, 'name'),
    { key: 'name', direction: 'ascending' });
}

// ════════════════════════════════════════════════════════════════════════════
// 2. config가 null이면 원본 순서 유지(복사본)
// ════════════════════════════════════════════════════════════════════════════
{
  const out = sortWatchlistRows(ROWS, null);
  check('null config → 원본 순서', ids(out), ['A', 'B', 'C', 'D']);
  check('null config → 원본 배열과 다른 참조', out === ROWS, false);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 종목명 — 한글 로케일 정렬
// ════════════════════════════════════════════════════════════════════════════
{
  const asc = sortWatchlistRows(ROWS, { key: 'name', direction: 'ascending' });
  check('이름 오름차순', ids(asc), ['C', 'A', 'B', 'D']); // 가온칩스 < 삼성전자 < 애플 < 테슬라
  const desc = sortWatchlistRows(ROWS, { key: 'name', direction: 'descending' });
  check('이름 내림차순', ids(desc), ['D', 'B', 'A', 'C']);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 현재가 — 값 없음(D)은 방향 무관 맨 뒤
// ════════════════════════════════════════════════════════════════════════════
{
  const asc = sortWatchlistRows(ROWS, { key: 'currentPrice', direction: 'ascending' });
  check('현재가 오름차순 (15,000 < 70,000 < 250,000, 미수신 뒤)', ids(asc), ['C', 'A', 'B', 'D']);
  const desc = sortWatchlistRows(ROWS, { key: 'currentPrice', direction: 'descending' });
  check('현재가 내림차순 (미수신 여전히 뒤)', ids(desc), ['B', 'A', 'C', 'D']);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 최고가대비 — null(C)은 방향 무관 맨 뒤
// ════════════════════════════════════════════════════════════════════════════
{
  const asc = sortWatchlistRows(ROWS, { key: 'dropFromHigh', direction: 'ascending' });
  check('최고가대비 오름차순 (-40 < -10 < -3.5, null 뒤)', ids(asc), ['D', 'A', 'B', 'C']);
  const desc = sortWatchlistRows(ROWS, { key: 'dropFromHigh', direction: 'descending' });
  check('최고가대비 내림차순 (null 여전히 뒤)', ids(desc), ['B', 'A', 'D', 'C']);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 어제대비 — 동값(A·D 둘 다 1.5)은 원래 순서 유지(안정 정렬)
// ════════════════════════════════════════════════════════════════════════════
{
  const asc = sortWatchlistRows(ROWS, { key: 'yesterdayChange', direction: 'ascending' });
  check('어제대비 오름차순 (-2 < 0 < 1.5, 동값 A→D)', ids(asc), ['B', 'C', 'A', 'D']);
  const desc = sortWatchlistRows(ROWS, { key: 'yesterdayChange', direction: 'descending' });
  check('어제대비 내림차순 (동값 A→D 순서 유지)', ids(desc), ['A', 'D', 'C', 'B']);
}

// ════════════════════════════════════════════════════════════════════════════
// 7. 비정상 수치(NaN/Infinity)도 '값 없음'으로 취급해 맨 뒤
// ════════════════════════════════════════════════════════════════════════════
{
  const weird: Row[] = [
    { id: 'P', name: 'P', currentPrice: NaN },
    { id: 'Q', name: 'Q', currentPrice: 100 },
    { id: 'R', name: 'R', currentPrice: Infinity },
    { id: 'S', name: 'S', currentPrice: 50 },
  ];
  check('NaN/Infinity는 뒤로 (오름)', ids(sortWatchlistRows(weird, { key: 'currentPrice', direction: 'ascending' })), ['S', 'Q', 'P', 'R']);
  check('NaN/Infinity는 뒤로 (내림)', ids(sortWatchlistRows(weird, { key: 'currentPrice', direction: 'descending' })), ['Q', 'S', 'P', 'R']);
}

// ════════════════════════════════════════════════════════════════════════════
// 8. 입력 배열 불변 + 빈 배열
// ════════════════════════════════════════════════════════════════════════════
{
  const snapshot = JSON.stringify(ROWS);
  const configs: WatchlistSortConfig[] = [
    { key: 'name', direction: 'descending' },
    { key: 'currentPrice', direction: 'ascending' },
    { key: 'dropFromHigh', direction: 'descending' },
    { key: 'yesterdayChange', direction: 'ascending' },
  ];
  configs.forEach(c => sortWatchlistRows(ROWS, c));
  check('입력 배열 불변', JSON.stringify(ROWS), snapshot);
  check('빈 배열 안전', sortWatchlistRows([] as Row[], { key: 'name', direction: 'ascending' }), []);
  check('1개 배열 안전', ids(sortWatchlistRows([ROWS[0]], { key: 'currentPrice', direction: 'descending' })), ['A']);
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ watchlistSort parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ watchlistSort parity 전체 통과 (${pass} 단언)`);
