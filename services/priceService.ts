// src/services/priceService.ts
import { Asset, AssetCategory } from '../types';
import { fetchUpbitPricesBatch, toUpbitPair } from './upbitService';

// [중요] 아까 구글 클라우드 콘솔에서 복사한 URL을 아래 따옴표 안에 넣으세요!
const GOOGLE_FUNCTION_URL = 'https://asset-manager-887842923289.asia-northeast3.run.app'; 

export interface PriceData {
  price: number;
  prevClose: number;
}

export const updateAssetPrices = async (assets: Asset[]): Promise<Map<string, PriceData>> => {
  const resultMap = new Map<string, PriceData>();
  
  const cryptoSymbols: string[] = [];
  const stockSymbols: string[] = [];

  // 1. 자산 분류
  assets.forEach(asset => {
    if (asset.category === AssetCategory.CRYPTOCURRENCY) {
      cryptoSymbols.push(asset.ticker);
    } else {
      stockSymbols.push(asset.ticker);
    }
  });

  // 2. 암호화폐 조회 (브라우저 -> 업비트 직접 요청)
  if (cryptoSymbols.length > 0) {
    const upbitResults = await fetchUpbitPricesBatch(cryptoSymbols);
    upbitResults.forEach((data, key) => {
      resultMap.set(key, {
          price: data.trade_price,
          prevClose: data.prev_closing_price
      });
    });
  }

  // 3. 주식/기타 조회 (브라우저 -> 구글 클라우드 함수 요청)
  if (stockSymbols.length > 0) {
    try {
      const response = await fetch(GOOGLE_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tickers: stockSymbols }),
      });

      if (response.ok) {
        const data = await response.json();
        // data 형식: { "005930": { "price": 70000, "prev_close": ... }, ... }
        
        Object.entries(data).forEach(([ticker, val]: [string, any]) => {
            if (val && val.price) {
                resultMap.set(ticker, {
                    price: val.price,
                    prevClose: val.prev_close
                });
            }
        });
      } else {
        console.error("GCF Error:", response.status);
      }
    } catch (e) {
      console.error("Stock update failed:", e);
    }
  }

  return resultMap;
};