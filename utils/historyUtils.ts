import { PortfolioSnapshot, SellRecord, Asset, AssetSnapshot, Currency } from '../types';
import { isBaseType } from '../types/category';
import { createLogger } from './logger';

const log = createLogger('Backfill');
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
 * 백필 과정에서 unitPrice 누락으로 오염된 스냅샷 데이터를 교정
 * - currentValue가 purchaseValue 대비 비정상적으로 큰 자산을 감지
 * - 정상 스냅샷에서 수량 기준 데이터를 역산하여 교정
 */
export const repairCorruptedSnapshots = (history: PortfolioSnapshot[]): PortfolioSnapshot[] => {
  if (history.length === 0) return history;

  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));

  // 1단계: 정상 스냅샷에서 자산별 기준 데이터 수집 (최신 → 과거 순으로 탐색)
  const assetRefMap = new Map<string, { quantity: number; purchaseValuePerUnit: number }>();

  for (let i = sorted.length - 1; i >= 0; i--) {
    for (const asset of sorted[i].assets) {
      if (assetRefMap.has(asset.id)) continue;
      if (!asset.unitPrice || asset.unitPrice <= 0 || asset.purchaseValue <= 0) continue;

      const ratio = Math.abs(asset.currentValue / asset.purchaseValue);
      // 수익률 1,000% 미만이면 정상 데이터로 판단
      if (ratio > 0 && ratio < 10) {
        const quantity = asset.currentValue / asset.unitPrice;
        if (quantity > 0) {
          assetRefMap.set(asset.id, {
            quantity,
            purchaseValuePerUnit: asset.purchaseValue / quantity,
          });
        }
      }
    }
  }

  if (assetRefMap.size === 0) return sorted;

  // 2단계: 오염된 스냅샷 자산 교정
  let repairedCount = 0;
  const repaired = sorted.map(snapshot => {
    let hasCorruption = false;

    const fixedAssets = snapshot.assets.map(asset => {
      if (asset.purchaseValue <= 0) return asset;

      const ratio = Math.abs(asset.currentValue / asset.purchaseValue);
      if (ratio < 10) return asset; // 정상 범위 (수익률 1,000% 미만)

      // 오염 감지 — 기준 데이터로 교정 시도
      const ref = assetRefMap.get(asset.id);
      if (!ref || !asset.unitPrice || asset.unitPrice <= 0) {
        // unitPrice도 없으면 purchaseValue로 대체 (최소한 차트 폭발 방지)
        if (ratio >= 10) {
          hasCorruption = true;
          repairedCount++;
          // `purchaseUnitOriginal`도 함께 비운다 — 이 분기는 "손익을 0으로 눌러 차트 폭발을 막는" 교정인데,
          // 필드가 남아 있으면 달러 기준(`plBasis:'native'`)에서 `deriveSnapshotPurchaseValue`가
          // 눌러놓은 `purchaseValue`를 무시하고 `purchaseUnitOriginal × currentValue / unitPriceOriginal`로
          // 원금을 다시 파생해 **없는 수익을 만들어낸다**(원화 모드만 0이 되는 비대칭).
          // 비워두면 파생 가드가 저장값으로 폴백해 두 모드 모두 손익 0이 된다.
          return { ...asset, currentValue: asset.purchaseValue, purchaseUnitOriginal: undefined };
        }
        return asset;
      }

      // purchaseValue 비례로 수량 복원.
      // 이쪽은 `purchaseUnitOriginal`을 그대로 둔다 — 새 `currentValue`가 이 스냅샷 자신의 `unitPrice`로
      // 계산돼 `currentValue / unitPriceOriginal = 수량 × 환율` 등식이 그대로 성립하기 때문이다
      // (복원된 수량이 추정값이라도 평가액·원금이 같은 수량으로 함께 움직여 비율이 보존된다).
      const quantity = asset.purchaseValue / ref.purchaseValuePerUnit;
      const correctedValue = quantity * asset.unitPrice;

      hasCorruption = true;
      repairedCount++;
      return { ...asset, currentValue: correctedValue };
    });

    return hasCorruption ? { ...snapshot, assets: fixedAssets } : snapshot;
  });

  if (repairedCount > 0) {
    log.info(`${repairedCount}개 오염된 스냅샷 자산 교정됨`);
  }

  return repaired;
};

/**
 * 스냅샷 단가 **쌍**(`unitPrice` 원화 환산 / `unitPriceOriginal` 원통화)을 그날 종가로 교정한다 (순수).
 *
 * ## 왜 쌍인가
 * 스냅샷에는 환율 필드가 없다. 달러 기준 손익 차트
 * (`utils/portfolioMetrics.deriveSnapshotPurchaseValue`)는 그 대신
 *
 *     currentValue / unitPriceOriginal === quantity × rate(그날)
 *
 * 라는 **내부 정합성**에 기대어 환율을 약분한다. 이 등식은
 * `unitPrice === unitPriceOriginal × rate` 이고 `currentValue === quantity × unitPrice`
 * 일 때만 성립한다. 따라서 한쪽만 새 종가로 바꾸면(예전 JPY/CNY 경로가 그랬다)
 * 원화 기준 차트는 멀쩡한데 **달러 기준 차트만 조용히 틀린 원금**을 그린다.
 * → 두 필드는 언제나 함께 움직이거나, 함께 그대로 남아야 한다.
 *
 * ## 통화별 규칙
 * - KRW: 환율 1 — 종가를 두 필드에 그대로.
 * - USD: 그날 환율(`dayExchangeRate`)로 환산. 환율이 없으면 `null`(반쪽 교정 금지).
 * - 그 외 외화(JPY·CNY 등): 그날 환율 시계열이 없으므로 **스냅샷 자신의 내재 환율**
 *   (`unitPrice / unitPriceOriginal`)을 그대로 이어 쓴다. 장중→종가 사이 환율이 그대로였다고
 *   보는 근사지만, 쌍이 어긋나는 것에 비하면 오차가 훨씬 작고 `AssetTrendChart`가 읽는
 *   `unitPriceOriginal` 종가 교정도 그대로 살아 있다.
 * - 옛 쌍을 쓸 수 없으면(한쪽이라도 없거나 0 이하) `null` — `unitPriceOriginal`만 갱신하는
 *   반쪽 교정보다 **둘 다 손대지 않는 편**이 스냅샷을 정합 상태로 남긴다.
 *
 * @returns 새 단가 쌍, 또는 `null`(= 이 자산은 교정하지 말 것)
 */
export const correctSnapshotPricePair = (
  snapshotAsset: Pick<AssetSnapshot, 'unitPrice' | 'unitPriceOriginal'>,
  closeOriginal: number,
  currency: Currency | undefined,
  dayExchangeRate: number
): { unitPrice: number; unitPriceOriginal: number } | null => {
  if (!(closeOriginal > 0)) return null;

  if (currency === Currency.KRW) {
    return { unitPrice: closeOriginal, unitPriceOriginal: closeOriginal };
  }

  if (currency === Currency.USD) {
    if (!(dayExchangeRate > 0)) return null;
    return { unitPrice: closeOriginal * dayExchangeRate, unitPriceOriginal: closeOriginal };
  }

  const oldKRW = snapshotAsset.unitPrice ?? 0;
  const oldOriginal = snapshotAsset.unitPriceOriginal ?? 0;
  if (!(oldKRW > 0) || !(oldOriginal > 0)) return null;

  const impliedRate = oldKRW / oldOriginal;
  return { unitPrice: closeOriginal * impliedRate, unitPriceOriginal: closeOriginal };
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
    if (isBaseType(asset.categoryId, 'CASH')) return;
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
    log.info('교정/백필 대상 없음');
    return fillAllMissingDates(history);
  }

  // 너무 많으면 최근 90일만
  const targetDates = allDates.length > 90 ? allDates.slice(-90) : allDates;
  const fetchStart = targetDates[0];
  const fetchEnd = targetDates[targetDates.length - 1];

  log.info(`백필+교정: ${fetchStart} ~ ${fetchEnd} (누락 ${missingDates.length}일, 교정 ${existingDates.length}일)`);

  try {
    // 빈 폴백에 타입을 명시한다. `Promise.resolve({})`로 두면 유니온이 `{}`로 무너져
    // 아래 `stockPrices[ticker]` 조회가 타입상 불가능해지고, 그걸 캐스팅으로 덮게 된다.
    const EMPTY_PRICES: Record<string, HistoricalPriceResult> = {};
    const [stockPrices, cryptoPrices, exchangeRateHistory] = await Promise.all([
      stockTickers.length > 0 ? fetchStockHistoricalPrices(stockTickers, fetchStart, fetchEnd) : Promise.resolve(EMPTY_PRICES),
      cryptoSymbols.length > 0 ? fetchCryptoHistoricalPrices(cryptoSymbols, fetchStart, fetchEnd) : Promise.resolve(EMPTY_PRICES),
      fetchExchangeRateHistory(fetchStart, fetchEnd),
    ]);

    const hasStockData = Object.values(stockPrices).some(r => r.data && Object.keys(r.data).length > 0);
    const hasCryptoData = Object.values(cryptoPrices).some(r => r.data && Object.keys(r.data).length > 0);

    if (!hasStockData && !hasCryptoData) {
      log.warn('API에서 데이터를 받지 못함, 기존 보간 방식 사용');
      return fillAllMissingDates(history);
    }

    // 스냅샷 자산의 가격을 실제 종가로 교정하는 헬퍼
    const correctAssets = (snapshotAssets: AssetSnapshot[], date: string, dayExchangeRate: number): AssetSnapshot[] => {
      return snapshotAssets.map(snapshotAsset => {
        const assetInfo = assetInfoMap.get(snapshotAsset.id);
        if (!assetInfo || isBaseType(assetInfo.categoryId, 'CASH')) {
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
            // 두 단가는 **한 쌍**이다 — 한쪽만 새 종가로 바꾸면 달러 기준 차트가 조용히 틀린다.
            // 교정 불가(null)면 둘 다 손대지 않는다. 규칙·근거는 correctSnapshotPricePair 주석 참고.
            const pair = correctSnapshotPricePair(snapshotAsset, stockResult.data[date], assetInfo.currency, dayExchangeRate);
            if (pair) {
              newUnitPriceOriginal = pair.unitPriceOriginal;
              newUnitPrice = pair.unitPrice;
            }
          }
        }

        // unitPrice가 없는 오래된 스냅샷은 quantity 역산이 불가능하므로 교정 스킵
        if (!snapshotAsset.unitPrice || snapshotAsset.unitPrice <= 0) {
          return { ...snapshotAsset };
        }

        const quantity = snapshotAsset.currentValue / snapshotAsset.unitPrice;
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
      log.info(`기존 스냅샷 ${correctedCount}개 종가로 교정`);
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
      log.info(`${newSnapshots.length}개 새 스냅샷 생성`);
    }

    const merged = [...correctedHistory, ...newSnapshots].sort((a, b) => a.date.localeCompare(b.date));
    return fillAllMissingDates(merged);

  } catch (error) {
    log.error('API 호출 실패, 기존 보간 방식으로 폴백:', error);
    return fillAllMissingDates(history);
  }
};
