import { Currency, ExchangeRates } from '../types';
import { createLogger } from './logger';

const log = createLogger('exchangeRateCache');

const STORAGE_KEY = 'asset-manager-last-known-rates-v1';

/** 환율을 실제로 제공하는 통화 (KRW=항상 1, CNY=소스 없음 → 제외) */
type RatedCurrency = 'USD' | 'JPY';

const isRatedCurrency = (k: string): k is RatedCurrency => k === 'USD' || k === 'JPY';

// 통화별 합리적 최소값 — 이보다 작으면 비정상으로 간주
const MIN_VALID_RATE: Record<RatedCurrency, number> = {
  USD: 100,
  JPY: 1,
};

type CachedRates = Partial<Record<keyof ExchangeRates, number>> & {
  timestamp?: number;
};

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
  // 환율 미지원 통화(CNY 등)는 여기서 0 — 기존 `min === undefined` 분기와 동일한 결과이나,
  // 캐스팅 대신 타입 가드로 좁혀 컴파일러가 실제로 검증할 수 있게 한다.
  if (!isRatedCurrency(currency)) return 0;
  const min = MIN_VALID_RATE[currency];

  const current = exchangeRates[currency];
  if (current && current >= min) return current;

  const cached = loadLastKnownRates()[currency];
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
