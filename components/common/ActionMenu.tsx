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
}

const MENU_WIDTH = 176; // w-44 = 11rem = 176px
const MENU_ITEM_HEIGHT = 40;
const MOBILE_BREAKPOINT = 768;

const ActionMenu: React.FC<ActionMenuProps> = ({ anchorRef, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; openUp: boolean } | null>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < MOBILE_BREAKPOINT);

  const calcPosition = useCallback(() => {
    if (!anchorRef.current || isMobile) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const menuHeight = items.length * MENU_ITEM_HEIGHT + 8;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < menuHeight && rect.top > menuHeight;

    setPosition({
      top: openUp ? rect.top - menuHeight : rect.bottom + 4,
      left: Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
      openUp,
    });
  }, [anchorRef, items.length, isMobile]);

  useEffect(() => {
    calcPosition();
    const handleResize = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
      calcPosition();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [calcPosition]);

  // Close on outside click
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
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Mobile: bottom sheet
  if (isMobile) {
    return createPortal(
      <div className="fixed inset-0 z-[9999] flex items-end justify-center">
        <div className="absolute inset-0 bg-black/50" onClick={onClose} />
        <div
          ref={menuRef}
          className="relative w-full max-w-lg bg-gray-800 border-t border-gray-700 rounded-t-xl shadow-2xl pb-safe animate-slide-up"
        >
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-10 h-1 bg-gray-600 rounded-full" />
          </div>
          <div className="px-2 pb-3">
            {items.map((item, i) => (
              <button
                key={i}
                onClick={() => { onClose(); item.onClick(); }}
                className={`block w-full text-left px-4 py-3 text-base rounded-lg hover:bg-gray-700 transition ${item.colorClass || 'text-white'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="px-2 pb-3">
            <button
              onClick={onClose}
              className="block w-full text-center px-4 py-3 text-base text-gray-400 bg-gray-700/50 rounded-lg hover:bg-gray-700 transition"
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
      className="fixed z-[9999] w-44 bg-gray-800 border border-gray-700 rounded-md shadow-lg text-sm"
      style={{ top: position.top, left: position.left }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => { onClose(); item.onClick(); }}
          className={`block w-full text-left px-3 py-2 hover:bg-gray-700 transition ${item.colorClass || 'text-white'}`}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  );
};

export default ActionMenu;
