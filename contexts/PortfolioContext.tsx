import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
import {
  Asset,
  Currency,
  ExchangeRates,
  AllocationTargets,
  WatchlistItem,
  SellRecord,
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
import type { KnowledgeBase } from '../types/knowledge';
import { evaluateGuruSignals, buildGuruSignalChartTargets, type GuruSignalMatch, type GuruSignalTarget } from '../utils/guruSignalEngine';
import {
  DEFAULT_COLUMN_CONFIG,
  DEFAULT_FIXED_COLUMN_WIDTHS,
  MIN_COLUMN_WIDTH,
  type ColumnConfig,
  type ColumnKey,
  type FixedColumnWidths,
} from '../types/ui';
import { DEFAULT_MA_CONFIGS, clampMAPeriod, type MALineConfig } from '../utils/maCalculations';

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

// --- 차트 MA 슬롯 설정 (localStorage 영속 + 레거시 마이그레이션) ---
const MA_CONFIGS_KEY_V2 = 'asset-manager-ma-configs-v2';
const MA_CONFIGS_KEY_LEGACY = 'asset-manager-ma-preferences';

// v2 저장본을 DEFAULT와 슬롯 id 기준으로 머지: 기간 클램프, 누락 슬롯 backfill, 색은 default 유지
const mergeChartMAConfigs = (stored: Partial<MALineConfig>[]): MALineConfig[] =>
  DEFAULT_MA_CONFIGS.map(def => {
    const saved = stored.find(s => s.id === def.id);
    if (!saved) return { ...def };
    return {
      ...def,
      period: clampMAPeriod(saved.period ?? def.period),
      enabled: typeof saved.enabled === 'boolean' ? saved.enabled : def.enabled,
    };
  });

// 레거시(period 키, enabled만 저장된 구 포맷) → v2: 기존 enabled 상태 보존
const migrateLegacyMAConfigs = (parsed: { period?: number; enabled?: boolean }[]): MALineConfig[] =>
  DEFAULT_MA_CONFIGS.map(def => {
    const saved = parsed.find(p => p.period === def.period);
    return saved && typeof saved.enabled === 'boolean' ? { ...def, enabled: saved.enabled } : { ...def };
  });

const loadChartMAConfigs = (): MALineConfig[] => {
  try {
    const rawV2 = localStorage.getItem(MA_CONFIGS_KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2);
      if (Array.isArray(parsed)) return mergeChartMAConfigs(parsed);
    }
    const rawLegacy = localStorage.getItem(MA_CONFIGS_KEY_LEGACY);
    if (rawLegacy) {
      const parsed = JSON.parse(rawLegacy);
      if (Array.isArray(parsed)) return migrateLegacyMAConfigs(parsed);
    }
  } catch { /* ignore */ }
  return DEFAULT_MA_CONFIGS.map(c => ({ ...c }));
};

// 저장된 컬럼 설정과 현재 DEFAULT_COLUMN_CONFIG를 머지:
//  - 저장본에 없는 키는 default 위치에 visible 기본값으로 추가
//  - 저장본의 알 수 없는 키는 제거
const mergeColumnConfig = (stored: ColumnConfig[]): ColumnConfig[] => {
  const validKeys = new Set(DEFAULT_COLUMN_CONFIG.map(c => c.key));
  const cleaned = stored.filter(c => validKeys.has(c.key as ColumnKey));
  const seen = new Set(cleaned.map(c => c.key));
  const missing = DEFAULT_COLUMN_CONFIG.filter(c => !seen.has(c.key));
  return [...cleaned, ...missing];
};

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
    knowledgeBase, setKnowledgeBase,
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
    handleEditSellRecord,
    handleDeleteSellRecord,
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
  const [focusedWatchItemId, setFocusedWatchItemId] = useState<string | null>(null);
  const [editingSellRecord, setEditingSellRecord] = useState<SellRecord | null>(null);

  // 저가 자산 숨김 임계값 (KRW). 환경설정에서 조정, localStorage 영속
  const [lowValueThreshold, setLowValueThresholdState] = useState<number>(() => {
    try {
      const stored = localStorage.getItem('asset-manager-low-value-threshold');
      if (stored) {
        const n = Number(stored);
        if (Number.isFinite(n) && n >= 0) return n;
      }
    } catch { /* ignore */ }
    return 1_000_000;
  });
  const handleSetLowValueThreshold = (n: number) => {
    const v = Math.max(0, Math.floor(n) || 0);
    setLowValueThresholdState(v);
    try { localStorage.setItem('asset-manager-low-value-threshold', String(v)); } catch { /* ignore */ }
  };

  // 포트폴리오 테이블 컬럼 설정 — localStorage 영속 + 스키마 마이그레이션
  const [columnConfig, setColumnConfigState] = useState<ColumnConfig[]>(() => {
    try {
      const raw = localStorage.getItem('asset-manager-column-config-v1');
      if (raw) {
        const parsed = JSON.parse(raw) as ColumnConfig[];
        if (Array.isArray(parsed)) return mergeColumnConfig(parsed);
      }
    } catch { /* ignore */ }
    return DEFAULT_COLUMN_CONFIG;
  });
  const persistColumnConfig = (next: ColumnConfig[]) => {
    setColumnConfigState(next);
    try { localStorage.setItem('asset-manager-column-config-v1', JSON.stringify(next)); } catch { /* ignore */ }
    // 컬럼 설정 변경은 Drive autoSave 의존성에 포함되지 않으므로 명시적으로 트리거.
    // (hookAutoSave는 localStorage에서 최신 tableLayout을 읽어 백업에 포함하며, 디바운스됨)
    triggerAutoSave(assets, portfolioHistory, sellHistory, watchlist, exchangeRates);
  };
  const handleSetColumnConfig = (config: ColumnConfig[]) => {
    persistColumnConfig(mergeColumnConfig(config));
  };

  // 고정 컬럼 너비(name) — localStorage 영속
  const [fixedColumnWidths, setFixedColumnWidthsState] = useState<FixedColumnWidths>(() => {
    try {
      const raw = localStorage.getItem('asset-manager-fixed-column-widths-v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed as FixedColumnWidths;
      }
    } catch { /* ignore */ }
    return DEFAULT_FIXED_COLUMN_WIDTHS;
  });
  const persistFixedColumnWidths = (next: FixedColumnWidths) => {
    setFixedColumnWidthsState(next);
    try { localStorage.setItem('asset-manager-fixed-column-widths-v1', JSON.stringify(next)); } catch { /* ignore */ }
    triggerAutoSave(assets, portfolioHistory, sellHistory, watchlist, exchangeRates);
  };
  const handleResetColumnConfig = () => {
    persistColumnConfig(DEFAULT_COLUMN_CONFIG);
    persistFixedColumnWidths(DEFAULT_FIXED_COLUMN_WIDTHS);
  };
  const handleSetColumnWidth = (key: ColumnKey, width: number) => {
    const clamped = Math.max(MIN_COLUMN_WIDTH, Math.round(width));
    const next = columnConfig.map(c => (c.key === key ? { ...c, width: clamped } : c));
    persistColumnConfig(next);
  };
  const handleSetFixedColumnWidth = (key: keyof FixedColumnWidths, width: number) => {
    const clamped = Math.max(MIN_COLUMN_WIDTH, Math.round(width));
    persistFixedColumnWidths({ ...fixedColumnWidths, [key]: clamped });
  };

  // 개별 차트 MA 슬롯 설정 — localStorage 영속 (차트 표시 전용, Drive 동기화 불필요)
  const [chartMAConfigs, setChartMAConfigsState] = useState<MALineConfig[]>(() => loadChartMAConfigs());
  const handleSetChartMAConfigs = (configs: MALineConfig[]) => {
    const merged = mergeChartMAConfigs(configs);
    setChartMAConfigsState(merged);
    try { localStorage.setItem(MA_CONFIGS_KEY_V2, JSON.stringify(merged)); } catch { /* ignore */ }
  };
  const handleResetChartMAConfigs = () => {
    const def = DEFAULT_MA_CONFIGS.map(c => ({ ...c }));
    setChartMAConfigsState(def);
    try { localStorage.setItem(MA_CONFIGS_KEY_V2, JSON.stringify(def)); } catch { /* ignore */ }
  };

  // Drive 복원 시 useGoogleDriveSync가 dispatch하는 이벤트를 감지하여 상태 동기화
  // 신규: 'table-layout-restored' (columns + fixedWidths 묶음)
  // 레거시: 'column-config-restored' (columns 배열만 — 구 백업 호환)
  useEffect(() => {
    const handleTableLayoutRestored = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail === 'object') {
        if (Array.isArray(detail.columns)) {
          setColumnConfigState(mergeColumnConfig(detail.columns as ColumnConfig[]));
        }
        if (detail.fixedWidths && typeof detail.fixedWidths === 'object') {
          setFixedColumnWidthsState(detail.fixedWidths as FixedColumnWidths);
        }
      }
    };
    const handleLegacyRestored = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (Array.isArray(detail)) {
        setColumnConfigState(mergeColumnConfig(detail as ColumnConfig[]));
      }
    };
    window.addEventListener('table-layout-restored', handleTableLayoutRestored);
    window.addEventListener('column-config-restored', handleLegacyRestored);
    return () => {
      window.removeEventListener('table-layout-restored', handleTableLayoutRestored);
      window.removeEventListener('column-config-restored', handleLegacyRestored);
    };
  }, []);

  const isLoading = isAuthLoading || isMarketLoading || isActionLoading;
  const isInitializing = isAuthInitializing;

  // 브라우저 탭 제목 동적 변경 (다른 탭에서도 상태 확인 가능)
  const DEFAULT_TITLE = "KIM'S 퀸트자산관리";
  useEffect(() => {
    if (isInitializing) {
      document.title = `로그인 확인 중... — ${DEFAULT_TITLE}`;
    } else if (isMarketLoading) {
      document.title = `시세 업데이트 중... — ${DEFAULT_TITLE}`;
    } else {
      document.title = DEFAULT_TITLE;
    }
    return () => { document.title = DEFAULT_TITLE; };
  }, [isInitializing, isMarketLoading]);

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
    riskMatrix,
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

  // 구루 신호 엔진 — 활성 지식 규칙(typed condition)을 종목별로 평가 (data.knowledgeBase 기반)
  // 게이트(isActiveSignal) 통과 + condition 보유 규칙만 발화. 현재 구현된 지표만 매핑되므로
  // 신규 지표(④) 추가 시 어댑터 확장만으로 더 많은 규칙이 자동 발화된다.
  const guruSignals = useMemo<GuruSignalMatch[]>(() => {
    if (isEnrichedLoading || enrichedMap.size === 0) return [];
    const targets: GuruSignalTarget[] = [];
    for (const asset of enrichedAssets) {
      const enriched = enrichedMap.get(asset.ticker);
      if (!enriched) continue;
      targets.push({
        assetId: asset.id, ticker: asset.ticker, name: asset.name,
        currentPrice: asset.priceOriginal, enriched, source: 'portfolio',
      });
    }
    const portfolioTickers = new Set(enrichedAssets.map(a => a.ticker));
    for (const item of watchlist) {
      if (portfolioTickers.has(item.ticker)) continue;
      const enriched = enrichedMap.get(item.ticker);
      if (!enriched) continue;
      const price = item.priceOriginal ?? item.currentPrice ?? 0;
      if (price <= 0) continue;
      targets.push({
        assetId: item.id, ticker: item.ticker, name: item.name,
        currentPrice: price, enriched, source: 'watchlist',
      });
    }
    return evaluateGuruSignals({
      rules: knowledgeBase.rules,
      claims: knowledgeBase.claims,
      targets,
      now: new Date(),
    });
  }, [enrichedMap, enrichedAssets, watchlist, knowledgeBase, isEnrichedLoading]);

  // 신호 종목별 차트 props 맵 — GuruSignalCard 인라인 차트가 assetId로 룩업(source 분기는 순수 빌더에 위임)
  const guruSignalChartTargets = useMemo(
    () => buildGuruSignalChartTargets({
      matches: guruSignals,
      portfolioAssets: enrichedAssets,
      watchlist,
      exchangeRates,
    }),
    [guruSignals, enrichedAssets, watchlist, exchangeRates],
  );

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
      knowledgeBase,
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
      focusedWatchItemId,
      lowValueThreshold,
      columnConfig,
      fixedColumnWidths,
      chartMAConfigs,
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
      editingSellRecord,
    },
    derived: {
      totalValue,
      alertCount,
      enrichedMap,
      isEnrichedLoading,
      alertResults,
      riskMatrix,
      guruSignals,
      guruSignalChartTargets,
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
      editSellRecord: handleEditSellRecord,
      deleteSellRecord: handleDeleteSellRecord,
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
      setFocusedWatchItemId,
      setGlobalPeriod: handleSetGlobalPeriod,
      setDashboardFilterCategory,
      setFilterCategory,
      setFilterAlerts,
      setSearchQuery,
      setSellAlertDropRate: (n: number) => {
        setPersistedSellAlertDropRate(n);
        triggerAutoSave(assets, portfolioHistory, sellHistory, watchlist, exchangeRates, undefined, n);
      },
      setLowValueThreshold: handleSetLowValueThreshold,
      setColumnConfig: handleSetColumnConfig,
      resetColumnConfig: handleResetColumnConfig,
      setColumnWidth: handleSetColumnWidth,
      setFixedColumnWidth: handleSetFixedColumnWidth,
      setChartMAConfigs: handleSetChartMAConfigs,
      resetChartMAConfigs: handleResetChartMAConfigs,
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
      openEditSellRecord: (record: SellRecord) => setEditingSellRecord(record),
      closeEditSellRecord: () => setEditingSellRecord(null),
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
      // 지식 베이스 (구루 지식 DB) — 상태 갱신 후 Drive 자동 저장 (9번째 인자로 knowledgeBase 주입)
      updateKnowledgeBase: (kb: KnowledgeBase) => {
        setKnowledgeBase(kb);
        triggerAutoSave(assets, portfolioHistory, sellHistory, watchlist, exchangeRates, undefined, undefined, undefined, kb);
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
