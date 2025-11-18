// 지역 기반 자산 구분 (퀀트 전략 분석용)
export enum AssetRegion {
  KOREA = "한국",
  USA = "미국",
  JAPAN = "일본",
  CHINA = "중국",
  GOLD = "금",
  COMMODITIES = "원자재",
  CRYPTOCURRENCY = "암호화폐",
  CASH = "현금",
}

// 기존 호환성을 위한 카테고리 (내부적으로 사용)
export enum AssetCategory {
  KOREAN_STOCK = "한국주식",
  US_STOCK = "미국주식",
  JAPAN_STOCK = "일본주식",
  CHINA_STOCK = "중국주식",
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

// 지역별 거래소 매핑
export const REGION_EXCHANGE_MAP: Record<AssetRegion, string[]> = {
    [AssetRegion.KOREA]: ["KRX (코스피/코스닥)", "KONEX"],
    [AssetRegion.USA]: ["NASDAQ", "NYSE", "AMEX"],
    [AssetRegion.JAPAN]: ["TSE (도쿄)"],
    [AssetRegion.CHINA]: ["SSE (상하이)", "SZSE (선전)", "HKEX (홍콩)"],
    [AssetRegion.GOLD]: ["KRX 금시장", "COMEX", "LBMA"],
    [AssetRegion.COMMODITIES]: ["NYMEX", "CME", "ICE"],
    [AssetRegion.CRYPTOCURRENCY]: ["주요 거래소 (종합)"],
    [AssetRegion.CASH]: ["현금"],
};

// 기존 호환성을 위한 EXCHANGE_MAP
export const EXCHANGE_MAP: Record<string, string[]> = {
    [AssetCategory.KOREAN_STOCK]: ["KRX (코스피/코스닥)", "KONEX"],
    [AssetCategory.US_STOCK]: ["NASDAQ", "NYSE", "AMEX"],
    [AssetCategory.JAPAN_STOCK]: ["TSE (도쿄)"],
    [AssetCategory.CHINA_STOCK]: ["SSE (상하이)", "SZSE (선전)", "HKEX (홍콩)"],
    [AssetCategory.OTHER_FOREIGN_STOCK]: ["TSE (도쿄)", "SSE (상하이)", "SZSE (선전)", "HKEX (홍콩)"],
    [AssetCategory.CRYPTOCURRENCY]: ["주요 거래소 (종합)"],
    [AssetCategory.BOND]: ["대한민국 국채", "미국 국채"],
    [AssetCategory.GOLD]: ["KRX 금시장", "COMEX", "LBMA"],
    [AssetCategory.COMMODITIES]: ["NYMEX", "CME", "ICE"],
    [AssetCategory.CASH]: ["현금"],
};

// 지역과 카테고리 매핑
export const REGION_TO_CATEGORY: Record<AssetRegion, AssetCategory> = {
    [AssetRegion.KOREA]: AssetCategory.KOREAN_STOCK,
    [AssetRegion.USA]: AssetCategory.US_STOCK,
    [AssetRegion.JAPAN]: AssetCategory.JAPAN_STOCK,
    [AssetRegion.CHINA]: AssetCategory.CHINA_STOCK,
    [AssetRegion.GOLD]: AssetCategory.GOLD,
    [AssetRegion.COMMODITIES]: AssetCategory.COMMODITIES,
    [AssetRegion.CRYPTOCURRENCY]: AssetCategory.CRYPTOCURRENCY,
    [AssetRegion.CASH]: AssetCategory.CASH,
};


export interface Asset {
  id: string;
  category: AssetCategory;
  region?: AssetRegion; // 지역 정보 (퀀트 전략 분석용)
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