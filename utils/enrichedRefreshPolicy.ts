// utils/enrichedRefreshPolicy.ts
// 시세 갱신 직후 enriched(MA/RSI 등) 지표를 /history 로 다시 받아야 하는지 판정하는 순수 함수.
// enriched 데이터는 시세 응답이 아니라 /history 일봉에서 계산되므로, 직전 enriched 조회가 시세 갱신 시작
// 시점 근처(허용오차 내) 또는 이후에 시작됐다면 이미 같은 일봉을 반영한 것이라 재조회는 낭비다.

export const ENRICHED_REFRESH_TOLERANCE_MS = 60_000;

export function shouldRefetchEnrichedAfterPriceRefresh(args: {
  lastEnrichedFetchStartedAt: number | null;
  priceRefreshStartedAt: number;
  toleranceMs: number;
}): boolean {
  const { lastEnrichedFetchStartedAt, priceRefreshStartedAt, toleranceMs } = args;
  if (lastEnrichedFetchStartedAt === null) return true;
  return lastEnrichedFetchStartedAt < priceRefreshStartedAt - toleranceMs;
}
