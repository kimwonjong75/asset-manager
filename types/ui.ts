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
  filterCategory: number | 'ALL' | 'SATELLITE';
  onFilterChange: (category: number | 'ALL' | 'SATELLITE') => void;
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
  width?: number;
}

// 양끝 고정 컬럼 중 사용자 리사이즈 가능한 컬럼의 너비
// (체크박스/관리는 자동 너비 유지 — 컬럼 너비 조정 대상에서 제외)
export interface FixedColumnWidths {
  name?: number;
}

export const DEFAULT_FIXED_COLUMN_WIDTHS: FixedColumnWidths = {};

// 컬럼 너비 최소값 (80px 미만 시 헤더 텍스트가 SortIcon과 함께 줄바꿈됨)
export const MIN_COLUMN_WIDTH = 80;

// ---------------------------------------------------------------------------
// 신호 표시 설정 (90/10 Phase 5 — 신호 다이어트)
// ---------------------------------------------------------------------------
// 참고형 신호(구루 신호 카드 / 리스크 매트릭스)의 "표시 위치·크기"만 제어하는
// 순수 표시 설정. 계산·발화·저장 로직과 무관하며, localStorage에만 영속된다.
// 기본값 = 강등(참고 지표) 상태. 토글을 켜면 이전(Phase 5 이전) 배치로 원복된다.
export interface SignalDisplaySettings {
  /** 구루 신호 카드를 대시보드 상단에 큰 카드로 표시 (기본 false=하단 '참고 지표' 접힘 섹션으로 강등) */
  showGuruSignalsProminently: boolean;
  /** 리스크 매트릭스를 알림 브리핑 팝업에서 항상 펼쳐 표시 (기본 false=접힘, 클릭 시 펼침) */
  showRiskMatrixExpanded: boolean;
}

export const DEFAULT_SIGNAL_DISPLAY: SignalDisplaySettings = {
  showGuruSignalsProminently: false,
  showRiskMatrixExpanded: false,
};

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
