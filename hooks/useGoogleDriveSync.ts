import { useCallback, useEffect, useRef, useState } from 'react';
import { googleDriveService, GoogleUser } from '../services/googleDriveService';
import { Asset, PortfolioSnapshot, SellRecord, WatchlistItem, ExchangeRates, AllocationTargets } from '../types';
import type { CategoryStore } from '../types/category';
import type { KnowledgeBase } from '../types/knowledge';

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
}

export function useGoogleDriveSync(options: UseGoogleDriveSyncOptions = {}) {
  const [isSignedIn, setIsSignedIn] = useState<boolean>(false);
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(null);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [needsReAuth, setNeedsReAuth] = useState<boolean>(false);
  const timeoutIdRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef<boolean>(false);
  const lastSavedDataRef = useRef<string | null>(null);
  
  // options를 ref로 관리하여 의존성 제거
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

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
    return { assets, portfolioHistory, sellHistory, watchlist, exchangeRates, allocationTargets, sellAlertDropRate, categoryStore, knowledgeBase };
  }, []);

  const autoSave = useCallback(async (assetsToSave: Asset[], history: PortfolioSnapshot[], sells: SellRecord[], watchlist: WatchlistItem[], exchangeRates?: ExchangeRates, allocationTargets?: AllocationTargets, sellAlertDropRate?: number, categoryStore?: CategoryStore, knowledgeBase?: KnowledgeBase) => {
    if (!isSignedIn || needsReAuth) {
      if (!isSignedIn) optionsRef.current.onError?.('Google Drive 로그인 후 저장할 수 있습니다.');
      return;
    }
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
    }
    timeoutIdRef.current = setTimeout(async () => {
      if (isSavingRef.current) return;
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
        columnConfig,
        tableLayout,
        lastUpdateDate: new Date().toISOString().slice(0, 10),
      };
      const portfolioJSON = JSON.stringify(exportData, null, 2);
      if (lastSavedDataRef.current === portfolioJSON) {
        return;
      }
      isSavingRef.current = true;
      try {
        optionsRef.current.onSuccessMessage?.('저장 중...');
        await googleDriveService.saveFile(portfolioJSON);
        lastSavedDataRef.current = portfolioJSON;
        optionsRef.current.onSuccessMessage?.('Google Drive에 자동 저장되었습니다.');
        setTimeout(() => optionsRef.current.onSuccessMessage?.(null as unknown as string), 3000);
      } catch (error) {
        optionsRef.current.onError?.('자동 저장에 실패했습니다.');
        setTimeout(() => optionsRef.current.onError?.(null as unknown as string), 3000);
      } finally {
        isSavingRef.current = false;
      }
    }, 2000);
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
