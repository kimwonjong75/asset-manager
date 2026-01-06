import { Currency } from './index';

export interface AssetDataResult {
  name: string;
  priceOriginal: number;
  priceKRW: number;
  currency: Currency;
  previousClosePrice: number; // Renamed from pricePreviousClose
  highestPrice?: number;
  isMocked: boolean;
  changeRate?: number;
  indicators?: Indicators;
}

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
}
