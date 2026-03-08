import React from 'react';
import StatCard from '../StatCard';
import PeriodSelector from '../common/PeriodSelector';
import { GlobalPeriod } from '../../types/store';

interface SoldAssetsStatsProps {
    stats: {
        soldCount: number;
        totalSoldAmount: number;
        totalSoldPurchaseValue: number;
        totalSoldProfit: number;
        soldReturn: number;
    };
    globalPeriod: GlobalPeriod;
    onPeriodChange: (period: GlobalPeriod) => void;
}

const SoldAssetsStats: React.FC<SoldAssetsStatsProps> = ({ stats, globalPeriod, onPeriodChange }) => {
    if (stats.soldCount === 0) return null;

    const formatCurrencyKRW = (value: number) => {
        return value.toLocaleString('ko-KR', {
            style: 'currency',
            currency: 'KRW',
            maximumFractionDigits: 0
        });
    };

    return (
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg mb-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-white">수익통계</h3>
                <PeriodSelector value={globalPeriod} onChange={onPeriodChange} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                <StatCard title="총 매도금액" value={formatCurrencyKRW(stats.totalSoldAmount)} tooltip="매도된 종목의 총 매도금액입니다." size="small" />
                <StatCard title="총 매수금액" value={formatCurrencyKRW(stats.totalSoldPurchaseValue)} tooltip="매도된 종목의 총 매수원가입니다." size="small" />
                <StatCard title="매도 수익" value={formatCurrencyKRW(stats.totalSoldProfit)} isProfit={stats.totalSoldProfit >= 0} tooltip="매도금액에서 매수금액을 뺀 수익입니다." size="small" />
                <StatCard title="매도 수익률" value={`${stats.soldReturn.toFixed(2)}%`} isProfit={stats.soldReturn >= 0} tooltip="수익을 매수원가로 나눈 백분율입니다." size="small" />
                <StatCard title="매도 횟수" value={stats.soldCount.toString()} tooltip="총 매도 거래 횟수입니다." size="small" />
            </div>
        </div>
    );
};

export default SoldAssetsStats;
