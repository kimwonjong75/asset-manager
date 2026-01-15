import React, { createContext, useContext, useState, useMemo } from 'react';
import {
  Asset,
  AssetCategory,
  Currency,
  ExchangeRates,
  AllocationTargets,
} from '../types';
import { PortfolioContextValue, UIState } from '../types/store';
import { usePortfolioData } from '../hooks/usePortfolioData';
import { useMarketData } from '../hooks/useMarketData';
import { useAssetActions } from '../hooks/useAssetActions';
import { usePortfolioStats } from '../hooks/usePortfolioStats';
import { usePortfolioHistory } from '../hooks/usePortfolioHistory';
import { usePortfolioExport } from '../hooks/usePortfolioExport';

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

  // 통계/파생 데이터 훅
  const { totalValue, alertCount } = usePortfolioStats({
    assets,
    exchangeRates,
    sellAlertDropRate
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
      confirmSell: async (id: string, sellDate: string, sellPrice: number, sellQuantity: number, currency: Currency) => {
        // [수정] Context의 인터페이스와 useAssetActions 구현체의 파라미터 순서 불일치 해결
        // Context: (id, sellDate, sellPrice, sellQuantity, currency)
        // Hook: (assetId, sellQuantity, sellPrice, sellDate, settlementCurrency)
        await handleConfirmSell(id, sellQuantity, sellPrice, sellDate, currency);
      },
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
      updateAllocationTargets: (targets: AllocationTargets) => {
        setAllocationTargets(targets);
        triggerAutoSave(assets, portfolioHistory, sellHistory, watchlist, exchangeRates, targets);
      },
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

export const usePortfolio = (): PortfolioContextValue => {
  const ctx = useContext(PortfolioContext);
  if (!ctx) {
    throw new Error('usePortfolio must be used within a PortfolioProvider');
  }
  return ctx;
};
