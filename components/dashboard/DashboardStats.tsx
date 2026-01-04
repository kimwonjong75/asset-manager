import React from 'react';
import StatCard from '../StatCard';

interface DashboardStatsProps {
    totalValue: number;
    totalPurchaseValue: number;
    totalGainLoss: number;
    totalReturn: number;
}

const DashboardStats: React.FC<DashboardStatsProps> = ({
    totalValue,
    totalPurchaseValue,
    totalGainLoss,
    totalReturn
}) => {
    const formatCurrencyKRW = (value: number) => {
        return value.toLocaleString('ko-KR', { 
            style: 'currency', 
            currency: 'KRW', 
            maximumFractionDigits: 0 
        });
    };

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <StatCard title="총 자산 (원화)" value={formatCurrencyKRW(totalValue)} tooltip="선택된 자산의 현재 평가금액 총합입니다." />
            <StatCard title="투자 원금" value={formatCurrencyKRW(totalPurchaseValue)} tooltip="선택된 자산의 총 매수금액 합계입니다." />
            <StatCard title="총 손익 (원화)" value={formatCurrencyKRW(totalGainLoss)} isProfit={totalGainLoss >= 0} tooltip="총 평가금액에서 총 매수금액을 뺀 금액입니다."/>
            <StatCard title="총 수익률" value={`${totalReturn.toFixed(2)}%`} isProfit={totalReturn >= 0} tooltip="총 손익을 총 매수금액으로 나눈 백분율입니다."/>
        </div>
    );
};

export default DashboardStats;
