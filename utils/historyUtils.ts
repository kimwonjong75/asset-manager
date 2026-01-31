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
 * 실제 과거 시세로 히스토리 백필
 *
 * @param history 기존 히스토리
 * @param assets 현재 보유 자산 목록 (티커 정보 참조용)
 * @param exchangeRates 현재 환율 (폴백용)
 * @returns 백필된 히스토리 또는 기존 보간 히스토리 (실패 시)
 */
export const backfillWithRealPrices = async (
  history: PortfolioSnapshot[],
  assets: Asset[],
  exchangeRates: { USD: number; JPY: number }
): Promise<PortfolioSnapshot[]> => {
  // 누락 범위 확인
  const missingRange = getMissingDateRange(history);
  if (!missingRange) {
    console.log('[Backfill] 누락된 날짜 없음');
    return fillAllMissingDates(history);
  }

  const { startDate, endDate, missingDates } = missingRange;
  console.log(`[Backfill] 백필 시작: ${startDate} ~ ${endDate} (${missingDates.length}일)`);

  // 백필 대상이 너무 많으면 기존 보간 사용 (API 부하 방지)
  if (missingDates.length > 90) {
    console.warn('[Backfill] 누락일이 90일 초과, 기존 보간 방식 사용');
    return fillAllMissingDates(history);
  }

  // 마지막 스냅샷의 자산 ID 목록
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
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
  const tickerToAssetIds = new Map<string, string[]>();

  assetInfoMap.forEach((asset, id) => {
    // 현금은 백필 제외
    if (asset.category === AssetCategory.CASH) return;

    const ticker = convertTickerForAPI(asset.ticker, asset.exchange, asset.category);

    if (isCryptoExchange(asset.exchange)) {
      if (!cryptoSymbols.includes(asset.ticker)) {
        cryptoSymbols.push(asset.ticker);
      }
    } else {
      if (!stockTickers.includes(ticker)) {
        stockTickers.push(ticker);
      }
    }

    // 티커 -> 자산ID 매핑 (동일 티커를 여러 자산이 가질 수 있음)
    const existing = tickerToAssetIds.get(ticker) || tickerToAssetIds.get(asset.ticker) || [];
    existing.push(id);
    tickerToAssetIds.set(isCryptoExchange(asset.exchange) ? asset.ticker : ticker, existing);
  });

  console.log(`[Backfill] 주식 ${stockTickers.length}개, 암호화폐 ${cryptoSymbols.length}개 조회 예정`);

  try {
    // 병렬로 API 호출
    const [stockPrices, cryptoPrices, exchangeRateHistory] = await Promise.all([
      stockTickers.length > 0 ? fetchStockHistoricalPrices(stockTickers, startDate, endDate) : Promise.resolve({}),
      cryptoSymbols.length > 0 ? fetchCryptoHistoricalPrices(cryptoSymbols, startDate, endDate) : Promise.resolve({}),
      fetchExchangeRateHistory(startDate, endDate),
    ]);

    // 결과 확인
    const hasStockData = Object.values(stockPrices as Record<string, HistoricalPriceResult>).some(r => r.data && Object.keys(r.data).length > 0);
    const hasCryptoData = Object.values(cryptoPrices as Record<string, HistoricalPriceResult>).some(r => r.data && Object.keys(r.data).length > 0);

    if (!hasStockData && !hasCryptoData) {
      console.warn('[Backfill] API에서 데이터를 받지 못함, 기존 보간 방식 사용');
      return fillAllMissingDates(history);
    }

    // 누락된 날짜별로 스냅샷 생성
    const newSnapshots: PortfolioSnapshot[] = [];

    for (const date of missingDates) {
      const dayExchangeRate = exchangeRateHistory[date] || exchangeRates.USD;

      // 마지막 스냅샷 기준으로 자산 복사 후 가격만 업데이트
      const dayAssets: AssetSnapshot[] = lastSnapshot.assets.map(snapshotAsset => {
        const assetInfo = assetInfoMap.get(snapshotAsset.id);

        if (!assetInfo) {
          // 자산 정보 없으면 그대로 복사 (현금 등)
          return { ...snapshotAsset };
        }

        // 매수일 이전 날짜는 제외 (0으로 처리)
        if (assetInfo.purchaseDate && date < assetInfo.purchaseDate) {
          return {
            ...snapshotAsset,
            currentValue: 0,
            purchaseValue: 0,
            unitPrice: 0,
            unitPriceOriginal: 0,
          };
        }

        let newUnitPriceOriginal = snapshotAsset.unitPriceOriginal || 0;
        let newUnitPrice = snapshotAsset.unitPrice || 0;

        if (isCryptoExchange(assetInfo.exchange)) {
          // 암호화폐: Upbit 데이터
          const cryptoResult = cryptoPrices[assetInfo.ticker.toUpperCase()] || cryptoPrices[`KRW-${assetInfo.ticker.toUpperCase()}`];
          if (cryptoResult?.data?.[date]) {
            newUnitPriceOriginal = cryptoResult.data[date];
            newUnitPrice = newUnitPriceOriginal; // KRW 기준
          }
        } else {
          // 주식: FinanceDataReader 데이터
          const ticker = convertTickerForAPI(assetInfo.ticker, assetInfo.exchange, assetInfo.category);
          const stockResult = stockPrices[ticker];
          if (stockResult?.data?.[date]) {
            newUnitPriceOriginal = stockResult.data[date];

            // 원화 환산
            if (assetInfo.currency === Currency.USD) {
              newUnitPrice = newUnitPriceOriginal * dayExchangeRate;
            } else if (assetInfo.currency === Currency.KRW) {
              newUnitPrice = newUnitPriceOriginal;
            } else {
              // 기타 통화는 기존 값 유지
              newUnitPrice = snapshotAsset.unitPrice || newUnitPriceOriginal;
            }
          }
        }

        // 평가액 계산 (수량은 마지막 스냅샷 기준)
        const quantity = snapshotAsset.currentValue / (snapshotAsset.unitPrice || 1);
        const newCurrentValue = newUnitPrice > 0 ? quantity * newUnitPrice : snapshotAsset.currentValue;

        return {
          ...snapshotAsset,
          unitPrice: newUnitPrice,
          unitPriceOriginal: newUnitPriceOriginal,
          currentValue: newCurrentValue,
        };
      });

      newSnapshots.push({
        date,
        assets: dayAssets,
      });
    }

    console.log(`[Backfill] ${newSnapshots.length}개 스냅샷 생성 완료`);

    // 기존 히스토리 + 새 스냅샷 병합 후 정렬
    const merged = [...sorted, ...newSnapshots].sort((a, b) => a.date.localeCompare(b.date));

    // 중간에 빠진 날짜(주말/휴장일)는 기존 보간으로 채우기
    return fillAllMissingDates(merged);

  } catch (error) {
    console.error('[Backfill] API 호출 실패, 기존 보간 방식으로 폴백:', error);
    return fillAllMissingDates(history);
  }
};
