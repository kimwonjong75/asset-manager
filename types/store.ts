import { Asset, PortfolioSnapshot, SellRecord, WatchlistItem, ExchangeRates, Currency, BulkUploadResult, AllocationTargets } from './index';
import type { AlertSettings, AlertResult } from './alertRules';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';
import type { BackupInfo, BackupSettings } from './backup';
import type { CategoryStore, CategoryBaseType } from './category';
import type { GoldPremiumResult } from '../services/goldPremiumService';
import type { ColumnConfig, ColumnKey, FixedColumnWidths } from './ui';

export type PortfolioHistory = PortfolioSnapshot[];

export type GlobalPeriod = 'THIS_MONTH' | 'LAST_MONTH' | '1M' | '3M' | '6M' | '1Y' | '2Y' | 'ALL';

export interface PortfolioData {
  assets: Asset[];
  portfolioHistory: PortfolioHistory;
  sellHistory: SellRecord[];
  watchlist: WatchlistItem[];
  exchangeRates: ExchangeRates;
  allocationTargets: AllocationTargets;
  categoryStore: CategoryStore;
}

export interface PortfolioStatus {
  isLoading: boolean;
  failedAssetIds: Set<string>;
  isSignedIn: boolean;
  needsReAuth: boolean;
  userEmail: string | null;
  isInitializing: boolean;
  error: string | null;
  successMessage: string | null;
  showExchangeRateWarning: boolean;
}

export interface UIState {
  activeTab: 'dashboard' | 'portfolio' | 'analytics' | 'watchlist' | 'guide' | 'settings';
  globalPeriod: GlobalPeriod;
  dashboardFilterCategory: number | 'ALL';
  filterCategory: number | 'ALL';
  filterAlerts: boolean;
  searchQuery: string;
  sellAlertDropRate: number;
  alertSettings: AlertSettings;
  focusedAssetId: string | null;
  focusedWatchItemId: string | null;
  /** 포트폴리오 표시 임계값 (KRW) — 토글 활성 시 평가총액이 이 값 미만인 자산 숨김. 기본 1,000,000 */
  lowValueThreshold: number;
  /** 포트폴리오 테이블 컬럼 표시/순서 설정 (데스크탑 전용, 양끝 name/actions 제외) */
  columnConfig: ColumnConfig[];
  /** 양끝 고정 컬럼 중 사용자 리사이즈 가능한 컬럼의 너비 (현재 name만) */
  fixedColumnWidths: FixedColumnWidths;
}

export interface ModalState {
  editingAsset: Asset | null;
  sellingAsset: Asset | null;
  buyingAsset: Asset | null;
  bulkUploadOpen: boolean;
  addAssetOpen: boolean;
  assistantOpen: boolean;
  editingWatchItem: WatchlistItem | null;
  addWatchItemOpen: boolean;
  editingSellRecord: SellRecord | null;
}

export interface DerivedState {
  totalValue: number;
  alertCount: number;
  enrichedMap: Map<string, EnrichedIndicatorData>;
  isEnrichedLoading: boolean;
  alertResults: AlertResult[];
  showAlertPopup: boolean;
  // 백업
  backupList: BackupInfo[];
  backupSettings: BackupSettings;
  isBackingUp: boolean;
  // 금 김치프리미엄
  goldPremium: GoldPremiumResult | null;
  isGoldPremiumLoading: boolean;
  goldPremiumError: string | null;
}

export interface PortfolioActions {
  // 저장/내보내기/가져오기
  saveToDrive: () => Promise<void>;
  exportJson: (fileName?: string) => Promise<void>;
  importJsonPrompt: () => void;
  exportCsv: () => Promise<void>;

  // 인증
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;

  // 환율/시세
  setExchangeRates: (rates: ExchangeRates) => void;
  refreshAllPrices: (force?: boolean) => Promise<void>;
  refreshSelectedPrices: (ids: string[]) => Promise<void>;
  refreshOnePrice: (id: string) => Promise<void>;
  refreshWatchlistPrices: () => Promise<void>;

  // 자산
  addAsset: (asset: Asset) => Promise<void>;
  updateAsset: (asset: Asset) => Promise<void>;
  togglePinAsset: (id: string) => void;
  deleteAsset: (id: string) => void;
  confirmSell: (id: string, sellDate: string, sellPrice: number, sellQuantity: number, currency: Currency) => Promise<void>;
  /** 매도 기록 편집: 입력값은 자산 통화 기준 단가(`sellPriceSettlement`). 날짜 변경 시 환율 재조회 */
  editSellRecord: (recordId: string, patch: { sellDate?: string; sellPriceSettlement?: number; sellQuantity?: number }) => Promise<void>;
  /** 매도 기록 삭제 — `sellHistory` + 자산의 `sellTransactions` 양쪽에서 제거. 보유수량 복구하지 않음 */
  deleteSellRecord: (recordId: string) => void;
  confirmBuyMore: (id: string, buyDate: string, buyPrice: number, buyQuantity: number) => Promise<void>;
  addSelectedToWatchlist: (assets: Asset[]) => void;

  // 관심종목
  addWatchItem: (item: Omit<WatchlistItem, 'id' | 'currentPrice' | 'priceOriginal' | 'currency' | 'previousClosePrice' | 'highestPrice'>) => void;
  updateWatchItem: (item: WatchlistItem) => void;
  deleteWatchItem: (id: string) => void;
  bulkDeleteWatchItems: (ids: string[]) => void;
  togglePinWatchItem: (id: string) => void;

  // 메시지
  clearError: () => void;
  clearSuccessMessage: () => void;

  // 파일 업로드
  uploadCsv: (file: File) => Promise<BulkUploadResult>;

  // UI/모달
  updateAlertSettings: (settings: AlertSettings) => void;
  dismissAlertPopup: () => void;
  showBriefingPopup: () => void;
  setActiveTab: (tab: UIState['activeTab']) => void;
  setFocusedAssetId: (id: string | null) => void;
  setFocusedWatchItemId: (id: string | null) => void;
  setGlobalPeriod: (p: GlobalPeriod) => void;
  setDashboardFilterCategory: (c: UIState['dashboardFilterCategory']) => void;
  setFilterCategory: (c: UIState['filterCategory']) => void;
  setFilterAlerts: (v: boolean) => void;
  setSearchQuery: (q: string) => void;
  setSellAlertDropRate: (n: number) => void;
  setLowValueThreshold: (n: number) => void;
  /** 포트폴리오 테이블 컬럼 설정 갱신 — visible/순서 모두 포함. localStorage에 영속화 */
  setColumnConfig: (config: ColumnConfig[]) => void;
  /** 컬럼 설정을 DEFAULT_COLUMN_CONFIG로 초기화 — visible/순서/너비 모두 리셋 */
  resetColumnConfig: () => void;
  /** 중간 컬럼 너비 갱신 (px). MIN_COLUMN_WIDTH(80px) 미만 자동 클램프 */
  setColumnWidth: (key: ColumnKey, width: number) => void;
  /** 고정 컬럼(name) 너비 갱신 (px). MIN_COLUMN_WIDTH(80px) 미만 자동 클램프 */
  setFixedColumnWidth: (key: keyof FixedColumnWidths, width: number) => void;
  updateAllocationTargets: (targets: AllocationTargets) => void;
  openEditModal: (asset: Asset) => void;
  closeEditModal: () => void;
  openSellModal: (asset: Asset) => void;
  closeSellModal: () => void;
  openBuyModal: (asset: Asset) => void;
  closeBuyModal: () => void;
  openBulkUpload: () => void;
  closeBulkUpload: () => void;
  openAddAsset: () => void;
  closeAddAsset: () => void;
  openAssistant: () => void;
  closeAssistant: () => void;
  openAddWatchItem: () => void;
  closeAddWatchItem: () => void;
  openEditWatchItem: (item: WatchlistItem) => void;
  closeEditWatchItem: () => void;
  openEditSellRecord: (record: SellRecord) => void;
  closeEditSellRecord: () => void;

  // 카테고리 관리
  addCategory: (name: string, baseType: CategoryBaseType) => void;
  renameCategory: (id: number, newName: string) => void;
  deleteCategory: (id: number, reassignToId: number) => void;

  // 금 김치프리미엄
  refreshGoldPremium: () => Promise<void>;

  // 백업
  performBackup: () => Promise<void>;
  loadBackupList: () => Promise<void>;
  restoreBackup: (fileId: string) => Promise<void>;
  deleteBackup: (fileId: string) => Promise<void>;
  updateBackupSettings: (settings: BackupSettings) => void;
}

export interface PortfolioContextValue {
  data: PortfolioData;
  status: PortfolioStatus;
  ui: UIState;
  modal: ModalState;
  derived: DerivedState;
  actions: PortfolioActions;
}
