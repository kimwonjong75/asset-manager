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

// 업비트/빗썸 거래소 여부 확인 헬퍼 함수
const isUpbitExchange = (exchange: string): boolean => {
  const normalized = (exchange || '').toLowerCase();
  return normalized === 'upbit' || normalized === 'bithumb';
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
    const upbitAssets = assets.filter(a => a.category !== AssetCategory.CASH && isUpbitExchange(a.exchange));
    const generalAssets = assets.filter(a => a.category !== AssetCategory.CASH && !isUpbitExchange(a.exchange));

    console.log('[useMarketData] 자산 분류:', {
      cash: cashAssets.length,
      upbit: upbitAssets.length,
      general: generalAssets.length
    });

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
        pricePreviousClose: rate * asset.priceOriginal,
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
        fetchBatchAssetPricesNew(assetsToFetch),
        fetchUpbitPricesBatch(upbitSymbols)
      ]);

      console.log('[useMarketData] 업비트 응답:', upbitPriceMap);

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

        // 업비트/빗썸 자산 처리 (업비트 API 직접 호출 결과 사용)
        if (isUpbitExchange(asset.exchange)) {
          const upbitData = upbitPriceMap.get(asset.ticker.toUpperCase()) || 
                           upbitPriceMap.get(`KRW-${asset.ticker.toUpperCase()}`);
          
          if (upbitData) {
            const newCurrentPrice = upbitData.trade_price;
            const newYesterdayPrice = upbitData.prev_closing_price;
            
            console.log(`[Upbit] ${asset.ticker}: 현재가=${newCurrentPrice}, 전일종가=${newYesterdayPrice}`);
            
            return {
              ...asset,
              yesterdayPrice: newYesterdayPrice,
              currentPrice: newCurrentPrice,
              priceOriginal: newCurrentPrice, // 업비트는 KRW 기준
              currency: Currency.KRW, // 업비트는 항상 KRW
              highestPrice: Math.max(asset.highestPrice, newCurrentPrice),
            };
          }
          
          console.warn(`[Upbit] ${asset.ticker}: 가격 데이터 없음`);
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
          
          // KRW 단위 오류 보정
          let newYesterdayPrice = priceData.pricePreviousClose;
          if (asset.currency === Currency.KRW && newYesterdayPrice > 0) {
             const ratio = newCurrentPrice / newYesterdayPrice;
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
    const upbitAssets = targetAssets.filter(a => a.category !== AssetCategory.CASH && isUpbitExchange(a.exchange));
    const generalAssets = targetAssets.filter(a => a.category !== AssetCategory.CASH && !isUpbitExchange(a.exchange));
    
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
        fetchBatchAssetPricesNew(itemsToFetch),
        fetchUpbitPricesBatch(upbitSymbols)
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
                  yesterdayPrice: data.pricePreviousClose, 
                  currentPrice: data.priceKRW, 
                  priceOriginal: data.priceOriginal, 
                  currency: data.currency as Currency, 
                  highestPrice: Math.max(asset.highestPrice, data.priceOriginal) 
                };
            }
            return asset;
          }

          // 업비트/빗썸 자산 처리
          if (isUpbitExchange(asset.exchange)) {
            const upbitData = upbitPriceMap.get(asset.ticker.toUpperCase()) || 
                             upbitPriceMap.get(`KRW-${asset.ticker.toUpperCase()}`);
            
            if (upbitData) {
              return {
                ...asset,
                yesterdayPrice: upbitData.prev_closing_price,
                currentPrice: upbitData.trade_price,
                priceOriginal: upbitData.trade_price,
                currency: Currency.KRW,
                highestPrice: Math.max(asset.highestPrice, upbitData.trade_price),
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
      // 업비트/빗썸 자산인 경우 업비트 API 직접 호출
      if (isUpbitExchange(target.exchange)) {
        const upbitPriceMap = await fetchUpbitPricesBatch([target.ticker]);
        const upbitData = upbitPriceMap.get(target.ticker.toUpperCase()) || 
                         upbitPriceMap.get(`KRW-${target.ticker.toUpperCase()}`);
        
        if (upbitData) {
          const updated = assets.map(a => a.id === assetId ? {
            ...a,
            yesterdayPrice: upbitData.prev_closing_price,
            currentPrice: upbitData.trade_price,
            priceOriginal: upbitData.trade_price,
            currency: Currency.KRW,
            highestPrice: Math.max(a.highestPrice, upbitData.trade_price),
          } : a);
          setAssets(updated);
          triggerAutoSave(updated, portfolioHistory, sellHistory, watchlist, exchangeRates);
        } else {
          throw new Error('업비트 가격 조회 실패');
        }
      } else {
        // 일반 자산은 기존 로직 사용
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
        triggerAutoSave(updated, portfolioHistory, sellHistory, watchlist, exchangeRates);
      }
    } catch (e) {
      console.error('Single asset refresh failed:', e);
      setError('해당 종목 가격 갱신에 실패했습니다.');
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  }, [assets, portfolioHistory, sellHistory, watchlist, exchangeRates, triggerAutoSave, setAssets, setError]);

  // 관심종목 가격 갱신
  const handleRefreshWatchlistPrices = useCallback(async () => {
    if (watchlist.length === 0) return;
    setIsLoading(true);
    setError(null);

    // 업비트 자산과 일반 자산 분리
    const upbitItems = watchlist.filter(item => isUpbitExchange(item.exchange));
    const generalItems = watchlist.filter(item => !isUpbitExchange(item.exchange));

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
        fetchBatchAssetPricesNew(itemsToFetch),
        fetchUpbitPricesBatch(upbitSymbols)
      ]);

      const updated = watchlist.map((item) => {
        // 업비트/빗썸 자산 처리
        if (isUpbitExchange(item.exchange)) {
          const upbitData = upbitPriceMap.get(item.ticker.toUpperCase()) || 
                           upbitPriceMap.get(`KRW-${item.ticker.toUpperCase()}`);
          
          if (upbitData) {
            const highestPrice = item.highestPrice ? Math.max(item.highestPrice, upbitData.trade_price) : upbitData.trade_price;
            return {
              ...item,
              currentPrice: upbitData.trade_price,
              priceOriginal: upbitData.trade_price,
              currency: Currency.KRW,
              yesterdayPrice: upbitData.prev_closing_price,
              highestPrice,
            };
          }
          return item;
        }

        // 일반 자산 처리
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
      triggerAutoSave(assets, portfolioHistory, sellHistory, updated, exchangeRates);
    } catch (error) {
      console.error('Watchlist refresh failed:', error);
      setError('관심종목 업데이트 중 오류가 발생했습니다.');
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  }, [watchlist, assets, portfolioHistory, sellHistory, exchangeRates, triggerAutoSave, setWatchlist, setError]);

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