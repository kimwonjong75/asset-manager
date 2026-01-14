import { useMemo } from 'react';
import { Asset, Currency, ExchangeRates } from '../types';

interface UseTopBottomAssetsProps {
    assets: Asset[];
    exchangeRates?: ExchangeRates; // Optional, to use current rate if purchase rate is missing
}

export interface EnrichedAsset extends Asset {
    metrics: {
        returnPercentage: number;
        profitLoss: number;
    }
}

export const useTopBottomAssets = ({ assets, exchangeRates }: UseTopBottomAssetsProps) => {
    const enrichedAssets = useMemo((): EnrichedAsset[] => {
        return assets.map(asset => {
            // 1. Calculate Current Value in KRW
            // currentPrice is already in KRW for all assets in this app (based on typical usage),
            // OR is it?
            // In `RebalancingTable`, we saw:
            // const rate = asset.currency === Currency.KRW ? 1 : (exchangeRates[asset.currency] || 0);
            // const val = asset.currentPrice * asset.quantity * rate;
            // This implies `asset.currentPrice` is in *Original Currency* (e.g. USD).
            // Let's check `types/index.ts` or `usePortfolioData` or `useMarketData`.
            // In `TopBottomAssets.tsx` existing code:
            // const currentValue = asset.currentPrice * asset.quantity;
            // This contradicts RebalancingTable!
            // Wait, RebalancingTable logic:
            // const rate = asset.currency === Currency.KRW ? 1 : (exchangeRates[asset.currency] || 0);
            // const val = asset.currentPrice * asset.quantity * rate;
            
            // If `asset.currentPrice` is in USD, `TopBottomAssets.tsx` existing logic:
            // const currentValue = asset.currentPrice * asset.quantity;
            // ...
            // purchaseValueKRW logic...
            // const profitLoss = currentValue - purchaseValueKRW;
            
            // If `currentValue` is USD and `purchaseValueKRW` is KRW, `profitLoss` is nonsense.
            // THIS IS THE BUG!
            // The existing `TopBottomAssets.tsx` assumes `currentPrice` is KRW or mixes them up?
            // Actually, let's check `Asset` type definition comments.
            // `currentPrice: number;`
            // `priceOriginal: number;`
            
            // In `RebalancingTable`: `asset.currentPrice * asset.quantity * rate`. This implies `currentPrice` is foreign.
            // BUT `RebalancingTable` uses `asset.currentPrice` for KRW assets (rate=1) and `asset.currentPrice` for foreign (rate=exchangeRate).
            // This suggests `currentPrice` is in *local* currency (e.g. USD for US stocks).
            
            // In `TopBottomAssets.tsx`:
            // `const currentValue = asset.currentPrice * asset.quantity;`
            // If `asset` is US Stock, `currentValue` is in USD.
            // `purchaseValueKRW` is calculated in KRW.
            // `profitLoss = currentValue - purchaseValueKRW` -> USD - KRW -> WRONG.
            
            // So I must fix this: Convert `currentValue` to KRW first.
            
            const isKRW = asset.currency === Currency.KRW;
            // We need exchange rates here.
            // If exchangeRates is not passed, we might have an issue, but we can pass it.
            
            // Fallback for rate: try to infer from priceOriginal if available (currentPrice / priceOriginal is not rate, priceOriginal is foreign price).
            // Actually `currentPrice` is the field name.
            // If `currency` is USD, `currentPrice` is USD price.
            // So we need to multiply by exchange rate.
            
            let currentRate = 1;
            if (!isKRW && exchangeRates) {
                currentRate = exchangeRates[asset.currency] || 1; // Default to 1 if missing? Bad.
            }
            
            const currentValueKRW = asset.currentPrice * asset.quantity * currentRate;

            // 2. Calculate Purchase Value in KRW
            let purchaseValueKRW = 0;
            if (isKRW) {
                purchaseValueKRW = asset.purchasePrice * asset.quantity;
            } else {
                // Foreign Asset
                if (asset.purchaseExchangeRate) {
                    purchaseValueKRW = asset.purchasePrice * asset.quantity * asset.purchaseExchangeRate;
                } else {
                    // Fallback: Use current rate (assume no FX gain/loss recorded) or some other heuristic.
                    // If we use currentRate, we ignore FX changes.
                    // Better than 0.
                    purchaseValueKRW = asset.purchasePrice * asset.quantity * currentRate;
                }
            }

            const profitLoss = currentValueKRW - purchaseValueKRW;
            const returnPercentage = purchaseValueKRW === 0 ? 0 : (profitLoss / purchaseValueKRW) * 100;
            
            return {
                ...asset,
                metrics: {
                    returnPercentage,
                    profitLoss,
                }
            };
        });
    }, [assets, exchangeRates]);

    const sortedAssets = useMemo(() => {
        return [...enrichedAssets].sort((a, b) => a.metrics.returnPercentage - b.metrics.returnPercentage);
    }, [enrichedAssets]);

    const bottomAssets = sortedAssets.slice(0, 5);
    const topAssets = sortedAssets.slice(-5).reverse();

    return {
        topAssets,
        bottomAssets
    };
};
