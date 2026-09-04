// components/common/Badge.tsx
// P6 공용 배지 — 등급/상태 표시용 작은 pill. tone은 tailwind.config.ts의 시맨틱 토큰과 1:1 대응.
// 렌더 전용, 상태 없음.

import React from 'react';

export type BadgeTone = 'positive' | 'negative' | 'warning' | 'info' | 'neutral';
export type BadgeSize = 'sm' | 'md';

const TONE_CLASSES: Record<BadgeTone, string> = {
  positive: 'bg-positive-soft text-positive',
  negative: 'bg-negative-soft text-negative',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-info-soft text-info',
  neutral: 'bg-gray-700/60 text-gray-300',
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'text-[10px] px-1.5 py-0.5',
  md: 'text-xs px-2 py-0.5',
};

export interface BadgeProps {
  tone?: BadgeTone;
  size?: BadgeSize;
  children: React.ReactNode;
  className?: string;
  title?: string;
}

const Badge: React.FC<BadgeProps> = ({ tone = 'neutral', size = 'sm', children, className = '', title }) => (
  <span
    title={title}
    className={`inline-flex items-center rounded font-medium whitespace-nowrap ${TONE_CLASSES[tone]} ${SIZE_CLASSES[size]} ${className}`}
  >
    {children}
  </span>
);

export default Badge;
