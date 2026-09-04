// components/common/Card.tsx
// P6 공용 카드 — 설정/오늘 화면 등 새 표면이 공유하는 컨테이너. variant는 표면 위계만 바꾸고,
// collapsible은 `components/dashboard/ProfitLossChart.tsx`/`ReferenceIndicatorsSection.tsx`의
// 기존 접이식 패턴(localStorage 키에 펼침 상태 영속)을 그대로 재사용한다 — 렌더 전용.

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export type CardVariant = 'default' | 'elevated' | 'muted';

const VARIANT_CLASSES: Record<CardVariant, string> = {
  default: 'bg-surface-elevated border border-border-subtle',
  elevated: 'bg-surface-elevated border border-border-subtle shadow-lg',
  muted: 'bg-surface-muted border border-border-subtle',
};

export interface CardProps {
  variant?: CardVariant;
  /** 헤더 좌측 — 문자열이면 기본 타이포로, 커스텀 노드도 허용(예: 뱃지 동반 제목) */
  title?: React.ReactNode;
  /** 제목 아래 1~2줄 설명 (선택) */
  description?: React.ReactNode;
  /** 헤더 우측 — 버튼/뱃지 등 */
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** 접이식 — localStorage 키를 주면 펼침 상태가 영속된다(ProfitLossChart 패턴과 동일) */
  collapsible?: boolean;
  storageKey?: string;
  /** 저장값이 없을 때(최초 진입) 접힘으로 시작할지 */
  defaultCollapsed?: boolean;
}

const Card: React.FC<CardProps> = ({
  variant = 'default',
  title,
  description,
  actions,
  children,
  className = '',
  bodyClassName = '',
  collapsible = false,
  storageKey,
  defaultCollapsed = false,
}) => {
  const [open, setOpen] = useState<boolean>(() => {
    if (!collapsible) return true;
    try {
      const stored = storageKey ? localStorage.getItem(storageKey) : null;
      if (stored === 'true') return true;
      if (stored === 'false') return false;
    } catch {
      /* ignore */
    }
    return !defaultCollapsed;
  });
  const toggleOpen = () =>
    setOpen(prev => {
      const next = !prev;
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, String(next));
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  const bodyVisible = !collapsible || open;
  const hasHeader = !!title || !!actions;

  return (
    <div className={`rounded-card overflow-hidden ${VARIANT_CLASSES[variant]} ${className}`}>
      {hasHeader && (
        <div
          className={`flex items-start justify-between gap-2 px-4 py-3.5 ${
            bodyVisible ? 'border-b border-border-subtle' : ''
          }`}
        >
          {collapsible ? (
            <button
              type="button"
              onClick={toggleOpen}
              className="flex items-start gap-2 min-w-0 text-left flex-1"
              aria-expanded={open}
            >
              <ChevronDown
                className={`h-4 w-4 text-gray-400 shrink-0 mt-0.5 transition-transform ${open ? '' : '-rotate-90'}`}
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-white">{title}</span>
                {description && <span className="block text-xs text-gray-400 mt-0.5 leading-relaxed">{description}</span>}
              </span>
            </button>
          ) : (
            <div className="min-w-0 flex-1">
              {title && <div className="text-sm font-semibold text-white">{title}</div>}
              {description && <div className="text-xs text-gray-400 mt-0.5 leading-relaxed">{description}</div>}
            </div>
          )}
          {actions && <div className="shrink-0 flex items-center gap-1.5">{actions}</div>}
        </div>
      )}
      {bodyVisible && <div className={`p-4 ${bodyClassName}`}>{children}</div>}
    </div>
  );
};

export default Card;
