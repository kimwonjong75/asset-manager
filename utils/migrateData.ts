// utils/migrateData.ts
// 기존 DB 데이터를 새 구조로 변환하는 마이그레이션 스크립트

import { Currency, AssetCategory, ExchangeRates, LegacyAssetShape, PortfolioSnapshot, SellRecord, WatchlistItem, AllocationTargets } from '../types';
import { DEFAULT_CATEGORIES, DEFAULT_CATEGORY_STORE, CategoryStore } from '../types/category';

/**
 * 마이그레이션 실행
 * 
 * 핵심 변경:
 * 1. 암호화폐: purchasePrice가 원화로 입력된 경우 currency를 KRW로 복구
 * 2. USD/JPY 자산: currentPrice가 원화로 저장된 경우 priceOriginal로 교체
 */
export const runMigrationIfNeeded = <T extends { exchangeRates?: ExchangeRates; assets?: any[]; portfolioHistory?: PortfolioSnapshot[]; sellHistory?: SellRecord[]; watchlist?: WatchlistItem[] }>(data: T | null | undefined): T => {
  if (!data || typeof data !== 'object') return data as T;

  // 환율 초기화
  if (!data.exchangeRates) {
    data.exchangeRates = { USD: 0, JPY: 0 };
  }
  
  // 자산 마이그레이션
  if (Array.isArray(data.assets)) {
    console.log('[Migration] 데이터 마이그레이션 시작...');
    let fixedCount = 0;
    
    data.assets = data.assets.map((asset: any) => {
      const ticker = asset.ticker || '?';
      const category = asset.category || '';
      const currency: string | Currency = asset.currency || 'KRW';
      const purchasePrice = asset.purchasePrice || 0;
      const currentPrice = asset.currentPrice || 0;
      const priceOriginal = asset.priceOriginal || 0;
      // ✅ Rename yesterdayPrice to previousClosePrice (기존 값이 있으면 유지)
      const migratedAsset = {
        ...asset,
        previousClosePrice: asset.previousClosePrice ?? asset.yesterdayPrice ?? 0,
      };
      delete (migratedAsset as any).yesterdayPrice;

      // Use migratedAsset for subsequent checks
      const targetAsset = migratedAsset;

      
      // ✅ 암호화폐 특별 처리
      if (category === '암호화폐' || category === AssetCategory.CRYPTOCURRENCY) {
        // USD로 설정되어 있지만 purchasePrice가 원화 수준인 경우
        if (currency === 'USD' || currency === Currency.USD) {
          // BTC: purchasePrice가 1억 이상이면 원화
          // ETH: purchasePrice가 100만 이상이면 원화
          // 기타: purchasePrice가 1000 이상이고 currentPrice가 1000 미만이면 원화
          const isKRWPurchase = 
            (purchasePrice > 100000000) ||  // 1억 이상 (BTC급)
            (purchasePrice > 1000000 && currentPrice < 10000) ||  // 100만 이상, 현재가 1만 미만 (ETH급)
            (purchasePrice > 1000 && currentPrice < 1000);  // 1000 이상, 현재가 1000 미만 (일반)
          
          if (isKRWPurchase) {
            console.log(`[Migration] ${ticker}: 암호화폐 KRW 복구`);
            console.log(`  - purchasePrice: ${purchasePrice.toLocaleString()} (KRW)`);
            console.log(`  - currency: USD → KRW`);
            fixedCount++;
            
            return {
              ...targetAsset,
              currency: Currency.KRW,
            };
          }
        }
      }
      
      // ✅ USD/JPY 자산: currentPrice가 원화로 저장된 경우 복구
      if (currency === 'USD' || currency === 'JPY' || 
          currency === Currency.USD || currency === Currency.JPY) {
        
        if (priceOriginal > 0 && currentPrice > 0) {
          const ratio = currentPrice / priceOriginal;
          
          // currentPrice가 priceOriginal보다 100배 이상 크면 원화로 저장된 것
          if (ratio > 100) {
            console.log(`[Migration] ${ticker}: 가격 복구 (원화→원래통화)`);
            console.log(`  - currentPrice: ${currentPrice.toLocaleString()} → ${priceOriginal}`);
            fixedCount++;
            
            // 최고가도 복구
            let newHighestPrice = priceOriginal;
            if (asset.highestPrice > 0) {
              newHighestPrice = asset.highestPrice / ratio;
              if (newHighestPrice < priceOriginal) {
                newHighestPrice = priceOriginal;
              }
            }
            
            return {
              ...asset,
              currentPrice: priceOriginal,
              highestPrice: newHighestPrice,
            };
          }
        }
      }
      
      return targetAsset;
    });
    
    console.log(`[Migration] 완료! ${fixedCount}개 자산 수정됨`);
  }
  
  return data;
};

/**
 * 카테고리 시스템 마이그레이션
 * category(문자열) → categoryId(숫자) 변환
 * categoryStore가 없으면 기본값 주입
 */
export const migrateCategorySystem = <T extends {
  assets?: any[];
  sellHistory?: any[];
  watchlist?: any[];
  allocationTargets?: AllocationTargets;
  categoryStore?: CategoryStore;
}>(data: T | null | undefined): T => {
  if (!data || typeof data !== 'object') return data as T;

  // categoryStore가 이미 있고, 첫 자산에 categoryId가 있으면 스킵
  if (data.categoryStore?.categories?.length && data.assets?.[0]?.categoryId != null) {
    return data as T;
  }

  console.log('[Migration] 카테고리 시스템 마이그레이션 시작...');

  // 이름 → ID 매핑 빌드
  const nameToId: Record<string, number> = {};
  DEFAULT_CATEGORIES.forEach(c => { nameToId[c.name] = c.id; });
  // 레거시 이름도 매핑
  nameToId['국내주식'] = 1;
  nameToId['해외주식'] = 2;
  nameToId['주식'] = 1;
  nameToId['ETF'] = 1;
  nameToId['KRX금현물'] = 7;
  nameToId['금'] = 7;

  const resolveCategoryId = (category: string | undefined): number => {
    if (!category) return 4; // 기타해외주식
    return nameToId[category] ?? 4;
  };

  // 자산 마이그레이션
  if (Array.isArray(data.assets)) {
    data.assets = data.assets.map((asset: any) => {
      if (asset.categoryId != null) return asset;
      const categoryId = resolveCategoryId(asset.category);
      return { ...asset, categoryId };
    });
  }

  // 매도 내역 마이그레이션
  if (Array.isArray(data.sellHistory)) {
    data.sellHistory = data.sellHistory.map((record: any) => {
      if (record.categoryId != null) return record;
      const categoryId = resolveCategoryId(record.category);
      return { ...record, categoryId };
    });
  }

  // 관심종목 마이그레이션
  if (Array.isArray(data.watchlist)) {
    data.watchlist = data.watchlist.map((item: any) => {
      if (item.categoryId != null) return item;
      const categoryId = resolveCategoryId(item.category);
      return { ...item, categoryId };
    });
  }

  // allocationTargets.weights 키 변환 (카테고리 이름 → ID 문자열)
  if (data.allocationTargets?.weights) {
    const newWeights: Record<string, number> = {};
    Object.entries(data.allocationTargets.weights).forEach(([key, value]) => {
      const id = nameToId[key];
      if (id) {
        newWeights[String(id)] = value as number;
      } else {
        // 이미 숫자 키이거나 알 수 없는 키는 그대로 유지
        newWeights[key] = value as number;
      }
    });
    data.allocationTargets = { ...data.allocationTargets, weights: newWeights };
  }

  // categoryStore 주입
  if (!data.categoryStore) {
    data.categoryStore = DEFAULT_CATEGORY_STORE;
  }

  console.log('[Migration] 카테고리 마이그레이션 완료');
  return data as T;
};
