import React, { createContext, useContext, useMemo, useState, useCallback, useEffect } from 'react';
import {
  Asset,
  AssetCategory,
  Currency,
  ExchangeRates,
  PortfolioSnapshot,
  WatchlistItem,
  SellRecord,
  SellTransaction,
} from '../types';
import { usePortfolioData } from '../hooks/usePortfolioData';
import { useMarketData } from '../hooks/useMarketData';
import { useAssetActions } from '../hooks/useAssetActions';

/**
 * @description 포트폴리오 히스토리 스냅샷 배열 타입 별칭
 * @see types.ts: PortfolioSnapshot
 */
export type PortfolioHistory = PortfolioSnapshot[];

/**
 * @description 컨텍스트가 노출하는 핵심 데이터 집합
 */
export interface PortfolioData {
  assets: Asset[];
  portfolioHistory: PortfolioHistory;
  sellHistory: SellRecord[];
  watchlist: WatchlistItem[];
  exchangeRates: ExchangeRates;
}

/**
 * @description 컨텍스트가 노출하는 운영/인증/로딩 상태 집합
 */
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

/**
 * @description UI 상태(탭/필터/검색/알림 기준)
 */
export interface UIState {
  activeTab: 'dashboard' | 'portfolio' | 'analytics' | 'watchlist';
  dashboardFilterCategory: AssetCategory | 'ALL';
  filterCategory: AssetCategory | 'ALL';
  filterAlerts: boolean;
  searchQuery: string;
  sellAlertDropRate: number;
}

/**
 * @description 모달 및 선택 자산 상태
 */
export interface ModalState {
  editingAsset: Asset | null;
  sellingAsset: Asset | null;
  bulkUploadOpen: boolean;
  addAssetOpen: boolean;
  assistantOpen: boolean;
}

/**
 * @description 파생/계산 값 집합
 */
export interface DerivedState {
  totalValue: number;
  alertCount: number;
}

/**
 * @description 컨텍스트에서 제공하는 액션 집합(도메인/시세/관심종목/UI/모달)
 */
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
  addSelectedToWatchlist: (assets: Asset[]) => void;

  // 관심종목
  addWatchItem: (item: Omit<WatchlistItem, 'id' | 'currentPrice' | 'priceOriginal' | 'currency' | 'yesterdayPrice' | 'highestPrice' | 'lastSignalAt' | 'lastSignalType'>) => void;
  updateWatchItem: (item: WatchlistItem) => void;
  deleteWatchItem: (id: string) => void;
  toggleWatchMonitoring: (id: string, enabled: boolean) => void;
  bulkDeleteWatchItems: (ids: string[]) => void;

  // 메시지
  clearError: () => void;
  clearSuccessMessage: () => void;

  // 파일 업로드
  uploadCsv: (file: File) => Promise<import('../types').BulkUploadResult>;

  // UI/모달
  setActiveTab: (tab: UIState['activeTab']) => void;
  setDashboardFilterCategory: (c: UIState['dashboardFilterCategory']) => void;
  setFilterCategory: (c: UIState['filterCategory']) => void;
  setFilterAlerts: (v: boolean) => void;
  setSearchQuery: (q: string) => void;
  setSellAlertDropRate: (n: number) => void;
  openEditModal: (asset: Asset) => void;
  closeEditModal: () => void;
  openSellModal: (asset: Asset) => void;
  closeSellModal: () => void;
  openBulkUpload: () => void;
  closeBulkUpload: () => void;
  openAddAsset: () => void;
  closeAddAsset: () => void;
  openAssistant: () => void;
  closeAssistant: () => void;
}

/**
 * @description 포트폴리오 컨텍스트 전체 값
 */
export interface PortfolioContextValue {
  data: PortfolioData;
  status: PortfolioStatus;
  ui: UIState;
  modal: ModalState;
  derived: DerivedState;
  actions: PortfolioActions;
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

/**
 * @description 포트폴리오 컨텍스트 제공자. 내부에서 기존 훅을 사용해 상태/액션을 구성합니다.
 */
export const PortfolioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 핵심 데이터/인증/저장 훅
  const {
    assets, setAssets,
    portfolioHistory, setPortfolioHistory,
    sellHistory, setSellHistory,
    watchlist, setWatchlist,
    exchangeRates, setExchangeRates,
    isSignedIn, googleUser,
    isLoading: isAuthLoading,
    error, setError,
    successMessage, setSuccessMessage,
    hasAutoUpdated,
    handleSignIn,
    handleSignOut,
    triggerAutoSave,
    updateAllData,
  } = usePortfolioData();

  // 시세/환율 훅
  const {
    isLoading: isMarketLoading,
    failedAssetIds,
    handleExchangeRatesChange,
    handleRefreshAllPrices,
    handleRefreshSelectedPrices,
    handleRefreshOnePrice,
    handleRefreshWatchlistPrices,
  } = useMarketData({
    assets, setAssets,
    watchlist, setWatchlist,
    exchangeRates, setExchangeRates,
    portfolioHistory, sellHistory,
    triggerAutoSave,
    setError,
    setSuccessMessage,
  });

  // 자산/관심종목 액션 훅
  const {
    isLoading: isActionLoading,
    editingAsset, setEditingAsset,
    sellingAsset, setSellingAsset,
    handleAddAsset,
    handleDeleteAsset,
    handleUpdateAsset,
    handleConfirmSell,
    handleCsvFileUpload,
    handleAddWatchItem,
    handleUpdateWatchItem,
    handleDeleteWatchItem,
    handleBulkDeleteWatchItems,
    handleAddAssetsToWatchlist,
    handleToggleWatchMonitoring,
  } = useAssetActions({
    assets, setAssets,
    watchlist, setWatchlist,
    portfolioHistory,
    sellHistory, setSellHistory,
    exchangeRates,
    isSignedIn,
    triggerAutoSave,
    setError,
    setSuccessMessage,
  });

  // UI 상태
  const [activeTab, setActiveTab] = useState<UIState['activeTab']>('dashboard');
  const [dashboardFilterCategory, setDashboardFilterCategory] = useState<AssetCategory | 'ALL'>('ALL');
  const [filterCategory, setFilterCategory] = useState<AssetCategory | 'ALL'>('ALL');
  const [sellAlertDropRate, setSellAlertDropRate] = useState<number>(15);
  const [filterAlerts, setFilterAlerts] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isBulkUploadModalOpen, setIsBulkUploadModalOpen] = useState<boolean>(false);
  const [isAddAssetModalOpen, setIsAddAssetModalOpen] = useState<boolean>(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState<boolean>(false);

  const isLoading = isAuthLoading || isMarketLoading || isActionLoading;
  const isInitializing = false;

  // 파생 값
  const showExchangeRateWarning = useMemo(() => {
    const hasUSD = assets.some(a => a.currency === Currency.USD);
    const hasJPY = assets.some(a => a.currency === Currency.JPY);
    return (hasUSD && (!exchangeRates.USD || exchangeRates.USD < 100)) || (hasJPY && (!exchangeRates.JPY || exchangeRates.JPY < 1));
  }, [assets, exchangeRates]);

  const alertCount = useMemo(() => {
    return assets.filter(asset => {
      if (asset.highestPrice === 0) return false;
      const dropFromHigh = ((asset.currentPrice - asset.highestPrice) / asset.highestPrice) * 100;
      const alertRate = asset.sellAlertDropRate ?? sellAlertDropRate;
      return dropFromHigh <= -alertRate;
    }).length;
  }, [assets, sellAlertDropRate]);

  const totalValue = useMemo(() => {
    return assets.reduce((acc, asset) => {
      const rate = asset.currency === Currency.KRW ? 1 : (exchangeRates[asset.currency] || 0);
      const v = asset.currentPrice * asset.quantity * rate;
      return acc + v;
    }, 0);
  }, [assets, exchangeRates]);

  // 포트폴리오 히스토리 스냅샷 업데이트
  useEffect(() => {
    const updatePortfolioHistory = () => {
      if (assets.length === 0) return;
      const today = new Date().toISOString().slice(0, 10);
      const newAssetSnapshots = assets.map(asset => {
        const rate = asset.currency === Currency.KRW ? 1 : (exchangeRates[asset.currency] || 0);
        const currentValueKRW = asset.currentPrice * asset.quantity * rate;
        let purchaseValueKRW: number;
        if (asset.currency === Currency.KRW) {
          purchaseValueKRW = asset.purchasePrice * asset.quantity;
        } else if (asset.purchaseExchangeRate) {
          purchaseValueKRW = asset.purchasePrice * asset.purchaseExchangeRate * asset.quantity;
        } else if (asset.priceOriginal > 0) {
          const exchangeRate = asset.currentPrice / asset.priceOriginal;
          purchaseValueKRW = asset.purchasePrice * exchangeRate * asset.quantity;
        } else {
          purchaseValueKRW = asset.purchasePrice * asset.quantity;
        }
        const unitPriceKRW = asset.currentPrice * rate;
        return {
          id: asset.id,
          name: (asset.customName?.trim() || asset.name),
          currentValue: currentValueKRW,
          purchaseValue: purchaseValueKRW,
          unitPrice: unitPriceKRW,
        };
      });
      const newSnapshot = { date: today, assets: newAssetSnapshots };
      setPortfolioHistory(prevHistory => {
        const todayIndex = prevHistory.findIndex(snap => snap.date === today);
        let updatedHistory;
        if (todayIndex > -1) {
          updatedHistory = [...prevHistory];
          updatedHistory[todayIndex] = newSnapshot;
        } else {
          updatedHistory = [...prevHistory, newSnapshot];
        }
        if (updatedHistory.length > 365) {
          updatedHistory = updatedHistory.slice(updatedHistory.length - 365);
        }
        return updatedHistory;
      });
    };
    updatePortfolioHistory();
  }, [assets, exchangeRates, setPortfolioHistory]);

  // 액션 구현
  const saveToDrive = useCallback(async () => {
    triggerAutoSave(assets, portfolioHistory, sellHistory, watchlist, exchangeRates);
    setSuccessMessage('저장 요청되었습니다.');
    setTimeout(() => setSuccessMessage(null), 3000);
  }, [assets, portfolioHistory, sellHistory, watchlist, exchangeRates, triggerAutoSave, setSuccessMessage]);

  const exportJson = useCallback(async (fileName: string = 'portfolio.json') => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 내보내기 기능을 사용할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }
    const exportData = {
      assets,
      portfolioHistory,
      sellHistory,
      exchangeRates,
      watchlist,
      lastUpdateDate: new Date().toISOString().slice(0, 10),
    };
    const portfolioJSON = JSON.stringify(exportData, null, 2);
    const blob = new Blob([portfolioJSON], { type: 'application/json' });
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccessMessage(`'${fileName}' 파일로 내보내기가 완료되었습니다.`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (e) {
      setError('파일 내보내기에 실패했습니다.');
      setTimeout(() => setError(null), 3000);
    }
  }, [assets, portfolioHistory, sellHistory, watchlist, exchangeRates, isSignedIn, setError, setSuccessMessage]);

  const importJsonPrompt = useCallback(() => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 가져오기 기능을 사용할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const contents = e.target?.result as string;
          const loadedData = JSON.parse(contents);
          let loadedAssets: Asset[] = [];
          let loadedHistory: PortfolioHistory = [];
          let loadedSellHistory: SellRecord[] = [];
          let loadedWatchlist: WatchlistItem[] = [];
          let loadedRates: ExchangeRates | undefined = undefined;
          if (Array.isArray(loadedData)) {
            loadedAssets = loadedData as Asset[];
          } else if (loadedData && typeof loadedData === 'object') {
            loadedAssets = Array.isArray(loadedData.assets) ? loadedData.assets : [];
            loadedHistory = Array.isArray(loadedData.portfolioHistory) ? loadedData.portfolioHistory : [];
            loadedSellHistory = Array.isArray(loadedData.sellHistory) ? loadedData.sellHistory : [];
            loadedWatchlist = Array.isArray(loadedData.watchlist) ? loadedData.watchlist : [];
            loadedRates = loadedData.exchangeRates;
          }
          setAssets(loadedAssets);
          setPortfolioHistory(loadedHistory);
          setSellHistory(loadedSellHistory);
          setWatchlist(loadedWatchlist);
          if (loadedRates) setExchangeRates(loadedRates);
          setSuccessMessage('파일에서 데이터를 불러왔습니다.');
          setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err) {
          setError('파일 파싱 실패');
          setTimeout(() => setError(null), 3000);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [isSignedIn, setError, setSuccessMessage, setAssets, setPortfolioHistory, setSellHistory, setWatchlist, setExchangeRates]);

  const exportCsv = useCallback(async () => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 내보내기 기능을 사용할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }
    if (assets.length === 0) {
      alert('내보낼 데이터가 없습니다.');
      return;
    }
    try {
      const header = [
        '종목명', '티커', '거래소', '자산구분', '보유수량',
        '매수단가(자국통화)', '매수환율', '총매수금액(원화)',
        '현재단가(원화)', '현재평가금액(원화)', '총손익(원화)', '수익률(%)'
      ];
      const rows = assets.map(asset => {
        const rate = asset.currency === Currency.KRW ? 1 : (exchangeRates[asset.currency] || 0);
        const currentValueKRW = asset.currentPrice * asset.quantity * rate;
        const purchaseValueKRW = asset.currency === Currency.KRW
          ? asset.purchasePrice * asset.quantity
          : (asset.purchaseExchangeRate
              ? asset.purchasePrice * asset.purchaseExchangeRate * asset.quantity
              : asset.purchasePrice * rate * asset.quantity);
        const gainLossKRW = currentValueKRW - purchaseValueKRW;
        const returnPct = purchaseValueKRW === 0 ? 0 : (gainLossKRW / purchaseValueKRW) * 100;
        return [
          (asset.customName?.trim() || asset.name),
          asset.ticker,
          asset.exchange,
          asset.category,
          asset.quantity,
          asset.purchasePrice,
          asset.purchaseExchangeRate ?? '',
          Math.round(purchaseValueKRW),
          Math.round(asset.currentPrice * rate),
          Math.round(currentValueKRW),
          Math.round(gainLossKRW),
          returnPct.toFixed(2),
        ].join(',');
      });
      const content = [header.join(','), ...rows].join('\n');
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'portfolio.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccessMessage('CSV 내보내기 완료');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (e) {
      setError('CSV 내보내기 실패');
      setTimeout(() => setError(null), 3000);
    }
  }, [assets, exchangeRates, isSignedIn, setError, setSuccessMessage]);

  const handleTabChange = useCallback((tab: UIState['activeTab']) => {
    if (tab !== 'portfolio') {
      setFilterAlerts(false);
    }
    setActiveTab(tab);
  }, []);

  const value: PortfolioContextValue = {
    data: {
      assets,
      portfolioHistory,
      sellHistory,
      watchlist,
      exchangeRates,
    },
    status: {
      isLoading,
      failedAssetIds,
      isSignedIn,
      userEmail: googleUser?.email ?? null,
      isInitializing,
      error,
      successMessage,
      showExchangeRateWarning,
    },
    ui: {
      activeTab,
      dashboardFilterCategory,
      filterCategory,
      filterAlerts,
      searchQuery,
      sellAlertDropRate,
    },
    modal: {
      editingAsset,
      sellingAsset,
      bulkUploadOpen: isBulkUploadModalOpen,
      addAssetOpen: isAddAssetModalOpen,
      assistantOpen: isAssistantOpen,
    },
    derived: {
      totalValue,
      alertCount,
    },
    actions: {
      saveToDrive,
      exportJson,
      importJsonPrompt,
      exportCsv,
      signIn: async () => { await handleSignIn(); },
      signOut: async () => { handleSignOut(); },
      setExchangeRates: handleExchangeRatesChange,
      refreshAllPrices: async (force?: boolean) => handleRefreshAllPrices(!!force),
      refreshSelectedPrices: handleRefreshSelectedPrices,
      refreshOnePrice: handleRefreshOnePrice,
      refreshWatchlistPrices: handleRefreshWatchlistPrices,
      addAsset: handleAddAsset,
      updateAsset: handleUpdateAsset,
      deleteAsset: handleDeleteAsset,
      confirmSell: handleConfirmSell,
      addSelectedToWatchlist: handleAddAssetsToWatchlist,
      addWatchItem: handleAddWatchItem,
      updateWatchItem: handleUpdateWatchItem,
      deleteWatchItem: handleDeleteWatchItem,
      toggleWatchMonitoring: handleToggleWatchMonitoring,
      bulkDeleteWatchItems: handleBulkDeleteWatchItems,
      uploadCsv: handleCsvFileUpload,
      clearError: () => setError(null),
      clearSuccessMessage: () => setSuccessMessage(null),
      setActiveTab: handleTabChange,
      setDashboardFilterCategory,
      setFilterCategory,
      setFilterAlerts,
      setSearchQuery,
      setSellAlertDropRate,
      openEditModal: (asset: Asset) => setEditingAsset(asset),
      closeEditModal: () => setEditingAsset(null),
      openSellModal: (asset: Asset) => setSellingAsset(asset),
      closeSellModal: () => setSellingAsset(null),
      openBulkUpload: () => setIsBulkUploadModalOpen(true),
      closeBulkUpload: () => setIsBulkUploadModalOpen(false),
      openAddAsset: () => setIsAddAssetModalOpen(true),
      closeAddAsset: () => setIsAddAssetModalOpen(false),
      openAssistant: () => setIsAssistantOpen(true),
      closeAssistant: () => setIsAssistantOpen(false),
    },
  };

  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
};

/**
 * @description 컨텍스트 접근 훅. Provider 밖에서 호출 시 에러를 던집니다.
 */
export const usePortfolio = (): PortfolioContextValue => {
  const ctx = useContext(PortfolioContext);
  if (!ctx) {
    throw new Error('usePortfolio must be used within a PortfolioProvider');
  }
  return ctx;
};
