import React, { useRef, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

export interface ActionMenuItem {
  label: string;
  onClick: () => void;
  colorClass?: string;
}

interface ActionMenuProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  items: ActionMenuItem[];
  onClose: () => void;
  header?: string;
}

const MENU_WIDTH = 176; // w-44 = 11rem = 176px
const MENU_ITEM_HEIGHT = 40;
const MENU_HEADER_HEIGHT = 33;
const MOBILE_BREAKPOINT = 768;

// Stage B 접근성: 데스크탑 = role="menu"/"menuitem", 모바일 바텀시트 = role="dialog"(aria-modal) 안의 menu.
// 열리면 첫 항목에 포커스, ↑↓/Home/End 이동, Esc·닫기 버튼·Tab으로 닫으면 앵커 버튼으로 포커스 복귀.
// 항목 선택 시에는 "포커스가 메뉴 안에 있다가 사라진 경우(body)"에만 복귀한다 — 항목이 연 모달이
// 자기 입력칸에 autoFocus 했으면 그 포커스를 뺏지 않는다. 바깥 클릭으로 닫힐 때는 복귀하지 않는다.
const ActionMenu: React.FC<ActionMenuProps> = ({ anchorRef, items, onClose, header }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const restoreFocusRef = useRef(false);
  const didInitialFocusRef = useRef(false);
  const [position, setPosition] = useState<{ top: number; left: number; openUp: boolean } | null>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < MOBILE_BREAKPOINT);

  const calcPosition = useCallback(() => {
    if (!anchorRef.current || isMobile) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const menuHeight = items.length * MENU_ITEM_HEIGHT + 8 + (header ? MENU_HEADER_HEIGHT : 0);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < menuHeight && rect.top > menuHeight;

    setPosition({
      top: openUp ? rect.top - menuHeight : rect.bottom + 4,
      left: Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
      openUp,
    });
  }, [anchorRef, items.length, isMobile, header]);

  useEffect(() => {
    calcPosition();
    const handleResize = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
      calcPosition();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [calcPosition]);

  // 닫기(언마운트) 시 포커스 복귀 — 앵커는 마운트 시점에 캡처(정리 함수에서 ref.current 재참조 금지)
  useEffect(() => {
    const anchor = anchorRef.current;
    return () => {
      if (!restoreFocusRef.current || !anchor || !anchor.isConnected) return;
      const active = document.activeElement;
      if (active && active !== document.body) return;
      anchor.focus({ preventScroll: true });
    };
  }, [anchorRef]);

  // 첫 항목 초기 포커스 (데스크탑은 위치 계산 후 렌더되므로 position을 기다린다)
  useEffect(() => {
    if (didInitialFocusRef.current) return;
    if (!isMobile && !position) return;
    const first = itemRefs.current[0];
    if (first) {
      first.focus({ preventScroll: true });
      didInitialFocusRef.current = true;
    }
  }, [isMobile, position]);

  const closeAndRestore = useCallback(() => {
    restoreFocusRef.current = true;
    onClose();
  }, [onClose]);

  // Close on outside click (포커스 복귀 없음)
  useEffect(() => {
    const handleClick = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', handleClick, true);
    document.addEventListener('touchstart', handleClick, true);
    return () => {
      document.removeEventListener('mousedown', handleClick, true);
      document.removeEventListener('touchstart', handleClick, true);
    };
  }, [onClose, anchorRef]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAndRestore();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [closeAndRestore]);

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const buttons = itemRefs.current.filter((b): b is HTMLButtonElement => b !== null);
    if (buttons.length === 0) return;
    const idx = buttons.findIndex(b => b === document.activeElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = idx < 0 ? 0 : (idx + 1) % buttons.length;
    else if (e.key === 'ArrowUp') next = idx < 0 ? buttons.length - 1 : (idx - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    else if (e.key === 'Tab') {
      e.preventDefault();
      closeAndRestore();
      return;
    }
    if (next >= 0) {
      e.preventDefault();
      buttons[next]?.focus();
    }
  };

  const selectItem = (item: ActionMenuItem) => {
    restoreFocusRef.current = true;
    onClose();
    item.onClick();
  };

  const menuLabel = header ?? '메뉴';

  // Mobile: bottom sheet
  if (isMobile) {
    return createPortal(
      <div className="fixed inset-0 z-menu flex items-end justify-center" role="dialog" aria-modal="true" aria-label={menuLabel}>
        <div className="absolute inset-0 bg-black/50" onClick={onClose} />
        <div
          ref={menuRef}
          className="relative w-full max-w-lg bg-gray-800 border-t border-gray-700 rounded-t-xl shadow-2xl pb-safe animate-slide-up"
          onKeyDown={handleMenuKeyDown}
        >
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-10 h-1 bg-gray-600 rounded-full" />
          </div>
          {header && (
            <div className="px-6 pb-2 text-xs text-gray-500 truncate border-b border-gray-700 mb-1">{header}</div>
          )}
          <div className="px-2 pb-3" role="menu" aria-label={menuLabel}>
            {items.map((item, i) => (
              <button
                key={i}
                ref={el => { itemRefs.current[i] = el; }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => selectItem(item)}
                className={`block w-full text-left px-4 py-3 text-base rounded-lg hover:bg-gray-700 focus:outline-none focus-visible:bg-gray-700 focus-visible:ring-2 focus-visible:ring-primary-light transition ${item.colorClass || 'text-white'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="px-2 pb-3">
            <button
              type="button"
              onClick={closeAndRestore}
              className="block w-full text-center px-4 py-3 text-base text-gray-400 bg-gray-700/50 rounded-lg hover:bg-gray-700 transition focus-ring"
            >
              닫기
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // Desktop: portal dropdown
  if (!position) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={menuLabel}
      className="fixed z-menu w-44 bg-gray-800 border border-gray-700 rounded-md shadow-lg text-sm"
      style={{ top: position.top, left: position.left }}
      onKeyDown={handleMenuKeyDown}
    >
      {header && (
        <div role="presentation" className="px-3 py-2 text-xs text-gray-500 truncate border-b border-gray-700">{header}</div>
      )}
      {items.map((item, i) => (
        <button
          key={i}
          ref={el => { itemRefs.current[i] = el; }}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={() => selectItem(item)}
          className={`block w-full text-left px-3 py-2 hover:bg-gray-700 focus:outline-none focus-visible:bg-gray-700 transition ${item.colorClass || 'text-white'}`}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  );
};

export default ActionMenu;
