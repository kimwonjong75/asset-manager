import React, { useMemo } from 'react';
import { Asset, AssetCategory, ALLOWED_CATEGORIES, ExchangeRates } from '../../types';
import ExchangeRateInput from '../ExchangeRateInput';
import StatCard from '../StatCard';

interface DashboardControlsProps {
    assets: Asset[];
    filterCategory: AssetCategory | 'ALL';
    onFilterChange: (category: AssetCategory | 'ALL') => void;
    exchangeRates: ExchangeRates;
    onRatesChange: (rates: ExchangeRates) => void;
    showExchangeRateWarning: boolean;
    alertCount: number;
    onAlertClick: () => void;
}

const DashboardControls: React.FC<DashboardControlsProps> = ({
    assets,
    filterCategory,
    onFilterChange,
    exchangeRates,
    onRatesChange,
    showExchangeRateWarning,
    alertCount,
    onAlertClick
}) => {
    const categoryOptions = useMemo(() => {
        const extras = Array.from(new Set(assets.map(asset => asset.category))).filter(
            (cat) => !ALLOWED_CATEGORIES.includes(cat)
        );
        return [...ALLOWED_CATEGORIES, ...extras];
    }, [assets]);

    return (
        <div className="bg-gray-800 p-4 rounded-lg shadow-lg flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4" title="대시보드에 표시될 자산의 종류를 선택합니다.">
                <label htmlFor="dashboard-filter" className="text-sm font-medium text-gray-300">
                    자산 구분 필터:
                </label>
                <div className="relative">
                    <select
                        id="dashboard-filter"
                        value={filterCategory}
                        onChange={(e) => onFilterChange(e.target.value as AssetCategory | 'ALL')}
                        className="bg-gray-700 border border-gray-600 rounded-md py-2 pl-3 pr-8 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent appearance-none"
                    >
                        <option value="ALL">전체 포트폴리오</option>
                        {categoryOptions.map((cat) => (
                            <option key={cat} value={cat}>{cat}</option>
                        ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
                        <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                    </div>
                </div>
            </div>
            <ExchangeRateInput 
                rates={exchangeRates} 
                onRatesChange={onRatesChange} 
                showWarning={showExchangeRateWarning} 
            />
            <StatCard 
                title="매도 알림 발생" 
                value={`${alertCount}개`}
                tooltip="설정된 하락률 기준을 초과한 자산의 수입니다. 클릭하여 필터링된 목록을 확인하세요."
                onClick={onAlertClick}
                isAlert={alertCount > 0}
                size="small"
            />
        </div>
    );
};

export default DashboardControls;
