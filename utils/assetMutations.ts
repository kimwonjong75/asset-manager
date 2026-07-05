// utils/assetMutations.ts
// ---------------------------------------------------------------------------
// 매도/추가매수의 "다음 상태 계산" 순수 함수 (Phase 2b-4b-2d 기반).
// 기존 useAssetActions 핸들러의 인라인 계산을 추출 — 일반 흐름과 터틀 실행이 동일 로직을 공유해
// 중복(drift)을 없애고, 교차도메인 원자 커밋(commitPortfolioPatch)이 가능하도록 nextAssets 등을 반환한다.
//
// 순수: side effect·id 생성·환율 fetch 없음. id·환율은 호출부가 주입(핸들러=Date.now/fetch, 터틀 훅=주입).
// 통화/환율 계산식은 기존 핸들러와 1:1 동일해야 함(회귀 테스트 tests/assetMutationsParity.ts가 고정).

import { Asset, SellRecord, SellTransaction, Currency } from '../types';

export interface SellMutationInput {
  asset: Asset;
  assets: Asset[];
  sellHistory: SellRecord[];
  sellExchangeRate: number;      // 호출부가 fetch/보정 후 주입 (KRW면 1)
  sellPrice: number;             // 자산 통화 기준 매도가
  sellQuantity: number;
  sellDate: string;
  settlementCurrency: Currency;
  transactionId: string;         // 주입 (핸들러=`${Date.now()}`)
}

export interface SellMutationResult {
  sellRecord: SellRecord;
  sellTransaction: SellTransaction;
  nextAssets: Asset[];
  nextSellHistory: SellRecord[];
  assetClosed: boolean;          // 전량 매도로 자산이 제거됐는지
}

/** 매도 → sellRecord/sellTransaction + 차감/제거된 nextAssets + nextSellHistory. (handleConfirmSell 로직 추출) */
export function buildSellMutation(input: SellMutationInput): SellMutationResult {
  const { asset, assets, sellHistory, sellExchangeRate, sellPrice, sellQuantity, sellDate, settlementCurrency, transactionId } = input;

  const sellPriceSettlement = sellPrice;
  const sellPriceOriginal = asset.currency !== Currency.KRW && asset.currency === settlementCurrency
    ? sellPrice
    : sellPrice / sellExchangeRate;

  const sellTransaction: SellTransaction = {
    id: transactionId,
    sellDate,
    sellPrice: sellPrice * sellExchangeRate,
    sellPriceOriginal,
    sellQuantity,
    sellExchangeRate,
    settlementCurrency,
    sellPriceSettlement,
  };

  const sellRecord: SellRecord = {
    ...sellTransaction,
    assetId: asset.id,
    ticker: asset.ticker,
    name: asset.customName?.trim() || asset.name,
    category: asset.category,
    categoryId: asset.categoryId,
    originalPurchasePrice: asset.purchasePrice,
    originalPurchaseExchangeRate: asset.purchaseExchangeRate,
    originalCurrency: asset.currency,
  };

  const newQuantity = asset.quantity - sellQuantity;
  const assetClosed = newQuantity <= 0;
  const nextAssets = assetClosed
    ? assets.filter(a => a.id !== asset.id)
    : assets.map(a => a.id === asset.id
        ? { ...a, quantity: newQuantity, sellTransactions: [...(a.sellTransactions || []), sellTransaction] }
        : a);

  const nextSellHistory = [...sellHistory, sellRecord];

  return { sellRecord, sellTransaction, nextAssets, nextSellHistory, assetClosed };
}

export interface BuyMoreMutationInput {
  asset: Asset;
  assets: Asset[];
  buyExchangeRate: number;       // 호출부 주입 (KRW면 1)
  buyPrice: number;
  buyQuantity: number;
  buyDate: string;
}

export interface BuyMoreMutationResult {
  nextAssets: Asset[];
  updatedAsset: Asset;
}

/** 추가매수 → 가중평균 단가/환율 갱신 + 메모 이력. (handleConfirmBuyMore 로직 추출) */
export function buildBuyMoreMutation(input: BuyMoreMutationInput): BuyMoreMutationResult {
  const { asset, assets, buyExchangeRate, buyPrice, buyQuantity, buyDate } = input;

  const oldQuantity = asset.quantity;
  const oldPrice = asset.purchasePrice;
  const newTotalQuantity = oldQuantity + buyQuantity;
  const newAvgPrice = (oldQuantity * oldPrice + buyQuantity * buyPrice) / newTotalQuantity;

  let newExchangeRate = asset.purchaseExchangeRate;
  if (asset.currency !== Currency.KRW && asset.purchaseExchangeRate) {
    newExchangeRate = (oldQuantity * asset.purchaseExchangeRate + buyQuantity * buyExchangeRate) / newTotalQuantity;
  }

  const d = new Date(buyDate);
  const dateStr = `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;
  const buyMemo = `(${dateStr} ${buyQuantity}주 ${buyPrice.toLocaleString()}${asset.currency !== Currency.KRW ? asset.currency : '원'} 추가매수)`;
  const newMemo = asset.memo ? `${asset.memo}\n${buyMemo}` : buyMemo;

  const updatedAsset: Asset = {
    ...asset,
    quantity: newTotalQuantity,
    purchasePrice: newAvgPrice,
    purchaseExchangeRate: newExchangeRate,
    memo: newMemo,
  };
  const nextAssets = assets.map(a => a.id === asset.id ? updatedAsset : a);

  return { nextAssets, updatedAsset };
}
