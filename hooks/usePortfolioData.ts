import { useState, useEffect, useCallback, useMemo } from 'react';
import { Asset, PortfolioSnapshot, SellRecord, WatchlistItem, ExchangeRates, AllocationTargets } from '../types';
import { useGoogleDriveSync } from './useGoogleDriveSync';
import { runMigrationIfNeeded, migrateCategorySystem } from '../utils/migrateData';
import { CategoryStore, DEFAULT_CATEGORY_STORE, CategoryBaseType } from '../types/category';
import { mapToNewAssetStructure } from '../utils/portfolioCalculations';
import { fillAllMissingDates, backfillWithRealPrices, getMissingDateRange, repairCorruptedSnapshots } from '../utils/historyUtils';
import { createLogger } from '../utils/logger';
import { saveLastKnownRates } from '../utils/exchangeRateCache';
import type { KnowledgeBase } from '../types/knowledge';
import { SEED_KNOWLEDGE_BASE } from '../constants/knowledgeBase';
import { mergeKnowledgeBase } from '../utils/mergeKnowledgeBase';
import type { ActionItem } from '../types/actionQueue';
import type { TurtlePosition, TurtleSettings } from '../types/turtle';
import { DEFAULT_TURTLE_SETTINGS } from '../types/turtle';
import { parsePortfolioPayload, type ParsedPortfolioPayload } from '../utils/parsePortfolioPayload';

const log = createLogger('PortfolioData');

// applyLoadedData가 상태에 반영한 "최종 해석값"들 — 복원 시 명시적 autosave에 그대로 넘겨
// 현재 상태 기본값이 아니라 복원된 전 도메인이 Drive에 저장되도록 한다.
interface AppliedResult {
  assets: Asset[];
  portfolioHistory: PortfolioSnapshot[];
  sellHistory: SellRecord[];
  watchlist: WatchlistItem[];
  exchangeRates: ExchangeRates;
  allocationTargets: AllocationTargets;
  sellAlertDropRate: number;
  categoryStore: CategoryStore;
  knowledgeBase: KnowledgeBase;
  actionQueue: ActionItem[];
  turtlePositions: TurtlePosition[];
  turtleSettings: TurtleSettings;
  lastUpdateDate: string | null;
}

export const usePortfolioData = () => {
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // 데이터 상태
  const [assets, setAssets] = useState<Asset[]>([]);
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioSnapshot[]>([]);
  const [sellHistory, setSellHistory] = useState<SellRecord[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRates>({ USD: 1450, JPY: 9.5 });
  const [allocationTargets, setAllocationTargets] = useState<AllocationTargets>({ weights: {} });
  const [sellAlertDropRate, setSellAlertDropRate] = useState<number>(15);
  const [categoryStore, setCategoryStore] = useState<CategoryStore>(DEFAULT_CATEGORY_STORE);
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBase>(SEED_KNOWLEDGE_BASE);
  // 90/10 실행 큐 + 터틀 (Phase 2b): actionQueue는 배열 그대로 영속(시드/머지 없음)
  const [actionQueue, setActionQueue] = useState<ActionItem[]>([]);
  const [turtlePositions, setTurtlePositions] = useState<TurtlePosition[]>([]);
  const [turtleSettings, setTurtleSettings] = useState<TurtleSettings>({ ...DEFAULT_TURTLE_SETTINGS });
  const [hasAutoUpdated, setHasAutoUpdated] = useState<boolean>(false);
  const [shouldAutoUpdate, setShouldAutoUpdate] = useState<boolean>(false);
  const [lastUpdateDate, setLastUpdateDate] = useState<string | null>(null);

  const { isSignedIn, googleUser, isInitializing, needsReAuth, handleSignIn, handleSignOut: hookSignOut, loadFromGoogleDrive: hookLoadFromGoogleDrive, autoSave: hookAutoSave } = useGoogleDriveSync({ onError: setError, onSuccessMessage: setSuccessMessage });

  // 로드된(파싱된) 전 도메인 데이터를 마이그레이션 후 상태에 반영하는 공용 파이프라인.
  // Drive 자동 로드와 백업 복원이 이 함수를 공유해 "일부 도메인만 반영되는" 유실(P2)을 없앤다.
  // 파이프라인 순서(repairCorruptedSnapshots → fillAllMissingDates → backfillWithRealPrices)는
  // 로드-순서 의존이므로 재배열 금지(.claude/rules/data-integrity.md).
  // 반환값 = 상태에 반영한 최종 해석값(복원 측 명시 autosave에 사용).
  const applyLoadedData = useCallback((
    loaded: ParsedPortfolioPayload,
    opts: { source: 'drive' | 'restore' }
  ): AppliedResult => {
    const data1 = runMigrationIfNeeded(loaded);
    const data = migrateCategorySystem(data1);
    const driveAssets = Array.isArray(data.assets) ? data.assets.map(mapToNewAssetStructure) : [];
    setAssets(driveAssets);

    // 지식 베이스: 앱 시드 ⊕ 저장본 병합 (정의는 시드, 승인/journal은 저장본 보존)
    const mergedKnowledgeBase = mergeKnowledgeBase(SEED_KNOWLEDGE_BASE, loaded.knowledgeBase);
    setKnowledgeBase(mergedKnowledgeBase);

    // 90/10 실행 큐/터틀 로드 (배열은 그대로, 설정은 기본값 폴백)
    const resolvedActionQueue = Array.isArray(loaded.actionQueue) ? loaded.actionQueue : [];
    const resolvedTurtlePositions = Array.isArray(loaded.turtlePositions) ? loaded.turtlePositions : [];
    // 신규 설정 필드가 추가돼도 오래된 저장본에서 누락되지 않도록 기본값과 merge
    const resolvedTurtleSettings = { ...DEFAULT_TURTLE_SETTINGS, ...loaded.turtleSettings };
    setActionQueue(resolvedActionQueue);
    setTurtlePositions(resolvedTurtlePositions);
    setTurtleSettings(resolvedTurtleSettings);

    const loadedCategoryStore: CategoryStore = data.categoryStore?.categories?.length
      ? data.categoryStore
      : DEFAULT_CATEGORY_STORE;

    let resolvedHistory: PortfolioSnapshot[] = [];
    if (Array.isArray(data.portfolioHistory)) {
      // 오염된 스냅샷 교정 후 보간
      const repairedHistory = repairCorruptedSnapshots(data.portfolioHistory);
      const filledHistory = fillAllMissingDates(repairedHistory);
      resolvedHistory = filledHistory;
      setPortfolioHistory(filledHistory);

      // 백필이 필요한지 확인
      const missingRange = getMissingDateRange(repairedHistory);
      if (missingRange && driveAssets.length > 0) {
        log.info(`${missingRange.missingDates.length}일 누락 감지, 실제 시세 조회 시작... (source: ${opts.source})`);

        // 비동기로 백필 수행 (교정된 데이터 기반)
        const rates = data.exchangeRates || { USD: 1450, JPY: 9.5 };
        backfillWithRealPrices(repairedHistory, driveAssets, rates)
          .then(backfilledHistory => {
            // P5a: 영속 전 최근 365개로 캡 (usePortfolioHistory의 365 캡은 effect 재실행 시에만
            // 적용돼, 백필 결과가 캡 없이 저장되면 과도한 길이가 남을 수 있음)
            const cappedHistory = backfilledHistory.slice(-365);
            // 백필+캡된 히스토리로 업데이트
            setPortfolioHistory(cappedHistory);

            // 자동 저장 트리거 (백필된 데이터 저장)
            if (isSignedIn) {
              const watchlistData = Array.isArray(data.watchlist) ? data.watchlist : [];
              const sellData = Array.isArray(data.sellHistory) ? data.sellHistory : [];
              const allocData = loaded.allocationTargets && 'weights' in loaded.allocationTargets
                ? loaded.allocationTargets
                : { weights: loaded.allocationTargets || {} };
              hookAutoSave(driveAssets, cappedHistory, sellData, watchlistData, rates, allocData as AllocationTargets, loaded.sellAlertDropRate ?? 15, loadedCategoryStore, mergedKnowledgeBase, resolvedActionQueue, resolvedTurtlePositions, resolvedTurtleSettings);
              log.info('백필 완료, 자동 저장됨');
            }
          })
          .catch(err => {
            log.error('백필 실패, 기존 보간 데이터 유지:', err);
          });
      }
    } else {
      setPortfolioHistory([]);
    }

    const resolvedSell = Array.isArray(data.sellHistory) ? data.sellHistory : [];
    setSellHistory(resolvedSell);

    const resolvedWatchlist = Array.isArray(data.watchlist) ? data.watchlist : [];
    setWatchlist(resolvedWatchlist);

    let resolvedRates: ExchangeRates;
    if (data.exchangeRates) {
      const rates = data.exchangeRates;
      if (!rates.USD || rates.USD < 100) rates.USD = 1450;
      if (!rates.JPY || rates.JPY < 1) rates.JPY = 9.5;
      resolvedRates = rates;
      setExchangeRates(rates);
      saveLastKnownRates(rates);
    } else {
      const defaults = { USD: 1450, JPY: 9.5 };
      resolvedRates = defaults;
      setExchangeRates(defaults);
      saveLastKnownRates(defaults);
    }

    let resolvedAlloc: AllocationTargets;
    if (loaded.allocationTargets) {
      // Migration check: If it doesn't have 'weights' property, it's the old format
      if ('weights' in loaded.allocationTargets) {
        resolvedAlloc = loaded.allocationTargets;
      } else {
        resolvedAlloc = { weights: loaded.allocationTargets as unknown as Record<string, number> };
      }
    } else {
      resolvedAlloc = { weights: {} };
    }
    setAllocationTargets(resolvedAlloc);

    const validDropRate = typeof loaded.sellAlertDropRate === 'number' && loaded.sellAlertDropRate >= 0;
    const resolvedDropRate = validDropRate ? (loaded.sellAlertDropRate as number) : 15;
    if (validDropRate) {
      setSellAlertDropRate(loaded.sellAlertDropRate as number);
    }

    // categoryStore 로드 (위에서 계산한 loadedCategoryStore 재사용)
    setCategoryStore(loadedCategoryStore);

    // 마지막 업데이트 날짜 반영 (복원 시에도 저장본 값으로 세팅)
    const savedLastUpdate = loaded.lastUpdateDate || null;
    setLastUpdateDate(savedLastUpdate);

    return {
      assets: driveAssets,
      portfolioHistory: resolvedHistory,
      sellHistory: resolvedSell,
      watchlist: resolvedWatchlist,
      exchangeRates: resolvedRates,
      allocationTargets: resolvedAlloc,
      sellAlertDropRate: resolvedDropRate,
      categoryStore: loadedCategoryStore,
      knowledgeBase: mergedKnowledgeBase,
      actionQueue: resolvedActionQueue,
      turtlePositions: resolvedTurtlePositions,
      turtleSettings: resolvedTurtleSettings,
      lastUpdateDate: savedLastUpdate,
    };
  }, [isSignedIn, hookAutoSave]);

  const loadFromGoogleDrive = useCallback(async () => {
    setSuccessMessage('자동으로 데이터를 불러오는 중...');
    try {
      const loaded = await hookLoadFromGoogleDrive();
      if (loaded) {
        const applied = applyLoadedData(loaded, { source: 'drive' });

        // 오늘 아직 업데이트 안 했고, 자산이 있으면 자동 업데이트 예약
        // localStorage도 확인하여 새로고침/Drive 저장 지연 시 중복 실행 방지
        const today = new Date().toISOString().slice(0, 10);
        const savedLastUpdate = applied.lastUpdateDate;
        const localLastUpdate = localStorage.getItem('lastAutoUpdateDate');
        if (savedLastUpdate !== today && localLastUpdate !== today && applied.assets.length > 0) {
          setShouldAutoUpdate(true);
        }

        setSuccessMessage('Google Drive에서 포트폴리오를 불러왔습니다.');
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        setAssets([]);
        setPortfolioHistory([]);
        setSellHistory([]);
        setWatchlist([]);
        setAllocationTargets({ weights: {} });
        setSuccessMessage('Google Drive에 저장된 포트폴리오가 없습니다. 자산을 추가해주세요.');
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (error: unknown) {
      log.error('Failed to load from Google Drive:', error);
      const message = error instanceof Error ? error.message : '';
      setError(`Google Drive에서 데이터를 불러오지 못했습니다.${message ? ` (${message})` : ''}`);
      setTimeout(() => setError(null), 3000);
    }
  }, [hookLoadFromGoogleDrive, applyLoadedData]);

  // 백업 복원 — 전 도메인을 공용 파이프라인으로 반영하고, 복원된 전 도메인을 명시적으로 1회 저장.
  // (기존 updateAllData 경로는 6개 도메인만 반영 → categoryStore/knowledgeBase/actionQueue/
  //  turtlePositions/turtleSettings/sellAlertDropRate가 현재 상태 기본값으로 재저장되는 유실 버그 P2)
  const restoreFromPayload = useCallback((content: string) => {
    const parsed = parsePortfolioPayload(content); // 잘못된 JSON이면 throw → 호출측 try-catch
    const applied = applyLoadedData(parsed, { source: 'restore' });

    // 테이블 레이아웃 복원 — UI 환경설정이므로 localStorage 경유 후 CustomEvent로 state 동기화.
    // (순수 파서에 둘 수 없는 부수효과라 여기서 useGoogleDriveSync.loadFromGoogleDrive와 동일하게 처리)
    if (parsed.tableLayout) {
      try {
        if (Array.isArray(parsed.tableLayout.columns)) {
          localStorage.setItem('asset-manager-column-config-v1', JSON.stringify(parsed.tableLayout.columns));
        }
        if (parsed.tableLayout.fixedWidths && typeof parsed.tableLayout.fixedWidths === 'object') {
          localStorage.setItem('asset-manager-fixed-column-widths-v1', JSON.stringify(parsed.tableLayout.fixedWidths));
        }
        window.dispatchEvent(new CustomEvent('table-layout-restored', { detail: parsed.tableLayout }));
      } catch { /* ignore */ }
    } else if (Array.isArray(parsed.columnConfig)) {
      try {
        localStorage.setItem('asset-manager-column-config-v1', JSON.stringify(parsed.columnConfig));
        window.dispatchEvent(new CustomEvent('column-config-restored', { detail: parsed.columnConfig }));
      } catch { /* ignore */ }
    }

    // 복원된 전 도메인을 명시적으로 1회 저장 (현재 상태 기본값 절대 사용 안 함).
    // 백필 블록이 뒤늦게 더 완전한 히스토리로 다시 저장할 수 있으나 동일 복원 데이터라 무해.
    if (isSignedIn) {
      hookAutoSave(
        applied.assets,
        applied.portfolioHistory,
        applied.sellHistory,
        applied.watchlist,
        applied.exchangeRates,
        applied.allocationTargets,
        applied.sellAlertDropRate,
        applied.categoryStore,
        applied.knowledgeBase,
        applied.actionQueue,
        applied.turtlePositions,
        applied.turtleSettings
      );
    }
  }, [applyLoadedData, isSignedIn, hookAutoSave]);

  // 초기 로드 Effect
  useEffect(() => {
    if (isInitializing) return;
    
    // isSignedIn이 true로 변경되었을 때만 로드하도록 의존성 관리
    // loadFromGoogleDrive를 의존성에서 제거하여 무한 루프 방지
    if (isSignedIn) {
      setHasAutoUpdated(false);
      loadFromGoogleDrive();
    } else {
      setAssets([]);
      setPortfolioHistory([]);
      setSellHistory([]);
      setWatchlist([]); // watchlist 초기화 추가
      setAllocationTargets({ weights: {} });
      setHasAutoUpdated(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitializing, isSignedIn]); // loadFromGoogleDrive 제거

  // 자동 저장 래퍼
  const triggerAutoSave = useCallback((
    newAssets: Asset[],
    newHistory: PortfolioSnapshot[],
    newSells: SellRecord[],
    newWatchlist: WatchlistItem[],
    newRates: ExchangeRates,
    newAllocationTargets?: AllocationTargets,
    newSellAlertDropRate?: number,
    newCategoryStore?: CategoryStore,
    newKnowledgeBase?: KnowledgeBase,
    newActionQueue?: ActionItem[],
    newTurtlePositions?: TurtlePosition[],
    newTurtleSettings?: TurtleSettings
  ) => {
    if (isSignedIn) {
      hookAutoSave(newAssets, newHistory, newSells, newWatchlist, newRates, newAllocationTargets || allocationTargets, newSellAlertDropRate ?? sellAlertDropRate, newCategoryStore || categoryStore, newKnowledgeBase || knowledgeBase, newActionQueue ?? actionQueue, newTurtlePositions ?? turtlePositions, newTurtleSettings ?? turtleSettings);
    }
  }, [isSignedIn, hookAutoSave, allocationTargets, sellAlertDropRate, categoryStore, knowledgeBase, actionQueue, turtlePositions, turtleSettings]);

  // 교차도메인 원자 커밋 — 지정 도메인만 set 하고 **단일 triggerAutoSave**(업데이터 밖·타이밍 의존 없음).
  // 터틀 실행이 assets+sellHistory+actionQueue+turtlePositions를 한 번에 저장해 stale sibling 경합 제거.
  const commitPortfolioPatch = useCallback((patch: {
    assets?: Asset[];
    sellHistory?: SellRecord[];
    actionQueue?: ActionItem[];
    turtlePositions?: TurtlePosition[];
    watchlist?: WatchlistItem[];
  }) => {
    const nextAssets = patch.assets ?? assets;
    const nextSell = patch.sellHistory ?? sellHistory;
    const nextQueue = patch.actionQueue ?? actionQueue;
    const nextPositions = patch.turtlePositions ?? turtlePositions;
    const nextWatchlist = patch.watchlist ?? watchlist;
    if (patch.assets) setAssets(patch.assets);
    if (patch.sellHistory) setSellHistory(patch.sellHistory);
    if (patch.actionQueue) setActionQueue(patch.actionQueue);
    if (patch.turtlePositions) setTurtlePositions(patch.turtlePositions);
    if (patch.watchlist) setWatchlist(patch.watchlist);
    triggerAutoSave(nextAssets, portfolioHistory, nextSell, nextWatchlist, exchangeRates, undefined, undefined, undefined, undefined, nextQueue, nextPositions, turtleSettings);
  }, [assets, sellHistory, actionQueue, turtlePositions, watchlist, portfolioHistory, exchangeRates, turtleSettings, triggerAutoSave]);

  const handleSignOut = useCallback(() => {
    hookSignOut();
    setAssets([]);
    setPortfolioHistory([]);
    setSellHistory([]);
    setWatchlist([]);
    setAllocationTargets({ weights: {} });
    setSellAlertDropRate(15);
    setCategoryStore(DEFAULT_CATEGORY_STORE);
    setKnowledgeBase(SEED_KNOWLEDGE_BASE);
    setActionQueue([]);
    setTurtlePositions([]);
    setTurtleSettings({ ...DEFAULT_TURTLE_SETTINGS });
    setHasAutoUpdated(false);
  }, [hookSignOut]);

  // 데이터 수동 갱신 (파일 업로드 등에서 사용)
  const updateAllData = useCallback((
    newAssets: Asset[],
    newHistory: PortfolioSnapshot[],
    newSells: SellRecord[],
    newWatchlist: WatchlistItem[],
    newRates?: ExchangeRates,
    newAllocationTargets?: AllocationTargets
  ) => {
    setAssets(newAssets);
    setPortfolioHistory(newHistory);
    setSellHistory(newSells);
    setWatchlist(newWatchlist);
    if (newRates) setExchangeRates(newRates);
    if (newAllocationTargets) setAllocationTargets(newAllocationTargets);
    
    // 상태 업데이트 후 자동 저장 트리거
    triggerAutoSave(newAssets, newHistory, newSells, newWatchlist, newRates || exchangeRates, newAllocationTargets || allocationTargets);
  }, [triggerAutoSave, exchangeRates, allocationTargets]);

  return {
    // 상태
    assets, setAssets,
    portfolioHistory, setPortfolioHistory,
    sellHistory, setSellHistory,
    watchlist, setWatchlist,
    exchangeRates, setExchangeRates,
    allocationTargets, setAllocationTargets,
    sellAlertDropRate, setSellAlertDropRate,
    categoryStore, setCategoryStore,
    knowledgeBase, setKnowledgeBase,
    actionQueue, setActionQueue,
    turtlePositions, setTurtlePositions,
    turtleSettings, setTurtleSettings,
    isSignedIn, googleUser,
    isInitializing, needsReAuth,
    isLoading: isInitializing, // Alias for legacy support
    error, setError,
    successMessage, setSuccessMessage,
    hasAutoUpdated, setHasAutoUpdated,
    shouldAutoUpdate, setShouldAutoUpdate,
    lastUpdateDate,

    // 액션
    handleSignIn,
    handleSignOut,
    loadFromGoogleDrive,
    triggerAutoSave,
    commitPortfolioPatch,
    updateAllData, // 전체 데이터 교체용
    restoreFromPayload, // 백업 복원 (전 도메인 공용 파이프라인)
    mapToNewAssetStructure // 외부에서 필요할 경우
  };
};
