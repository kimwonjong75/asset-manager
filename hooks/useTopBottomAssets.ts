import { useMemo } from 'react';
import { Asset, ExchangeRates } from '../types';
import type { PLBasis } from '../types/valuation';
import { computeAssetMetrics } from '../utils/portfolioMetrics';

interface UseTopBottomAssetsProps {
    assets: Asset[];
    exchangeRates: ExchangeRates;
    plBasis: PLBasis;
}

/**
 * `TopBottomAssets` 전용 축약 메트릭.
 * `profitLoss`는 **원화 환산 손익**이다(화면이 ₩로 표시) — `AssetMetrics.profitLoss`(원통화)와 이름은 같지만 의미가 다르니 주의.
 */
export interface EnrichedAsset extends Asset {
    metrics: {
        returnPercentage: number;
        profitLoss: number;
    }
}

/**
 * 수익률 상·하위 5개 추출.
 *
 * 계산은 `utils/portfolioMetrics.computeAssetMetrics` 하나만 쓴다 — 예전에는 이 훅이 자체 공식을
 * 갖고 있었고 환율이 없을 때 `rates[currency] || 1`(1원 취급)로 폴백해 외화 자산 수익률이 크게 왜곡됐다.
 * 지금은 `resolveRate`(현재 → 마지막 정상 캐시 → 0)를 타므로 표·대시보드와 같은 값이 나온다.
 * ※ `TopBottomAssets` 컴포넌트는 현재 대시보드에 마운트돼 있지 않다(재사용 대비 보존).
 */
export const useTopBottomAssets = ({ assets, exchangeRates, plBasis }: UseTopBottomAssetsProps) => {
    const enrichedAssets = useMemo((): EnrichedAsset[] => {
        return assets.map(asset => {
            const { metrics } = computeAssetMetrics(asset, exchangeRates, 0, { plBasis });
            return {
                ...asset,
                metrics: {
                    returnPercentage: metrics.returnPercentage,
                    profitLoss: metrics.profitLossKRW, // 화면 표시가 원화이므로 KRW 손익을 싣는다
                },
            };
        });
    }, [assets, exchangeRates, plBasis]);

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
