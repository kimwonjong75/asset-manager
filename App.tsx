

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Asset, NewAssetForm, AssetCategory, EXCHANGE_MAP, Currency, PortfolioSnapshot, AssetSnapshot, BulkUploadResult } from './types';
import { fetchAssetData, fetchHistoricalExchangeRate, fetchCurrentExchangeRate } from './services/geminiService';
import { googleDriveService, GoogleUser } from './services/googleDriveService';
import PortfolioTable from './components/PortfolioTable';
import AllocationChart from './components/AllocationChart';
import Header from './components/Header';
import StatCard from './components/StatCard';
import { initialAssets } from './initialData';
import EditAssetModal from './components/EditAssetModal';
import BulkUploadModal from './components/BulkUploadModal';
import SellAlertControl from './components/SellAlertControl';
import CategorySummaryTable from './components/CategorySummaryTable';
import ProfitLossChart from './components/ProfitLossChart';
import AddNewAssetModal from './components/AddNewAssetModal';
import TopBottomAssets from './components/TopBottomAssets';
import PortfolioAssistant from './components/PortfolioAssistant';
import DataConflictModal from './components/DataConflictModal';

const LOCAL_STORAGE_KEY = 'quant-portfolio';
const HISTORY_STORAGE_KEY = 'quant-portfolio-history';
const LAST_UPDATE_KEY = 'quant-portfolio-last-update';
const FIRST_LOAD_TODAY_KEY = 'quant-portfolio-first-load-today';

type ActiveTab = 'dashboard' | 'portfolio';

// Helper function to map old data structures to the new one
const mapToNewAssetStructure = (asset: any): Asset => {
  let newAsset = { ...asset };

  // 1. Add missing properties from older versions
  if (!newAsset.exchange) newAsset.exchange = EXCHANGE_MAP[newAsset.category]?.[0] || '';
  if (!newAsset.currency) {
      newAsset.currency = Currency.KRW;
      newAsset.priceOriginal = newAsset.currentPrice;
  }
  if (!newAsset.purchaseExchangeRate) {
      newAsset.purchaseExchangeRate = newAsset.currency === Currency.KRW ? 1 : undefined;
  }

  // 2. Remap categories and remove region
  const oldCategory = newAsset.category;
  // FIX: Removed non-existent enum member `AssetCategory.STOCK` to resolve a compile error.
  // The migration logic now relies on string literals to identify legacy stock assets.
  if (['주식', 'ETF'].includes(oldCategory)) {
      if (newAsset.region === '국내' || newAsset.exchange.startsWith('KRX')) {
          newAsset.category = AssetCategory.KOREAN_STOCK;
      } else if (['NASDAQ', 'NYSE', 'AMEX'].includes(newAsset.exchange)) {
          newAsset.category = AssetCategory.US_STOCK;
      } else {
          newAsset.category = AssetCategory.OTHER_FOREIGN_STOCK;
      }
  // FIX: Removed non-existent enum member `AssetCategory.KRX_GOLD` to resolve a compile error.
  // The migration logic for gold assets is preserved using existing string literals and the valid `AssetCategory.GOLD` enum member.
  } else if (['KRX금현물', '금', AssetCategory.GOLD].includes(oldCategory)) {
      newAsset.category = AssetCategory.GOLD;
  } else {
      // Handle legacy enum names
      const categoryMap: { [key: string]: AssetCategory } = {
          "국내주식": AssetCategory.KOREAN_STOCK,
          "해외주식": AssetCategory.US_STOCK, // Simplified assumption
          "국내국채": AssetCategory.BOND,
          "해외국채": AssetCategory.BOND,
      };
      if (categoryMap[oldCategory]) {
          newAsset.category = categoryMap[oldCategory];
      }
  }
  
  // Ensure category exists in the enum
  if (!Object.values(AssetCategory).includes(newAsset.category)) {
      // Fallback for unknown categories
      newAsset.category = AssetCategory.OTHER_FOREIGN_STOCK;
  }

  delete newAsset.region;

  return newAsset as Asset;
};


const App: React.FC = () => {
  const [isSignedIn, setIsSignedIn] = useState<boolean>(false);
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(null);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);

  // Google Drive 초기화
  useEffect(() => {
    const initGoogleDrive = async () => {
      try {
        const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
        if (clientId) {
          await googleDriveService.initialize(clientId);
          if (googleDriveService.isSignedIn()) {
            setIsSignedIn(true);
            setGoogleUser(googleDriveService.getCurrentUser());
            // Google Drive에서 데이터 로드 시도
            await loadFromGoogleDrive();
          }
        }
      } catch (error) {
        console.error('Failed to initialize Google Drive:', error);
      } finally {
        setIsInitializing(false);
      }
    };
    initGoogleDrive();
  }, []);

  // localStorage에서 데이터 로드 (실제 저장 여부 확인)
  const loadFromLocalStorage = useCallback(() => {
    try {
      const savedData = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (savedData) {
        let loadedAssets: any[] = JSON.parse(savedData);
        if (!Array.isArray(loadedAssets)) {
          console.warn("localStorage data is not an array, falling back to initial data.");
          return { assets: initialAssets, hasData: false };
        }
        const mappedAssets = loadedAssets.map(mapToNewAssetStructure);
        // localStorage에 저장된 데이터가 있고, 배열이 비어있지 않으면 실제 데이터로 간주
        const hasData = loadedAssets.length > 0;
        return { 
          assets: mappedAssets, 
          hasData
        };
      }
    } catch (error) {
      console.error("Failed to load or parse portfolio from localStorage. Falling back to initial data.", error);
    }
    return { assets: initialAssets, hasData: false };
  }, []);

  // 충돌 감지 함수
  const detectConflicts = useCallback((localAssets: Asset[], driveAssets: Asset[]) => {
    const conflicts: Array<{
      ticker: string;
      exchange: string;
      name: string;
      localAsset: Asset;
      driveAsset: Asset;
    }> = [];

    // 로컬 자산을 맵으로 변환 (ticker + exchange를 키로)
    const localAssetMap = new Map<string, Asset>();
    localAssets.forEach(asset => {
      const key = `${asset.ticker.toUpperCase()}_${asset.exchange}`;
      localAssetMap.set(key, asset);
    });

    // Google Drive 자산과 비교
    driveAssets.forEach(driveAsset => {
      const key = `${driveAsset.ticker.toUpperCase()}_${driveAsset.exchange}`;
      const localAsset = localAssetMap.get(key);
      
      if (localAsset) {
        // 같은 종목이지만 정보가 다른 경우 충돌로 간주
        const isDifferent = 
          localAsset.quantity !== driveAsset.quantity ||
          localAsset.purchasePrice !== driveAsset.purchasePrice ||
          localAsset.purchaseDate !== driveAsset.purchaseDate ||
          localAsset.currentPrice !== driveAsset.currentPrice;

        if (isDifferent) {
          conflicts.push({
            ticker: driveAsset.ticker,
            exchange: driveAsset.exchange,
            name: driveAsset.name,
            localAsset,
            driveAsset,
          });
        }
      }
    });

    return conflicts;
  }, []);

  // Google Drive에서 데이터 로드
  const loadFromGoogleDrive = useCallback(async () => {
    try {
      const fileContent = await googleDriveService.loadFile();
      if (fileContent) {
        const data = JSON.parse(fileContent);
        if (data.assets && Array.isArray(data.assets)) {
          const driveAssets = data.assets.map(mapToNewAssetStructure);
          const { assets: localAssets, hasData: hasLocalData } = loadFromLocalStorage();
          
          // 로컬에 실제 데이터가 있고 서버에도 데이터가 있으면 선택 모달 표시
          if (hasLocalData && driveAssets.length > 0) {
            // 충돌 감지
            const detectedConflicts = detectConflicts(localAssets, driveAssets);
            
            // 충돌이 있거나, 양쪽에 데이터가 있으면 모달 표시
            setConflicts(detectedConflicts);
            setPendingDriveAssets(driveAssets);
            if (data.portfolioHistory && Array.isArray(data.portfolioHistory)) {
              setPendingDriveHistory(data.portfolioHistory);
            } else {
              setPendingDriveHistory([]);
            }
            setConflictModalOpen(true);
            return; // 모달이 표시되면 여기서 종료
          }
          
          // 로컬에 데이터가 없거나 충돌이 없으면 바로 적용
          setAssets(driveAssets);
          if (data.portfolioHistory && Array.isArray(data.portfolioHistory)) {
            setPortfolioHistory(data.portfolioHistory);
          }
          setSuccessMessage('Google Drive에서 포트폴리오를 불러왔습니다.');
          setTimeout(() => setSuccessMessage(null), 3000);
          
          // lastUpdateDate 확인
          const lastUpdate = data.lastUpdateDate || '';
          if (lastUpdate) {
            localStorage.setItem(LAST_UPDATE_KEY, lastUpdate);
          }
        }
      } else {
        // Google Drive에 파일이 없으면 localStorage에서 로드
        const { assets: loadedAssets } = loadFromLocalStorage();
        if (loadedAssets.length > 0) {
          setAssets(loadedAssets);
        } else {
          setAssets(initialAssets);
        }
      }
    } catch (error) {
      console.error('Failed to load from Google Drive:', error);
      // Google Drive에서 로드 실패 시 localStorage에서 로드
      const { assets: loadedAssets } = loadFromLocalStorage();
      if (loadedAssets.length > 0) {
        setAssets(loadedAssets);
      } else {
        setAssets(initialAssets);
      }
    }
  }, [loadFromLocalStorage, detectConflicts]);

  const [assets, setAssets] = useState<Asset[]>(() => {
    // 초기화 중이면 빈 배열로 시작 (초기화 후 로드)
    return [];
  });

  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioSnapshot[]>(() => {
    try {
      const savedHistory = localStorage.getItem(HISTORY_STORAGE_KEY);
      return savedHistory ? JSON.parse(savedHistory) : [];
    } catch (error) {
      console.error("Failed to load portfolio history from localStorage.", error);
      return [];
    }
  });

  // 초기화 완료 후 데이터 로드
  useEffect(() => {
    if (!isInitializing && assets.length === 0) {
      if (isSignedIn) {
        loadFromGoogleDrive();
      } else {
        const { assets: loadedAssets } = loadFromLocalStorage();
        if (loadedAssets.length > 0) {
          setAssets(loadedAssets);
        } else {
          setAssets(initialAssets);
        }
      }
    }
  }, [isInitializing, isSignedIn, loadFromGoogleDrive, loadFromLocalStorage]);

  const [fileName, setFileName] = useState<string>('portfolio.json');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [isBulkUploadModalOpen, setIsBulkUploadModalOpen] = useState<boolean>(false);
  const [isAddAssetModalOpen, setIsAddAssetModalOpen] = useState<boolean>(false);
  const [sellAlertDropRate, setSellAlertDropRate] = useState<number>(15);
  const [filterCategory, setFilterCategory] = useState<AssetCategory | 'ALL'>('ALL');
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [dashboardFilterCategory, setDashboardFilterCategory] = useState<AssetCategory | 'ALL'>('ALL');
  const [isAssistantOpen, setIsAssistantOpen] = useState<boolean>(false);
  const [filterAlerts, setFilterAlerts] = useState(false);
  
  // 충돌 관련 state
  const [conflictModalOpen, setConflictModalOpen] = useState<boolean>(false);
  const [conflicts, setConflicts] = useState<Array<{
    ticker: string;
    exchange: string;
    name: string;
    localAsset: Asset;
    driveAsset: Asset;
  }>>([]);
  const [pendingDriveAssets, setPendingDriveAssets] = useState<Asset[]>([]);
  const [pendingDriveHistory, setPendingDriveHistory] = useState<PortfolioSnapshot[]>([]);
  
  const handleRefreshAllPrices = useCallback(async (isAutoUpdate = false, isScheduled = false) => {
    if (assets.length === 0) return;
    setIsLoading(true);
    setError(null);
    if (isAutoUpdate || isScheduled) {
        setSuccessMessage('최신 종가 정보를 불러오는 중입니다...');
    } else {
        setSuccessMessage(null);
    }

    const promises = assets.map(asset => {
      if (asset.category === AssetCategory.CASH) {
          return fetchCurrentExchangeRate(asset.currency, Currency.KRW).then(rate => ({
              name: `현금 (${asset.currency})`,
              priceKRW: rate * asset.priceOriginal,
              priceOriginal: asset.priceOriginal,
              currency: asset.currency,
          }));
      }
      return fetchAssetData(asset.ticker, asset.exchange)
    });
    const results = await Promise.allSettled(promises);

    const failedTickers: string[] = [];
    const updatedAssets = assets.map((asset, index) => {
        const result = results[index];
        if (result.status === 'fulfilled') {
            const geminiData = result.value;
            return {
                ...asset,
                name: geminiData.name,
                currentPrice: geminiData.priceKRW,
                priceOriginal: geminiData.priceOriginal,
                currency: geminiData.currency as Currency,
                highestPrice: Math.max(asset.highestPrice, geminiData.priceKRW),
            };
        } else {
            console.error(`Failed to refresh price for ${asset.ticker}:`, result.reason);
            failedTickers.push(asset.ticker);
            return asset;
        }
    });

    setAssets(updatedAssets);

    if (failedTickers.length > 0) {
        setError(`${failedTickers.join(', ')} 가격 갱신에 실패했습니다.`);
        setTimeout(() => setError(null), 3000);
        if (isAutoUpdate || isScheduled) setSuccessMessage(null);
    } else {
        const successMsg = isScheduled 
          ? '매일 자동 업데이트: 모든 자산의 가격을 전일 종가로 업데이트했습니다.'
          : isAutoUpdate 
            ? '모든 자산의 가격을 최신 종가로 자동 업데이트했습니다.'
            : '모든 자산의 가격을 성공적으로 업데이트했습니다.';
        setSuccessMessage(successMsg);
        setTimeout(() => setSuccessMessage(null), 5000);
        
        const today = new Date().toISOString().slice(0, 10);
        localStorage.setItem(LAST_UPDATE_KEY, today);
        
        // 자동 저장
        autoSave(updatedAssets, portfolioHistory);
    }

    setIsLoading(false);
  }, [assets, portfolioHistory, autoSave]);

  // 자동 저장 함수 (디바운싱 적용)
  const autoSave = useCallback(
    (() => {
      let timeoutId: NodeJS.Timeout | null = null;
      let isSaving = false;
      return async (assetsToSave: Asset[], history: PortfolioSnapshot[]) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        
        timeoutId = setTimeout(async () => {
          if (isSaving) return; // 이미 저장 중이면 스킵
          isSaving = true;
          
          try {
            // 저장 중 메시지 표시
            setSuccessMessage('저장 중...');
            
            // localStorage에 항상 저장
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(assetsToSave));
            
            // Google Drive 로그인 상태일 때만 Google Drive에도 저장
            if (isSignedIn) {
              const exportData = {
                assets: assetsToSave,
                portfolioHistory: history,
                lastUpdateDate: new Date().toISOString().slice(0, 10)
              };
              const portfolioJSON = JSON.stringify(exportData, null, 2);
              await googleDriveService.saveFile(portfolioJSON);
              setSuccessMessage('Google Drive에 자동 저장되었습니다.');
            } else {
              setSuccessMessage('로컬 저장소에 자동 저장되었습니다.');
            }
            
            setTimeout(() => setSuccessMessage(null), 2000);
          } catch (error) {
            console.error('Auto-save failed:', error);
            setError('자동 저장에 실패했습니다.');
            setTimeout(() => setError(null), 3000);
          } finally {
            isSaving = false;
          }
        }, 2000); // 2초 대기
      };
    })(),
    [isSignedIn]
  );

  // 앱 시작 시 1회만 자동 업데이트
  useEffect(() => {
    const autoUpdatePrices = async () => {
      const today = new Date().toISOString().slice(0, 10);
      const firstLoadToday = localStorage.getItem(FIRST_LOAD_TODAY_KEY);
      
      // 오늘 첫 로드인지 확인
      if (firstLoadToday !== today) {
        const lastUpdate = localStorage.getItem(LAST_UPDATE_KEY);
        
        // 마지막 업데이트가 오늘이 아니면 업데이트
        if (lastUpdate !== today) {
          await handleRefreshAllPrices(true, false);
        }
        
        // 오늘 첫 로드 플래그 설정
        localStorage.setItem(FIRST_LOAD_TODAY_KEY, today);
      }
    };
    
    setTimeout(autoUpdatePrices, 100);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 매일 9시 5분 자동 업데이트 스케줄러
  useEffect(() => {
    if (!isSignedIn || assets.length === 0) return;
    
    let timeoutId: NodeJS.Timeout | null = null;
    let intervalId: NodeJS.Timeout | null = null;
    
    const scheduleDailyUpdate = () => {
      const now = new Date();
      const updateTime = new Date();
      updateTime.setHours(9, 5, 0, 0); // 9시 5분
      
      // 오늘 9시 5분이 지났으면 내일 9시 5분으로 설정
      if (now >= updateTime) {
        updateTime.setDate(updateTime.getDate() + 1);
      }
      
      const msUntilUpdate = updateTime.getTime() - now.getTime();
      
      timeoutId = setTimeout(async () => {
        // 로그인 상태이고 자산이 있을 때만 실행
        if (isSignedIn && assets.length > 0) {
          await handleRefreshAllPrices(false, true);
        }
        
        // 매일 반복되도록 재설정
        intervalId = setInterval(async () => {
          if (isSignedIn && assets.length > 0) {
            await handleRefreshAllPrices(false, true);
          }
        }, 24 * 60 * 60 * 1000); // 24시간마다
      }, msUntilUpdate);
    };
    
    scheduleDailyUpdate();
    
    // 컴포넌트 언마운트 시 정리
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [isSignedIn, assets.length, handleRefreshAllPrices]);

  useEffect(() => {
    const updatePortfolioHistory = () => {
      if (assets.length === 0) return;

      const today = new Date().toISOString().slice(0, 10);
      
      const newAssetSnapshots: AssetSnapshot[] = assets.map(asset => {
        const currentValue = asset.currentPrice * asset.quantity;
        let purchaseValueKRW;
         if (asset.currency === Currency.KRW) {
            purchaseValueKRW = asset.purchasePrice * asset.quantity;
        } else if (asset.purchaseExchangeRate) {
            purchaseValueKRW = asset.purchasePrice * asset.purchaseExchangeRate * asset.quantity;
        } else if (asset.priceOriginal > 0) {
            const exchangeRate = asset.currentPrice / asset.priceOriginal;
            purchaseValueKRW = asset.purchasePrice * exchangeRate * asset.quantity;
        } else {
            purchaseValueKRW = asset.purchasePrice * asset.quantity;
        }
        return {
          id: asset.id,
          name: asset.name,
          currentValue,
          purchaseValue: purchaseValueKRW,
        };
      });

      const newSnapshot: PortfolioSnapshot = {
        date: today,
        assets: newAssetSnapshots,
      };

      setPortfolioHistory(prevHistory => {
        const todayIndex = prevHistory.findIndex(snap => snap.date === today);
        let updatedHistory;
        if (todayIndex > -1) {
          updatedHistory = [...prevHistory];
          updatedHistory[todayIndex] = newSnapshot;
        } else {
          updatedHistory = [...prevHistory, newSnapshot];
        }
        
        if (updatedHistory.length > 365) {
            updatedHistory = updatedHistory.slice(updatedHistory.length - 365);
        }

        try {
          localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updatedHistory));
        } catch (e) {
          console.error("Failed to save history to localStorage", e);
        }
        return updatedHistory;
      });
    };
    
    updatePortfolioHistory();
  }, [assets]);

  const filteredAssets = useMemo(() => {
    if (filterCategory === 'ALL') {
      return assets;
    }
    return assets.filter(asset => asset.category === filterCategory);
  }, [assets, filterCategory]);

  const handleSaveAssets = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      if (isSignedIn) {
        // Google Drive에 저장
        const exportData = {
          assets: assets,
          portfolioHistory: portfolioHistory,
          lastUpdateDate: new Date().toISOString().slice(0, 10)
        };
        const portfolioJSON = JSON.stringify(exportData, null, 2);
        await googleDriveService.saveFile(portfolioJSON);
        setSuccessMessage('포트폴리오가 Google Drive에 성공적으로 저장되었습니다.');
      } else {
        // localStorage에 저장
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(assets));
        setSuccessMessage('포트폴리오가 브라우저에 성공적으로 저장되었습니다.');
      }
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (e: any) {
      const errorMsg = isSignedIn 
        ? 'Google Drive 저장에 실패했습니다. 네트워크 연결을 확인해주세요.'
        : '브라우저 저장에 실패했습니다. 저장 공간이 부족할 수 있습니다.';
      setError(errorMsg);
      setTimeout(() => setError(null), 3000);
    }
    setIsLoading(false);
  }, [assets, portfolioHistory, isSignedIn]);

  const handleExportAssetsToFile = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);

    const exportData = {
      assets: assets,
      portfolioHistory: portfolioHistory,
      lastUpdateDate: new Date().toISOString().slice(0, 10)
    };
    const portfolioJSON = JSON.stringify(exportData, null, 2);
    const blob = new Blob([portfolioJSON], { type: 'application/json' });

    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      setSuccessMessage(`'${fileName}' 파일로 내보내기가 완료되었습니다.`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (e: any) {
      console.error("Failed to export assets", e);
      setError('파일 내보내기에 실패했습니다.');
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  }, [assets, portfolioHistory, fileName]);

  const handleImportAssetsFromFile = useCallback(async () => {
    setError(null);
    setSuccessMessage(null);
    setIsLoading(true);

    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = (event) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) {
          setIsLoading(false);
          return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const contents = e.target?.result as string;
            const loadedData = JSON.parse(contents);
            
            let loadedAssets: any[];
            let loadedHistory: PortfolioSnapshot[] | undefined;

            if (Array.isArray(loadedData)) {
              // Old format: just the assets array
              loadedAssets = loadedData;
            } else if (loadedData && typeof loadedData === 'object' && Array.isArray(loadedData.assets)) {
              // New format: object with assets and portfolioHistory
              loadedAssets = loadedData.assets;
              if (Array.isArray(loadedData.portfolioHistory)) {
                loadedHistory = loadedData.portfolioHistory;
              }
            } else {
              throw new Error("Invalid file format.");
            }
            
            const assetsWithDefaults = loadedAssets.map(mapToNewAssetStructure);

            setAssets(assetsWithDefaults);
            if (loadedHistory) {
              setPortfolioHistory(loadedHistory);
            }
            setFileName(file.name);
            setSuccessMessage(`'${file.name}' 파일에서 성공적으로 가져왔습니다.`);
            setTimeout(() => setSuccessMessage(null), 3000);
          } catch (err) {
            setError('파일 가져오기에 실패했습니다. 파일 형식이 올바른지 확인해주세요.');
            setTimeout(() => setError(null), 3000);
          } finally {
            setIsLoading(false);
          }
        };
        reader.onerror = () => {
          setError('파일을 읽는 데 실패했습니다.');
          setTimeout(() => setError(null), 3000);
          setIsLoading(false);
        };
        reader.readAsText(file);
      };
      input.click();
    } catch (err: any) {
      console.error("Failed to load or parse assets from file", err);
      setError('파일 가져오기에 실패했습니다.');
      setTimeout(() => setError(null), 3000);
      setIsLoading(false);
    }
  }, []);


  const handleAddAsset = useCallback(async (newAssetData: NewAssetForm) => {
    setIsAddAssetModalOpen(false);
    setIsLoading(true);
    setError(null);
    try {
      let newAsset: Omit<Asset, 'id'>;
      if (newAssetData.category === AssetCategory.CASH) {
        const [purchaseExchangeRate, currentExchangeRate] = await Promise.all([
          fetchHistoricalExchangeRate(newAssetData.purchaseDate, newAssetData.currency, Currency.KRW),
          fetchCurrentExchangeRate(newAssetData.currency, Currency.KRW)
        ]);

        newAsset = {
          ...newAssetData,
          ticker: newAssetData.currency,
          name: `현금 (${newAssetData.currency})`,
          currentPrice: currentExchangeRate * newAssetData.purchasePrice,
          priceOriginal: newAssetData.purchasePrice,
          highestPrice: currentExchangeRate * newAssetData.purchasePrice,
          purchaseExchangeRate,
        };
      } else {
        const geminiData = await fetchAssetData(newAssetData.ticker, newAssetData.exchange);
        const purchaseExchangeRate = await fetchHistoricalExchangeRate(newAssetData.purchaseDate, newAssetData.currency, Currency.KRW);

        newAsset = {
          ...newAssetData,
          name: geminiData.name,
          currentPrice: geminiData.priceKRW,
          priceOriginal: geminiData.priceOriginal,
          highestPrice: geminiData.priceKRW,
          purchaseExchangeRate,
          currency: geminiData.currency as Currency || newAssetData.currency,
        };
      }
      
      const finalNewAsset: Asset = {
        id: new Date().getTime().toString(),
        ...newAsset
      };

      setAssets(prevAssets => {
        const newAssets = [...prevAssets, finalNewAsset];
        // 자동 저장
        autoSave(newAssets, portfolioHistory);
        return newAssets;
      });
      setSuccessMessage(`${finalNewAsset.name} 자산이 추가되었습니다.`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (e) {
      console.error(e);
      setError('자산 정보를 가져오는 데 실패했습니다. 티커, 거래소, 날짜를 확인해주세요.');
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  }, [autoSave, portfolioHistory]);
  
  const handleDeleteAsset = useCallback((assetId: string) => {
    setAssets(prevAssets => {
      const updated = prevAssets.filter(asset => asset.id !== assetId);
      // 자동 저장
      autoSave(updated, portfolioHistory);
      return updated;
    });
    setEditingAsset(null);
  }, [autoSave, portfolioHistory]);

  const handleEditAsset = useCallback((asset: Asset) => {
    setEditingAsset(asset);
  }, []);

  const handleCloseEditModal = useCallback(() => {
    setEditingAsset(null);
  }, []);

  const handleUpdateAsset = useCallback(async (updatedAsset: Asset) => {
    const originalAsset = assets.find(a => a.id === updatedAsset.id);
    if (!originalAsset) return;

    setIsLoading(true);
    setError(null);

    try {
      let finalAsset = { ...updatedAsset };
      
      if (updatedAsset.category === AssetCategory.CASH) {
          const dateOrCurrencyChanged = originalAsset.purchaseDate !== updatedAsset.purchaseDate ||
                                      originalAsset.currency !== updatedAsset.currency;

          if (dateOrCurrencyChanged) {
                const [purchaseExchangeRate, currentExchangeRate] = await Promise.all([
                  fetchHistoricalExchangeRate(updatedAsset.purchaseDate, updatedAsset.currency, Currency.KRW),
                  fetchCurrentExchangeRate(updatedAsset.currency, Currency.KRW)
                ]);
                finalAsset = {
                    ...finalAsset,
                    ticker: updatedAsset.currency,
                    name: `현금 (${updatedAsset.currency})`,
                    purchaseExchangeRate,
                    currentPrice: currentExchangeRate * finalAsset.priceOriginal,
                    highestPrice: Math.max(originalAsset.highestPrice, currentExchangeRate * finalAsset.priceOriginal),
                };
          }
      } else {
          const infoChanged = originalAsset.ticker.toUpperCase() !== updatedAsset.ticker.toUpperCase() ||
                              originalAsset.exchange !== updatedAsset.exchange;
          
          const dateOrCurrencyChanged = originalAsset.purchaseDate !== updatedAsset.purchaseDate ||
                                        originalAsset.currency !== updatedAsset.currency;

          if (infoChanged) {
            const geminiData = await fetchAssetData(updatedAsset.ticker, updatedAsset.exchange);
            finalAsset = {
              ...finalAsset,
              name: geminiData.name,
              currentPrice: geminiData.priceKRW,
              priceOriginal: geminiData.priceOriginal,
              currency: geminiData.currency as Currency,
              highestPrice: geminiData.priceKRW,
            };
          }
          
          if (infoChanged || dateOrCurrencyChanged) {
            const purchaseExchangeRate = await fetchHistoricalExchangeRate(finalAsset.purchaseDate, finalAsset.currency, Currency.KRW);
            finalAsset.purchaseExchangeRate = purchaseExchangeRate;
          }
      }


      setAssets(prevAssets => {
        const updated = prevAssets.map(asset => 
          asset.id === updatedAsset.id ? finalAsset : asset
        );
        // 자동 저장
        autoSave(updated, portfolioHistory);
        return updated;
      });
      setEditingAsset(null);
    } catch (e) {
      console.error(e);
      setError('자산 정보 업데이트에 실패했습니다. 입력값을 확인해주세요.');
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  }, [assets, autoSave, portfolioHistory]);
  
  const handleCsvFileUpload = useCallback(async (file: File): Promise<BulkUploadResult> => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            let successCount = 0;
            let failedCount = 0;
            const errors: { ticker: string; reason: string }[] = [];
            const lines = (e.target?.result as string).split('\n').filter(line => line.trim() !== '');

            try {
                if (lines.length < 2) throw new Error('CSV 파일에 헤더와 데이터가 포함되어야 합니다.');
                
                const headerLine = lines[0].trim().replace(/\uFEFF/g, '');
                const header = headerLine.split(',').map(h => h.trim());
                
                const expectedHeaders = [
                  ['ticker', 'exchange', 'quantity', 'purchasePrice', 'purchaseDate', 'category', 'currency', 'sellAlertDropRate'],
                  ['ticker', 'exchange', 'quantity', 'purchasePrice', 'purchaseDate', 'category', 'currency']
                ];

                const headerMatch = expectedHeaders.find(h => JSON.stringify(h) === JSON.stringify(header));

                if (!headerMatch) {
                    throw new Error(`잘못된 헤더입니다. 예상 헤더: ${expectedHeaders[1].join(',')}`);
                }
                const hasSellAlertRate = headerMatch.length === 8;
                
                const rows = lines.slice(1);
                const newAssetForms: (NewAssetForm & { sellAlertDropRate?: number } | { error: string, ticker: string })[] = rows.map((row, index) => {
                    const values = row.trim().split(',');
                    if (values.length < 7 || values.length > 8) {
                        return { error: `${headerMatch.length}개의 값이 필요합니다.`, ticker: `행 ${index + 2}` };
                    }
                    const [ticker, exchange, quantityStr, priceStr, dateStr, categoryStr, currencyStr, sellAlertDropRateStr] = values.map(v => v.trim());
                    
                    if (!ticker && categoryStr as AssetCategory !== AssetCategory.CASH) return { error: '티커가 비어있습니다.', ticker: `행 ${index + 2}` };
                    if (!exchange) return { error: '거래소가 비어있습니다.', ticker: `행 ${index + 2}` };
                    if (isNaN(parseFloat(quantityStr)) || parseFloat(quantityStr) <= 0) return { error: '수량이 유효한 숫자가 아닙니다.', ticker };
                    if (isNaN(parseFloat(priceStr)) || parseFloat(priceStr) < 0) return { error: '매수가가 유효한 숫자가 아닙니다.', ticker };
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { error: '날짜 형식이 YYYY-MM-DD가 아닙니다.', ticker };
                    if (!Object.values(AssetCategory).includes(categoryStr as AssetCategory)) return { error: '유효하지 않은 자산 구분입니다.', ticker };
                    if (!Object.values(Currency).includes(currencyStr as Currency)) return { error: '유효하지 않은 통화입니다.', ticker };
                    
                    const form: NewAssetForm & { sellAlertDropRate?: number } = {
                        ticker: categoryStr as AssetCategory === AssetCategory.CASH ? currencyStr : ticker,
                        exchange,
                        quantity: parseFloat(quantityStr),
                        purchasePrice: parseFloat(priceStr),
                        purchaseDate: dateStr,
                        category: categoryStr as AssetCategory,
                        currency: currencyStr as Currency,
                    };

                    if (hasSellAlertRate && sellAlertDropRateStr) {
                      const rate = parseFloat(sellAlertDropRateStr);
                      if (!isNaN(rate) && rate > 0) {
                        form.sellAlertDropRate = rate;
                      }
                    }

                    return form;
                });

                const validForms = newAssetForms.filter(f => !('error' in f)) as (NewAssetForm & { sellAlertDropRate?: number })[];
                const invalidForms = newAssetForms.filter(f => 'error' in f) as { error: string, ticker: string }[];

                invalidForms.forEach(form => {
                    errors.push({ ticker: form.ticker, reason: form.error });
                });
                
                if (validForms.length > 0) {
                    const newAssets: Asset[] = [];
                    for (const form of validForms) {
                        try {
                           let newAsset: Omit<Asset, 'id'>;
                           if (form.category === AssetCategory.CASH) {
                              const [purchaseExchangeRate, currentExchangeRate] = await Promise.all([
                                fetchHistoricalExchangeRate(form.purchaseDate, form.currency, Currency.KRW),
                                fetchCurrentExchangeRate(form.currency, Currency.KRW)
                              ]);
                              newAsset = {
                                ...form,
                                name: `현금 (${form.currency})`,
                                currentPrice: currentExchangeRate * form.purchasePrice,
                                priceOriginal: form.purchasePrice,
                                highestPrice: currentExchangeRate * form.purchasePrice,
                                purchaseExchangeRate,
                              };
                           } else {
                              const geminiData = await fetchAssetData(form.ticker, form.exchange);
                              const purchaseExchangeRate = await fetchHistoricalExchangeRate(form.purchaseDate, form.currency, Currency.KRW);

                              newAsset = {
                                  ...form,
                                  name: geminiData.name,
                                  currentPrice: geminiData.priceKRW,
                                  priceOriginal: geminiData.priceOriginal,
                                  currency: geminiData.currency as Currency,
                                  highestPrice: geminiData.priceKRW,
                                  purchaseExchangeRate,
                              };
                           }
                            
                            const finalNewAsset: Asset = {
                                id: `${new Date().getTime()}-${form.ticker}`,
                                ...newAsset
                            };

                            if (form.sellAlertDropRate) {
                              finalNewAsset.sellAlertDropRate = form.sellAlertDropRate;
                            }
                            newAssets.push(finalNewAsset);
                        } catch (error: any) {
                            errors.push({
                                ticker: form.ticker,
                                reason: error.message || '데이터 조회 실패',
                            });
                        }
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                    
                    setAssets(prev => {
                        const updated = [...prev, ...newAssets];
                        // 자동 저장
                        autoSave(updated, portfolioHistory);
                        return updated;
                    });
                    successCount = newAssets.length;
                }
                
                failedCount = errors.length;
                resolve({ successCount, failedCount, errors });

            } catch (err: any) {
                resolve({ successCount: 0, failedCount: lines.length > 1 ? lines.length - 1 : 0, errors: [{ ticker: '파일 전체', reason: err.message }] });
            }
        };

        reader.onerror = () => {
             resolve({ successCount: 0, failedCount: 0, errors: [{ ticker: '파일 읽기 오류', reason: '파일을 읽는 데 실패했습니다.' }] });
        };
        
        reader.readAsText(file);
    });
  }, [autoSave, portfolioHistory]);

  const totalValue = useMemo(() => {
    return assets.reduce((acc, asset) => acc + asset.currentPrice * asset.quantity, 0);
  }, [assets]);

  const totalPurchaseValue = useMemo(() => {
    return assets.reduce((acc, asset) => {
        if (asset.currency === Currency.KRW) {
            return acc + asset.purchasePrice * asset.quantity;
        }
        if (asset.purchaseExchangeRate) {
            return acc + (asset.purchasePrice * asset.purchaseExchangeRate * asset.quantity);
        }
        if (asset.priceOriginal > 0) {
            const exchangeRate = asset.currentPrice / asset.priceOriginal;
            return acc + (asset.purchasePrice * exchangeRate * asset.quantity);
        }
        return acc + asset.purchasePrice * asset.quantity;
    }, 0);
  }, [assets]);
  
  const formatCurrencyKRW = (value: number) => {
    return value.toLocaleString('ko-KR', { 
        style: 'currency', 
        currency: 'KRW', 
        maximumFractionDigits: 0 
    });
  };

  // Filtered assets for dashboard
  const dashboardFilteredAssets = useMemo(() => {
      if (dashboardFilterCategory === 'ALL') {
          return assets;
      }
      return assets.filter(asset => asset.category === dashboardFilterCategory);
  }, [assets, dashboardFilterCategory]);

  // Calculations for the dashboard based on the filter
  const dashboardTotalValue = useMemo(() => {
      return dashboardFilteredAssets.reduce((acc, asset) => acc + asset.currentPrice * asset.quantity, 0);
  }, [dashboardFilteredAssets]);

  const dashboardTotalPurchaseValue = useMemo(() => {
      return dashboardFilteredAssets.reduce((acc, asset) => {
          if (asset.currency === Currency.KRW) {
              return acc + asset.purchasePrice * asset.quantity;
          }
          if (asset.purchaseExchangeRate) {
              return acc + (asset.purchasePrice * asset.purchaseExchangeRate * asset.quantity);
          }
          if (asset.priceOriginal > 0) {
              const exchangeRate = asset.currentPrice / asset.priceOriginal;
              return acc + (asset.purchasePrice * exchangeRate * asset.quantity);
          }
          return acc + asset.purchasePrice * asset.quantity;
      }, 0);
  }, [dashboardFilteredAssets]);

  const dashboardTotalGainLoss = dashboardTotalValue - dashboardTotalPurchaseValue;
  const dashboardTotalReturn = dashboardTotalPurchaseValue === 0 ? 0 : (dashboardTotalGainLoss / dashboardTotalPurchaseValue) * 100;
  
  const profitLossChartTitle = useMemo(() => (
      dashboardFilterCategory === 'ALL'
      ? '손익 추이 분석'
      : `${dashboardFilterCategory} 손익 추이 분석`
  ), [dashboardFilterCategory]);
  
  const alertCount = useMemo(() => {
    return assets.filter(asset => {
        if (asset.highestPrice === 0) return false;
        const dropFromHigh = ((asset.currentPrice - asset.highestPrice) / asset.highestPrice) * 100;
        const alertRate = asset.sellAlertDropRate ?? sellAlertDropRate;
        return dropFromHigh <= -alertRate;
    }).length;
  }, [assets, sellAlertDropRate]);

  const handleExportToCsv = useCallback(() => {
    if (assets.length === 0) {
        alert('내보낼 데이터가 없습니다.');
        return;
    }

    setIsLoading(true);
    setError(null);

    try {
        const header = [
            '종목명', '티커', '거래소', '자산구분', '보유수량', 
            '매수단가(자국통화)', '매수환율', '총매수금액(원화)',
            '현재단가(원화)', '현재평가금액(원화)', '총손익(원화)', '수익률(%)'
        ];

        const rows = assets.map(asset => {
            const currentValue = asset.currentPrice * asset.quantity;
            
            let purchaseValueKRW;
            if (asset.currency === Currency.KRW) {
                purchaseValueKRW = asset.purchasePrice * asset.quantity;
            } else if (asset.purchaseExchangeRate) {
                purchaseValueKRW = asset.purchasePrice * asset.purchaseExchangeRate * asset.quantity;
            } else if (asset.priceOriginal > 0) {
                const exchangeRate = asset.currentPrice / asset.priceOriginal;
                purchaseValueKRW = asset.purchasePrice * exchangeRate * asset.quantity;
            } else {
                purchaseValueKRW = asset.purchasePrice * asset.quantity;
            }
            
            const profitLoss = currentValue - purchaseValueKRW;
            const returnPercentage = purchaseValueKRW === 0 ? 0 : (profitLoss / purchaseValueKRW) * 100;
            
            const escapeCsvCell = (cell: any) => {
                const cellStr = String(cell);
                if (cellStr.includes(',')) {
                    return `"${cellStr}"`;
                }
                return cellStr;
            };

            return [
                escapeCsvCell(asset.name),
                escapeCsvCell(asset.ticker),
                escapeCsvCell(asset.exchange),
                escapeCsvCell(asset.category),
                asset.quantity,
                asset.purchasePrice,
                asset.purchaseExchangeRate || 1,
                Math.round(purchaseValueKRW),
                Math.round(asset.currentPrice),
                Math.round(currentValue),
                Math.round(profitLoss),
                returnPercentage.toFixed(2),
            ].join(',');
        });

        const csvContent = [header.join(','), ...rows].join('\n');
        const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'portfolio_export.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        setSuccessMessage('포트폴리오를 CSV 파일로 성공적으로 내보냈습니다.');
        setTimeout(() => setSuccessMessage(null), 3000);

    } catch (e: any) {
        console.error("Failed to export to CSV", e);
        setError('CSV 파일 내보내기에 실패했습니다.');
        setTimeout(() => setError(null), 3000);
    } finally {
        setIsLoading(false);
    }
  }, [assets]);
  
  // Google 로그인 핸들러
  const handleSignIn = useCallback(async () => {
    setIsLoading(true);
    setError(null);  

    // 임시: 클라이언트 ID 확인
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    console.log('=== 디버깅 정보 ===');
    console.log('Client ID:', clientId);
    console.log('Client ID 길이:', clientId?.length);
    console.log('==================');
    
    try {
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
      if (!clientId) {
        setError('Google Client ID가 설정되지 않았습니다. .env 파일에 VITE_GOOGLE_CLIENT_ID를 추가해주세요.');
        setTimeout(() => setError(null), 5000);
        setIsLoading(false);
        return;
      }

      await googleDriveService.initialize(clientId);
      const user = await googleDriveService.signIn();
      setIsSignedIn(true);
      setGoogleUser(user);
      
      // Google Drive에서 데이터 로드
      await loadFromGoogleDrive();
      
      setSuccessMessage(`${user.email} 계정으로 로그인되었습니다.`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error: any) {
      console.error('Sign in error:', error);
      setError('로그인에 실패했습니다: ' + (error.message || '알 수 없는 오류'));
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsLoading(false);
    }
  }, [loadFromGoogleDrive]);

  // Google 로그아웃 핸들러
  const handleSignOut = useCallback(() => {
    googleDriveService.signOut();
    setIsSignedIn(false);
    setGoogleUser(null);
    
    // localStorage에서 데이터 로드
    const { assets: loadedAssets } = loadFromLocalStorage();
    if (loadedAssets.length > 0) {
      setAssets(loadedAssets);
    } else {
      setAssets(initialAssets);
    }
    
    setSuccessMessage('로그아웃되었습니다. 브라우저 로컬 저장소를 사용합니다.');
    setTimeout(() => setSuccessMessage(null), 3000);
  }, [loadFromLocalStorage]);

  // 충돌 해결: 로컬 데이터 사용
  const handleSelectLocal = useCallback(() => {
    const { assets: loadedAssets } = loadFromLocalStorage();
    if (loadedAssets.length > 0) {
      setAssets(loadedAssets);
    } else {
      setAssets(initialAssets);
    }
    
    setConflictModalOpen(false);
    setConflicts([]);
    setPendingDriveAssets([]);
    setPendingDriveHistory([]);
    
    setSuccessMessage('로컬 데이터를 사용합니다.');
    setTimeout(() => setSuccessMessage(null), 3000);
  }, [loadFromLocalStorage]);

  // 충돌 해결: Google Drive 데이터 사용
  const handleSelectDrive = useCallback(() => {
    if (pendingDriveAssets.length > 0) {
      setAssets(pendingDriveAssets);
      if (pendingDriveHistory.length > 0) {
        setPortfolioHistory(pendingDriveHistory);
      }
      
      // Google Drive에 저장된 lastUpdateDate 확인
      const today = new Date().toISOString().slice(0, 10);
      localStorage.setItem(LAST_UPDATE_KEY, today);
      
      setSuccessMessage('Google Drive 데이터를 사용합니다.');
      setTimeout(() => setSuccessMessage(null), 3000);
    }
    
    setConflictModalOpen(false);
    setConflicts([]);
    setPendingDriveAssets([]);
    setPendingDriveHistory([]);
  }, [pendingDriveAssets, pendingDriveHistory]);

  const handleTabChange = (tabId: ActiveTab) => {
    if (tabId !== 'portfolio') {
        setFilterAlerts(false);
    }
    setActiveTab(tabId);
  };

  const TabButton: React.FC<{tabId: ActiveTab; children: React.ReactNode; onClick: () => void}> = ({ tabId, children, onClick }) => {
    const isActive = activeTab === tabId;
    const activeClasses = "border-primary text-primary";
    const inactiveClasses = "border-transparent text-gray-400 hover:text-white hover:border-gray-500";
    return (
        <button
          onClick={onClick}
          className={`py-4 px-1 text-center border-b-2 font-medium text-sm focus:outline-none transition-colors duration-300 ${isActive ? activeClasses : inactiveClasses}`}
        >
          {children}
        </button>
    );
  };
  
  return (
    <div className="min-h-screen bg-gray-900 font-sans p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <Header 
          onSave={handleSaveAssets} 
          onImport={handleImportAssetsFromFile}
          onExport={handleExportAssetsToFile}
          onExportToCsv={handleExportToCsv}
          onOpenBulkUploadModal={() => setIsBulkUploadModalOpen(true)}
          onOpenAddAssetModal={() => setIsAddAssetModalOpen(true)}
          onSignIn={handleSignIn}
          onSignOut={handleSignOut}
          isSignedIn={isSignedIn}
          userEmail={googleUser?.email}
        />
        
        {successMessage && (
          <div className="bg-success/20 border border-success text-success px-4 py-3 rounded-lg relative mb-6" role="alert">
            <span className="block sm:inline">{successMessage}</span>
            <span className="absolute top-0 bottom-0 right-0 px-4 py-3" onClick={() => setSuccessMessage(null)}>
              <svg className="fill-current h-6 w-6 text-success" role="button" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Close</title><path d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.819l-2.651 3.029a1.2 1.2 0 1 1-1.697-1.697l2.758-3.15-2.759-3.152a1.2 1.2 0 1 1 1.697-1.697L10 8.183l2.651-3.031a1.2 1.2 0 1 1 1.697 1.697l-2.758 3.152 2.758 3.15a1.2 1.2 0 0 1 0 1.698z"/></svg>
            </span>
          </div>
        )}
        
        {error && (
          <div className="bg-danger/20 border border-danger text-danger px-4 py-3 rounded-lg relative mb-6" role="alert">
            <span className="block sm:inline">{error}</span>
            <span className="absolute top-0 bottom-0 right-0 px-4 py-3" onClick={() => setError(null)}>
              <svg className="fill-current h-6 w-6 text-danger" role="button" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Close</title><path d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.819l-2.651 3.029a1.2 1.2 0 1 1-1.697-1.697l2.758-3.15-2.759-3.152a1.2 1.2 0 1 1 1.697-1.697L10 8.183l2.651-3.031a1.2 1.2 0 1 1 1.697 1.697l-2.758 3.152 2.758 3.15a1.2 1.2 0 0 1 0 1.698z"/></svg>
            </span>
          </div>
        )}

        <div className="border-b border-gray-700">
          <nav className="-mb-px flex space-x-8" aria-label="Tabs">
            <TabButton tabId="dashboard" onClick={() => handleTabChange('dashboard')}>대시보드</TabButton>
            <TabButton tabId="portfolio" onClick={() => handleTabChange('portfolio')}>포트폴리오 상세</TabButton>
          </nav>
        </div>

        <main className="mt-8">
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              <div className="bg-gray-800 p-4 rounded-lg shadow-lg flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-4" title="대시보드에 표시될 자산의 종류를 선택합니다.">
                      <label htmlFor="dashboard-filter" className="text-sm font-medium text-gray-300">
                          자산 구분 필터:
                      </label>
                      <div className="relative">
                          <select
                              id="dashboard-filter"
                              value={dashboardFilterCategory}
                              onChange={(e) => setDashboardFilterCategory(e.target.value as AssetCategory | 'ALL')}
                              className="bg-gray-700 border border-gray-600 rounded-md py-2 pl-3 pr-8 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent appearance-none"
                          >
                              <option value="ALL">전체 포트폴리오</option>
                              {Object.values(AssetCategory).map((cat) => (
                                  <option key={cat} value={cat}>{cat}</option>
                              ))}
                          </select>
                          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
                              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                          </div>
                      </div>
                  </div>
                  <StatCard 
                      title="매도 알림 발생" 
                      value={`${alertCount}개`}
                      tooltip="설정된 하락률 기준을 초과한 자산의 수입니다. 클릭하여 필터링된 목록을 확인하세요."
                      onClick={() => {
                          handleTabChange('portfolio');
                          setFilterAlerts(true);
                      }}
                      isAlert={alertCount > 0}
                      size="small"
                  />
              </div>
               <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard title="총 자산 (원화)" value={formatCurrencyKRW(dashboardTotalValue)} tooltip="선택된 자산의 현재 평가금액 총합입니다." />
                <StatCard title="투자 원금" value={formatCurrencyKRW(dashboardTotalPurchaseValue)} tooltip="선택된 자산의 총 매수금액 합계입니다." />
                <StatCard title="총 손익 (원화)" value={formatCurrencyKRW(dashboardTotalGainLoss)} isProfit={dashboardTotalGainLoss >= 0} tooltip="총 평가금액에서 총 매수금액을 뺀 금액입니다."/>
                <StatCard title="총 수익률" value={`${dashboardTotalReturn.toFixed(2)}%`} isProfit={dashboardTotalReturn >= 0} tooltip="총 손익을 총 매수금액으로 나눈 백분율입니다."/>
              </div>
              <ProfitLossChart history={portfolioHistory} assetsToDisplay={dashboardFilteredAssets} title={profitLossChartTitle} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="lg:col-span-1">
                  <AllocationChart assets={assets} />
                </div>
                <div className="lg:col-span-1">
                   <CategorySummaryTable assets={assets} totalPortfolioValue={totalValue} />
                </div>
              </div>
              <TopBottomAssets assets={assets} />
            </div>
          )}

          {activeTab === 'portfolio' && (
            <div className="space-y-6">
               <SellAlertControl value={sellAlertDropRate} onChange={setSellAlertDropRate} />
                <PortfolioTable
                  assets={filteredAssets}
                  history={portfolioHistory}
                  onRefreshAll={() => handleRefreshAllPrices(false)}
                  onEdit={handleEditAsset}
                  isLoading={isLoading}
                  sellAlertDropRate={sellAlertDropRate}
                  filterCategory={filterCategory}
                  onFilterChange={setFilterCategory}
                  filterAlerts={filterAlerts}
                  onFilterAlertsChange={setFilterAlerts}
                />
            </div>
          )}
        </main>
        
        <EditAssetModal
          asset={editingAsset}
          isOpen={!!editingAsset}
          onClose={handleCloseEditModal}
          onSave={handleUpdateAsset}
          onDelete={handleDeleteAsset}
          isLoading={isLoading}
        />
         <BulkUploadModal
          isOpen={isBulkUploadModalOpen}
          onClose={() => setIsBulkUploadModalOpen(false)}
          onFileUpload={handleCsvFileUpload}
        />
        <AddNewAssetModal 
          isOpen={isAddAssetModalOpen}
          onClose={() => setIsAddAssetModalOpen(false)}
          onAddAsset={handleAddAsset}
          isLoading={isLoading}
          assets={assets}
        />
      </div>

      <button
        onClick={() => setIsAssistantOpen(true)}
        className="fixed bottom-8 right-8 bg-primary hover:bg-primary-dark text-white rounded-full p-4 shadow-lg transition-transform transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-primary"
        title="포트폴리오 어시스턴트 열기"
        aria-label="Open portfolio assistant"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 24 24" fill="currentColor">
          <path d="M14 12c0 .552-.448 1-1 1s-1-.448-1-1 .448-1 1-1 1 .448 1 1zm-1-3.5c-2.481 0-4.5 2.019-4.5 4.5s2.019 4.5 4.5 4.5 4.5-2.019 4.5-4.5-2.019-4.5-4.5-4.5zm0-3.5c-4.411 0-8 3.589-8 8s3.589 8 8 8 8-3.589 8-8-3.589-8-8-8zm-5.5 8c0-3.033 2.468-5.5 5.5-5.5s5.5 2.467 5.5 5.5-2.468 5.5-5.5 5.5-5.5-2.467-5.5-5.5zm11.5 0c0 .828-.672 1.5-1.5 1.5s-1.5-.672-1.5-1.5.672-1.5 1.5-1.5 1.5.672 1.5 1.5z"/>
        </svg>
      </button>

      <PortfolioAssistant
        isOpen={isAssistantOpen}
        onClose={() => setIsAssistantOpen(false)}
        assets={assets}
      />

      <DataConflictModal
        isOpen={conflictModalOpen}
        conflicts={conflicts}
        onSelectLocal={handleSelectLocal}
        onSelectDrive={handleSelectDrive}
      />
    </div>
  );
};

export default App;