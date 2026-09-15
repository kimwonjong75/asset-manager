import React, { useRef, useEffect, useLayoutEffect, useState, useCallback, useId, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import {
  computeMenuPosition,
  estimateMenuHeight,
  isSameMenuPosition,
  type MenuEntryKind,
  type MenuPosition,
} from '../../utils/actionMenuLayout';

/** 클릭 가능한 메뉴 항목. `type` 생략 = 항목(기존 호출부 호환) */
export interface ActionMenuItem {
  type?: 'item';
  label: string;
  onClick: () => void;
  colorClass?: string;
  /** 라벨 앞 lucide 아이콘(장식, aria-hidden) — 이모지 대신 사용 */
  icon?: React.ReactNode;
  /** 지정되면 체크 항목: role="menuitemcheckbox" aria-checked + Check 표시 슬롯(미체크여도 자리 유지) */
  checked?: boolean;
  /** aria-disabled — 클릭 무시, ↑↓/Home/End 이동에서 건너뜀 */
  disabled?: boolean;
  /** true면 선택해도 메뉴를 닫지 않는다(체크 항목 연속 토글용) */
  keepOpen?: boolean;
}

/** 비포커스 그룹 헤더 — 다음 섹션/구분선 전까지의 항목을 role="group"으로 묶고 이름을 붙인다 */
export interface ActionMenuSection {
  type: 'section';
  label: string;
}

export interface ActionMenuSeparator {
  type: 'separator';
}

export type ActionMenuEntry = ActionMenuItem | ActionMenuSection | ActionMenuSeparator;

export function isActionMenuItem(entry: ActionMenuEntry): entry is ActionMenuItem {
  return entry.type === undefined || entry.type === 'item';
}

type IndexedItem = { item: ActionMenuItem; index: number };
type MenuBlock =
  | { kind: 'item'; entry: IndexedItem }
  | { kind: 'separator'; key: number }
  | { kind: 'group'; key: number; label: string; items: IndexedItem[] };

function buildBlocks(entries: ActionMenuEntry[]): MenuBlock[] {
  const blocks: MenuBlock[] = [];
  let group: Extract<MenuBlock, { kind: 'group' }> | null = null;
  entries.forEach((entry, index) => {
    if (entry.type === 'section') {
      group = { kind: 'group', key: index, label: entry.label, items: [] };
      blocks.push(group);
    } else if (entry.type === 'separator') {
      group = null;
      blocks.push({ kind: 'separator', key: index });
    } else if (group) {
      group.items.push({ item: entry, index });
    } else {
      blocks.push({ kind: 'item', entry: { item: entry, index } });
    }
  });
  return blocks;
}

const ItemContent: React.FC<{ item: ActionMenuItem }> = ({ item }) => (
  <>
    {item.checked !== undefined && (
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
        {item.checked && <Check className="h-4 w-4 text-primary-light" />}
      </span>
    )}
    {item.icon && (
      <span className="inline-flex shrink-0 [&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">
        {item.icon}
      </span>
    )}
    <span className="min-w-0">{item.label}</span>
  </>
);

interface ActionMenuProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  items: ActionMenuEntry[];
  onClose: () => void;
  header?: string;
  /** 데스크탑 패널 폭: sm=w-44(176px, 기본) / md=w-52(208px, 체크 항목·긴 라벨) */
  width?: 'sm' | 'md';
}

const MENU_WIDTH_PX = { sm: 176, md: 208 } as const;
const MENU_WIDTH_CLASS = { sm: 'w-44', md: 'w-52' } as const;
const MOBILE_BREAKPOINT = 768;

// Stage B 접근성: 데스크탑 = role="menu"/"menuitem", 모바일 바텀시트 = role="dialog"(aria-modal) 안의 menu.
// 열리면 첫 (활성) 항목에 포커스, ↑↓/Home/End 이동(disabled 건너뜀), Esc·닫기 버튼·Tab으로 닫으면 앵커 버튼으로 포커스 복귀.
// 항목 선택 시에는 "포커스가 메뉴 안에 있다가 사라진 경우(body)"에만 복귀한다 — 항목이 연 모달이
// 자기 입력칸에 autoFocus 했으면 그 포커스를 뺏지 않는다. 바깥 클릭으로 닫힐 때는 복귀하지 않는다.
// Stage D1: 위치는 렌더 직후(useLayoutEffect, 페인트 전) 패널을 실측해 utils/actionMenuLayout 으로 계산.
const ActionMenu: React.FC<ActionMenuProps> = ({ anchorRef, items, onClose, header, width = 'sm' }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const restoreFocusRef = useRef(false);
  const didInitialFocusRef = useRef(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < MOBILE_BREAKPOINT);
  const idPrefix = useId();

  const blocks = useMemo(() => buildBlocks(items), [items]);
  const kinds = useMemo<MenuEntryKind[]>(() => items.map(e => (isActionMenuItem(e) ? 'item' : e.type)), [items]);
  const estimatedHeight = estimateMenuHeight(kinds, !!header);
  // 높이에 영향을 주는 내용(종류·라벨)이 바뀔 때만 재측정 — items 배열 identity 변화로는 재계산하지 않는다
  const layoutKey = items.map(e => (e.type === 'separator' ? '-' : `${e.type ?? 'item'}:${e.label}`)).join('\n');

  const calcPosition = useCallback(() => {
    if (!anchorRef.current || isMobile) return;
    const rect = anchorRef.current.getBoundingClientRect();
    let panelWidth: number = MENU_WIDTH_PX[width];
    let panelHeight = estimatedHeight;
    const el = menuRef.current;
    if (el) {
      // maxHeight 로 잘려 있어도 자연 높이 = scrollHeight + 테두리
      const natural = el.scrollHeight + (el.offsetHeight - el.clientHeight);
      if (natural > 0) panelHeight = natural;
      if (el.offsetWidth > 0) panelWidth = el.offsetWidth;
    }
    const next = computeMenuPosition(
      { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
      { width: window.innerWidth, height: window.innerHeight },
      { width: panelWidth, height: panelHeight },
    );
    setPosition(prev => (isSameMenuPosition(prev, next) ? prev : next));
  }, [anchorRef, isMobile, width, estimatedHeight]);

  useLayoutEffect(() => {
    calcPosition();
  }, [calcPosition, layoutKey]);

  useEffect(() => {
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

  // 첫 활성 항목 초기 포커스 (데스크탑은 위치 계산 후 보이므로 position을 기다린다)
  useEffect(() => {
    if (didInitialFocusRef.current) return;
    if (!isMobile && !position) return;
    const first = itemRefs.current.find((b): b is HTMLButtonElement => !!b);
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
    // disabled 항목은 ref 가 null 로 등록되므로 자연히 건너뛴다
    const buttons = itemRefs.current.filter((b): b is HTMLButtonElement => !!b && b.isConnected);
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
    if (item.disabled) return;
    if (item.keepOpen) {
      item.onClick();
      return;
    }
    restoreFocusRef.current = true;
    onClose();
    item.onClick();
  };

  const menuLabel = header ?? '메뉴';
  const sectionId = (key: number) => `${idPrefix}-section-${key}`;

  const renderItem = ({ item, index }: IndexedItem, variant: 'desktop' | 'mobile') => {
    const layout = variant === 'desktop'
      ? 'flex items-center gap-2 w-full text-left px-3 py-2'
      : 'flex items-center gap-3 w-full text-left px-4 py-3 text-base rounded-lg';
    const state = item.disabled
      ? 'opacity-50 cursor-not-allowed focus:outline-none'
      : variant === 'desktop'
        ? 'hover:bg-gray-700 focus:outline-none focus-visible:bg-gray-700'
        : 'hover:bg-gray-700 focus:outline-none focus-visible:bg-gray-700 focus-visible:ring-2 focus-visible:ring-primary-light';
    const isCheckbox = item.checked !== undefined;
    return (
      <button
        key={index}
        ref={el => { itemRefs.current[index] = item.disabled ? null : el; }}
        type="button"
        role={isCheckbox ? 'menuitemcheckbox' : 'menuitem'}
        aria-checked={isCheckbox ? item.checked : undefined}
        aria-disabled={item.disabled || undefined}
        tabIndex={-1}
        onClick={() => selectItem(item)}
        className={`${layout} ${state} transition ${item.colorClass || 'text-white'}`}
      >
        <ItemContent item={item} />
      </button>
    );
  };

  const renderBlocks = (variant: 'desktop' | 'mobile') => {
    const sectionClass = variant === 'desktop'
      ? 'px-3 pt-2 pb-1 text-xs font-medium text-gray-500'
      : 'px-4 pt-3 pb-1 text-xs font-medium text-gray-500';
    const separatorClass = variant === 'desktop' ? 'my-1 h-px bg-gray-700' : 'my-1 mx-2 h-px bg-gray-700';
    return blocks.map(block => {
      if (block.kind === 'item') return renderItem(block.entry, variant);
      if (block.kind === 'separator') return <div key={block.key} role="separator" className={separatorClass} />;
      return (
        <div key={block.key} role="group" aria-labelledby={sectionId(block.key)}>
          <div id={sectionId(block.key)} role="presentation" className={sectionClass}>{block.label}</div>
          {block.items.map(entry => renderItem(entry, variant))}
        </div>
      );
    });
  };

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
          <div className="px-2 pb-3 max-h-[60dvh] overflow-y-auto" role="menu" aria-label={menuLabel}>
            {renderBlocks('mobile')}
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

  // Desktop: portal dropdown — 첫 렌더는 보이지 않게 그려 실측한 뒤(페인트 전) 위치를 잡는다
  const style: React.CSSProperties = position
    ? { top: position.top, left: position.left, maxHeight: position.maxHeight ?? undefined }
    : { top: 0, left: 0, visibility: 'hidden' };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={menuLabel}
      className={`fixed z-menu ${MENU_WIDTH_CLASS[width]} bg-gray-800 border border-gray-700 rounded-md shadow-lg text-sm ${position?.maxHeight != null ? 'overflow-y-auto' : ''}`}
      style={style}
      onKeyDown={handleMenuKeyDown}
    >
      {header && (
        <div role="presentation" className="px-3 py-2 text-xs text-gray-500 truncate border-b border-gray-700">{header}</div>
      )}
      {renderBlocks('desktop')}
    </div>,
    document.body
  );
};

export default ActionMenu;
