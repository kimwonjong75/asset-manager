export enum AssetCategory {
  KOREAN_STOCK = "한국주식",
  US_STOCK = "미국주식",
  OTHER_FOREIGN_STOCK = "기타 해외주식",
  BOND = "채권",
  CRYPTOCURRENCY = "암호화폐",
  GOLD = "금",
  COMMODITIES = "원자재",
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

export const EXCHANGE_MAP: Record<string, string[]> = {
    [AssetCategory.KOREAN_STOCK]: ["KRX (코스피/코스닥)", "KONEX"],
    [AssetCategory.US_STOCK]: ["NASDAQ", "NYSE", "AMEX"],
    [AssetCategory.OTHER_FOREIGN_STOCK]: ["TSE (도쿄)", "SSE (상하이)", "SZSE (선전)", "HKEX (홍콩)"],
    [AssetCategory.CRYPTOCURRENCY]: ["주요 거래소 (종합)"],
    [AssetCategory.BOND]: ["대한민국 국채", "미국 국채"],
    [AssetCategory.GOLD]: ["KRX 금시장", "COMEX", "LBMA"],
    [AssetCategory.COMMODITIES]: ["NYMEX", "CME", "ICE"],
    [AssetCategory.CASH]: ["현금"],
};


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
  sellAlertDropRate?: number;
  memo?: string; // 종목 메모
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