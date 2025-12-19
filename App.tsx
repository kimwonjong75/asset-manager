import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Asset, NewAssetForm, AssetCategory, EXCHANGE_MAP, Currency, PortfolioSnapshot, AssetSnapshot, BulkUploadResult, ALLOWED_CATEGORIES, SellRecord, WatchlistItem, normalizeExchange, ExchangeRates } from './types';
import { fetchHistoricalExchangeRate, fetchCurrentExchangeRate } from './services/geminiService';
import { fetchAssetData as fetchAssetDataNew, fetchBatchAssetPrices as fetchBatchAssetPricesNew, fetchExchangeRate, fetchExchangeRateJPY } from './services/priceService';
import { googleDriveService, GoogleUser } from './services/googleDriveService';
import { useGoogleDriveSync } from './hooks/useGoogleDriveSync';
import PortfolioTable from './components/PortfolioTable';
import AllocationChart from './components/AllocationChart';
import Header from './components/Header';
import StatCard from './components/StatCard';
import EditAssetModal from './components/EditAssetModal';
import SellAssetModal from './components/SellAssetModal';
import BulkUploadModal from './components/BulkUploadModal';
import SellAlertControl from './components/SellAlertControl';
import CategorySummaryTable from './components/CategorySummaryTable';
import ProfitLossChart from './components/ProfitLossChart';
import AddNewAssetModal from './components/AddNewAssetModal';
import TopBottomAssets from './components/TopBottomAssets';
import PortfolioAssistant from './components/PortfolioAssistant';
import SellAnalyticsPage from './components/SellAnalyticsPage';
import WatchlistPage from './components/WatchlistPage';
import ExchangeRateInput from './components/ExchangeRateInput';
import { runMigrationIfNeeded } from './utils/migrateData';

type ActiveTab = 'dashboard' | 'portfolio' | 'analytics' | 'watchlist';

const mapToNewAssetStructure = (asset: any): Asset => {
  let newAsset = { ...asset };

  if (!newAsset.exchange) newAsset.exchange = EXCHANGE_MAP[newAsset.category]?.[0] || '';
  if (!newAsset.currency) {
      newAsset.currency = Currency.KRW;
      newAsset.priceOriginal = newAsset.currentPrice;
  }
  if (!newAsset.purchaseExchangeRate) {
      newAsset.purchaseExchangeRate = newAsset.currency === Currency.KRW ? 1 : undefined;
  }

  const oldCategory = newAsset.category;
  if (['주식', 'ETF'].includes(oldCategory)) {
      if (newAsset.exchange?.startsWith('KRX')) {
          newAsset.category = AssetCategory.KOREAN_STOCK;
      } else if (['NASDAQ', 'NYSE', 'AMEX'].includes(newAsset.exchange)) {
          newAsset.category = AssetCategory.US_STOCK;
      } else {
          newAsset.category = AssetCategory.OTHER_FOREIGN_STOCK;
      }
  } else if (['KRX금현물', '금', '실물자산'].includes(oldCategory)) {
      newAsset.category = AssetCategory.PHYSICAL_ASSET;
  } else {
      const categoryMap: { [key: string]: AssetCategory } = {
          "국내주식": AssetCategory.KOREAN_STOCK,
          "해외주식": AssetCategory.US_STOCK,
          "국내국채": AssetCategory.KOREAN_BOND,
          "해외국채": AssetCategory.US_BOND,
      };
      if (categoryMap[oldCategory]) {
          newAsset.category = categoryMap[oldCategory];
      }
  }
  
  if (!Object.values(AssetCategory).includes(newAsset.category)) {
      newAsset.category = AssetCategory.OTHER_FOREIGN_STOCK;
  }

  if ('region' in newAsset) {
    delete newAsset.region;
  }

  return newAsset as Asset;
};


const App: React.FC = () => {
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const { isSignedIn, googleUser, isInitializing, handleSignIn: hookSignIn, handleSignOut: hookSignOut, loadFromGoogleDrive: hookLoadFromGoogleDrive, autoSave: hookAutoSave } = useGoogleDriveSync({ onError: setError, onSuccessMessage: setSuccessMessage });

  useEffect(() => {}, []);

  const loadFromGoogleDrive = useCallback(async () => {
    try {
      const loaded = await hookLoadFromGoogleDrive();
      if (loaded) {
        const data = runMigrationIfNeeded(loaded);
        const driveAssets = Array.isArray(data.assets) ? data.assets.map(mapToNewAssetStructure) : [];
        setAssets(driveAssets);
        if (Array.isArray(data.portfolioHistory)) {
          setPortfolioHistory(data.portfolioHistory);
        } else {
          setPortfolioHistory([]);
        }
        if (Array.isArray(data.sellHistory)) {
          setSellHistory(data.sellHistory);
        } else {
          setSellHistory([]);
        }
        if (Array.isArray(data.watchlist)) {
          setWatchlist(data.watchlist);
        } else {
          setWatchlist([]);
        }
        if (data.exchangeRates) {
          // 환율 정보가 유효한지 확인하고 기본값 설정
          const rates = data.exchangeRates;
          if (!rates.USD || rates.USD < 100) rates.USD = 1450;
          if (!rates.JPY || rates.JPY < 1) rates.JPY = 9.5;
          setExchangeRates(rates);
        } else {
           setExchangeRates({ USD: 1450, JPY: 9.5 });
        }
        setSuccessMessage('Google Drive에서 포트폴리오를 불러왔습니다.');
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        setAssets([]);
        setPortfolioHistory([]);
        setSellHistory([]);
        setWatchlist([]);
        setSuccessMessage('Google Drive에 저장된 포트폴리오가 없습니다. 자산을 추가해주세요.');
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (error: any) {
      console.error('Failed to load from Google Drive:', error);
      const message = error?.message ? error.message : '';
      setError(`Google Drive에서 데이터를 불러오지 못했습니다.${message ? ` (${message})` : ''}`);
      setTimeout(() => setError(null), 3000);
    }
  }, []);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioSnapshot[]>([]);
  const [sellHistory, setSellHistory] = useState<SellRecord[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRates>({ USD: 1450, JPY: 9.5 }); // 기본값 설정
  const [hasAutoUpdated, setHasAutoUpdated] = useState<boolean>(false);

  useEffect(() => {
    if (isInitializing) return;
    if (isSignedIn) {
      setHasAutoUpdated(false);
      loadFromGoogleDrive();
    } else {
      setAssets([]);
      setPortfolioHistory([]);
      setSellHistory([]);
      setHasAutoUpdated(false);
    }
  }, [isInitializing, isSignedIn, loadFromGoogleDrive]);

  const [fileName, setFileName] = useState<string>('portfolio.json');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isWatchlistLoading, setIsWatchlistLoading] = useState<boolean>(false);
  
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [sellingAsset, setSellingAsset] = useState<Asset | null>(null);
  const [isBulkUploadModalOpen, setIsBulkUploadModalOpen] = useState<boolean>(false);
  const [isAddAssetModalOpen, setIsAddAssetModalOpen] = useState<boolean>(false);
  const [sellAlertDropRate, setSellAlertDropRate] = useState<number>(15);
  const [filterCategory, setFilterCategory] = useState<AssetCategory | 'ALL'>('ALL');
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [dashboardFilterCategory, setDashboardFilterCategory] = useState<AssetCategory | 'ALL'>('ALL');
  const [isAssistantOpen, setIsAssistantOpen] = useState<boolean>(false);
  const [filterAlerts, setFilterAlerts] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(false);
  const [updateLastModified, setUpdateLastModified] = useState<string | null>(null);
  const [versionInfo, setVersionInfo] = useState<{ commit?: string; buildTime?: string } | null>(null);
  const [failedAssetIds, setFailedAssetIds] = useState<Set<string>>(new Set());
  const categoryOptions = useMemo(() => {
    const extras = Array.from(new Set(assets.map(asset => asset.category))).filter(
      (cat) => !ALLOWED_CATEGORIES.includes(cat)
    );
    return [...ALLOWED_CATEGORIES, ...extras];
  }, [assets]);
  const showExchangeRateWarning = useMemo(() => {
    const hasUSD = assets.some(a => a.currency === Currency.USD);
    const hasJPY = assets.some(a => a.currency === Currency.JPY);
    return (hasUSD && (!exchangeRates.USD || exchangeRates.USD < 100)) || (hasJPY && (!exchangeRates.JPY || exchangeRates.JPY < 1));
  }, [assets, exchangeRates]);
  

  useEffect(() => {
    const checkForUpdate = async () => {
      try {
        const res = await fetch('metadata.json', { cache: 'no-store' });
        if (!res.ok) return;
        const lm = res.headers.get('last-modified');
        if (lm) {
          const prev = localStorage.getItem('app.lastModified');
          if (prev && prev !== lm) {
            setUpdateAvailable(true);
            setUpdateLastModified(lm);
          }
          localStorage.setItem('app.lastModified', lm);
        }
        try {
          const data = await res.clone().json();
          const commit = typeof data?.commit === 'string' ? data.commit : undefined;
          const buildTime = typeof data?.buildTime === 'string' ? data.buildTime : undefined;
          setVersionInfo({ commit, buildTime });
        } catch {}
      } catch {}
    };
    checkForUpdate();
  }, []);
  
  const handleExchangeRatesChange = useCallback((newRates: ExchangeRates) => {
    setExchangeRates(newRates);
    if (isSignedIn) {
      hookAutoSave(assets, portfolioHistory, sellHistory, watchlist, newRates);
    }
  }, [assets, portfolioHistory, sellHistory, isSignedIn, hookAutoSave, watchlist]);

  const handleRefreshAllPrices = useCallback(async (isAutoUpdate = false, isScheduled = false) => {
    if (assets.length === 0) return;
    
    setIsLoading(true);
    setError(null);
    setFailedAssetIds(new Set());
    console.log('handleRefreshAllPrices start', { totalAssets: assets.length, isAutoUpdate, isScheduled });
    
    if (isAutoUpdate || isScheduled) {
        setSuccessMessage('최신 종가 정보를 불러오는 중입니다...');
    } else {
        setSuccessMessage(null);
    }

    // [중요 변경점 1] 최신 환율을 먼저 가져와서 상태를 업데이트합니다.
    // 환율 정보가 정확해야 이후 자산 가치 계산(원화 환산 정렬 등)이 맞습니다.
    try {
        const [usdRate, jpyRate] = await Promise.all([
            fetchExchangeRate(),
            fetchExchangeRateJPY()
        ]);
        setExchangeRates(prev => ({
            ...prev,
            USD: usdRate > 1000 ? usdRate : prev.USD,
            JPY: jpyRate > 5 ? jpyRate : prev.JPY
        }));
    } catch (e) {
        console.warn("환율 업데이트 실패, 기존 값 사용", e);
    }

    // 자산 분류 (현금 vs 비현금)
    const cashAssets = assets.filter(a => a.category === AssetCategory.CASH);
    const nonCashAssets = assets.filter(a => a.category !== AssetCategory.CASH);

    // 현금 자산 업데이트 로직
    const cashPromises = cashAssets.map(asset => 
      (asset.currency === Currency.USD 
        ? fetchExchangeRate() 
        : asset.currency === Currency.JPY 
          ? fetchExchangeRateJPY() 
          : fetchCurrentExchangeRate(asset.currency, Currency.KRW)
      ).then(rate => ({
        id: asset.id,
        name: `현금 (${asset.currency})`,
        priceKRW: rate * asset.priceOriginal,
        priceOriginal: asset.priceOriginal,
        currency: asset.currency,
        pricePreviousClose: rate * asset.priceOriginal,
      }))
    );

    // 일반 자산 업데이트 로직
    const assetsToFetch = nonCashAssets.map(a => ({
      ticker: a.ticker,
      exchange: a.exchange,
      id: a.id,
      category: a.category,
      currency: a.currency,
    }));
    console.log('handleRefreshAllPrices batch payload', assetsToFetch);

    try {
      const [cashResults, batchPriceMap] = await Promise.all([
        Promise.allSettled(cashPromises),
        fetchBatchAssetPricesNew(assetsToFetch)
      ]);
      console.log('handleRefreshAllPrices cashResults', cashResults);
      console.log('handleRefreshAllPrices batchPriceMap size', batchPriceMap.size);

      const failedTickers: string[] = [];
      const failedIds: string[] = [];

      const updatedAssets = assets.map((asset) => {
        // 1. 현금 자산 처리
        if (asset.category === AssetCategory.CASH) {
          const cashIdx = cashAssets.findIndex(ca => ca.id === asset.id);
          const result = cashResults[cashIdx];
          
          if (result && result.status === 'fulfilled') {
            const data = result.value;
            return {
              ...asset,
              yesterdayPrice: data.pricePreviousClose,
              currentPrice: data.priceKRW,
              priceOriginal: data.priceOriginal,
              currency: data.currency as Currency,
              highestPrice: Math.max(asset.highestPrice, data.priceOriginal),
            };
          }
          failedTickers.push(asset.ticker);
          failedIds.push(asset.id);
          return asset;
        }

        // 2. 일반 자산 처리
        const priceData = batchPriceMap.get(asset.id);
        if (priceData && !priceData.isMocked) {
          const shouldKeepOriginalCurrency = asset.category === AssetCategory.CRYPTOCURRENCY;
          const newCurrency = shouldKeepOriginalCurrency ? asset.currency : (priceData.currency as Currency);
          
          let newCurrentPrice = asset.currency === Currency.KRW 
            ? priceData.priceKRW 
            : priceData.priceOriginal;
          if (asset.category === AssetCategory.CRYPTOCURRENCY && asset.currency === Currency.KRW) {
            const usdRate = exchangeRates.USD || 0;
            if (usdRate > 0) {
              newCurrentPrice = priceData.priceOriginal * usdRate;
            }
          }
          
          // [중요 변경점 2] KRW 자산 단위 오류 자동 보정 로직
          let newYesterdayPrice = priceData.pricePreviousClose;
          
          if (asset.currency === Currency.KRW && newYesterdayPrice > 0) {
             const ratio = newCurrentPrice / newYesterdayPrice;
             // 가격 차이가 50배 이상 나거나 0.02배 이하일 때 (단위 오류 의심 시) 보정
             if (ratio > 50 || ratio < 0.02) {
                 const impliedRate = priceData.priceOriginal > 0 ? (priceData.priceKRW / priceData.priceOriginal) : 1450;
                 if (ratio > 50) {
                    newYesterdayPrice = newYesterdayPrice * impliedRate;
                 }
             }
          }

          return {
            ...asset,
            yesterdayPrice: newYesterdayPrice,
            currentPrice: newCurrentPrice,
            currency: newCurrency,
            highestPrice: Math.max(asset.highestPrice, newCurrentPrice),
          };
        } else {
          // 실패 시
          console.error(`Failed to refresh price for ${asset.ticker}`);
          failedTickers.push(asset.ticker);
          failedIds.push(asset.id);
          return asset;
        }
      });

      setAssets(updatedAssets);
      setFailedAssetIds(new Set(failedIds));

      const successCount = assets.length - failedIds.length;
      const failedCount = failedIds.length;
      console.log('handleRefreshAllPrices done', { successCount, failedCount, failedTickers });

      if (failedTickers.length > 0) {
        setError(`실패 종목: ${failedTickers.join(', ')}`);
        setTimeout(() => setError(null), 5000);
      }

      const msg = `${successCount}건 성공, ${failedCount}건 실패`;
      setSuccessMessage(msg);
      setTimeout(() => setSuccessMessage(null), 5000);
      
      if (isSignedIn) {
        hookAutoSave(updatedAssets, portfolioHistory, sellHistory, watchlist, exchangeRates);
      }
    } catch (error) {
      console.error('Price refresh failed:', error);
      setError('가격 업데이트 중 오류가 발생했습니다.');
      setTimeout(() => setError(null), 3000);
    }

    setIsLoading(false);
  }, [assets, portfolioHistory, sellHistory, hookAutoSave, isSignedIn, watchlist, exchangeRates]);

 const handleRefreshSelectedPrices = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    
    setIsLoading(true);
    setError(null);

    const idSet = new Set(ids);
    const targetAssets = assets.filter(a => idSet.has(a.id));
    
    // 현금과 비현금 자산 분리
    const cashAssets = targetAssets.filter(a => a.category === AssetCategory.CASH);
    const nonCashAssets = targetAssets.filter(a => a.category !== AssetCategory.CASH);
    
    // 현금 자산 환율 업데이트 준비
    const cashPromises = cashAssets.map(asset => 
      (asset.currency === Currency.USD 
        ? fetchExchangeRate() 
        : asset.currency === Currency.JPY 
          ? fetchExchangeRateJPY() 
          : fetchCurrentExchangeRate(asset.currency, Currency.KRW)
      ).then(rate => ({
        id: asset.id, 
        priceKRW: rate * asset.priceOriginal, 
        priceOriginal: asset.priceOriginal, 
        currency: asset.currency, 
        pricePreviousClose: rate * asset.priceOriginal
      }))
    );

    // 일반 자산 가격 업데이트 준비
    const itemsToFetch = nonCashAssets.map(a => ({ 
      ticker: a.ticker, 
      exchange: a.exchange, 
      id: a.id,
      category: a.category,
      currency: a.currency,
    }));

    try {
      const [cashResults, batchPriceMap] = await Promise.all([
        Promise.allSettled(cashPromises),
        fetchBatchAssetPricesNew(itemsToFetch)
      ]);

      const updatedAssets = assets.map((asset) => {
          // 선택되지 않은 자산은 그대로 유지
          if (!idSet.has(asset.id)) return asset;

          // 1. 현금 자산 업데이트
          if (asset.category === AssetCategory.CASH) {
            const cashIdx = cashAssets.findIndex(ca => ca.id === asset.id);
            const result = cashResults[cashIdx];
            if (result && result.status === 'fulfilled') {
                const data = result.value;
                return { 
                  ...asset, 
                  yesterdayPrice: data.pricePreviousClose, 
                  currentPrice: data.priceKRW, 
                  priceOriginal: data.priceOriginal, 
                  currency: data.currency as Currency, 
                  highestPrice: Math.max(asset.highestPrice, data.priceOriginal) 
                };
            }
            return asset;
          }

          // 2. 일반 자산 업데이트
          const priceData = batchPriceMap.get(asset.id);
          if (priceData && !priceData.isMocked) {
            const shouldKeepOriginalCurrency = asset.category === AssetCategory.CRYPTOCURRENCY;
            const newCurrency = shouldKeepOriginalCurrency ? asset.currency : (priceData.currency as Currency);
            
            let newCurrentPrice = asset.currency === Currency.KRW ? priceData.priceKRW : priceData.priceOriginal;
            if (asset.category === AssetCategory.CRYPTOCURRENCY && asset.currency === Currency.KRW) {
              const usdRate = exchangeRates.USD || 0;
              if (usdRate > 0) {
                newCurrentPrice = priceData.priceOriginal * usdRate;
              }
            }
            
            // KRW 단위 오류 보정 로직 (handleRefreshAllPrices와 동일)
            let newYesterdayPrice = priceData.pricePreviousClose;
            if (asset.currency === Currency.KRW && newYesterdayPrice > 0) {
                  const ratio = newCurrentPrice / newYesterdayPrice;
                  if (ratio > 50 || ratio < 0.02) {
                      const impliedRate = priceData.priceOriginal > 0 ? (priceData.priceKRW / priceData.priceOriginal) : 1450;
                      if (ratio > 50) newYesterdayPrice = newYesterdayPrice * impliedRate;
                  }
            }

            return { 
              ...asset, 
              yesterdayPrice: newYesterdayPrice, 
              currentPrice: newCurrentPrice, 
              currency: newCurrency, 
              highestPrice: Math.max(asset.highestPrice, newCurrentPrice) 
            };
          }
          
          return asset;
      });

      setAssets(updatedAssets);
      setSuccessMessage('선택한 자산 업데이트 완료'); 
      setTimeout(() => setSuccessMessage(null), 3000);
      
      if (isSignedIn) {
        hookAutoSave(updatedAssets, portfolioHistory, sellHistory, watchlist, exchangeRates);
      }
    } catch (error) { 
      console.error('Selected update failed:', error);
      setError('선택한 항목 업데이트 중 오류가 발생했습니다.'); 
      setTimeout(() => setError(null), 3000); 
    } finally {
      setIsLoading(false);
    }
  }, [assets, hookAutoSave, portfolioHistory, sellHistory, isSignedIn, watchlist, exchangeRates]);

  const handleRefreshOnePrice = useCallback(async (assetId: string) => {
    const target = assets.find(a => a.id === assetId);
    if (!target) return;
    setIsLoading(true);
    setError(null);
    try {
      const d = await fetchAssetDataNew({ ticker: target.ticker, exchange: target.exchange, category: target.category, currency: target.currency });
      
      const shouldKeepOriginalCurrency = target.category === AssetCategory.CRYPTOCURRENCY;
      const newCurrency = shouldKeepOriginalCurrency ? target.currency : (d.currency as Currency);
      
      let newCurrentPrice = target.currency === Currency.KRW 
        ? d.priceKRW 
        : d.priceOriginal;
      if (target.category === AssetCategory.CRYPTOCURRENCY && target.currency === Currency.KRW) {
        const usdRate = exchangeRates.USD || 0;
        if (usdRate > 0) {
          newCurrentPrice = d.priceOriginal * usdRate;
        }
      }
      
      const updated = assets.map(a => a.id === assetId ? {
        ...a,
        yesterdayPrice: d.pricePreviousClose,
        currentPrice: newCurrentPrice,
        currency: newCurrency,
        highestPrice: Math.max(a.highestPrice, newCurrentPrice),
      } : a);
      setAssets(updated);
      if (isSignedIn) {
        hookAutoSave(updated, portfolioHistory, sellHistory, watchlist, exchangeRates);
      }
    } catch (e) {
      setError('해당 종목 가격 갱신에 실패했습니다.');
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  }, [assets, hookAutoSave, portfolioHistory, sellHistory, watchlist, exchangeRates]);


useEffect(() => {
    const updatePortfolioHistory = () => {
      if (assets.length === 0) return;

      const today = new Date().toISOString().slice(0, 10);
      
      const newAssetSnapshots: AssetSnapshot[] = assets.map(asset => {
        let currentValueKRW = 0;
        // [중요] 원화 환산 단가 계산 (차트용)
        let unitPriceKRW = 0;
        
        const rate = (asset.currency !== Currency.KRW) ? (exchangeRates[asset.currency] || 0) : 1;
        
        currentValueKRW = asset.currentPrice * asset.quantity * rate;
        unitPriceKRW = asset.currentPrice * rate; // 1주당 현재가(원화)

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
          name: (asset.customName?.trim() || asset.name),
          currentValue: currentValueKRW,
          purchaseValue: purchaseValueKRW,
          unitPrice: unitPriceKRW, // [추가] 중요: 단가 기록 (이 값이 있어야 차트가 정확히 나옵니다)
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
          // 오늘 데이터가 이미 있으면 갱신
          updatedHistory = [...prevHistory];
          updatedHistory[todayIndex] = newSnapshot;
        } else {
          // 없으면 추가
          updatedHistory = [...prevHistory, newSnapshot];
        }
        
        // 최근 365일 데이터만 유지
        if (updatedHistory.length > 365) {
            updatedHistory = updatedHistory.slice(updatedHistory.length - 365);
        }

        return updatedHistory;
      });
    };
    
    // 자산 정보나 환율이 변경될 때마다 히스토리(오늘자 데이터)를 갱신
    updatePortfolioHistory();
  }, [assets, exchangeRates]);

  const filteredAssets = useMemo(() => {
    let filtered = assets;
    if (filterCategory !== 'ALL') {
      filtered = filtered.filter(asset => asset.category === filterCategory);
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(asset => 
        ((asset.customName?.toLowerCase() || asset.name.toLowerCase()).includes(query)) ||
        asset.ticker.toLowerCase().includes(query) ||
        (asset.memo && asset.memo.toLowerCase().includes(query))
      );
    }
    return filtered;
  }, [assets, filterCategory, searchQuery]);

  const handleSaveAssets = useCallback(async () => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 저장할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const exportData = {
        assets: assets,
        portfolioHistory: portfolioHistory,
        sellHistory: sellHistory,
        exchangeRates,
        lastUpdateDate: new Date().toISOString().slice(0, 10)
      };
      const portfolioJSON = JSON.stringify(exportData, null, 2);
      await googleDriveService.saveFile(portfolioJSON);
      setSuccessMessage('포트폴리오가 Google Drive에 성공적으로 저장되었습니다.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (e: any) {
      const errorMsg = 'Google Drive 저장에 실패했습니다. 네트워크 연결을 확인해주세요.';
      setError(errorMsg);
      setTimeout(() => setError(null), 3000);
    }
    setIsLoading(false);
  }, [assets, portfolioHistory, isSignedIn, exchangeRates]);

  const handleExportAssetsToFile = useCallback(async () => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 내보내기 기능을 사용할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);

    const exportData = {
      assets: assets,
      portfolioHistory: portfolioHistory,
      sellHistory: sellHistory,
      exchangeRates,
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
  }, [assets, portfolioHistory, fileName, isSignedIn, exchangeRates]);

  const handleImportAssetsFromFile = useCallback(async () => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 가져오기 기능을 사용할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }
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
            let loadedSellHistory: SellRecord[] | undefined;
            let loadedWatchlist: WatchlistItem[] | undefined;

            if (Array.isArray(loadedData)) {
              loadedAssets = loadedData;
            } else if (loadedData && typeof loadedData === 'object' && Array.isArray(loadedData.assets)) {
              loadedAssets = loadedData.assets;
              if (Array.isArray(loadedData.portfolioHistory)) {
                loadedHistory = loadedData.portfolioHistory;
              }
              if (Array.isArray(loadedData.sellHistory)) {
                loadedSellHistory = loadedData.sellHistory;
              }
              if (Array.isArray(loadedData.watchlist)) {
                loadedWatchlist = loadedData.watchlist;
              }
              if (loadedData.exchangeRates) {
                  setExchangeRates(loadedData.exchangeRates);
              }
            } else {
              throw new Error("Invalid file format.");
            }
            
            const assetsWithDefaults = loadedAssets.map(mapToNewAssetStructure);

            setAssets(assetsWithDefaults);
            if (loadedHistory) {
              setPortfolioHistory(loadedHistory);
            }
            if (loadedSellHistory) {
              setSellHistory(loadedSellHistory);
            } else {
              setSellHistory([]);
            }
            if (loadedWatchlist) {
              setWatchlist(loadedWatchlist);
            } else {
              setWatchlist([]);
            }
            hookAutoSave(assetsWithDefaults, loadedHistory ?? portfolioHistory, loadedSellHistory ?? sellHistory, watchlist, exchangeRates);
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
  }, [hookAutoSave, portfolioHistory, sellHistory, watchlist, exchangeRates, isSignedIn]);


  const handleAddAsset = useCallback(async (newAssetData: NewAssetForm) => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 자산을 추가할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }
    setIsAddAssetModalOpen(false);
    setIsLoading(true);
    setError(null);
    try {
      let newAsset: Omit<Asset, 'id'>;
      if (newAssetData.category === AssetCategory.CASH) {
        const [purchaseExchangeRate, currentExchangeRate] = await Promise.all([
          fetchHistoricalExchangeRate(newAssetData.purchaseDate, newAssetData.currency, Currency.KRW),
          (newAssetData.currency === Currency.USD 
            ? fetchExchangeRate() 
            : newAssetData.currency === Currency.JPY 
              ? fetchExchangeRateJPY() 
              : fetchCurrentExchangeRate(newAssetData.currency, Currency.KRW))
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
        const d = await fetchAssetDataNew({ ticker: newAssetData.ticker, exchange: newAssetData.exchange, category: newAssetData.category, currency: newAssetData.currency });
        const purchaseExchangeRate = await fetchHistoricalExchangeRate(newAssetData.purchaseDate, newAssetData.currency, Currency.KRW);
        const currentPrice = newAssetData.currency === Currency.KRW ? d.priceKRW : d.priceOriginal;
        newAsset = {
          ...newAssetData,
          name: d.name,
          currentPrice,
          priceOriginal: d.priceOriginal,
          highestPrice: currentPrice,
          purchaseExchangeRate,
          currency: (d.currency as Currency) || newAssetData.currency,
        };
      }
      
      const finalNewAsset: Asset = {
        id: new Date().getTime().toString(),
        ...newAsset
      };

      setAssets(prevAssets => {
        const newAssets = [...prevAssets, finalNewAsset];
        hookAutoSave(newAssets, portfolioHistory, sellHistory, watchlist, exchangeRates);
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
  }, [hookAutoSave, portfolioHistory, sellHistory, watchlist, exchangeRates, isSignedIn]);
  
  const handleDeleteAsset = useCallback((assetId: string) => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 자산을 삭제할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }
    setAssets(prevAssets => {
      const updated = prevAssets.filter(asset => asset.id !== assetId);
      hookAutoSave(updated, portfolioHistory, sellHistory, watchlist, exchangeRates);
      return updated;
    });
    setEditingAsset(null);
  }, [hookAutoSave, portfolioHistory, sellHistory, watchlist, exchangeRates, isSignedIn]);

  const handleEditAsset = useCallback((asset: Asset) => {
    setEditingAsset(asset);
  }, []);

  const handleCloseEditModal = useCallback(() => {
    setEditingAsset(null);
  }, []);

  const handleSellAsset = useCallback((asset: Asset) => {
    setSellingAsset(asset);
  }, []);

  const handleCloseSellModal = useCallback(() => {
    setSellingAsset(null);
  }, []);

  const handleConfirmSell = useCallback(async (
    assetId: string,
    sellDate: string,
    sellPrice: number,
    sellQuantity: number,
    currency: Currency
  ) => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 매도할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const updatedAssets = assets.map(a => {
        if (a.id === assetId) {
          const sellTransaction = {
            id: `${assetId}-${Date.now()}`,
            sellDate,
            sellPrice,
            sellQuantity,
            currency,
          };

          const updatedAsset: Asset = {
            ...a,
            quantity: a.quantity - sellQuantity,
            sellTransactions: [...(a.sellTransactions || []), sellTransaction],
          };

          const record: SellRecord = {
            assetId: a.id,
            ticker: a.ticker,
            name: a.name,
            category: a.category,
            ...sellTransaction,
          };
          setSellHistory(prev => [...prev, record]);

          return updatedAsset.quantity <= 0 ? null : updatedAsset;
        }
        return a;
      }).filter((a): a is Asset => a !== null);

      setAssets(updatedAssets);
      setSellingAsset(null);
      setSuccessMessage('매도가 완료되었습니다.');
      setTimeout(() => setSuccessMessage(null), 3000);
      
      hookAutoSave(updatedAssets, portfolioHistory, sellHistory, watchlist, exchangeRates);
    } catch (error) {
      console.error('Failed to sell asset:', error);
      setError('매도 처리 중 오류가 발생했습니다.');
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  }, [assets, hookAutoSave, portfolioHistory, sellHistory, watchlist, exchangeRates, isSignedIn]);

  const handleUpdateAsset = useCallback(async (updatedAsset: Asset) => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 자산을 수정할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }
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
                  (updatedAsset.currency === Currency.USD 
                    ? fetchExchangeRate() 
                    : updatedAsset.currency === Currency.JPY 
                      ? fetchExchangeRateJPY() 
                      : fetchCurrentExchangeRate(updatedAsset.currency, Currency.KRW))
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
            const d = await fetchAssetDataNew({ ticker: updatedAsset.ticker, exchange: updatedAsset.exchange, category: updatedAsset.category, currency: updatedAsset.currency });
            const newCurrentPrice = finalAsset.currency === Currency.KRW ? d.priceKRW : d.priceOriginal;
            finalAsset = {
              ...finalAsset,
              name: d.name,
              currentPrice: newCurrentPrice,
              priceOriginal: d.priceOriginal,
              currency: (d.currency as Currency) || finalAsset.currency,
              highestPrice: Math.max(finalAsset.highestPrice, newCurrentPrice),
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
          hookAutoSave(updated, portfolioHistory, sellHistory, watchlist, exchangeRates);
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
  }, [assets, hookAutoSave, portfolioHistory, sellHistory, watchlist, exchangeRates, isSignedIn]);
  
  const handleCsvFileUpload = useCallback(async (file: File): Promise<BulkUploadResult> => {
    if (!isSignedIn) {
      return {
        successCount: 0,
        failedCount: 0,
        errors: [{ ticker: '권한 없음', reason: 'Google Drive 로그인 후 이용해주세요.' }]
      };
    }
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
                    
                    if (!ticker) return { error: '티커가 비어있습니다.', ticker: `행 ${index + 2}` };
                    if (!exchange) return { error: '거래소가 비어있습니다.', ticker: `행 ${index + 2}` };
                    if (isNaN(parseFloat(quantityStr)) || parseFloat(quantityStr) <= 0) return { error: '수량이 유효한 숫자가 아닙니다.', ticker };
                    if (isNaN(parseFloat(priceStr)) || parseFloat(priceStr) < 0) return { error: '매수가가 유효한 숫자가 아닙니다.', ticker };
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { error: '날짜 형식이 YYYY-MM-DD가 아닙니다.', ticker };
                    if (!ALLOWED_CATEGORIES.includes(categoryStr as AssetCategory)) return { error: '유효하지 않은 자산 구분입니다.', ticker };
                    if (!Object.values(Currency).includes(currencyStr as Currency)) return { error: '유효하지 않은 통화입니다.', ticker };
                    
                    const form: NewAssetForm & { sellAlertDropRate?: number } = {
                        ticker,
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
                              const d = await fetchAssetDataNew({ ticker: form.ticker, exchange: form.exchange, category: form.category, currency: form.currency });
                              const purchaseExchangeRate = await fetchHistoricalExchangeRate(form.purchaseDate, form.currency, Currency.KRW);
                              {
                                  const currentPrice = form.currency === Currency.KRW ? d.priceKRW : d.priceOriginal;
                                  newAsset = {
                                      ...form,
                                      name: d.name,
                                      currentPrice,
                                      priceOriginal: d.priceOriginal,
                                      currency: (d.currency as Currency) || form.currency,
                                      highestPrice: currentPrice,
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
                        hookAutoSave(updated, portfolioHistory, sellHistory, watchlist, exchangeRates);
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
  }, [hookAutoSave, portfolioHistory, sellHistory, watchlist, exchangeRates, isSignedIn]);

  const getValueInKRW = useCallback((value: number, currency: Currency): number => {
    if (currency === Currency.KRW) return value;
    
    // 환율 정보가 있으면 쓰고, 없으면 0으로 처리 (대시보드 입력값 우선)
    const rate = exchangeRates[currency] || 0;
    return value * rate;
  }, [exchangeRates]);
  const totalValue = useMemo(() => {
    return assets.reduce((acc, asset) => {
      const v = asset.currentPrice * asset.quantity;
      return acc + getValueInKRW(v, asset.currency);
    }, 0);
  }, [assets, getValueInKRW]);

  const totalPurchaseValue = useMemo(() => {
    return assets.reduce((acc, asset) => {
      const v = asset.purchasePrice * asset.quantity;
      return acc + getValueInKRW(v, asset.currency);
    }, 0);
  }, [assets, getValueInKRW]);
  
  const formatCurrencyKRW = (value: number) => {
    return value.toLocaleString('ko-KR', { 
        style: 'currency', 
        currency: 'KRW', 
        maximumFractionDigits: 0 
    });
  };

  const dashboardFilteredAssets = useMemo(() => {
      if (dashboardFilterCategory === 'ALL') {
          return assets;
      }
      return assets.filter(asset => asset.category === dashboardFilterCategory);
  }, [assets, dashboardFilterCategory]);

  const dashboardTotalValue = useMemo(() => {
      return dashboardFilteredAssets.reduce((acc, asset) => {
        const v = asset.currentPrice * asset.quantity;
        return acc + getValueInKRW(v, asset.currency);
      }, 0);
  }, [dashboardFilteredAssets, getValueInKRW]);

  const dashboardTotalPurchaseValue = useMemo(() => {
      return dashboardFilteredAssets.reduce((acc, asset) => {
        const v = asset.purchasePrice * asset.quantity;
        return acc + getValueInKRW(v, asset.currency);
      }, 0);
  }, [dashboardFilteredAssets, getValueInKRW]);

  const dashboardTotalGainLoss = dashboardTotalValue - dashboardTotalPurchaseValue;
  const dashboardTotalReturn = dashboardTotalPurchaseValue === 0 ? 0 : (dashboardTotalGainLoss / dashboardTotalPurchaseValue) * 100;
  
  const soldAssetsStats = useMemo(() => {
    let totalSoldAmount = 0;
    let totalSoldPurchaseValue = 0;
    let totalSoldProfit = 0;
    let soldCount = 0;

    assets.forEach(asset => {
      if (asset.sellTransactions && asset.sellTransactions.length > 0) {
        asset.sellTransactions.forEach(transaction => {
          totalSoldAmount += transaction.sellPrice * transaction.sellQuantity;
          soldCount += 1;
          
          let purchaseValueForSold: number;
          if (asset.currency === Currency.KRW) {
            purchaseValueForSold = asset.purchasePrice * transaction.sellQuantity;
          } else if (asset.purchaseExchangeRate) {
            purchaseValueForSold = asset.purchasePrice * asset.purchaseExchangeRate * transaction.sellQuantity;
          } else if (asset.priceOriginal > 0) {
            const exchangeRate = asset.currentPrice / asset.priceOriginal;
            purchaseValueForSold = asset.purchasePrice * exchangeRate * transaction.sellQuantity;
          } else {
            purchaseValueForSold = asset.purchasePrice * transaction.sellQuantity;
          }
          totalSoldPurchaseValue += purchaseValueForSold;
        });
      }
    });

    totalSoldProfit = totalSoldAmount - totalSoldPurchaseValue;
    const soldReturn = totalSoldPurchaseValue === 0 ? 0 : (totalSoldProfit / totalSoldPurchaseValue) * 100;

    return {
      totalSoldAmount,
      totalSoldPurchaseValue,
      totalSoldProfit,
      soldReturn,
      soldCount,
    };
  }, [assets]);
  
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
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 내보내기 기능을 사용할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }
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
            // [수정] CSV 내보내기 시 하드코딩된 환율 제거 및 대시보드 값 적용
            let currentPriceKRW = 0;
            let currentValueKRW = 0;
            
            // [변경] exchangeRates 상태값 그대로 사용 (없으면 0)
            let rate = 1;
            if (asset.currency !== Currency.KRW) {
                rate = exchangeRates[asset.currency] || 0;
            }

            if (asset.currency === Currency.KRW) {
                currentPriceKRW = asset.currentPrice;
                currentValueKRW = asset.currentPrice * asset.quantity;
            } else {
                currentPriceKRW = asset.currentPrice * rate;
                currentValueKRW = asset.currentPrice * asset.quantity * rate;
            }
            
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
            
            const profitLoss = currentValueKRW - purchaseValueKRW;
            const returnPercentage = purchaseValueKRW === 0 ? 0 : (profitLoss / purchaseValueKRW) * 100;
            
            const escapeCsvCell = (cell: any) => {
                const cellStr = String(cell);
                if (cellStr.includes(',')) {
                    return `"${cellStr}"`;
                }
                return cellStr;
            };

            return [
                escapeCsvCell(asset.customName ?? asset.name),
                escapeCsvCell(asset.ticker),
                escapeCsvCell(asset.exchange),
                escapeCsvCell(asset.category),
                asset.quantity,
                asset.purchasePrice,
                asset.purchaseExchangeRate || 1,
                Math.round(purchaseValueKRW),
                Math.round(currentPriceKRW),    // [수정] 환율 적용된 원화 단가 사용
                Math.round(currentValueKRW),    // [수정] 환율 적용된 총액 사용
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
  }, [assets, isSignedIn, exchangeRates]);

  // (이하 나머지 코드는 동일하게 유지...)
  const handleAddWatchItem = useCallback((payload: Omit<WatchlistItem, 'id' | 'currentPrice' | 'priceOriginal' | 'currency' | 'yesterdayPrice' | 'highestPrice' | 'lastSignalAt' | 'lastSignalType'>) => {
    const id = `${Date.now()}`;
    const item: WatchlistItem = { ...payload, id } as WatchlistItem;
    setWatchlist(prev => {
      const exists = prev.some(w => w.ticker.toUpperCase() === item.ticker.toUpperCase() && normalizeExchange(w.exchange) === normalizeExchange(item.exchange));
      const next = exists ? prev : [...prev, item];
      hookAutoSave(assets, portfolioHistory, sellHistory, watchlist, exchangeRates);
      return next;
    });
  }, [assets, portfolioHistory, sellHistory, hookAutoSave, watchlist, exchangeRates]);

  const handleUpdateWatchItem = useCallback((item: WatchlistItem) => {
    setWatchlist(prev => {
      const next = prev.map(w => (w.id === item.id ? item : w));
      hookAutoSave(assets, portfolioHistory, sellHistory, watchlist, exchangeRates);
      return next;
    });
  }, [assets, portfolioHistory, sellHistory, hookAutoSave, watchlist, exchangeRates]);

  const handleDeleteWatchItem = useCallback((id: string) => {
    setWatchlist(prev => {
      const next = prev.filter(w => w.id !== id);
      hookAutoSave(assets, portfolioHistory, sellHistory, watchlist, exchangeRates);
      return next;
    });
  }, [assets, portfolioHistory, sellHistory, hookAutoSave, watchlist, exchangeRates]);

  const handleBulkDeleteWatchItems = useCallback((ids: string[]) => {
    setWatchlist(prev => {
      const remove = new Set(ids);
      const next = prev.filter(w => !remove.has(w.id));
      hookAutoSave(assets, portfolioHistory, sellHistory, watchlist, exchangeRates);
      return next;
    });
  }, [assets, portfolioHistory, sellHistory, hookAutoSave, watchlist, exchangeRates]);

  const handleAddAssetsToWatchlist = useCallback((selectedAssets: Asset[]) => {
    if (selectedAssets.length === 0) return;
    setWatchlist(prev => {
      const next = [...prev];
      selectedAssets.forEach(a => {
        const exists = next.some(w => w.ticker.toUpperCase() === a.ticker.toUpperCase() && normalizeExchange(w.exchange) === normalizeExchange(a.exchange));
        if (!exists) {
          next.push({
            id: `${Date.now()}-${a.id}`,
            ticker: a.ticker,
            exchange: a.exchange,
            name: a.customName?.trim() || a.name,
            category: a.category,
            monitoringEnabled: true,
          });
        }
      });
      hookAutoSave(assets, portfolioHistory, sellHistory, watchlist, exchangeRates);
      return next;
    });
  }, [assets, portfolioHistory, sellHistory, hookAutoSave, watchlist, exchangeRates]);

  const handleToggleWatchMonitoring = useCallback((id: string, enabled: boolean) => {
    setWatchlist(prev => prev.map(w => (w.id === id ? { ...w, monitoringEnabled: enabled } : w)));
  }, []);

const handleRefreshWatchlistPrices = useCallback(async () => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 데이터를 갱신할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }
    if (watchlist.length === 0) return;
    setIsWatchlistLoading(true);
    setError(null);

    const itemsToFetch = watchlist.map(item => ({
      ticker: item.ticker,
      exchange: item.exchange,
      id: item.id,
      category: item.category,
      currency: item.currency,
    }));

    const priceMap = await fetchBatchAssetPricesNew(itemsToFetch);

    const updated = watchlist.map((item) => {
      const d = priceMap.get(item.id);
      if (d && !d.isMocked) {
        const newCurrency = item.currency || (d.currency as Currency);
        const newCurrentPrice = item.currency === Currency.KRW 
          ? d.priceKRW 
          : d.priceOriginal;
        const highestPrice = item.highestPrice ? Math.max(item.highestPrice, newCurrentPrice) : newCurrentPrice;
        return {
          ...item,
          currentPrice: newCurrentPrice,
          priceOriginal: d.priceOriginal,
          currency: newCurrency,
          yesterdayPrice: d.pricePreviousClose,
          highestPrice,
        };
      }
      return item;
    });

    setWatchlist(updated);
    hookAutoSave(assets, portfolioHistory, sellHistory, watchlist, exchangeRates);
    setIsWatchlistLoading(false);
  }, [isSignedIn, watchlist, assets, portfolioHistory, sellHistory, hookAutoSave, exchangeRates]);


  const handleSignIn = useCallback(async () => {
    setIsLoading(true);
    setError(null);  

    try {
      await hookSignIn();
    } catch (error: any) {
      console.error('Sign in error:', error);
      setError('로그인에 실패했습니다: ' + (error.message || '알 수 없는 오류'));
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsLoading(false);
    }
  }, [hookSignIn]);

  const handleSignOut = useCallback(() => {
    hookSignOut();
    setAssets([]);
    setPortfolioHistory([]);
    setSellHistory([]);
    setHasAutoUpdated(false);
    
  }, [hookSignOut]);

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
        
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-xl space-y-3 pointer-events-none">
          {updateAvailable && (
            <div className="bg-blue-600 text-white px-4 py-3 rounded-lg shadow-lg flex justify-between items-center pointer-events-auto" role="alert">
              <span className="block sm:inline">새 버전이 배포되었습니다.</span>
              <div className="flex items-center gap-2">
                <button
                  className="ml-2 bg-white/20 hover:bg-white/30 text-white px-3 py-1 rounded transition"
                  onClick={() => {
                    const baseUrl = window.location.href.split('?')[0];
                    window.location.replace(`${baseUrl}?_ts=${Date.now()}`);
                  }}
                  aria-label="업데이트 적용"
                >
                  업데이트 적용
                </button>
                <button
                  className="ml-2 text-white/80 hover:text-white transition"
                  onClick={() => setUpdateAvailable(false)}
                  aria-label="닫기"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
          {successMessage && (
            <div className="bg-success/90 text-white px-4 py-3 rounded-lg shadow-lg flex justify-between items-center pointer-events-auto" role="alert">
              <span className="block sm:inline">{successMessage}</span>
              <button
                className="ml-4 text-white/80 hover:text-white transition"
                onClick={() => setSuccessMessage(null)}
                aria-label="닫기"
              >
                ✕
              </button>
            </div>
          )}
          
          {error && (
            <div className="bg-danger/90 text-white px-4 py-3 rounded-lg shadow-lg flex justify-between items-center pointer-events-auto" role="alert">
              <span className="block sm:inline">{error}</span>
              <button
                className="ml-4 text-white/80 hover:text-white transition"
                onClick={() => setError(null)}
                aria-label="닫기"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {isSignedIn ? (
          <>
            <div className="border-b border-gray-700">
              <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                <TabButton tabId="dashboard" onClick={() => handleTabChange('dashboard')}>대시보드</TabButton>
                <TabButton tabId="portfolio" onClick={() => handleTabChange('portfolio')}>포트폴리오 상세</TabButton>
                <TabButton tabId="analytics" onClick={() => handleTabChange('analytics')}>수익 통계</TabButton>
                <TabButton tabId="watchlist" onClick={() => handleTabChange('watchlist')}>관심종목</TabButton>
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
                                  {categoryOptions.map((cat) => (
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
                  <ExchangeRateInput 
                    rates={exchangeRates} 
                    onRatesChange={handleExchangeRatesChange} 
                    showWarning={showExchangeRateWarning} 
                  />
                   <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                    <StatCard title="총 자산 (원화)" value={formatCurrencyKRW(dashboardTotalValue)} tooltip="선택된 자산의 현재 평가금액 총합입니다." />
                    <StatCard title="투자 원금" value={formatCurrencyKRW(dashboardTotalPurchaseValue)} tooltip="선택된 자산의 총 매수금액 합계입니다." />
                    <StatCard title="총 손익 (원화)" value={formatCurrencyKRW(dashboardTotalGainLoss)} isProfit={dashboardTotalGainLoss >= 0} tooltip="총 평가금액에서 총 매수금액을 뺀 금액입니다."/>
                    <StatCard title="총 수익률" value={`${dashboardTotalReturn.toFixed(2)}%`} isProfit={dashboardTotalReturn >= 0} tooltip="총 손익을 총 매수금액으로 나눈 백분율입니다."/>
                  </div>
                  {soldAssetsStats.soldCount > 0 && (
                    <div className="bg-gray-800 p-6 rounded-lg shadow-lg mb-6">
                      <h3 className="text-xl font-bold text-white mb-4">매도 통계</h3>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <StatCard title="매도 횟수" value={soldAssetsStats.soldCount.toString()} tooltip="총 매도 거래 횟수입니다." size="small" />
                        <StatCard title="매도 금액" value={formatCurrencyKRW(soldAssetsStats.totalSoldAmount)} tooltip="매도된 종목의 총 매도금액입니다." size="small" />
                        <StatCard title="매도 수익" value={formatCurrencyKRW(soldAssetsStats.totalSoldProfit)} isProfit={soldAssetsStats.totalSoldProfit >= 0} tooltip="매도금액에서 매수금액을 뺀 수익입니다." size="small" />
                        <StatCard title="매도 수익률" value={`${soldAssetsStats.soldReturn.toFixed(2)}%`} isProfit={soldAssetsStats.soldReturn >= 0} tooltip="매도 수익을 매수금액으로 나눈 백분율입니다." size="small" />
                      </div>
                    </div>
                  )}
                  <ProfitLossChart history={portfolioHistory} assetsToDisplay={dashboardFilteredAssets} title={profitLossChartTitle} />
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="lg:col-span-1">
                      <AllocationChart assets={assets} exchangeRates={exchangeRates} />
                    </div>
                    <div className="lg:col-span-1">
                       <CategorySummaryTable 
                        assets={assets} 
                        totalPortfolioValue={totalValue} 
                        exchangeRates={exchangeRates} 
                       />
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
                      onRefreshSelected={handleRefreshSelectedPrices}
                      onRefreshOne={handleRefreshOnePrice}
                      onEdit={handleEditAsset}
                      onSell={handleSellAsset}
                      isLoading={isLoading}
                      sellAlertDropRate={sellAlertDropRate}
                      filterCategory={filterCategory}
                      onFilterChange={setFilterCategory}
                      filterAlerts={filterAlerts}
                      onFilterAlertsChange={setFilterAlerts}
                      searchQuery={searchQuery}
                      onSearchChange={setSearchQuery}
                      onAddSelectedToWatchlist={handleAddAssetsToWatchlist}
                      failedIds={failedAssetIds}
                      exchangeRates={exchangeRates}
                    />
                </div>
              )}

              {activeTab === 'analytics' && (
                <SellAnalyticsPage assets={assets} sellHistory={sellHistory} />
              )}
              {activeTab === 'watchlist' && (
                <WatchlistPage
                  watchlist={watchlist}
                  onAdd={(item) => handleAddWatchItem(item)}
                  onUpdate={(item) => handleUpdateWatchItem(item)}
                  onDelete={(id) => handleDeleteWatchItem(id)}
                  onToggleMonitoring={(id, enabled) => handleToggleWatchMonitoring(id, enabled)}
                  onRefreshAll={handleRefreshWatchlistPrices}
                  isLoading={isWatchlistLoading}
                  onBulkDelete={handleBulkDeleteWatchItems}
                />
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
            <SellAssetModal
              asset={sellingAsset}
              isOpen={!!sellingAsset}
              onClose={handleCloseSellModal}
              onSell={handleConfirmSell}
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
          </>
        ) : (
          <div className="mt-12 bg-gray-800 border border-gray-700 rounded-lg p-8 text-center text-gray-200">
            <h2 className="text-2xl font-semibold mb-4">Google Drive 로그인 필요</h2>
            <p className="text-gray-400">
              포트폴리오 데이터는 Google Drive에만 저장됩니다. 상단의 로그인 버튼을 눌러 계정에 연결한 뒤 이용해주세요.
            </p>
          </div>
        )}
      </div>

    </div>
  );
};

export default App;
