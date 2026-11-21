import { Currency } from './index';

export interface AssetDataResult {
  name: string;
  priceOriginal: number;
  priceKRW: number;
  currency: Currency;
  previousClosePrice: number; // Renamed from pricePreviousClose
  highestPrice?: number;
  isMocked: boolean;
  quoteDate?: string;
  quoteTradeAt?: string;
  changeRate?: number;
  indicators?: Indicators;
}

export interface UpbitTicker {
  market: string;
  quoteTradeAt?: string;
  trade_price: number;
  prev_closing_price: number;
  signed_change_price: number;
  signed_change_rate: number;
  high_price?: number; // 당일 고가
  low_price?: number;  // 당일 저가
  highest_52_week_price?: number; // [추가] 52주 신고가
}
export type UpbitTickerResponse = Partial<Omit<UpbitTicker, 'quoteTradeAt'>> & { trade_timestamp?: number; error?: unknown };

export interface PriceItem {
  ticker?: string;
  symbol?: string;
  name?: string;
  priceOriginal?: number;
  priceKRW?: number;
  price?: number;
  close?: number;
  previousClose?: number;
  prev_close?: number;
  yesterdayPrice?: number;
  change_rate?: number;
  currency?: Currency | string;
  indicators?: Indicators;
}

export type PriceAPIArrayResponse = PriceItem[];
export type PriceAPIObjectResponse = Record<string, PriceItem>;
export interface PriceAPIResultResponse {
  results: PriceItem[];
}
export type PriceAPIResponse = PriceAPIArrayResponse | PriceAPIObjectResponse | PriceAPIResultResponse;

export type SignalType = 'STRONG_BUY' | 'BUY' | 'SELL' | 'STRONG_SELL' | 'NEUTRAL';
export type RSIStatus = 'OVERBOUGHT' | 'OVERSOLD' | 'NORMAL';

export interface Indicators {
  ma20?: number;
  ma60?: number;
  rsi?: number;
  rsi_status?: RSIStatus;
  signal?: SignalType;
  volume?: number;           // 당일 거래량
  volume_avg20?: number;     // 20일 평균 거래량
  volume_ratio?: number;     // 당일/20일평균 비율
}
