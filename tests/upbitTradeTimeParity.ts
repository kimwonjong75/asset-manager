import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UpbitTradeTime } from '../components/portfolio-table/columnDefinitions';
import { fetchUpbitPricesBatch } from '../services/upbitService';

// The ticker snapshot timestamp is deliberately later than its last trade.
const eventMs = Date.parse('2026-11-20T15:01:02.345Z');
const ticker = {
  market: 'KRW-BTC',
  trade_price: 100,
  prev_closing_price: 98,
  signed_change_price: 2,
  signed_change_rate: 0.02,
  trade_timestamp: eventMs,
  timestamp: eventMs + 60_000,
};
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => Response.json([ticker]);
  const quotes = await fetchUpbitPricesBatch(['BTC']);
  assert.equal(quotes.get('BTC')?.quoteTradeAt, '2026-11-20T15:01:02.345Z');
  assert.equal(quotes.get('KRW-BTC')?.trade_price, 100);
  const html = renderToStaticMarkup(createElement(UpbitTradeTime, {
    exchange: '주요 거래소 (종합)', quoteTradeAt: quotes.get('BTC')?.quoteTradeAt,
  }));
  assert.match(html, /2026-11-21 00:01:02 KST/);

  // A proxy quote without a trade instant must not inherit the prior event.
  globalThis.fetch = async (input) => String(input).includes('api.upbit.com')
    ? new Response(null, { status: 429 })
    : Response.json({ 'KRW-BTC': {
        market: 'KRW-BTC', trade_price: 99, prev_closing_price: 98,
        signed_change_rate: 0.01, timestamp: eventMs + 120_000,
      } });
  const fallback = (await fetchUpbitPricesBatch(['BTC'])).get('BTC');
  assert.equal(fallback?.trade_price, 99);
  assert.equal(fallback?.quoteTradeAt, undefined);
} finally {
  globalThis.fetch = originalFetch;
}
