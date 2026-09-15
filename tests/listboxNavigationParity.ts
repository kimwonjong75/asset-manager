// tests/listboxNavigationParity.ts
// ---------------------------------------------------------------------------
// 콤보박스 키보드 탐색(utils/listboxNavigation) 회귀 테스트 — 순수 함수만. Stage D2 P0.
//
// 고정 대상 (명시 골든 표):
//   · nextActiveIndex: 순환·disabled 건너뜀·선택 없음(-1)/범위 밖에서 시작·first/last·delta 0·전부 disabled/빈 목록 → -1
//   · resolveComboboxKey: ↓↑ 닫힘=open / 열림=move · Enter 는 열림+유효 활성일 때만 select(아니면 폼 제출 그대로)
//     · Esc 열림=close+preventDefault(Modal 이 무시) / 닫힘=none(Modal 이 닫힘) · Tab 열림=close(막지 않음)
//     · Home/End 는 열림 && activeIndex>=0 일 때만
//
// 수동 실행: npx tsx tests/listboxNavigationParity.ts. 통과 시 exit 0.

import { nextActiveIndex, resolveComboboxKey, type ComboboxKeyIntent, type ListboxMove } from '../utils/listboxNavigation';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

const D0 = [false, false, false, false]; // 전부 활성
const D1 = [true, false, true, false]; // 1, 3 만 활성
const ONE = [true, false, true]; // 1 만 활성
const ALL_OFF = [true, true];
const EMPTY: boolean[] = [];

// [current, move, disabled, expected, 설명]
const NAV_TABLE: Array<[number, ListboxMove, boolean[], number, string]> = [
  [-1, 1, D0, 0, '선택 없음 ↓ → 첫 항목'],
  [-1, -1, D0, 3, '선택 없음 ↑ → 마지막 항목'],
  [0, 1, D0, 1, '0 ↓ → 1'],
  [2, -1, D0, 1, '2 ↑ → 1'],
  [3, 1, D0, 0, '끝에서 ↓ → 처음(순환)'],
  [0, -1, D0, 3, '처음에서 ↑ → 끝(순환)'],
  [1, 2, D0, 3, 'delta 2 → 두 칸'],
  [-1, 2, D0, 1, '선택 없음 delta 2 → 첫 항목에서 한 칸 더'],
  [3, 2, D0, 1, 'delta 2 순환'],
  [2, 0, D0, 2, 'delta 0 → 그대로'],
  [-1, 0, D0, -1, 'delta 0 선택 없음 → -1'],
  [9, 1, D0, 0, '범위 밖 current ↓ → 첫 항목'],
  [9, -1, D0, 3, '범위 밖 current ↑ → 마지막 항목'],
  [9, 0, D0, -1, '범위 밖 current delta 0 → -1'],
  [-1, 'first', D0, 0, "'first'"],
  [2, 'last', D0, 3, "'last'"],
  [-1, 1, D1, 1, 'disabled 0 건너뛰고 1'],
  [1, 1, D1, 3, '1 ↓ → disabled 2 건너뛰고 3'],
  [3, 1, D1, 1, '3 ↓ → 순환 + disabled 0 건너뛰고 1'],
  [1, -1, D1, 3, '1 ↑ → 순환 + disabled 0 건너뛰고 3'],
  [-1, -1, D1, 3, '선택 없음 ↑ → 마지막 활성 3'],
  [-1, 'first', D1, 1, "'first' = 첫 활성 1"],
  [0, 'last', D1, 3, "'last' = 마지막 활성 3"],
  [0, 1, D1, 1, 'current 가 disabled(0) ↓ → 1'],
  [2, -1, D1, 1, 'current 가 disabled(2) ↑ → 1'],
  [2, 0, D1, -1, 'current 가 disabled delta 0 → -1'],
  [1, 1, ONE, 1, '활성 1개 ↓ → 자기 자신'],
  [1, -1, ONE, 1, '활성 1개 ↑ → 자기 자신'],
  [-1, 1, ALL_OFF, -1, '전부 disabled → -1'],
  [0, 'first', ALL_OFF, -1, "전부 disabled 'first' → -1"],
  [-1, 1, EMPTY, -1, '빈 목록 ↓ → -1'],
  [0, 'last', EMPTY, -1, "빈 목록 'last' → -1"],
];
for (const [current, move, disabled, expected, label] of NAV_TABLE) {
  check(`nextActiveIndex ${label}`, nextActiveIndex(current, move, { disabled }), expected);
}

// [key, open, activeIndex, optionCount, intent, preventDefault]
const KEY_TABLE: Array<[string, boolean, number, number, ComboboxKeyIntent, boolean]> = [
  ['ArrowDown', false, -1, 3, 'open', true],
  ['ArrowUp', false, -1, 3, 'open', true],
  ['ArrowDown', false, 1, 3, 'open', true],
  ['ArrowDown', true, -1, 3, 'move-next', true],
  ['ArrowUp', true, 1, 3, 'move-prev', true],
  ['ArrowDown', true, -1, 0, 'move-next', true],
  ['Enter', true, 0, 3, 'select', true],
  ['Enter', true, 2, 3, 'select', true],
  ['Enter', true, -1, 3, 'none', false],
  ['Enter', true, 3, 3, 'none', false],
  ['Enter', false, 0, 3, 'none', false],
  ['Enter', false, -1, 0, 'none', false],
  ['Escape', true, -1, 3, 'close', true],
  ['Escape', true, 1, 3, 'close', true],
  ['Escape', false, -1, 3, 'none', false],
  ['Tab', true, 1, 3, 'close', false],
  ['Tab', false, -1, 3, 'none', false],
  ['Home', true, 2, 3, 'first', true],
  ['End', true, 0, 3, 'last', true],
  ['Home', true, -1, 3, 'none', false],
  ['End', true, -1, 3, 'none', false],
  ['Home', false, 1, 3, 'none', false],
  ['End', false, -1, 3, 'none', false],
  ['a', true, 0, 3, 'none', false],
  [' ', true, 0, 3, 'none', false],
  ['PageDown', true, 0, 3, 'none', false],
  ['Esc', true, 0, 3, 'none', false],
];
for (const [key, open, activeIndex, optionCount, intent, preventDefault] of KEY_TABLE) {
  check(
    `resolveComboboxKey ${JSON.stringify(key)} open=${open} active=${activeIndex}/${optionCount}`,
    resolveComboboxKey({ key, open, activeIndex, optionCount }),
    { intent, preventDefault },
  );
}

if (fails.length > 0) {
  console.error(fails.join('\n'));
  console.error(`\nlistboxNavigationParity: ${pass} 통과 / ${fails.length} 실패`);
  process.exit(1);
}
console.log(`listboxNavigationParity: ${pass} 단언 통과`);
