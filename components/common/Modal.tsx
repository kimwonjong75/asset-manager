// components/common/Modal.tsx
// Stage C 공용 모달 — 렌더 전용. 새 모달은 반드시 이 컴포넌트를 쓴다(RULES.md §8 모달 반응형 패턴).
//
// 계약
//   · Esc 와 백드롭 클릭은 **둘 다 `onClose`** 를 부른다. 미저장 변경 보호(§8 모달 닫기 보호)는
//     호출부가 `onClose={handleClose}`(isDirty 확인 래퍼)를 넘기는 것으로 유지된다 — 이 컴포넌트는
//     dirty 여부를 모른다.
//   · 포털(body) + `z-modal`. 그 위의 ConfirmDialog(`z-dialog`)는 window capture 단계에서 Esc를
//     먹으므로(stopPropagation) 아래 모달이 같이 닫히지 않는다. 추가로 Esc는 "가장 위의
//     aria-modal 요소가 이 패널일 때"만 처리한다(ChartViewerModal·ActionMenu 시트 등이 위에 떠 있을 때).
//   · 포커스: 열리면 initialFocusRef → 본문 첫 포커스 요소 → 헤더 닫기 버튼 → 패널 순. Tab/Shift+Tab 은
//     패널 안에서 순환(라이트 트랩). 닫히면 열기 직전 포커스 요소로 복귀(아직 문서에 있을 때만).
//   · 열린 동안 body 스크롤 잠금(이전 overflow 값 복원).
//   · role="dialog" aria-modal="true" → index.css `.hide-when-modal` 이 하단 탭바를 숨긴다.
//   · 오버레이라 그림자(shadow-xl) 허용 — 카드에는 그림자를 쓰지 않는다.

import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalProps {
  open: boolean;
  /** Esc·백드롭·X 버튼이 모두 이 콜백을 부른다 — dirty 확인이 필요하면 handleClose 래퍼를 넘길 것 */
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** 하단 고정 버튼 영역(스크롤되지 않음) */
  footer?: React.ReactNode;
  size?: ModalSize;
  /** 기본 true. false 면 백드롭 클릭으로 닫히지 않는다(Esc·X 는 계속 onClose) */
  closeOnBackdrop?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** 외부 제목 요소 id 로 라벨링할 때(title 을 안 쓰는 커스텀 헤더) */
  labelledBy?: string;
  /** 패널에 추가할 클래스 */
  className?: string;
}

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
};

export const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function getFocusable(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    el => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
  );
}

const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  initialFocusRef,
  labelledBy,
  className = '',
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const backdropPressRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Esc — 가장 위의 aria-modal 이 이 패널일 때만, 이미 처리된(defaultPrevented) 이벤트는 무시
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const modals = document.querySelectorAll('[aria-modal="true"]');
      const top = modals[modals.length - 1];
      if (top && top !== panelRef.current) return;
      e.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  // body 스크롤 잠금
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // 초기 포커스 + 닫힐 때 복귀
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target =
      initialFocusRef?.current ??
      getFocusable(bodyRef.current)[0] ??
      closeBtnRef.current ??
      panelRef.current;
    target?.focus({ preventScroll: true });
    return () => {
      if (previous && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open, initialFocusRef]);

  if (!open) return null;

  const handlePanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const items = getFocusable(panelRef.current);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && items.includes(active);
    if (e.shiftKey && (active === first || !inside)) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault();
      first?.focus();
    }
  };

  const ariaLabelledBy = labelledBy ?? (title ? titleId : undefined);

  return createPortal(
    <div
      className="fixed inset-0 z-modal bg-black/60 flex items-end sm:items-center justify-center p-4"
      onMouseDown={e => {
        backdropPressRef.current = e.target === e.currentTarget;
      }}
      onClick={e => {
        const pressedBackdrop = backdropPressRef.current;
        backdropPressRef.current = false;
        if (closeOnBackdrop && pressedBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        onKeyDown={handlePanelKeyDown}
        className={`relative w-full ${SIZE_CLASSES[size]} max-h-[90dvh] flex flex-col bg-surface-elevated border border-border-subtle rounded-card shadow-xl mb-[env(safe-area-inset-bottom)] sm:mb-0 focus:outline-none ${className}`}
      >
        {title ? (
          <div className="shrink-0 flex items-start justify-between gap-3 px-4 sm:px-6 py-3.5 border-b border-border-subtle">
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold text-white">
                {title}
              </h2>
              {description && (
                <p id={descId} className="text-sm text-gray-400 mt-0.5 leading-relaxed">
                  {description}
                </p>
              )}
            </div>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="shrink-0 -mr-1.5 inline-flex items-center justify-center min-h-9 min-w-9 rounded-md text-gray-400 hover:text-white hover:bg-gray-700/60 transition-colors focus-ring"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="absolute top-2 right-2 z-10 inline-flex items-center justify-center min-h-9 min-w-9 rounded-md text-gray-400 hover:text-white hover:bg-gray-700/60 transition-colors focus-ring"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        {!title && description && (
          <p id={descId} className="sr-only">
            {description}
          </p>
        )}
        <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
          {children}
        </div>
        {footer && (
          <div className="shrink-0 flex flex-wrap justify-end gap-2 px-4 sm:px-6 py-3 border-t border-border-subtle">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
