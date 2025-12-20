import React from 'react';
import { ExchangeRates } from '../types';

interface Props {
  rates: ExchangeRates;
  onRatesChange: (rates: ExchangeRates) => void;
  showWarning?: boolean;
  className?: string;
}

const ExchangeRateInput: React.FC<Props> = ({ rates, onRatesChange, showWarning, className = '' }) => {
  return (
    <div className={className}>
      <div className="flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-300">USD→KRW</label>
          <input
            type="number"
            step="0.01"
            value={rates.USD || 0}
            onChange={(e) => onRatesChange({ ...rates, USD: parseFloat(e.target.value) || 0 })}
            className="bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white text-sm w-28"
            placeholder="예: 1400"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-300">JPY→KRW</label>
          <input
            type="number"
            step="0.01"
            value={rates.JPY || 0}
            onChange={(e) => onRatesChange({ ...rates, JPY: parseFloat(e.target.value) || 0 })}
            className="bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white text-sm w-28"
            placeholder="예: 9.5"
          />
        </div>
        {showWarning && (
          <div className="text-yellow-400 text-sm">
            환율을 입력하세요. 미입력 시 원화 환산 값이 0으로 표시됩니다.
          </div>
        )}
      </div>
    </div>
  );
};

export default ExchangeRateInput;
