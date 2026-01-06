import { AssetCategory, Currency, normalizeExchange } from '../types';
import { AssetDataResult, PriceAPIResponse, PriceItem } from '../types/api';

const STOCK_API_URL = 'https://asset-manager-887842923289.asia-northeast3.run.app';
const CHUNK_SIZE = 20;
const CHUNK_DELAY_MS = 500;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function toNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

// 배치 조회 함수
export async function fetchBatchAssetPrices(
  assets: { ticker: string; exchange: string; id: string; category?: AssetCategory; currency?: Currency }[],
): Promise<Map<string, AssetDataResult>> {
  const resultMap = new Map<string, AssetDataResult>();
  if (assets.length === 0) return resultMap;

  // 로깅: 요청 대상 확인
  console.log(`[priceService] Fetching prices for ${assets.length} assets...`);

  for (let i = 0; i < assets.length; i += CHUNK_SIZE) {
    const chunk = assets.slice(i, i + CHUNK_SIZE);
    
    // 중복 티커 제거하여 API 요청 최적화
    const uniqueRequests = Array.from(new Set(chunk.map(a => {
        const reqTicker = String(a.ticker).toUpperCase();
        return JSON.stringify({ ticker: reqTicker, exchange: normalizeExchange(a.exchange) });
    }))).map(s => JSON.parse(s));

    try {
      const response = await fetch(STOCK_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: uniqueRequests }),
      });

      if (!response.ok) throw new Error(`API Error: ${response.status}`);
      
      const data = await response.json();
      // console.log('[priceService] Raw API Response:', data); // 디버깅용 (필요시 주석 해제)

      // 응답 데이터를 평탄화 (Flat List)
      const items: any[] = []; // 유연한 파싱을 위해 any 사용
      
      if (Array.isArray(data)) {
        items.push(...data);
      } else if (data && typeof data === 'object') {
        if ('results' in data && Array.isArray((data as any).results)) {
           items.push(...(data as any).results);
        } else {
           // Object key-value 구조 처리 {"005930": {...}}
           Object.keys(data).forEach(key => {
             const val = data[key];
             if (val && typeof val === 'object') {
               items.push({ ...val, ticker: key }); // 키를 티커로 주입
             }
           });
        }
      }

      // 수신된 데이터를 자산 ID와 매핑
      items.forEach((item: any) => {
        const itemTicker = String(item.ticker || item.symbol || '').toUpperCase();
        const normalizedItemTicker = itemTicker.endsWith('-USD') ? itemTicker.replace(/-USD$/i, '') : itemTicker;

        // [중요 수정] find -> filter : 동일 티커를 가진 모든 자산을 찾아 업데이트
        const matchedAssets = assets.filter(a => a.ticker.toUpperCase() === normalizedItemTicker);

        matchedAssets.forEach(matched => {
            const priceOrig = toNumber(item.priceOriginal ?? item.price ?? item.close, 0);
            
            // [중요] 전일 종가 파싱 강화 (API 응답 우선 -> 계산된 값 -> 0)
            const prev = toNumber(item.prev_close ?? item.previousClose ?? item.yesterdayPrice, 0);
            
            // [중요] 등락률 파싱
            let changeRate = 0;
            if (typeof item.change_rate === 'number') {
                changeRate = item.change_rate;
            } else if (typeof item.changeRate === 'number') {
                changeRate = item.changeRate;
            } else if (prev > 0) {
                changeRate = (priceOrig - prev) / prev;
            }

            // 통화 처리
            const currencyFromServer = String(item.currency ?? matched.currency ?? Currency.USD);
            const keepOriginalCurrency = matched.category === AssetCategory.CRYPTOCURRENCY;
            const currencyStr = keepOriginalCurrency ? String(matched.currency ?? currencyFromServer) : currencyFromServer;
            let currency: Currency = [Currency.KRW, Currency.USD, Currency.JPY, Currency.CNY].includes(currencyStr as Currency)
              ? (currencyStr as Currency)
              : Currency.KRW;

            // 업비트/빗썸 등은 무조건 KRW
            if (['Upbit', 'Bithumb'].includes(matched.exchange)) {
                currency = Currency.KRW;
            }

            const priceKRW = typeof item.priceKRW === 'number'
              ? item.priceKRW
              : (currency === Currency.KRW ? priceOrig : priceOrig); // 환율 적용은 useMarketData에서 함

            const result: AssetDataResult = {
              name: String(item.name ?? matched.ticker),
              priceOriginal: priceOrig,
              priceKRW,
              currency,
              previousClosePrice: prev, // API가 준 전일종가 사용
              highestPrice: priceOrig * 1.1, // 임시값
              isMocked: !(priceOrig > 0),
              changeRate: changeRate,
              indicators: item.indicators, // [중요] 퀀트 지표 전달
            };
            
            resultMap.set(matched.id, result);
        });
      });

    } catch (e) {
      console.error('[priceService] Batch fetch failed:', e);
    }
    await sleep(CHUNK_DELAY_MS);
  }

  // 데이터가 없는 자산들 처리 (Mock)
  assets.forEach(s => {
    if (!resultMap.has(s.id)) {
        console.warn(`[priceService] No data for: ${s.ticker}`);
        resultMap.set(s.id, {
            name: s.ticker,
            priceOriginal: 0,
            priceKRW: 0,
            currency: s.currency ?? Currency.USD,
            previousClosePrice: 0,
            highestPrice: 0,
            isMocked: true,
        });
    }
  });

  return resultMap;
}

// (나머지 fetchAssetData, fetchExchangeRate 등은 기존 유지 또는 위 로직 참고하여 수정)
// 단일 조회 함수도 indicators를 반환하도록 확인 필요
export async function fetchAssetData(asset: { ticker: string; exchange: string; category?: AssetCategory; currency?: Currency }): Promise<AssetDataResult> {
    // 배치 함수를 재사용하여 일관성 유지
    const map = await fetchBatchAssetPrices([{ ...asset, id: 'temp-id' }]);
    return map.get('temp-id') as AssetDataResult;
}

export async function fetchExchangeRate(): Promise<number> {
    const map = await fetchBatchAssetPrices([{ ticker: 'USD/KRW', exchange: 'KRX', id: 'usd', category: AssetCategory.KOREAN_STOCK, currency: Currency.KRW }]);
    return map.get('usd')?.priceOriginal || 0;
}

export async function fetchExchangeRateJPY(): Promise<number> {
    const map = await fetchBatchAssetPrices([{ ticker: 'JPY/KRW', exchange: 'KRX', id: 'jpy', category: AssetCategory.KOREAN_STOCK, currency: Currency.KRW }]);
    return map.get('jpy')?.priceOriginal || 0;
}