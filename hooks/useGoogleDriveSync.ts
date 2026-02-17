import { useCallback, useEffect, useRef, useState } from 'react';
import { googleDriveService, GoogleUser } from '../services/googleDriveService';
import { Asset, PortfolioSnapshot, SellRecord, WatchlistItem, ExchangeRates, AllocationTargets } from '../types';

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
}

export function useGoogleDriveSync(options: UseGoogleDriveSyncOptions = {}) {
  const [isSignedIn, setIsSignedIn] = useState<boolean>(false);
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(null);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
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
          // 인증 상태 변경 콜백 등록 (401 재인증 실패 시 자동 로그아웃)
          googleDriveService.setAuthStateChangeCallback((signedIn) => {
            if (!signedIn) {
              setIsSignedIn(false);
              setGoogleUser(null);
              optionsRef.current.onError?.('세션이 만료되었습니다. 다시 로그인해주세요.');
            }
          });
          await googleDriveService.initialize(clientId);
          if (googleDriveService.isSignedIn()) {
            setIsSignedIn(true);
            setGoogleUser(googleDriveService.getCurrentUser());
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
    optionsRef.current.onSuccessMessage?.('Google Drive에서 포트폴리오를 불러왔습니다.');
    return { assets, portfolioHistory, sellHistory, watchlist, exchangeRates, allocationTargets, sellAlertDropRate };
  }, []);

  const autoSave = useCallback(async (assetsToSave: Asset[], history: PortfolioSnapshot[], sells: SellRecord[], watchlist: WatchlistItem[], exchangeRates?: ExchangeRates, allocationTargets?: AllocationTargets, sellAlertDropRate?: number) => {
    if (!isSignedIn) {
      optionsRef.current.onError?.('Google Drive 로그인 후 저장할 수 있습니다.');
      return;
    }
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
    }
    timeoutIdRef.current = setTimeout(async () => {
      if (isSavingRef.current) return;
      const exportData = {
        assets: assetsToSave,
        portfolioHistory: history,
        sellHistory: sells,
        watchlist,
        exchangeRates,
        allocationTargets,
        sellAlertDropRate,
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
      } catch (error) {
        optionsRef.current.onError?.('자동 저장에 실패했습니다.');
      } finally {
        isSavingRef.current = false;
      }
    }, 2000);
  }, [isSignedIn]);

  return {
    isSignedIn,
    googleUser,
    isInitializing,
    handleSignIn,
    handleSignOut,
    loadFromGoogleDrive,
    autoSave,
  };
}
