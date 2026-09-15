// components/common/Popover.tsx
// Stage D2 P0 공용 팝오버 — 렌더 전용. 앵커 버튼에 붙는 비모달 패널(필터·컬럼 설정 등 폼 콘텐츠용).
// 항목 목록(명령 메뉴)은 ActionMenu, 검색 자동완성은 Combobox 를 쓴다.
//
// 계약
//   · 포털(body) + `fixed z-menu`, role="dialog"(비모달 — aria-modal 없음 → 하단 탭바를 숨기지 않고 Modal 의 Esc
//     "가장 위 aria-modal" 판정에도 끼지 않는다). label 또는 labelledBy 로 이름을 붙인다.
//   · 위치: 렌더 직후(useLayoutEffect, 페인트 전) 패널 실측 → utils/popoverLayout.computePopoverPosition.
//     첫 렌더는 visibility:hidden. scroll(capture)·resize·visualViewport resize/scroll 에 재계산.
//   · 포커스: 위치가 잡힌 뒤 initialFocusRef → 패널(tabIndex -1). Esc 로 닫으면 앵커로 복귀.
//     호출부가 닫았는데(open=false) 포커스가 패널 안에 있다가 body 로 사라진 경우에도 앵커로 복귀.
//     바깥 클릭·포커스 이탈로 닫힐 때는 복귀하지 않는다(사용자가 옮긴 포커스를 뺏지 않음).
//   · 닫기(onClose(reason)) — dismissible=false 동안(dnd-kit 드래그 중) 셋 다 무시:
//       'outside'  document pointerdown(capture) — 앵커·패널 밖
//       'focusout' document focusin — 포커스가 앵커·패널 밖으로
//       'escape'   패널 안 포커스: 패널 onKeyDown(React, bubble) — 안쪽 위젯(예: Combobox)이 먼저 preventDefault
//                  하면 무시. 패널 밖(앵커·body): document keydown **capture** — Modal 의 document(bubble) 리스너보다
//                  먼저 돌며, 둘 다 preventDefault 하므로 바깥 Modal 은 같은 Esc 로 닫히지 않는다.
//   · "팝오버보다 나중에 body 에 붙은 레이어"(팝오버 안에서 연 ConfirmDialog·Combobox 목록 등, 문서 순서상 패널 뒤)는
//     안쪽으로 취급한다 — 그 레이어를 클릭·포커스해도 팝오버가 닫히지 않는다.
//   · Tab: 패널 안에서 다음 포커스가 패널 안에 머무는 경우 전파를 막는다(바깥 Modal 의 Tab 순환이 패널 안 이동을
//     가로채지 않게). 첫/마지막 경계에서는 그대로 두어 포커스가 나가면 'focusout' 으로 닫힌다.
//   · 오버레이라 그림자(shadow-lg) 허용.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FOCUSABLE_SELECTOR } from './Modal';
import { MENU_VIEWPORT_MARGIN } from '../../utils/actionMenuLayout';
import {
  computePopoverPosition,
  isSamePopoverPosition,
  type PopoverAlign,
  type PopoverPosition,
} from '../../utils/popoverLayout';

export type PopoverCloseReason = 'escape' | 'outside' | 'focusout';

/** node 가 panel 안이거나, 문서 순서상 panel 뒤(= 나중에 body 에 붙은 상위 레이어)에 있는가 */
export function isInPanelOrLaterLayer(panel: HTMLElement | null, node: EventTarget | null): boolean {
  if (!panel || !(node instanceof Node)) return false;
  if (panel.contains(node)) return true;
  return (panel.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** fixed 좌표계 기준 가용 뷰포트 — 모바일 가상 키보드가 가린 아래쪽은 제외 */
function readViewport(): { width: number; height: number } {
  const vv = window.visualViewport;
  const layoutHeight = window.innerHeight;
  const height = vv ? Math.min(layoutHeight, vv.offsetTop + vv.height) : layoutHeight;
  return { width: window.innerWidth, height };
}

export interface AnchoredPositionOptions {
  /** false 면 측정·리스너 없음(패널이 렌더되지 않은 상태) */
  active: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  panelRef: React.RefObject<HTMLElement | null>;
  align: PopoverAlign;
  matchAnchorWidth?: boolean;
  /** 패널 CSS 최대 높이(rem) — 실측 자연 높이를 이 값으로 자른다(예: max-h-72 → 18) */
  maxHeightRem?: number;
}

/**
 * 앵커에 붙는 fixed 패널 위치. 매 커밋 후(페인트 전) 실측해 같은 값이면 setState 를 생략한다 —
 * 내용(옵션·로딩 문구)이 바뀌어 높이가 달라져도 따로 키를 넘길 필요가 없다. Combobox 와 공유.
 */
export function useAnchoredPosition({
  active,
  anchorRef,
  panelRef,
  align,
  matchAnchorWidth = false,
  maxHeightRem,
}: AnchoredPositionOptions): PopoverPosition | null {
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  const update = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const rect = anchor.getBoundingClientRect();
    // maxHeight 로 잘려 있어도 자연 높이 = scrollHeight + 테두리
    let height = panel.scrollHeight + (panel.offsetHeight - panel.clientHeight);
    if (maxHeightRem !== undefined) {
      const rootPx = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
      height = Math.min(height, maxHeightRem * rootPx);
    }
    const next = computePopoverPosition(
      { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
      readViewport(),
      { width: panel.offsetWidth, height },
      { align, matchAnchorWidth },
    );
    setPosition(prev => (isSamePopoverPosition(prev, next) ? prev : next));
  }, [anchorRef, panelRef, align, matchAnchorWidth, maxHeightRem]);

  useLayoutEffect(() => {
    if (active) update();
  });

  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
    };
  }, [active, update]);

  return position;
}

export interface PopoverProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: (reason: PopoverCloseReason) => void;
  /** 패널 접근성 이름(aria-label) */
  label?: string;
  /** 패널 안 제목 요소 id(aria-labelledby) */
  labelledBy?: string;
  /** 기본 'end' — 앵커 오른쪽 끝에 맞춤 */
  align?: PopoverAlign;
  /** px 고정 폭 또는 'anchor'(앵커 폭). 생략 = 내용 폭(뷰포트 - 16px 상한) */
  width?: number | 'anchor';
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** 기본 true. false 면 바깥 클릭·Esc·포커스 이탈을 무시(dnd-kit 드래그 중) */
  dismissible?: boolean;
  className?: string;
  children?: React.ReactNode;
}

type PopoverPanelProps = Omit<PopoverProps, 'open'>;

const PopoverPanel: React.FC<PopoverPanelProps> = ({
  anchorRef,
  onClose,
  label,
  labelledBy,
  align = 'end',
  width,
  initialFocusRef,
  dismissible = true,
  className = '',
  children,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  const focusWasInsideRef = useRef(false);
  const skipFocusReturnRef = useRef(false);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  }, [onClose, dismissible]);

  const position = useAnchoredPosition({
    active: true,
    anchorRef,
    panelRef,
    align,
    matchAnchorWidth: width === 'anchor',
  });
  const positioned = position !== null;

  // 초기 포커스 — visibility:hidden 인 동안은 focus() 가 무시되므로 위치가 잡힌 뒤에
  useEffect(() => {
    if (!positioned) return;
    const target = initialFocusRef?.current ?? panelRef.current;
    target?.focus({ preventScroll: true });
  }, [positioned, initialFocusRef]);

  const closeByEscape = useCallback(() => {
    const anchor = anchorRef.current;
    skipFocusReturnRef.current = true;
    onCloseRef.current('escape');
    if (anchor && anchor.isConnected) anchor.focus({ preventScroll: true });
  }, [anchorRef]);

  // 바깥 클릭 · 포커스 이탈 · 패널 밖 Esc
  useEffect(() => {
    const isInsideTarget = (target: EventTarget | null) => {
      if (target instanceof Node && anchorRef.current?.contains(target)) return true;
      return isInPanelOrLaterLayer(panelRef.current, target);
    };
    const closeQuietly = (reason: 'outside' | 'focusout') => {
      skipFocusReturnRef.current = true;
      onCloseRef.current(reason);
    };
    const handleKeyCapture = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !dismissibleRef.current) return;
      // 패널 안(과 그 위 레이어)에서 난 Esc 는 패널 onKeyDown 이 처리 — 안쪽 위젯이 먼저 가로챌 기회를 준다
      if (isInPanelOrLaterLayer(panelRef.current, e.target)) return;
      e.preventDefault();
      closeByEscape();
    };
    const handlePointerDown = (e: PointerEvent) => {
      if (!dismissibleRef.current || isInsideTarget(e.target)) return;
      closeQuietly('outside');
    };
    const handleFocusIn = (e: FocusEvent) => {
      if (!dismissibleRef.current || isInsideTarget(e.target)) return;
      closeQuietly('focusout');
    };
    document.addEventListener('keydown', handleKeyCapture, true);
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('keydown', handleKeyCapture, true);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, [anchorRef, closeByEscape]);

  // 호출부가 닫았을 때(언마운트) — 포커스가 패널 안에 있다가 body 로 사라졌으면 앵커로 복귀
  useEffect(() => {
    const anchor = anchorRef.current;
    return () => {
      if (skipFocusReturnRef.current || !focusWasInsideRef.current) return;
      if (!anchor || !anchor.isConnected) return;
      const active = document.activeElement;
      if (active && active !== document.body) return;
      anchor.focus({ preventScroll: true });
    };
  }, [anchorRef]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    if (!panel || !(e.target instanceof Node) || !panel.contains(e.target)) return;
    if (e.key === 'Escape') {
      if (e.defaultPrevented || !dismissibleRef.current) return;
      e.preventDefault();
      closeByEscape();
      return;
    }
    if (e.key === 'Tab' && !e.defaultPrevented) {
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        el => el.getAttribute('aria-hidden') !== 'true',
      );
      const idx = items.findIndex(el => el === document.activeElement);
      const atBoundary = e.shiftKey
        ? idx <= 0
        : items.length === 0 || idx === items.length - 1;
      if (!atBoundary) e.stopPropagation();
    }
  };

  const fixedWidth = typeof width === 'number' ? width : undefined;
  const maxWidth = `calc(100vw - ${2 * MENU_VIEWPORT_MARGIN}px)`;
  const style: React.CSSProperties = position
    ? {
        top: position.top,
        left: position.left,
        width: position.width ?? fixedWidth,
        maxWidth,
        maxHeight: position.maxHeight ?? undefined,
      }
    : { top: 0, left: 0, width: fixedWidth, maxWidth, visibility: 'hidden' };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onFocus={() => {
        focusWasInsideRef.current = true;
      }}
      onBlur={e => {
        if (!isInPanelOrLaterLayer(panelRef.current, e.relatedTarget)) focusWasInsideRef.current = false;
      }}
      className={`fixed z-menu bg-surface-elevated border border-border-subtle rounded-lg shadow-lg text-sm focus:outline-none ${position?.maxHeight != null ? 'overflow-y-auto' : ''} ${className}`}
      style={style}
    >
      {children}
    </div>,
    document.body,
  );
};

const Popover: React.FC<PopoverProps> = ({ open, ...rest }) => (open ? <PopoverPanel {...rest} /> : null);

export default Popover;
