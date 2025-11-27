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

export const fetchUpbitPrice = async (symbol: string): Promise<UpbitTicker> => {
  const market = toUpbitPair(symbol);
  const res = await fetch(`https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(market)}`, {
    headers: { Accept: 'application/json' }
  });
  if (!res.ok) throw new Error(`upbit failed ${res.status}`);
  const data = await res.json();
  const item = Array.isArray(data) ? data[0] : null;
  if (!item || !item.market) throw new Error('upbit no data');
  return item as UpbitTicker;
};

