// components/common/SortableTh.tsx
// 정렬 가능한 표 헤더 셀 — 렌더 전용(Stage D1).
//   <th scope="col" aria-sort> 안에 실제 <button type="button" .focus-ring> 을 두어 키보드로 정렬한다.
//   · 활성 = activeKey === sortKey 이거나 ariaSortKeys 에 포함(수익률 4상태 정렬처럼 한 헤더가 여러 키를 도는 경우)
//   · 아이콘: 활성 ArrowUp/ArrowDown, 비활성 ArrowUpDown(opacity-30) — 기존 PortfolioTable/WatchlistPage 관례
//   · overflow 래퍼를 만들지 않는다(sticky thead 보존) — sticky/배경/z 클래스는 호출부가 className 으로 준다
//   · children(예: ColumnResizeHandle)은 버튼 밖, th 의 직계 자식으로 렌더(핸들이 parentElement=th 를 잰다)
//     → absolute 핸들을 쓰면 호출부 className 에 `relative`(또는 sticky) 포함

import React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import Tooltip from './Tooltip';

export type SortableThDirection = 'asc' | 'desc';

export interface SortableThProps {
  label: React.ReactNode;
  sortKey: string;
  activeKey: string | null;
  direction: SortableThDirection | null;
  onSort: (key: string) => void;
  className?: string;
  align?: 'left' | 'right' | 'center';
  /** 헤더 설명 — 공용 Tooltip 으로 버튼을 감싼다 */
  tooltip?: React.ReactNode;
  tooltipPosition?: 'top' | 'bottom' | 'left' | 'right';
  /** 버튼 네이티브 title (예: "현재가 정렬 (한 번 더 누르면 역순)") */
  title?: string;
  /** th 직계 자식으로 버튼 뒤에 렌더 (ColumnResizeHandle 등) */
  children?: React.ReactNode;
  /** sortKey 외에 이 헤더를 활성으로 볼 키들 */
  ariaSortKeys?: readonly string[];
  style?: React.CSSProperties;
  thProps?: Omit<React.ThHTMLAttributes<HTMLTableCellElement>, 'scope' | 'aria-sort' | 'className' | 'style' | 'children'>;
}

const ALIGN_CLASS = {
  left: 'justify-start text-left',
  right: 'justify-end text-right',
  center: 'justify-center text-center',
} as const;

const SortableTh: React.FC<SortableThProps> = ({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  className,
  align = 'left',
  tooltip,
  tooltipPosition = 'bottom',
  title,
  children,
  ariaSortKeys,
  style,
  thProps,
}) => {
  const active = activeKey !== null && (activeKey === sortKey || (ariaSortKeys?.includes(activeKey) ?? false));
  const sorted = active && direction !== null;
  const ariaSort = sorted ? (direction === 'asc' ? 'ascending' : 'descending') : 'none';

  const icon = sorted
    ? direction === 'asc'
      ? <ArrowUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      : <ArrowDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    : <ArrowUpDown className="h-3.5 w-3.5 shrink-0 opacity-30" aria-hidden="true" />;

  const button = (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      title={title}
      className={`focus-ring flex w-full items-center gap-2 rounded-sm [text-transform:inherit] ${ALIGN_CLASS[align]}`}
    >
      {label}
      {icon}
    </button>
  );

  return (
    <th {...thProps} scope="col" aria-sort={ariaSort} className={className} style={style}>
      {tooltip ? (
        <Tooltip content={tooltip} position={tooltipPosition} wrap className="w-full">
          {button}
        </Tooltip>
      ) : button}
      {children}
    </th>
  );
};

export default SortableTh;
