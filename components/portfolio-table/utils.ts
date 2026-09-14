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

export const formatQuantity = (quantity: number, isCrypto: boolean): string => {
  if (isCrypto) {
    return new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: 8 }).format(quantity);
  }
  return formatNumber(quantity);
};

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

// Stage B — 방향 색 단일 결정점(utils/directionTone)으로 위임. 빨강=오름 / 파랑=내림 / 회색=0·결측
export { directionTextClass as getChangeColor } from '../../utils/directionTone';
