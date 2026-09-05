import React from 'react';
import StatCard from '../StatCard';
import PeriodSelector from '../common/PeriodSelector';
import { GlobalPeriod } from '../../types/store';
import type { PLBasis } from '../../types/valuation';
import { buildSoldPLBreakdownRows, type RealizedPLBreakdown } from '../../utils/soldPLBreakdown';

interface SoldAssetsStatsProps {
    stats: RealizedPLBreakdown & {
        soldCount: number;
        totalSoldAmount: number;
        totalSoldPurchaseValue: number;
        totalSoldProfit: number;
        soldReturn: number;
    };
    globalPeriod: GlobalPeriod;
    onPeriodChange: (period: GlobalPeriod) => void;
    /** 수익률 기준 — 달러 기준일 때 금액 타일의 의미를 한 줄로 알린다(숫자는 그대로). */
    plBasis?: PLBasis;
}

const SoldAssetsStats: React.FC<SoldAssetsStatsProps> = ({ stats, globalPeriod, onPeriodChange, plBasis }) => {
    if (stats.soldCount === 0) return null;

    const formatCurrencyKRW = (value: number) => {
        return value.toLocaleString('ko-KR', {
            style: 'currency',
            currency: 'KRW',
            maximumFractionDigits: 0
        });
    };

    // 달러 기준에서는 매도·매수 금액을 둘 다 **오늘 환율**로 환산한다(수익률이 환율에 흔들리지 않도록).
    // 그래서 이 두 금액은 "매도 당시 실제로 받은 원화"가 아니다 — 숫자는 그대로 두고 의미만 알린다.
    const isNative = plBasis === 'native';
    const amountNote = isNative
        ? ' (달러 기준: 오늘 환율로 환산한 금액이며 매도 당시 실제 원화 수령액과 다를 수 있습니다)'
        : '';

    return (
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg mb-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-white">수익통계</h3>
                <PeriodSelector value={globalPeriod} onChange={onPeriodChange} />
            </div>
            {isNative && (
                <p className="text-[11px] text-gray-500 -mt-2 mb-3">
                    매도금액·매수금액은 오늘 환율로 환산한 금액입니다. 매도 당시 실제 원화 수령액과는 다를 수 있습니다.
                </p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                <StatCard title="총 매도금액" value={formatCurrencyKRW(stats.totalSoldAmount)} tooltip={`매도된 종목의 총 매도금액입니다.${amountNote}`} size="small" />
                <StatCard title="총 매수금액" value={formatCurrencyKRW(stats.totalSoldPurchaseValue)} tooltip={`매도된 종목의 총 매수원가입니다.${amountNote}`} size="small" />
                <StatCard
                    title="매도 수익"
                    value={formatCurrencyKRW(stats.totalSoldProfit)}
                    isProfit={stats.totalSoldProfit >= 0}
                    tooltip="매도금액에서 매수금액을 뺀 수익입니다. 하단은 이익 건 합계 / 손실 건 합계이며, 둘을 더하면 매도 수익이 됩니다."
                    size="small"
                    breakdown={buildSoldPLBreakdownRows(stats, formatCurrencyKRW)}
                />
                <StatCard title="매도 수익률" value={`${stats.soldReturn.toFixed(2)}%`} isProfit={stats.soldReturn >= 0} tooltip="수익을 매수원가로 나눈 백분율입니다." size="small" />
                <StatCard title="매도 횟수" value={stats.soldCount.toString()} tooltip="총 매도 거래 횟수입니다." size="small" />
            </div>
        </div>
    );
};

export default SoldAssetsStats;
