// services/marketIndexService.ts
// 시장 지수(S&P500/NASDAQ/KOSPI/KOSDAQ) OHLCV 조회
// 기존 historicalPriceService의 `/history` 엔드포인트를 재활용 (FinanceDataReader가 Yahoo-style ticker 지원)

import {
  fetchStockHistoricalPrices,
  type HistoricalPriceResult,
} from './historicalPriceService';
import { createLogger } from '../utils/logger';

const log = createLogger('MarketIndex');

/** 추적할 시장 지수 정의 — Yahoo Finance ticker 기반 */
export const MARKET_INDEX_DEFS = [
  { ticker: '^GSPC', name: 'S&P 500' },
  { ticker: '^IXIC', name: '나스닥' },
  { ticker: '^KS11', name: '코스피' },
  { ticker: '^KQ11', name: '코스닥' },
] as const;

export type MarketIndexTicker = (typeof MARKET_INDEX_DEFS)[number]['ticker'];

/**
 * 시장 지수 OHLCV 일괄 조회 — 최근 days일치
 * 백엔드가 지수 ticker를 지원하지 않거나 fetch 실패 시 빈 객체 반환 (배너 자동 dormant)
 */
export async function fetchMarketIndicesOHLCV(
  tickers: readonly string[],
  days: number
): Promise<Record<string, HistoricalPriceResult>> {
  if (tickers.length === 0) return {};

  const endDate = new Date().toISOString().split('T')[0];
  const startD = new Date();
  startD.setDate(startD.getDate() - days);
  const startDate = startD.toISOString().split('T')[0];

  try {
    const result = await fetchStockHistoricalPrices([...tickers], startDate, endDate);
    return result;
  } catch (err) {
    log.error('market index fetch error:', err);
    return {};
  }
}
