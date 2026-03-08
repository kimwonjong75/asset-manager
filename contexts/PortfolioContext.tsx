import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
import {
  Asset,
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
import { useBackup } from '../hooks/useBackup';
import { useGoldPremium } from '../hooks/useGoldPremium';
import { CategoryBaseType } from '../types/category';
import type { CategoryStore } from '../types/category';

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
    categoryStore, setCategoryStore,
    isSignedIn, googleUser, needsReAuth,
    isInitializing: isAuthInitializing,
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

  // 백업 훅
  const backup = useBackup({ isSignedIn });

  // 금 김치프리미엄 훅 (앱 레벨)
  const {
    data: goldPremiumData,
    loading: isGoldPremiumLoading,
    error: goldPremiumError,
    refresh: refreshGoldPremium,
  } = useGoldPremium({
    usdKrwRate: exchangeRates.USD,
    enableVisibilityRefresh: true,
  });

  // 앱 시작 시 자동 업데이트 (오늘 아직 업데이트 안 했으면)
  useEffect(() => {
    if (shouldAutoUpdate && assets.length > 0 && !hasAutoUpdated && !isMarketLoading) {
      localStorage.setItem('lastAutoUpdateDate', new Date().toISOString().slice(0, 10));
      setHasAutoUpdated(true);
      setShouldAutoUpdate(false);
      // 자동 업데이트 실행 (isAutoUpdate=true로 호출)
      handleRefreshAllPrices(true);
      refreshGoldPremium();
      // 시세 갱신 시점에 1일 1회 자동 백업
      backup.performBackup();
    }
  }, [shouldAutoUpdate, assets.length, hasAutoUpdated, isMarketLoading, handleRefreshAllPrices, refreshGoldPremium, setHasAutoUpdated, setShouldAutoUpdate, backup.performBackup]);

  // 금 프리미엄 초기 fetch (auto-update 여부와 무관, 세션당 1회)
  useEffect(() => {
    if (exchangeRates.USD > 0 && !goldPremiumData && !isGoldPremiumLoading) {
      refreshGoldPremium();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exchangeRates.USD]);

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
  const [dashboardFilterCategory, setDashboardFilterCategory] = useState<number | 'ALL'>('ALL');
  const [filterCategory, setFilterCategory] = useState<number | 'ALL'>('ALL');
  const sellAlertDropRate = persistedSellAlertDropRate;
  const [filterAlerts, setFilterAlerts] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isBulkUploadModalOpen, setIsBulkUploadModalOpen] = useState<boolean>(false);
  const [isAddAssetModalOpen, setIsAddAssetModalOpen] = useState<boolean>(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState<boolean>(false);
  const [editingWatchItem, setEditingWatchItem] = useState<WatchlistItem | null>(null);
  const [isAddWatchItemOpen, setIsAddWatchItemOpen] = useState<boolean>(false);
  const [focusedAssetId, setFocusedAssetId] = useState<string | null>(null);

  const isLoading = isAuthLoading || isMarketLoading || isActionLoading;
  const isInitializing = isAuthInitializing;

  // 통계/파생 데이터 훅
  const { totalValue, alertCount } = usePortfolioStats({
    assets,
    sellHistory,
    exchangeRates,
    sellAlertDropRate
  });

  // enriched 지표 (Context 레벨에서 한 번만 계산, 관심종목 포함)
  const { enrichedMap, isLoading: isEnrichedLoading } = useEnrichedIndicators(assets, watchlist);

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
    watchlistItems: watchlist,
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
      categoryStore,
    },
    status: {
      isLoading,
      failedAssetIds,
      isSignedIn,
      needsReAuth,
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
      focusedAssetId,
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
      backupList: backup.backupList,
      backupSettings: backup.backupSettings,
      isBackingUp: backup.isBackingUp,
      goldPremium: goldPremiumData,
      isGoldPremiumLoading,
      goldPremiumError,
    },
    actions: {
      saveToDrive,
      exportJson,
      importJsonPrompt,
      exportCsv,
      signIn: async () => { await handleSignIn(); },
      signOut: async () => { handleSignOut(); },
      setExchangeRates: handleExchangeRatesChange,
      refreshAllPrices: async (force?: boolean) => {
        handleRefreshAllPrices(!!force);
        refreshGoldPremium();
      },
      refreshSelectedPrices: handleRefreshSelectedPrices,
      refreshOnePrice: handleRefreshOnePrice,
      refreshWatchlistPrices: handleRefreshWatchlistPrices,
      addAsset: handleAddAsset,
      updateAsset: handleUpdateAsset,
      togglePinAsset: (id: string) => {
        const newAssets = assets.map(a =>
          a.id === id ? { ...a, pinned: !a.pinned } : a
        );
        setAssets(newAssets);
        triggerAutoSave(newAssets, portfolioHistory, sellHistory, watchlist, exchangeRates);
      },
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
      togglePinWatchItem: (id: string) => {
        const newWatchlist = watchlist.map(w =>
          w.id === id ? { ...w, pinned: !w.pinned } : w
        );
        setWatchlist(newWatchlist);
        triggerAutoSave(assets, portfolioHistory, sellHistory, newWatchlist, exchangeRates);
      },
      uploadCsv: handleCsvFileUpload,
      updateAlertSettings,
      dismissAlertPopup,
      showBriefingPopup,
      clearError: () => setError(null),
      clearSuccessMessage: () => setSuccessMessage(null),
      setActiveTab: handleTabChange,
      setFocusedAssetId,
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
      // 카테고리 관리
      addCategory: (name: string, baseType: CategoryBaseType) => {
        const newCat = {
          id: categoryStore.nextId,
          name,
          baseType,
          isDefault: false,
          sortOrder: categoryStore.categories.length + 1,
        };
        const updated: CategoryStore = {
          categories: [...categoryStore.categories, newCat],
          nextId: categoryStore.nextId + 1,
        };
        setCategoryStore(updated);
        triggerAutoSave(assets, portfolioHistory, sellHistory, watchlist, exchangeRates, undefined, undefined, updated);
      },
      renameCategory: (id: number, newName: string) => {
        const updated: CategoryStore = {
          ...categoryStore,
          categories: categoryStore.categories.map(c =>
            c.id === id ? { ...c, name: newName } : c
          ),
        };
        setCategoryStore(updated);
        triggerAutoSave(assets, portfolioHistory, sellHistory, watchlist, exchangeRates, undefined, undefined, updated);
      },
      deleteCategory: (id: number, reassignToId: number) => {
        // 자산/관심종목/매도내역 재할당
        const newAssets = assets.map(a => a.categoryId === id ? { ...a, categoryId: reassignToId } : a);
        const newWatchlist = watchlist.map(w => w.categoryId === id ? { ...w, categoryId: reassignToId } : w);
        const newSellHistory = sellHistory.map(s => s.categoryId === id ? { ...s, categoryId: reassignToId } : s);
        const updated: CategoryStore = {
          ...categoryStore,
          categories: categoryStore.categories.filter(c => c.id !== id),
        };
        setAssets(newAssets);
        setWatchlist(newWatchlist);
        setSellHistory(newSellHistory);
        setCategoryStore(updated);
        triggerAutoSave(newAssets, portfolioHistory, newSellHistory, newWatchlist, exchangeRates, undefined, undefined, updated);
      },
      // 금 김치프리미엄
      refreshGoldPremium,
      // 백업
      performBackup: () => backup.performBackup(),
      loadBackupList: backup.loadBackupList,
      restoreBackup: async (fileId: string) => {
        const content = await backup.restoreBackup(fileId);
        if (content) {
          try {
            const parsed = JSON.parse(content);
            updateAllData(
              Array.isArray(parsed.assets) ? parsed.assets : [],
              Array.isArray(parsed.portfolioHistory) ? parsed.portfolioHistory : [],
              Array.isArray(parsed.sellHistory) ? parsed.sellHistory : [],
              Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
              parsed.exchangeRates,
              parsed.allocationTargets,
            );
            setSuccessMessage('백업에서 데이터가 복원되었습니다.');
            setTimeout(() => setSuccessMessage(null), 3000);
          } catch {
            setError('백업 데이터 파싱에 실패했습니다.');
            setTimeout(() => setError(null), 3000);
          }
        }
      },
      deleteBackup: backup.deleteBackup,
      updateBackupSettings: backup.updateSettings,
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
