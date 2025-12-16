// utils/migrateData.ts
// 기존 DB 데이터를 새 구조로 변환하는 마이그레이션 스크립트

import { Currency } from '../types';

/**
 * 마이그레이션 실행
 * 
 * 핵심 변경:
 * - USD/JPY 자산의 currentPrice를 priceOriginal 값으로 교체
 * - USD/JPY 자산의 highestPrice도 원래 통화 기준으로 재계산
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
      // KRW 자산은 그대로
      if (asset.currency === 'KRW' || asset.currency === Currency.KRW) {
        return asset;
      }
      
      // USD/JPY 자산: priceOriginal이 있으면 그 값을 currentPrice로 사용
      if (asset.priceOriginal && asset.priceOriginal > 0) {
        const oldCurrentPrice = asset.currentPrice;
        const newCurrentPrice = asset.priceOriginal;
        
        // 최고가도 원래 통화 기준으로 재계산
        let newHighestPrice = asset.priceOriginal;
        if (asset.highestPrice > 0 && oldCurrentPrice > 0) {
          // 기존 환율 추정
          const impliedRate = oldCurrentPrice / asset.priceOriginal;
          if (impliedRate > 1) {
            newHighestPrice = asset.highestPrice / impliedRate;
          }
        }
        
        // 비정상 최고가 보정 (현재가의 10배 이상이면 리셋)
        if (newHighestPrice > newCurrentPrice * 10) {
          console.warn(`[Migration] ${asset.ticker}: 비정상 최고가 감지, 현재가로 리셋`);
          newHighestPrice = newCurrentPrice;
        }
        
        // 최고가가 현재가보다 낮으면 현재가로 설정
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
          // priceOriginal은 그대로 유지 (참조용)
        };
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
  
  // USD/JPY 자산 중 currentPrice가 priceOriginal보다 100배 이상 크면 마이그레이션 필요
  return data.assets.some((asset: any) => {
    if (asset.currency === 'KRW') return false;
    if (!asset.priceOriginal || asset.priceOriginal === 0) return false;
    
    const ratio = asset.currentPrice / asset.priceOriginal;
    return ratio > 100; // 환율이 100 이상이면 원화로 저장된 것
  });
};

/**
 * 강제 마이그레이션 (콘솔에서 수동 실행용)
 */
export const forceMigration = (jsonString: string): string => {
  try {
    const data = JSON.parse(jsonString);
    const migrated = runMigrationIfNeeded(data);
    return JSON.stringify(migrated, null, 2);
  } catch (e) {
    console.error('[Migration] 파싱 오류:', e);
    return jsonString;
  }
};
