// utils/marketOverviewCalculations.ts
// ---------------------------------------------------------------------------
// 금 김치 프리미엄 순수 계산 함수. 상태/부수효과 없음.
// 프리미엄은 스냅샷에 저장하지 않고 이 함수들로 렌더 시 파생한다
// (유효 환율이 바뀌면 김프가 자동 재계산됨 — 초기 임시환율 왜곡 방지).
// ---------------------------------------------------------------------------

import { TROY_OZ_TO_GRAM } from '../types/marketOverview';

/** 환율 이상치 상한 (USD/KRW). 이보다 크면 손상된 값으로 간주 — lessons learned. */
export const USD_KRW_SANITY_MAX = 3000;
/** JPY/KRW 이상치 상한. */
export const JPY_KRW_SANITY_MAX = 50;

/** 유한한 양수인가 (0·NaN·Infinity·음수 제외). */
export function isPositiveFinite(v: number | null | undefined): v is number {
  return typeof v === 'number' && isFinite(v) && v > 0;
}

/**
 * USD/KRW가 사용 가능한 정상 값인가.
 * 0 이하·비유한·상한 초과는 false.
 */
export function isSaneUsdKrw(rate: number | null | undefined): boolean {
  return isPositiveFinite(rate) && rate <= USD_KRW_SANITY_MAX;
}

/**
 * 국제금 USD/oz → KRW/g 환산.
 * 입력이 비정상이면 0 반환(호출측에서 '-' 표시).
 */
export function intlGoldKRWPerG(intlUSDPerOz: number, usdKrw: number): number {
  if (!isPositiveFinite(intlUSDPerOz) || !isSaneUsdKrw(usdKrw)) return 0;
  return (intlUSDPerOz * usdKrw) / TROY_OZ_TO_GRAM;
}

/**
 * 김치 프리미엄 % = (국내금 − 국제금환산) / 국제금환산 × 100.
 * 어느 한쪽이라도 0/비정상이면 null(계산 불가 — '-' 표시).
 */
export function goldPremiumPct(
  domesticKRWPerG: number,
  intlKRWPerG: number,
): number | null {
  if (!isPositiveFinite(domesticKRWPerG) || !isPositiveFinite(intlKRWPerG)) return null;
  return ((domesticKRWPerG - intlKRWPerG) / intlKRWPerG) * 100;
}

/**
 * 유효 USD/KRW 선택.
 * 사용자 수동 환율(override)이 정상이면 그것을 우선, 아니면 시장값.
 * 둘 다 비정상이면 null.
 */
export function effectiveUsdKrw(
  override: number | null | undefined,
  marketRate: number | null | undefined,
): number | null {
  if (isSaneUsdKrw(override)) return override as number;
  if (isSaneUsdKrw(marketRate)) return marketRate as number;
  return null;
}

/** 전일 대비 변동률 % (prev 0/비정상이면 null). */
export function changePct(current: number, prev: number): number | null {
  if (!isPositiveFinite(current) || !isPositiveFinite(prev)) return null;
  return ((current - prev) / prev) * 100;
}
