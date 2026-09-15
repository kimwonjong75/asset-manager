// components/common/Button.tsx
// Stage B 공용 버튼 — 렌더 전용, 상태 없음.
//
// 규칙 (RULES.md §8 색 규약과 함께 읽을 것)
//   · 카드/모달 하나에 primary 는 1개. 나머지는 secondary 또는 ghost.
//   · 크기는 md(최소 36px) / lg(최소 44px) 두 가지뿐 — 작은 버튼(px-2 py-0.5)의 재발을 막는다.
//   · primary 채움은 primary-dark(#4F46E5, 흰 글자 6.29). #6366F1 은 4.47로 AA 미달.
//   · warning: 위험/확인 성격의 동작("등록했어요" 등) — 주황. 토큰만 사용(raw amber 금지, Stage D2).
//     글자 text-warning 대비: warning-soft 위 #121212 6.77 / #1E1E1E 5.89 / #2C2C2C 4.92.
//     hover 는 배경을 진하게 하지 않고 테두리만 강조한다 — warning/20 배경은 #2C2C2C 위 4.43으로 AA 미달.
//   · danger: 삭제·로그아웃 전용 — 핑크 채움(#BE185D, 흰 글자 6.04). **아이콘 필수(타입 강제)**.
//     빨강/파랑 채움 버튼은 만들지 않는다 — 빨강=오름·매수, 파랑=내림·매도와 뜻이 겹친다.
//     매도 제출 버튼도 primary + 명시 라벨("매도 실행")을 쓴다.

import React, { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'warning' | 'danger';
export type ButtonSize = 'md' | 'lg';

interface ButtonBaseProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  size?: ButtonSize;
  /** true 면 스피너 표시 + 비활성 + aria-busy */
  loading?: boolean;
  fullWidth?: boolean;
  /** 라벨 뒤 아이콘(예: ChevronRight·ExternalLink). 장식용 — aria-hidden */
  iconRight?: React.ReactNode;
  children?: React.ReactNode;
}

export type ButtonProps = ButtonBaseProps & (
  | { variant?: Exclude<ButtonVariant, 'danger'>; icon?: React.ReactNode }
  /** 파괴적 동작은 아이콘(휴지통·로그아웃 등)과 명시 라벨이 반드시 함께 */
  | { variant: 'danger'; icon: React.ReactNode }
);

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-primary-dark hover:bg-primary text-white border border-transparent',
  secondary: 'bg-surface-muted hover:bg-gray-600 text-gray-100 border border-border-subtle',
  ghost: 'bg-transparent hover:bg-gray-700/60 text-gray-300 hover:text-white border border-transparent',
  warning: 'bg-warning-soft text-warning border border-warning/30 hover:border-warning/60',
  danger: 'bg-danger-strong hover:bg-pink-800 text-white border border-transparent',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: 'min-h-9 px-3 text-sm',
  lg: 'min-h-11 px-4 text-base',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    icon,
    iconRight,
    loading = false,
    fullWidth = false,
    disabled,
    type = 'button',
    className = '',
    children,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-light focus-visible:ring-offset-1 focus-visible:ring-offset-gray-900',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        fullWidth ? 'w-full' : '',
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
      ) : icon ? (
        <span className="inline-flex shrink-0 [&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">{icon}</span>
      ) : null}
      {children}
      {iconRight && (
        <span className="inline-flex shrink-0 [&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">{iconRight}</span>
      )}
    </button>
  );
});

export default Button;
