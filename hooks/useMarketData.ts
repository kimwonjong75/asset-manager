import { useCallback, useState } from 'react';
import { Asset, Currency, ExchangeRates, PortfolioSnapshot, SellRecord, WatchlistItem } from '../types';
import { isBaseType } from '../types/category';
// [수정] fetchAssetData import 복구 (단일 갱신 시 필요)
import { fetchBatchAssetPrices as fetchBatchAssetPricesNew, fetchAssetData as fetchAssetDataNew, fetchExchangeRate, fetchExchangeRateJPY, fetchCurrentExchangeRate } from '../services/priceService';
import { fetchUpbitPricesBatch } from '../services/upbitService';
import { fetchStockHistoricalPrices, fetchCryptoHistoricalPrices, isCryptoExchange } from '../services/historicalPriceService';

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

  const handleExchangeRatesChange = useCallback((newRates: ExchangeRates) => {
    setExchangeRates(newRates);
    triggerAutoSave(assets, portfolioHistory, sellHistory, watchlist, newRates);
  }, [assets, portfolioHistory, sellHistory, watchlist, triggerAutoSave, setExchangeRates]);

  // 공통 로직: 최고가 오류 자동 보정 함수
  const fixHighestPrice = (asset: Asset, newCurrentPrice: number, apiHighest: number = 0) => {
      let safeHighestPrice = asset.highestPrice;
      // 최고가가 현재가보다 20배 이상 크고, 원화 자산이 아니라면 단위 오류로 간주하고 리셋
      if (asset.currency !== Currency.KRW && safeHighestPrice > newCurrentPrice * 20) {
          console.log(`[Data Fix] ${asset.ticker} 최고가 오류 보정. ${safeHighestPrice} -> 0`);
          safeHighestPrice = 0;
      }
      return Math.max(safeHighestPrice, apiHighest, newCurrentPrice);
  };

  // 1. 전체 시세 갱신
  const handleRefreshAllPrices = useCallback(async (isAutoUpdate = false, isScheduled = false) => {
    if (assets.length === 0) return;
    
    setIsLoading(true);
    setError(null);
    setFailedAssetIds(new Set());
    
    if (isAutoUpdate || isScheduled) {
        setSuccessMessage('최신 시세를 불러오는 중입니다...');
    } else {
        setSuccessMessage(null);
    }

    try {
        // 자산 분류
        const cashAssets = assets.filter(a => isBaseType(a.categoryId, 'CASH'));
        const upbitAssets = assets.filter(a => !isBaseType(a.categoryId, 'CASH') && shouldUseUpbitAPI(a.exchange));
        const generalAssets = assets.filter(a => !isBaseType(a.categoryId, 'CASH') && !shouldUseUpbitAPI(a.exchange));

        const assetsToFetch = generalAssets.map(a => ({ ticker: a.ticker, exchange: a.exchange, id: a.id, category: a.category, currency: a.currency }));
        const upbitSymbols = upbitAssets.map(a => a.ticker);

        // 관심종목 분류
        const wlGeneral = watchlist.filter(item => !shouldUseUpbitAPI(item.exchange));
        const wlUpbit = watchlist.filter(item => shouldUseUpbitAPI(item.exchange));
        const wlToFetch = wlGeneral.map(item => ({ ticker: item.ticker, exchange: item.exchange, id: item.id, category: item.category, currency: item.currency }));
        const wlUpbitSymbols = wlUpbit.map(item => item.ticker);

        // 환율 + 포트폴리오 + 관심종목 모든 fetch를 병렬 실행
        const [
            usdRate, jpyRate,
            batchPriceMap, upbitPriceMap,
            wlPriceMap, wlUpbitPriceMap,
        ] = await Promise.all([
            fetchExchangeRate().catch(() => 1450),
            fetchExchangeRateJPY().catch(() => 9.5),
            assetsToFetch.length > 0 ? fetchBatchAssetPricesNew(assetsToFetch) : Promise.resolve(new Map()),
            upbitSymbols.length > 0 ? fetchUpbitPricesBatch(upbitSymbols) : Promise.resolve(new Map()),
            wlToFetch.length > 0 ? fetchBatchAssetPricesNew(wlToFetch) : Promise.resolve(new Map()),
            wlUpbitSymbols.length > 0 ? fetchUpbitPricesBatch(wlUpbitSymbols) : Promise.resolve(new Map()),
        ]);

        const newRates = {
            USD: usdRate > 1000 ? usdRate : (exchangeRates.USD || 1450),
            JPY: jpyRate > 5 ? jpyRate : (exchangeRates.JPY || 9.5)
        };
        setExchangeRates(newRates);

        // 현금 자산 환율 처리 (USD/JPY는 이미 조회 완료, 기타 통화만 추가 fetch)
        const cashResults = await Promise.allSettled(cashAssets.map(asset =>
          (asset.currency === Currency.USD ? Promise.resolve(newRates.USD) : asset.currency === Currency.JPY ? Promise.resolve(newRates.JPY) : fetchCurrentExchangeRate(asset.currency, Currency.KRW))
          .then(rate => ({
            id: asset.id, priceKRW: rate * asset.priceOriginal, priceOriginal: asset.priceOriginal, currency: asset.currency, previousClosePrice: rate * asset.priceOriginal
          }))
        ));

        const failedTickers: string[] = [];
        const failedIds: string[] = [];

        const updatedAssets = assets.map((asset) => {
          if (isBaseType(asset.categoryId, 'CASH')) {
            const result = cashResults[cashAssets.findIndex(ca => ca.id === asset.id)];
            if (result && result.status === 'fulfilled') return { ...asset, currentPrice: result.value.priceKRW, previousClosePrice: result.value.priceKRW };
            return asset;
          }

          if (shouldUseUpbitAPI(asset.exchange)) {
            const upbitData = upbitPriceMap.get(asset.ticker.toUpperCase()) || upbitPriceMap.get(`KRW-${asset.ticker.toUpperCase()}`);
            if (upbitData) {
              const newCurrent = upbitData.trade_price;
              const apiHigh = upbitData.highest_52_week_price || newCurrent;
              const newHighest = Math.max(asset.highestPrice, apiHigh, newCurrent);
              return { ...asset, previousClosePrice: upbitData.prev_closing_price, currentPrice: newCurrent, priceOriginal: newCurrent, currency: Currency.KRW, highestPrice: newHighest, changeRate: upbitData.signed_change_rate };
            }
            failedTickers.push(asset.ticker); failedIds.push(asset.id); return asset;
          }

          const priceData = batchPriceMap.get(asset.id);
          if (priceData && !priceData.isMocked) {
             const newCurrency = isBaseType(asset.categoryId, 'CRYPTOCURRENCY') ? asset.currency : (priceData.currency as Currency);
             const newCurrentPrice = (asset.currency === Currency.KRW) ? priceData.priceKRW : priceData.priceOriginal;
             const finalHighest = fixHighestPrice(asset, newCurrentPrice, priceData.highestPrice);

             return { ...asset, currentPrice: newCurrentPrice, priceOriginal: priceData.priceOriginal, previousClosePrice: priceData.previousClosePrice, currency: newCurrency, highestPrice: finalHighest, changeRate: priceData.changeRate, indicators: priceData.indicators };
          }
          failedTickers.push(asset.ticker); failedIds.push(asset.id); return asset;
        });

        setAssets(updatedAssets);
        setFailedAssetIds(new Set(failedIds));

        // 관심종목 결과 처리 (fetch는 이미 완료)
        let updatedWatchlist = watchlist;
        if (watchlist.length > 0) {
            updatedWatchlist = watchlist.map(item => {
                if (shouldUseUpbitAPI(item.exchange)) {
                    const data = wlUpbitPriceMap.get(item.ticker.toUpperCase()) || wlUpbitPriceMap.get(`KRW-${item.ticker.toUpperCase()}`);
                    if (data) {
                        const apiHigh = data.highest_52_week_price || data.trade_price;
                        const newHighest = Math.max(item.highestPrice || 0, apiHigh, data.trade_price);
                        const cr = data.signed_change_rate;
                        return { ...item, currentPrice: data.trade_price, priceOriginal: data.trade_price, currency: Currency.KRW, previousClosePrice: data.prev_closing_price, changeRate: cr, highestPrice: newHighest, yesterdayChange: cr != null ? cr * 100 : (data.prev_closing_price > 0 ? ((data.trade_price - data.prev_closing_price) / data.prev_closing_price) * 100 : 0) };
                    }
                    return item;
                }
                const d = wlPriceMap.get(item.id);
                if (d && !d.isMocked) {
                    const newCurrent = (item.currency === Currency.KRW) ? d.priceKRW : d.priceOriginal;
                    const newHighest = Math.max(item.highestPrice || 0, d.highestPrice || 0, newCurrent);
                    const cr = d.changeRate;
                    return { ...item, currentPrice: newCurrent, priceOriginal: d.priceOriginal, currency: (item.currency || d.currency) as Currency, previousClosePrice: d.previousClosePrice, changeRate: cr, indicators: d.indicators, highestPrice: newHighest, yesterdayChange: cr != null ? cr * 100 : (d.previousClosePrice > 0 ? ((newCurrent - d.previousClosePrice) / d.previousClosePrice) * 100 : 0) };
                }
                return item;
            });
            setWatchlist(updatedWatchlist);
        }

        triggerAutoSave(updatedAssets, portfolioHistory, sellHistory, updatedWatchlist, newRates);

        if (failedTickers.length > 0) setError(`갱신 실패: ${failedTickers.join(', ')}`);
        else setSuccessMessage(watchlist.length > 0 ? '시세 업데이트 완료 (관심종목 포함)' : '시세 업데이트 완료');
        setTimeout(() => { setError(null); setSuccessMessage(null); }, 3000);

    } catch (error) {
        console.error('Refresh Error:', error);
        setError('시세 업데이트 중 오류 발생');
    } finally {
        setIsLoading(false);
    }
  }, [assets, portfolioHistory, sellHistory, watchlist, exchangeRates, triggerAutoSave, setAssets, setExchangeRates, setError, setSuccessMessage]);

  // 2. 선택 자산 갱신 (완전 구현)
  const handleRefreshSelectedPrices = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    setIsLoading(true); setError(null);
    const idSet = new Set(ids);
    const targetAssets = assets.filter(a => idSet.has(a.id));
    
    try {
        // 간략화: 선택 갱신도 로직 복잡성을 피하기 위해 전체 갱신 로직을 일부 차용하되 대상만 필터링
        // 여기서는 코드 안정성을 위해, 선택된 ID가 포함된 전체 리스트를 다시 계산하는 방식이 가장 안전함 (부분 업데이트보다)
        // 하지만 성능을 위해 필요한 부분만 fetch 하도록 구현
        
        const generalAssets = targetAssets.filter(a => !shouldUseUpbitAPI(a.exchange) && !isBaseType(a.categoryId, 'CASH'));
        const upbitAssets = targetAssets.filter(a => shouldUseUpbitAPI(a.exchange) && !isBaseType(a.categoryId, 'CASH'));
        
        const assetsToFetch = generalAssets.map(a => ({ ticker: a.ticker, exchange: a.exchange, id: a.id, category: a.category, currency: a.currency }));
        const upbitSymbols = upbitAssets.map(a => a.ticker);

        const [batchPriceMap, upbitPriceMap] = await Promise.all([
             assetsToFetch.length > 0 ? fetchBatchAssetPricesNew(assetsToFetch) : Promise.resolve(new Map()),
             upbitSymbols.length > 0 ? fetchUpbitPricesBatch(upbitSymbols) : Promise.resolve(new Map())
        ]);

        const updatedAssets = assets.map(asset => {
            if (!idSet.has(asset.id)) return asset;
            if (isBaseType(asset.categoryId, 'CASH')) return asset; // 현금은 전체 갱신 때만

            if (shouldUseUpbitAPI(asset.exchange)) {
                const upbitData = upbitPriceMap.get(asset.ticker.toUpperCase()) || upbitPriceMap.get(`KRW-${asset.ticker.toUpperCase()}`);
                if (upbitData) {
                    const newCurrent = upbitData.trade_price;
                    const apiHigh = upbitData.highest_52_week_price || newCurrent;
                    const newHighest = Math.max(asset.highestPrice, apiHigh, newCurrent);
                    return { ...asset, previousClosePrice: upbitData.prev_closing_price, currentPrice: newCurrent, priceOriginal: newCurrent, currency: Currency.KRW, highestPrice: newHighest, changeRate: upbitData.signed_change_rate };
                }
                return asset;
            }

            const priceData = batchPriceMap.get(asset.id);
            if (priceData && !priceData.isMocked) {
                 const newCurrency = isBaseType(asset.categoryId, 'CRYPTOCURRENCY') ? asset.currency : (priceData.currency as Currency);
                 const newCurrentPrice = (asset.currency === Currency.KRW) ? priceData.priceKRW : priceData.priceOriginal;
                 const finalHighest = fixHighestPrice(asset, newCurrentPrice, priceData.highestPrice);
                 return { ...asset, currentPrice: newCurrentPrice, priceOriginal: priceData.priceOriginal, previousClosePrice: priceData.previousClosePrice, currency: newCurrency, highestPrice: finalHighest, changeRate: priceData.changeRate, indicators: priceData.indicators };
            }
            return asset;
        });

        setAssets(updatedAssets);
        triggerAutoSave(updatedAssets, portfolioHistory, sellHistory, watchlist, exchangeRates);
        setSuccessMessage('선택 항목 업데이트 완료');
    } catch(e) { setError('선택 항목 업데이트 실패'); }
    finally { setIsLoading(false); setTimeout(() => setSuccessMessage(null), 2000); }
  }, [assets, portfolioHistory, sellHistory, watchlist, exchangeRates, triggerAutoSave, setAssets, setError, setSuccessMessage]);

  // 3. 단일 자산 갱신 (완전 구현)
  const handleRefreshOnePrice = useCallback(async (assetId: string) => {
    const target = assets.find(a => a.id === assetId);
    if (!target) return;
    setIsLoading(true); setError(null);

    try {
      if (shouldUseUpbitAPI(target.exchange)) {
        const upbitPriceMap = await fetchUpbitPricesBatch([target.ticker]);
        const upbitData = upbitPriceMap.get(target.ticker.toUpperCase()) || upbitPriceMap.get(`KRW-${target.ticker.toUpperCase()}`);
        if (upbitData) {
             const newCurrent = upbitData.trade_price;
             const newHighest = Math.max(target.highestPrice, upbitData.highest_52_week_price || 0, newCurrent);
             const updated = assets.map(a => a.id === assetId ? { ...a, previousClosePrice: upbitData.prev_closing_price, currentPrice: newCurrent, priceOriginal: newCurrent, currency: Currency.KRW, highestPrice: newHighest, changeRate: upbitData.signed_change_rate } : a);
             setAssets(updated);
             triggerAutoSave(updated, portfolioHistory, sellHistory, watchlist, exchangeRates);
             setSuccessMessage('업데이트 완료');
        } else throw new Error('업비트 조회 실패');
      } else {
        const d = await fetchAssetDataNew({ ticker: target.ticker, exchange: target.exchange, category: target.category, currency: target.currency });
        const newCurrency = isBaseType(target.categoryId, 'CRYPTOCURRENCY') ? target.currency : (d.currency as Currency);
        const newCurrentPrice = (target.currency === Currency.KRW) ? d.priceKRW : d.priceOriginal;
        const finalHighest = fixHighestPrice(target, newCurrentPrice, d.highestPrice);
        
        const updated = assets.map(a => a.id === assetId ? { ...a, previousClosePrice: d.previousClosePrice, currentPrice: newCurrentPrice, currency: newCurrency, highestPrice: finalHighest, changeRate: d.changeRate } : a);
        setAssets(updated);
        triggerAutoSave(updated, portfolioHistory, sellHistory, watchlist, exchangeRates);
        setSuccessMessage('업데이트 완료');
      }
    } catch (e) { setError('갱신 실패'); }
    finally { setIsLoading(false); setTimeout(() => setSuccessMessage(null), 2000); }
  }, [assets, portfolioHistory, sellHistory, watchlist, exchangeRates, triggerAutoSave, setAssets, setError, setSuccessMessage]);

  // 4. 관심종목 갱신
  const handleRefreshWatchlistPrices = useCallback(async () => {
    if (watchlist.length === 0) return;
    setIsLoading(true); setError(null);
    try {
        const generalItems = watchlist.filter(item => !shouldUseUpbitAPI(item.exchange));
        const upbitItems = watchlist.filter(item => shouldUseUpbitAPI(item.exchange));
        const itemsToFetch = generalItems.map(item => ({ ticker: item.ticker, exchange: item.exchange, id: item.id, category: item.category, currency: item.currency }));
        const upbitSymbols = upbitItems.map(item => item.ticker);

        // 52주 최고가 계산용 1년 히스토리 병렬 fetch
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const startDate = oneYearAgo.toISOString().slice(0, 10);
        const endDate = new Date().toISOString().slice(0, 10);
        const generalTickers = [...new Set(generalItems.map(item => item.ticker.toUpperCase()))];
        const cryptoItems = upbitItems.filter(item => isCryptoExchange(item.exchange));
        const cryptoSymbols = [...new Set(cryptoItems.map(item => item.ticker))];

        const [priceMap, upbitPriceMap, stockHistory, cryptoHistory] = await Promise.all([
            itemsToFetch.length > 0 ? fetchBatchAssetPricesNew(itemsToFetch) : Promise.resolve(new Map()),
            upbitSymbols.length > 0 ? fetchUpbitPricesBatch(upbitSymbols) : Promise.resolve(new Map()),
            generalTickers.length > 0 ? fetchStockHistoricalPrices(generalTickers, startDate, endDate) : Promise.resolve({}),
            cryptoSymbols.length > 0 ? fetchCryptoHistoricalPrices(cryptoSymbols, startDate, endDate) : Promise.resolve({}),
        ]);

        // 히스토리에서 52주 최고가 계산
        const histHighMap = new Map<string, number>();
        for (const [ticker, result] of Object.entries(stockHistory) as [string, { data?: Record<string, number> }][]) {
            if (result?.data) {
                const prices = Object.values(result.data).filter((v): v is number => typeof v === 'number');
                if (prices.length > 0) {
                    const maxPrice = Math.max(...prices);
                    if (maxPrice > 0) histHighMap.set(ticker.toUpperCase(), maxPrice);
                }
            }
        }
        for (const [ticker, result] of Object.entries(cryptoHistory) as [string, { data?: Record<string, number> }][]) {
            if (result?.data) {
                const prices = Object.values(result.data).filter((v): v is number => typeof v === 'number');
                if (prices.length > 0) {
                    const maxPrice = Math.max(...prices);
                    if (maxPrice > 0) histHighMap.set(ticker.toUpperCase(), maxPrice);
                }
            }
        }

        const updated = watchlist.map(item => {
            if (shouldUseUpbitAPI(item.exchange)) {
                const data = upbitPriceMap.get(item.ticker.toUpperCase()) || upbitPriceMap.get(`KRW-${item.ticker.toUpperCase()}`);
                if (data) {
                    const apiHigh = data.highest_52_week_price || data.trade_price;
                    const histHigh = histHighMap.get(item.ticker.toUpperCase()) || 0;
                    const newHighest = Math.max(item.highestPrice || 0, apiHigh, histHigh, data.trade_price);
                    const cr = data.signed_change_rate;
                    return { ...item, currentPrice: data.trade_price, priceOriginal: data.trade_price, currency: Currency.KRW, previousClosePrice: data.prev_closing_price, changeRate: cr, highestPrice: newHighest, yesterdayChange: cr != null ? cr * 100 : (data.prev_closing_price > 0 ? ((data.trade_price - data.prev_closing_price) / data.prev_closing_price) * 100 : 0) };
                }
                return item;
            }
            const d = priceMap.get(item.id);
            if (d && !d.isMocked) {
                const newCurrent = (item.currency === Currency.KRW) ? d.priceKRW : d.priceOriginal;
                const histHigh = histHighMap.get(item.ticker.toUpperCase()) || 0;
                const newHighest = Math.max(item.highestPrice || 0, d.highestPrice || 0, histHigh, newCurrent);
                const cr = d.changeRate;
                return { ...item, currentPrice: newCurrent, priceOriginal: d.priceOriginal, currency: (item.currency || d.currency) as Currency, previousClosePrice: d.previousClosePrice, changeRate: cr, indicators: d.indicators, highestPrice: newHighest, yesterdayChange: cr != null ? cr * 100 : (d.previousClosePrice > 0 ? ((newCurrent - d.previousClosePrice) / d.previousClosePrice) * 100 : 0) };
            }
            return item;
        });
        setWatchlist(updated);
        triggerAutoSave(assets, portfolioHistory, sellHistory, updated, exchangeRates);
        setSuccessMessage('관심종목 업데이트 완료');
    } catch (e) { setError('관심종목 갱신 실패'); }
    finally { setIsLoading(false); setTimeout(() => setSuccessMessage(null), 2000); }
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