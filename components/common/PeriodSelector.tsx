import React, { useRef, useState } from 'react';
import { GlobalPeriod } from '../../types/store';
import ActionMenu from './ActionMenu';

interface PeriodSelectorProps {
  value: GlobalPeriod;
  onChange: (period: GlobalPeriod) => void;
  /** 'buttons': 8버튼 나열 (통계 카드 내장용, 기본값) / 'dropdown': 현재값 1버튼 + ActionMenu (앱바용) */
  variant?: 'buttons' | 'dropdown';
}

const PERIOD_OPTIONS: { value: GlobalPeriod; label: string }[] = [
  { value: 'THIS_MONTH', label: '금월' },
  { value: 'LAST_MONTH', label: '전월' },
  { value: '1M', label: '1개월' },
  { value: '3M', label: '3개월' },
  { value: '6M', label: '6개월' },
  { value: '1Y', label: '1년' },
  { value: '2Y', label: '2년' },
  { value: 'ALL', label: '전체' },
];

const PeriodSelector: React.FC<PeriodSelectorProps> = ({ value, onChange, variant = 'buttons' }) => {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  if (variant === 'dropdown') {
    const currentLabel = PERIOD_OPTIONS.find(opt => opt.value === value)?.label ?? '기간';
    return (
      <>
        <button
          ref={anchorRef}
          onClick={() => setIsOpen(prev => !prev)}
          className="flex items-center gap-1 px-2.5 py-2 text-xs font-medium rounded-md bg-gray-700 text-gray-300 hover:text-white hover:bg-gray-600 transition-colors whitespace-nowrap flex-shrink-0"
          title="조회 기간 선택"
        >
          {currentLabel}
          <svg className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {isOpen && (
          <ActionMenu
            anchorRef={anchorRef}
            items={PERIOD_OPTIONS.map(opt => ({
              label: opt.label,
              onClick: () => onChange(opt.value),
              colorClass: opt.value === value ? 'text-primary font-semibold' : undefined,
            }))}
            onClose={() => setIsOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
      {PERIOD_OPTIONS.map(opt => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              isActive
                ? 'bg-primary text-white'
                : 'bg-gray-700 text-gray-400 hover:text-white hover:bg-gray-600'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};

export default PeriodSelector;
