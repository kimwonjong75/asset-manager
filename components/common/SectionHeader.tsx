// components/common/SectionHeader.tsx
// P6 공용 섹션 헤더 — "■ 긴급 (3건)" 류의 today/*Section 헤더를 표준화한다. 제목+건수 뱃지+
// (선택) 접기 화살표만 렌더한다 — 접힘/펼침 상태 자체는 호출부가 들고 있다(TierRowList 등
// today/* 컴포넌트가 이미 그렇게 설계돼 있음 — 이 컴포넌트는 그 상태를 받아 그리기만 한다).

import React from 'react';
import { ChevronDown } from 'lucide-react';
import Badge, { type BadgeTone } from './Badge';

// Stage B 색 규약 — 긴급/위험은 warning(주황). 빨강(up)·파랑(down)은 가격 방향 전용이라 헤더에는 쓰지 않는다.
const TITLE_COLOR: Record<BadgeTone, string> = {
  up: 'text-up',
  down: 'text-down',
  ok: 'text-emerald-300',
  warning: 'text-amber-300',
  danger: 'text-danger',
  info: 'text-sky-300',
  neutral: 'text-gray-200',
  positive: 'text-emerald-300',
  negative: 'text-amber-300',
};

export interface SectionHeaderProps {
  title: string;
  /** 건수 뱃지 — undefined면 뱃지 미표시 */
  count?: number;
  /** 건수 뱃지 뒤에 붙는 단위(기본 '건') */
  countUnit?: string;
  /** 제목 색 + 뱃지 톤 (등급 색상: urgent=warning+icon, today=ok, prepare=warning) */
  tone?: BadgeTone;
  /** 제목 앞 아이콘(lucide). 같은 톤의 섹션을 구분할 때 — 예: 긴급=OctagonAlert */
  icon?: React.ReactNode;
  /** 접기 가능이면 화살표 표시 + 클릭 가능 헤더로 렌더 */
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
  /** 우측 보조 콘텐츠 (버튼 등) */
  actions?: React.ReactNode;
  className?: string;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  count,
  countUnit = '건',
  tone = 'neutral',
  icon,
  collapsible = false,
  open = true,
  onToggle,
  actions,
  className = '',
}) => {
  const content = (
    <span className="flex items-center gap-2">
      {collapsible && (
        <ChevronDown className={`h-3.5 w-3.5 text-gray-500 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
      )}
      {icon && <span className="inline-flex shrink-0">{icon}</span>}
      <span>{title}</span>
      {count !== undefined && (
        <Badge tone={tone}>
          {count}
          {countUnit}
        </Badge>
      )}
    </span>
  );

  return (
    <div className={`flex items-center justify-between gap-2 flex-wrap ${className}`}>
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={`flex items-center text-sm font-semibold hover:opacity-80 transition-opacity ${TITLE_COLOR[tone]}`}
        >
          {content}
        </button>
      ) : (
        <h2 className={`flex items-center text-sm font-semibold ${TITLE_COLOR[tone]}`}>{content}</h2>
      )}
      {actions && <div className="flex items-center gap-1.5">{actions}</div>}
    </div>
  );
};

export default SectionHeader;
