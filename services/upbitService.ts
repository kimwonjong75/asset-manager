// services/upbitService.ts

import type { UpbitTicker, UpbitTickerResponse } from '../types/api';
export type { UpbitTicker } from '../types/api';
import { CLOUD_RUN_BASE_URL } from '../constants/api';
import { createLogger } from '../utils/logger';
import { recordLoadRequest, loadTimingNow } from '../utils/loadTiming';

const log = createLogger('Upbit');
const UPBIT_PROXY_URL = `${CLOUD_RUN_BASE_URL}/upbit`;

const TRADE_TIME_MARKETS = new Set(['KRW-BTC', 'KRW-ETH', 'KRW-SOL']);

// 심볼 변환 (BTC -> KRW-BTC)
export const toUpbitPair = (symbol: string): string => {
  const s = (symbol || '').trim().toUpperCase();
  if (!s) return '';
  if (s.startsWith('KRW-') || s.startsWith('BTC-') || s.startsWith('USDT-')) {
    return s;
  }
  return `KRW-${s.replace(/USDT$/, '')}`;
};

// 체결 가격과 시각을 같은 스냅샷에서 읽는다. timestamp(호가 조회 시각)는 사용하지 않는다.
const toTicker = (data: UpbitTickerResponse, market: string): UpbitTicker | undefined => {
  if (!data || data.error || typeof data.trade_price !== 'number' || !Number.isFinite(data.trade_price) || data.trade_price <= 0) return;
  const ms = data.trade_timestamp;
  const date = typeof ms === 'number' && Number.isSafeInteger(ms) && ms >= 1_000_000_000_000 ? new Date(ms) : undefined;
  return {
    market: data.market || market,
    trade_price: data.trade_price,
    quoteTradeAt: date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined,
    prev_closing_price: data.prev_closing_price || 0,
    signed_change_price: data.signed_change_price || 0,
    signed_change_rate: data.signed_change_rate || 0,
    high_price: data.high_price,
    low_price: data.low_price,
    highest_52_week_price: data.highest_52_week_price,
  };
};

export const fetchUpbitPricesBatch = async (symbols: string[]): Promise<Map<string, UpbitTicker>> => {
  const quotes = new Map<string, UpbitTicker>();
  const requested = [...new Set(symbols.map(s => (s || '').trim().toUpperCase()).filter(Boolean))];
  if (!requested.length) return quotes;
  const markets = [...new Set(requested.map(toUpbitPair).filter(market => TRADE_TIME_MARKETS.has(market)))];
  const start = loadTimingNow();
  try {
    if (markets.length) {
      try {
        const response = await fetch(`https://api.upbit.com/v1/ticker?markets=${markets.join(',')}`);
        if (!response.ok) throw new Error(`Upbit HTTP ${response.status}`);
        const rows: UpbitTickerResponse[] = await response.json();
        for (const row of rows) {
          if (!row.market || !markets.includes(row.market)) continue;
          const quote = toTicker(row, row.market);
          if (quote?.quoteTradeAt) {
            quotes.set(row.market, quote);
            quotes.set(row.market.slice(4), quote);
          }
        }
      } catch (error) {
        log.warn('업비트 체결 조회 실패, 프록시로 재조회:', error);
      }
    }

    const remaining = requested.filter(symbol => !quotes.has(symbol));
    if (remaining.length) {
      const response = await fetch(UPBIT_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ symbols: remaining }),
      });
      if (!response.ok) throw new Error(`Upbit proxy HTTP ${response.status}`);
      const data: Record<string, UpbitTickerResponse> = await response.json();
      for (const [market, row] of Object.entries(data)) {
        const quote = toTicker(row, market);
        if (!quote) continue;
        quotes.set(market, quote);
        if (market.startsWith('KRW-') || market.startsWith('BTC-')) {
          const symbol = market.slice(4);
          if (!quotes.has(symbol)) quotes.set(symbol, quote);
        }
      }
    }
  } catch (error) {
    log.error('업비트 프록시 조회 실패:', error);
  } finally {
    recordLoadRequest('upbit', { tickers: requested.length, ms: loadTimingNow() - start, ok: requested.every(s => quotes.has(s)) });
  }
  return quotes;
};

// 단일 코인 조회
export const fetchUpbitPrice = async (symbol: string): Promise<UpbitTicker | null> => {
  const result = await fetchUpbitPricesBatch([symbol]);
  const ticker = result.get(symbol.toUpperCase()) || result.get(toUpbitPair(symbol));
  return ticker || null;
};
