export interface UpbitTicker {
  market: string;
  trade_price: number;
  prev_closing_price: number;
  signed_change_price?: number;
  signed_change_rate?: number;
  high_price?: number;
  low_price?: number;
  acc_trade_volume_24h?: number;
  timestamp?: number;
}

export const toUpbitPair = (symbol: string): string => {
  const s = (symbol || '').replace(/\s+/g, '').toUpperCase();
  if (s.endsWith('USDT')) return `KRW-${s.replace(/USDT$/, '')}`;
  return `KRW-${s}`;
};

const buildProxyUrl = (url: string): string => {
  const base = (import.meta as any).env?.VITE_UPBIT_PROXY_BASE as string | undefined;
  if (base && base.length > 0) {
    if (base.includes('/?')) return `${base}${url}`;
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}url=${encodeURIComponent(url)}`;
  }
  return url;
};

const cache: Map<string, { data: UpbitTicker; ts: number }> = new Map();
const TTL = 5000;

export const fetchUpbitPrice = async (symbol: string): Promise<UpbitTicker> => {
  const market = toUpbitPair(symbol);
  const key = market;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < TTL) return hit.data;
  const url = `https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(market)}`;
  const res = await fetch(buildProxyUrl(url), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`upbit failed ${res.status}`);
  const data = await res.json();
  const item = Array.isArray(data) ? data[0] : null;
  if (!item || !item.market) throw new Error('upbit no data');
  const out = item as UpbitTicker;
  cache.set(key, { data: out, ts: now });
  return out;
};

export const fetchUpbitPrices = async (symbols: string[]): Promise<Record<string, UpbitTicker>> => {
  const markets = Array.from(new Set(symbols.map(toUpbitPair)));
  const url = `https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(markets.join(','))}`;
  const res = await fetch(buildProxyUrl(url), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`upbit batch failed ${res.status}`);
  const arr = await res.json();
  const out: Record<string, UpbitTicker> = {};
  if (Array.isArray(arr)) {
    for (const it of arr) {
      if (it?.market) {
        out[it.market] = it as UpbitTicker;
        cache.set(it.market, { data: it as UpbitTicker, ts: Date.now() });
      }
    }
  }
  return out;
};
