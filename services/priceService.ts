import { AssetCategory, Currency, AssetDataResult, normalizeExchange } from '../types';

const STOCK_API_URL = 'https://asset-manager-887842923289.asia-northeast3.run.app';

function toNumber(v: any, fallback = 0): number {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

function createMockResult(ticker: string): AssetDataResult {
  return {
    name: ticker,
    priceOriginal: 0,
    priceKRW: 0,
    currency: 'KRW',
    pricePreviousClose: 0,
    highestPrice: 0,
    isMocked: true,
  };
}

async function fetchUpbitTicker(markets: string[]): Promise<any[]> {
  if (markets.length === 0) return [];
  const url = `https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(markets.join(','))}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Upbit API failed: ${res.status}`);
  return await res.json();
}

async function fetchStocksBatch(payload: Array<{ ticker: string; exchange?: string }>): Promise<any> {
  const res = await fetch(STOCK_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers: payload }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Stock API failed: ${res.status} ${text}`);
  }
  try {
    return await res.json();
  } catch {
    const text = await res.text().catch(() => '');
    throw new Error(`Stock API returned non-JSON: ${text}`);
  }
}

export async function fetchExchangeRate(): Promise<number> {
  try {
    const data = await fetchStocksBatch([{ ticker: 'USD/KRW', exchange: 'KRX' }]);
    const obj: any = Array.isArray(data?.results) ? data.results?.[0] : (Array.isArray(data) ? data[0] : data);
    const rate = toNumber(obj?.priceOriginal ?? obj?.price ?? obj?.close, 0);
    if (rate > 0) return rate;
    throw new Error('Invalid exchange rate data');
  } catch (e) {
    throw e;
  }
}

export async function fetchExchangeRateJPY(): Promise<number> {
  try {
    const data = await fetchStocksBatch([{ ticker: 'JPY/KRW', exchange: 'KRX' }]);
    const obj: any = Array.isArray(data?.results) ? data.results?.[0] : (Array.isArray(data) ? data[0] : data);
    const rate = toNumber(obj?.priceOriginal ?? obj?.price ?? obj?.close, 0);
    if (rate > 0) return rate;
    throw new Error('Invalid exchange rate data');
  } catch (e) {
    throw e;
  }
}

export async function fetchBatchAssetPrices(
  assets: { ticker: string; exchange: string; id: string; category?: AssetCategory; currency?: Currency }[],
): Promise<Map<string, AssetDataResult>> {
  const resultMap = new Map<string, AssetDataResult>();
  if (assets.length === 0) return resultMap;

  const cryptoItems = assets.filter(a => {
    const ex = (a.exchange || '').toLowerCase();
    return ex.includes('upbit') || ex.includes('bithumb') || ex.includes('coin') || ex.includes('주요 거래소');
  });
  const stockItems = assets.filter(a => !cryptoItems.includes(a));

  // Crypto (Upbit KRW market)
  try {
    const markets = cryptoItems.map(a => `KRW-${a.ticker.toUpperCase()}`);
    const upbitData = await fetchUpbitTicker(markets);
    upbitData.forEach((item: any) => {
      const market: string = item.market || '';
      const ticker = market.replace(/^KRW-/, '');
      const matched = cryptoItems.find(a => a.ticker.toUpperCase() === ticker.toUpperCase());
      if (!matched) return;
      const price = toNumber(item.trade_price, 0);
      const prev = toNumber(item.prev_closing_price, price);
      const result: AssetDataResult = {
        name: matched.ticker,
        priceOriginal: price,
        priceKRW: price,
        currency: 'KRW',
        pricePreviousClose: prev,
        highestPrice: price * 1.1,
        isMocked: false,
      };
      resultMap.set(matched.id, result);
    });
    // 폴백: 배치 누락된 항목은 개별 요청 시도
    const missing = cryptoItems.filter(a => !resultMap.has(a.id));
    for (const m of missing) {
      try {
        const single = await fetchUpbitTicker([`KRW-${m.ticker.toUpperCase()}`]);
        const item = Array.isArray(single) ? single[0] : null;
        if (item && item.trade_price !== undefined) {
          const price = toNumber(item.trade_price, 0);
          const prev = toNumber(item.prev_closing_price, price);
          resultMap.set(m.id, {
            name: m.ticker,
            priceOriginal: price,
            priceKRW: price,
            currency: Currency.KRW,
            pricePreviousClose: prev,
            highestPrice: price * 1.1,
            isMocked: false,
          });
        } else {
          resultMap.set(m.id, createMockResult(m.ticker));
        }
      } catch {
        resultMap.set(m.id, createMockResult(m.ticker));
      }
    }
  } catch (e: any) {
    // 404 등 배치 실패 시 개별 요청으로 폴백
    const is404 = typeof e?.status === 'number' ? e.status === 404 : String(e?.message || '').includes('404');
    if (is404) {
      for (const a of cryptoItems) {
        try {
          const single = await fetchUpbitTicker([`KRW-${a.ticker.toUpperCase()}`]);
          const item = Array.isArray(single) ? single[0] : null;
          if (item && item.trade_price !== undefined) {
            const price = toNumber(item.trade_price, 0);
            const prev = toNumber(item.prev_closing_price, price);
            resultMap.set(a.id, {
              name: a.ticker,
              priceOriginal: price,
              priceKRW: price,
              currency: Currency.KRW,
              pricePreviousClose: prev,
              highestPrice: price * 1.1,
              isMocked: false,
            });
          } else {
            resultMap.set(a.id, createMockResult(a.ticker));
          }
        } catch {
          resultMap.set(a.id, createMockResult(a.ticker));
        }
      }
    } else {
      cryptoItems.forEach(a => resultMap.set(a.id, createMockResult(a.ticker)));
    }
  }

  // Stocks (Cloud Run)
  try {
    if (stockItems.length > 0) {
      const payload = stockItems.map(s => ({ ticker: s.ticker, exchange: normalizeExchange(s.exchange) }));
      const data = await fetchStocksBatch(payload);
      const arr: any[] = Array.isArray(data?.results) ? data.results : (Array.isArray(data) ? data : []);
      arr.forEach((item: any) => {
        const ticker = String(item.ticker ?? item.symbol ?? '').toUpperCase();
        const matched = stockItems.find(a => a.ticker.toUpperCase() === ticker);
        if (!matched) return;
        const priceOrig = toNumber(item.priceOriginal ?? item.price ?? item.close, 0);
        const prev = toNumber(item.previousClose ?? item.prev_close ?? item.yesterdayPrice, priceOrig);
        const currency = String(item.currency ?? matched.currency ?? Currency.USD);
        const priceKRW = typeof item.priceKRW === 'number'
          ? item.priceKRW
          : (currency === Currency.KRW ? priceOrig : priceOrig);
        const name = String(item.name ?? matched.ticker);
        const result: AssetDataResult = {
          name,
          priceOriginal: priceOrig,
          priceKRW,
          currency,
          pricePreviousClose: prev,
          highestPrice: (currency === Currency.KRW ? priceKRW : priceOrig) * 1.1,
          isMocked: false,
        };
        resultMap.set(matched.id, result);
      });
      // fill missing
      stockItems.forEach(s => {
        if (!resultMap.has(s.id)) resultMap.set(s.id, createMockResult(s.ticker));
      });
    }
  } catch (e) {
    stockItems.forEach(s => resultMap.set(s.id, createMockResult(s.ticker)));
  }

  return resultMap;
}

export async function fetchAssetData(asset: { ticker: string; exchange: string; category?: AssetCategory; currency?: Currency }): Promise<AssetDataResult> {
  const normalizedExchange = normalizeExchange(asset.exchange);
  const isCrypto = (() => {
    const ex = (asset.exchange || '').toLowerCase();
    return ex.includes('upbit') || ex.includes('bithumb') || ex.includes('coin') || ex.includes('주요 거래소');
  })();
  if (isCrypto) {
    try {
      const market = `KRW-${asset.ticker.toUpperCase()}`;
      const [data] = await fetchUpbitTicker([market]);
      const price = toNumber(data?.trade_price, 0);
      const prev = toNumber(data?.prev_closing_price, price);
      return {
        name: asset.ticker,
        priceOriginal: price,
        priceKRW: price,
        currency: 'KRW',
        pricePreviousClose: prev,
        highestPrice: price * 1.1,
        isMocked: false,
      };
    } catch {
      return createMockResult(asset.ticker);
    }
  }
  // stock single
  try {
    const data = await fetchStocksBatch([{ ticker: asset.ticker, exchange: normalizedExchange }]);
    const obj: any = Array.isArray(data?.results) ? data.results?.[0] : (Array.isArray(data) ? data[0] : data);
    const priceOrig = toNumber(obj?.priceOriginal ?? obj?.price ?? obj?.close, 0);
    const prev = toNumber(obj?.previousClose ?? obj?.prev_close ?? obj?.yesterdayPrice, priceOrig);
    const currency = String(obj?.currency ?? asset.currency ?? Currency.USD);
    const priceKRW = typeof obj?.priceKRW === 'number'
      ? obj.priceKRW
      : (currency === Currency.KRW ? priceOrig : priceOrig);
    const name = String(obj?.name ?? asset.ticker);
    return {
      name,
      priceOriginal: priceOrig,
      priceKRW,
      currency,
      pricePreviousClose: prev,
      highestPrice: (currency === Currency.KRW ? priceKRW : priceOrig) * 1.1,
      isMocked: false,
    };
  } catch {
    return createMockResult(asset.ticker);
  }
}

