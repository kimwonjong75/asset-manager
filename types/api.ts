import { Currency } from './index';

export interface AssetDataResult {
  name: string;
  priceOriginal: number;
  priceKRW: number;
  currency: Currency;
  previousClosePrice: number; // Renamed from pricePreviousClose
  highestPrice?: number;
  isMocked: boolean;
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
  currency?: Currency | string;
}

export type PriceAPIArrayResponse = PriceItem[];
export type PriceAPIObjectResponse = Record<string, PriceItem>;
export interface PriceAPIResultResponse {
  results: PriceItem[];
}
export type PriceAPIResponse = PriceAPIArrayResponse | PriceAPIObjectResponse | PriceAPIResultResponse;
