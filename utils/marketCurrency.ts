import { Currency } from '../types';

/**
 * 거래소 문자열만으로 통화를 확정할 수 있는 시장을 판정한다.
 * HKEX처럼 Currency enum이 지원하지 않는 시장은 임의 통화로 치환하지 않는다.
 */
export function inferCurrencyFromExchange(exchange: string | undefined): Currency | undefined {
  const normalized = exchange?.trim().toUpperCase() ?? '';
  if (!normalized) return undefined;

  if (
    normalized.includes('KRX')
    || normalized.includes('KONEX')
    || normalized === 'UPBIT'
    || normalized === 'BITHUMB'
    || normalized.includes('거래소 (종합)')
  ) return Currency.KRW;

  if (
    normalized === 'NASDAQ'
    || normalized === 'NYSE'
    || normalized === 'AMEX'
    || normalized === 'NYSE AMERICAN'
    || normalized === 'COMEX'
    || normalized === 'LBMA'
    || normalized === 'NYMEX'
    || normalized === 'CME'
    || normalized === 'ICE'
  ) return Currency.USD;

  if (normalized.includes('TSE') || normalized.includes('도쿄')) return Currency.JPY;
  if (
    normalized.includes('SSE')
    || normalized.includes('SZSE')
    || normalized.includes('상하이')
    || normalized.includes('선전')
  ) return Currency.CNY;

  return undefined;
}

/**
 * 차트·시세 저장에 사용할 통화. 시장이 명확하면 거래소가 최우선이고,
 * 그렇지 않을 때만 API 응답 → 기존 저장값 → KRW 순으로 폴백한다.
 */
export function resolveMarketCurrency(
  exchange: string | undefined,
  apiCurrency?: Currency,
  storedCurrency?: Currency,
): Currency {
  return inferCurrencyFromExchange(exchange) ?? apiCurrency ?? storedCurrency ?? Currency.KRW;
}
