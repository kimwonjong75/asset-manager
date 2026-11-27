import { useCallback, useRef, useState } from 'react';
import { Asset, AssetCategory, BulkUploadResult, Currency, ExchangeRates, NewAssetForm, SellRecord, WatchlistItem, normalizeExchange } from '../types';
import type { PortfolioSaveSnapshot } from '../types/portfolioSave';
import type { LinkTurtleBuy } from '../types/turtleHoldingsActions';
import { afterFullHoldingSale } from '../utils/turtleHoldingsState';
import { holdingPolicyStartDate } from '../utils/holdingPolicyEdit';
import { hasDifferentTurtleFillCurrency } from '../utils/holdingTradeCurrency';
import { localDateString } from '../utils/localDate';
import { isBaseType, DEFAULT_CATEGORIES, getCategoryIdByName } from '../types/category';
import { fetchAssetData as fetchAssetDataNew, fetchExchangeRate, fetchExchangeRateJPY, fetchHistoricalExchangeRate, fetchCurrentExchangeRate } from '../services/priceService';
import { createLogger } from '../utils/logger';
import type { AddAssetResult, SellResult, BuyMoreResult } from '../types/assetActionResult';
import type { PortfolioPatch } from '../types/store';
import type { TradePlan } from '../types/tradePlan';
import { buildSellMutation, buildBuyMoreMutation, buildBuyRecord } from '../utils/assetMutations';
import { ALL_OWNERS, DEFAULT_OWNER, getAssetOwner, OWNER_LABELS } from '../types/owner';
import { hasUnresolvedOwners, sameOwnerInstrument } from '../utils/ownerHoldings';
import { formatOwnerQuantity } from '../utils/ownerQuantity';
// 환율 이상치 상한은 utils/portfolioMetrics 가 단일 정의처 (구 로컬 복사본 제거 — 값 동일)
import { MAX_REASONABLE_EXCHANGE_RATES } from '../utils/portfolioMetrics';

const log = createLogger('AssetActions');

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validFillDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > localDateString()) return false;
  const utc = new Date(value + 'T00:00:00Z');
  return Number.isFinite(utc.getTime()) && utc.toISOString().slice(0, 10) === value;
}

function conflictsWithHolding(existing: Asset, candidate: Asset): boolean {
  return sameOwnerInstrument(existing, candidate) &&
    (hasUnresolvedOwners(existing) || getAssetOwner(existing) === getAssetOwner(candidate));
}

interface UseAssetActionsProps {
  assets: Asset[];
  exchangeRates: ExchangeRates;
  isSignedIn: boolean;
  /** 최신 스냅샷 읽기 — setState 업데이터 밖에서 next 상태를 계산하기 위한 창구 */
  getSnapshot: () => PortfolioSaveSnapshot;
  commitPortfolioPatch: (patch: PortfolioPatch) => void;
  setError: (msg: string | null) => void;
  setSuccessMessage: (msg: string | null) => void;
}

export const useAssetActions = ({
  assets,
  exchangeRates,
  isSignedIn,
  getSnapshot,
  commitPortfolioPatch,
  setError,
  setSuccessMessage
}: UseAssetActionsProps) => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [sellingAsset, setSellingAsset] = useState<Asset | null>(null);
  const [buyingAsset, setBuyingAsset] = useState<Asset | null>(null);
  const activeTrades = useRef(new Set<string>());

  // 자산 추가 - [수정] name 파라미터 추가
  const handleAddAsset = useCallback(async (newAssetData: NewAssetForm & { name?: string }, sourceAssetId?: string, linkTurtle?: LinkTurtleBuy): Promise<AddAssetResult> => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 자산을 추가할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return { ok: false, reason: 'not-signed-in' };
    }
    setIsLoading(true);
    setError(null);
    try {
      if (!isPositive(newAssetData.quantity) || !isPositive(newAssetData.purchasePrice) || !validFillDate(newAssetData.purchaseDate)) {
        setError('매수일과 0보다 큰 수량·단가를 입력해 주세요.');
        return { ok: false, reason: 'invalid-fill' };
      }
      let newAsset: Omit<Asset, 'id'>;
      if (sourceAssetId) {
        // 상대 보유자의 첫 매수. RP 같은 수동 관리 자산도 같은 상품으로 남도록 원래 식별자·시세만 공유한다.
        const source = getSnapshot().assets.find(a => a.id === sourceAssetId);
        if (!source || hasUnresolvedOwners(source) || getAssetOwner(source) === getAssetOwner(newAssetData)) {
          setError('기존 종목과 거래할 보유자를 다시 확인해 주세요.');
          return { ok: false, reason: 'holding-changed' };
        }
        const purchaseExchangeRate = source.currency === Currency.KRW ? 1 :
          await fetchHistoricalExchangeRate(newAssetData.purchaseDate, source.currency, Currency.KRW);
        newAsset = {
          ...newAssetData, ticker: source.ticker, exchange: source.exchange, categoryId: source.categoryId,
          name: source.name, currency: source.currency, purchaseExchangeRate,
          currentPrice: source.currentPrice, priceOriginal: source.priceOriginal, highestPrice: source.highestPrice,
          previousClosePrice: source.previousClosePrice, changeRate: source.changeRate, indicators: source.indicators,
          quoteTradeAt: source.quoteTradeAt, quoteDate: source.quoteDate,
        };
      } else if (isBaseType(newAssetData.categoryId, 'CASH')) {
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
          quoteDate: d.quoteDate,
          quoteTradeAt: d.quoteTradeAt,
          indicators: d.indicators,
          highestPrice: currentPrice,
          purchaseExchangeRate,
          currency: hasDifferentTurtleFillCurrency(newAssetData.exchange, newAssetData.currency) ? newAssetData.currency : d.currency || newAssetData.currency,
        };
      }
      
      const finalNewAsset: Asset = {
        id: crypto.randomUUID(),
        ...newAsset,
        owner: getAssetOwner(newAssetData),
        bucket: newAssetData.bucket ?? 'CORE', // 전략 버킷 (미지정=코어)
      };

      // 원자 커밋 — assets set + 단일 autosave (미지정 도메인은 현재 상태로 저장)
      const snapshot = getSnapshot();
      if (sourceAssetId && !snapshot.assets.some(a => a.id === sourceAssetId && !hasUnresolvedOwners(a) && sameOwnerInstrument(a, finalNewAsset))) {
        setError('거래 도중 원래 종목이 변경됐습니다. 잔고를 확인해 주세요.');
        return { ok: false, reason: 'holding-changed' };
      }
      if (hasUnresolvedOwners(finalNewAsset) || snapshot.assets.some(a => conflictsWithHolding(a, finalNewAsset))) {
        setError('같은 종목의 보유자와 기존 잔고를 확인해 주세요. 이미 보유 중이면 추가매수를 이용해 주세요.');
        return { ok: false, reason: 'conflicting-holding' };
      }
      const nextAssets = [...snapshot.assets, finalNewAsset];
      const linked = linkTurtle?.(snapshot, finalNewAsset);
      if (linked && !linked.ok) return linked;
      const buyRecord = buildBuyRecord(finalNewAsset, {
        id: crypto.randomUUID(), buyDate: finalNewAsset.purchaseDate, buyPrice: finalNewAsset.purchasePrice,
        buyQuantity: finalNewAsset.quantity, buyExchangeRate: finalNewAsset.purchaseExchangeRate ?? 1,
      });
      commitPortfolioPatch({ assets: nextAssets, buyHistory: [...snapshot.buyHistory, buyRecord], turtlePositions: linked?.positions });
      setSuccessMessage(`${finalNewAsset.name} 자산이 추가되었습니다.`);
      return { ok: true, assetId: finalNewAsset.id, asset: finalNewAsset, nextAssets };
    } catch (e) {
      log.error(e);
      setError('자산 정보를 가져오는 데 실패했습니다. 티커, 거래소, 날짜를 확인해주세요.');
      setTimeout(() => setError(null), 3000);
      return { ok: false, reason: 'fetch-failed' };
    } finally {
      setIsLoading(false);
    }
  }, [isSignedIn, getSnapshot, commitPortfolioPatch, setError, setSuccessMessage]);

  // 자산 삭제
  const handleDeleteAsset = useCallback((assetId: string) => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 자산을 삭제할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }
    // 업데이터 밖에서 최신 스냅샷으로 계산 → 단일 커밋(setState+저장). 업데이터는 순수하게 유지.
    commitPortfolioPatch({ assets: getSnapshot().assets.filter(asset => asset.id !== assetId) });
    setEditingAsset(null);
  }, [isSignedIn, getSnapshot, commitPortfolioPatch, setError]);

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
      
      if (isBaseType(updatedAsset.categoryId, 'CASH')) {
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
              quoteDate: d.quoteDate,
              quoteTradeAt: d.quoteTradeAt,
              indicators: d.indicators,
              currency: hasDifferentTurtleFillCurrency(finalAsset.exchange, finalAsset.currency) ? finalAsset.currency : d.currency || finalAsset.currency,
              highestPrice: Math.max(finalAsset.highestPrice, newCurrentPrice),
            };
          }
          
          if (infoChanged || dateOrCurrencyChanged) {
            const purchaseExchangeRate = await fetchHistoricalExchangeRate(finalAsset.purchaseDate, finalAsset.currency, Currency.KRW);
            finalAsset = { ...finalAsset, purchaseExchangeRate };
          }
      }
      
      const latest = getSnapshot().assets;
      const live = latest.find(a => a.id === finalAsset.id);
      if (!live || live.quantity !== originalAsset.quantity || getAssetOwner(live) !== getAssetOwner(originalAsset)) {
        setError('편집 중 보유자 또는 수량이 변경됐습니다. 최신 잔고에서 다시 수정해 주세요.');
        return;
      }
      if (latest.some(a => a.id !== finalAsset.id && conflictsWithHolding(a, finalAsset))) {
        setError('같은 보유자의 동일 종목 잔고가 이미 있습니다. 보유자를 확인해 주세요.');
        return;
      }
      // A delayed edit must preserve a newly saved/armed strategy, and never copy it to another owner or ticker.
      const identityChanged = getAssetOwner(live) !== getAssetOwner(finalAsset) ||
        live.ticker !== finalAsset.ticker || live.exchange !== finalAsset.exchange || live.currency !== finalAsset.currency;
      finalAsset.holdingPolicy = identityChanged ? undefined : live.holdingPolicy;
      if (finalAsset.holdingPolicy && (live.purchasePrice !== finalAsset.purchasePrice ||
          live.purchaseDate !== finalAsset.purchaseDate || live.purchaseExchangeRate !== finalAsset.purchaseExchangeRate)) {
        finalAsset.holdingPolicy = { ...finalAsset.holdingPolicy, confirmedUnitCostKRW: undefined,
          cycleId: crypto.randomUUID(), startedOn: holdingPolicyStartDate(finalAsset.exchange, new Date()),
          requiresCostConfirmation: finalAsset.currency !== Currency.KRW };
      }
      commitPortfolioPatch({ assets: latest.map(a => (a.id === finalAsset.id ? finalAsset : a)) });
      setSuccessMessage(`${finalAsset.name} 자산이 수정되었습니다.`);
    } catch (e) {
      log.error(e);
      setError('자산 수정 중 오류가 발생했습니다.');
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
      setEditingAsset(null);
    }
  }, [isSignedIn, assets, getSnapshot, commitPortfolioPatch, setError, setSuccessMessage]);

  // 매도 확정
  const handleConfirmSell = useCallback(async (
    assetId: string,
    sellQuantity: number,
    sellPrice: number,
    sellDate: string,
    settlementCurrency?: Currency,
    legacyWatch = false,
  ): Promise<SellResult> => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 매도를 기록할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return { ok: false, reason: 'not-signed-in' };
    }

    const asset = getSnapshot().assets.find(a => a.id === assetId);
    if (!asset) {
      setError('해당 자산을 찾을 수 없습니다.');
      setTimeout(() => setError(null), 3000);
      return { ok: false, reason: 'asset-not-found' };
    }

    if (hasUnresolvedOwners(asset) || activeTrades.current.has(assetId)) {
      setError('보유자별 수량을 먼저 확정하거나 진행 중인 거래가 끝난 후 기록해 주세요.');
      return { ok: false, reason: 'holding-unavailable' };
    }
    if (!isPositive(sellQuantity) || !isPositive(sellPrice) || !validFillDate(sellDate)) {
      setError('매도일과 0보다 큰 수량·단가를 입력해 주세요.');
      return { ok: false, reason: 'invalid-fill' };
    }
    if (sellQuantity > asset.quantity) {
      setError('매도 수량이 보유 수량을 초과합니다.');
      setTimeout(() => setError(null), 3000);
      return { ok: false, reason: 'quantity-exceeds' };
    }

    setIsLoading(true);
    setError(null);

    try {
      activeTrades.current.add(assetId);
      const finalSettlementCurrency = settlementCurrency || asset.currency;
      let sellExchangeRate = 1;

      if (finalSettlementCurrency !== Currency.KRW) {
        sellExchangeRate = await fetchHistoricalExchangeRate(sellDate, finalSettlementCurrency, Currency.KRW);
        const maxRate = MAX_REASONABLE_EXCHANGE_RATES[finalSettlementCurrency];
        if (maxRate && sellExchangeRate > maxRate) {
          log.warn(`비정상적인 역사적 환율 감지: ${finalSettlementCurrency}/KRW = ${sellExchangeRate}. 현재 앱 환율로 대체합니다.`);
          sellExchangeRate = (finalSettlementCurrency === Currency.USD ? exchangeRates.USD : exchangeRates.JPY) || sellExchangeRate;
        }
      }

      // 다음상태 계산은 공용 순수 helper에 위임(터틀 실행과 동일 로직 공유), 원자 커밋으로 저장
      const snapshot = getSnapshot();
      const live = snapshot.assets.find(a => a.id === assetId);
      if (!live || hasUnresolvedOwners(live) || live.currency !== asset.currency || getAssetOwner(live) !== getAssetOwner(asset) || sellQuantity > live.quantity) {
        setError('보유자 또는 매도 가능 수량이 변경됐습니다. 잔고를 확인해 주세요.');
        return { ok: false, reason: 'holding-changed' };
      }
      const mut = buildSellMutation({
        asset: live, assets: snapshot.assets, sellHistory: snapshot.sellHistory,
        sellExchangeRate, sellPrice, sellQuantity, sellDate,
        settlementCurrency: finalSettlementCurrency,
        transactionId: crypto.randomUUID(),
      });
      const holdingSale = mut.assetClosed ? afterFullHoldingSale(live, sellDate, mut.sellRecord.sellPriceOriginal ?? 0,
        legacyWatch, snapshot.watchlist, snapshot.turtlePositions, () => crypto.randomUUID()) : undefined;
      commitPortfolioPatch({
        assets: mut.nextAssets, sellHistory: mut.nextSellHistory,
        watchlist: holdingSale?.watchlist, turtlePositions: holdingSale?.turtlePositions,
      });

      const watchMessage = holdingSale?.watchItemId ? ' 재매수 감시를 시작합니다.' : '';
      setSuccessMessage(`${OWNER_LABELS[getAssetOwner(live)]} · ${live.name} ${formatOwnerQuantity(live, sellQuantity)} 매도가 기록되었습니다.${watchMessage}`);
      return {
        ok: true,
        sellRecordId: mut.sellRecord.id,
        sellRecord: mut.sellRecord,
        assetClosed: mut.assetClosed,
        updatedAsset: mut.assetClosed ? undefined : mut.nextAssets.find(a => a.id === asset.id),
        nextAssets: mut.nextAssets,
        nextSellHistory: mut.nextSellHistory,
        holdingSale,
      };
    } catch (e) {
      log.error(e);
      setError('매도 처리 중 오류가 발생했습니다.');
      setTimeout(() => setError(null), 3000);
      return { ok: false, reason: 'sell-failed' };
    } finally {
      activeTrades.current.delete(assetId);
      setIsLoading(false);
      setSellingAsset(null);
    }
  }, [isSignedIn, getSnapshot, commitPortfolioPatch, exchangeRates, setError, setSuccessMessage]);

  // 매도 기록 편집 — sellDate / sellPriceSettlement / sellQuantity 변경. KRW 값 재계산.
  // 날짜가 바뀌면 환율 재조회, 가격/수량만 바뀌면 기존 sellExchangeRate 재사용.
  // 부분매도였던 자산이 아직 존재하면 수량 차이만큼 보유수량을 조정.
  const handleEditSellRecord = useCallback(async (
    recordId: string,
    patch: { sellDate?: string; sellPriceSettlement?: number; sellQuantity?: number }
  ) => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 매도 기록을 수정할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }

    const record = getSnapshot().sellHistory.find(r => r.id === recordId);
    if (!record) {
      setError('해당 매도 기록을 찾을 수 없습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const newSellDate = patch.sellDate ?? record.sellDate;
      const newSellPriceSettlement = patch.sellPriceSettlement ?? record.sellPriceSettlement ?? record.sellPriceOriginal ?? 0;
      const newSellQuantity = patch.sellQuantity ?? record.sellQuantity;

      if (newSellPriceSettlement <= 0) {
        setError('매도가는 0보다 커야 합니다.');
        setTimeout(() => setError(null), 3000);
        return;
      }
      if (newSellQuantity <= 0) {
        setError('매도 수량은 0보다 커야 합니다.');
        setTimeout(() => setError(null), 3000);
        return;
      }

      const settlementCurrency = record.settlementCurrency || record.originalCurrency || Currency.KRW;

      let sellExchangeRate = record.sellExchangeRate || 1;
      const dateChanged = newSellDate !== record.sellDate;
      if (dateChanged && settlementCurrency !== Currency.KRW) {
        sellExchangeRate = await fetchHistoricalExchangeRate(newSellDate, settlementCurrency, Currency.KRW);
        const maxRate = MAX_REASONABLE_EXCHANGE_RATES[settlementCurrency];
        if (maxRate && sellExchangeRate > maxRate) {
          log.warn(`비정상적인 역사적 환율 감지: ${settlementCurrency}/KRW = ${sellExchangeRate}. 현재 앱 환율로 대체합니다.`);
          sellExchangeRate = (settlementCurrency === Currency.USD ? exchangeRates.USD : exchangeRates.JPY) || sellExchangeRate;
        }
      }

      const originalCurrency = record.originalCurrency || settlementCurrency;
      const sellPriceKRW = newSellPriceSettlement * sellExchangeRate;
      const sellPriceOriginal = originalCurrency !== Currency.KRW && originalCurrency === settlementCurrency
        ? newSellPriceSettlement
        : newSellPriceSettlement / sellExchangeRate;

      const updatedRecord: SellRecord = {
        ...record,
        sellDate: newSellDate,
        sellPrice: sellPriceKRW,
        sellPriceOriginal,
        sellPriceSettlement: newSellPriceSettlement,
        sellQuantity: newSellQuantity,
        sellExchangeRate,
        settlementCurrency,
      };

      const snapshot = getSnapshot();
      if (snapshot.sellHistory.find(r => r.id === recordId) !== record) {
        setError('매도 기록이 변경됐습니다. 최신 기록을 다시 확인해 주세요.');
        return;
      }
      const quantityDelta = newSellQuantity - record.sellQuantity;
      const newSellHistory = snapshot.sellHistory.map(r => (r.id === recordId ? updatedRecord : r));

      // 업데이터 밖에서 계산한다 — 예전에는 여기서 throw 까지 해서 업데이터가 순수하지 않았다.
      const updatedAssets = snapshot.assets.map(a => {
        if (a.id !== record.assetId) return a;
        if (quantityDelta && (hasUnresolvedOwners(a) || (record.owner && record.owner !== getAssetOwner(a)))) {
          throw new Error('이 매도 기록의 수량을 변경하려면 당시 보유자의 잔고를 먼저 확인해 주세요.');
        }
        const newInline = (a.sellTransactions || []).map(t => {
          if (t.id !== recordId) return t;
          return {
            ...t,
            sellDate: newSellDate,
            sellPrice: sellPriceKRW,
            sellPriceOriginal,
            sellPriceSettlement: newSellPriceSettlement,
            sellQuantity: newSellQuantity,
            sellExchangeRate,
            settlementCurrency,
          };
        });
        // 부분매도였던 자산이 살아있는 경우에만 보유수량 조정
        const adjustedQuantity = a.quantity - quantityDelta;
        if (adjustedQuantity < 0) {
          throw new Error('변경된 매도 수량이 현재 보유 수량보다 큽니다.');
        }
        return { ...a, quantity: adjustedQuantity, sellTransactions: newInline };
      });
      commitPortfolioPatch({ assets: updatedAssets, sellHistory: newSellHistory });

      setSuccessMessage('매도 기록이 수정되었습니다.');
    } catch (e) {
      log.error(e);
      const msg = e instanceof Error ? e.message : '매도 기록 수정 중 오류가 발생했습니다.';
      setError(msg);
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  }, [isSignedIn, exchangeRates, getSnapshot, commitPortfolioPatch, setError, setSuccessMessage]);

  // 매도 기록 삭제 — sellHistory + asset.sellTransactions 양쪽에서 제거. 보유수량 복구는 하지 않음.
  const handleDeleteSellRecord = useCallback((recordId: string) => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 매도 기록을 삭제할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }

    const snapshot = getSnapshot();
    const record = snapshot.sellHistory.find(r => r.id === recordId);
    if (!record) {
      setError('해당 매도 기록을 찾을 수 없습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }

    const newSellHistory = snapshot.sellHistory.filter(r => r.id !== recordId);
    const updatedAssets = snapshot.assets.map(a => {
      if (a.id !== record.assetId) return a;
      return {
        ...a,
        sellTransactions: (a.sellTransactions || []).filter(t => t.id !== recordId),
      };
    });
    commitPortfolioPatch({ assets: updatedAssets, sellHistory: newSellHistory });

    setSuccessMessage('매도 기록이 삭제되었습니다.');
  }, [isSignedIn, getSnapshot, commitPortfolioPatch, setError, setSuccessMessage]);

  // 추가매수 확정
  const handleConfirmBuyMore = useCallback(async (
    assetId: string,
    buyQuantity: number,
    buyPrice: number,
    buyDate: string,
    linkTurtle?: LinkTurtleBuy,
  ): Promise<BuyMoreResult> => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 추가매수를 기록할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return { ok: false, reason: 'not-signed-in' };
    }

    const asset = getSnapshot().assets.find(a => a.id === assetId);
    if (!asset) {
      setError('해당 자산을 찾을 수 없습니다.');
      setTimeout(() => setError(null), 3000);
      return { ok: false, reason: 'asset-not-found' };
    }

    if (hasUnresolvedOwners(asset) || activeTrades.current.has(assetId)) {
      setError('보유자별 수량을 먼저 확정하거나 진행 중인 거래가 끝난 후 기록해 주세요.');
      return { ok: false, reason: 'holding-unavailable' };
    }
    if (!isPositive(buyQuantity) || !isPositive(buyPrice) || !validFillDate(buyDate)) {
      setError('매수일과 0보다 큰 수량·단가를 입력해 주세요.');
      return { ok: false, reason: 'invalid-fill' };
    }
    activeTrades.current.add(assetId);
    setIsLoading(true);
    setError(null);

    try {
      // 외화 자산의 경우 매수일 환율 조회
      let buyExchangeRate = 1;
      if (asset.currency !== Currency.KRW) {
        buyExchangeRate = await fetchHistoricalExchangeRate(buyDate, asset.currency, Currency.KRW);
      }

      // 다음상태 계산은 공용 순수 helper에 위임(가중평균 단가·환율·메모), 원자 커밋으로 저장
      const snapshot = getSnapshot();
      const live = snapshot.assets.find(a => a.id === assetId);
      if (!live || hasUnresolvedOwners(live) || live.currency !== asset.currency || getAssetOwner(live) !== getAssetOwner(asset)) {
        setError('거래 대상 잔고가 변경됐습니다. 보유자를 다시 확인해 주세요.');
        return { ok: false, reason: 'holding-changed' };
      }
      const mut = buildBuyMoreMutation({ asset: live, assets: snapshot.assets, buyExchangeRate, buyPrice, buyQuantity, buyDate });
      const buyRecord = buildBuyRecord(live, { id: crypto.randomUUID(), buyExchangeRate, buyPrice, buyQuantity, buyDate });
      const linked = linkTurtle?.(snapshot, live);
      if (linked && !linked.ok) return linked;
      commitPortfolioPatch({ assets: mut.nextAssets, buyHistory: [...snapshot.buyHistory, buyRecord], turtlePositions: linked?.positions });

      setSuccessMessage(`${OWNER_LABELS[getAssetOwner(live)]} · ${live.customName?.trim() || live.name} ${formatOwnerQuantity(live, buyQuantity)} 추가매수가 기록되었습니다.`);
      return { ok: true, assetId, updatedAsset: mut.updatedAsset, nextAssets: mut.nextAssets };
    } catch (e) {
      log.error(e);
      setError('추가매수 처리 중 오류가 발생했습니다.');
      setTimeout(() => setError(null), 3000);
      return { ok: false, reason: 'buy-more-failed' };
    } finally {
      activeTrades.current.delete(assetId);
      setIsLoading(false);
      setBuyingAsset(null);
    }
  }, [isSignedIn, getSnapshot, commitPortfolioPatch, setError, setSuccessMessage]);

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
                const ownerIdx = headers.findIndex(h => ['owner', '보유자', '소유 계정', '계정'].includes(h));
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
                    const ownerText = ownerIdx >= 0 ? cols[ownerIdx] : '';
                    const owner = ownerText
                      ? ALL_OWNERS.find(key => key === ownerText.toUpperCase() || OWNER_LABELS[key] === ownerText)
                      : DEFAULT_OWNER;
                    const sellAlertDropRateStr = hasSellAlertRate ? cols[sellAlertRateIdx] : undefined;

                    if (!ticker || !exchange || !quantityStr || !priceStr || !dateStr || !categoryStr || !currencyStr) {
                        return { error: '필수 필드 누락', ticker: ticker || '알 수 없음' };
                    }

                    const allCatNames = DEFAULT_CATEGORIES.map(c => c.name);
                    if (!allCatNames.includes(categoryStr)) {
                        return { error: `유효하지 않은 카테고리: ${categoryStr}`, ticker };
                    }

                    if (!Object.values(Currency).includes(currencyStr as Currency)) {
                        return { error: `유효하지 않은 통화: ${currencyStr}`, ticker };
                    }
                    if (!owner) return { error: '보유자는 원종 또는 유선으로 입력해 주세요.', ticker };
                    if (!isPositive(Number(quantityStr)) || !isPositive(Number(priceStr))) {
                      return { error: '수량·단가는 0보다 큰 숫자여야 합니다.', ticker };
                    }
                    
                    const catId = getCategoryIdByName(categoryStr, DEFAULT_CATEGORIES) ?? 4; // fallback: 기타해외주식
                    const form: NewAssetForm & { sellAlertDropRate?: number } = {
                        owner,
                        ticker,
                        exchange,
                        quantity: parseFloat(quantityStr),
                        purchasePrice: parseFloat(priceStr),
                        purchaseDate: dateStr,
                        category: categoryStr as AssetCategory,
                        categoryId: catId,
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
                                      quoteDate: d.quoteDate,
                                      quoteTradeAt: d.quoteTradeAt,
                                      indicators: d.indicators,
                                      currency: d.currency || form.currency,
                                      highestPrice: currentPrice,
                                      purchaseExchangeRate,
                                  };
                              }
                            
                            const finalNewAsset: Asset = {
                                id: crypto.randomUUID(),
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
                    
                    const nextAssets = [...getSnapshot().assets];
                    for (const candidate of newAssets) {
                      if (nextAssets.some(a => conflictsWithHolding(a, candidate))) {
                        errors.push({ ticker: candidate.ticker, reason: '동일 보유자 또는 미분리 공동 잔고가 이미 있습니다.' });
                      } else {
                        nextAssets.push(candidate);
                        successCount++;
                      }
                    }
                    if (successCount) commitPortfolioPatch({ assets: nextAssets });
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
  }, [isSignedIn, getSnapshot, commitPortfolioPatch]);

  // 관심종목 추가
  const handleAddWatchItem = useCallback((payload: Omit<WatchlistItem, 'id' | 'currentPrice' | 'priceOriginal' | 'currency' | 'previousClosePrice' | 'highestPrice'>) => {
    const id = `${Date.now()}`;
    const item: WatchlistItem = { ...payload, id } as WatchlistItem;
    const cur = getSnapshot().watchlist;
    const exists = cur.some(w => w.ticker.toUpperCase() === item.ticker.toUpperCase() && normalizeExchange(w.exchange) === normalizeExchange(item.exchange));
    commitPortfolioPatch({ watchlist: exists ? cur : [...cur, item] });
  }, [getSnapshot, commitPortfolioPatch]);

  // 관심종목 추가 + 매매 계획을 한 커밋으로 (P2c — TradePlanPlanner "관심종목에 계획과 함께 저장")
  const handleAddWatchItemWithPlan = useCallback((
    payload: Omit<WatchlistItem, 'id' | 'currentPrice' | 'priceOriginal' | 'currency' | 'previousClosePrice' | 'highestPrice'>,
    plan: TradePlan
  ) => {
    const id = `${Date.now()}`;
    const item: WatchlistItem = { ...payload, id, tradePlan: plan } as WatchlistItem;
    const cur = getSnapshot().watchlist;
    const exists = cur.some(w => w.ticker.toUpperCase() === item.ticker.toUpperCase() && normalizeExchange(w.exchange) === normalizeExchange(item.exchange));
    commitPortfolioPatch({ watchlist: exists ? cur : [...cur, item] });
  }, [getSnapshot, commitPortfolioPatch]);

  // 관심종목 수정
  const handleUpdateWatchItem = useCallback((item: WatchlistItem) => {
    commitPortfolioPatch({ watchlist: getSnapshot().watchlist.map(w => (w.id === item.id ? item : w)) });
  }, [getSnapshot, commitPortfolioPatch]);

  // 관심종목 삭제
  const handleDeleteWatchItem = useCallback((id: string) => {
    commitPortfolioPatch({ watchlist: getSnapshot().watchlist.filter(w => w.id !== id) });
  }, [getSnapshot, commitPortfolioPatch]);

  // 관심종목 일괄 삭제
  const handleBulkDeleteWatchItems = useCallback((ids: string[]) => {
    const remove = new Set(ids);
    commitPortfolioPatch({ watchlist: getSnapshot().watchlist.filter(w => !remove.has(w.id)) });
  }, [getSnapshot, commitPortfolioPatch]);

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
    handleEditSellRecord,
    handleDeleteSellRecord,
    handleConfirmBuyMore,
    handleCsvFileUpload,
    handleAddWatchItem,
    handleAddWatchItemWithPlan,
    handleUpdateWatchItem,
    handleDeleteWatchItem,
    handleBulkDeleteWatchItems,
  };
};
