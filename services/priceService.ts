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

      // 응답 데이터를 평탄화 (Flat List)
      const items: any[] = []; 
      
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

        // 동일 티커를 가진 모든 자산을 찾아 업데이트
        const matchedAssets = assets.filter(a => a.ticker.toUpperCase() === normalizedItemTicker);

        matchedAssets.forEach(matched => {
            const priceOrig = toNumber(item.priceOriginal ?? item.price ?? item.close, 0);
            
            // 전일 종가 파싱 (API 응답 우선 -> 계산된 값 -> 0)
            const prev = toNumber(item.prev_close ?? item.previousClose ?? item.yesterdayPrice, 0);
            
            // 등락률 파싱
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
              : (currency === Currency.KRW ? priceOrig : priceOrig); 

            // [수정됨] 최고가 매핑 로직 개선
            // 백엔드에서 high52w, high_52_week_price 등을 보내준다면 우선 사용
            // 없다면 당일 고가(high), 그것도 없다면 현재가 사용
            const highestPrice = toNumber(
                item.high52w ?? item.highest_52_week_price ?? item.high ?? priceOrig, 
                priceOrig
            );

            const result: AssetDataResult = {
              name: String(item.name ?? matched.ticker),
              priceOriginal: priceOrig,
              priceKRW,
              currency,
              previousClosePrice: prev, // API가 준 전일종가 사용
              highestPrice: highestPrice, // [수정됨] API 값 사용
              isMocked: !(priceOrig > 0),
              changeRate: changeRate,
              indicators: item.indicators, // 퀀트 지표 전달
            };
            
            resultMap.set(matched.id, result);
        });
      });

    } catch (e) {
      console.error('[priceService] Batch fetch failed:', e);
    }
    if (i + CHUNK_SIZE < assets.length) await sleep(CHUNK_DELAY_MS);
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

// 단일 조회 함수 (배치 함수 재사용)
export async function fetchAssetData(asset: { ticker: string; exchange: string; category?: AssetCategory; currency?: Currency }): Promise<AssetDataResult> {
    const map = await fetchBatchAssetPrices([{ ...asset, id: 'temp-id' }]);
    return map.get('temp-id') as AssetDataResult;
}

export async function fetchExchangeRate(): Promise<number> {
    return fetchCurrentExchangeRate(Currency.USD, Currency.KRW);
}

export async function fetchExchangeRateJPY(): Promise<number> {
    return fetchCurrentExchangeRate(Currency.JPY, Currency.KRW);
}

// 기본 환율 (폴백용)
const DEFAULT_EXCHANGE_RATES: Record<string, number> = {
    'USD-KRW': 1400,
    'JPY-KRW': 9.5,
    'EUR-KRW': 1500,
    'CNY-KRW': 195,
};

// 환율 캐시 (5분 TTL)
const exchangeRateCache = new Map<string, { rate: number; timestamp: number }>();
const EXCHANGE_RATE_CACHE_TTL = 5 * 60 * 1000; // 5분

function getCachedExchangeRate(key: string): number | null {
    const cached = exchangeRateCache.get(key);
    if (cached && Date.now() - cached.timestamp < EXCHANGE_RATE_CACHE_TTL) {
        console.log(`[priceService] 💱 Cache hit: ${key}`);
        return cached.rate;
    }
    exchangeRateCache.delete(key);
    return null;
}

function setCachedExchangeRate(key: string, rate: number): void {
    exchangeRateCache.set(key, { rate, timestamp: Date.now() });
}

/**
 * 현재 환율 조회 (Cloud Run API 사용, 5분 캐싱)
 */
export async function fetchCurrentExchangeRate(from: Currency, to: Currency): Promise<number> {
    const cacheKey = `current-${from}-${to}`;
    const cached = getCachedExchangeRate(cacheKey);
    if (cached !== null) return cached;

    try {
        const response = await fetch(`${STOCK_API_URL}/exchange-rate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to }),
        });

        if (!response.ok) throw new Error(`API Error: ${response.status}`);

        const data = await response.json();
        const rate = data.rate || DEFAULT_EXCHANGE_RATES[`${from}-${to}`] || 1;
        setCachedExchangeRate(cacheKey, rate);
        console.log(`[priceService] 💱 Fetched: ${from}→${to} = ${rate}`);
        return rate;
    } catch (e) {
        console.error('[priceService] fetchCurrentExchangeRate failed:', e);
        return DEFAULT_EXCHANGE_RATES[`${from}-${to}`] || 1;
    }
}

/**
 * 과거 날짜 환율 조회 (Cloud Run API 사용, 5분 캐싱)
 * @param date YYYY-MM-DD 형식
 */
export async function fetchHistoricalExchangeRate(date: string, from: Currency, to: Currency): Promise<number> {
    const cacheKey = `hist-${date}-${from}-${to}`;
    const cached = getCachedExchangeRate(cacheKey);
    if (cached !== null) return cached;

    try {
        const response = await fetch(`${STOCK_API_URL}/exchange-rate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to, date }),
        });

        if (!response.ok) throw new Error(`API Error: ${response.status}`);

        const data = await response.json();
        const rate = data.rate || DEFAULT_EXCHANGE_RATES[`${from}-${to}`] || 1;
        setCachedExchangeRate(cacheKey, rate);
        console.log(`[priceService] 💱 Fetched historical: ${date} ${from}→${to} = ${rate}`);
        return rate;
    } catch (e) {
        console.error('[priceService] fetchHistoricalExchangeRate failed:', e);
        return DEFAULT_EXCHANGE_RATES[`${from}-${to}`] || 1;
    }
}