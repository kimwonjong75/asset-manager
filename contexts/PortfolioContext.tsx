import React, { createContext, useContext, useState, useMemo, useEffect, useCallback } from 'react';
import {
  Asset,
  Currency,
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
import { useEnrichedIndicators, invalidateEnrichedCache } from '../hooks/useEnrichedIndicators';
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
import type { ValuationSettings } from '../types/valuation';
import { evaluateGuruSignals, buildGuruSignalTargets, buildGuruSignalChartTargets, type GuruSignalMatch, type GuruSignalTarget } from '../utils/guruSignalEngine';
import { buildGuruSignalCaveats } from '../utils/guruDiagnostics';
import {
  DEFAULT_FIXED_COLUMN_WIDTHS,
  MIN_COLUMN_WIDTH,
  DEFAULT_SIGNAL_DISPLAY,
  type ColumnConfig,
  type ColumnKey,
  type FixedColumnWidths,
  type SignalDisplaySettings,
} from '../types/ui';
import { DEFAULT_MA_CONFIGS, clampMAPeriod, type MALineConfig } from '../utils/maCalculations';
import { getDefaultColumnConfig, mergeColumnConfig } from '../utils/columnConfig';
import { OWNER_FILTER_OPTIONS, type OwnerFilter } from '../types/owner';
import { buildCleanupCommit } from '../utils/cleanupPlan';
import type { CleanupDecision } from '../types/cleanup';
import { compactResolvedActions, ACTION_QUEUE_RETENTION_DAYS } from '../utils/actionQueueCompaction';
import { localDateString } from '../utils/localDate';
import { describeFreshness, LAST_PRICE_REFRESH_AT_KEY } from '../utils/priceFreshness';
import { usePriceFreshnessRefresh } from '../hooks/usePriceFreshnessRefresh';
import { resolveTabAlias } from '../utils/deepLink';
import { useTradePlanSignals } from '../hooks/useTradePlanSignals';
import { cancelPlan, recordDecision, armExitLine, applyPyramidFill } from '../utils/tradePlan';
import { applySellOutcome, sellPrefillFor } from '../utils/tradePlanLink';
import { fxRateToKRWFor } from '../utils/tradePlanMarket';
import { transferWatchPlanToAsset, findWatchItemForAsset } from '../utils/tradePlanTransfer';
import type { TradePlan, PlanDecision, PlanFill, PyramidFillResult, SellOutcome } from '../types/tradePlan';
import { PYRAMID_FILL_ERROR_LABELS } from '../types/tradePlan';
import { resolveHoldingsSettings } from '../utils/turtleHoldings';
import { recordTurtleExit, recordTurtleReentry, recordTurtlePyramid, recordTurtleHold as recordTurtleHoldPure } from '../utils/turtleHoldingsState';
import type { TurtleHoldingsRow } from '../utils/turtleHoldingsView';
import type {
  RecordTurtleSellInput, RecordTurtleSellOutcome,
  RecordTurtleBuyInput, RecordTurtleBuyOutcome,
  RecordTurtleHoldOutcome,
} from '../types/turtleHoldingsActions';

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

// 컬럼 설정 기본값·저장본 머지는 utils/columnConfig (Stage D1 이관, 동작 동일)

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
    // 개별 setter 는 더 이상 필요 없다 — commitPortfolio 가 setState + 저장을 함께 처리한다.
    categoryStore,
    knowledgeBase,
    actionQueue,
    turtlePositions,
    turtleSettings,
    valuationSettings,
    isSignedIn, googleUser, needsReAuth,
    isInitializing: isAuthInitializing,
    isLoading: isAuthLoading,
    error, setError,
    successMessage, setSuccessMessage,
    hasAutoUpdated, setHasAutoUpdated,
    shouldAutoUpdate, setShouldAutoUpdate,
    handleSignIn,
    handleSignOut,
    commitPortfolio,
    saveNow,
    getSnapshot,
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
    commitPortfolio,
    saveNow,
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

  // P4: 마지막 시세 갱신 완료 시각(ISO) — localStorage 미러를 state로 들고 있어야 갱신 직후
  // 상단바 라벨이 리렌더된다(localStorage 쓰기 자체는 React를 리렌더하지 않음).
  const [priceDataAsOf, setPriceDataAsOf] = useState<string | null>(() => {
    try { return localStorage.getItem(LAST_PRICE_REFRESH_AT_KEY); } catch { return null; }
  });
  // P4: enriched(MA/RSI 등) 지표의 10분 모듈 캐시를 시세 갱신 직후 강제 무효화하기 위한 트리거.
  // 값 자체는 임의 — useEnrichedIndicators effect의 deps로만 쓰여 재조회를 강제한다.
  const [enrichedRefreshVersion, setEnrichedRefreshVersion] = useState(0);

  // P4: 시세 갱신 + 신선도 기준시각 기록 + enriched 캐시 무효화를 하나로 묶은 공용 실행자 —
  // 자동/탭복귀 재확인/수동 버튼 3경로가 공유한다(중복 방지). handleRefreshAllPrices는 내부에서
  // 에러를 삼키므로(catch에서 setError만 하고 재throw 안 함) 이 then은 항상 도달한다.
  // **`.then()`으로 작성**(async/await 아님): 자동 업데이트 effect가 이 함수를 직접 호출하는데,
  // setState를 async 함수 본문에 두면 react-hooks/set-state-in-effect가 "effect 안에서 동기
  // setState"로 오탐한다(react-hooks v7 컴파일러 분석은 await 이후 위치를 구분하지 않음) —
  // `.then()` 콜백으로 감싸면 정적 분석 범위 밖이라 오탐이 사라진다.
  const runPriceRefresh = useCallback((isAutoUpdate: boolean): Promise<void> => {
    return handleRefreshAllPrices(isAutoUpdate).then(ok => {
      if (!ok) return; // 실패한 갱신은 기준시각으로 기록하지 않는다(오래된 값을 신선한 것처럼 표시 금지)
      const iso = new Date().toISOString();
      try { localStorage.setItem(LAST_PRICE_REFRESH_AT_KEY, iso); } catch { /* ignore */ }
      setPriceDataAsOf(iso);
      invalidateEnrichedCache();
      setEnrichedRefreshVersion(v => v + 1);
    });
  }, [handleRefreshAllPrices]);

  // 앱 시작 시 자동 업데이트 (신선도 게이트가 필요하다고 판단했을 때만 — usePortfolioData 참고)
  useEffect(() => {
    if (shouldAutoUpdate && assets.length > 0 && !hasAutoUpdated && !isMarketLoading) {
      localStorage.setItem('lastAutoUpdateDate', localDateString());
      setHasAutoUpdated(true);
      setShouldAutoUpdate(false);
      runPriceRefresh(true);
      refreshMarketOverview();
    }
  }, [shouldAutoUpdate, assets.length, hasAutoUpdated, isMarketLoading, runPriceRefresh, refreshMarketOverview, setHasAutoUpdated, setShouldAutoUpdate]);

  // P4: 일일 백업은 시세 갱신 여부와 무관하게 "시세가 준비된 날" 1회 — 신선도 게이트가 갱신을 건너뛴
  // 날에도 백업이 빠지지 않도록 자동 갱신 effect에서 분리했다(중복 방지는 useBackup의 날짜 키가 담당).
  useEffect(() => {
    if (isSignedIn && hasAutoUpdated && assets.length > 0 && !isMarketLoading) {
      backup.performBackup();
    }
  }, [isSignedIn, hasAutoUpdated, assets.length, isMarketLoading, backup.performBackup]);

  // P4: 탭이 다시 보일 때(visibilitychange) 신선도 게이트를 재확인 — 앱을 켜 둔 채 오래 방치한 뒤
  // 돌아왔을 때도 "오래됐으면" 갱신한다(useMarketOverview의 visibilitychange 패턴과 동일).
  usePriceFreshnessRefresh({
    isSignedIn,
    isLoading: isMarketLoading,
    assets,
    watchlist,
    refreshAllPrices: () => runPriceRefresh(true),
  });

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
    handleAddWatchItemWithPlan,
    handleUpdateWatchItem,
    handleDeleteWatchItem,
    handleBulkDeleteWatchItems,
  } = useAssetActions({
    // setter 를 넘기지 않는다 — 상태 변경은 전부 commitPortfolioPatch 한 경로로만 일어난다.
    assets,
    sellHistory,
    exchangeRates,
    isSignedIn,
    getSnapshot,
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
  // 기본 탭 = 'dashboard'(라벨 '홈'). 2026-09-14 사용자가 P3 결정(기본 탭 'today', 2026-09-04)을 번복 —
  // 독립 '오늘' 탭은 폐지되고 그 내용은 홈 상단 '오늘의 브리핑'으로 흡수됐다.
  // 'today'/'execution'은 handleTabChange에서 resolveTabAlias로 'dashboard'로 바뀌어 상태에 남지 않는다.
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
  const [turtleHoldingsBuyTarget, setTurtleHoldingsBuyTarget] = useState<TurtleHoldingsRow | null>(null);
  // 매매 계획 일괄 만들기 마법사(TradePlanBulkWizard) 열림 여부 (P2a)
  const [tradePlanBulkOpen, setTradePlanBulkOpen] = useState<boolean>(false);

  // 매도 모달 프리필 (P2b) — 계획 카드 [매도 기록] 경유로 열 때만 채운다.
  // sellingAsset과 항상 같이 세팅/해제된다(모달이 열린 채로 단독 변경되지 않음).
  const [sellPrefill, setSellPrefill] = useState<{ quantity?: number; price?: number; outcome?: SellOutcome } | null>(null);

  // "새 매수 계획" 독립 화면(TradePlanPlanner, P2c) — 열림 여부 + 진입 프리필(관심종목 행 메뉴 등)
  const [plannerOpen, setPlannerOpen] = useState<boolean>(false);
  const [plannerPrefill, setPlannerPrefill] = useState<{ watchItemId?: string; ticker?: string; exchange?: string; name?: string } | null>(null);

  // 신규 자산 추가 모달 프리필(P2c) — 플래너 [지금 매수 기록하며 저장] 경유로 열 때만 채운다.
  const [addAssetPrefill, setAddAssetPrefill] = useState<{
    ticker: string; exchange: string; name: string; currency?: Currency;
    categoryId?: number; quantity?: number; purchasePrice?: number; plan?: TradePlan;
  } | null>(null);

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

  // P6 정보 다이어트 — 홈(dashboard) 탭에서 브리핑 팝업이 자동으로 뜨지 않게 하는 표시 전용 플래그
  // (홈 상단 '오늘의 브리핑'이 같은 내용을 이미 보여줌. 2026-09-14 '오늘' 탭 폐지 전에는 '오늘' 탭 기준).
  // useAutoAlert의 게이트(showAlertPopup/dismissAlertPopup/showBriefingPopup)는 그대로 두고
  // (골든 테스트가 고정하는 자동팝업 판정 로직 무변경), 여기서 얇게 감싸 App.tsx의 렌더 조건에만 쓴다.
  const [briefingManual, setBriefingManual] = useState(false);

  // 포트폴리오 테이블 컬럼 설정 — localStorage 영속 + 스키마 마이그레이션
  const [columnConfig, setColumnConfigState] = useState<ColumnConfig[]>(() => {
    try {
      const raw = localStorage.getItem('asset-manager-column-config-v1');
      if (raw) {
        const parsed = JSON.parse(raw) as ColumnConfig[];
        if (Array.isArray(parsed)) return mergeColumnConfig(parsed);
      }
    } catch { /* ignore */ }
    return getDefaultColumnConfig();
  });
  const persistColumnConfig = (next: ColumnConfig[]) => {
    setColumnConfigState(next);
    try { localStorage.setItem('asset-manager-column-config-v1', JSON.stringify(next)); } catch { /* ignore */ }
    // 컬럼 설정 변경은 Drive autoSave 의존성에 포함되지 않으므로 명시적으로 트리거.
    // (hookAutoSave는 localStorage에서 최신 tableLayout을 읽어 백업에 포함하며, 디바운스됨)
    saveNow();
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
    saveNow();
  };
  const handleResetColumnConfig = () => {
    persistColumnConfig(getDefaultColumnConfig());
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
  const DEFAULT_TITLE = "KIM'S 퀀트자산관리";
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
    sellAlertDropRate,
    plBasis: valuationSettings.plBasis,
  });

  // enriched 지표 (Context 레벨에서 한 번만 계산, 관심종목 포함)
  const { enrichedMap, isLoading: isEnrichedLoading } = useEnrichedIndicators(assets, watchlist, enrichedRefreshVersion);

  // EnrichedAsset 목록 생성 (알림 체크용)
  // 수익률 기준이 바뀌면 두 콜백의 identity 가 바뀌고(useCallback deps=[plBasis]),
  // 아래 useMemo 가 그 둘에 의존하므로 enrichedAssets 가 즉시 재계산된다 → 알림 판정도 함께 전환.
  const { calculateAssetMetrics, calculatePortfolioStats } = usePortfolioCalculator(valuationSettings.plBasis);
  const enrichedAssets = useMemo(() => {
    const stats = calculatePortfolioStats(assets, exchangeRates);
    return assets.map(a => calculateAssetMetrics(a, exchangeRates, stats.totalValue));
  }, [assets, exchangeRates, calculatePortfolioStats, calculateAssetMetrics]);

  // 매매 계획(TradePlan) 신호 평가 — 활성 계획을 현재 시세/지표로 평가해 홈 '오늘의 브리핑'·아코디언 카드가
  // 공유하는 단일 소스(P2a). enrichedMap/priceDataAsOf는 이미 위에서 계산됨.
  const { rows: tradePlanRows, summary: tradePlanSummary, planlessSatellites } = useTradePlanSignals({
    assets, enrichedMap, priceDataAsOf,
  });

  // 실행 큐 저장 액션 — 자동 검토 훅(자동 생성 opt-in)과 value.actions.updateActionQueue가 공유
  const updateActionQueueAction = useCallback((queue: ActionItem[]) => {
    commitPortfolio({ actionQueue: queue }); // setState + 저장을 한 경로로
  }, [commitPortfolio]);

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

  // 알림 규칙 설정이 사용자 조작으로 저장된 직후 → Drive autoSave 트리거.
  // 컬럼 설정(persistColumnConfig)과 동일 패턴: hookAutoSave가 localStorage에서
  // 최신 alertSettings를 읽어 페이로드에 싣는다(디바운스됨). 이로써 규칙 설정이 기기 간 유지된다.
  const handleAlertSettingsPersisted = useCallback(() => {
    saveNow();
  }, [saveNow]);

  // 자동 알림 — showAlertPopup/dismissAlertPopup/showBriefingPopup의 게이트 판정 자체는
  // useAutoAlert 내부에서 완결된다(골든 테스트가 고정 — 이 레이어는 손대지 않는다). 아래에서
  // dismiss/show 두 개만 `briefingManual` 갱신을 곁들여 얇게 감싼다(P6, App.tsx 렌더 조건용).
  const {
    alertSettings,
    updateAlertSettings,
    alertResults,
    riskMatrix,
    sellDataGaps,
    showAlertPopup,
    dismissAlertPopup: dismissAlertPopupInternal,
    showBriefingPopup: showBriefingPopupInternal,
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
    onSettingsPersisted: handleAlertSettingsPersisted,
  });
  const handleDismissAlertPopup = useCallback(() => {
    setBriefingManual(false);
    dismissAlertPopupInternal();
  }, [dismissAlertPopupInternal]);
  const handleShowBriefingPopup = useCallback(() => {
    setBriefingManual(true);
    showBriefingPopupInternal();
  }, [showBriefingPopupInternal]);

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

  // P4: 시세 기준 시각 한국어 라벨 — priceDataAsOf가 바뀔 때만 재계산(호출 시점의 now는
  // 라벨 포맷에 쓰이지 않는다 — describeFreshness 참고).
  const priceFreshnessLabel = useMemo(
    () => describeFreshness(priceDataAsOf, new Date().toISOString()),
    [priceDataAsOf],
  );

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
    plBasis: valuationSettings.plBasis,
    isSignedIn,
    saveNow,
    setError,
    setSuccessMessage,
    setAssets,
    setPortfolioHistory,
    setSellHistory,
    setWatchlist,
    setExchangeRates,
    setAllocationTargets,
  });

  const handleTabChange = (requested: UIState['activeTab']) => {
    // 폐지 탭('today'/'execution') → 'dashboard'. 발송된 카톡 ?tab=today 링크 호환 — utils/deepLink 참고.
    const tab = resolveTabAlias(requested);
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
      valuationSettings,
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
      briefingManual,
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
      turtleHoldingsBuyTarget,
      tradePlanBulkOpen,
      sellPrefill,
      plannerOpen,
      plannerPrefill,
      addAssetPrefill,
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
      priceDataAsOf,
      priceFreshnessLabel,
      tradePlanRows,
      tradePlanSummary,
      planlessSatellites,
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
        await runPriceRefresh(!!force);
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
        commitPortfolio({ assets: newAssets });
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
      addWatchItem: handleAddWatchItem,
      updateWatchItem: handleUpdateWatchItem,
      deleteWatchItem: handleDeleteWatchItem,
      bulkDeleteWatchItems: handleBulkDeleteWatchItems,
      togglePinWatchItem: (id: string) => {
        const newWatchlist = watchlist.map(w =>
          w.id === id ? { ...w, pinned: !w.pinned } : w
        );
        commitPortfolio({ watchlist: newWatchlist });
      },
      uploadCsv: handleCsvFileUpload,
      updateAlertSettings,
      dismissAlertPopup: handleDismissAlertPopup,
      showBriefingPopup: handleShowBriefingPopup,
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
        commitPortfolio({ sellAlertDropRate: n });
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
        commitPortfolio({ allocationTargets: targets });
      },
      openEditModal: (asset: Asset) => setEditingAsset(asset),
      closeEditModal: () => setEditingAsset(null),
      openSellModal: (asset: Asset) => setSellingAsset(asset),
      closeSellModal: () => { setSellingAsset(null); setSellPrefill(null); },
      openBuyModal: (asset: Asset) => setBuyingAsset(asset),
      closeBuyModal: () => setBuyingAsset(null),
      openBulkUpload: () => setIsBulkUploadModalOpen(true),
      closeBulkUpload: () => setIsBulkUploadModalOpen(false),
      openAddAsset: () => setIsAddAssetModalOpen(true),
      closeAddAsset: () => { setIsAddAssetModalOpen(false); setAddAssetPrefill(null); },
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
      openTurtleHoldingsBuy: (row: TurtleHoldingsRow) => setTurtleHoldingsBuyTarget(row),
      closeTurtleHoldingsBuy: () => setTurtleHoldingsBuyTarget(null),
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
        commitPortfolio({ categoryStore: updated });
      },
      renameCategory: (id: number, newName: string) => {
        const updated: CategoryStore = {
          ...categoryStore,
          categories: categoryStore.categories.map(c =>
            c.id === id ? { ...c, name: newName } : c
          ),
        };
        commitPortfolio({ categoryStore: updated });
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
        // 4개 도메인 동시 변경 — 한 번의 커밋으로 묶어 형제 유실·중복 저장을 없앤다.
        commitPortfolio({
          assets: newAssets,
          watchlist: newWatchlist,
          sellHistory: newSellHistory,
          categoryStore: updated,
        });
      },
      // 지식 베이스 (구루 지식 DB) — 상태 갱신 + Drive 자동 저장
      updateKnowledgeBase: (kb: KnowledgeBase) => {
        commitPortfolio({ knowledgeBase: kb });
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
        commitPortfolio({ turtlePositions: positions });
      },
      updateTurtleSettings: (settings: TurtleSettings) => {
        commitPortfolio({ turtleSettings: settings });
      },
      // 수익률 기준 전환 — 저장 데이터는 그대로고 **표시·판정 규약만** 바뀐다.
      // 커밋 즉시 enrichedAssets가 재계산되어 표·대시보드·알림이 같은 기준을 쓴다.
      updateValuationSettings: (settings: ValuationSettings) => {
        commitPortfolio({ valuationSettings: settings });
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

      // "보유종목 터틀" 저장 액션 (P2, 계획서 §6 P2 2-2) — 돈 기록이 먼저 성공한 뒤에만 터틀 상태를 커밋한다
      // (RULES §6-S 단일 저장 경로, CLAUDE.md "보이지 않는 쓰기 금지"). getSnapshot()을 읽는다 —
      // handleConfirmSell/handleAddAsset/handleConfirmBuyMore의 커밋 직후 같은 틱에 이어질 수 있어
      // 렌더 클로저(watchlist/turtlePositions)가 stale일 수 있다(§8 stale 규약).
      recordTurtleSell: async (input: RecordTurtleSellInput): Promise<RecordTurtleSellOutcome> => {
        const asset = getSnapshot().assets.find(a => a.id === input.assetId);
        if (!asset) return { ok: false, reason: 'asset-not-found' };

        const sellResult = await handleConfirmSell(input.assetId, input.sellQuantity, input.sellPrice, input.sellDate, input.settlementCurrency);
        if (!sellResult.ok) return sellResult;

        // 일부 매도는 터틀 청산이 아니다 — 전량 매도(assetClosed)일 때만 감시 등록·포지션 종료(Advisor 보정 2026-09-26)
        if (!input.addToWatchlist || !sellResult.assetClosed) {
          return {
            ok: true, sellRecordId: sellResult.sellRecordId, assetClosed: sellResult.assetClosed,
            updatedAsset: sellResult.updatedAsset, watchItemId: null, isNewWatchItem: false, closedPositionId: null,
          };
        }

        const snap = getSnapshot();
        const position = snap.turtlePositions.find(
          p => p.assetId === input.assetId && p.status === 'open' && p.origin === 'holdings-reentry',
        ) ?? null;
        const exitResult = recordTurtleExit({
          asset: {
            ticker: asset.ticker, exchange: asset.exchange, name: asset.customName?.trim() || asset.name,
            categoryId: asset.categoryId, currency: asset.currency,
          },
          soldAt: sellResult.sellRecord.sellDate,
          soldPriceOriginal: sellResult.sellRecord.sellPriceOriginal ?? 0,
          source: 'turtle-exit',
          watchlist: snap.watchlist,
          position,
          makeWatchId: () => `tw-${Date.now()}`,
        });
        if (!exitResult.ok) return { ok: false, reason: exitResult.reason };

        commitPortfolio({
          watchlist: exitResult.watchlist,
          turtlePositions: exitResult.closedPosition
            ? snap.turtlePositions.map(p => (p.id === exitResult.closedPosition!.id ? exitResult.closedPosition! : p))
            : snap.turtlePositions,
        });
        setSuccessMessage('매도를 기록했습니다. "다시 살 때" 감시 명단에 추가했습니다.');
        return {
          ok: true, sellRecordId: sellResult.sellRecordId, assetClosed: sellResult.assetClosed,
          updatedAsset: sellResult.updatedAsset, watchItemId: exitResult.watchItemId,
          isNewWatchItem: exitResult.isNewWatchItem, closedPositionId: exitResult.closedPosition?.id ?? null,
        };
      },
      recordTurtleBuy: async (input: RecordTurtleBuyInput): Promise<RecordTurtleBuyOutcome> => {
        const settings = resolveHoldingsSettings(getSnapshot().turtleSettings.holdings);

        if (input.mode === 'reentry') {
          const form = {
            ticker: input.ticker, exchange: input.exchange, name: input.name, categoryId: input.categoryId,
            currency: input.currency, quantity: input.quantity, purchasePrice: input.fillPrice, purchaseDate: input.fillDate,
          } as unknown as Parameters<typeof handleAddAsset>[0];
          const addResult = await handleAddAsset(form);
          if (!addResult.ok) return addResult;

          const reentryResult = recordTurtleReentry({
            id: `tp-${Date.now()}`, ticker: input.ticker, name: input.name, assetId: addResult.assetId,
            fillDate: input.fillDate, fillPrice: input.fillPrice, quantity: input.quantity, nAtFill: input.nAtFill,
            fxRate: input.fxRate, donchianHigh: input.donchianHigh, settings,
          });
          if (!reentryResult.ok) return { ok: false, reason: reentryResult.reason };

          commitPortfolio({ assets: addResult.nextAssets, turtlePositions: [...getSnapshot().turtlePositions, reentryResult.position] });
          setSuccessMessage(`${input.name} 재매수를 기록했습니다.`);
          return { ok: true, assetId: addResult.assetId, positionId: reentryResult.position.id };
        }

        // mode === 'pyramid'
        const buyResult = await handleConfirmBuyMore(input.assetId, input.quantity, input.fillPrice, input.fillDate);
        if (!buyResult.ok) return buyResult;

        const snap = getSnapshot();
        const position = snap.turtlePositions.find(p => p.id === input.positionId);
        if (!position) return { ok: false, reason: 'position-missing' };
        const pyramidResult = recordTurtlePyramid(
          position,
          { fillDate: input.fillDate, fillPrice: input.fillPrice, quantity: input.quantity, nAtFill: input.nAtFill, fxRate: input.fxRate },
          settings,
        );
        if (!pyramidResult.ok) return { ok: false, reason: pyramidResult.reason };

        commitPortfolio({
          assets: buyResult.nextAssets,
          turtlePositions: snap.turtlePositions.map(p => (p.id === position.id ? pyramidResult.position : p)),
        });
        setSuccessMessage(`${position.name} 추가 매수(불타기)를 기록했습니다.`);
        return { ok: true, assetId: input.assetId, positionId: position.id };
      },
      recordTurtleHold: (assetId: string, reason: string): RecordTurtleHoldOutcome => {
        const snap = getSnapshot();
        const asset = snap.assets.find(a => a.id === assetId);
        if (!asset) return { ok: false, reason: 'asset-not-found' };
        const result = recordTurtleHoldPure({ decisions: asset.turtleDecisions, date: localDateString(), reason });
        if (!result.ok) return result;
        commitPortfolio({ assets: snap.assets.map(a => (a.id === assetId ? { ...a, turtleDecisions: result.decisions } : a)) });
        setSuccessMessage('이번엔 보류로 기록했습니다.');
        return { ok: true };
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
          } catch {
            setError('백업 데이터 파싱에 실패했습니다.');
            setTimeout(() => setError(null), 3000);
          }
        }
      },
      deleteBackup: backup.deleteBackup,
      updateBackupSettings: backup.updateSettings,

      // 매매 계획 (P2a) — 전부 commitPortfolio(단일 커밋) 경유. now/date는 여기서 생성(utils는 순수 유지).
      // ⚠ 렌더 클로저의 assets/watchlist 대신 getSnapshot()을 읽는다 — 자산 추가/추가매수 커밋 직후 같은 틱에
      //   호출되면 클로저가 stale이라 방금 커밋한 변경을 덮어쓴다(saveQueue last-write-wins).
      saveTradePlan: (assetId: string, plan: TradePlan) => {
        const nextAssets = getSnapshot().assets.map(a => (a.id === assetId ? { ...a, tradePlan: plan } : a));
        commitPortfolio({ assets: nextAssets });
        setSuccessMessage('매매 계획 저장됨');
      },
      clearTradePlan: (assetId: string) => {
        const today = localDateString();
        const nowIso = new Date().toISOString();
        const nextAssets = getSnapshot().assets.map(a =>
          a.id === assetId && a.tradePlan ? { ...a, tradePlan: cancelPlan(a.tradePlan, today, nowIso) } : a
        );
        commitPortfolio({ assets: nextAssets });
        setSuccessMessage('매매 계획 해제됨');
      },
      saveWatchTradePlan: (watchItemId: string, plan: TradePlan | null) => {
        const nextWatchlist = getSnapshot().watchlist.map(w => {
          if (w.id !== watchItemId) return w;
          if (plan === null) {
            if (w.tradePlan === undefined) return w;
            const clone = { ...w };
            delete clone.tradePlan;
            return clone;
          }
          return { ...w, tradePlan: plan };
        });
        commitPortfolio({ watchlist: nextWatchlist });
        setSuccessMessage(plan === null ? '매매 계획 취소됨' : '매매 계획 저장됨');
      },
      recordTradePlanDecision: (assetId: string, decision: PlanDecision) => {
        const nowIso = new Date().toISOString();
        const nextAssets = getSnapshot().assets.map(a =>
          a.id === assetId && a.tradePlan ? { ...a, tradePlan: recordDecision(a.tradePlan, decision, nowIso) } : a
        );
        commitPortfolio({ assets: nextAssets });
      },
      armTradePlanExitLine: (assetId: string, date: string) => {
        const nowIso = new Date().toISOString();
        const nextAssets = getSnapshot().assets.map(a =>
          a.id === assetId && a.tradePlan ? { ...a, tradePlan: armExitLine(a.tradePlan, date, nowIso) } : a
        );
        commitPortfolio({ assets: nextAssets });
        setSuccessMessage('추세선 적용을 시작했습니다');
      },
      setTradePlanBrokerStop: (assetId: string, registered: boolean) => {
        const nowIso = new Date().toISOString();
        const nextAssets = getSnapshot().assets.map(a =>
          a.id === assetId && a.tradePlan
            ? { ...a, tradePlan: { ...a.tradePlan, brokerStopOrderRegistered: registered, updatedAt: nowIso } }
            : a
        );
        commitPortfolio({ assets: nextAssets });
      },
      openTradePlanBulk: () => setTradePlanBulkOpen(true),
      closeTradePlanBulk: () => setTradePlanBulkOpen(false),
      saveTradePlansBulk: (entries: { assetId: string; plan: TradePlan }[]) => {
        if (entries.length === 0) return;
        const byId = new Map(entries.map(e => [e.assetId, e.plan]));
        const nextAssets = getSnapshot().assets.map(a => (byId.has(a.id) ? { ...a, tradePlan: byId.get(a.id) } : a));
        commitPortfolio({ assets: nextAssets });
        setSuccessMessage(`매매 계획 ${entries.length}건을 저장했습니다`);
      },

      // 매매 계획 ↔ 돈 기록 연동 (P2b) — 돈(confirmSell/confirmBuyMore)은 그대로 두고,
      // **성공한 뒤에** 계획 상태만 별도 커밋한다. 여기서도 getSnapshot()을 읽는다(위 P2a 주석 참조).
      openSellWithPlan: (assetId: string, outcome: SellOutcome) => {
        const asset = getSnapshot().assets.find(a => a.id === assetId);
        if (!asset || !asset.tradePlan || asset.tradePlan.status !== 'active') return;
        const prefill = sellPrefillFor(asset.tradePlan, asset, outcome);
        setSellingAsset(asset);
        setSellPrefill({ quantity: prefill.quantity, price: prefill.priceOriginal, outcome });
      },
      applyTradePlanSellOutcome: (assetId: string, outcome: SellOutcome, fill: PlanFill) => {
        const nowIso = new Date().toISOString();
        const nextAssets = getSnapshot().assets.map(a =>
          a.id === assetId && a.tradePlan && a.tradePlan.status === 'active'
            ? { ...a, tradePlan: applySellOutcome(a.tradePlan, outcome, fill, nowIso) }
            : a
        );
        commitPortfolio({ assets: nextAssets });
        setSuccessMessage('매매 계획 상태를 갱신했습니다');
      },
      applyTradePlanPyramidFill: (assetId: string, fill: PlanFill): PyramidFillResult => {
        const snap = getSnapshot();
        const asset = snap.assets.find(a => a.id === assetId);
        if (!asset || !asset.tradePlan) return { ok: false, reason: 'no-step' };
        const fx = fxRateToKRWFor(asset.currency, snap.exchangeRates);
        const result = applyPyramidFill(asset.tradePlan, fill, { fxRateToKRW: fx });
        if (!result.ok) {
          // 매수 자체는 이미 커밋됐다 — 계획 반영만 실패했음을 사유 그대로 알린다(롤백 없음).
          setError(PYRAMID_FILL_ERROR_LABELS[result.reason]);
          setTimeout(() => setError(null), 3000);
          return result;
        }
        const nextAssets = snap.assets.map(a => (a.id === assetId ? { ...a, tradePlan: result.plan } : a));
        commitPortfolio({ assets: nextAssets });
        setSuccessMessage('불타기 체결을 계획에 기록했습니다');
        return result;
      },

      // "새 매수 계획" 독립 화면 (P2c)
      openTradePlanPlanner: (prefill) => {
        setPlannerPrefill(prefill ?? null);
        setPlannerOpen(true);
      },
      closeTradePlanPlanner: () => {
        setPlannerOpen(false);
        setPlannerPrefill(null);
      },
      openAddAssetWithPrefill: (prefill) => {
        setAddAssetPrefill(prefill);
        setIsAddAssetModalOpen(true);
      },
      // 새 자산과 짝이 맞는 관심종목의 활성 계획을 자산으로 이전 — assets+watchlist 단일 커밋.
      // getSnapshot()을 읽는다: AddNewAssetModal의 자산 추가 커밋 직후 같은 틱에 호출되므로
      // 렌더 클로저(assets/watchlist)는 stale일 수 있다(P2a/P2b와 동일 규약).
      adoptWatchPlanForAsset: (assetId: string) => {
        const snap = getSnapshot();
        const asset = snap.assets.find(a => a.id === assetId);
        if (!asset) return;
        const watchItem = findWatchItemForAsset(snap.watchlist, asset);
        if (!watchItem || !watchItem.tradePlan || watchItem.tradePlan.status !== 'active') return;
        const fx = fxRateToKRWFor(asset.currency, snap.exchangeRates);
        const nowIso = new Date().toISOString();
        // totalValue는 렌더 클로저 값 — AddNewAssetModal의 기존 P2a 기본계획 경로(defaultEditorInput)와
        // 동일하게 "자산 추가 커밋 직전 총자산"을 쓴다(getSnapshot에는 파생 합계가 없음).
        const transferred = transferWatchPlanToAsset(watchItem.tradePlan, asset, {
          fxRateToKRW: fx, now: nowIso, totalEquityKRW: totalValue,
        });
        if (!transferred) return;
        const nextAssets = snap.assets.map(a => (a.id === assetId ? { ...a, tradePlan: transferred } : a));
        const nextWatchlist = snap.watchlist.map(w => {
          if (w.id !== watchItem.id) return w;
          const clone = { ...w };
          delete clone.tradePlan;
          return clone;
        });
        commitPortfolio({ assets: nextAssets, watchlist: nextWatchlist });
        setSuccessMessage('관심종목 계획을 자산으로 이전했습니다');
      },
      addWatchItemWithPlan: handleAddWatchItemWithPlan,
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
