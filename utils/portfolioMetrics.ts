// utils/portfolioMetrics.ts
// ---------------------------------------------------------------------------
// 보유/매도 손익 계산의 **단일 순수 모듈**. React 없음·부수효과 없음·저장 없음.
// (구 `hooks/usePortfolioCalculator.ts`의 계산 본체를 그대로 옮긴 것 — 훅은 이제 얇은 래퍼다.)
//
// ## 수익률 기준(PLBasis)
// 같은 데이터에서 두 가지 규약을 만든다. **분기는 "외화 자산 && Upbit/Bithumb 아님"일 때만** 일어나며,
// 그 외 경로(KRW 자산·업비트/빗썸 원화 시세)는 두 모드가 **바이트 동일**이다.
//
//   · 'krw'    (기존) 매입원가=매수 당시 환율, 평가액=오늘 환율 → 환차손익이 수익률에 포함.
//   · 'native' (증권사) 매입원가·평가액 모두 오늘 환율 → 환율이 약분되어 **원통화 수익률**.
//
// 자세한 배경은 `types/valuation.ts`, RULES.md §6 「환율 적용 로직」.
//
// ## 규약 보존 포인트 (건드리면 화면 숫자가 조용히 바뀐다)
//   · 업비트/빗썸은 통화가 USD로 저장돼 있어도 시세가 KRW다 → `currentPriceKRW = currentPrice`.
//     매수단가 환산도 이 경우에는 **항상 'krw' 규칙**을 쓴다(기존 특이 동작 그대로 보존).
//   · `yesterdayChange`는 API `changeRate` 우선(0도 유효값), 없을 때만 전일종가 폴백.
//   · 매도 레코드의 **비정상 환율 보정**(>MAX_REASONABLE_EXCHANGE_RATES)은 **'krw' 경로에만** 적용된다.
//     'native' 경로는 애초에 원통화 단가를 쓰므로 오염된 환율을 타지 않는다.
//   · 매수정보를 복원할 수 없는 매도 건은 실현손익이 **정확히 0** — `soldPLBreakdown.splitRealizedPL`이
//     "0 = 매수정보 없음"으로 보고 이익/손실 건수 양쪽에서 제외한다. 이 0을 다른 값으로 바꾸지 말 것.
//
// 회귀 가드: tests/portfolioMetricsParity.ts (npm run test:metrics).
// ---------------------------------------------------------------------------

import { Asset, AssetSnapshot, Currency, ExchangeRates, SellRecord } from '../types';
import { AssetMetrics, EnrichedAsset } from '../types/ui';
import type { PLBasis } from '../types/valuation';
import { resolveRate } from './exchangeRateCache';
import { splitRealizedPL } from './soldPLBreakdown';

/**
 * 통화별 "이보다 크면 환율이 오염된 것" 상한. FX API가 간헐적으로 손상값을 돌려준 사례에서 나온 안전선.
 * **이 모듈이 단일 정의처** — 다른 파일에서 다시 선언하지 말고 여기서 import 할 것.
 */
export const MAX_REASONABLE_EXCHANGE_RATES: Partial<Record<Currency, number>> = {
  [Currency.USD]: 3000,
  [Currency.JPY]: 50,
  [Currency.CNY]: 400,
};

/** 계산 옵션 — 현재는 수익률 기준 하나. 호출부가 반드시 명시하도록 객체로 받는다. */
export interface ValuationOptions {
  plBasis: PLBasis;
}

// ── 기본 환산 ────────────────────────────────────────────────────────────────

/** 임의 금액을 KRW로 환산. 환율은 현재 → 마지막 정상 캐시 → 0 순으로 폴백(`resolveRate`). */
export const getValueInKRW = (value: number, currency: Currency, exchangeRates: ExchangeRates): number => {
  if (currency === Currency.KRW) return value;
  return value * resolveRate(currency, exchangeRates);
};

/**
 * 매수 단가를 KRW로 환산.
 *   · KRW 자산 → 그대로
 *   · 'native' → 오늘 환율 (환율이 약분되어 수익률이 원통화 기준이 된다)
 *   · 'krw'    → 매수 당시 환율 우선, 없으면 오늘 환율 폴백(레거시 자산 호환)
 */
export const getPurchaseValueInKRW = (
  asset: Asset,
  exchangeRates: ExchangeRates,
  plBasis: PLBasis,
): number => {
  if (asset.currency === Currency.KRW) return asset.purchasePrice;
  if (plBasis === 'native') return getValueInKRW(asset.purchasePrice, asset.currency, exchangeRates);
  if (asset.purchaseExchangeRate && asset.purchaseExchangeRate > 0) {
    return asset.purchasePrice * asset.purchaseExchangeRate;
  }
  return getValueInKRW(asset.purchasePrice, asset.currency, exchangeRates);
};

// ── 보유 자산 메트릭 ─────────────────────────────────────────────────────────

interface DailyChange {
  yesterdayChange: number;
  diffFromYesterday: number;
}

/** 어제 대비 변동 — API `changeRate`(0 포함 유효) 우선, 없을 때만 전일종가 폴백. */
const computeDailyChange = (
  asset: Asset,
  currentPriceKRW: number,
  priceIsKRW: boolean,
  exchangeRates: ExchangeRates,
): DailyChange => {
  if (asset.changeRate != null) {
    const rate = asset.changeRate;
    return {
      yesterdayChange: rate * 100,
      diffFromYesterday: (1 + rate) !== 0 ? currentPriceKRW * (rate / (1 + rate)) : 0,
    };
  }

  // 폴백: changeRate 없는 레거시 데이터
  const yesterdayPrice = asset.previousClosePrice || 0;
  const yesterdayPriceKRW = priceIsKRW
    ? (asset.currency === Currency.USD ? yesterdayPrice * (exchangeRates.USD || 1) : yesterdayPrice)
    : getValueInKRW(yesterdayPrice, asset.currency, exchangeRates);

  if (yesterdayPriceKRW <= 0) return { yesterdayChange: 0, diffFromYesterday: 0 };
  return {
    yesterdayChange: ((currentPriceKRW - yesterdayPriceKRW) / yesterdayPriceKRW) * 100,
    diffFromYesterday: currentPriceKRW - yesterdayPriceKRW,
  };
};

/**
 * 업비트/빗썸 여부 — 통화 설정과 무관하게 API가 **KRW 시세**를 주는 거래소.
 *
 * 이 경우 `currentPrice`가 이미 원화라 환율을 곱하면 안 되고, 달러 모드 분기도 타지 않는다.
 * **판정식을 다른 파일에서 다시 쓰지 말고 이 함수를 import 할 것** — 사본이 갈라지면
 * 화면(metrics)과 이력 스냅샷이 서로 다른 자산을 "외화"로 보게 된다.
 */
export const isKRWExchange = (exchange: string | undefined): boolean =>
  exchange === 'Upbit' || exchange === 'Bithumb';

/** 자산 1건의 표시용 메트릭 전체. `totalPortfolioValue`가 0이면 `allocation`은 0. */
export const computeAssetMetrics = (
  asset: Asset,
  exchangeRates: ExchangeRates,
  totalPortfolioValue: number,
  options: ValuationOptions,
): EnrichedAsset => {
  const priceIsKRW = isKRWExchange(asset.exchange);

  const currentPriceKRW = priceIsKRW
    ? asset.currentPrice
    : getValueInKRW(asset.currentPrice, asset.currency, exchangeRates);
  const currentValueKRW = currentPriceKRW * asset.quantity;

  // 달러 모드 분기는 여기 한 줄에만 있다 — 나머지 경로는 두 모드가 동일 코드.
  const useNative = options.plBasis === 'native' && asset.currency !== Currency.KRW && !priceIsKRW;

  const purchasePriceKRW = getPurchaseValueInKRW(asset, exchangeRates, useNative ? 'native' : 'krw');
  const purchaseValueKRW = purchasePriceKRW * asset.quantity;

  // 원통화 값 (개별 자산 표시용)
  const currentValue = asset.currentPrice * asset.quantity;
  const purchaseValue = asset.purchasePrice * asset.quantity;
  const profitLoss = currentValue - purchaseValue;

  const profitLossKRW = useNative
    ? profitLoss * resolveRate(asset.currency, exchangeRates)
    : currentValueKRW - purchaseValueKRW;

  const returnPercentage = useNative
    ? (purchaseValue === 0 ? 0 : (profitLoss / purchaseValue) * 100)
    : (purchaseValueKRW === 0 ? 0 : (profitLossKRW / purchaseValueKRW) * 100);

  const { yesterdayChange, diffFromYesterday } =
    computeDailyChange(asset, currentPriceKRW, priceIsKRW, exchangeRates);

  const allocation = totalPortfolioValue === 0 ? 0 : (currentValueKRW / totalPortfolioValue) * 100;
  const dropFromHigh = asset.highestPrice === 0
    ? 0
    : ((asset.currentPrice - asset.highestPrice) / asset.highestPrice) * 100;
  const diffFromHigh = asset.currentPrice - asset.highestPrice;

  const metrics: AssetMetrics = {
    purchasePrice: asset.purchasePrice,
    currentPrice: asset.currentPrice,
    currentPriceKRW,
    purchasePriceKRW,
    purchaseValue, currentValue, purchaseValueKRW, currentValueKRW,
    returnPercentage, allocation, dropFromHigh, profitLoss, profitLossKRW,
    diffFromHigh, yesterdayChange, diffFromYesterday,
  };

  return { ...asset, metrics };
};

export interface PortfolioStats {
  totalValue: number;
  totalPurchaseValue: number;
  totalGainLoss: number;
  totalReturn: number;
}

/** 보유 자산 합산(평가액/원금/손익/수익률). allocation은 여기서 쓰지 않으므로 0으로 계산한다. */
export const computePortfolioStats = (
  assets: Asset[],
  exchangeRates: ExchangeRates,
  options: ValuationOptions,
): PortfolioStats => {
  const processed = assets.map(asset => computeAssetMetrics(asset, exchangeRates, 0, options));
  const totalValue = processed.reduce((sum, a) => sum + a.metrics.currentValueKRW, 0);
  const totalPurchaseValue = processed.reduce((sum, a) => sum + a.metrics.purchaseValueKRW, 0);
  const totalGainLoss = totalValue - totalPurchaseValue;
  const totalReturn = totalPurchaseValue === 0 ? 0 : (totalGainLoss / totalPurchaseValue) * 100;

  return { totalValue, totalPurchaseValue, totalGainLoss, totalReturn };
};

// ── 매도(실현손익) ───────────────────────────────────────────────────────────

export interface SoldRecordPL {
  /** 판정에 쓰인 통화(원통화). 정보를 복원할 수 없으면 KRW. */
  currency: Currency;
  sellAmountKRW: number;
  purchaseValueKRW: number;
  /** 실현손익(KRW). **매수정보가 없으면 정확히 0** — splitRealizedPL이 건수에서 제외하는 신호. */
  realizedKRW: number;
  /** 실현손익(원통화). 원통화 값을 복원할 수 없는 경로에서는 `null`(= 미산출). */
  realizedNative: number | null;
  hasCostBasis: boolean;
}

/**
 * SellRecord 1건의 KRW 매도금액 — 'krw' 경로 전용.
 * 매도일 환율이 상한을 넘는 손상값이면 원통화 단가 × **현재 환율**로 재환산한다.
 */
const getSellAmountKRW = (record: SellRecord, exchangeRates: ExchangeRates): number => {
  const currency = record.settlementCurrency;
  if (currency && currency !== Currency.KRW && record.sellPriceOriginal && record.sellPriceOriginal > 0) {
    const maxRate = MAX_REASONABLE_EXCHANGE_RATES[currency];
    if (maxRate && record.sellExchangeRate && record.sellExchangeRate > maxRate) {
      const currentRate = currency === Currency.USD ? (exchangeRates.USD || 0)
        : currency === Currency.JPY ? (exchangeRates.JPY || 0) : 0;
      if (currentRate > 0) {
        return record.sellPriceOriginal * currentRate * record.sellQuantity;
      }
    }
  }
  return record.sellPrice * record.sellQuantity;
};

/** 'krw' 경로의 매수원가(KRW) — 저장된 매수원본 → 보유 자산 폴백 → 복원 불가(=매도금액) 순. */
const krwCostBasis = (
  record: SellRecord,
  liveAsset: Asset | undefined,
  sellAmountKRW: number,
): { purchaseValueKRW: number; hasCostBasis: boolean } => {
  // 1. 저장된 매수 원본 정보
  if (record.originalPurchasePrice && record.originalPurchasePrice > 0) {
    const currency = record.originalCurrency || Currency.KRW;
    const rate = record.originalPurchaseExchangeRate || 1;
    const value = currency === Currency.KRW
      ? record.originalPurchasePrice * record.sellQuantity
      : record.originalPurchasePrice * rate * record.sellQuantity;
    return { purchaseValueKRW: value, hasCostBasis: true };
  }

  // 2. 저장 정보가 없고 현재 보유 자산이 남아 있는 경우 (구 레코드 호환)
  if (liveAsset) {
    if (liveAsset.currency === Currency.KRW) {
      return { purchaseValueKRW: liveAsset.purchasePrice * record.sellQuantity, hasCostBasis: true };
    }
    if (liveAsset.purchaseExchangeRate) {
      return {
        purchaseValueKRW: liveAsset.purchasePrice * liveAsset.purchaseExchangeRate * record.sellQuantity,
        hasCostBasis: true,
      };
    }
    if (liveAsset.priceOriginal > 0) {
      const impliedRate = liveAsset.currentPrice / liveAsset.priceOriginal;
      return { purchaseValueKRW: liveAsset.purchasePrice * impliedRate * record.sellQuantity, hasCostBasis: true };
    }
    return { purchaseValueKRW: liveAsset.purchasePrice * record.sellQuantity, hasCostBasis: true };
  }

  // 3. 자산도 삭제되고 이력에도 매수 정보가 없음 → 매수금액=매도금액으로 두어 실현손익 0 고정
  return { purchaseValueKRW: sellAmountKRW, hasCostBasis: false };
};

/** 매도 레코드의 원통화 판정 — 저장된 원본 통화 → 보유 자산 → 결제 통화 → KRW. */
const resolveRecordCurrency = (record: SellRecord, liveAsset: Asset | undefined): Currency =>
  record.originalCurrency ?? liveAsset?.currency ?? record.settlementCurrency ?? Currency.KRW;

/** 'native' 경로의 매도 단가(원통화). 복원 불가면 undefined → 'krw' 경로로 폴백한다. */
const nativeSellUnit = (record: SellRecord, currency: Currency): number | undefined => {
  if (record.sellPriceOriginal && record.sellPriceOriginal > 0) return record.sellPriceOriginal;
  if (record.settlementCurrency === currency && record.sellPriceSettlement && record.sellPriceSettlement > 0) {
    return record.sellPriceSettlement;
  }
  if (record.sellExchangeRate && record.sellExchangeRate > 0) return record.sellPrice / record.sellExchangeRate;
  return undefined;
};

/** 'native' 경로의 매수 단가(원통화). 없으면 undefined → 실현손익 0 + hasCostBasis:false. */
const nativeBuyUnit = (record: SellRecord, liveAsset: Asset | undefined, currency: Currency): number | undefined => {
  if (record.originalPurchasePrice && record.originalPurchasePrice > 0) return record.originalPurchasePrice;
  if (liveAsset && liveAsset.currency === currency) return liveAsset.purchasePrice;
  return undefined;
};

const computeSoldRecordPLKRW = (
  record: SellRecord,
  liveAsset: Asset | undefined,
  exchangeRates: ExchangeRates,
  currency: Currency,
): SoldRecordPL => {
  const sellAmountKRW = getSellAmountKRW(record, exchangeRates);
  const { purchaseValueKRW, hasCostBasis } = krwCostBasis(record, liveAsset, sellAmountKRW);
  const realizedKRW = sellAmountKRW - purchaseValueKRW;
  return {
    currency,
    sellAmountKRW,
    purchaseValueKRW,
    realizedKRW,
    // KRW 자산은 원통화 = KRW이므로 그대로. 외화의 'krw' 경로는 원통화 값이 정의되지 않는다.
    realizedNative: currency === Currency.KRW ? realizedKRW : null,
    hasCostBasis,
  };
};

/**
 * 매도 레코드 1건의 실현손익.
 *
 * 'native' 모드라도 **통화가 KRW이거나 매도 원통화 단가를 복원할 수 없으면 'krw' 경로로 폴백**한다
 * → 레거시 레코드(`{id,ticker,sellPrice,sellDate,sellQuantity}`)는 두 모드에서 바이트 동일.
 *
 * 'native' 경로에서는 매도·매수를 모두 **오늘 환율**로 환산하므로
 * `sellAmountKRW − purchaseValueKRW === realizedKRW` 항등식이 유지된다(카드 3줄이 서로 안 어긋남).
 */
export const computeSoldRecordPL = (
  record: SellRecord,
  liveAsset: Asset | undefined,
  exchangeRates: ExchangeRates,
  plBasis: PLBasis,
): SoldRecordPL => {
  const currency = resolveRecordCurrency(record, liveAsset);

  if (plBasis !== 'native' || currency === Currency.KRW) {
    return computeSoldRecordPLKRW(record, liveAsset, exchangeRates, currency);
  }

  const sellUnit = nativeSellUnit(record, currency);
  if (sellUnit === undefined) {
    return computeSoldRecordPLKRW(record, liveAsset, exchangeRates, currency);
  }

  const rate = resolveRate(currency, exchangeRates);
  const sellAmountKRW = sellUnit * record.sellQuantity * rate;
  const buyUnit = nativeBuyUnit(record, liveAsset, currency);

  if (buyUnit === undefined) {
    // 매수정보 없음 → 실현손익 정확히 0 (splitRealizedPL이 건수에서 제외)
    return {
      currency,
      sellAmountKRW,
      purchaseValueKRW: sellAmountKRW,
      realizedKRW: 0,
      realizedNative: null,
      hasCostBasis: false,
    };
  }

  const realizedNative = (sellUnit - buyUnit) * record.sellQuantity;
  return {
    currency,
    sellAmountKRW,
    purchaseValueKRW: buyUnit * record.sellQuantity * rate,
    realizedKRW: realizedNative * rate,
    realizedNative,
    hasCostBasis: true,
  };
};

export interface SoldAssetsStats {
  totalSoldAmount: number;
  totalSoldPurchaseValue: number;
  totalSoldProfit: number;
  soldReturn: number;
  soldCount: number;
  grossProfit: number;
  grossLoss: number;
  profitCount: number;
  lossCount: number;
}

/**
 * 매도 이력 합계 + 이익/손실 분해.
 * `exchangeRates`는 **필수** — 기본값을 두면 호출부가 실제 환율을 잊어도 조용히 다른 숫자가 나온다.
 * (기본값 `{USD:1450, JPY:9.5}`는 기존 호출부 호환을 위해 훅 래퍼에만 남겨 둔다.)
 */
export const computeSoldAssetsStats = (
  sellHistory: SellRecord[],
  assets: Asset[],
  exchangeRates: ExchangeRates,
  options: ValuationOptions,
): SoldAssetsStats => {
  const perRecord = sellHistory.map(record =>
    computeSoldRecordPL(record, assets.find(a => a.id === record.assetId), exchangeRates, options.plBasis));

  const totalSoldAmount = perRecord.reduce((sum, r) => sum + r.sellAmountKRW, 0);
  const totalSoldPurchaseValue = perRecord.reduce((sum, r) => sum + r.purchaseValueKRW, 0);
  const totalSoldProfit = totalSoldAmount - totalSoldPurchaseValue;
  const soldReturn = totalSoldPurchaseValue === 0 ? 0 : (totalSoldProfit / totalSoldPurchaseValue) * 100;
  const breakdown = splitRealizedPL(perRecord.map(r => r.realizedKRW));

  return {
    totalSoldAmount,
    totalSoldPurchaseValue,
    totalSoldProfit,
    soldReturn,
    soldCount: sellHistory.length,
    ...breakdown,
  };
};

// ── 이력 스냅샷 ──────────────────────────────────────────────────────────────

/**
 * 이력 스냅샷 1건의 **투자 원금(KRW)** 을 현재 수익률 기준으로 파생한다 (순수).
 *
 * 저장된 `purchaseValue`는 **항상 원화 기준**(매수 당시 환율)이다 —
 * `historyUtils.repairCorruptedSnapshots`의 손상 판정(`|currentValue/purchaseValue| >= 10`)과
 * 이미 쌓인 데이터의 의미를 보존하기 위해 기록 규약은 바꾸지 않았다.
 * 달러 모드에서는 그날의 환율로 다시 환산해야 하는데, 스냅샷에 환율은 없지만
 * `currentValue / unitPriceOriginal === quantity × rate(그날)` 이므로 **환율이 정확히 약분된다**:
 *
 *     purchaseUnitOriginal × currentValue / unitPriceOriginal
 *   = purchaseUnitOriginal × quantity × rate(그날)
 *
 * 파생 조건을 하나라도 만족하지 못하면(KRW 자산·구 스냅샷·매수 전 0행) **저장값 그대로**.
 * ※ 이 함수를 `utils/historyUtils.ts`에 두지 않는 이유: 그 파일은 services를 import 한다(순수 아님).
 */
export const deriveSnapshotPurchaseValue = (snapshotAsset: AssetSnapshot, plBasis: PLBasis): number => {
  if (plBasis !== 'native') return snapshotAsset.purchaseValue;
  const { currency, purchaseUnitOriginal, unitPriceOriginal, currentValue, purchaseValue } = snapshotAsset;
  if (!currency || currency === Currency.KRW) return purchaseValue;
  if (!purchaseUnitOriginal || purchaseUnitOriginal <= 0) return purchaseValue;
  if (!unitPriceOriginal || unitPriceOriginal <= 0) return purchaseValue;
  return (purchaseUnitOriginal * currentValue) / unitPriceOriginal;
};

// ── 알림 ─────────────────────────────────────────────────────────────────────

/** 최고가 대비 하락률이 임계(자산별 > 전역)를 넘은 자산 수. 환율 무관(원통화 비율). */
export const computeAlertCount = (assets: Asset[], globalSellAlertDropRate: number): number =>
  assets.filter(asset => {
    if (asset.highestPrice === 0) return false;
    const dropFromHigh = ((asset.currentPrice - asset.highestPrice) / asset.highestPrice) * 100;
    const alertRate = asset.sellAlertDropRate ?? globalSellAlertDropRate;
    return dropFromHigh <= -alertRate;
  }).length;
