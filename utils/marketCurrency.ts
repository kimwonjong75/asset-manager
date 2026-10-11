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

/** 국내 상장 종목의 KRX 단축코드(일반 6자리 및 신형 영문 혼합 코드)인지 판정한다. */
export function isLikelyKrxTicker(ticker: string | undefined): boolean {
  const normalized = ticker?.trim().toUpperCase() ?? '';
  return /^\d{6}$/.test(normalized) || /^\d{4}[A-Z]\d$/.test(normalized);
}

/**
 * 차트·시세 저장에 사용할 통화. KRX 형식 티커가 미국 거래소로 잘못 저장된 경우를 먼저
 * KRW로 교정하고, 그 외에는 API 응답 → 명확한 거래소 → 기존 저장값 → KRW 순으로 폴백한다.
 * 중국의 6자리 티커처럼 거래소가 CNY/JPY로 명확한 경우에는 KRX로 오인하지 않는다.
 */
export function resolveMarketCurrency(
  exchange: string | undefined,
  apiCurrency?: Currency,
  storedCurrency?: Currency,
  ticker?: string,
): Currency {
  const exchangeCurrency = inferCurrencyFromExchange(exchange);
  if (
    isLikelyKrxTicker(ticker)
    && (exchangeCurrency === undefined || exchangeCurrency === Currency.USD)
  ) return Currency.KRW;

  return apiCurrency ?? exchangeCurrency ?? storedCurrency ?? Currency.KRW;
}
