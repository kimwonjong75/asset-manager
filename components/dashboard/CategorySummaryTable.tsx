import React, { useMemo } from 'react';
import { Asset, ExchangeRates } from '../../types';
import { getCategoryName } from '../../types/category';
import { getAssetBucket, BUCKET_LABELS } from '../../types/bucket';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { computeAssetMetrics } from '../../utils/portfolioMetrics';

interface CategorySummaryTableProps {
    assets: Asset[];
    totalPortfolioValue: number;
    exchangeRates: ExchangeRates;
}

interface SummaryData {
    category: string;
    totalValue: number;
    totalProfitLoss: number;
    totalReturn: number;
    allocation: number;
    /** 투더문(위성) 합산 행 — 카테고리가 아니라 버킷 덩어리임을 표시로 구분 */
    isSatellite?: boolean;
}

const CategorySummaryTable: React.FC<CategorySummaryTableProps> = ({ assets, totalPortfolioValue, exchangeRates }) => {
    const { data: portfolioData } = usePortfolio();
    const categories = portfolioData.categoryStore.categories;
    // 수익률 기준은 표·대시보드 통계와 같은 설정을 따른다(계산은 단일 순수 모듈에 위임).
    const plBasis = portfolioData.valuationSettings.plBasis;

    // 카테고리는 코어 버킷의 배분 축 — 투더문(위성)은 카테고리 행에 섞지 않고 하단 단일 행으로 분리
    // (배분 차트·2단 리밸런싱과 동일한 분해). 키: 숫자=코어 카테고리, 'SAT'=투더문 합산.
    const summaryData = useMemo((): SummaryData[] => {
        const categoryMap = new Map<number | 'SAT', { totalValue: number; totalPurchaseValue: number }>();

        assets.forEach(asset => {
            const key: number | 'SAT' = getAssetBucket(asset) === 'SATELLITE' ? 'SAT' : asset.categoryId;
            if (!categoryMap.has(key)) {
                categoryMap.set(key, { totalValue: 0, totalPurchaseValue: 0 });
            }
            const data = categoryMap.get(key)!;

            // 평가액·매수원가 모두 단일 계산 모듈 사용 — 예전에는 여기에 4분기 공식 사본이 있었고
            // (매수환율 없을 때 currentPrice/priceOriginal로 환율을 역산하는 분기 포함)
            // 그 때문에 같은 종목이 표와 이 요약에서 다른 원가로 잡히는 경우가 있었다.
            const { metrics } = computeAssetMetrics(asset, exchangeRates, 0, { plBasis });
            data.totalValue += metrics.currentValueKRW;
            data.totalPurchaseValue += metrics.purchaseValueKRW;
        });

        const result: SummaryData[] = [];
        let satelliteRow: SummaryData | null = null;
        for (const [key, data] of categoryMap.entries()) {
            const totalProfitLoss = data.totalValue - data.totalPurchaseValue;
            const totalReturn = data.totalPurchaseValue === 0 ? 0 : (totalProfitLoss / data.totalPurchaseValue) * 100;
            const allocation = totalPortfolioValue > 0 ? (data.totalValue / totalPortfolioValue) * 100 : 0;
            const row: SummaryData = {
                category: key === 'SAT' ? `🚀 ${BUCKET_LABELS.SATELLITE}` : getCategoryName(key, categories),
                totalValue: data.totalValue,
                totalProfitLoss,
                totalReturn,
                allocation,
                isSatellite: key === 'SAT' || undefined,
            };
            if (key === 'SAT') satelliteRow = row;
            else result.push(row);
        }

        result.sort((a, b) => b.totalValue - a.totalValue);
        if (satelliteRow) result.push(satelliteRow); // 투더문은 항상 맨 아래 고정 (카테고리와 다른 축임을 시각적으로 구분)
        return result;

    }, [assets, totalPortfolioValue, exchangeRates, categories, plBasis]);

    const formatKRW = (num: number) => {
        return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(num);
    };

    const getChangeColor = (value: number) => {
        if (value > 0) return 'text-success';
        if (value < 0) return 'text-danger';
        return 'text-gray-400';
    };

    if (summaryData.length === 0) return null;

    return (
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg" title="자산 종류별 요약 정보입니다.">
            <h2 className="text-xl font-bold text-white mb-4">자산군별 요약</h2>
            <div className="w-full overflow-x-auto">
                <table className="w-full text-sm text-left text-gray-400">
                    <thead className="text-xs text-gray-300 uppercase bg-gray-700">
                        <tr>
                            <th scope="col" className="px-4 py-2">자산 구분</th>
                            <th scope="col" className="px-4 py-2 text-right">평가금액</th>
                            <th scope="col" className="px-4 py-2 text-right">손익</th>
                            <th scope="col" className="px-4 py-2 text-right">수익률</th>
                            <th scope="col" className="px-4 py-2 text-right">비중</th>
                        </tr>
                    </thead>
                    <tbody>
                        {summaryData.map(item => (
                            <tr key={item.category} className={`border-b border-gray-700 ${item.isSatellite ? 'bg-purple-900/10' : ''}`}>
                                <td className={`px-4 py-3 font-medium ${item.isSatellite ? 'text-purple-300' : 'text-white'}`} title={item.isSatellite ? '투더문(위성) 버킷 합산 — 카테고리 배분과 별도로 관리되는 종목들' : undefined}>{item.category}</td>
                                <td className="px-4 py-3 text-right">{formatKRW(item.totalValue)}</td>
                                <td className={`px-4 py-3 text-right font-medium ${getChangeColor(item.totalProfitLoss)}`}>{formatKRW(item.totalProfitLoss)}</td>
                                <td className={`px-4 py-3 text-right font-medium ${getChangeColor(item.totalReturn)}`}>{item.totalReturn.toFixed(2)}%</td>
                                <td className="px-4 py-3 text-right">{item.allocation.toFixed(2)}%</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default CategorySummaryTable;
