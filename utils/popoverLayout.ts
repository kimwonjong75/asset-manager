// utils/popoverLayout.ts
// ---------------------------------------------------------------------------
// 공용 Popover / Combobox 목록(포털 fixed 패널) 위치 계산 — 순수 함수(DOM 없음). Stage D2 P0.
//
//   · computePopoverPosition(anchor, viewport, panel, opts) → {top, left, width?, openUp, maxHeight}
//       세로 규칙은 utils/actionMenuLayout.computeMenuPosition 과 **동일**(gap/margin 기본값도 같은 상수):
//         - 아래 공간(vh - anchor.bottom) ≥ h → 아래(top = anchor.bottom + gap)
//         - 아니고 anchor.top > h(엄격) → 위(top = anchor.top - h)
//         - 양쪽 다 부족 → 넓은 쪽으로 열고 maxHeight 로 잘라 패널 안에서 스크롤
//           (위: top = margin, maxHeight = anchor.top - margin / 아래: maxHeight = vh - top - margin)
//       가로:
//         - align 'start' = 앵커 왼쪽 끝에 패널 왼쪽을 맞춤, 'end' = 앵커 오른쪽 끝에 패널 오른쪽을 맞춤
//         - matchAnchorWidth → 패널 폭 = 앵커 폭(뷰포트 - 2×margin 을 넘지 않게), 결과에 width 포함
//           (아니면 width 키 자체가 없다 — 패널 실측 폭을 그대로 쓴다)
//         - 오른쪽 여백 클램프 → 왼쪽 여백 클램프(왼쪽 우선 — 패널 시작점이 화면 밖으로 나가지 않게)
//   · isSamePopoverPosition: 같은 값이면 setState 를 생략하기 위한 동등 비교
//
// 실측(패널 scrollHeight·offsetWidth)과 뷰포트 읽기는 components/common/Popover.tsx 의 useAnchoredPosition 이 한다.

import {
  MENU_GAP,
  MENU_VIEWPORT_MARGIN,
  type MenuAnchorRect,
  type MenuPanelSize,
  type MenuViewport,
} from './actionMenuLayout';

export type PopoverAlign = 'start' | 'end';

export interface PopoverLayoutOptions {
  align: PopoverAlign;
  /** true 면 패널 폭을 앵커 폭에 맞춘다(콤보박스 목록) */
  matchAnchorWidth?: boolean;
  /** 앵커와 패널 사이 간격(아래로 열 때). 기본 MENU_GAP(4) */
  gap?: number;
  /** 뷰포트 가장자리 최소 여백. 기본 MENU_VIEWPORT_MARGIN(8) */
  margin?: number;
}

export interface PopoverPosition {
  top: number;
  left: number;
  /** matchAnchorWidth 일 때만 존재 */
  width?: number;
  openUp: boolean;
  /** 뷰포트 안에 다 들어가지 않을 때만 숫자(패널 내부 스크롤). 들어가면 null */
  maxHeight: number | null;
}

export function computePopoverPosition(
  anchor: MenuAnchorRect,
  viewport: MenuViewport,
  panel: MenuPanelSize,
  opts: PopoverLayoutOptions,
): PopoverPosition {
  const gap = opts.gap ?? MENU_GAP;
  const m = opts.margin ?? MENU_VIEWPORT_MARGIN;
  const h = Math.max(0, panel.height);
  const matchWidth = opts.matchAnchorWidth === true;
  const w = matchWidth
    ? Math.max(0, Math.min(anchor.right - anchor.left, viewport.width - 2 * m))
    : Math.max(0, panel.width);

  const desiredLeft = opts.align === 'start' ? anchor.left : anchor.right - w;
  const left = Math.max(m, Math.min(desiredLeft, viewport.width - w - m));

  const make = (top: number, openUp: boolean, maxHeight: number | null): PopoverPosition =>
    matchWidth ? { top, left, width: w, openUp, maxHeight } : { top, left, openUp, maxHeight };

  const spaceBelow = viewport.height - anchor.bottom;
  if (spaceBelow >= h) return make(anchor.bottom + gap, false, null);
  if (anchor.top > h) return make(anchor.top - h, true, null);
  // 양쪽 다 부족 — 넓은 쪽으로 열고 높이를 자른다
  if (anchor.top > spaceBelow) return make(m, true, Math.max(0, anchor.top - m));
  const top = anchor.bottom + gap;
  return make(top, false, Math.max(0, viewport.height - top - m));
}

export function isSamePopoverPosition(a: PopoverPosition | null, b: PopoverPosition): boolean {
  return (
    !!a &&
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.openUp === b.openUp &&
    a.maxHeight === b.maxHeight
  );
}
