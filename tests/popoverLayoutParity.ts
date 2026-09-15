// tests/popoverLayoutParity.ts
// ---------------------------------------------------------------------------
// 공용 Popover/Combobox 위치 계산(utils/popoverLayout) 회귀 테스트 — 순수 함수만(React/DOM 없음). Stage D2 P0.
//
// 고정 대상 (명시적 골든 절대값 — 경로 대조가 아니라 숫자를 박제):
//   · align start(앵커 왼쪽 정렬) / end(앵커 오른쪽 정렬)
//   · matchAnchorWidth: width = 앵커 폭(뷰포트 - 2×여백 상한), 결과에만 width 키
//   · 가로 클램프: 오른쪽 여백 → 왼쪽 여백(왼쪽 우선)
//   · 세로: computeMenuPosition 과 같은 규칙(아래 ≥ / 위 엄격 > / 양쪽 부족 → 넓은 쪽 + maxHeight)
//   · gap / margin 사용자 지정
// 마지막 절(보조)은 align 'end' 기본값이 ActionMenu 계산과 같은 값을 내는지 확인한다 — 골든은 위 절이 따로 박제.
//
// 수동 실행: npx tsx tests/popoverLayoutParity.ts. 통과 시 exit 0.

import { computePopoverPosition, isSamePopoverPosition } from '../utils/popoverLayout';
import { computeMenuPosition } from '../utils/actionMenuLayout';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

const VP = { width: 1280, height: 800 };
const PANEL = { width: 208, height: 176 };
const A = { top: 100, bottom: 136, left: 400, right: 500 };
const START = { align: 'start' } as const;
const END = { align: 'end' } as const;

// 1. 정렬
check('start 정렬 — 앵커 왼쪽 끝',
  computePopoverPosition(A, VP, PANEL, START),
  { top: 140, left: 400, openUp: false, maxHeight: null });
check('end 정렬 — 앵커 오른쪽 끝(500-208)',
  computePopoverPosition(A, VP, PANEL, END),
  { top: 140, left: 292, openUp: false, maxHeight: null });

// 2. 앵커 폭 맞춤
const WIDE = { top: 100, bottom: 136, left: 300, right: 620 };
check('앵커 폭 맞춤(start) — width 320, panel.width 무시',
  computePopoverPosition(WIDE, VP, PANEL, { align: 'start', matchAnchorWidth: true }),
  { top: 140, left: 300, width: 320, openUp: false, maxHeight: null });
check('앵커 폭 맞춤(end) — 폭이 같으니 left 동일',
  computePopoverPosition(WIDE, VP, PANEL, { align: 'end', matchAnchorWidth: true }),
  { top: 140, left: 300, width: 320, openUp: false, maxHeight: null });
check('앵커 폭 맞춤 — 좁은 뷰포트는 200-16=184 로 상한, 왼쪽 여백 8',
  computePopoverPosition({ top: 100, bottom: 136, left: 0, right: 300 }, { width: 200, height: 800 }, PANEL, { align: 'start', matchAnchorWidth: true }),
  { top: 140, left: 8, width: 184, openUp: false, maxHeight: null });
check('matchAnchorWidth false 명시 — width 키 없음',
  computePopoverPosition(A, VP, PANEL, { align: 'start', matchAnchorWidth: false }),
  { top: 140, left: 400, openUp: false, maxHeight: null });

// 3. 오른쪽 가장자리 클램프
check('오른쪽 클램프(start) — 1280-208-8=1064',
  computePopoverPosition({ top: 100, bottom: 136, left: 1200, right: 1260 }, VP, PANEL, START),
  { top: 140, left: 1064, openUp: false, maxHeight: null });
check('오른쪽 클램프(앵커 폭 맞춤) — 1280-300-8=972',
  computePopoverPosition({ top: 100, bottom: 136, left: 1100, right: 1400 }, VP, PANEL, { align: 'start', matchAnchorWidth: true }),
  { top: 140, left: 972, width: 300, openUp: false, maxHeight: null });

// 4. 왼쪽 가장자리 클램프
check('왼쪽 클램프(end) — 100-208=-108 → 8',
  computePopoverPosition({ top: 100, bottom: 136, left: 20, right: 100 }, VP, PANEL, END),
  { top: 140, left: 8, openUp: false, maxHeight: null });
check('왼쪽 클램프(start, 앵커가 화면 밖에서 시작) — -50 → 8',
  computePopoverPosition({ top: 100, bottom: 136, left: -50, right: 150 }, VP, PANEL, START),
  { top: 140, left: 8, openUp: false, maxHeight: null });
check('좁은 뷰포트 — 왼쪽 여백 우선',
  computePopoverPosition({ top: 100, bottom: 136, left: 0, right: 150 }, { width: 200, height: 800 }, PANEL, END),
  { top: 140, left: 8, openUp: false, maxHeight: null });

// 5. 위로 열기
check('하단 근접 → openUp, top = 700-176',
  computePopoverPosition({ top: 700, bottom: 736, left: 400, right: 500 }, VP, PANEL, START),
  { top: 524, left: 400, openUp: true, maxHeight: null });

// 6. 경계
check('아래 공간 == 높이 → 아래(>=)',
  computePopoverPosition(A, { width: 1280, height: 312 }, PANEL, START),
  { top: 140, left: 400, openUp: false, maxHeight: null });
check('anchor.top == 높이 → 위 충분 아님(엄격 >) → 양쪽 부족·위 넓음',
  computePopoverPosition({ top: 176, bottom: 212, left: 400, right: 500 }, { width: 1280, height: 300 }, PANEL, START),
  { top: 8, left: 400, openUp: true, maxHeight: 168 });
check('높이 0 패널 → 아래',
  computePopoverPosition(A, VP, { width: 208, height: 0 }, START),
  { top: 140, left: 400, openUp: false, maxHeight: null });

// 7. 양쪽 다 부족 — maxHeight
check('양쪽 부족·아래 넓음 → 아래 + maxHeight 311-140-8',
  computePopoverPosition(A, { width: 1280, height: 311 }, PANEL, START),
  { top: 140, left: 400, openUp: false, maxHeight: 163 });
check('양쪽 부족·위 넓음 → top 8 + maxHeight 300-8',
  computePopoverPosition({ top: 300, bottom: 336, left: 400, right: 500 }, { width: 1280, height: 400 }, { width: 208, height: 350 }, END),
  { top: 8, left: 292, openUp: true, maxHeight: 292 });
check('양쪽 부족 + 앵커 폭 맞춤',
  computePopoverPosition(WIDE, { width: 1280, height: 311 }, PANEL, { align: 'start', matchAnchorWidth: true }),
  { top: 140, left: 300, width: 320, openUp: false, maxHeight: 163 });

// 8. gap / margin 사용자 지정
check('gap 8 → top 136+8',
  computePopoverPosition(A, VP, PANEL, { align: 'start', gap: 8, margin: 16 }),
  { top: 144, left: 400, openUp: false, maxHeight: null });
check('margin 16 오른쪽 클램프 → 1280-208-16',
  computePopoverPosition({ top: 100, bottom: 136, left: 1200, right: 1260 }, VP, PANEL, { align: 'start', margin: 16 }),
  { top: 140, left: 1056, openUp: false, maxHeight: null });
check('margin 16 양쪽 부족·위 넓음 → top 16, maxHeight 284',
  computePopoverPosition({ top: 300, bottom: 336, left: 400, right: 500 }, { width: 1280, height: 400 }, { width: 208, height: 350 }, { align: 'end', margin: 16 }),
  { top: 16, left: 292, openUp: true, maxHeight: 284 });
check('margin 16 양쪽 부족·아래 넓음 → maxHeight 311-148-16',
  computePopoverPosition(A, { width: 1280, height: 311 }, PANEL, { align: 'start', gap: 12, margin: 16 }),
  { top: 148, left: 400, openUp: false, maxHeight: 147 });

// 9. 동등 비교
const p = { top: 140, left: 300, width: 320, openUp: false, maxHeight: null };
check('isSame null', isSamePopoverPosition(null, p), false);
check('isSame 같음', isSamePopoverPosition({ ...p }, p), true);
check('isSame width 다름', isSamePopoverPosition({ ...p, width: 321 }, p), false);
check('isSame width 유무 다름', isSamePopoverPosition({ top: 140, left: 300, openUp: false, maxHeight: null }, p), false);
check('isSame maxHeight 다름', isSamePopoverPosition({ ...p, maxHeight: 10 }, p), false);

// 10. (보조) align end + 기본 gap/margin 은 ActionMenu 계산과 같은 값 — 위 골든과 별개로 규칙 공유 확인
const SAMPLES: Array<[typeof A, typeof VP, typeof PANEL]> = [
  [A, VP, PANEL],
  [{ top: 700, bottom: 736, left: 400, right: 500 }, VP, PANEL],
  [{ top: 100, bottom: 136, left: 1200, right: 1300 }, VP, PANEL],
  [A, { width: 1280, height: 311 }, PANEL],
  [{ top: 300, bottom: 336, left: 400, right: 500 }, { width: 1280, height: 400 }, { width: 208, height: 350 }],
];
SAMPLES.forEach(([anchor, vp, panel], i) => {
  check(`ActionMenu 규칙 공유 #${i + 1}`, computePopoverPosition(anchor, vp, panel, END), computeMenuPosition(anchor, vp, panel));
});

if (fails.length > 0) {
  console.error(fails.join('\n'));
  console.error(`\npopoverLayoutParity: ${pass} 통과 / ${fails.length} 실패`);
  process.exit(1);
}
console.log(`popoverLayoutParity: ${pass} 단언 통과`);
