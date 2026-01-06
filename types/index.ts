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

export interface WatchlistItem {
  id: string;
  ticker: string;
  exchange: string;
  name: string;
  category: AssetCategory;
  monitoringEnabled: boolean;
  notes?: string;
  buyZoneMin?: number;
  buyZoneMax?: number;
  dropFromHighThreshold?: number;
  currentPrice?: number;
  priceOriginal?: number;
  currency?: Currency;
  previousClosePrice?: number; // Renamed from yesterdayPrice
  highestPrice?: number;
  lastSignalAt?: string;
  lastSignalType?: 'BUY_ZONE' | 'DROP_FROM_HIGH' | 'DAILY_DROP' | null;
  changeRate?: number;
  indicators?: Indicators;
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
  category: AssetCategory;
}

export interface Asset {
  id: string;
  category: AssetCategory;
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

export interface AssetSnapshot {
  id: string;
  name: string;
  currentValue: number;
  purchaseValue: number;
  unitPrice?: number; 
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

export interface LegacyAssetShape {
  id?: string;
  category: AssetCategory | string;
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
  sellAlertDropRate?: number;
  memo?: string;
  region?: string;
}
