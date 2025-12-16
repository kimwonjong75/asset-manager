// utils/migrateData.ts
// 기존 DB 데이터를 새 구조로 변환하는 마이그레이션 스크립트

import { Currency, AssetCategory } from '../types';

/**
 * 마이그레이션 실행
 * 
 * 핵심 변경:
 * 1. USD/JPY 자산의 currentPrice를 priceOriginal 값으로 교체
 * 2. 암호화폐 중 purchasePrice가 비정상적으로 큰 경우 KRW로 복구
 */
export const runMigrationIfNeeded = (data: any) => {
  if (!data || typeof data !== 'object') return data;
  
  // 환율 초기화
  if (!data.exchangeRates) {
    data.exchangeRates = { USD: 0, JPY: 0 };
  }
  
  // 자산 마이그레이션
  if (Array.isArray(data.assets)) {
    console.log('[Migration] 데이터 마이그레이션 시작...');
    
    data.assets = data.assets.map((asset: any, index: number) => {
      
      // ✅ 암호화폐 특별 처리: purchasePrice가 1000 이상이면 KRW로 입력된 것
      if (asset.category === '암호화폐' || asset.category === AssetCategory.CRYPTOCURRENCY) {
        // purchasePrice가 크고, currentPrice가 작으면 통화 불일치
        if (asset.purchasePrice > 1000 && asset.currentPrice < 1000) {
          console.log(`[Migration] ${asset.ticker}: 암호화폐 KRW 복구`);
          console.log(`  - purchasePrice: ${asset.purchasePrice} (KRW)`);
          console.log(`  - currentPrice: ${asset.currentPrice} → priceKRW 필요`);
          
          return {
            ...asset,
            currency: Currency.KRW,  // ✅ KRW로 복구
            // currentPrice는 다음 업데이트 시 priceKRW로 갱신됨
          };
        }
      }
      
      // KRW 자산은 그대로
      if (asset.currency === 'KRW' || asset.currency === Currency.KRW) {
        return asset;
      }
      
      // USD/JPY 자산: priceOriginal이 있으면 그 값을 currentPrice로 사용
      if (asset.priceOriginal && asset.priceOriginal > 0) {
        // currentPrice가 priceOriginal보다 100배 이상 크면 원화로 저장된 것
        const ratio = asset.currentPrice / asset.priceOriginal;
        if (ratio > 100) {
          const oldCurrentPrice = asset.currentPrice;
          const newCurrentPrice = asset.priceOriginal;
          
          // 최고가도 원래 통화 기준으로 재계산
          let newHighestPrice = asset.priceOriginal;
          if (asset.highestPrice > 0 && oldCurrentPrice > 0) {
            const impliedRate = oldCurrentPrice / asset.priceOriginal;
            if (impliedRate > 1) {
              newHighestPrice = asset.highestPrice / impliedRate;
            }
          }
          
          // 비정상 최고가 보정
          if (newHighestPrice > newCurrentPrice * 10) {
            newHighestPrice = newCurrentPrice;
          }
          if (newHighestPrice < newCurrentPrice) {
            newHighestPrice = newCurrentPrice;
          }
          
          console.log(`[Migration] ${index + 1}. ${asset.ticker} (${asset.currency})`);
          console.log(`  - currentPrice: ${oldCurrentPrice.toLocaleString()} → ${newCurrentPrice.toFixed(2)}`);
          console.log(`  - highestPrice: ${asset.highestPrice?.toLocaleString()} → ${newHighestPrice.toFixed(2)}`);
          
          return {
            ...asset,
            currentPrice: newCurrentPrice,
            highestPrice: newHighestPrice,
          };
        }
      }
      
      return asset;
    });
    
    console.log('[Migration] 마이그레이션 완료!');
  }
  
  return data;
};

/**
 * 마이그레이션 필요 여부 확인
 */
export const needsMigration = (data: any): boolean => {
  if (!data || !data.assets || data.assets.length === 0) return false;
  
  return data.assets.some((asset: any) => {
    // 암호화폐 통화 불일치 확인
    if (asset.category === '암호화폐' || asset.category === 'CRYPTOCURRENCY') {
      if (asset.purchasePrice > 1000 && asset.currentPrice < 1000) {
        return true;
      }
    }
    
    // USD/JPY 자산 중 currentPrice가 원화인지 확인
    if (asset.currency !== 'KRW') {
      if (!asset.priceOriginal || asset.priceOriginal === 0) return false;
      const ratio = asset.currentPrice / asset.priceOriginal;
      if (ratio > 100) return true;
    }
    
    return false;
  });
};
