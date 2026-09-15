// components/common/FieldError.tsx
// Stage D2 P0 공용 필드 오류 문구 — 렌더 전용. 입력칸 근처 인라인 오류(RULES.md §7 폼 검증 오류)의 단일 마크업.
//   `<p id role="alert">` + CircleAlert(aria-hidden) + 문구, text-danger. size sm(기본, text-sm) / xs(text-xs, 좁은 행 편집).
//   아이콘은 첫 줄에 맞춰 위쪽 정렬(items-start) — 문구가 두 줄로 넘어가도 아이콘이 가운데로 흘러내리지 않는다.
//
// 호출부 패턴(접근성 연결)
//   const nameErrorId = useId();
//   const nameError = submitAttempted ? validateName(name) : null;   // 렌더 중 파생값
//   <input
//     aria-invalid={nameError ? true : undefined}                    // 오류일 때만
//     aria-describedby={nameError ? nameErrorId : undefined}         // 문구가 보이는 동안만
//   />
//   {nameError && <FieldError id={nameErrorId}>{nameError}</FieldError>}
//   · aria-invalid="false" 를 늘 달아 두지 말 것 — 오류가 있는 필드에만 붙인다.
//   · aria-describedby 가 존재하지 않는 id 를 가리키지 않게, 문구를 렌더할 때만 연결한다.
//   · 기존 설명(hint) id 가 있으면 공백으로 이어 붙인다: `${hintId} ${nameErrorId}`.

import React from 'react';
import { CircleAlert } from 'lucide-react';

export interface FieldErrorProps {
  /** 입력칸 aria-describedby 가 가리킬 id (useId) */
  id: string;
  children: React.ReactNode;
  /** sm = text-sm·아이콘 16px(기본) / xs = text-xs·아이콘 14px */
  size?: 'sm' | 'xs';
  /** 바깥 여백 등 배치용(예: 'mt-1') */
  className?: string;
}

const SIZE_CLASSES = {
  sm: { text: 'gap-1.5 text-sm', icon: 'h-4 w-4 mt-0.5' },
  xs: { text: 'gap-1 text-xs', icon: 'h-3.5 w-3.5 mt-px' },
} as const;

const FieldError: React.FC<FieldErrorProps> = ({ id, children, size = 'sm', className = '' }) => {
  const s = SIZE_CLASSES[size];
  return (
    <p id={id} role="alert" className={`flex items-start ${s.text} text-danger ${className}`}>
      <CircleAlert className={`${s.icon} shrink-0`} aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  );
};

export default FieldError;
