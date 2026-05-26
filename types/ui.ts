import { Asset, PortfolioSnapshot, ExchangeRates } from './index';

export interface PortfolioTableProps {
  assets: Asset[];
  history: PortfolioSnapshot[];
  onRefreshAll: () => void;
  onRefreshSelected?: (ids: string[]) => void | Promise<void>;
  onRefreshOne?: (id: string) => void | Promise<void>;
  onEdit: (asset: Asset) => void;
  onSell?: (asset: Asset) => void;
  onBuy?: (asset: Asset) => void;
  isLoading: boolean;
  sellAlertDropRate: number;
  onSellAlertDropRateChange?: (value: number) => void;
  filterCategory: number | 'ALL';
  onFilterChange: (category: number | 'ALL') => void;
  filterAlerts: boolean;
  onFilterAlertsChange: (isActive: boolean) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  onAddSelectedToWatchlist?: (assets: Asset[]) => void;
  failedIds?: Set<string>;
  exchangeRates: ExchangeRates;
}

export type SortKey = 'name' | 'purchaseDate' | 'quantity' | 'purchasePrice' | 'currentPrice' | 'returnPercentage' | 'dropFromHigh' | 'yesterdayChange' | 'purchaseValue' | 'currentValue' | 'allocation' | 'profitLoss' | 'profitLossKRW' | 'maCrossDays';
export type SortDirection = 'ascending' | 'descending';

export interface AssetMetrics {
  purchasePrice: number;
  currentPrice: number;
  currentPriceKRW: number;
  purchasePriceKRW: number;
  purchaseValue: number;
  currentValue: number;
  purchaseValueKRW: number;
  currentValueKRW: number;
  returnPercentage: number;
  allocation: number;
  dropFromHigh: number;
  profitLoss: number;
  profitLossKRW: number;
  diffFromHigh: number;
  yesterdayChange: number;
  diffFromYesterday: number;
}

export interface EnrichedAsset extends Asset {
  metrics: AssetMetrics;
}

// 포트폴리오 테이블 컬럼 커스터마이징 (데스크탑 전용)
// 양끝(name=좌, actions=우)은 고정이며 ColumnConfig에 포함되지 않음
export type ColumnKey =
  | 'maCrossDays'
  | 'quantity'
  | 'purchasePrice'
  | 'currentPrice'
  | 'returnPercentage'
  | 'purchaseValue'
  | 'currentValue'
  | 'purchaseDate'
  | 'allocation'
  | 'dropFromHigh'
  | 'yesterdayChange';

export interface ColumnConfig {
  key: ColumnKey;
  visible: boolean;
}

// 기존 더보기 ON 상태와 동일한 순서/표시 — 마이그레이션 기본값
export const DEFAULT_COLUMN_CONFIG: ColumnConfig[] = [
  { key: 'maCrossDays',      visible: true  },
  { key: 'quantity',         visible: false },
  { key: 'purchasePrice',    visible: false },
  { key: 'currentPrice',     visible: true  },
  { key: 'returnPercentage', visible: true  },
  { key: 'purchaseValue',    visible: true  },
  { key: 'currentValue',     visible: true  },
  { key: 'purchaseDate',     visible: false },
  { key: 'allocation',       visible: false },
  { key: 'dropFromHigh',     visible: true  },
  { key: 'yesterdayChange',  visible: true  },
];

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  maCrossDays:      'GC/DC',
  quantity:         '보유수량',
  purchasePrice:    '매수평균가',
  currentPrice:     '현재가',
  returnPercentage: '수익률',
  purchaseValue:    '투자원금',
  currentValue:     '평가총액',
  purchaseDate:     '매수일',
  allocation:       '비중',
  dropFromHigh:     '최고가 대비',
  yesterdayChange:  '어제대비',
};
