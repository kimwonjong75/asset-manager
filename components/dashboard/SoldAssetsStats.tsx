import React from 'react';
import StatCard from '../StatCard';

interface SoldAssetsStatsProps {
    stats: {
        soldCount: number;
        totalSoldAmount: number;
        totalSoldProfit: number;
        soldReturn: number;
    };
}

const SoldAssetsStats: React.FC<SoldAssetsStatsProps> = ({ stats }) => {
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
            <h3 className="text-xl font-bold text-white mb-4">매도 통계</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <StatCard title="매도 횟수" value={stats.soldCount.toString()} tooltip="총 매도 거래 횟수입니다." size="small" />
                <StatCard title="매도 금액" value={formatCurrencyKRW(stats.totalSoldAmount)} tooltip="매도된 종목의 총 매도금액입니다." size="small" />
                <StatCard title="매도 수익" value={formatCurrencyKRW(stats.totalSoldProfit)} isProfit={stats.totalSoldProfit >= 0} tooltip="매도금액에서 매수금액을 뺀 수익입니다." size="small" />
                <StatCard title="매도 수익률" value={`${stats.soldReturn.toFixed(2)}%`} isProfit={stats.soldReturn >= 0} tooltip="매도 수익을 매수금액으로 나눈 백분율입니다." size="small" />
            </div>
        </div>
    );
};

export default SoldAssetsStats;
