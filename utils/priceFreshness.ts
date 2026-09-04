// utils/priceFreshness.ts
// 시세 신선도 게이트 — 순수 함수(부수효과 없음). `usePortfolioData`/`usePriceFreshnessRefresh`가
// localStorage 'asset-manager-last-price-refresh-at'(ISO)와 조합해 사용한다(RULES.md §8).
//
// 판정 우선순위: never(기록 없음) → market-open-stale(보유 시장 개장 중 30분 경과) →
// closed-since-refresh(보유 시장 마감 확정 시각이 마지막 갱신 이후 지남) → fresh.
import { isMarketOpen, lastSessionDate, closeConfirmTime, toKstParts, type MarketId } from './marketHours';

/** 마지막 시세 갱신 완료 시각(ISO) localStorage 키 — 자동/수동 갱신 경로 공용(RULES.md §8). */
export const LAST_PRICE_REFRESH_AT_KEY = 'asset-manager-last-price-refresh-at';

export interface PriceFreshnessHoldings {
  hasKR: boolean;
  hasUS: boolean;
  hasCrypto: boolean;
}

export interface ShouldRefreshPricesInput {
  /** 마지막 시세 갱신 완료 시각(ISO). 아직 한 번도 갱신 안 했으면 null */
  lastRefreshAt: string | null;
  /** 판정 기준 시각(ISO) — 호출부가 주입(`new Date()` 직접 생성 금지, 테스트 가능성) */
  now: string;
  holdings: PriceFreshnessHoldings;
}

export type PriceFreshnessReason = 'never' | 'market-open-stale' | 'closed-since-refresh' | 'fresh';

export interface ShouldRefreshPricesResult {
  refresh: boolean;
  reason: PriceFreshnessReason;
}

const THIRTY_MIN_MS = 30 * 60_000;

function heldMarkets(holdings: PriceFreshnessHoldings): MarketId[] {
  const list: MarketId[] = [];
  if (holdings.hasKR) list.push('KR');
  if (holdings.hasUS) list.push('US');
  if (holdings.hasCrypto) list.push('CRYPTO');
  return list;
}

export function shouldRefreshPrices(input: ShouldRefreshPricesInput): ShouldRefreshPricesResult {
  const { lastRefreshAt, now, holdings } = input;
  if (!lastRefreshAt) return { refresh: true, reason: 'never' };

  const lastMs = new Date(lastRefreshAt).getTime();
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(lastMs) || !Number.isFinite(nowMs)) return { refresh: true, reason: 'never' };

  const markets = heldMarkets(holdings);
  if (markets.length === 0) return { refresh: false, reason: 'fresh' };

  // 1) 보유 시장 중 하나라도 지금 개장 중이고, 마지막 갱신이 30분 넘게 지났다.
  const anyOpenStale = markets.some(m => isMarketOpen(m, now) && (nowMs - lastMs) > THIRTY_MIN_MS);
  if (anyOpenStale) return { refresh: true, reason: 'market-open-stale' };

  // 2) 보유 시장의 최근 세션 마감 확정 시각이 (마지막 갱신, 지금] 구간에 있다
  //    → 마감 후 확정 종가를 아직 반영하지 못했다.
  const closedSinceRefresh = markets.some(m => {
    const sessionDate = lastSessionDate(m, now);
    const confirmMs = new Date(closeConfirmTime(m, sessionDate)).getTime();
    return confirmMs > lastMs && confirmMs <= nowMs;
  });
  if (closedSinceRefresh) return { refresh: true, reason: 'closed-since-refresh' };

  return { refresh: false, reason: 'fresh' };
}

/**
 * 기준 시각 한국어 라벨. 장중/마감 후 여부는 **KR 시장**을 기준으로 판단한다
 * (보유 시장 정보 없이 호출되는 표시 전용 함수라 단일 기준이 필요 — 한국 사용자
 * 앱의 "장중" 감각과 가장 가깝다). 예: '09-03 14:20 (장중)' / '09-02 마감 후' / '기준 시각 없음'.
 */
export function describeFreshness(lastRefreshAt: string | null, now: string): string {
  // `now`는 현재 라벨 포맷(장중/마감 후)에는 쓰이지 않는다 — 라벨은 lastRefreshAt 시각 자체의
  // 개장 상태만으로 정해진다. 호출부 시그니처 일관성(shouldRefreshPrices와 동일한 (때, 기준시각)
  // 형태) 및 추후 "N일 전" 등 상대 표기 확장을 위해 인자로 유지한다.
  void now;
  if (!lastRefreshAt) return '기준 시각 없음';
  const ms = new Date(lastRefreshAt).getTime();
  if (!Number.isFinite(ms)) return '기준 시각 없음';

  const p = toKstParts(lastRefreshAt);
  const mm = String(p.m).padStart(2, '0');
  const dd = String(p.d).padStart(2, '0');
  const hh = String(p.hh).padStart(2, '0');
  const min = String(p.mm).padStart(2, '0');

  if (isMarketOpen('KR', lastRefreshAt) || isMarketOpen('US', lastRefreshAt)) {
    return `${mm}-${dd} ${hh}:${min} (장중)`;
  }
  return `${mm}-${dd} 마감 후`;
}
