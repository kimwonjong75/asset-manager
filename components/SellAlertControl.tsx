
import React from 'react';

interface SellAlertControlProps {
  value: number;
  onChange: (newValue: number) => void;
}

const SellAlertControl: React.FC<SellAlertControlProps> = ({ value, onChange }) => {
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value === '' ? 0 : parseInt(e.target.value, 10);
    if (!isNaN(newValue) && newValue >= 0) {
      onChange(newValue);
    }
  };

  return (
    <div className="bg-gray-800 p-4 rounded-lg shadow-lg mb-6 flex items-center justify-between" title="포트폴리오 전체에 적용될 기본 매도 알림 기준입니다. 개별 자산 수정 화면에서 자산별로 다른 기준을 설정할 수 있습니다.">
      <div className="flex items-center">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-yellow-400 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <label htmlFor="sell-alert-rate" className="text-sm font-medium text-gray-300">
          매도 알림 하락률 설정 (%)
        </label>
      </div>
      <div className="flex items-center">
        <span className="text-gray-400 mr-2">최고가 대비</span>
        <input
          id="sell-alert-rate"
          type="number"
          value={value}
          onChange={handleInputChange}
          min="0"
          className="w-20 bg-gray-700 border border-gray-600 rounded-md py-1 px-2 text-white text-center font-bold focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition"
        />
        <span className="text-gray-400 ml-2">% 이하 하락 시 알림</span>
      </div>
    </div>
  );
};

export default SellAlertControl;