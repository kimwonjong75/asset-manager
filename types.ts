// types.ts - 수정된 전체 파일

export enum AssetCategory {
  KOREAN_STOCK = '한국주식',
  US_STOCK = '미국주식',
  FOREIGN_STOCK = '기타해외주식',
  CRYPTOCURRENCY = '암호화폐',
  PHYSICAL_ASSET = '실물자산',
  US_BOND = '미국채권',
}

export const ALLOWED_CATEGORIES = [
  AssetCategory.KOREAN_STOCK,
  AssetCategory.US_STOCK,
  AssetCategory.FOREIGN_STOCK,
  AssetCategory.CRYPTOCURRENCY,
  AssetCategory.PHYSICAL_ASSET,
  AssetCategory.US_BOND,
];

export enum Currency {
  KRW = 'KRW',
  USD = 'USD',
  JPY = 'JPY',
}

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  [Currency.KRW]: '₩',
  [Currency.USD]: '$',
  [Currency.JPY]: '¥',
};

// 환율 타입 (추가)
export interface ExchangeRates {
  USD: number;  // 원/달러 환율 (예: 1400)
  JPY: number;  // 원/엔 환율 (예: 9.5)
}

export interface Asset {
  id: string;
  ticker: string;
  exchange: string;
  name: string;
  customName?: string;
  quantity: number;
  purchasePrice: number;      // 원래 통화 기준 매수가
  purchaseDate: string;
  category: AssetCategory;
  currency: Currency;
  currentPrice: number;       // ✅ 원래 통화 기준 현재가 (수정됨!)
  highestPrice: number;       // ✅ 원래 통화 기준 최고가 (수정됨!)
  yesterdayPrice?: number;    // 원래 통화 기준 전일가
  memo?: string;
  sellAlertDropRate?: number;
  sellTransactions?: SellTransaction[];
  originalData?: string;      // 원본 데이터 (참조용)
  
  // ❌ 삭제된 필드들 (마이그레이션 후 제거):
  // priceOriginal?: number;        // 제거됨
  // purchaseExchangeRate?: number; // 제거됨
  // metrics?: any;                 // 제거됨 (계산 시 생성)
}

export interface SellTransaction {
  id: string;
  sellDate: string;
  sellPrice: number;          // 자산 통화 기준 매도가
  sellQuantity: number;
  currency: Currency;         // 매도 통화 (= 자산 통화)
  
  // 이전 버전 호환용 (선택적)
  sellPriceOriginal?: number;
  sellExchangeRate?: number;
  settlementCurrency?: Currency;
  sellPriceSettlement?: number;
}

export interface PortfolioSnapshot {
  date: string;
  assets: {
    id: string;
    name: string;
    currentValue: number;
    purchaseValue: number;
  }[];
}

// 포트폴리오 데이터 (DB 저장 구조)
export interface PortfolioData {
  assets: Asset[];
  portfolioHistory: PortfolioSnapshot[];
  sellHistory: SellTransaction[];
  exchangeRates: ExchangeRates;  // ✅ 추가
  lastUpdateDate: string;
}

export interface NewAssetForm {
  ticker: string;
  quantity: number;
  purchasePrice: number;      // 원래 통화 기준
  purchaseDate: string;
  category: AssetCategory;
  exchange: string;
  currency: Currency;
}

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

// 거래소 매핑
export const EXCHANGE_MAP: Record<AssetCategory, string[]> = {
  [AssetCategory.KOREAN_STOCK]: ['KRX (코스피/코스닥)'],
  [AssetCategory.US_STOCK]: ['NASDAQ', 'NYSE', 'NYSE Arca', 'NYSE AMERICA'],
  [AssetCategory.FOREIGN_STOCK]: ['TSE (도쿄)', 'HKEX (홍콩)', 'SSE (상해)', 'SZSE (심천)', 'LSE (런던)'],
  [AssetCategory.CRYPTOCURRENCY]: ['주요 거래소 (종합)'],
  [AssetCategory.PHYSICAL_ASSET]: ['KRX 금시장', 'NYSE Arca', 'COMEX'],
  [AssetCategory.US_BOND]: ['NASDAQ', 'NYSE Arca'],
};

export const ALL_EXCHANGES = Array.from(new Set(Object.values(EXCHANGE_MAP).flat()));

// 거래소에서 카테고리 추론
export const inferCategoryFromExchange = (exchange: string): AssetCategory => {
  const normalized = normalizeExchange(exchange);
  
  for (const [category, exchanges] of Object.entries(EXCHANGE_MAP)) {
    if (exchanges.some(e => normalizeExchange(e) === normalized)) {
      return category as AssetCategory;
    }
  }
  
  // 기본값
  if (normalized.includes('KRX') || normalized.includes('코스')) {
    return AssetCategory.KOREAN_STOCK;
  }
  if (normalized.includes('TSE') || normalized.includes('도쿄')) {
    return AssetCategory.FOREIGN_STOCK;
  }
  
  return AssetCategory.US_STOCK;
};

// 거래소명 정규화
export const normalizeExchange = (exchange: string): string => {
  return (exchange || '').trim().toUpperCase();
};

// Asset 메트릭스 타입 (PortfolioTable에서 사용)
export interface AssetMetrics {
  purchasePrice: number;      // 원래 통화 기준 매수가
  currentPrice: number;       // 원래 통화 기준 현재가
  purchaseValue: number;      // 원래 통화 기준 총 매수금액
  currentValue: number;       // 원래 통화 기준 현재 평가금액
  purchaseValueKRW: number;   // 원화 환산 매수금액
  currentValueKRW: number;    // 원화 환산 현재가치
  returnPercentage: number;   // 수익률 (%)
  allocation: number;         // 포트폴리오 비중 (%)
  dropFromHigh: number;       // 최고가 대비 하락률 (%)
  profitLoss: number;         // 원래 통화 기준 손익금액
  profitLossKRW: number;      // 원화 환산 손익금액
  diffFromHigh: number;       // 최고가 대비 차이
  yesterdayChange: number;    // 전일 대비 변동률 (%)
  diffFromYesterday: number;  // 전일 대비 차이
}

// Gemini API 결과 타입
export interface AssetDataResult {
  id: string;
  name: string;
  priceOriginal: number;
  previousClose: number;
  currency: string;
  priceKRW: number;
}
