// tests/actionMenuLayoutParity.ts
// ---------------------------------------------------------------------------
// ActionMenu 위치·높이 계산(utils/actionMenuLayout) 회귀 테스트 — 순수 함수만(React/DOM 없음).
//
// 고정 대상 (명시적 골든 절대값 — 경로 대조 아님):
//   · 아래로 열기: top = anchor.bottom + 4, 가로는 앵커 오른쪽 끝 정렬
//   · 아래 부족 + 위 충분(anchor.top > h, 엄격 부등호): openUp, top = anchor.top - h  (Stage C 이전 동작)
//   · 양쪽 다 부족: 넓은 쪽으로 열고 maxHeight 로 자름(여백 8)
//   · 가로 클램프: 오른쪽 여백 8 → 왼쪽 여백 8(왼쪽 우선)
//   · 높이 추정: item 36 / section 28 / separator 9 / header 33 / 테두리 2
//
// 수동 실행: npx tsx tests/actionMenuLayoutParity.ts. 통과 시 exit 0.

import {
  computeMenuPosition,
  estimateMenuHeight,
  isSameMenuPosition,
  MENU_GAP,
  MENU_VIEWPORT_MARGIN,
  MENU_ROW_HEIGHTS,
} from '../utils/actionMenuLayout';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

const VP = { width: 1280, height: 800 };
const PANEL = { width: 208, height: 176 };

// 0. 상수
check('MENU_GAP', MENU_GAP, 4);
check('MENU_VIEWPORT_MARGIN', MENU_VIEWPORT_MARGIN, 8);
check('MENU_ROW_HEIGHTS', MENU_ROW_HEIGHTS, { item: 36, section: 28, separator: 9, header: 33, panelBorder: 2 });

// 1. 기본 — 아래로, 오른쪽 정렬
check('기본 아래 열기',
  computeMenuPosition({ top: 100, bottom: 136, left: 400, right: 500 }, VP, PANEL),
  { top: 140, left: 292, openUp: false, maxHeight: null });

// 2. 하단 근접 — 위로
check('하단 근접 → openUp',
  computeMenuPosition({ top: 700, bottom: 736, left: 400, right: 500 }, VP, PANEL),
  { top: 524, left: 292, openUp: true, maxHeight: null });

// 3. 오른쪽 가장자리 클램프
check('오른쪽 클램프',
  computeMenuPosition({ top: 100, bottom: 136, left: 1200, right: 1300 }, VP, PANEL),
  { top: 140, left: 1064, openUp: false, maxHeight: null });

// 4. 왼쪽 가장자리 클램프
check('왼쪽 클램프',
  computeMenuPosition({ top: 100, bottom: 136, left: 20, right: 100 }, VP, PANEL),
  { top: 140, left: 8, openUp: false, maxHeight: null });

// 5. 뷰포트가 패널보다 좁음 — 왼쪽 여백 우선
check('좁은 뷰포트 → 왼쪽 여백 우선',
  computeMenuPosition({ top: 100, bottom: 136, left: 0, right: 150 }, { width: 200, height: 800 }, PANEL),
  { top: 140, left: 8, openUp: false, maxHeight: null });

// 6. 아래 공간 == 높이 → 아래(>= 경계)
check('아래 공간 정확히 일치',
  computeMenuPosition({ top: 100, bottom: 136, left: 400, right: 500 }, { width: 1280, height: 312 }, PANEL),
  { top: 140, left: 292, openUp: false, maxHeight: null });

// 7. 양쪽 부족, 아래가 넓음 → 아래로 + maxHeight
check('양쪽 부족·아래 넓음',
  computeMenuPosition({ top: 100, bottom: 136, left: 400, right: 500 }, { width: 1280, height: 311 }, PANEL),
  { top: 140, left: 292, openUp: false, maxHeight: 163 });

// 8. 양쪽 부족, 위가 넓음 → 위로(top=8) + maxHeight
check('양쪽 부족·위 넓음',
  computeMenuPosition({ top: 300, bottom: 336, left: 400, right: 500 }, { width: 1280, height: 400 }, { width: 208, height: 350 }),
  { top: 8, left: 292, openUp: true, maxHeight: 292 });

// 9. anchor.top == h → fitsAbove 아님(엄격 >)
check('anchor.top == 높이 경계',
  computeMenuPosition({ top: 176, bottom: 212, left: 400, right: 500 }, { width: 1280, height: 300 }, PANEL),
  { top: 8, left: 292, openUp: true, maxHeight: 168 });

// 10. 기존(Stage C) 동작 호환 예 — 폭 176, 높이 128(옛 3항목 추정)
check('레거시 호환 openUp',
  computeMenuPosition({ top: 700, bottom: 736, left: 0, right: 500 }, VP, { width: 176, height: 128 }),
  { top: 572, left: 324, openUp: true, maxHeight: null });
check('레거시 호환 아래',
  computeMenuPosition({ top: 100, bottom: 136, left: 0, right: 500 }, VP, { width: 176, height: 128 }),
  { top: 140, left: 324, openUp: false, maxHeight: null });

// 11. 높이 추정
check('estimate 3항목', estimateMenuHeight(['item', 'item', 'item'], false), 110);
check('estimate 3항목+header', estimateMenuHeight(['item', 'item', 'item'], true), 143);
check('estimate 섹션·구분선', estimateMenuHeight(['section', 'item', 'item', 'separator', 'section', 'item'], false), 175);
check('estimate 섹션·구분선+header', estimateMenuHeight(['section', 'item', 'item', 'separator', 'section', 'item'], true), 208);
check('estimate 빈 목록', estimateMenuHeight([], false), 2);

// 12. 동등 비교
const p = { top: 140, left: 292, openUp: false, maxHeight: null };
check('isSame null', isSameMenuPosition(null, p), false);
check('isSame 같음', isSameMenuPosition({ ...p }, p), true);
check('isSame maxHeight 다름', isSameMenuPosition({ ...p, maxHeight: 10 }, p), false);

if (fails.length > 0) {
  console.error(fails.join('\n'));
  console.error(`\nactionMenuLayoutParity: ${pass} 통과 / ${fails.length} 실패`);
  process.exit(1);
}
console.log(`actionMenuLayoutParity: ${pass} 단언 통과`);
