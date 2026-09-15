// components/dashboard/SoldAssetsStats.tsx
// 홈 '실현 손익' 요약 카드(Stage A, 2026-09-14 — 5칸 StatCard 그리드에서 compact 요약으로 전환).
// 렌더 전용: 수치는 DashboardView가 `calculateSoldAssetsStats(filteredSellHistory, assets, exchangeRates)`로
// 계산해 넘긴다. 자체 기간 선택기는 없다(홈의 기간 컨트롤은 '손익 추이' 카드 하나) — 현재 기간 라벨만 표시.
// 매도 기록(SellRecord)에는 계정 정보가 없어 항상 전체 계정 기준 → warning 범위 칩.
// 상세(총 매도금액·매수금액 등)는 수익 통계 탭으로 링크.

import { directionTextClass } from '../../utils/directionTone';
import React from 'react';
import { ChevronRight } from 'lucide-react';
import ScopeChip from '../common/ScopeChip';
import Card from '../common/Card';
import type { GlobalPeriod } from '../../types/store';
import type { PLBasis } from '../../types/valuation';
import { buildSoldPLBreakdownRows, type RealizedPLBreakdown } from '../../utils/soldPLBreakdown';

/** 기간 라벨 — components/common/PeriodSelector의 옵션 라벨과 동일 문구 */
export const GLOBAL_PERIOD_SHORT_LABELS: Record<GlobalPeriod, string> = {
    THIS_MONTH: '금월',
    LAST_MONTH: '전월',
    '1M': '1개월',
    '3M': '3개월',
    '6M': '6개월',
    '1Y': '1년',
    '2Y': '2년',
    ALL: '전체',
};

interface SoldAssetsStatsProps {
    stats: RealizedPLBreakdown & {
        soldCount: number;
        totalSoldAmount: number;
        totalSoldPurchaseValue: number;
        totalSoldProfit: number;
        soldReturn: number;
    };
    /** 현재 글로벌 기간 */
    globalPeriod: GlobalPeriod;
    /** 수익률 기준 — 달러 기준일 때 금액의 의미를 한 줄로 알린다(숫자는 그대로). */
    plBasis?: PLBasis;
    /** "수익 통계에서 자세히" — 수익 통계 탭으로 이동 */
    onOpenDetails: () => void;
}

const formatCurrencyKRW = (value: number) =>
    value.toLocaleString('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 });

const SoldAssetsStats: React.FC<SoldAssetsStatsProps> = ({ stats, globalPeriod, plBasis, onOpenDetails }) => {
    const hasSales = stats.soldCount > 0;
    const profitColor = directionTextClass(stats.totalSoldProfit);
    const breakdown = hasSales ? buildSoldPLBreakdownRows(stats, formatCurrencyKRW) : [];

    return (
        <Card
            title="실현 손익"
            description={`기간: ${GLOBAL_PERIOD_SHORT_LABELS[globalPeriod]}`}
            actions={<ScopeChip label="전체 계정 기준" tone="warning" title="매도 기록에는 계정 정보가 없습니다" />}
        >

            {hasSales ? (
                <div>
                    <p className="text-xs text-gray-500">매도 수익</p>
                    <p className={`text-2xl font-bold tabular-nums ${profitColor}`}>{formatCurrencyKRW(stats.totalSoldProfit)}</p>
                    <p className="mt-0.5 text-sm text-gray-400">
                        수익률 <span className={`tabular-nums ${directionTextClass(stats.soldReturn)}`}>{stats.soldReturn.toFixed(2)}%</span>
                        {' · '}매도 {stats.soldCount}건
                    </p>
                    {/* 이익/손실 2줄 분해 — StatCard breakdown과 같은 규약(0원 건 제외, 합=매도 수익) */}
                    {breakdown.length > 0 && (
                        <div className="mt-2 text-xs leading-snug whitespace-nowrap max-w-xs">
                            {breakdown.map(row => (
                                <div key={row.label} className="flex justify-between gap-2">
                                    <span className="text-gray-500 min-w-0 truncate" title={row.label}>{row.label}</span>
                                    <span className={`shrink-0 tabular-nums ${row.tone === 'profit' ? 'text-up' : 'text-down'}`}>{row.value}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {plBasis === 'native' && (
                        <p className="mt-2 text-xs text-gray-500">
                            달러 기준: 매도·매수 금액을 오늘 환율로 환산해 계산합니다. 매도 당시 실제 원화 수령액과 다를 수 있습니다.
                        </p>
                    )}
                </div>
            ) : (
                <p className="text-sm text-gray-400">이 기간 매도 기록 없음</p>
            )}

            <button
                type="button"
                onClick={onOpenDetails}
                className="mt-3 inline-flex items-center gap-1 min-h-9 text-sm text-primary-light hover:text-white transition-colors"
            >
                수익 통계에서 자세히
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
        </Card>
    );
};

export default SoldAssetsStats;
