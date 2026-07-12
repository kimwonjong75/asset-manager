import React, { createContext, useContext, useState, useMemo, useEffect, useCallback } from 'react';
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
import { useTurtleActionReview } from '../hooks/useTurtleActionReview';
import { usePortfolioCalculator } from '../hooks/usePortfolioCalculator';
import { useBackup } from '../hooks/useBackup';
import { useMarketOverview } from '../hooks/useMarketOverview';
import { CategoryBaseType } from '../types/category';
import type { CategoryStore } from '../types/category';
import type { KnowledgeBase } from '../types/knowledge';
import type { ActionItem } from '../types/actionQueue';
import type { TurtlePosition, TurtleSettings } from '../types/turtle';
import { evaluateGuruSignals, buildGuruSignalTargets, buildGuruSignalChartTargets, type GuruSignalMatch, type GuruSignalTarget } from '../utils/guruSignalEngine';
import { buildGuruSignalCaveats } from '../utils/guruDiagnostics';
import {
  DEFAULT_COLUMN_CONFIG,
  DEFAULT_FIXED_COLUMN_WIDTHS,
  MIN_COLUMN_WIDTH,
  DEFAULT_SIGNAL_DISPLAY,
  type ColumnConfig,
  type ColumnKey,
  type FixedColumnWidths,
  type SignalDisplaySettings,
} from '../types/ui';
import { DEFAULT_MA_CONFIGS, clampMAPeriod, type MALineConfig } from '../utils/maCalculations';
import { OWNER_FILTER_OPTIONS, type OwnerFilter } from '../types/owner';
import { buildCleanupCommit } from '../utils/cleanupPlan';
import type { CleanupDecision } from '../types/cleanup';
import { compactResolvedActions, ACTION_QUEUE_RETENTION_DAYS } from '../utils/actionQueueCompaction';

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
    actionQueue, setActionQueue,
    turtlePositions, setTurtlePositions,
    turtleSettings, setTurtleSettings,
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
    commitPortfolioPatch,
    restoreFromPayload,
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

  // 시장 요약(금 김치 프리미엄 + 환율) 훅 (앱 레벨).
  // 마운트 즉시 스스로 fresh 조회하므로 별도 초기 fetch 효과가 필요 없다 —
  // 환율 로딩(exchangeRates.USD) 타이밍과도 완전히 분리됨(과거 1450 왜곡 버그 제거).
  const {
    snapshot: marketOverviewData,
    status: marketOverviewStatus,
    error: marketOverviewError,
    refresh: refreshMarketOverview,
  } = useMarketOverview();

  // 앱 시작 시 자동 업데이트 (오늘 아직 업데이트 안 했으면)
  useEffect(() => {
    if (shouldAutoUpdate && assets.length > 0 && !hasAutoUpdated && !isMarketLoading) {
      localStorage.setItem('lastAutoUpdateDate', new Date().toISOString().slice(0, 10));
      setHasAutoUpdated(true);
      setShouldAutoUpdate(false);
      // 자동 업데이트 실행 (isAutoUpdate=true로 호출)
      handleRefreshAllPrices(true);
      refreshMarketOverview();
      // 시세 갱신 시점에 1일 1회 자동 백업
      backup.performBackup();
    }
  }, [shouldAutoUpdate, assets.length, hasAutoUpdated, isMarketLoading, handleRefreshAllPrices, refreshMarketOverview, setHasAutoUpdated, setShouldAutoUpdate, backup.performBackup]);

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
    commitPortfolioPatch,
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
  // 계정 뷰 필터 (통합/원종/유선) — 표시 계층 전용, localStorage 영속.
  // 원본 data.assets는 절대 거르지 않는다 (autosave가 걸러진 배열을 저장하면 데이터 유실).
  const [accountView, setAccountViewState] = useState<OwnerFilter>(() => {
    try {
      const stored = localStorage.getItem('asset-manager-account-view');
      if (stored && (OWNER_FILTER_OPTIONS as string[]).includes(stored)) return stored as OwnerFilter;
    } catch { /* ignore */ }
    return 'ALL';
  });
  const handleSetAccountView = (f: OwnerFilter) => {
    setAccountViewState(f);
    try { localStorage.setItem('asset-manager-account-view', f); } catch { /* ignore */ }
  };
  const [dashboardFilterCategory, setDashboardFilterCategory] = useState<number | 'ALL' | 'SATELLITE'>('ALL');
  const [filterCategory, setFilterCategory] = useState<number | 'ALL' | 'SATELLITE'>('ALL');
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
  const [turtleExecAction, setTurtleExecAction] = useState<ActionItem | null>(null);
  const [cleanupExecAction, setCleanupExecAction] = useState<ActionItem | null>(null);
  const [rebalanceExecAction, setRebalanceExecAction] = useState<ActionItem | null>(null);

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

  // 신호 표시 설정 (Phase 5 — 신호 다이어트). 표시 위치/크기만 제어, localStorage 영속.
  // 파싱 실패·부분 저장본은 DEFAULT_SIGNAL_DISPLAY로 폴백/병합(신규 필드 누락 방지).
  const [signalDisplay, setSignalDisplayState] = useState<SignalDisplaySettings>(() => {
    try {
      const stored = localStorage.getItem('asset-manager-signal-display-v1');
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<SignalDisplaySettings>;
        return {
          showGuruSignalsProminently:
            typeof parsed.showGuruSignalsProminently === 'boolean'
              ? parsed.showGuruSignalsProminently
              : DEFAULT_SIGNAL_DISPLAY.showGuruSignalsProminently,
          showRiskMatrixExpanded:
            typeof parsed.showRiskMatrixExpanded === 'boolean'
              ? parsed.showRiskMatrixExpanded
              : DEFAULT_SIGNAL_DISPLAY.showRiskMatrixExpanded,
        };
      }
    } catch { /* ignore */ }
    return { ...DEFAULT_SIGNAL_DISPLAY };
  });
  const handleSetSignalDisplay = (patch: Partial<SignalDisplaySettings>) => {
    setSignalDisplayState(prev => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem('asset-manager-signal-display-v1', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
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

  // 실행 큐 저장 액션 — 자동 검토 훅(자동 생성 opt-in)과 value.actions.updateActionQueue가 공유
  const updateActionQueueAction = useCallback((queue: ActionItem[]) => {
    setActionQueue(queue);
    triggerAutoSave(assets, portfolioHistory, sellHistory, watchlist, exchangeRates, undefined, undefined, undefined, undefined, queue, turtlePositions, turtleSettings);
  }, [assets, portfolioHistory, sellHistory, watchlist, exchangeRates, turtlePositions, turtleSettings, setActionQueue, triggerAutoSave]);

  // 터틀 자동 검토 (읽기 전용, Phase B) + opt-in 자동 생성 (Phase C) — 시세 준비 후 세션 1회.
  // refreshActionQueue와 동일한 fetch→조립 경로(loadTurtleMarketSnapshot)를 공유해 프리뷰≡생성 정합 보장.
  const { summary: actionQueueSummary } = useTurtleActionReview({
    assets,
    watchlist,
    exchangeRates,
    turtlePositions,
    turtleSettings,
    actionQueue,
    hasAutoUpdated,
    isMarketLoading,
    updateActionQueue: updateActionQueueAction,
  });

  // 정리 가능한 완료 주문 요약 (Phase 5, P5) — done/skipped 중 90일 경과분.
  // 표시/버튼 게이팅용 읽기 전용 파생(저장 없음). today는 로컬 날짜 문자열.
  const compactableActions = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const { removed } = compactResolvedActions(actionQueue, { today });
    // cutoffDate = today - 보존기간(90일) (util 내부와 동일 계산; 표시용 재산출).
    const cutoff = new Date(`${today}T00:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - ACTION_QUEUE_RETENTION_DAYS);
    return { count: removed.length, cutoffDate: cutoff.toISOString().slice(0, 10) };
  }, [actionQueue]);

  // 실행 축 게이트 입력 — **useMemo 필수**: 인라인 객체면 매 렌더 identity가 바뀌어
  // useAutoAlert의 결과 계산 effect(setAlertResults)가 무한 재실행된다.
  const executionGate = useMemo(() => ({
    actionableCount: actionQueueSummary.actionableCount,
    reviewPending: actionQueueSummary.reviewPending,
  }), [actionQueueSummary.actionableCount, actionQueueSummary.reviewPending]);

  // 자동 알림
  const {
    alertSettings,
    updateAlertSettings,
    alertResults,
    riskMatrix,
    sellDataGaps,
    showAlertPopup,
    dismissAlertPopup,
    showBriefingPopup,
    autoPopupDiagnosis,
  } = useAutoAlert({
    enrichedAssets,
    enrichedMap,
    isEnrichedLoading,
    hasAutoUpdated,
    isMarketLoading,
    watchlistItems: watchlist,
    // 실행 축: 알림 0건이어도 실행할 게 있으면 하루 1회 팝업. 검토 완료 전에는 게이트 대기(일자 미기록).
    executionGate,
  });

  // 구루 신호 평가/진단 대상 — 포트폴리오 + 관심종목을 단일 빌더(buildGuruSignalTargets)로 산출.
  // 신호 평가(guruSignals)와 진단 패널(useGuruDiagnostics)이 같은 targets를 공유해 집합 불일치를 막는다.
  const guruSignalTargets = useMemo<GuruSignalTarget[]>(() => {
    if (isEnrichedLoading || enrichedMap.size === 0) return [];
    return buildGuruSignalTargets({ portfolioAssets: enrichedAssets, watchlist, enrichedMap });
  }, [enrichedMap, enrichedAssets, watchlist, isEnrichedLoading]);

  // 구루 신호 엔진 — 활성 지식 규칙(typed condition)을 종목별로 평가 (data.knowledgeBase 기반)
  // 게이트(isActiveSignal) 통과 + condition 보유 규칙만 발화. 현재 구현된 지표만 매핑되므로
  // 신규 지표(④) 추가 시 어댑터 확장만으로 더 많은 규칙이 자동 발화된다.
  const guruSignals = useMemo<GuruSignalMatch[]>(() => {
    if (guruSignalTargets.length === 0) return [];
    return evaluateGuruSignals({
      rules: knowledgeBase.rules,
      claims: knowledgeBase.claims,
      targets: guruSignalTargets,
      now: new Date(),
    });
  }, [guruSignalTargets, knowledgeBase]);

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

  // 발화한 구루 신호별 데이터 품질 캐비엇 — 발화 여부는 불변(evaluateGuruSignals 결과 그대로), firing-partial만 표시 레이어에 노출.
  const guruSignalCaveats = useMemo(
    () => buildGuruSignalCaveats({
      matches: guruSignals,
      targets: guruSignalTargets,
      rules: knowledgeBase.rules,
      claims: knowledgeBase.claims,
      now: new Date(),
    }),
    [guruSignals, guruSignalTargets, knowledgeBase],
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
      actionQueue,
      turtlePositions,
      turtleSettings,
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
      accountView,
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
      signalDisplay,
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
      turtleExecAction,
      cleanupExecAction,
      rebalanceExecAction,
    },
    derived: {
      totalValue,
      alertCount,
      enrichedMap,
      enrichedAssets,
      isEnrichedLoading,
      alertResults,
      riskMatrix,
      sellDataGaps,
      guruSignals,
      guruSignalTargets,
      guruSignalChartTargets,
      guruSignalCaveats,
      autoPopupDiagnosis,
      actionQueueSummary,
      compactableActions,
      showAlertPopup,
      backupList: backup.backupList,
      backupSettings: backup.backupSettings,
      isBackingUp: backup.isBackingUp,
      marketOverview: marketOverviewData,
      marketOverviewStatus,
      marketOverviewError,
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
        refreshMarketOverview();
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
        return await handleConfirmSell(id, sellQuantity, sellPrice, sellDate, currency);
      },
      editSellRecord: handleEditSellRecord,
      deleteSellRecord: handleDeleteSellRecord,
      confirmBuyMore: async (id: string, buyDate: string, buyPrice: number, buyQuantity: number) => {
        return await handleConfirmBuyMore(id, buyQuantity, buyPrice, buyDate);
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
      setAccountView: handleSetAccountView,
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
      setSignalDisplay: handleSetSignalDisplay,
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
      openTurtleExecution: (action: ActionItem) => setTurtleExecAction(action),
      closeTurtleExecution: () => setTurtleExecAction(null),
      openCleanupExecution: (action: ActionItem) => setCleanupExecAction(action),
      closeCleanupExecution: () => setCleanupExecAction(null),
      openRebalanceExecution: (action: ActionItem) => setRebalanceExecAction(action),
      closeRebalanceExecution: () => setRebalanceExecAction(null),
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

      // 90/10 실행 시스템 (Phase 2) — 상태 갱신 후 Drive 자동 저장 (10~12번째 인자).
      // 자동 검토 훅(자동 생성 opt-in)과 동일 콜백 공유 (위 updateActionQueueAction)
      updateActionQueue: updateActionQueueAction,
      // 완료 주문 정리 (Phase 5, P5) — done/skipped 중 90일 경과분을 메인 payload에서 제거.
      // 명시적 사용자 행동(설정 패널 버튼)만 트리거. 복구원은 자동 백업. removed 0이면 미저장(불필요 저장 방지).
      compactActionQueue: (): number => {
        const today = new Date().toISOString().slice(0, 10);
        const { kept, removed } = compactResolvedActions(actionQueue, { today });
        if (removed.length === 0) return 0;
        commitPortfolioPatch({ actionQueue: kept });
        return removed.length;
      },
      updateTurtlePositions: (positions: TurtlePosition[]) => {
        setTurtlePositions(positions);
        triggerAutoSave(assets, portfolioHistory, sellHistory, watchlist, exchangeRates, undefined, undefined, undefined, undefined, actionQueue, positions, turtleSettings);
      },
      updateTurtleSettings: (settings: TurtleSettings) => {
        setTurtleSettings(settings);
        triggerAutoSave(assets, portfolioHistory, sellHistory, watchlist, exchangeRates, undefined, undefined, undefined, undefined, actionQueue, turtlePositions, settings);
      },
      commitPortfolioPatch,
      // 대청소 일괄 분류 저장 (Phase 3b/3c-2) — 순수 빌더로 assets+watchlist+actionQueue 계산 후 단일 원자 커밋.
      // turtle→관심종목 등록, liquidate→CLEANUP_SELL 생성(이번 저장 변경분만·dedup). 실행은 3d.
      saveCleanupDecisions: (decisions: Record<string, CleanupDecision>) => {
        const today = new Date().toISOString().slice(0, 10);
        const seqBase = Date.now().toString(36);
        const metricsById = new Map(enrichedAssets.map(a => [a.id, { returnPct: a.metrics.returnPercentage, profitLossKRW: a.metrics.profitLossKRW }]));
        const result = buildCleanupCommit(decisions, { assets, watchlist, actionQueue }, {
          today,
          makeId: (seq) => `cl-${today}-${seqBase}-${seq}`,
          metricsOf: (id) => metricsById.get(id),
        });
        commitPortfolioPatch({ assets: result.assets, watchlist: result.watchlist, actionQueue: result.actionQueue });
      },
      // 시장 요약(금 김치 프리미엄 + 환율)
      refreshMarketOverview,
      // 백업
      performBackup: () => backup.performBackup(),
      loadBackupList: backup.loadBackupList,
      restoreBackup: async (fileId: string) => {
        const content = await backup.restoreBackup(fileId);
        if (content) {
          try {
            // 전 도메인 공용 파이프라인으로 복원(P2 유실 버그 수정) + 복원 데이터 명시 저장
            restoreFromPayload(content);
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
