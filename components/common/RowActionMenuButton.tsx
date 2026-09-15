// components/common/RowActionMenuButton.tsx
// 표 행·모바일 카드의 "관리 메뉴" 아이콘 버튼 — 렌더 전용(Stage D1).
//   열림 상태·앵커 ref 를 스스로 소유하고 ActionMenu 를 띄운다(데스크탑 드롭다운 / 모바일 바텀시트).
//   래퍼 span 에서 click 전파를 막는다 — 버튼 클릭은 물론, 포털 메뉴 안의 클릭도 React 트리를 따라
//   행(tr/카드)의 onClick 으로 올라오기 때문. keydown 은 막지 않는다(document Esc 리스너 보존).

import React, { useCallback, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import ActionMenu, { type ActionMenuEntry } from './ActionMenu';

export interface RowActionMenuButtonProps {
  items: ActionMenuEntry[];
  /** aria-label (예: "삼성전자 관리 메뉴") */
  label: string;
  /** 메뉴 상단 비클릭 헤더(ActionMenu header) */
  header?: string;
  className?: string;
  /** md = 최소 36×36(기본) / sm = 최소 32×32 */
  size?: 'sm' | 'md';
  /** ActionMenu 데스크탑 패널 폭 */
  menuWidth?: 'sm' | 'md';
}

const SIZE_CLASS = {
  sm: 'min-h-8 min-w-8',
  md: 'min-h-9 min-w-9',
} as const;

const RowActionMenuButton: React.FC<RowActionMenuButtonProps> = ({
  items,
  label,
  header,
  className = '',
  size = 'md',
  menuWidth,
}) => {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  return (
    <span className="inline-flex" onClick={e => e.stopPropagation()}>
      <button
        ref={anchorRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className={`focus-ring inline-flex items-center justify-center rounded-md text-gray-300 transition-colors hover:bg-gray-700 hover:text-white ${SIZE_CLASS[size]} ${className}`}
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </button>
      {open && (
        <ActionMenu anchorRef={anchorRef} items={items} onClose={close} header={header} width={menuWidth} />
      )}
    </span>
  );
};

export default RowActionMenuButton;
