export enum AssetCategory {
  KOREAN_STOCK = "한국주식",
  US_STOCK = "미국주식",
  FOREIGN_STOCK = "해외주식",
  OTHER_FOREIGN_STOCK = "기타해외주식",
  KOREAN_BOND = "한국채권",
  US_BOND = "미국채권",
  PHYSICAL_ASSET = "실물자산",
  CRYPTOCURRENCY = "암호화폐",
  CASH = "현금",
}

export enum Currency {
    KRW = "KRW",
    USD = "USD",
    JPY = "JPY",
    CNY = "CNY",
}

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
    [Currency.KRW]: "₩",
    [Currency.USD]: "$",
    [Currency.JPY]: "¥",
    [Currency.CNY]: "¥",
};

export interface ExchangeRates {
  USD: number;
  JPY: number;
}

export const COMMON_EXCHANGES: string[] = [
  "KRX (코스피/코스닥)",
  "KONEX",
  "NASDAQ",
  "NYSE",
  "TSE (도쿄)",
  "SSE (상하이)",
  "HKEX (홍콩)",
  "KRX 금시장",
  "COMEX",
  "NYMEX",
  "주요 거래소 (종합)"
];

export const ALL_EXCHANGES: string[] = [
  "KRX (코스피/코스닥)",
  "KONEX",
  "NASDAQ",
  "NYSE",
  "AMEX",
  "NYSE American",
  "TSE (도쿄)",
  "SSE (상하이)",
  "SZSE (선전)",
  "HKEX (홍콩)",
  "KRX 금시장",
  "COMEX",
  "LBMA",
  "NYMEX",
  "CME",
  "ICE",
  "주요 거래소 (종합)"
];

export const inferCategoryFromExchange = (exchange: string): AssetCategory => {
  if (exchange.includes('KRX') || exchange.includes('KONEX')) {
    return AssetCategory.KOREAN_STOCK;
  } else if (['NASDAQ', 'NYSE', 'AMEX', 'NYSE American'].includes(exchange)) {
    return AssetCategory.US_STOCK;
  } else if (exchange.includes('TSE') || exchange.includes('도쿄')) {
    return AssetCategory.FOREIGN_STOCK;
  } else if (exchange.includes('SSE') || exchange.includes('SZSE') || exchange.includes('HKEX') || exchange.includes('상하이') || exchange.includes('선전') || exchange.includes('홍콩')) {
    return AssetCategory.FOREIGN_STOCK;
  } else if (exchange.includes('국채')) {
    if (exchange.includes('한국') || exchange.includes('대한민국')) {
      return AssetCategory.KOREAN_BOND;
    } else if (exchange.includes('미국')) {
      return AssetCategory.US_BOND;
    }
  } else if (exchange.includes('금') || exchange.includes('COMEX') || exchange.includes('LBMA') || exchange.includes('NYMEX') || exchange.includes('CME') || exchange.includes('ICE')) {
    return AssetCategory.PHYSICAL_ASSET;
  } else if (exchange.includes('거래소 (종합)')) {
    return AssetCategory.CRYPTOCURRENCY;
  }
  return AssetCategory.OTHER_FOREIGN_STOCK;
};

export const EXCHANGE_MAP: Record<string, string[]> = {
    [AssetCategory.KOREAN_STOCK]: ["KRX (코스피/코스닥)", "KONEX"],
    [AssetCategory.US_STOCK]: ["NASDAQ", "NYSE", "AMEX", "NYSE American"],
    [AssetCategory.FOREIGN_STOCK]: ["TSE (도쿄)", "SSE (상하이)", "SZSE (선전)", "HKEX (홍콩)"],
    [AssetCategory.OTHER_FOREIGN_STOCK]: ["TSE (도쿄)", "SSE (상하이)", "SZSE (선전)", "HKEX (홍콩)"],
    [AssetCategory.KOREAN_BOND]: ["대한민국 국채"],
    [AssetCategory.US_BOND]: ["미국 국채"],
    [AssetCategory.PHYSICAL_ASSET]: ["KRX 금시장", "COMEX", "LBMA", "NYMEX", "CME", "ICE"],
    [AssetCategory.CRYPTOCURRENCY]: ["주요 거래소 (종합)"],
    [AssetCategory.CASH]: ["현금"],
};

export const ALLOWED_CATEGORIES: AssetCategory[] = [
  AssetCategory.KOREAN_STOCK,
  AssetCategory.US_STOCK,
  AssetCategory.OTHER_FOREIGN_STOCK,
  AssetCategory.KOREAN_BOND,
  AssetCategory.US_BOND,
  AssetCategory.CRYPTOCURRENCY,
  AssetCategory.PHYSICAL_ASSET,
];

export const normalizeExchange = (exchange: string): string => {
  const e = exchange.trim();
  if (e.toUpperCase() === 'AMEX' || e.toUpperCase() === 'NYSE MKT') return 'NYSE American';
  if (e.toUpperCase() === 'NYSE AMERICAN') return 'NYSE American';
  return e;
};

import type { Indicators } from './api';
import type { BucketId } from './bucket';
import type { CleanupTag } from './cleanup';

export interface WatchlistItem {
  id: string;
  ticker: string;
  exchange: string;
  name: string;
  categoryId: number;
  category?: AssetCategory; // deprecated: 마이그레이션 호환용
  notes?: string;
  pinned?: boolean;
  currentPrice?: number;
  priceOriginal?: number;
  currency?: Currency;
  previousClosePrice?: number;
  highestPrice?: number;
  changeRate?: number;
  yesterdayChange?: number;   // 어제대비 변동률 (%), hooks에서 사전 계산
  indicators?: Indicators;
  /** 터틀 진입 후보 — true면 실행 큐 생성기가 55일 돌파 매수를 감시 (90/10 Phase 2). 미지정=false */
  isTurtleCandidate?: boolean;
}

export interface SellTransaction {
  id: string;
  sellDate: string;
  sellPrice: number;
  sellPriceOriginal?: number;
  sellQuantity: number;
  sellExchangeRate?: number;
  settlementCurrency?: Currency;
  sellPriceSettlement?: number;
}

export interface SellRecord extends SellTransaction {
  assetId: string;
  ticker: string;
  name: string;
  categoryId: number;
  category?: AssetCategory; // deprecated: 마이그레이션 호환용
  originalPurchasePrice?: number;
  originalPurchaseExchangeRate?: number;
  originalCurrency?: Currency;
}

export interface Asset {
  id: string;
  categoryId: number;
  category?: AssetCategory; // deprecated: 마이그레이션 호환용
  ticker: string;
  exchange: string;
  name: string;
  customName?: string;
  quantity: number;
  purchasePrice: number;
  purchaseDate: string;
  currency: Currency;
  purchaseExchangeRate?: number;
  currentPrice: number;
  priceOriginal: number;
  highestPrice: number;
  previousClosePrice?: number; // Renamed from yesterdayPrice
  sellAlertDropRate?: number;
  memo?: string;
  pinned?: boolean;
  /** 전략 버킷 (코어=자산배분 본체 / 투더문=개별 위성). 미지정=코어. categoryId와 직교. */
  bucket?: BucketId;
  /** 대청소 분류 확정 태그 (Phase 3). **미지정=미검토**(≠'keep'). 기본값 강제 주입 금지 */
  cleanupTag?: CleanupTag;
  /** 가족('유선') 등 의사결정 밖 자산 — 대청소 후보에서 제외. **미지정=false로 해석**(false를 저장하지 않음) */
  excludedFromCleanup?: boolean;
  sellTransactions?: SellTransaction[];
  changeRate?: number;
  indicators?: Indicators;
}

export type NewAssetForm = Omit<Asset, 'id' | 'name' | 'currentPrice' | 'priceOriginal' | 'highestPrice' | 'purchaseExchangeRate' | 'previousClosePrice'>;

export interface SymbolSearchResult {
  ticker: string;
  name: string;
  exchange: string;
}

export interface BulkUploadResult {
  successCount: number;
  failedCount: number;
  errors: { ticker: string; reason: string }[];
}

// [수정] AssetSnapshot에 외화 원본 가격 필드 추가
export interface AssetSnapshot {
  id: string;
  name: string;
  currentValue: number;      // 원화 환산 평가액
  purchaseValue: number;     // 원화 환산 매수액
  unitPrice?: number;        // 원화 환산 단가 (KRW)
  unitPriceOriginal?: number; // [추가] 외화 원본 단가 (USD, JPY 등)
  currency?: Currency;        // [추가] 통화 정보
}

export interface PortfolioSnapshot {
  date: string;
  assets: AssetSnapshot[];
}

export interface DriveFileMetadata {
  name: string;
  mimeType: string;
  parents?: string[];
}

/**
 * 리밸런싱 대표 매수 종목 (Phase 4b) — 코어 카테고리가 목표 대비 부족할 때 "무엇을 살지".
 * categoryId별 1개 지정. currency/name은 지정 시 보유 종목에서 채우거나(있으면) 미지정(4b-3에서 가격 fetch로 확정).
 */
export interface RebalanceInstrument {
  ticker: string;
  exchange: string;
  categoryId: number;
  name?: string;
  currency?: Currency;
}

export interface AllocationTargets {
  /** 카테고리 목표 비중(%). 코어 버킷 내부 기준(코어 합계=100%로 운용). 키=categoryId 문자열 */
  weights: Record<string, number>;
  targetTotalAmount?: number;
  /** 전략 버킷 목표 비중(%). 키='CORE'|'SATELLITE'. 미설정=레거시(전부 코어) */
  bucketWeights?: Record<string, number>;
  /** 카테고리별 대표 매수 종목 (Phase 4b). 키=categoryId 문자열. 미지정 카테고리는 리밸런싱 매수 스킵 */
  categoryInstruments?: Record<string, RebalanceInstrument>;
}

export interface LegacyAssetShape {
  id?: string;
  categoryId?: number;
  category: AssetCategory | string; // still required for legacy data parsing
  ticker: string;
  exchange?: string;
  name: string;
  customName?: string;
  quantity: number;
  purchasePrice: number;
  purchaseDate: string;
  currency?: Currency;
  purchaseExchangeRate?: number;
  currentPrice: number;
  priceOriginal?: number;
  highestPrice?: number;
  yesterdayPrice?: number; // Keep for migration
  previousClosePrice?: number; // Keep for migration
  sellAlertDropRate?: number;
  memo?: string;
  bucket?: BucketId;
  cleanupTag?: CleanupTag;
  excludedFromCleanup?: boolean;
  region?: string;
}