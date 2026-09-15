// utils/actionMenuLayout.ts
// ---------------------------------------------------------------------------
// ActionMenu(데스크탑 포털 드롭다운) 위치·높이 계산 — 순수 함수(DOM 없음).
//
//   · computeMenuPosition: 앵커 사각형 + 뷰포트 + 패널 실측 크기 → {top, left, openUp, maxHeight}
//       - 아래 공간이 충분하면 아래(anchor.bottom + GAP)
//       - 아래는 부족하고 위가 충분하면 위(anchor.top - height) — Stage C 이전 동작 그대로
//       - 양쪽 다 부족하면 더 넓은 쪽으로 열고 maxHeight 로 잘라 패널 안에서 스크롤(뷰포트 밖으로 넘치지 않음)
//       - 가로: 앵커 오른쪽 끝에 패널 오른쪽을 맞춤 → 오른쪽 여백(8px) 클램프 → 왼쪽 여백(8px) 클램프
//   · estimateMenuHeight: 렌더 전 실측이 불가능할 때의 폴백 — 항목/섹션/구분선 종류별 명시 높이.
//       실제 위치는 ActionMenu 가 렌더 직후(useLayoutEffect, 페인트 전) 패널을 실측해 다시 계산한다
//       (라벨 줄바꿈·섹션 헤더가 있어도 정확). 이전의 "항목당 40px" 고정 추정은 섹션이 생기면 틀린다.

export type MenuEntryKind = 'item' | 'section' | 'separator';

export interface MenuAnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface MenuViewport {
  width: number;
  height: number;
}

export interface MenuPanelSize {
  width: number;
  height: number;
}

export interface MenuPosition {
  top: number;
  left: number;
  openUp: boolean;
  /** 뷰포트 안에 다 들어가지 않을 때만 숫자(패널 내부 스크롤). 들어가면 null */
  maxHeight: number | null;
}

/** 앵커 아래로 열 때 앵커와 패널 사이 간격 */
export const MENU_GAP = 4;
/** 뷰포트 가장자리 최소 여백 */
export const MENU_VIEWPORT_MARGIN = 8;

/** 데스크탑 패널 종류별 높이(px) — ActionMenu 클래스와 짝(text-sm leading 20px 기준) */
export const MENU_ROW_HEIGHTS = {
  /** px-3 py-2 text-sm → 20 + 16 */
  item: 36,
  /** pt-2 pb-1 text-xs → 16 + 8 + 4 */
  section: 28,
  /** my-1 h-px → 1 + 8 */
  separator: 9,
  /** header prop: py-2 text-xs + border-b → 16 + 16 + 1 */
  header: 33,
  /** 패널 border 상하 1px */
  panelBorder: 2,
} as const;

export function estimateMenuHeight(kinds: readonly MenuEntryKind[], hasHeader: boolean): number {
  let h = MENU_ROW_HEIGHTS.panelBorder + (hasHeader ? MENU_ROW_HEIGHTS.header : 0);
  for (const k of kinds) h += MENU_ROW_HEIGHTS[k];
  return h;
}

export function computeMenuPosition(
  anchor: MenuAnchorRect,
  viewport: MenuViewport,
  panel: MenuPanelSize,
): MenuPosition {
  const m = MENU_VIEWPORT_MARGIN;
  const h = Math.max(0, panel.height);
  const w = Math.max(0, panel.width);

  // 가로: 오른쪽 정렬 → 오른쪽 클램프 → 왼쪽 클램프(왼쪽이 우선 — 패널 시작점이 화면 밖으로 나가지 않게)
  const left = Math.max(m, Math.min(anchor.right - w, viewport.width - w - m));

  const spaceBelow = viewport.height - anchor.bottom;
  const fitsBelow = spaceBelow >= h;
  const fitsAbove = anchor.top > h;

  if (fitsBelow) {
    return { top: anchor.bottom + MENU_GAP, left, openUp: false, maxHeight: null };
  }
  if (fitsAbove) {
    return { top: anchor.top - h, left, openUp: true, maxHeight: null };
  }
  // 양쪽 다 부족 — 넓은 쪽으로 열고 높이를 자른다
  if (anchor.top > spaceBelow) {
    return { top: m, left, openUp: true, maxHeight: Math.max(0, anchor.top - m) };
  }
  const top = anchor.bottom + MENU_GAP;
  return { top, left, openUp: false, maxHeight: Math.max(0, viewport.height - top - m) };
}

export function isSameMenuPosition(a: MenuPosition | null, b: MenuPosition): boolean {
  return !!a && a.top === b.top && a.left === b.left && a.openUp === b.openUp && a.maxHeight === b.maxHeight;
}
