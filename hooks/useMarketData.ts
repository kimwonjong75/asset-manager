import { useCallback, useState } from 'react';
import { Asset, AssetCategory, Currency, ExchangeRates, PortfolioSnapshot, SellRecord, WatchlistItem } from '../types';
import { fetchBatchAssetPrices as fetchBatchAssetPricesNew, fetchAssetData as fetchAssetDataNew, fetchExchangeRate, fetchExchangeRateJPY } from '../services/priceService';
import { fetchCurrentExchangeRate } from '../services/geminiService';
import { fetchUpbitPricesBatch } from '../services/upbitService';

interface UseMarketDataProps {
  assets: Asset[];
  setAssets: React.Dispatch<React.SetStateAction<Asset[]>>;
  watchlist: WatchlistItem[];
  setWatchlist: React.Dispatch<React.SetStateAction<WatchlistItem[]>>;
  exchangeRates: ExchangeRates;
  setExchangeRates: React.Dispatch<React.SetStateAction<ExchangeRates>>;
  portfolioHistory: PortfolioSnapshot[];
  sellHistory: SellRecord[];
  triggerAutoSave: (assets: Asset[], history: PortfolioSnapshot[], sells: SellRecord[], watchlist: WatchlistItem[], rates: ExchangeRates) => void;
  setError: (msg: string | null) => void;
  setSuccessMessage: (msg: string | null) => void;
}

// category 인자 제거
const shouldUseUpbitAPI = (exchange: string): boolean => {
  const normalized = (exchange || '').toLowerCase().trim();
  const upbitExchanges = ['upbit', 'bithumb', '주요 거래소 (종합)'];
  return upbitExchanges.some(ex => normalized.includes(ex));
};

export const useMarketData = ({
  assets,
  setAssets,
  watchlist,
  setWatchlist,
  exchangeRates,
  setExchangeRates,
  portfolioHistory,
  sellHistory,
  triggerAutoSave,
  setError,
  setSuccessMessage
}: UseMarketDataProps) => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [failedAssetIds, setFailedAssetIds] = useState<Set<string>>(new Set());

  // 환율 변경 핸들러
  const handleExchangeRatesChange = useCallback((newRates: ExchangeRates) => {
    setExchangeRates(newRates);
    triggerAutoSave(assets, portfolioHistory, sellHistory, watchlist, newRates);
  }, [assets, portfolioHistory, sellHistory, watchlist, triggerAutoSave, setExchangeRates]);

  // 전체 시세 갱신
  const handleRefreshAllPrices = useCallback(async (isAutoUpdate = false, isScheduled = false) => {
    if (assets.length === 0) return;
    
    setIsLoading(true);
    setError(null);
    setFailedAssetIds(new Set());
    
    if (isAutoUpdate || isScheduled) {
        setSuccessMessage('최신 종가 정보를 불러오는 중입니다...');
    } else {
        setSuccessMessage(null);
    }

    // 1. 환율 선 업데이트
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

    // 2. 자산 분류 (현금 / 업비트 / 일반)
    const cashAssets = assets.filter(a => a.category === AssetCategory.CASH);
    const upbitAssets = assets.filter(a => 
      a.category !== AssetCategory.CASH && shouldUseUpbitAPI(a.exchange)
    );
    const generalAssets = assets.filter(a => 
      a.category !== AssetCategory.CASH && !shouldUseUpbitAPI(a.exchange)
    );

    // 3. 현금 자산 업데이트 로직
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
        previousClosePrice: rate * asset.priceOriginal,
      }))
    );

    // 4. 일반 자산 업데이트 로직 (Cloud Run 서버)
    const assetsToFetch = generalAssets.map(a => ({
      ticker: a.ticker,
      exchange: a.exchange,
      id: a.id,
      category: a.category,
      currency: a.currency,
    }));

    // 5. 업비트 자산 업데이트 로직 (업비트 직접 호출)
    const upbitSymbols = upbitAssets.map(a => a.ticker);

    try {
      const [cashResults, batchPriceMap, upbitPriceMap] = await Promise.all([
        Promise.allSettled(cashPromises),
        assetsToFetch.length > 0 ? fetchBatchAssetPricesNew(assetsToFetch) : Promise.resolve(new Map()),
        upbitSymbols.length > 0 ? fetchUpbitPricesBatch(upbitSymbols) : Promise.resolve(new Map())
      ]);

      const failedTickers: string[] = [];
      const failedIds: string[] = [];

      const updatedAssets = assets.map((asset) => {
        // 현금 처리
        if (asset.category === AssetCategory.CASH) {
          const cashIdx = cashAssets.findIndex(ca => ca.id === asset.id);
          const result = cashResults[cashIdx];
          
          if (result && result.status === 'fulfilled') {
            const data = result.value;
            return {
              ...asset,
              previousClosePrice: data.previousClosePrice,
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

        // 업비트 자산 처리
        if (shouldUseUpbitAPI(asset.exchange)) {
          const tickerUpper = asset.ticker.toUpperCase();
          const upbitData = upbitPriceMap.get(tickerUpper) || 
                           upbitPriceMap.get(`KRW-${tickerUpper}`);
          
          if (upbitData) {
            const newCurrentPrice = upbitData.trade_price;
            const newYesterdayPrice = upbitData.prev_closing_price;
            // [수정] 52주 신고가 반영 (API에 없으면 기존 로직 유지)
            const apiHigh = upbitData.highest_52_week_price || upbitData.high_price || newCurrentPrice;
            const newHighestPrice = Math.max(asset.highestPrice, apiHigh, newCurrentPrice);
            
            return {
              ...asset,
              previousClosePrice: newYesterdayPrice,
              currentPrice: newCurrentPrice,
              priceOriginal: newCurrentPrice, // 업비트는 KRW 기준
              currency: Currency.KRW, // 업비트는 항상 KRW
              highestPrice: newHighestPrice, // [수정됨]
              changeRate: upbitData.signed_change_rate,
              indicators: undefined,
            };
          }
          
          failedTickers.push(asset.ticker);
          failedIds.push(asset.id);
          return asset;
        }

        // 일반 자산 처리 (Cloud Run 서버 결과 사용)
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
          
          let newYesterdayPrice = priceData.previousClosePrice;
          if (asset.currency === Currency.KRW && newYesterdayPrice > 0) {
             const ratio = newCurrentPrice / newYesterdayPrice;
             if (ratio > 50 || ratio < 0.02) {
                 const impliedRate = priceData.priceOriginal > 0 ? (priceData.priceKRW / priceData.priceOriginal) : 1450;
                 if (ratio > 50) {
                    newYesterdayPrice = newYesterdayPrice * impliedRate;
                 }
             }
          }

          // [수정] 일반 자산 최고가 업데이트 (priceData.highestPrice 사용)
          const newHighestPrice = Math.max(asset.highestPrice, priceData.highestPrice || 0, newCurrentPrice);

          return {
            ...asset,
            previousClosePrice: newYesterdayPrice,
            currentPrice: newCurrentPrice,
            currency: newCurrency,
            highestPrice: newHighestPrice, // [수정됨]
            changeRate: priceData.changeRate,
            indicators: priceData.indicators,
          };
        } else {
          failedTickers.push(asset.ticker);
          failedIds.push(asset.id);
          return asset;
        }
      });

      setAssets(updatedAssets);
      setFailedAssetIds(new Set(failedIds));

      const successCount = assets.length - failedIds.length;
      const failedCount = failedIds.length;

      if (failedTickers.length > 0) {
        setError(`실패 종목: ${failedTickers.join(', ')}`);
        setTimeout(() => setError(null), 5000);
      }

      setSuccessMessage(`${successCount}건 성공, ${failedCount}건 실패`);
      setTimeout(() => setSuccessMessage(null), 5000);
      
      triggerAutoSave(updatedAssets, portfolioHistory, sellHistory, watchlist, exchangeRates);

    } catch (error) {
      console.error('Price refresh failed:', error);
      setError('가격 업데이트 중 오류가 발생했습니다.');
      setTimeout(() => setError(null), 3000);
    }

    setIsLoading(false);
  }, [assets, portfolioHistory, sellHistory, watchlist, exchangeRates, triggerAutoSave, setAssets, setExchangeRates, setError, setSuccessMessage]);

  // 선택 자산 갱신
  const handleRefreshSelectedPrices = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    
    setIsLoading(true);
    setError(null);

    const idSet = new Set(ids);
    const targetAssets = assets.filter(a => idSet.has(a.id));
    
    const cashAssets = targetAssets.filter(a => a.category === AssetCategory.CASH);
    const upbitAssets = targetAssets.filter(a => 
      a.category !== AssetCategory.CASH && shouldUseUpbitAPI(a.exchange)
    );
    const generalAssets = targetAssets.filter(a => 
      a.category !== AssetCategory.CASH && !shouldUseUpbitAPI(a.exchange)
    );
    
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
        previousClosePrice: rate * asset.priceOriginal
      }))
    );

    const itemsToFetch = generalAssets.map(a => ({ 
      ticker: a.ticker, 
      exchange: a.exchange, 
      id: a.id, 
      category: a.category, 
      currency: a.currency, 
    }));

    const upbitSymbols = upbitAssets.map(a => a.ticker);

    try {
      const [cashResults, batchPriceMap, upbitPriceMap] = await Promise.all([
        Promise.allSettled(cashPromises),
        itemsToFetch.length > 0 ? fetchBatchAssetPricesNew(itemsToFetch) : Promise.resolve(new Map()),
        upbitSymbols.length > 0 ? fetchUpbitPricesBatch(upbitSymbols) : Promise.resolve(new Map())
      ]);

      const updatedAssets = assets.map((asset) => {
          if (!idSet.has(asset.id)) return asset;

          if (asset.category === AssetCategory.CASH) {
            const cashIdx = cashAssets.findIndex(ca => ca.id === asset.id);
            const result = cashResults[cashIdx];
            if (result && result.status === 'fulfilled') {
                const data = result.value;
                return { 
                  ...asset, 
                  previousClosePrice: data.previousClosePrice, 
                  currentPrice: data.priceKRW, 
                  priceOriginal: data.priceOriginal, 
                  currency: data.currency as Currency, 
                  highestPrice: Math.max(asset.highestPrice, data.priceOriginal) 
                };
            }
            return asset;
          }

          if (shouldUseUpbitAPI(asset.exchange)) {
            const tickerUpper = asset.ticker.toUpperCase();
            const upbitData = upbitPriceMap.get(tickerUpper) || 
                             upbitPriceMap.get(`KRW-${tickerUpper}`);
            
            if (upbitData) {
              // [수정] 52주 신고가 반영
              const apiHigh = upbitData.highest_52_week_price || upbitData.high_price || upbitData.trade_price;
              const newHighestPrice = Math.max(asset.highestPrice, apiHigh, upbitData.trade_price);
              
              return {
                ...asset,
                previousClosePrice: upbitData.prev_closing_price,
                currentPrice: upbitData.trade_price,
                priceOriginal: upbitData.trade_price,
                currency: Currency.KRW,
                highestPrice: newHighestPrice, // [수정됨]
                changeRate: upbitData.signed_change_rate,
                indicators: undefined,
              };
            }
            return asset;
          }

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
            
            let newYesterdayPrice = priceData.previousClosePrice;
            if (newYesterdayPrice <= 0 && asset.currency === Currency.KRW) { 
                newYesterdayPrice = asset.previousClosePrice || 0;
            }

            // [수정] 일반 자산 최고가 반영
            const newHighestPrice = Math.max(asset.highestPrice, priceData.highestPrice || 0, newCurrentPrice);

            return { 
              ...asset, 
              previousClosePrice: newYesterdayPrice, 
              currentPrice: newCurrentPrice, 
              currency: newCurrency, 
              highestPrice: newHighestPrice, // [수정됨]
              changeRate: priceData.changeRate,
              indicators: priceData.indicators,
            };
          }
          return asset;
      });

      setAssets(updatedAssets);
      setSuccessMessage('선택한 자산 업데이트 완료'); 
      setTimeout(() => setSuccessMessage(null), 3000);
      
      triggerAutoSave(updatedAssets, portfolioHistory, sellHistory, watchlist, exchangeRates);
    } catch (error) { 
      console.error('Selected update failed:', error);
      setError('선택한 항목 업데이트 중 오류가 발생했습니다.'); 
      setTimeout(() => setError(null), 3000); 
    } finally {
      setIsLoading(false);
    }
  }, [assets, portfolioHistory, sellHistory, watchlist, exchangeRates, triggerAutoSave, setAssets, setError, setSuccessMessage]);

  // 단일 자산 갱신
  const handleRefreshOnePrice = useCallback(async (assetId: string) => {
    const target = assets.find(a => a.id === assetId);
    if (!target) return;
    setIsLoading(true);
    setError(null);

    try {
      if (shouldUseUpbitAPI(target.exchange)) {
        console.log(`[useMarketData] 단일 조회 (업비트): ${target.ticker}`);
        const upbitPriceMap = await fetchUpbitPricesBatch([target.ticker]);
        const tickerUpper = target.ticker.toUpperCase();
        const upbitData = upbitPriceMap.get(tickerUpper) || 
                         upbitPriceMap.get(`KRW-${tickerUpper}`);
        
        if (upbitData) {
          // [수정] 52주 신고가 반영
          const apiHigh = upbitData.highest_52_week_price || upbitData.high_price || upbitData.trade_price;
          const newHighestPrice = Math.max(target.highestPrice, apiHigh, upbitData.trade_price);

          const updated = assets.map(a => a.id === assetId ? {
            ...a,
            previousClosePrice: upbitData.prev_closing_price,
            currentPrice: upbitData.trade_price,
            priceOriginal: upbitData.trade_price,
            currency: Currency.KRW,
            highestPrice: newHighestPrice, // [수정됨]
          } : a);
          setAssets(updated);
          triggerAutoSave(updated, portfolioHistory, sellHistory, watchlist, exchangeRates);
          setSuccessMessage('가격 업데이트 완료');
          setTimeout(() => setSuccessMessage(null), 2000);
        } else {
          throw new Error('업비트 가격 조회 실패');
        }
      } else {
        console.log(`[useMarketData] 단일 조회 (Cloud Run): ${target.ticker}`);
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
        
        // [수정] 일반 자산 최고가 반영
        const newHighestPrice = Math.max(target.highestPrice, d.highestPrice || 0, newCurrentPrice);

        const updated = assets.map(a => a.id === assetId ? {
          ...a,
          previousClosePrice: d.previousClosePrice,
          currentPrice: newCurrentPrice,
          currency: newCurrency,
          highestPrice: newHighestPrice, // [수정됨]
        } : a);
        setAssets(updated);
        triggerAutoSave(updated, portfolioHistory, sellHistory, watchlist, exchangeRates);
        setSuccessMessage('가격 업데이트 완료');
        setTimeout(() => setSuccessMessage(null), 2000);
      }
    } catch (e) {
      console.error('Single asset refresh failed:', e);
      setError('해당 종목 가격 갱신에 실패했습니다.');
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  }, [assets, portfolioHistory, sellHistory, watchlist, exchangeRates, triggerAutoSave, setAssets, setError, setSuccessMessage]);

  // 관심종목 가격 갱신
  const handleRefreshWatchlistPrices = useCallback(async () => {
    if (watchlist.length === 0) return;
    setIsLoading(true);
    setError(null);

    const upbitItems = watchlist.filter(item => shouldUseUpbitAPI(item.exchange));
    const generalItems = watchlist.filter(item => !shouldUseUpbitAPI(item.exchange));
    const itemsToFetch = generalItems.map(item => ({
      ticker: item.ticker,
      exchange: item.exchange,
      id: item.id,
      category: item.category,
      currency: item.currency,
    }));

    const upbitSymbols = upbitItems.map(item => item.ticker);

    try {
      const [priceMap, upbitPriceMap] = await Promise.all([
        itemsToFetch.length > 0 ? fetchBatchAssetPricesNew(itemsToFetch) : Promise.resolve(new Map()),
        upbitSymbols.length > 0 ? fetchUpbitPricesBatch(upbitSymbols) : Promise.resolve(new Map())
      ]);

      const updated = watchlist.map((item) => {
        if (shouldUseUpbitAPI(item.exchange)) {
          const tickerUpper = item.ticker.toUpperCase();
          const upbitData = upbitPriceMap.get(tickerUpper) || 
                           upbitPriceMap.get(`KRW-${tickerUpper}`);
          
          if (upbitData) {
            // [수정] 52주 신고가 반영
            const apiHigh = upbitData.highest_52_week_price || upbitData.high_price || upbitData.trade_price;
            const highestPrice = item.highestPrice ? Math.max(item.highestPrice, apiHigh, upbitData.trade_price) : upbitData.trade_price;
            
            return {
              ...item,
              currentPrice: upbitData.trade_price,
              priceOriginal: upbitData.trade_price,
              currency: Currency.KRW,
              previousClosePrice: upbitData.prev_closing_price,
              highestPrice, // [수정됨]
              changeRate: upbitData.signed_change_rate,
              indicators: undefined,
            };
          }
          return item;
        }

        const d = priceMap.get(item.id);
        if (d && !d.isMocked) {
          const newCurrency = item.currency || (d.currency as Currency);
          const newCurrentPrice = item.currency === Currency.KRW 
            ? d.priceKRW 
            : d.priceOriginal;
          
          // [수정] 일반 자산 최고가 반영
          const apiHigh = d.highestPrice || newCurrentPrice;
          const highestPrice = item.highestPrice ? Math.max(item.highestPrice, apiHigh, newCurrentPrice) : newCurrentPrice;
          
          return {
            ...item,
            currentPrice: newCurrentPrice,
            priceOriginal: d.priceOriginal,
            currency: newCurrency,
            previousClosePrice: d.previousClosePrice,
            highestPrice, // [수정됨]
            changeRate: d.changeRate,
            indicators: d.indicators,
          };
        }
        return item;
      });

      setWatchlist(updated);
      triggerAutoSave(assets, portfolioHistory, sellHistory, updated, exchangeRates);
      setSuccessMessage('관심종목 업데이트 완료');
      setTimeout(() => setSuccessMessage(null), 2000);
    } catch (error) {
      console.error('Watchlist refresh failed:', error);
      setError('관심종목 업데이트 중 오류가 발생했습니다.');
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  }, [watchlist, assets, portfolioHistory, sellHistory, exchangeRates, triggerAutoSave, setWatchlist, setError, setSuccessMessage]);

  return {
    isLoading,
    failedAssetIds,
    handleExchangeRatesChange,
    handleRefreshAllPrices,
    handleRefreshSelectedPrices,
    handleRefreshOnePrice,
    handleRefreshWatchlistPrices
  };
};