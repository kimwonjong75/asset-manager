// tests/columnConfigParity.ts
// ---------------------------------------------------------------------------
// 포트폴리오 표 컬럼 설정 골든 (Stage D1). 명시적 절대값으로 고정(경로 A-vs-B 비교 금지).
//   ① 새 기본값: 표시 5개 = 현재가·어제대비·평가총액·수익률·최고가 대비(이 순서), 전체 11키 유지
//   ② 사용자가 저장한 11컬럼 커스텀 설정은 머지 후 **그대로**(순서·visible·width)
//   ③ 알 수 없는 키 제거 / ④ 누락 키는 기본값으로 뒤에 추가
//   ⑤ getDefaultColumnConfig 는 사본 / ⑥ isSortKeyOfColumn (수익률 컬럼 = 2개 정렬키)
// 수동 실행: npx tsx tests/columnConfigParity.ts
// ---------------------------------------------------------------------------

import type { ColumnConfig } from '../types/ui';
import {
  DEFAULT_COLUMN_CONFIG,
  DEFAULT_VISIBLE_COLUMN_KEYS,
  getDefaultColumnConfig,
  isSortKeyOfColumn,
  mergeColumnConfig,
} from '../utils/columnConfig';

let pass = 0;
const fails: string[] = [];
function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${label}\n    기대 ${e}\n    실제 ${a}`);
}

// ① 기본값
check('기본 표시 키', DEFAULT_VISIBLE_COLUMN_KEYS, ['currentPrice', 'yesterdayChange', 'currentValue', 'returnPercentage', 'dropFromHigh']);
check('기본값 전체 키 순서', DEFAULT_COLUMN_CONFIG.map(c => c.key), [
  'currentPrice', 'yesterdayChange', 'currentValue', 'returnPercentage', 'dropFromHigh',
  'maCrossDays', 'quantity', 'purchasePrice', 'purchaseValue', 'purchaseDate', 'allocation',
]);
check('기본값 숨김 6개', DEFAULT_COLUMN_CONFIG.filter(c => !c.visible).length, 6);
check('기본값 width 없음', DEFAULT_COLUMN_CONFIG.some(c => c.width !== undefined), false);

// ② 저장된 11컬럼 커스텀(옛 기본값 + 너비) — 그대로 유지
const storedCustom: ColumnConfig[] = [
  { key: 'maCrossDays', visible: true, width: 90 },
  { key: 'quantity', visible: false },
  { key: 'purchasePrice', visible: false },
  { key: 'currentPrice', visible: true, width: 140 },
  { key: 'returnPercentage', visible: true },
  { key: 'purchaseValue', visible: true, width: 120 },
  { key: 'currentValue', visible: true },
  { key: 'purchaseDate', visible: false },
  { key: 'allocation', visible: false },
  { key: 'dropFromHigh', visible: true },
  { key: 'yesterdayChange', visible: true, width: 100 },
];
const mergedCustom = mergeColumnConfig(storedCustom);
check('커스텀 11컬럼 라운드트립 동일', mergedCustom, storedCustom);
check('커스텀 표시 7개 유지', mergedCustom.filter(c => c.visible).map(c => c.key), [
  'maCrossDays', 'currentPrice', 'returnPercentage', 'purchaseValue', 'currentValue', 'dropFromHigh', 'yesterdayChange',
]);

// ③ 알 수 없는 키 제거
const withUnknown = [
  { key: 'currentPrice', visible: true },
  { key: 'legacyColumn', visible: true, width: 80 },
  ...storedCustom.filter(c => c.key !== 'currentPrice'),
] as ColumnConfig[];
const mergedUnknown = mergeColumnConfig(withUnknown);
check('알 수 없는 키 제거 후 길이', mergedUnknown.length, 11);
check('legacyColumn 없음', mergedUnknown.some(c => (c.key as string) === 'legacyColumn'), false);
check('제거 후 첫 키', mergedUnknown[0], { key: 'currentPrice', visible: true });

// ④ 누락 키 → 기본값으로 뒤에 추가 (allocation=숨김, currentValue=표시)
const partial: ColumnConfig[] = [
  { key: 'dropFromHigh', visible: false, width: 111 },
  { key: 'quantity', visible: true },
];
const mergedPartial = mergeColumnConfig(partial);
check('부분 저장본: 앞 2개 원형', mergedPartial.slice(0, 2), partial);
check('부분 저장본: 뒤 추가 순서', mergedPartial.slice(2).map(c => c.key), [
  'currentPrice', 'yesterdayChange', 'currentValue', 'returnPercentage',
  'maCrossDays', 'purchasePrice', 'purchaseValue', 'purchaseDate', 'allocation',
]);
check('누락 currentValue → visible true(기본)', mergedPartial.find(c => c.key === 'currentValue'), { key: 'currentValue', visible: true });
check('누락 allocation → visible false(기본)', mergedPartial.find(c => c.key === 'allocation'), { key: 'allocation', visible: false });
check('빈 저장본 → 기본값', mergeColumnConfig([]), DEFAULT_COLUMN_CONFIG);

// ⑤ 사본
const copy = getDefaultColumnConfig();
copy[0].visible = false;
check('getDefaultColumnConfig 사본(상수 불변)', DEFAULT_COLUMN_CONFIG[0].visible, true);

// ⑥ 정렬키 ↔ 컬럼
check('수익률 컬럼 ← returnPercentage', isSortKeyOfColumn('returnPercentage', 'returnPercentage'), true);
check('수익률 컬럼 ← profitLossKRW', isSortKeyOfColumn('profitLossKRW', 'returnPercentage'), true);
check('현재가 컬럼 ← currentPrice', isSortKeyOfColumn('currentPrice', 'currentPrice'), true);
check('현재가 컬럼 ← name 아님', isSortKeyOfColumn('name', 'currentPrice'), false);
check('정렬 없음', isSortKeyOfColumn(null, 'currentPrice'), false);

if (fails.length > 0) {
  console.error(`columnConfigParity: ${fails.length}건 실패 / ${pass}건 통과`);
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log(`columnConfigParity: ${pass}건 통과`);
