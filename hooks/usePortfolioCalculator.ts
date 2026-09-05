// hooks/usePortfolioCalculator.ts
// ---------------------------------------------------------------------------
// 수익률/손익 계산 훅 — **얇은 래퍼**. 계산 본체는 전부 `utils/portfolioMetrics.ts`(순수)에 있다.
//
// 이 훅이 하는 일은 두 가지뿐이다:
//   1) 수익률 기준(`plBasis`)을 한 번 받아 각 함수에 주입
//   2) `useCallback`으로 참조 안정화(소비 훅들의 memo 의존성 보호) — deps는 `[plBasis]`
//
// 계산 규약·모드 차이·주의사항은 `utils/portfolioMetrics.ts` 상단 주석 참조.
// 새 계산 로직은 여기가 아니라 순수 모듈에 추가할 것(테스트가 훅을 호출하지 않는다).
// ---------------------------------------------------------------------------

import { useCallback } from 'react';
import { Asset, Currency, ExchangeRates, SellRecord } from '../types';
import { EnrichedAsset } from '../types/ui';
import type { PLBasis } from '../types/valuation';
import {
  getValueInKRW as getValueInKRWPure,
  getPurchaseValueInKRW as getPurchaseValueInKRWPure,
  computeAssetMetrics,
  computePortfolioStats,
  computeSoldAssetsStats,
  computeAlertCount,
} from '../utils/portfolioMetrics';

/**
 * @param plBasis 수익률 기준. **필수 인자** — 기본값을 두면 배선을 빠뜨린 화면만 조용히 다른 기준으로
 *   계산되므로(표는 달러, 대시보드는 원화 같은 어긋남), 타입으로 누락을 강제한다.
 *   호출부는 `data.valuationSettings.plBasis`(4곳)를 넘긴다.
 */
export const usePortfolioCalculator = (plBasis: PLBasis) => {

  const getValueInKRW = useCallback(
    (value: number, currency: Currency, exchangeRates: ExchangeRates): number =>
      getValueInKRWPure(value, currency, exchangeRates),
    []);

  const getPurchaseValueInKRW = useCallback(
    (asset: Asset, exchangeRates: ExchangeRates): number =>
      getPurchaseValueInKRWPure(asset, exchangeRates, plBasis),
    [plBasis]);

  const calculateAssetMetrics = useCallback(
    (asset: Asset, exchangeRates: ExchangeRates, totalPortfolioValue: number = 0): EnrichedAsset =>
      computeAssetMetrics(asset, exchangeRates, totalPortfolioValue, { plBasis }),
    [plBasis]);

  const calculatePortfolioStats = useCallback(
    (assets: Asset[], exchangeRates: ExchangeRates) =>
      computePortfolioStats(assets, exchangeRates, { plBasis }),
    [plBasis]);

  // 기본 환율은 **호환용 레거시 폴백**이다. 호출부는 반드시 실제 환율을 넘길 것
  // (생략하면 비정상 환율 보정이 다른 값으로 이뤄져 수익통계 탭과 어긋난다).
  const calculateSoldAssetsStats = useCallback(
    (sellHistory: SellRecord[], assets: Asset[], exchangeRates: ExchangeRates = { USD: 1450, JPY: 9.5 }) =>
      computeSoldAssetsStats(sellHistory, assets, exchangeRates, { plBasis }),
    [plBasis]);

  const calculateAlertCount = useCallback(
    (assets: Asset[], globalSellAlertDropRate: number) =>
      computeAlertCount(assets, globalSellAlertDropRate),
    []);

  return {
    getValueInKRW,
    getPurchaseValueInKRW,
    calculateAssetMetrics,
    calculatePortfolioStats,
    calculateSoldAssetsStats,
    calculateAlertCount
  };
};
