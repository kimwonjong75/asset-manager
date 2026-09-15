// components/common/Combobox.tsx
// Stage D2 P0 공용 콤보박스(검색 자동완성) — 렌더 전용, 제네릭. 검색·결과·로딩 상태는 호출부(훅)가 소유하고
// 이 컴포넌트는 입력칸 + 포털 목록 + 키보드/포인터/ARIA 만 담당한다.
//
// 계약
//   · 보임 = open(호출부 조건) && !dismissed && 입력칸 포커스 && !disabled && 그릴 내용 있음.
//     dismissed 는 Esc·옵션 선택·blur 에서 켜지고, **사용자가 입력값을 바꾸면**(onChange) 또는 ↓/↑ 로 다시 열면 꺼진다.
//     (선택 후 호출부가 입력값을 선택 라벨로 바꾸는 프로그램적 변경으로는 다시 열리지 않는다.)
//     동작 행(actions)을 고르면 닫지 않는다 — 새로 받기·AI 검색처럼 결과를 같은 목록에서 이어 보여 주는 동작용.
//   · ARIA: input role="combobox" aria-expanded aria-controls(보일 때) aria-autocomplete="list"
//     aria-activedescendant. 포털 목록 role="listbox"(aria-modal 없음) 안에 옵션 그룹 + 동작 그룹(role="option" 행 —
//     버튼 아님). 활성 행 aria-selected="true". 로딩·빈 결과·오류·안내는 listbox 밖 형제 role="status" 영역.
//   · 키보드: utils/listboxNavigation.resolveComboboxKey. ↓↑ 순환(disabled 동작 건너뜀), Enter(활성 있을 때만 선택 —
//     없으면 폼 제출 그대로), Esc(보일 때 닫고 preventDefault → 바깥 Modal 의 document Esc 리스너가 무시),
//     Tab(닫고 포커스 정상 이동), Home/End(활성 있을 때만). 한글 IME 조합 중 키는 처리하지 않는다.
//   · 포인터: 패널 onPointerDown 이 "안쪽" 플래그, onMouseDown preventDefault 로 입력칸 포커스 유지, click 으로 선택.
//     blur 는 플래그가 없을 때만 닫는다(150ms 지연 해킹 불필요). 바깥 pointerdown(capture)이 플래그를 해제.
//   · 위치: 포털(body) `fixed z-menu`, 폭 = 앵커(입력칸 래퍼) 폭, 최대 높이 18rem(max-h-72).
//     렌더 직후 실측 → utils/popoverLayout(Popover.useAnchoredPosition 공유), scroll(capture)·resize·visualViewport 재계산.
//   · 오버레이라 그림자(shadow-lg) 허용.
//   · inputClassName 을 넘기면 기본 입력칸 클래스를 **대체**한다(endAdornment 가 있으면 오른쪽 패딩 확보는 호출부 몫).

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, Loader2 } from 'lucide-react';
import { nextActiveIndex, resolveComboboxKey } from '../../utils/listboxNavigation';
import { useAnchoredPosition } from './Popover';

export interface ComboboxAction {
  key: string;
  label: React.ReactNode;
  /** 라벨 앞 lucide 아이콘(장식, aria-hidden) */
  icon?: React.ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}

export interface ComboboxProps<T> {
  inputId: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  /** 입력칸 오른쪽 안쪽(스피너·지우기 버튼 등) */
  endAdornment?: React.ReactNode;
  options: readonly T[];
  getOptionKey: (option: T) => string;
  renderOption: (option: T, state: { active: boolean }) => React.ReactNode;
  onSelect: (option: T) => void;
  /** 호출부의 기존 표시 조건(예: 검색어 있음 && (결과 있음 || 검색 중)) */
  open: boolean;
  loading?: boolean;
  /** 기본 '검색 중…' */
  loadingText?: React.ReactNode;
  error?: React.ReactNode;
  /** 옵션 0개일 때 문구. 생략하면 빈 행을 그리지 않는다 */
  emptyText?: React.ReactNode;
  /** 목록 위 안내(예: 종목 목록 수신 중) */
  notice?: React.ReactNode;
  /** 옵션 아래 두 번째 그룹의 동작 행(role="option") */
  actions?: readonly ComboboxAction[];
  inputClassName?: string;
  className?: string;
  autoFocus?: boolean;
  /** listbox 접근성 이름. 기본 '검색 결과' */
  listboxLabel?: string;
}

type NavItem<T> =
  | { kind: 'option'; key: string; option: T }
  | { kind: 'action'; key: string; action: ComboboxAction };

const DEFAULT_INPUT_CLASS =
  'w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition disabled:opacity-50 disabled:cursor-not-allowed aria-[invalid=true]:border-danger';

const PANEL_MAX_HEIGHT_REM = 18; // max-h-72

function hasNode(node: React.ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

function Combobox<T>({
  inputId,
  inputValue,
  onInputChange,
  placeholder,
  disabled = false,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  endAdornment,
  options,
  getOptionKey,
  renderOption,
  onSelect,
  open,
  loading = false,
  loadingText,
  error,
  emptyText,
  notice,
  actions = [],
  inputClassName,
  className = '',
  autoFocus,
  listboxLabel = '검색 결과',
}: ComboboxProps<T>): React.JSX.Element {
  const anchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pointerInsideRef = useRef(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const listboxId = useId();

  const items: NavItem<T>[] = [
    ...options.map(option => ({ kind: 'option' as const, key: `o:${getOptionKey(option)}`, option })),
    ...actions.map(action => ({ kind: 'action' as const, key: `a:${action.key}`, action })),
  ];
  const disabledFlags = items.map(item => item.kind === 'action' && item.action.disabled === true);

  const showError = hasNode(error);
  const showEmpty = hasNode(emptyText) && options.length === 0 && !loading && !showError;
  const showNotice = hasNode(notice);
  const hasStatus = loading || showError || showEmpty || showNotice;
  const visible = open && !dismissed && focused && !disabled && (items.length > 0 || hasStatus);
  // 활성 행은 key 로 기억 — 결과가 바뀌어도 같은 항목을 가리키고, 사라지면 자동으로 -1
  const activeIndex = visible ? items.findIndex(item => item.key === activeKey) : -1;
  const itemId = (index: number) => `${listboxId}-${index}`;

  const position = useAnchoredPosition({
    active: visible,
    anchorRef,
    panelRef,
    align: 'start',
    matchAnchorWidth: true,
    maxHeightRem: PANEL_MAX_HEIGHT_REM,
  });

  // 바깥 pointerdown — "안쪽" 플래그 해제. 포커스가 이미 입력칸을 떠났다면(터치에서 blur 를 무시한 뒤) 여기서 닫는다
  useEffect(() => {
    if (!visible) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      pointerInsideRef.current = false;
      if (target instanceof Node && anchorRef.current?.contains(target)) return;
      if (document.activeElement !== inputRef.current) {
        setFocused(false);
        setDismissed(true);
        setActiveKey(null);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [visible]);

  // 키보드로 옮긴 활성 행을 목록 스크롤 안으로
  useLayoutEffect(() => {
    if (!visible || activeIndex < 0) return;
    document.getElementById(`${listboxId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [visible, activeIndex, listboxId]);

  const moveTo = (index: number) => {
    setActiveKey(index >= 0 ? (items[index]?.key ?? null) : null);
  };

  const commit = (item: NavItem<T> | undefined) => {
    if (!item) return;
    pointerInsideRef.current = false;
    if (item.kind === 'action') {
      if (item.action.disabled) return;
      item.action.onSelect();
      return;
    }
    setDismissed(true);
    setActiveKey(null);
    onSelect(item.option);
  };

  const handlePointerCommit = (item: NavItem<T>) => {
    commit(item);
    // 터치 기기에서 blur 를 무시했는데 포커스가 실제로 떠나 있으면 목록을 남겨 두지 않는다
    if (document.activeElement !== inputRef.current) {
      setFocused(false);
      setDismissed(true);
      setActiveKey(null);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDismissed(false);
    setActiveKey(null);
    onInputChange(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    pointerInsideRef.current = false;
    if (e.nativeEvent.isComposing) {
      // 조합 중 Esc 는 조합 취소용 — 목록이 보이면 바깥 Modal 이 닫히지 않게만 막는다
      if (e.key === 'Escape' && visible) e.preventDefault();
      return;
    }
    const { intent, preventDefault } = resolveComboboxKey({
      key: e.key,
      open: visible,
      activeIndex,
      optionCount: items.length,
    });
    if (preventDefault) e.preventDefault();
    const nav = { disabled: disabledFlags };
    switch (intent) {
      case 'open':
        setDismissed(false);
        break;
      case 'move-next':
        moveTo(nextActiveIndex(activeIndex, 1, nav));
        break;
      case 'move-prev':
        moveTo(nextActiveIndex(activeIndex, -1, nav));
        break;
      case 'first':
        moveTo(nextActiveIndex(activeIndex, 'first', nav));
        break;
      case 'last':
        moveTo(nextActiveIndex(activeIndex, 'last', nav));
        break;
      case 'select':
        commit(items[activeIndex]);
        break;
      case 'close':
        setDismissed(true);
        setActiveKey(null);
        break;
      case 'none':
        break;
    }
  };

  const handleBlur = () => {
    if (pointerInsideRef.current) return;
    setFocused(false);
    setDismissed(true);
    setActiveKey(null);
  };

  const rowClass = (active: boolean, rowDisabled: boolean) =>
    `px-3 py-2 ${rowDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${active ? 'bg-surface-muted' : ''}`;

  const renderItem = (item: NavItem<T>, index: number) => {
    const active = index === activeIndex;
    if (item.kind === 'option') {
      return (
        <div
          key={item.key}
          id={itemId(index)}
          role="option"
          aria-selected={active}
          className={`${rowClass(active, false)} text-gray-200`}
          onMouseMove={() => {
            if (!active) setActiveKey(item.key);
          }}
          onClick={() => handlePointerCommit(item)}
        >
          {renderOption(item.option, { active })}
        </div>
      );
    }
    const rowDisabled = item.action.disabled === true;
    return (
      <div
        key={item.key}
        id={itemId(index)}
        role="option"
        aria-selected={active}
        aria-disabled={rowDisabled || undefined}
        className={`${rowClass(active, rowDisabled)} flex items-center gap-2 text-gray-200`}
        onMouseMove={() => {
          if (!active && !rowDisabled) setActiveKey(item.key);
        }}
        onClick={() => handlePointerCommit(item)}
      >
        {item.action.icon && (
          <span className="inline-flex shrink-0 [&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">
            {item.action.icon}
          </span>
        )}
        <span className="min-w-0">{item.action.label}</span>
      </div>
    );
  };

  const optionItems = items.slice(0, options.length);
  const actionItems = items.slice(options.length);

  const panelStyle: React.CSSProperties = position
    ? { top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight ?? undefined }
    : { top: 0, left: 0, visibility: 'hidden' };

  const panel = visible
    ? createPortal(
        <div
          ref={panelRef}
          className="fixed z-menu max-h-72 overflow-y-auto bg-surface-elevated border border-border-subtle rounded-md shadow-lg text-sm"
          style={panelStyle}
          onPointerDown={() => {
            pointerInsideRef.current = true;
          }}
          onMouseDown={e => e.preventDefault()}
        >
          {hasStatus && (
            <div role="status" className={items.length > 0 ? 'border-b border-border-subtle' : ''}>
              {showNotice && <div className="px-3 py-2 text-xs text-gray-400">{notice}</div>}
              {loading && (
                <div className="flex items-center gap-2 px-3 py-2 text-gray-400">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                  <span className="min-w-0">{loadingText ?? '검색 중…'}</span>
                </div>
              )}
              {showError && (
                <div className="flex items-start gap-1.5 px-3 py-2 text-danger">
                  <CircleAlert className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0">{error}</span>
                </div>
              )}
              {showEmpty && <div className="px-3 py-2 text-gray-400">{emptyText}</div>}
            </div>
          )}
          {items.length > 0 && (
            <div role="listbox" id={listboxId} aria-label={listboxLabel}>
              {optionItems.length > 0 && (
                <div role="group" aria-label="결과 목록">
                  {optionItems.map((item, i) => renderItem(item, i))}
                </div>
              )}
              {actionItems.length > 0 && (
                <div
                  role="group"
                  aria-label="추가 동작"
                  className={optionItems.length > 0 ? 'border-t border-border-subtle' : ''}
                >
                  {actionItems.map((item, i) => renderItem(item, options.length + i))}
                </div>
              )}
            </div>
          )}
        </div>,
        document.body,
      )
    : null;

  const inputClass = inputClassName ?? `${DEFAULT_INPUT_CLASS}${endAdornment ? ' pr-10' : ''}`;

  return (
    <>
      <div ref={anchorRef} className={`relative ${className}`}>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={visible}
          aria-controls={visible && items.length > 0 ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? itemId(activeIndex) : undefined}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          autoComplete="off"
          autoFocus={autoFocus}
          value={inputValue}
          placeholder={placeholder}
          disabled={disabled}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          className={inputClass}
        />
        {endAdornment && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3">{endAdornment}</div>
        )}
      </div>
      {panel}
    </>
  );
}

export default Combobox;
