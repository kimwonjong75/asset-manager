
import React, { useMemo } from 'react';
import { Asset, Currency } from '../../types';

interface TopBottomAssetsProps {
    assets: Asset[];
}

interface EnrichedAsset extends Asset {
    metrics: {
        returnPercentage: number;
        profitLoss: number;
    }
}

const TopBottomAssets: React.FC<TopBottomAssetsProps> = ({ assets }) => {
    const enrichedAssets = useMemo((): EnrichedAsset[] => {
        return assets.map(asset => {
            const currentValue = asset.currentPrice * asset.quantity;
            
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

            const profitLoss = currentValue - purchaseValueKRW;
            const returnPercentage = purchaseValueKRW === 0 ? 0 : (profitLoss / purchaseValueKRW) * 100;
            
            return {
                ...asset,
                metrics: {
                    returnPercentage,
                    profitLoss,
                }
            };
        });
    }, [assets]);

    const sortedAssets = useMemo(() => {
        return [...enrichedAssets].sort((a, b) => a.metrics.returnPercentage - b.metrics.returnPercentage);
    }, [enrichedAssets]);

    const bottomAssets = sortedAssets.slice(0, 5);
    const topAssets = sortedAssets.slice(-5).reverse();

    const formatKRW = (num: number) => {
        return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(num);
    };

    const getChangeColor = (value: number) => {
        if (value > 0) return 'text-success';
        if (value < 0) return 'text-danger';
        return 'text-gray-400';
    };

    const AssetListItem: React.FC<{asset: EnrichedAsset}> = ({ asset }) => (
        <li className="flex justify-between items-center py-2 border-b border-gray-700/50 last:border-b-0">
            <div className="flex-1 overflow-hidden">
                <p className="text-white font-medium truncate" title={(asset.customName?.trim() || asset.name)}>{(asset.customName?.trim() || asset.name)}</p>
                <p className="text-xs text-gray-500">{formatKRW(asset.metrics.profitLoss)}</p>
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
                    <h3 className="text-lg font-semibold text-success mb-2">수익률 TOP 5</h3>
                    {topAssets.length > 0 ? (
                        <ul className="space-y-1">
                            {topAssets.map(asset => <AssetListItem key={asset.id} asset={asset} />)}
                        </ul>
                    ) : <p className="text-gray-500 text-sm">데이터가 없습니다.</p>}
                </div>
                <div>
                    <h3 className="text-lg font-semibold text-danger mb-2">수익률 BOTTOM 5</h3>
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
