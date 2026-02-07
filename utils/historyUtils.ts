import { PortfolioSnapshot, SellRecord, Asset, AssetSnapshot, AssetCategory, Currency } from '../types';
import {
  fetchStockHistoricalPrices,
  fetchCryptoHistoricalPrices,
  fetchExchangeRateHistory,
  convertTickerForAPI,
  isCryptoExchange,
  HistoricalPriceResult,
} from '../services/historicalPriceService';

/**
 * 히스토리에서 누락된 날짜를 마지막 데이터로 보간
 * - 마지막 스냅샷과 오늘 사이의 빈 날짜를 채움
 * - 주말도 포함 (시장 휴장일 구분 없이)
 */
export const fillMissingDates = (history: PortfolioSnapshot[]): PortfolioSnapshot[] => {
  if (history.length === 0) return history;

  // 날짜순 정렬
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const lastSnapshot = sorted[sorted.length - 1];
  const lastDate = new Date(lastSnapshot.date);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 마지막 스냅샷이 오늘이거나 이후면 보간 불필요
  if (lastDate >= today) return sorted;

  const filled: PortfolioSnapshot[] = [...sorted];
  const current = new Date(lastDate);
  current.setDate(current.getDate() + 1);

  while (current < today) {
    filled.push({
      date: current.toISOString().slice(0, 10),
      assets: lastSnapshot.assets.map(a => ({ ...a })),
    });
    current.setDate(current.getDate() + 1);
  }

  return filled;
};

/**
 * 히스토리 중간에 빠진 날짜도 보간 (선형 보간 아닌 이전 값 복사)
 */
export const fillAllMissingDates = (history: PortfolioSnapshot[]): PortfolioSnapshot[] => {
  if (history.length < 2) return fillMissingDates(history);

  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const filled: PortfolioSnapshot[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    filled.push(current);

    if (i < sorted.length - 1) {
      const next = sorted[i + 1];
      const currentDate = new Date(current.date);
      const nextDate = new Date(next.date);

      // 연속된 날짜가 아니면 중간 채우기
      currentDate.setDate(currentDate.getDate() + 1);
      while (currentDate < nextDate) {
        filled.push({
          date: currentDate.toISOString().slice(0, 10),
          assets: current.assets.map(a => ({ ...a })),
        });
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }
  }

  // 마지막 스냅샷부터 오늘까지도 채우기
  return fillMissingDates(filled);
};

/**
 * 매도 기록을 최근 1년과 아카이브로 분리
 */
export const archiveOldSellHistory = (sellHistory: SellRecord[]): {
  recent: SellRecord[];
  archived: SellRecord[];
} => {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const cutoffDate = oneYearAgo.toISOString().slice(0, 10);

  const recent = sellHistory.filter(r => r.sellDate >= cutoffDate);
  const archived = sellHistory.filter(r => r.sellDate < cutoffDate);

  return { recent, archived };
};

/**
 * 히스토리를 연도별로 분리
 */
export const splitHistoryByYear = (history: PortfolioSnapshot[]): Record<string, PortfolioSnapshot[]> => {
  const byYear: Record<string, PortfolioSnapshot[]> = {};

  for (const snapshot of history) {
    const year = snapshot.date.slice(0, 4);
    if (!byYear[year]) {
      byYear[year] = [];
    }
    byYear[year].push(snapshot);
  }

  return byYear;
};

/**
 * 최근 N일 히스토리만 추출
 */
export const getRecentHistory = (history: PortfolioSnapshot[], days: number = 30): PortfolioSnapshot[] => {
  const sorted = [...history].sort((a, b) => b.date.localeCompare(a.date));
  return sorted.slice(0, days).reverse();
};

/**
 * 누락된 날짜 범위 계산
 */
export const getMissingDateRange = (history: PortfolioSnapshot[]): { startDate: string; endDate: string; missingDates: string[] } | null => {
  if (history.length === 0) return null;

  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const lastSnapshot = sorted[sorted.length - 1];
  const lastDate = new Date(lastSnapshot.date);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 어제까지만 백필 (오늘은 실시간 데이터 사용)
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // 마지막 스냅샷이 어제 이후면 백필 불필요
  if (lastDate >= yesterday) return null;

  // 누락된 날짜 목록 생성
  const missingDates: string[] = [];
  const current = new Date(lastDate);
  current.setDate(current.getDate() + 1);

  while (current <= yesterday) {
    missingDates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }

  if (missingDates.length === 0) return null;

  return {
    startDate: missingDates[0],
    endDate: missingDates[missingDates.length - 1],
    missingDates,
  };
};

/**
 * 실제 과거 시세로 히스토리 백필 + 기존 스냅샷 종가 교정
 *
 * - 누락된 날짜: 새 스냅샷 생성 (기존 동작)
 * - 기존 스냅샷: 장중 업데이트로 기록된 가격을 실제 종가로 교정
 *   (오늘 스냅샷은 교정 대상에서 제외)
 */
export const backfillWithRealPrices = async (
  history: PortfolioSnapshot[],
  assets: Asset[],
  exchangeRates: { USD: number; JPY: number }
): Promise<PortfolioSnapshot[]> => {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return history;

  const lastSnapshot = sorted[sorted.length - 1];
  const assetIds = new Set(lastSnapshot.assets.map(a => a.id));

  // 현재 자산에서 티커 정보 매핑 (AssetSnapshot에는 ticker가 없으므로)
  const assetInfoMap = new Map<string, Asset>();
  assets.forEach(a => {
    if (assetIds.has(a.id)) {
      assetInfoMap.set(a.id, a);
    }
  });

  // 주식/ETF와 암호화폐 분리
  const stockTickers: string[] = [];
  const cryptoSymbols: string[] = [];

  assetInfoMap.forEach((asset) => {
    if (asset.category === AssetCategory.CASH) return;
    const ticker = convertTickerForAPI(asset.ticker, asset.exchange, asset.category);
    if (isCryptoExchange(asset.exchange)) {
      if (!cryptoSymbols.includes(asset.ticker)) cryptoSymbols.push(asset.ticker);
    } else {
      if (!stockTickers.includes(ticker)) stockTickers.push(ticker);
    }
  });

  if (stockTickers.length === 0 && cryptoSymbols.length === 0) {
    return fillAllMissingDates(history);
  }

  // 누락 범위 확인
  const missingRange = getMissingDateRange(history);
  const missingDates = missingRange?.missingDates || [];

  // 기존 스냅샷 중 종가 교정 대상 (오늘 제외)
  const todayStr = new Date().toISOString().slice(0, 10);
  const existingDates = sorted.filter(s => s.date !== todayStr).map(s => s.date);

  // API 조회 범위 계산
  const allDates = [...new Set([...existingDates, ...missingDates])].sort();
  if (allDates.length === 0) {
    console.log('[Backfill] 교정/백필 대상 없음');
    return fillAllMissingDates(history);
  }

  // 너무 많으면 최근 90일만
  const targetDates = allDates.length > 90 ? allDates.slice(-90) : allDates;
  const fetchStart = targetDates[0];
  const fetchEnd = targetDates[targetDates.length - 1];

  console.log(`[Backfill] 백필+교정: ${fetchStart} ~ ${fetchEnd} (누락 ${missingDates.length}일, 교정 ${existingDates.length}일)`);

  try {
    const [stockPrices, cryptoPrices, exchangeRateHistory] = await Promise.all([
      stockTickers.length > 0 ? fetchStockHistoricalPrices(stockTickers, fetchStart, fetchEnd) : Promise.resolve({}),
      cryptoSymbols.length > 0 ? fetchCryptoHistoricalPrices(cryptoSymbols, fetchStart, fetchEnd) : Promise.resolve({}),
      fetchExchangeRateHistory(fetchStart, fetchEnd),
    ]);

    const hasStockData = Object.values(stockPrices as Record<string, HistoricalPriceResult>).some(r => r.data && Object.keys(r.data).length > 0);
    const hasCryptoData = Object.values(cryptoPrices as Record<string, HistoricalPriceResult>).some(r => r.data && Object.keys(r.data).length > 0);

    if (!hasStockData && !hasCryptoData) {
      console.warn('[Backfill] API에서 데이터를 받지 못함, 기존 보간 방식 사용');
      return fillAllMissingDates(history);
    }

    // 스냅샷 자산의 가격을 실제 종가로 교정하는 헬퍼
    const correctAssets = (snapshotAssets: AssetSnapshot[], date: string, dayExchangeRate: number): AssetSnapshot[] => {
      return snapshotAssets.map(snapshotAsset => {
        const assetInfo = assetInfoMap.get(snapshotAsset.id);
        if (!assetInfo || assetInfo.category === AssetCategory.CASH) {
          return { ...snapshotAsset };
        }

        if (assetInfo.purchaseDate && date < assetInfo.purchaseDate) {
          return { ...snapshotAsset, currentValue: 0, purchaseValue: 0, unitPrice: 0, unitPriceOriginal: 0 };
        }

        let newUnitPriceOriginal = snapshotAsset.unitPriceOriginal || 0;
        let newUnitPrice = snapshotAsset.unitPrice || 0;

        if (isCryptoExchange(assetInfo.exchange)) {
          const cryptoResult = cryptoPrices[assetInfo.ticker.toUpperCase()] || cryptoPrices[`KRW-${assetInfo.ticker.toUpperCase()}`];
          if (cryptoResult?.data?.[date]) {
            newUnitPriceOriginal = cryptoResult.data[date];
            newUnitPrice = newUnitPriceOriginal;
          }
        } else {
          const ticker = convertTickerForAPI(assetInfo.ticker, assetInfo.exchange, assetInfo.category);
          const stockResult = stockPrices[ticker];
          if (stockResult?.data?.[date]) {
            newUnitPriceOriginal = stockResult.data[date];
            if (assetInfo.currency === Currency.USD) {
              newUnitPrice = newUnitPriceOriginal * dayExchangeRate;
            } else if (assetInfo.currency === Currency.KRW) {
              newUnitPrice = newUnitPriceOriginal;
            } else {
              newUnitPrice = snapshotAsset.unitPrice || newUnitPriceOriginal;
            }
          }
        }

        const quantity = snapshotAsset.currentValue / (snapshotAsset.unitPrice || 1);
        const newCurrentValue = newUnitPrice > 0 ? quantity * newUnitPrice : snapshotAsset.currentValue;

        return { ...snapshotAsset, unitPrice: newUnitPrice, unitPriceOriginal: newUnitPriceOriginal, currentValue: newCurrentValue };
      });
    };

    // 1) 기존 스냅샷 교정 (장중가 → 종가, 오늘 제외)
    let correctedCount = 0;
    const correctedHistory = sorted.map(snapshot => {
      if (snapshot.date === todayStr) return snapshot;
      const dayExchangeRate = exchangeRateHistory[snapshot.date] || exchangeRates.USD;
      const correctedAssets = correctAssets(snapshot.assets, snapshot.date, dayExchangeRate);
      const changed = correctedAssets.some((a, i) =>
        a.unitPriceOriginal !== snapshot.assets[i]?.unitPriceOriginal
      );
      if (changed) correctedCount++;
      return { ...snapshot, assets: correctedAssets };
    });

    if (correctedCount > 0) {
      console.log(`[Backfill] 기존 스냅샷 ${correctedCount}개 종가로 교정`);
    }

    // 2) 누락 날짜 스냅샷 생성
    const existingDateSet = new Set(sorted.map(s => s.date));
    const newSnapshots: PortfolioSnapshot[] = [];
    for (const date of missingDates) {
      if (existingDateSet.has(date)) continue;
      const dayExchangeRate = exchangeRateHistory[date] || exchangeRates.USD;
      const dayAssets = correctAssets(lastSnapshot.assets, date, dayExchangeRate);
      newSnapshots.push({ date, assets: dayAssets });
    }

    if (newSnapshots.length > 0) {
      console.log(`[Backfill] ${newSnapshots.length}개 새 스냅샷 생성`);
    }

    const merged = [...correctedHistory, ...newSnapshots].sort((a, b) => a.date.localeCompare(b.date));
    return fillAllMissingDates(merged);

  } catch (error) {
    console.error('[Backfill] API 호출 실패, 기존 보간 방식으로 폴백:', error);
    return fillAllMissingDates(history);
  }
};
