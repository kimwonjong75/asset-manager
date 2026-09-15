// components/common/Badge.tsx
// P6 공용 배지 — 등급/상태 표시용 작은 pill. tone은 tailwind.config.ts의 시맨틱 토큰과 1:1 대응.
// 렌더 전용, 상태 없음.
//
// Stage B 색 규약(RULES.md §8): up=오름·이익·매수(빨강) / down=내림·손실·매도(파랑) /
// ok=성공 상태 / warning=위험·확인(주황, 문구와 함께) / danger=삭제·오류(핑크) / info / neutral.
// tone 'positive'·'negative' 는 옛 호출부 호환용 이름 별칭(클래스는 ok/warning 토큰으로 매핑) — 신규 코드 금지.
// Tailwind 색 별칭(text-positive 등)은 Stage C 게이트에서 삭제됐다.

import React from 'react';

export type BadgeTone =
  | 'up'
  | 'down'
  | 'ok'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral'
  /** @deprecated → 'ok' (성공 상태) 또는 'up' (오름·이익) */
  | 'positive'
  /** @deprecated → 'warning' (위험·긴급) 또는 'down' (내림·손실) */
  | 'negative';
export type BadgeSize = 'sm' | 'md';

const TONE_CLASSES: Record<BadgeTone, string> = {
  up: 'bg-up-soft text-up',
  down: 'bg-down-soft text-down',
  ok: 'bg-ok-soft text-ok',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  neutral: 'bg-gray-700/60 text-gray-300',
  positive: 'bg-ok-soft text-ok',
  negative: 'bg-warning-soft text-warning',
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'text-xs px-1.5 py-0.5',
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
