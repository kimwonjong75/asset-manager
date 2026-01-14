import React from 'react';
import { Asset, ExchangeRates } from '../../types';
import { useTopBottomAssets, EnrichedAsset } from '../../hooks/useTopBottomAssets';
import { usePortfolio } from '../../contexts/PortfolioContext';

interface TopBottomAssetsProps {
    assets: Asset[];
    exchangeRates?: ExchangeRates; // Optional in prop, but we'll try to get it
}

const TopBottomAssets: React.FC<TopBottomAssetsProps> = ({ assets, exchangeRates: propExchangeRates }) => {
    // If not provided via props, try context (fallback)
    const { data } = usePortfolio();
    const exchangeRates = propExchangeRates || data.exchangeRates;

    const { topAssets, bottomAssets } = useTopBottomAssets({ assets, exchangeRates });

    const formatKRW = (num: number) => {
        return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(num);
    };

    const getChangeColor = (value: number) => {
        if (value > 0) return 'text-red-400';
        if (value < 0) return 'text-blue-400';
        return 'text-gray-400';
    };

    const AssetListItem: React.FC<{asset: EnrichedAsset}> = ({ asset }) => (
        <li className="flex justify-between items-center py-2 border-b border-gray-700/50 last:border-b-0">
            <div className="flex-1 overflow-hidden">
                <p className="text-white font-medium truncate" title={(asset.customName?.trim() || asset.name)}>{(asset.customName?.trim() || asset.name)}</p>
                <p className={`text-xs ${getChangeColor(asset.metrics.profitLoss)}`}>
                    {asset.metrics.profitLoss > 0 ? '+' : ''}{formatKRW(asset.metrics.profitLoss)}
                </p>
            </div>
            <div className={`text-right font-bold ml-4 ${getChangeColor(asset.metrics.returnPercentage)}`}>
                {asset.metrics.returnPercentage.toFixed(2)}%
            </div>
        </li>
    );

    if (assets.length === 0) {
        return null;
    }

    return (
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg" title="수익률 기준 상위 및 하위 5개 자산 현황입니다.">
            <h2 className="text-xl font-bold text-white mb-4">자산별 성과 요약</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-6">
                <div>
                    <h3 className="text-lg font-semibold text-red-400 mb-2">수익률 TOP 5</h3>
                    {topAssets.length > 0 ? (
                        <ul className="space-y-1">
                            {topAssets.map(asset => <AssetListItem key={asset.id} asset={asset} />)}
                        </ul>
                    ) : <p className="text-gray-500 text-sm">데이터가 없습니다.</p>}
                </div>
                <div>
                    <h3 className="text-lg font-semibold text-blue-400 mb-2">수익률 BOTTOM 5</h3>
                    {bottomAssets.length > 0 ? (
                        <ul className="space-y-1">
                            {bottomAssets.map(asset => <AssetListItem key={asset.id} asset={asset} />)}
                        </ul>
                    ) : <p className="text-gray-500 text-sm">데이터가 없습니다.</p>}
                </div>
            </div>
        </div>
    );
};

export default TopBottomAssets;
