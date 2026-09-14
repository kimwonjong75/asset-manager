// components/common/ScopeChip.tsx
// 계산 범위 칩 — 홈 카드마다 "이 숫자가 어떤 범위로 계산됐는지"(계정 필터 적용/전체 계정 기준 등)를
// 제목 옆에 짧게 표시한다. 렌더 전용. tone='warning'은 화면의 계정 선택을 따르지 않는 카드용.

import React from 'react';

export type ScopeChipTone = 'neutral' | 'warning';

export interface ScopeChipProps {
  label: string;
  tone?: ScopeChipTone;
  /** 마우스 오버 설명(네이티브 title) */
  title?: string;
  className?: string;
}

const TONE_CLASSES: Record<ScopeChipTone, string> = {
  neutral: 'border-border-subtle bg-surface-muted text-gray-400',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
};

const ScopeChip: React.FC<ScopeChipProps> = ({ label, tone = 'neutral', title, className = '' }) => (
  <span
    title={title}
    className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-normal leading-tight ${TONE_CLASSES[tone]} ${className}`}
  >
    {label}
  </span>
);

export default ScopeChip;
