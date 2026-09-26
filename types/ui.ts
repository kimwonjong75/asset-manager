import { Asset, PortfolioSnapshot, ExchangeRates } from './index';

export interface PortfolioTableProps {
  assets: Asset[];
  history: PortfolioSnapshot[];
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
  | 'yesterdayChange'
  /** "보유종목 터틀"(P2) — 청산선까지 거리(%). 정렬 불가(비동기 훅 데이터, EnrichedAsset 밖) */
  | 'turtleExitGapPct'
  /** "보유종목 터틀"(P2) — 상태(보유 유지/팔 때/감시 중/다시 살 때/추가 매수/확인 불가/범위 제외). 정렬 불가 */
  | 'turtleStatus';

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
}

export const DEFAULT_SIGNAL_DISPLAY: SignalDisplaySettings = {
  showGuruSignalsProminently: false,
};

// Stage D1(2026-09-15) 기본값 — 표시 5개(현재가·어제대비·평가총액·수익률·최고가 대비), 나머지 6개는 숨김.
// 저장된 사용자 설정은 바꾸지 않는다: 이 값은 첫 사용·"기본값으로 초기화"·신규 키 추가 시에만 쓰인다
// (머지 규칙은 utils/columnConfig.mergeColumnConfig, 골든은 tests/columnConfigParity.ts).
export const DEFAULT_COLUMN_CONFIG: ColumnConfig[] = [
  { key: 'currentPrice',     visible: true  },
  { key: 'yesterdayChange',  visible: true  },
  { key: 'currentValue',     visible: true  },
  { key: 'returnPercentage', visible: true  },
  { key: 'dropFromHigh',     visible: true  },
  { key: 'maCrossDays',      visible: false },
  { key: 'quantity',         visible: false },
  { key: 'purchasePrice',    visible: false },
  { key: 'purchaseValue',    visible: false },
  { key: 'purchaseDate',     visible: false },
  { key: 'allocation',       visible: false },
  { key: 'turtleExitGapPct', visible: false },
  { key: 'turtleStatus',     visible: false },
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
  turtleExitGapPct: '청산선까지',
  turtleStatus:     '터틀 상태',
};
