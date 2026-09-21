// components/common/Card.tsx
// P6 공용 카드 — 설정/홈 등 새 표면이 공유하는 컨테이너. variant는 표면 위계만 바꾸고,
// collapsible은 `components/dashboard/ProfitLossChart.tsx`/`ReferenceIndicatorsSection.tsx`의
// 기존 접이식 패턴(localStorage 키에 'true'/'false' 문자열로 펼침 상태 영속)을 그대로 재사용한다 — 렌더 전용.
//
// Stage C 규약
//   · 카드에는 그림자를 쓰지 않는다(그림자는 모달·메뉴 같은 오버레이 전용) → `elevated`는 default와 동일.
//   · 접힌 상태에서도 헤더의 `summary`(건수 등)와 `actions`는 보인다 — 신호/건수를 접힘 뒤에 숨기지 않는다.
//   · 기본 `clip`(overflow-hidden). **sticky thead 표는 Card로 감싸지 말 것** — overflow 조상이 생기면
//     sticky가 깨진다(RULES.md §8). 부득이 감쌀 때는 `clip={false}`.
//   · `toolbar`(선택) — 제목 행 **아래** 줄에 flex-wrap으로 렌더되는 넓은 컨트롤 묶음(필터·기간 버튼 등).
//     `actions`는 `shrink-0`이라 넓은 컨트롤을 넣으면 제목이 0폭으로 눌려 한 글자씩 세로로 쌓인다
//     (홈 손익 추이 카드 버그) → 넓은 컨트롤은 toolbar, actions는 칩·아이콘 버튼처럼 짧은 것만.
//     toolbar도 접혀 있어도 보인다(actions와 같은 계약).

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export type CardVariant =
  | 'default'
  /** @deprecated Stage C — 카드 그림자 폐지로 default와 동일하게 렌더된다 */
  | 'elevated'
  | 'muted';

const VARIANT_CLASSES: Record<CardVariant, string> = {
  default: 'bg-surface-elevated border border-border-subtle',
  elevated: 'bg-surface-elevated border border-border-subtle',
  muted: 'bg-surface-muted border border-border-subtle',
};

export interface CardProps {
  variant?: CardVariant;
  /** 헤더 좌측 — 문자열이면 기본 타이포(text-base font-semibold)로, 커스텀 노드도 허용 */
  title?: React.ReactNode;
  /** 제목 아래 1~2줄 설명 (선택). collapsible이면 토글 버튼 안에 들어가므로 인터랙티브 요소 금지 */
  description?: React.ReactNode;
  /** 헤더 우측 요약(건수·상태 등) — 접혀 있어도 표시. 토글 버튼 밖에 렌더 */
  summary?: React.ReactNode;
  /** 헤더 우측 — 버튼/뱃지 등. 접혀 있어도 표시 */
  actions?: React.ReactNode;
  /** 제목 행 아래 줄(flex-wrap) — 필터·기간 선택처럼 넓은 컨트롤. 접혀 있어도 표시 */
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** 접이식 — localStorage 키를 주면 펼침 상태가 영속된다(ProfitLossChart 패턴과 동일) */
  collapsible?: boolean;
  storageKey?: string;
  /** 저장값이 없을 때(최초 진입) 접힘으로 시작할지 */
  defaultCollapsed?: boolean;
  /** 기본 true — 루트 overflow-hidden. 내부 요소가 카드 밖으로 나가야 하면 false */
  clip?: boolean;
}

const Card: React.FC<CardProps> = ({
  variant = 'default',
  title,
  description,
  summary,
  actions,
  toolbar,
  children,
  className = '',
  bodyClassName = '',
  collapsible = false,
  storageKey,
  defaultCollapsed = false,
  clip = true,
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
  const hasSummary = summary !== undefined && summary !== null;
  const hasToolbar = toolbar !== undefined && toolbar !== null && toolbar !== false;
  const hasHeader = !!title || !!actions || hasSummary || hasToolbar;

  return (
    <div className={`rounded-card ${clip ? 'overflow-hidden' : ''} ${VARIANT_CLASSES[variant]} ${className}`}>
      {hasHeader && (
        <div className={`px-4 py-3.5 ${bodyVisible ? 'border-b border-border-subtle' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          {collapsible ? (
            <button
              type="button"
              onClick={toggleOpen}
              className="flex items-start gap-2 min-w-0 text-left flex-1 rounded-md focus-ring"
              aria-expanded={open}
            >
              <ChevronDown
                aria-hidden="true"
                className={`h-4 w-4 text-gray-400 shrink-0 mt-1 transition-transform ${open ? '' : '-rotate-90'}`}
              />
              <span className="min-w-0">
                <span className="block text-base font-semibold text-white">{title}</span>
                {description && <span className="block text-xs text-gray-400 mt-0.5 leading-relaxed">{description}</span>}
              </span>
            </button>
          ) : (
            <div className="min-w-0 flex-1">
              {title && <div className="text-base font-semibold text-white">{title}</div>}
              {description && <div className="text-xs text-gray-400 mt-0.5 leading-relaxed">{description}</div>}
            </div>
          )}
          {hasSummary && (
            <div className="shrink-0 flex items-center gap-1.5 text-xs text-gray-400 mt-0.5">{summary}</div>
          )}
          {actions && <div className="shrink-0 flex items-center gap-1.5">{actions}</div>}
        </div>
        {hasToolbar && <div className="mt-2.5 flex flex-wrap items-center gap-2 min-w-0">{toolbar}</div>}
        </div>
      )}
      {bodyVisible && <div className={`p-4 ${bodyClassName}`}>{children}</div>}
    </div>
  );
};

export default Card;
