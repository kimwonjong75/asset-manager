import { Currency, ExchangeRates } from '../types';
import { createLogger } from './logger';

const log = createLogger('exchangeRateCache');

const STORAGE_KEY = 'asset-manager-last-known-rates-v1';

// 통화별 합리적 최소값 — 이보다 작으면 비정상으로 간주
const MIN_VALID_RATE: Record<keyof ExchangeRates, number> = {
  USD: 100,
  JPY: 1,
};

interface CachedRates {
  USD?: number;
  JPY?: number;
  timestamp?: number;
}

let memoryCache: CachedRates | null = null;

export const loadLastKnownRates = (): CachedRates => {
  if (memoryCache) return memoryCache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CachedRates;
    memoryCache = parsed;
    return parsed;
  } catch (e) {
    log.warn('환율 캐시 로드 실패', e);
    return {};
  }
};

export const saveLastKnownRates = (rates: ExchangeRates): void => {
  try {
    const next: CachedRates = { ...loadLastKnownRates() };
    if (rates.USD && rates.USD >= MIN_VALID_RATE.USD) next.USD = rates.USD;
    if (rates.JPY && rates.JPY >= MIN_VALID_RATE.JPY) next.JPY = rates.JPY;
    next.timestamp = Date.now();
    memoryCache = next;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    log.warn('환율 캐시 저장 실패', e);
  }
};

// 현재 환율이 유효하면 그것을, 아니면 캐시값을, 둘 다 없으면 0 반환
export const resolveRate = (
  currency: Currency,
  exchangeRates: ExchangeRates,
): number => {
  if (currency === Currency.KRW) return 1;
  const key = currency as keyof ExchangeRates;
  const min = MIN_VALID_RATE[key];
  if (min === undefined) return 0;

  const current = exchangeRates[key];
  if (current && current >= min) return current;

  const cached = loadLastKnownRates()[key];
  if (cached && cached >= min) return cached;

  return 0;
};

// 외화 자산을 KRW 평가하기 위한 환율이 확보 가능한지 (필터 적용 안전성 판단용)
export const hasResolvableRates = (
  currencies: Currency[],
  exchangeRates: ExchangeRates,
): boolean => {
  const unique = Array.from(new Set(currencies));
  return unique.every(c => c === Currency.KRW || resolveRate(c, exchangeRates) > 0);
};
