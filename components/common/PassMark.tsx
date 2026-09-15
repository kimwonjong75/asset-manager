// components/common/PassMark.tsx
// Stage C 공용 충족 표시 — ✓/✗/– 글리프·이모지 대신 lucide 아이콘 + 스크린리더 문구. 렌더 전용.
//   pass = Check(text-ok) · fail = X(text-flat) · unknown = Minus(text-gray-500)
// 미충족을 빨강/파랑으로 칠하지 않는다 — 빨강·파랑은 가격 방향 전용(RULES.md §8 색 규약).

import React from 'react';
import { Check, Minus, X } from 'lucide-react';

export type PassMarkState = 'pass' | 'fail' | 'unknown';

export interface PassMarkProps {
  state: PassMarkState;
  /** 주면 아이콘 옆에 보이는 라벨로 렌더(sr-only 기본 문구 대신) */
  label?: string;
  size?: 'sm' | 'md';
  className?: string;
}

const STATE_META: Record<PassMarkState, { Icon: typeof Check; color: string; srText: string }> = {
  pass: { Icon: Check, color: 'text-ok', srText: '충족' },
  fail: { Icon: X, color: 'text-flat', srText: '미충족' },
  unknown: { Icon: Minus, color: 'text-gray-500', srText: '판단 불가' },
};

const PassMark: React.FC<PassMarkProps> = ({ state, label, size = 'md', className = '' }) => {
  const { Icon, color, srText } = STATE_META[state];
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  return (
    <span className={`inline-flex items-center gap-1 ${color} ${className}`}>
      <Icon className={`${iconSize} shrink-0`} aria-hidden="true" />
      {label ? (
        <span className={size === 'sm' ? 'text-xs' : 'text-sm'}>{label}</span>
      ) : (
        <span className="sr-only">{srText}</span>
      )}
    </span>
  );
};

export default PassMark;
