import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { applyRestoredAlertSettings } from '../utils/alertSettingsStorage';
import { mergeSaveSnapshot, type PortfolioSaveSnapshot, type PortfolioSavePatch } from '../types/portfolioSave';

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

  // ── 저장 경로 (5-A) ────────────────────────────────────────────────────────
  // 최신 스냅샷의 **단일 소스**. 렌더 클로저 대신 이 ref 에서 형제 도메인을 읽는다.
  //
  // 왜 필요한가: Drive 저장은 항상 전체 스냅샷이고, saveQueue 는 last-write-wins 다
  // (`utils/saveQueue.ts` 의 pending). 같은 틱에 저장이 두 번 나면 **뒤 호출의 payload 가
  // 앞 것을 통째로 덮는다.** 예전 구현은 형제 도메인을 렌더 클로저에서 읽었으므로
  //   commit({assets:A2}) → commit({actionQueue:Q2})
  // 순서일 때 두 번째가 A1(옛 값)으로 스냅샷을 만들어 **A2 가 유실**될 수 있었다.
  // commitPortfolio/saveNow 가 이 ref 를 동기 갱신하므로 두 번째 호출은 A2 를 본다.
  //
  // ⚠️ 선언 위치를 옮기지 말 것: 아래 useCallback(applyLoadedData·restoreFromPayload 등)이
  //    이 ref 를 캡처하므로, 선언이 그보다 뒤로 가면 React Compiler 가 "hook 인자로 넘어간 값을
  //    수정" 위반으로 판정한다(react-hooks/immutability).
  const snapshotRef = useRef<PortfolioSaveSnapshot>({
    assets, portfolioHistory, sellHistory, watchlist, exchangeRates,
    allocationTargets, sellAlertDropRate, categoryStore, knowledgeBase,
    actionQueue, turtlePositions, turtleSettings,
  });

  // 상태가 바뀌면 ref 를 맞춘다 — commitPortfolio 를 거치지 않는 직접 setter 사용분 반영.
  // (렌더 중 ref 쓰기는 금지이므로 effect 에서 동기화한다)
  useEffect(() => {
    snapshotRef.current = {
      assets, portfolioHistory, sellHistory, watchlist, exchangeRates,
      allocationTargets, sellAlertDropRate, categoryStore, knowledgeBase,
      actionQueue, turtlePositions, turtleSettings,
    };
  }, [assets, portfolioHistory, sellHistory, watchlist, exchangeRates,
      allocationTargets, sellAlertDropRate, categoryStore, knowledgeBase,
      actionQueue, turtlePositions, turtleSettings]);

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
              hookAutoSave({
                assets: driveAssets,
                portfolioHistory: cappedHistory,
                sellHistory: sellData,
                watchlist: watchlistData,
                exchangeRates: rates,
                allocationTargets: allocData as AllocationTargets,
                sellAlertDropRate: loaded.sellAlertDropRate ?? 15,
                categoryStore: loadedCategoryStore,
                knowledgeBase: mergedKnowledgeBase,
                actionQueue: resolvedActionQueue,
                turtlePositions: resolvedTurtlePositions,
                turtleSettings: resolvedTurtleSettings,
              });
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

    // 알림 규칙 설정 복원 — Drive 로드와 동일 경로(localStorage 반영 + 이벤트).
    // 아래 명시 autoSave가 localStorage를 다시 읽으므로 **저장보다 먼저** 반영해야 한다.
    applyRestoredAlertSettings(parsed.alertSettings);

    // 복원된 전 도메인을 명시적으로 1회 저장 (현재 상태 기본값 절대 사용 안 함).
    // 백필 블록이 뒤늦게 더 완전한 히스토리로 다시 저장할 수 있으나 동일 복원 데이터라 무해.
    // AppliedResult 는 PortfolioSaveSnapshot 의 12개 도메인을 모두 포함하므로 그대로 넘긴다
    // (lastUpdateDate 는 저장 측이 자체 생성). 스냅샷 ref 도 복원값으로 맞춰 이후 저장이
    // 복원 직전의 옛 상태를 되살리지 않게 한다.
    if (isSignedIn) {
      snapshotRef.current = mergeSaveSnapshot(snapshotRef.current, applied);
      hookAutoSave(snapshotRef.current);
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

  /**
   * **앱의 단일 저장 진입점.** 바뀐 도메인만 patch 로 넘기면
   *   ① 해당 state setter 호출 ② ref 동기 갱신 ③ 완전한 스냅샷으로 Drive 저장
   * 을 한 번에 처리한다. 생략한 도메인은 **그 시점 최신 스냅샷**으로 채워진다.
   *
   * `save: false` 를 주면 상태·ref 만 갱신하고 저장은 하지 않는다(로드 직후 반영 등).
   */
  const commitPortfolio = useCallback((
    patch: PortfolioSavePatch,
    opts: { save?: boolean } = {},
  ) => {
    const next = mergeSaveSnapshot(snapshotRef.current, patch);
    snapshotRef.current = next; // ← 동기 갱신. 같은 틱의 다음 호출이 이 값을 본다.

    // 넘어온 도메인만 setState (`!== undefined` — 0·빈 배열도 유효한 값이다)
    if (patch.assets !== undefined) setAssets(patch.assets);
    if (patch.portfolioHistory !== undefined) setPortfolioHistory(patch.portfolioHistory);
    if (patch.sellHistory !== undefined) setSellHistory(patch.sellHistory);
    if (patch.watchlist !== undefined) setWatchlist(patch.watchlist);
    if (patch.exchangeRates !== undefined) setExchangeRates(patch.exchangeRates);
    if (patch.allocationTargets !== undefined) setAllocationTargets(patch.allocationTargets);
    if (patch.sellAlertDropRate !== undefined) setSellAlertDropRate(patch.sellAlertDropRate);
    if (patch.categoryStore !== undefined) setCategoryStore(patch.categoryStore);
    if (patch.knowledgeBase !== undefined) setKnowledgeBase(patch.knowledgeBase);
    if (patch.actionQueue !== undefined) setActionQueue(patch.actionQueue);
    if (patch.turtlePositions !== undefined) setTurtlePositions(patch.turtlePositions);
    if (patch.turtleSettings !== undefined) setTurtleSettings(patch.turtleSettings);

    if (opts.save !== false && isSignedIn) hookAutoSave(next);
  }, [isSignedIn, hookAutoSave]);

  /**
   * 상태 변경 없이 **저장만** 한다(이미 setState 를 마친 경로·내보내기 등).
   * 형제 도메인은 최신 스냅샷에서 채워지므로 위치 인자 시절의 stale 위험이 없다.
   */
  const saveNow = useCallback((patch: PortfolioSavePatch = {}) => {
    const next = mergeSaveSnapshot(snapshotRef.current, patch);
    snapshotRef.current = next;
    if (isSignedIn) hookAutoSave(next);
  }, [isSignedIn, hookAutoSave]);

  /**
   * 최신 스냅샷 읽기 — **`setState` 업데이터(`prev => ...`) 안에서 저장하지 않기 위한 창구.**
   *
   * 업데이터는 순수해야 한다. 그 안에서 저장을 호출하면 React 가 렌더를 버리거나(concurrent)
   * StrictMode 가 이중 호출할 때 **실제 상태가 되지 못한 값이 저장되거나 ref 에 남을 수 있다.**
   * `prev` 를 쓰려던 이유(최신값 확보)는 여기서 읽으면 그대로 충족된다 —
   * snapshotRef 는 커밋마다 동기 갱신되고 렌더마다 상태와 동기화되기 때문이다.
   */
  const getSnapshot = useCallback((): PortfolioSaveSnapshot => snapshotRef.current, []);

  // 하위호환 별칭 — 기존 호출부 이름 유지(내용은 위 단일 경로).
  const commitPortfolioPatch = commitPortfolio;

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
    // 단일 커밋 — setState + 저장을 한 경로로. 미지정 도메인은 최신 스냅샷 유지.
    commitPortfolio({
      assets: newAssets,
      portfolioHistory: newHistory,
      sellHistory: newSells,
      watchlist: newWatchlist,
      ...(newRates ? { exchangeRates: newRates } : {}),
      ...(newAllocationTargets ? { allocationTargets: newAllocationTargets } : {}),
    });
  }, [commitPortfolio]);

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
    commitPortfolio, // 단일 저장 진입점 (상태 변경 + 저장)
    saveNow,         // 저장만 (상태는 이미 반영된 경로)
    getSnapshot,     // 최신 스냅샷 읽기 (setState 업데이터 밖에서 계산하기 위함)
    commitPortfolioPatch, // commitPortfolio 별칭(기존 호출부 호환)
    updateAllData, // 전체 데이터 교체용
    restoreFromPayload, // 백업 복원 (전 도메인 공용 파이프라인)
    mapToNewAssetStructure // 외부에서 필요할 경우
  };
};
