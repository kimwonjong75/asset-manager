// utils/migrateData.ts
// 기존 DB 데이터를 새 구조로 변환하는 마이그레이션 스크립트

import { Currency, AssetCategory, ExchangeRates, LegacyAssetShape, PortfolioSnapshot, SellRecord, WatchlistItem } from '../types';

/**
 * 마이그레이션 실행
 * 
 * 핵심 변경:
 * 1. 암호화폐: purchasePrice가 원화로 입력된 경우 currency를 KRW로 복구
 * 2. USD/JPY 자산: currentPrice가 원화로 저장된 경우 priceOriginal로 교체
 */
export const runMigrationIfNeeded = (data: { exchangeRates?: ExchangeRates; assets?: LegacyAssetShape[]; portfolioHistory?: PortfolioSnapshot[]; sellHistory?: SellRecord[]; watchlist?: WatchlistItem[] } | null | undefined) => {
  if (!data || typeof data !== 'object') return data;
  
  // 환율 초기화
  if (!data.exchangeRates) {
    data.exchangeRates = { USD: 0, JPY: 0 };
  }
  
  // 자산 마이그레이션
  if (Array.isArray(data.assets)) {
    console.log('[Migration] 데이터 마이그레이션 시작...');
    let fixedCount = 0;
    
    data.assets = data.assets.map((asset: LegacyAssetShape) => {
      const ticker = asset.ticker || '?';
      const category = asset.category || '';
      const currency: string | Currency = asset.currency || 'KRW';
      const purchasePrice = asset.purchasePrice || 0;
      const currentPrice = asset.currentPrice || 0;
      const priceOriginal = asset.priceOriginal || 0;
      const yesterdayPrice = asset.yesterdayPrice || 0;
      
      // ✅ Rename yesterdayPrice to previousClosePrice
      const migratedAsset = {
        ...asset,
        previousClosePrice: yesterdayPrice,
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

