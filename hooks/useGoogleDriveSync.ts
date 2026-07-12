import { useCallback, useEffect, useRef, useState } from 'react';
import { googleDriveService, GoogleUser, DriveConflictError } from '../services/googleDriveService';
import { createSaveQueue, type SaveQueue, type SaveQueueState } from '../utils/saveQueue';
import { Asset, PortfolioSnapshot, SellRecord, WatchlistItem, ExchangeRates, AllocationTargets } from '../types';
import type { CategoryStore } from '../types/category';
import type { KnowledgeBase } from '../types/knowledge';
import type { ActionItem } from '../types/actionQueue';
import type { TurtlePosition, TurtleSettings } from '../types/turtle';

interface UseGoogleDriveSyncOptions {
  onError?: (msg: string) => void;
  onSuccessMessage?: (msg: string) => void;
}

interface LoadedData {
  assets: Asset[];
  portfolioHistory: PortfolioSnapshot[];
  sellHistory: SellRecord[];
  watchlist: WatchlistItem[];
  exchangeRates?: ExchangeRates;
  allocationTargets?: AllocationTargets;
  sellAlertDropRate?: number;
  categoryStore?: CategoryStore;
  knowledgeBase?: KnowledgeBase;
  actionQueue?: ActionItem[];
  turtlePositions?: TurtlePosition[];
  turtleSettings?: TurtleSettings;
}

export function useGoogleDriveSync(options: UseGoogleDriveSyncOptions = {}) {
  const [isSignedIn, setIsSignedIn] = useState<boolean>(false);
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(null);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [needsReAuth, setNeedsReAuth] = useState<boolean>(false);
  // 충돌(stale-write) 감지 후 재로딩 전까지 자동 저장을 차단하는 플래그.
  const conflictBlockedRef = useRef<boolean>(false);

  // options를 ref로 관리하여 의존성 제거
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  // 실제 저장 로직 — refs만 참조하므로 안정적(빈 deps). 큐가 이 함수를 호출한다.
  // 성공/'저장 중' 메시지는 onStateChange에서, 실패/충돌 메시지는 여기서 처리한다.
  const runSave = useCallback(async (payload: string): Promise<void> => {
    try {
      await googleDriveService.saveFile(payload);
    } catch (error) {
      if (error instanceof DriveConflictError) {
        // 최초 감지 시에만 메시지 노출 + 이후 자동 저장 차단 (재로딩 전까지).
        if (!conflictBlockedRef.current) {
          conflictBlockedRef.current = true;
          optionsRef.current.onError?.('다른 기기/탭에서 변경이 감지되어 자동 저장을 중단했습니다. 새로고침하여 최신 데이터를 불러온 뒤 다시 시도해주세요.');
        }
      } else {
        optionsRef.current.onError?.('자동 저장에 실패했습니다.');
        setTimeout(() => optionsRef.current.onError?.(null as unknown as string), 3000);
      }
      // 큐가 lastSaved를 갱신하지 않도록 반드시 재던지기(실패로 표시).
      throw error;
    }
  }, []);

  // 큐 상태 → UI 메시지 매핑 ('error'는 runSave에서 처리하므로 여기선 무시)
  const handleQueueState = useCallback((state: SaveQueueState): void => {
    if (state === 'saving') {
      optionsRef.current.onSuccessMessage?.('저장 중...');
    } else if (state === 'saved') {
      optionsRef.current.onSuccessMessage?.('Google Drive에 자동 저장되었습니다.');
      setTimeout(() => optionsRef.current.onSuccessMessage?.(null as unknown as string), 3000);
    }
  }, []);

  // 렌더 간 안정적인 큐 인스턴스 (ref 지연 초기화). save 함수는 안정적인 runSave를 직접 전달.
  const saveQueueRef = useRef<SaveQueue | null>(null);
  if (saveQueueRef.current === null) {
    saveQueueRef.current = createSaveQueue({
      debounceMs: 2000,
      save: runSave,
      onStateChange: handleQueueState,
    });
  }

  // 언마운트 시 디바운스 타이머 정리
  useEffect(() => {
    return () => {
      saveQueueRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
        if (clientId) {
          // 인증 상태 변경 콜백 등록 (401 재인증 실패 시 데이터 유지 + 재로그인 배너)
          googleDriveService.setAuthStateChangeCallback((signedIn) => {
            if (!signedIn) {
              setNeedsReAuth(true);
              // isSignedIn은 유지 → 데이터와 UI를 보존
              optionsRef.current.onError?.('세션이 만료되었습니다. 다시 로그인해주세요.');
            }
          });
          await googleDriveService.initialize(clientId);
          if (googleDriveService.isSignedIn()) {
            setIsSignedIn(true);
            setGoogleUser(googleDriveService.getCurrentUser());
          } else if (googleDriveService.getCurrentUser()) {
            // 토큰 갱신 실패로 access token은 없지만 JWT/user는 보존됨.
            // 데이터 UI를 유지하면서 "세션 만료" 배너로 재로그인 유도.
            // (페이지 reload 후 백엔드 일시 장애 등으로 로그아웃 화면이 뜨는 문제 방지)
            setIsSignedIn(true);
            setGoogleUser(googleDriveService.getCurrentUser());
            setNeedsReAuth(true);
          }
        }
      } catch (e) {
      } finally {
        setIsInitializing(false);
      }
    };
    init();
  }, []);

  const handleSignIn = useCallback(async (): Promise<GoogleUser> => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      optionsRef.current.onError?.('Google Client ID가 설정되지 않았습니다. .env 파일에 VITE_GOOGLE_CLIENT_ID를 추가해주세요.');
      throw new Error('Missing Google Client ID');
    }
    await googleDriveService.initialize(clientId);
    const user = await googleDriveService.signIn();
    setIsSignedIn(true);
    setGoogleUser(user);
    setNeedsReAuth(false);
    optionsRef.current.onSuccessMessage?.(`${user.email} 계정으로 로그인되었습니다.`);
    return user;
  }, []);

  const handleSignOut = useCallback(() => {
    googleDriveService.signOut();
    setIsSignedIn(false);
    setGoogleUser(null);
    optionsRef.current.onSuccessMessage?.('로그아웃되었습니다. Google Drive 로그인 후 다시 이용해주세요.');
  }, []);

  const loadFromGoogleDrive = useCallback(async (): Promise<LoadedData | null> => {
    const fileContent = await googleDriveService.loadFile();
    // 최신 데이터를 다시 불러왔으므로(서비스가 knownModifiedTime을 재동기화) 충돌 차단 해제.
    conflictBlockedRef.current = false;
    if (!fileContent) {
      optionsRef.current.onSuccessMessage?.('Google Drive에 저장된 포트폴리오가 없습니다. 자산을 추가해주세요.');
      return {
        assets: [],
        portfolioHistory: [],
        sellHistory: [],
        watchlist: [],
      };
    }
    const data = JSON.parse(fileContent);
    const assets = Array.isArray(data.assets) ? data.assets as Asset[] : [];
    const portfolioHistory = Array.isArray(data.portfolioHistory) ? data.portfolioHistory as PortfolioSnapshot[] : [];
    const sellHistory = Array.isArray(data.sellHistory) ? data.sellHistory as SellRecord[] : [];
    const watchlist = Array.isArray(data.watchlist) ? data.watchlist as WatchlistItem[] : [];
    const exchangeRates = data.exchangeRates as ExchangeRates | undefined;
    const allocationTargets = data.allocationTargets as AllocationTargets | undefined;
    const sellAlertDropRate = typeof data.sellAlertDropRate === 'number' ? data.sellAlertDropRate : undefined;
    const categoryStore = data.categoryStore as CategoryStore | undefined;
    const knowledgeBase = data.knowledgeBase as KnowledgeBase | undefined;
    const actionQueue = Array.isArray(data.actionQueue) ? data.actionQueue as ActionItem[] : undefined;
    const turtlePositions = Array.isArray(data.turtlePositions) ? data.turtlePositions as TurtlePosition[] : undefined;
    const turtleSettings = data.turtleSettings as TurtleSettings | undefined;

    // 테이블 레이아웃 복원 — UI 환경설정이므로 localStorage 경유
    // PortfolioContext에서 'table-layout-restored' / 'column-config-restored' 이벤트로 state 동기화
    // 신규 백업: tableLayout = { columns, fixedWidths }
    // 레거시 백업: columnConfig = ColumnConfig[]
    if (data.tableLayout && typeof data.tableLayout === 'object') {
      try {
        if (Array.isArray(data.tableLayout.columns)) {
          localStorage.setItem('asset-manager-column-config-v1', JSON.stringify(data.tableLayout.columns));
        }
        if (data.tableLayout.fixedWidths && typeof data.tableLayout.fixedWidths === 'object') {
          localStorage.setItem('asset-manager-fixed-column-widths-v1', JSON.stringify(data.tableLayout.fixedWidths));
        }
        window.dispatchEvent(new CustomEvent('table-layout-restored', { detail: data.tableLayout }));
      } catch { /* ignore */ }
    } else if (Array.isArray(data.columnConfig)) {
      try {
        localStorage.setItem('asset-manager-column-config-v1', JSON.stringify(data.columnConfig));
        window.dispatchEvent(new CustomEvent('column-config-restored', { detail: data.columnConfig }));
      } catch { /* ignore */ }
    }

    optionsRef.current.onSuccessMessage?.('Google Drive에서 포트폴리오를 불러왔습니다.');
    return { assets, portfolioHistory, sellHistory, watchlist, exchangeRates, allocationTargets, sellAlertDropRate, categoryStore, knowledgeBase, actionQueue, turtlePositions, turtleSettings };
  }, []);

  const autoSave = useCallback(async (assetsToSave: Asset[], history: PortfolioSnapshot[], sells: SellRecord[], watchlist: WatchlistItem[], exchangeRates?: ExchangeRates, allocationTargets?: AllocationTargets, sellAlertDropRate?: number, categoryStore?: CategoryStore, knowledgeBase?: KnowledgeBase, actionQueue?: ActionItem[], turtlePositions?: TurtlePosition[], turtleSettings?: TurtleSettings) => {
    if (!isSignedIn || needsReAuth) {
      if (!isSignedIn) optionsRef.current.onError?.('Google Drive 로그인 후 저장할 수 있습니다.');
      return;
    }
    // 충돌 감지 후에는 재로딩(loadFromGoogleDrive) 전까지 저장을 차단한다.
    if (conflictBlockedRef.current) {
      return;
    }

    // 테이블 레이아웃 — UI 환경설정이므로 localStorage에서 읽어 페이로드에 포함
    // 신규 필드 tableLayout = { columns, fixedWidths }
    // 레거시 필드 columnConfig는 한 릴리스 동안 함께 저장 (구 버전 클라이언트 읽기 호환)
    let columnConfig: unknown = undefined;
    let fixedWidths: unknown = undefined;
    try {
      const raw = localStorage.getItem('asset-manager-column-config-v1');
      if (raw) columnConfig = JSON.parse(raw);
    } catch { /* ignore */ }
    try {
      const raw = localStorage.getItem('asset-manager-fixed-column-widths-v1');
      if (raw) fixedWidths = JSON.parse(raw);
    } catch { /* ignore */ }
    const tableLayout = { columns: columnConfig, fixedWidths };

    const exportData = {
      assets: assetsToSave,
      portfolioHistory: history,
      sellHistory: sells,
      watchlist,
      exchangeRates,
      allocationTargets,
      sellAlertDropRate,
      categoryStore,
      knowledgeBase,
      actionQueue,
      turtlePositions,
      turtleSettings,
      columnConfig,
      tableLayout,
      lastUpdateDate: new Date().toISOString().slice(0, 10),
    };
    // P7: 미니파이(pretty-print 제거). 디바운스·코얼레싱·중복 스킵·pending 재저장은 큐가 처리.
    const portfolioJSON = JSON.stringify(exportData);
    saveQueueRef.current?.request(portfolioJSON);
  }, [isSignedIn, needsReAuth]);

  return {
    isSignedIn,
    googleUser,
    isInitializing,
    needsReAuth,
    handleSignIn,
    handleSignOut,
    loadFromGoogleDrive,
    autoSave,
  };
}
