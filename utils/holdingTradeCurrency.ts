import { Currency } from '../types';
import { isCryptoExchange } from './marketCurrency';

/** 국내 코인 일봉은 KRW. 이전 잔고의 매입 통화는 외화일 수 있다. */
export function hasDifferentTurtleFillCurrency(exchange: string, currency: Currency | undefined): boolean {
  return isCryptoExchange(exchange) && currency !== Currency.KRW;
}
