import { Currency, CURRENCY_SYMBOLS, ExchangeRates } from '../../types';

export const getValueInKRW = (
  value: number, 
  currency: Currency, 
  exchangeRates: ExchangeRates
): number => {
  switch (currency) {
    case Currency.USD: return value * (exchangeRates.USD || 0);
    case Currency.JPY: return value * (exchangeRates.JPY || 0);
    case Currency.KRW: default: return value;
  }
};

export const formatNumber = (num: number) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(num);

export const formatKRW = (num: number) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(num);

export const formatOriginalCurrency = (num: number, currency: Currency) => {
  const symbol = CURRENCY_SYMBOLS[currency];
  if (currency === Currency.KRW || currency === Currency.JPY) {
       return `${symbol}${formatNumber(num)}`;
  }
  return `${symbol}${new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(num)}`;
};

export const formatProfitLoss = (num: number, currency: Currency) => {
  const sign = num >= 0 ? '+' : '';
  if (currency === Currency.KRW) {
    return `${sign}${formatKRW(num)}`;
  }
  return `${sign}${formatOriginalCurrency(num, currency)}`;
};

export const getChangeColor = (value: number) => (value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-gray-400');
