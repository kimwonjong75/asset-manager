import { Asset, PortfolioSnapshot, SellRecord, WatchlistItem, ExchangeRates, AssetCategory, Currency, BulkUploadResult, AllocationTargets } from './index';

export type PortfolioHistory = PortfolioSnapshot[];

export interface PortfolioData {
  assets: Asset[];
  portfolioHistory: PortfolioHistory;
  sellHistory: SellRecord[];
  watchlist: WatchlistItem[];
  exchangeRates: ExchangeRates;
  allocationTargets: AllocationTargets;
}

export interface PortfolioStatus {
  isLoading: boolean;
  failedAssetIds: Set<string>;
  isSignedIn: boolean;
  userEmail: string | null;
  isInitializing: boolean;
  error: string | null;
  successMessage: string | null;
  showExchangeRateWarning: boolean;
}

export interface UIState {
  activeTab: 'dashboard' | 'portfolio' | 'analytics' | 'watchlist';
  dashboardFilterCategory: AssetCategory | 'ALL';
  filterCategory: AssetCategory | 'ALL';
  filterAlerts: boolean;
  searchQuery: string;
  sellAlertDropRate: number;
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
}

export interface DerivedState {
  totalValue: number;
  alertCount: number;
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
  deleteAsset: (id: string) => void;
  confirmSell: (id: string, sellDate: string, sellPrice: number, sellQuantity: number, currency: Currency) => Promise<void>;
  confirmBuyMore: (id: string, buyDate: string, buyPrice: number, buyQuantity: number) => Promise<void>;
  addSelectedToWatchlist: (assets: Asset[]) => void;

  // 관심종목
  addWatchItem: (item: Omit<WatchlistItem, 'id' | 'currentPrice' | 'priceOriginal' | 'currency' | 'previousClosePrice' | 'highestPrice' | 'lastSignalAt' | 'lastSignalType'>) => void;
  updateWatchItem: (item: WatchlistItem) => void;
  deleteWatchItem: (id: string) => void;
  toggleWatchMonitoring: (id: string, enabled: boolean) => void;
  bulkDeleteWatchItems: (ids: string[]) => void;

  // 메시지
  clearError: () => void;
  clearSuccessMessage: () => void;

  // 파일 업로드
  uploadCsv: (file: File) => Promise<BulkUploadResult>;

  // UI/모달
  setActiveTab: (tab: UIState['activeTab']) => void;
  setDashboardFilterCategory: (c: UIState['dashboardFilterCategory']) => void;
  setFilterCategory: (c: UIState['filterCategory']) => void;
  setFilterAlerts: (v: boolean) => void;
  setSearchQuery: (q: string) => void;
  setSellAlertDropRate: (n: number) => void;
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
}

export interface PortfolioContextValue {
  data: PortfolioData;
  status: PortfolioStatus;
  ui: UIState;
  modal: ModalState;
  derived: DerivedState;
  actions: PortfolioActions;
}
