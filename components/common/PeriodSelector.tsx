import React from 'react';
import { GlobalPeriod } from '../../types/store';

interface PeriodSelectorProps {
  value: GlobalPeriod;
  onChange: (period: GlobalPeriod) => void;
}

const PERIOD_OPTIONS: { value: GlobalPeriod; label: string }[] = [
  { value: '3M', label: '3개월' },
  { value: '6M', label: '6개월' },
  { value: '1Y', label: '1년' },
  { value: '2Y', label: '2년' },
  { value: 'ALL', label: '전체' },
];

const PeriodSelector: React.FC<PeriodSelectorProps> = ({ value, onChange }) => {
  return (
    <div className="flex items-center gap-1">
      {PERIOD_OPTIONS.map(opt => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
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
