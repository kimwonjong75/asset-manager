import { useCallback, useState } from 'react';
import { Asset, AssetCategory, BulkUploadResult, Currency, ExchangeRates, NewAssetForm, PortfolioSnapshot, SellRecord, WatchlistItem, ALLOWED_CATEGORIES, normalizeExchange } from '../types';
import { fetchAssetData as fetchAssetDataNew, fetchExchangeRate, fetchExchangeRateJPY } from '../services/priceService';
import { fetchHistoricalExchangeRate, fetchCurrentExchangeRate } from '../services/geminiService';

interface UseAssetActionsProps {
  assets: Asset[];
  setAssets: React.Dispatch<React.SetStateAction<Asset[]>>;
  watchlist: WatchlistItem[];
  setWatchlist: React.Dispatch<React.SetStateAction<WatchlistItem[]>>;
  portfolioHistory: PortfolioSnapshot[];
  sellHistory: SellRecord[];
  setSellHistory: React.Dispatch<React.SetStateAction<SellRecord[]>>;
  exchangeRates: ExchangeRates;
  isSignedIn: boolean;
  triggerAutoSave: (assets: Asset[], history: PortfolioSnapshot[], sells: SellRecord[], watchlist: WatchlistItem[], rates: ExchangeRates) => void;
  setError: (msg: string | null) => void;
  setSuccessMessage: (msg: string | null) => void;
}

export const useAssetActions = ({
  assets,
  setAssets,
  watchlist,
  setWatchlist,
  portfolioHistory,
  sellHistory,
  setSellHistory,
  exchangeRates,
  isSignedIn,
  triggerAutoSave,
  setError,
  setSuccessMessage
}: UseAssetActionsProps) => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [sellingAsset, setSellingAsset] = useState<Asset | null>(null);

  // 자산 추가
  const handleAddAsset = useCallback(async (newAssetData: NewAssetForm) => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 자산을 추가할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }
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
          currency: d.currency || newAssetData.currency,
        };
      }
      
      const finalNewAsset: Asset = {
        id: new Date().getTime().toString(),
        ...newAsset
      };

      setAssets(prevAssets => {
        const newAssets = [...prevAssets, finalNewAsset];
        triggerAutoSave(newAssets, portfolioHistory, sellHistory, watchlist, exchangeRates);
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
  }, [isSignedIn, portfolioHistory, sellHistory, watchlist, exchangeRates, triggerAutoSave, setAssets, setError, setSuccessMessage]);

  // 자산 삭제
  const handleDeleteAsset = useCallback((assetId: string) => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 자산을 삭제할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }
    setAssets(prevAssets => {
      const updated = prevAssets.filter(asset => asset.id !== assetId);
      triggerAutoSave(updated, portfolioHistory, sellHistory, watchlist, exchangeRates);
      return updated;
    });
    setEditingAsset(null);
  }, [isSignedIn, portfolioHistory, sellHistory, watchlist, exchangeRates, triggerAutoSave, setAssets, setError]);

  // 자산 수정
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
              currency: d.currency || finalAsset.currency,
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
          triggerAutoSave(updated, portfolioHistory, sellHistory, watchlist, exchangeRates);
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
  }, [isSignedIn, assets, portfolioHistory, sellHistory, watchlist, exchangeRates, triggerAutoSave, setAssets, setError]);

  // 자산 매도
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
      
      triggerAutoSave(updatedAssets, portfolioHistory, sellHistory, watchlist, exchangeRates);
    } catch (error) {
      console.error('Failed to sell asset:', error);
      setError('매도 처리 중 오류가 발생했습니다.');
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  }, [isSignedIn, assets, portfolioHistory, sellHistory, watchlist, exchangeRates, triggerAutoSave, setAssets, setSellHistory, setError, setSuccessMessage]);

  // CSV 업로드
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
                                      currency: d.currency || form.currency,
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
                        } catch (error: unknown) {
                            errors.push({
                                ticker: form.ticker,
                                reason: error instanceof Error ? error.message : '데이터 조회 실패',
                            });
                        }
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                    
                    setAssets(prev => {
                        const updated = [...prev, ...newAssets];
                        triggerAutoSave(updated, portfolioHistory, sellHistory, watchlist, exchangeRates);
                        return updated;
                    });
                    successCount = newAssets.length;
                }
                
                failedCount = errors.length;
                resolve({ successCount, failedCount, errors });

            } catch (err: unknown) {
                resolve({ successCount: 0, failedCount: lines.length > 1 ? lines.length - 1 : 0, errors: [{ ticker: '파일 전체', reason: err instanceof Error ? err.message : '파일 처리 실패' }] });
            }
        };

        reader.onerror = () => {
             resolve({ successCount: 0, failedCount: 0, errors: [{ ticker: '파일 읽기 오류', reason: '파일을 읽는 데 실패했습니다.' }] });
        };
        
        reader.readAsText(file);
    });
  }, [isSignedIn, portfolioHistory, sellHistory, watchlist, exchangeRates, triggerAutoSave, setAssets]);

  // 관심종목 추가
  const handleAddWatchItem = useCallback((payload: Omit<WatchlistItem, 'id' | 'currentPrice' | 'priceOriginal' | 'currency' | 'yesterdayPrice' | 'highestPrice' | 'lastSignalAt' | 'lastSignalType'>) => {
    const id = `${Date.now()}`;
    const item: WatchlistItem = { ...payload, id } as WatchlistItem;
    setWatchlist(prev => {
      const exists = prev.some(w => w.ticker.toUpperCase() === item.ticker.toUpperCase() && normalizeExchange(w.exchange) === normalizeExchange(item.exchange));
      const next = exists ? prev : [...prev, item];
      triggerAutoSave(assets, portfolioHistory, sellHistory, next, exchangeRates);
      return next;
    });
  }, [assets, portfolioHistory, sellHistory, exchangeRates, triggerAutoSave, setWatchlist]);

  // 관심종목 수정
  const handleUpdateWatchItem = useCallback((item: WatchlistItem) => {
    setWatchlist(prev => {
      const next = prev.map(w => (w.id === item.id ? item : w));
      triggerAutoSave(assets, portfolioHistory, sellHistory, next, exchangeRates);
      return next;
    });
  }, [assets, portfolioHistory, sellHistory, exchangeRates, triggerAutoSave, setWatchlist]);

  // 관심종목 삭제
  const handleDeleteWatchItem = useCallback((id: string) => {
    setWatchlist(prev => {
      const next = prev.filter(w => w.id !== id);
      triggerAutoSave(assets, portfolioHistory, sellHistory, next, exchangeRates);
      return next;
    });
  }, [assets, portfolioHistory, sellHistory, exchangeRates, triggerAutoSave, setWatchlist]);

  // 관심종목 일괄 삭제
  const handleBulkDeleteWatchItems = useCallback((ids: string[]) => {
    setWatchlist(prev => {
      const remove = new Set(ids);
      const next = prev.filter(w => !remove.has(w.id));
      triggerAutoSave(assets, portfolioHistory, sellHistory, next, exchangeRates);
      return next;
    });
  }, [assets, portfolioHistory, sellHistory, exchangeRates, triggerAutoSave, setWatchlist]);

  // 포트폴리오에서 관심종목으로 추가
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
      triggerAutoSave(assets, portfolioHistory, sellHistory, next, exchangeRates);
      return next;
    });
  }, [assets, portfolioHistory, sellHistory, exchangeRates, triggerAutoSave, setWatchlist]);

  // 관심종목 모니터링 토글
  const handleToggleWatchMonitoring = useCallback((id: string, enabled: boolean) => {
    setWatchlist(prev => prev.map(w => (w.id === id ? { ...w, monitoringEnabled: enabled } : w)));
  }, [setWatchlist]);

  return {
    isLoading,
    editingAsset,
    setEditingAsset,
    sellingAsset,
    setSellingAsset,
    handleAddAsset,
    handleDeleteAsset,
    handleUpdateAsset,
    handleConfirmSell,
    handleCsvFileUpload,
    handleAddWatchItem,
    handleUpdateWatchItem,
    handleDeleteWatchItem,
    handleBulkDeleteWatchItems,
    handleAddAssetsToWatchlist,
    handleToggleWatchMonitoring
  };
};
