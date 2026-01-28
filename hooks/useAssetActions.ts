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
  const [buyingAsset, setBuyingAsset] = useState<Asset | null>(null);

  // 자산 추가 - [수정] name 파라미터 추가
  const handleAddAsset = useCallback(async (newAssetData: NewAssetForm & { name?: string }) => {
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
        
        // [핵심 수정] 전달받은 name이 있으면 우선 사용, 없으면 API 응답 사용
        const assetName = newAssetData.name || d.name;
        
        newAsset = {
          ...newAssetData,
          name: assetName, // [수정] 우선순위: 전달받은 name > API name > ticker
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
            
            // [수정] 기존 이름이 ticker와 같으면(잘못 저장된 경우) API 이름으로 교체
            const shouldUpdateName = originalAsset.name === originalAsset.ticker || infoChanged;
            
            finalAsset = {
              ...finalAsset,
              name: shouldUpdateName ? d.name : finalAsset.name,
              currentPrice: newCurrentPrice,
              priceOriginal: d.priceOriginal,
              currency: d.currency || finalAsset.currency,
              highestPrice: Math.max(finalAsset.highestPrice, newCurrentPrice),
            };
          }
          
          if (infoChanged || dateOrCurrencyChanged) {
            const purchaseExchangeRate = await fetchHistoricalExchangeRate(finalAsset.purchaseDate, finalAsset.currency, Currency.KRW);
            finalAsset = { ...finalAsset, purchaseExchangeRate };
          }
      }
      
      setAssets(prevAssets => {
        const updated = prevAssets.map(a => (a.id === finalAsset.id ? finalAsset : a));
        triggerAutoSave(updated, portfolioHistory, sellHistory, watchlist, exchangeRates);
        return updated;
      });
      setSuccessMessage(`${finalAsset.name} 자산이 수정되었습니다.`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (e) {
      console.error(e);
      setError('자산 수정 중 오류가 발생했습니다.');
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
      setEditingAsset(null);
    }
  }, [isSignedIn, assets, portfolioHistory, sellHistory, watchlist, exchangeRates, triggerAutoSave, setAssets, setError, setSuccessMessage]);

  // 매도 확정
  const handleConfirmSell = useCallback(async (
    assetId: string,
    sellQuantity: number,
    sellPrice: number,
    sellDate: string,
    settlementCurrency?: Currency
  ) => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 매도를 기록할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }

    const asset = assets.find(a => a.id === assetId);
    if (!asset) {
      setError('해당 자산을 찾을 수 없습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }

    if (sellQuantity > asset.quantity) {
      setError('매도 수량이 보유 수량을 초과합니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const finalSettlementCurrency = settlementCurrency || asset.currency;
      let sellExchangeRate = 1;

      if (finalSettlementCurrency !== Currency.KRW) {
        sellExchangeRate = await fetchHistoricalExchangeRate(sellDate, finalSettlementCurrency, Currency.KRW);
      }

      const sellPriceSettlement = sellPrice;
      const sellPriceOriginal = asset.currency !== Currency.KRW && asset.currency === finalSettlementCurrency
        ? sellPrice
        : sellPrice / sellExchangeRate;

      const sellTransaction = {
        id: `${Date.now()}`,
        sellDate,
        sellPrice: sellPrice * sellExchangeRate,
        sellPriceOriginal,
        sellQuantity,
        sellExchangeRate,
        settlementCurrency: finalSettlementCurrency,
        sellPriceSettlement,
      };

      const sellRecord: SellRecord = {
        ...sellTransaction,
        assetId: asset.id,
        ticker: asset.ticker,
        name: asset.customName?.trim() || asset.name,
        category: asset.category,
        originalPurchasePrice: asset.purchasePrice,
        originalPurchaseExchangeRate: asset.purchaseExchangeRate,
        originalCurrency: asset.currency,
      };

      const newQuantity = asset.quantity - sellQuantity;

      setAssets(prevAssets => {
        let updated: Asset[];
        if (newQuantity <= 0) {
          updated = prevAssets.filter(a => a.id !== assetId);
        } else {
          updated = prevAssets.map(a => {
            if (a.id === assetId) {
              return {
                ...a,
                quantity: newQuantity,
                sellTransactions: [...(a.sellTransactions || []), sellTransaction],
              };
            }
            return a;
          });
        }
        
        const newSellHistory = [...sellHistory, sellRecord];
        setSellHistory(newSellHistory);
        triggerAutoSave(updated, portfolioHistory, newSellHistory, watchlist, exchangeRates);
        return updated;
      });

      setSuccessMessage(`${asset.name} ${sellQuantity}주 매도가 기록되었습니다.`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (e) {
      console.error(e);
      setError('매도 처리 중 오류가 발생했습니다.');
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
      setSellingAsset(null);
    }
  }, [isSignedIn, assets, portfolioHistory, sellHistory, watchlist, exchangeRates, triggerAutoSave, setAssets, setSellHistory, setError, setSuccessMessage]);

  // 추가매수 확정
  const handleConfirmBuyMore = useCallback(async (
    assetId: string,
    buyQuantity: number,
    buyPrice: number,
    buyDate: string
  ) => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 추가매수를 기록할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }

    const asset = assets.find(a => a.id === assetId);
    if (!asset) {
      setError('해당 자산을 찾을 수 없습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 외화 자산의 경우 매수일 환율 조회
      let buyExchangeRate = 1;
      if (asset.currency !== Currency.KRW) {
        buyExchangeRate = await fetchHistoricalExchangeRate(buyDate, asset.currency, Currency.KRW);
      }

      const oldQuantity = asset.quantity;
      const oldPrice = asset.purchasePrice;
      const newTotalQuantity = oldQuantity + buyQuantity;

      // 가중평균 매수단가 계산
      const newAvgPrice = (oldQuantity * oldPrice + buyQuantity * buyPrice) / newTotalQuantity;

      // 외화 자산의 경우 가중평균 환율 계산
      let newExchangeRate = asset.purchaseExchangeRate;
      if (asset.currency !== Currency.KRW && asset.purchaseExchangeRate) {
        newExchangeRate = (oldQuantity * asset.purchaseExchangeRate + buyQuantity * buyExchangeRate) / newTotalQuantity;
      }

      // 메모에 추가매수 이력 기재
      const d = new Date(buyDate);
      const dateStr = `${String(d.getFullYear()).slice(2)}.${d.getMonth() + 1}.${d.getDate()}`;
      const buyMemo = `(${dateStr} ${buyQuantity}주 ${buyPrice.toLocaleString()}${asset.currency !== Currency.KRW ? asset.currency : '원'} 추가매수)`;
      const newMemo = asset.memo ? `${asset.memo}\n${buyMemo}` : buyMemo;

      setAssets(prevAssets => {
        const updated = prevAssets.map(a => {
          if (a.id === assetId) {
            return {
              ...a,
              quantity: newTotalQuantity,
              purchasePrice: newAvgPrice,
              purchaseExchangeRate: newExchangeRate,
              memo: newMemo,
            };
          }
          return a;
        });
        triggerAutoSave(updated, portfolioHistory, sellHistory, watchlist, exchangeRates);
        return updated;
      });

      setSuccessMessage(`${asset.customName?.trim() || asset.name} ${buyQuantity}주 추가매수가 기록되었습니다.`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (e) {
      console.error(e);
      setError('추가매수 처리 중 오류가 발생했습니다.');
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
      setBuyingAsset(null);
    }
  }, [isSignedIn, assets, portfolioHistory, sellHistory, watchlist, exchangeRates, triggerAutoSave, setAssets, setError, setSuccessMessage]);

  // CSV 파일 업로드
  const handleCsvFileUpload = useCallback((file: File): Promise<BulkUploadResult> => {
    return new Promise((resolve) => {
        if (!isSignedIn) {
            resolve({ successCount: 0, failedCount: 0, errors: [{ ticker: '인증 오류', reason: 'Google Drive 로그인이 필요합니다.' }] });
            return;
        }
        
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const text = e.target?.result as string;
                const lines = text.split('\n').filter(line => line.trim());
                
                if (lines.length < 2) {
                    resolve({ successCount: 0, failedCount: 0, errors: [{ ticker: '파일 형식 오류', reason: '헤더와 데이터가 필요합니다.' }] });
                    return;
                }

                const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
                const tickerIdx = headers.findIndex(h => h === 'ticker' || h === '티커');
                const exchangeIdx = headers.findIndex(h => h === 'exchange' || h === '거래소');
                const quantityIdx = headers.findIndex(h => h === 'quantity' || h === '수량');
                const priceIdx = headers.findIndex(h => h === 'purchaseprice' || h === '매수가');
                const dateIdx = headers.findIndex(h => h === 'purchasedate' || h === '매수일');
                const categoryIdx = headers.findIndex(h => h === 'category' || h === '카테고리');
                const currencyIdx = headers.findIndex(h => h === 'currency' || h === '통화');
                const sellAlertRateIdx = headers.findIndex(h => h === 'sellalertdroprate' || h === '매도알림하락률');
                const hasSellAlertRate = sellAlertRateIdx !== -1;

                if (tickerIdx === -1 || exchangeIdx === -1 || quantityIdx === -1 || priceIdx === -1 || dateIdx === -1 || categoryIdx === -1 || currencyIdx === -1) {
                    resolve({ successCount: 0, failedCount: 0, errors: [{ ticker: '파일 형식 오류', reason: '필수 헤더가 누락되었습니다. (ticker, exchange, quantity, purchasePrice, purchaseDate, category, currency)' }] });
                    return;
                }

                let successCount = 0;
                let failedCount = 0;
                const errors: { ticker: string; reason: string }[] = [];

                const newAssetForms = lines.slice(1).map(line => {
                    const cols = line.split(',').map(c => c.trim());
                    const ticker = cols[tickerIdx];
                    const exchange = cols[exchangeIdx];
                    const quantityStr = cols[quantityIdx];
                    const priceStr = cols[priceIdx];
                    const dateStr = cols[dateIdx];
                    const categoryStr = cols[categoryIdx];
                    const currencyStr = cols[currencyIdx];
                    const sellAlertDropRateStr = hasSellAlertRate ? cols[sellAlertRateIdx] : undefined;

                    if (!ticker || !exchange || !quantityStr || !priceStr || !dateStr || !categoryStr || !currencyStr) {
                        return { error: '필수 필드 누락', ticker: ticker || '알 수 없음' };
                    }

                    if (!ALLOWED_CATEGORIES.includes(categoryStr as AssetCategory)) {
                        return { error: `유효하지 않은 카테고리: ${categoryStr}`, ticker };
                    }

                    if (!Object.values(Currency).includes(currencyStr as Currency)) {
                        return { error: `유효하지 않은 통화: ${currencyStr}`, ticker };
                    }
                    
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
                // lines 변수가 try 블록 안에 있어서 참조 불가 에러 발생
                // 에러 발생 시 전체 실패로 처리
                resolve({ 
                    successCount: 0, 
                    failedCount: 0, 
                    errors: [{ ticker: '파일 전체', reason: err instanceof Error ? err.message : '파일 처리 실패' }] 
                });
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
    buyingAsset,
    setBuyingAsset,
    handleAddAsset,
    handleDeleteAsset,
    handleUpdateAsset,
    handleConfirmSell,
    handleConfirmBuyMore,
    handleCsvFileUpload,
    handleAddWatchItem,
    handleUpdateWatchItem,
    handleDeleteWatchItem,
    handleBulkDeleteWatchItems,
    handleAddAssetsToWatchlist,
    handleToggleWatchMonitoring
  };
};