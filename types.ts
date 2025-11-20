// 기존 호환성을 위한 카테고리 (내부적으로 사용)
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

// 자주 사용되는 거래소 리스트 (정리된 버전)
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

// 모든 거래소 통합 리스트 (지역과 독립적으로 선택 가능)
export const ALL_EXCHANGES: string[] = [
  "KRX (코스피/코스닥)",
  "KONEX",
  "NASDAQ",
  "NYSE",
  "AMEX",
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

// 거래소에서 자산구분 자동 추론 함수
export const inferCategoryFromExchange = (exchange: string): AssetCategory => {
  if (exchange.includes('KRX') || exchange.includes('KONEX')) {
    return AssetCategory.KOREAN_STOCK;
  } else if (['NASDAQ', 'NYSE', 'AMEX'].includes(exchange)) {
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
  return AssetCategory.OTHER_FOREIGN_STOCK; // 기본값
};

// 기존 호환성을 위한 EXCHANGE_MAP
export const EXCHANGE_MAP: Record<string, string[]> = {
    [AssetCategory.KOREAN_STOCK]: ["KRX (코스피/코스닥)", "KONEX"],
    [AssetCategory.US_STOCK]: ["NASDAQ", "NYSE", "AMEX"],
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


export interface SellTransaction {
  id: string;
  sellDate: string;
  sellPrice: number; // In KRW
  sellPriceOriginal?: number; // In original currency
  sellQuantity: number;
  sellExchangeRate?: number; // Exchange rate at sellDate
}

export interface Asset {
  id: string;
  category: AssetCategory;
  ticker: string;
  exchange: string;
  name: string;
  quantity: number;
  purchasePrice: number; // In original currency
  purchaseDate: string;
  currency: Currency;
  purchaseExchangeRate?: number; // Historical exchange rate at purchaseDate (e.g., KRW per 1 unit of currency)
  currentPrice: number; // In KRW
  priceOriginal: number; // In original currency
  highestPrice: number; // In KRW
  yesterdayPrice?: number; // In KRW - 어제 종가
  sellAlertDropRate?: number;
  memo?: string; // 종목 메모
  sellTransactions?: SellTransaction[]; // 매도 내역
}

export type NewAssetForm = Omit<Asset, 'id' | 'name' | 'currentPrice' | 'priceOriginal' | 'highestPrice' | 'purchaseExchangeRate'>;

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
}
export interface PortfolioSnapshot {
  date: string;
  assets: AssetSnapshot[];
}