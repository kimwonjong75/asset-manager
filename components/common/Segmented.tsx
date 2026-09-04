// components/common/Segmented.tsx
// P6 공용 세그먼트 컨트롤 — 단일 값(value/onChange)을 고르는 버튼 그룹. TradePlanEditor의 로컬
// `SegButton`, SellAssetModal의 매도 효과 4분할 버튼처럼 곳곳에 흩어져 있던 동일 패턴을 표준화.
//
// 값이 **하나의 상태만**을 표현하는 그룹에만 적합하다 — TradePlanEditor의 손절폭/추세선 그룹처럼
// "kind + preset"이 한 버튼 줄에 같이 얽힌 복합 상태는 여기 억지로 맞추지 않고 로컬 버튼을
// 유지한다(계획서 P6 지침: "props가 깔끔히 맞으면 교체, 아니면 유지하고 기록").

import React from 'react';

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: React.ReactNode;
  title?: string;
}

export interface SegmentedProps<T extends string | number> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  /** true(기본) = 아웃라인 버튼(TradePlanEditor 스타일) / false = 배경만(SellAssetModal 스타일) */
  bordered?: boolean;
  /** 레이아웃 클래스 전체를 대체(기본 `flex flex-wrap gap-1.5`) — 그리드 배치 등에 사용 */
  className?: string;
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = 'sm',
  bordered = true,
  className,
}: SegmentedProps<T>) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm';
  return (
    <div className={className ?? 'flex flex-wrap gap-1.5'} role="group">
      {options.map(opt => {
        const active = opt.value === value;
        const activeClasses = bordered
          ? 'bg-primary border-primary text-white'
          : 'bg-primary text-white font-medium border-transparent';
        const inactiveClasses = bordered
          ? 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500'
          : 'bg-gray-700 text-gray-300 hover:bg-gray-600 border-transparent';
        return (
          <button
            key={String(opt.value)}
            type="button"
            title={opt.title}
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={`${pad} rounded-md border transition-colors whitespace-nowrap ${
              active ? activeClasses : inactiveClasses
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default Segmented;
