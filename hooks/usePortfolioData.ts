import { useState, useEffect, useCallback, useMemo } from 'react';
import { Asset, PortfolioSnapshot, SellRecord, WatchlistItem, ExchangeRates, AllocationTargets } from '../types';
import { useGoogleDriveSync } from './useGoogleDriveSync';
import { runMigrationIfNeeded } from '../utils/migrateData';
import { mapToNewAssetStructure } from '../utils/portfolioCalculations';

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
  const [hasAutoUpdated, setHasAutoUpdated] = useState<boolean>(false);

  const { isSignedIn, googleUser, isInitializing, handleSignIn, handleSignOut: hookSignOut, loadFromGoogleDrive: hookLoadFromGoogleDrive, autoSave: hookAutoSave } = useGoogleDriveSync({ onError: setError, onSuccessMessage: setSuccessMessage });

  const loadFromGoogleDrive = useCallback(async () => {
    try {
      const loaded = await hookLoadFromGoogleDrive();
      if (loaded) {
        const data = runMigrationIfNeeded(loaded);
        const driveAssets = Array.isArray(data.assets) ? data.assets.map(mapToNewAssetStructure) : [];
        setAssets(driveAssets);
        
        if (Array.isArray(data.portfolioHistory)) setPortfolioHistory(data.portfolioHistory);
        else setPortfolioHistory([]);
        
        if (Array.isArray(data.sellHistory)) setSellHistory(data.sellHistory);
        else setSellHistory([]);
        
        if (Array.isArray(data.watchlist)) setWatchlist(data.watchlist);
        else setWatchlist([]);
        
        if (data.exchangeRates) {
          const rates = data.exchangeRates;
          if (!rates.USD || rates.USD < 100) rates.USD = 1450;
          if (!rates.JPY || rates.JPY < 1) rates.JPY = 9.5;
          setExchangeRates(rates);
        } else {
           setExchangeRates({ USD: 1450, JPY: 9.5 });
        }

        if (loaded.allocationTargets) {
          // Migration check: If it doesn't have 'weights' property, it's the old format
          if ('weights' in loaded.allocationTargets) {
            setAllocationTargets(loaded.allocationTargets);
          } else {
            setAllocationTargets({
              weights: loaded.allocationTargets as unknown as Record<string, number>
            });
          }
        } else {
          setAllocationTargets({ weights: {} });
        }

        if (typeof loaded.sellAlertDropRate === 'number' && loaded.sellAlertDropRate >= 0) {
          setSellAlertDropRate(loaded.sellAlertDropRate);
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
      console.error('Failed to load from Google Drive:', error);
      const message = error instanceof Error ? error.message : '';
      setError(`Google Drive에서 데이터를 불러오지 못했습니다.${message ? ` (${message})` : ''}`);
      setTimeout(() => setError(null), 3000);
    }
  }, [hookLoadFromGoogleDrive]);

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
    newSellAlertDropRate?: number
  ) => {
    if (isSignedIn) {
      hookAutoSave(newAssets, newHistory, newSells, newWatchlist, newRates, newAllocationTargets || allocationTargets, newSellAlertDropRate ?? sellAlertDropRate);
    }
  }, [isSignedIn, hookAutoSave, allocationTargets, sellAlertDropRate]);

  const handleSignOut = useCallback(() => {
    hookSignOut();
    setAssets([]);
    setPortfolioHistory([]);
    setSellHistory([]);
    setWatchlist([]);
    setAllocationTargets({ weights: {} });
    setSellAlertDropRate(15);
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
    isSignedIn, googleUser,
    isInitializing,
    isLoading: isInitializing, // Alias for legacy support
    error, setError,
    successMessage, setSuccessMessage,
    hasAutoUpdated, setHasAutoUpdated,
    
    // 액션
    handleSignIn,
    handleSignOut,
    loadFromGoogleDrive,
    triggerAutoSave,
    updateAllData, // 전체 데이터 교체용
    mapToNewAssetStructure // 외부에서 필요할 경우
  };
};
