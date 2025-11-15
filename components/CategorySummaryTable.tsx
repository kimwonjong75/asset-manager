import React, { useMemo } from 'react';
import { Asset, AssetCategory, Currency } from '../types';

interface CategorySummaryTableProps {
    assets: Asset[];
    totalPortfolioValue: number;
}

interface SummaryData {
    category: AssetCategory;
    totalValue: number;
    totalProfitLoss: number;
    totalReturn: number;
    allocation: number;
}

const CategorySummaryTable: React.FC<CategorySummaryTableProps> = ({ assets, totalPortfolioValue }) => {
    const summaryData = useMemo((): SummaryData[] => {
        const categoryMap = new Map<AssetCategory, { totalValue: number; totalPurchaseValue: number }>();

        assets.forEach(asset => {
            if (!categoryMap.has(asset.category)) {
                categoryMap.set(asset.category, { totalValue: 0, totalPurchaseValue: 0 });
            }
            const data = categoryMap.get(asset.category)!;

            const currentValue = asset.currentPrice * asset.quantity;
            data.totalValue += currentValue;

            let purchaseValueKRW;
            if (asset.currency === Currency.KRW) {
                purchaseValueKRW = asset.purchasePrice * asset.quantity;
            } else if (asset.purchaseExchangeRate) {
                purchaseValueKRW = asset.purchasePrice * asset.purchaseExchangeRate * asset.quantity;
            } else if (asset.priceOriginal > 0) {
                const exchangeRate = asset.currentPrice / asset.priceOriginal;
                purchaseValueKRW = asset.purchasePrice * exchangeRate * asset.quantity;
            } else {
                purchaseValueKRW = asset.purchasePrice * asset.quantity;
            }
            data.totalPurchaseValue += purchaseValueKRW;
        });

        const result: SummaryData[] = [];
        for (const [category, data] of categoryMap.entries()) {
            const totalProfitLoss = data.totalValue - data.totalPurchaseValue;
            const totalReturn = data.totalPurchaseValue === 0 ? 0 : (totalProfitLoss / data.totalPurchaseValue) * 100;
            const allocation = totalPortfolioValue > 0 ? (data.totalValue / totalPortfolioValue) * 100 : 0;
            result.push({
                category,
                totalValue: data.totalValue,
                totalProfitLoss,
                totalReturn,
                allocation,
            });
        }
        
        return result.sort((a, b) => b.totalValue - a.totalValue);

    }, [assets, totalPortfolioValue]);

    const formatKRW = (num: number) => {
        return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(num);
    };

    const getChangeColor = (value: number) => {
        if (value > 0) return 'text-success';
        if (value < 0) return 'text-danger';
        return 'text-gray-400';
    };

    if (summaryData.length === 0) {
        return null; 
    }

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
                            <tr key={item.category} className="border-b border-gray-700">
                                <td className="px-4 py-3 font-medium text-white">{item.category}</td>
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