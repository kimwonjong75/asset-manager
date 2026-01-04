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

function createMockResult(ticker: string): AssetDataResult {
  return {
    name: ticker,
    priceOriginal: 0,
    priceKRW: 0,
    currency: Currency.KRW,
    previousClosePrice: 0,
    highestPrice: 0,
    isMocked: true,
  };
}

function extractByTickerKey(data: PriceAPIResponse, key?: string): PriceItem | undefined {
  if (!data) return undefined;
  if ('results' in data && Array.isArray((data as { results: PriceItem[] }).results)) {
    if (!key) return (data as { results: PriceItem[] }).results?.[0];
    const k = String(key).toUpperCase();
    return (data as { results: PriceItem[] }).results.find((x) => String(x?.ticker ?? x?.symbol ?? '').toUpperCase() === k);
  }
  if (Array.isArray(data)) {
    if (!key) return data[0];
    const k = String(key).toUpperCase();
    return data.find((x) => String(x?.ticker ?? x?.symbol ?? '').toUpperCase() === k);
  }
  if (typeof data === 'object') {
    if (!key) {
      const firstKey = Object.keys(data)[0];
      return data[firstKey];
    }
    const k = String(key).toUpperCase();
    const direct = Object.prototype.hasOwnProperty.call(data, k) ? (data as Record<string, PriceItem>)[k] : undefined;
    if (direct) return direct;
    const alt = Object.keys(data).find((kk) => String(kk).toUpperCase() === k);
    return alt ? (data as Record<string, PriceItem>)[alt] : undefined;
  }
  return undefined;
}

async function fetchStocksBatch(payload: Array<{ ticker: string; exchange?: string }>): Promise<PriceAPIResponse> {
  console.log('fetchStocksBatch request', payload);
  const res = await fetch(STOCK_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers: payload }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`시세 서버 호출 실패: ${res.status} ${text}`);
  }
  try {
    const json = await res.json();
    console.log('fetchStocksBatch response', json);
    return json;
  } catch {
    const text = await res.text().catch(() => '');
    console.error('fetchStocksBatch parse failed', {
      status: res.status,
      contentType: res.headers.get('Content-Type') ?? res.headers.get('content-type') ?? '',
      preview: typeof text === 'string' ? text.slice(0, 512) : '',
    });
    throw new Error(`시세 서버 응답 처리 실패: ${text}`);
  }
}

export async function fetchExchangeRate(): Promise<number> {
  try {
    const data = await fetchStocksBatch([{ ticker: 'USD/KRW', exchange: 'KRX' }]);
    const obj = extractByTickerKey(data, 'USD/KRW');
    console.log('fetchExchangeRate parsed', obj);
    const rate = toNumber(obj?.priceOriginal ?? obj?.price ?? obj?.close, 0);
    if (rate > 0) return rate;
    throw new Error('환율 데이터가 올바르지 않습니다');
  } catch (e) {
    throw e;
  }
}

export async function fetchExchangeRateJPY(): Promise<number> {
  try {
    const data = await fetchStocksBatch([{ ticker: 'JPY/KRW', exchange: 'KRX' }]);
    const obj = extractByTickerKey(data, 'JPY/KRW');
    console.log('fetchExchangeRateJPY parsed', obj);
    const rate = toNumber(obj?.priceOriginal ?? obj?.price ?? obj?.close, 0);
    if (rate > 0) return rate;
    throw new Error('엔화 환율 데이터가 올바르지 않습니다');
  } catch (e) {
    throw e;
  }
}

export async function fetchBatchAssetPrices(
  assets: { ticker: string; exchange: string; id: string; category?: AssetCategory; currency?: Currency }[],
): Promise<Map<string, AssetDataResult>> {
  const resultMap = new Map<string, AssetDataResult>();
  if (assets.length === 0) return resultMap;

  for (let i = 0; i < assets.length; i += CHUNK_SIZE) {
    const chunk = assets.slice(i, i + CHUNK_SIZE);
    const payload = chunk.map(s => {
      // 카테고리 무관하게 원본 티커 그대로 사용
      // (만약 Yahoo Finance로 코인을 조회하고 싶다면, 사용자가 애초에 'BTC-USD'로 입력해야 함)
      const reqTicker = String(s.ticker).toUpperCase(); 
      return { ticker: reqTicker, exchange: normalizeExchange(s.exchange) };
    });
    console.log('fetchBatchAssetPrices payload', payload);
    try {
      const data = await fetchStocksBatch(payload);
      console.log('fetchBatchAssetPrices raw response', data);
      const items: PriceItem[] = [];
      if ('results' in data && Array.isArray((data as { results: PriceItem[] }).results)) {
        items.push(...(data as { results: PriceItem[] }).results);
      } else if (Array.isArray(data)) {
        items.push(...data);
      } else if (typeof data === 'object' && data) {
        Object.keys(data).forEach(k => {
          const v = data[k];
          if (v && typeof v === 'object') items.push({ ...v, ticker: k });
        });
      }
      items.forEach((item: PriceItem) => {
        const ticker = String(item.ticker ?? item.symbol ?? '').toUpperCase();
        const normalizedTicker = ticker.endsWith('-USD') ? ticker.replace(/-USD$/i, '') : ticker;
        const matched = assets.find(a => a.ticker.toUpperCase() === normalizedTicker);
        if (!matched) return;
        const priceOrig = toNumber(item.priceOriginal ?? item.price ?? item.close, 0);
        const prev = toNumber(item.previousClose ?? item.prev_close ?? item.yesterdayPrice, priceOrig);
        const currencyFromServer = String(item.currency ?? matched.currency ?? Currency.USD);
        const keepOriginalCurrency = matched.category === AssetCategory.CRYPTOCURRENCY;
        const currencyStr = keepOriginalCurrency ? String(matched.currency ?? currencyFromServer) : currencyFromServer;
        const currency: Currency = [Currency.KRW, Currency.USD, Currency.JPY, Currency.CNY].includes(currencyStr as Currency)
          ? (currencyStr as Currency)
          : Currency.KRW;
        const priceKRW = typeof item.priceKRW === 'number'
          ? item.priceKRW
          : (currency === Currency.KRW ? priceOrig : priceOrig);
        const name = String(item.name ?? matched.ticker);
        const isMocked = !(priceOrig > 0);
        const result: AssetDataResult = {
          name,
          priceOriginal: priceOrig,
          priceKRW,
          currency,
          previousClosePrice: prev,
          highestPrice: (currency === Currency.KRW ? priceKRW : priceOrig) * 1.1,
          isMocked,
        };
        resultMap.set(matched.id, result);
      });
    } catch (e) {
      console.error('API Error Details:', e);
      console.error('Chunk meta', { index: Math.floor(i / CHUNK_SIZE), size: chunk.length });
      await sleep(1000);
      try {
        const data = await fetchStocksBatch(payload);
        console.log('fetchBatchAssetPrices raw response (retry)', data);
        const items: PriceItem[] = [];
        if ('results' in data && Array.isArray((data as { results: PriceItem[] }).results)) {
          items.push(...(data as { results: PriceItem[] }).results);
        } else if (Array.isArray(data)) {
          items.push(...data);
        } else if (typeof data === 'object' && data) {
          Object.keys(data).forEach(k => {
            const v = data[k];
            if (v && typeof v === 'object') items.push({ ...v, ticker: k });
          });
        }
        items.forEach((item: PriceItem) => {
          const ticker = String(item.ticker ?? item.symbol ?? '').toUpperCase();
          const normalizedTicker = ticker.endsWith('-USD') ? ticker.replace(/-USD$/i, '') : ticker;
          const matched = assets.find(a => a.ticker.toUpperCase() === normalizedTicker);
          if (!matched) return;
          const priceOrig = toNumber(item.priceOriginal ?? item.price ?? item.close, 0);
          const prev = toNumber(item.previousClose ?? item.prev_close ?? item.yesterdayPrice, priceOrig);
          const currencyFromServer = String(item.currency ?? matched.currency ?? Currency.USD);
          const keepOriginalCurrency = matched.category === AssetCategory.CRYPTOCURRENCY;
          const currencyStr = keepOriginalCurrency ? String(matched.currency ?? currencyFromServer) : currencyFromServer;
          let currency: Currency = [Currency.KRW, Currency.USD, Currency.JPY, Currency.CNY].includes(currencyStr as Currency)
            ? (currencyStr as Currency)
            : Currency.KRW;

          if (matched.exchange === 'Upbit' || matched.exchange === 'Bithumb') {
            currency = Currency.KRW;
          }

          const priceKRW = typeof item.priceKRW === 'number'
            ? item.priceKRW
            : (currency === Currency.KRW ? priceOrig : priceOrig);
          const name = String(item.name ?? matched.ticker);
          const isMocked = !(priceOrig > 0);
          const result: AssetDataResult = {
            name,
            priceOriginal: priceOrig,
            priceKRW,
            currency,
            previousClosePrice: prev,
            highestPrice: (currency === Currency.KRW ? priceKRW : priceOrig) * 1.1,
            isMocked,
          };
          resultMap.set(matched.id, result);
        });
      } catch (e2) {
        console.error('API Error Details (retry failed):', e2);
      }
    }
    await sleep(CHUNK_DELAY_MS);
  }

  assets.forEach(s => {
    if (!resultMap.has(s.id)) resultMap.set(s.id, {
      name: s.ticker,
      priceOriginal: 0,
      priceKRW: 0,
      currency: (s.currency ?? Currency.USD),
      previousClosePrice: 0,
      highestPrice: 0,
      isMocked: true,
    });
  });

  return resultMap;
}

export async function fetchAssetData(asset: { ticker: string; exchange: string; category?: AssetCategory; currency?: Currency }): Promise<AssetDataResult> {
  const normalizedExchange = normalizeExchange(asset.exchange);
  try {
    const isCrypto = asset.category === AssetCategory.CRYPTOCURRENCY;
    const reqTicker = isCrypto ? `${String(asset.ticker).toUpperCase()}-USD` : String(asset.ticker).toUpperCase();
    const data = await fetchStocksBatch([{ ticker: reqTicker, exchange: normalizedExchange }]);
    const obj = extractByTickerKey(data, reqTicker);
    console.log('fetchAssetData parsed', obj);
    const priceOrig = toNumber(obj?.priceOriginal ?? obj?.price ?? obj?.close, 0);
    const prev = toNumber(obj?.previousClose ?? obj?.prev_close ?? obj?.yesterdayPrice, priceOrig);
    const currencyStr = String(obj?.currency ?? asset.currency ?? Currency.USD);
    const currency: Currency = [Currency.KRW, Currency.USD, Currency.JPY, Currency.CNY].includes(currencyStr as Currency)
      ? (currencyStr as Currency)
      : Currency.KRW;
    const priceKRW = typeof obj?.priceKRW === 'number'
      ? obj.priceKRW
      : (currency === Currency.KRW ? priceOrig : priceOrig);
    const name = String(obj?.name ?? asset.ticker);
    return {
      name,
      priceOriginal: priceOrig,
      priceKRW,
      currency,
      previousClosePrice: prev,
      highestPrice: (currency === Currency.KRW ? priceKRW : priceOrig) * 1.1,
      isMocked: false,
    };
  } catch {
    throw new Error('시세 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.');
  }
}

