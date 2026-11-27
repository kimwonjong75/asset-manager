import type { RawSeries } from './todayTurtle';
import { Currency } from '../types';
import { MAX_REASONABLE_EXCHANGE_RATES } from './portfolioMetrics';

/** /history의 환율은 외화 한 단위당 원화 금액이다. */
export function holdingPolicyFxTicker(currency: string): string | null {
  if (currency === 'USD' || currency === 'JPY') return `${currency}/KRW`;
  return null;
}

/** 해당 거래일 환율만 사용한다. 외화 휴장일과 데이터 누락은 확인 필요 상태로 남긴다. */
export function holdingPolicyFxRate(currency: string, date: string, raw: RawSeries | undefined): number | null {
  if (currency === 'KRW') return 1;
  if (currency !== Currency.USD && currency !== Currency.JPY) return null;
  const rate = raw?.data?.[date];
  const limit = MAX_REASONABLE_EXCHANGE_RATES[currency];
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 && (limit == null || rate <= limit) ? rate : null;
}
