import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
import {
  Asset,
  AssetCategory,
  Currency,
  ExchangeRates,
  AllocationTargets,
  WatchlistItem,
} from '../types';
import { PortfolioContextValue, UIState, GlobalPeriod } from '../types/store';
import { usePortfolioData } from '../hooks/usePortfolioData';
import { useMarketData } from '../hooks/useMarketData';
import { useAssetActions } from '../hooks/useAssetActions';
import { usePortfolioStats } from '../hooks/usePortfolioStats';
import { usePortfolioHistory } from '../hooks/usePortfolioHistory';
import { usePortfolioExport } from '../hooks/usePortfolioExport';
import { useEnrichedIndicators } from '../hooks/useEnrichedIndicators';
import { useAutoAlert } from '../hooks/useAutoAlert';
import { usePortfolioCalculator } from '../hooks/usePortfolioCalculator';

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

export const PortfolioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 핵심 데이터/인증/저장 훅
  const {
    assets, setAssets,
    portfolioHistory, setPortfolioHistory,
    sellHistory, setSellHistory,
    watchlist, setWatchlist,
    exchangeRates, setExchangeRates,
    allocationTargets, setAllocationTargets,
    sellAlertDropRate: persistedSellAlertDropRate,
    setSellAlertDropRate: setPersistedSellAlertDropRate,
    isSignedIn, googleUser,
    isLoading: isAuthLoading,
    error, setError,
    successMessage, setSuccessMessage,
    hasAutoUpdated, setHasAutoUpdated,
    shouldAutoUpdate, setShouldAutoUpdate,
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

  // 앱 시작 시 자동 업데이트 (오늘 아직 업데이트 안 했으면)
  useEffect(() => {
    if (shouldAutoUpdate && assets.length > 0 && !hasAutoUpdated && !isMarketLoading) {
      localStorage.setItem('lastAutoUpdateDate', new Date().toISOString().slice(0, 10));
      setHasAutoUpdated(true);
      setShouldAutoUpdate(false);
      // 자동 업데이트 실행 (isAutoUpdate=true로 호출)
      handleRefreshAllPrices(true);
    }
  }, [shouldAutoUpdate, assets.length, hasAutoUpdated, isMarketLoading, handleRefreshAllPrices, setHasAutoUpdated, setShouldAutoUpdate]);

  // 자산/관심종목 액션 훅
  const {
    isLoading: isActionLoading,
    editingAsset, setEditingAsset,
    sellingAsset, setSellingAsset,
    buyingAsset, setBuyingAsset,
    handleAddAsset,
    handleDeleteAsset,
    handleUpdateAsset,
    handleConfirmSell,
    handleConfirmBuyMore,
    handleCsvFileUpload,
    handleAddWatchItem,
    handleUpdateWatchItem,
    handleDeleteWatchItem,
    handleBulkDeleteWatchItems,
    handleAddAssetsToWatchlist,
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
  const [globalPeriod, setGlobalPeriod] = useState<GlobalPeriod>(() => {
    try {
      const stored = localStorage.getItem('asset-manager-global-period');
      if (stored && ['3M', '6M', '1Y', '2Y', 'ALL'].includes(stored)) return stored as GlobalPeriod;
    } catch { /* ignore */ }
    return '1Y';
  });
  const handleSetGlobalPeriod = (p: GlobalPeriod) => {
    setGlobalPeriod(p);
    try { localStorage.setItem('asset-manager-global-period', p); } catch { /* ignore */ }
  };
  const [activeTab, setActiveTab] = useState<UIState['activeTab']>('dashboard');
  const [dashboardFilterCategory, setDashboardFilterCategory] = useState<AssetCategory | 'ALL'>('ALL');
  const [filterCategory, setFilterCategory] = useState<AssetCategory | 'ALL'>('ALL');
  const sellAlertDropRate = persistedSellAlertDropRate;
  const [filterAlerts, setFilterAlerts] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isBulkUploadModalOpen, setIsBulkUploadModalOpen] = useState<boolean>(false);
  const [isAddAssetModalOpen, setIsAddAssetModalOpen] = useState<boolean>(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState<boolean>(false);
  const [editingWatchItem, setEditingWatchItem] = useState<WatchlistItem | null>(null);
  const [isAddWatchItemOpen, setIsAddWatchItemOpen] = useState<boolean>(false);

  const isLoading = isAuthLoading || isMarketLoading || isActionLoading;
  const isInitializing = false;

  // 통계/파생 데이터 훅
  const { totalValue, alertCount } = usePortfolioStats({
    assets,
    sellHistory,
    exchangeRates,
    sellAlertDropRate
  });

  // enriched 지표 (Context 레벨에서 한 번만 계산)
  const { enrichedMap, isLoading: isEnrichedLoading } = useEnrichedIndicators(assets);

  // EnrichedAsset 목록 생성 (알림 체크용)
  const { calculateAssetMetrics, calculatePortfolioStats } = usePortfolioCalculator();
  const enrichedAssets = useMemo(() => {
    const stats = calculatePortfolioStats(assets, exchangeRates);
    return assets.map(a => calculateAssetMetrics(a, exchangeRates, stats.totalValue));
  }, [assets, exchangeRates, calculatePortfolioStats, calculateAssetMetrics]);

  // 자동 알림
  const {
    alertSettings,
    updateAlertSettings,
    alertResults,
    showAlertPopup,
    dismissAlertPopup,
    showBriefingPopup,
  } = useAutoAlert({
    enrichedAssets,
    enrichedMap,
    isEnrichedLoading,
    hasAutoUpdated,
    isMarketLoading,
  });

  const showExchangeRateWarning = useMemo(() => {
    const hasUSD = assets.some(a => a.currency === Currency.USD);
    const hasJPY = assets.some(a => a.currency === Currency.JPY);
    return (hasUSD && (!exchangeRates.USD || exchangeRates.USD < 100)) || (hasJPY && (!exchangeRates.JPY || exchangeRates.JPY < 1));
  }, [assets, exchangeRates]);

  // 포트폴리오 히스토리 관리 훅
  usePortfolioHistory({
    assets,
    exchangeRates,
    setPortfolioHistory
  });

  // 내보내기/저장 훅
  const { saveToDrive, exportJson, importJsonPrompt, exportCsv } = usePortfolioExport({
    assets,
    portfolioHistory,
    sellHistory,
    watchlist,
    exchangeRates,
    allocationTargets,
    isSignedIn,
    triggerAutoSave,
    setError,
    setSuccessMessage,
    setAssets,
    setPortfolioHistory,
    setSellHistory,
    setWatchlist,
    setExchangeRates,
    setAllocationTargets,
  });

  const handleTabChange = (tab: UIState['activeTab']) => {
    if (tab !== 'portfolio') {
      setFilterAlerts(false);
    }
    setActiveTab(tab);
  };

  const value: PortfolioContextValue = {
    data: {
      assets,
      portfolioHistory,
      sellHistory,
      watchlist,
      exchangeRates,
      allocationTargets,
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
      globalPeriod,
      dashboardFilterCategory,
      filterCategory,
      filterAlerts,
      searchQuery,
      sellAlertDropRate,
      alertSettings,
    },
    modal: {
      editingAsset,
      sellingAsset,
      buyingAsset,
      bulkUploadOpen: isBulkUploadModalOpen,
      addAssetOpen: isAddAssetModalOpen,
      assistantOpen: isAssistantOpen,
      editingWatchItem,
      addWatchItemOpen: isAddWatchItemOpen,
    },
    derived: {
      totalValue,
      alertCount,
      enrichedMap,
      isEnrichedLoading,
      alertResults,
      showAlertPopup,
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
      confirmSell: async (id: string, sellDate: string, sellPrice: number, sellQuantity: number, currency: Currency) => {
        // [수정] Context의 인터페이스와 useAssetActions 구현체의 파라미터 순서 불일치 해결
        // Context: (id, sellDate, sellPrice, sellQuantity, currency)
        // Hook: (assetId, sellQuantity, sellPrice, sellDate, settlementCurrency)
        await handleConfirmSell(id, sellQuantity, sellPrice, sellDate, currency);
      },
      confirmBuyMore: async (id: string, buyDate: string, buyPrice: number, buyQuantity: number) => {
        await handleConfirmBuyMore(id, buyQuantity, buyPrice, buyDate);
      },
      addSelectedToWatchlist: handleAddAssetsToWatchlist,
      addWatchItem: handleAddWatchItem,
      updateWatchItem: handleUpdateWatchItem,
      deleteWatchItem: handleDeleteWatchItem,
      bulkDeleteWatchItems: handleBulkDeleteWatchItems,
      uploadCsv: handleCsvFileUpload,
      updateAlertSettings,
      dismissAlertPopup,
      showBriefingPopup,
      clearError: () => setError(null),
      clearSuccessMessage: () => setSuccessMessage(null),
      setActiveTab: handleTabChange,
      setGlobalPeriod: handleSetGlobalPeriod,
      setDashboardFilterCategory,
      setFilterCategory,
      setFilterAlerts,
      setSearchQuery,
      setSellAlertDropRate: (n: number) => {
        setPersistedSellAlertDropRate(n);
        triggerAutoSave(assets, portfolioHistory, sellHistory, watchlist, exchangeRates, undefined, n);
      },
      updateAllocationTargets: (targets: AllocationTargets) => {
        setAllocationTargets(targets);
        triggerAutoSave(assets, portfolioHistory, sellHistory, watchlist, exchangeRates, targets);
      },
      openEditModal: (asset: Asset) => setEditingAsset(asset),
      closeEditModal: () => setEditingAsset(null),
      openSellModal: (asset: Asset) => setSellingAsset(asset),
      closeSellModal: () => setSellingAsset(null),
      openBuyModal: (asset: Asset) => setBuyingAsset(asset),
      closeBuyModal: () => setBuyingAsset(null),
      openBulkUpload: () => setIsBulkUploadModalOpen(true),
      closeBulkUpload: () => setIsBulkUploadModalOpen(false),
      openAddAsset: () => setIsAddAssetModalOpen(true),
      closeAddAsset: () => setIsAddAssetModalOpen(false),
      openAssistant: () => setIsAssistantOpen(true),
      closeAssistant: () => setIsAssistantOpen(false),
      openAddWatchItem: () => setIsAddWatchItemOpen(true),
      closeAddWatchItem: () => setIsAddWatchItemOpen(false),
      openEditWatchItem: (item: WatchlistItem) => setEditingWatchItem(item),
      closeEditWatchItem: () => setEditingWatchItem(null),
    },
  };

  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
};

export const usePortfolio = (): PortfolioContextValue => {
  const ctx = useContext(PortfolioContext);
  if (!ctx) {
    throw new Error('usePortfolio must be used within a PortfolioProvider');
  }
  return ctx;
};
