// utils/riskMatrix.ts
// 종합 리스크 매트릭스 — 클라이맥스 플래그 카운트 + 디스트리뷰션 카운트 + MA 근접도를 합성해
// 자산별 RED / AMBER / BLUE 티어 산출. 신호 브리핑 패널의 1단계 배너로 표시.
//
// 산식은 사용자 지침에 따름:
//   🔴 RED:   클라이맥스 플래그 ≥ 2 AND 디스트리뷰션 ≥ 5
//   🟡 AMBER: 클라이맥스 플래그 ≥ 1 AND 3 ≤ 디스트리뷰션 ≤ 4
//   🔵 BLUE:  MA(기본 150) 근접(±N%) AND 디스트리뷰션 ≥ 2
//
// 모든 임계값은 RiskMatrixThresholds로 외부 주입 — 하드코딩 금지.
// 룩어헤드 편향 방지: enrichedMap 자체가 "그날까지의 데이터"만 사용해 산출됨.
//
// 이 신호는 "예측"이 아닌 "과열 리스크 경고"임. UI 카피에 명시할 것.

import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';

export type RiskTier = 'red' | 'amber' | 'blue' | null;

export interface RiskMatrixThresholds {
  /** 클라이맥스 플래그 카운트 (a)+(b)+(c) 산출용 — useEnrichedIndicators의 결과 기반 */
  climaxSlopeMultiplier: number; // 기본 3
  climaxAtrMultiple: number;     // 기본 2.5
  /** 디스트리뷰션 카운트 산출용 */
  distributionWindow: number;          // 기본 13
  distributionVolumeRatio: number;     // 기본 1.5
  /** 리스크 매트릭스 분류용 */
  redClimaxFlagsMin: number;        // 기본 2
  redDistributionMin: number;       // 기본 5
  amberClimaxFlagsMin: number;      // 기본 1
  amberDistributionMin: number;     // 기본 3
  amberDistributionMax: number;     // 기본 4
  blueMaPeriod: number;             // 기본 150
  blueMaProximityPct: number;       // 기본 5 (±5%)
  blueDistributionMin: number;      // 기본 2
}

export const DEFAULT_RISK_MATRIX_THRESHOLDS: RiskMatrixThresholds = {
  climaxSlopeMultiplier: 3,
  climaxAtrMultiple: 2.5,
  distributionWindow: 13,
  distributionVolumeRatio: 1.5,
  redClimaxFlagsMin: 2,
  redDistributionMin: 5,
  amberClimaxFlagsMin: 1,
  amberDistributionMin: 3,
  amberDistributionMax: 4,
  blueMaPeriod: 150,
  blueMaProximityPct: 5,
  blueDistributionMin: 2,
};

export interface RiskAssessment {
  tier: RiskTier;
  /** 우선순위 정렬용 점수 (높을수록 위험) — 클라이맥스플래그×10 + 디스트리뷰션 */
  score: number;
  /** UI 표시용 설명 — 어느 조건으로 분류됐는지 */
  reasons: string[];
  /** 부가 정보 — UI 표시에 사용 */
  climaxFlagCount: number;
  distributionCount: number;
}

/** 단일 자산의 클라이맥스 플래그 카운트 (a, b, c) — useEnrichedIndicators의 결과 사용 */
function countClimaxFlags(
  enriched: EnrichedIndicatorData,
  thresholds: RiskMatrixThresholds
): number {
  let count = 0;
  if (typeof enriched.slopeRatio === 'number' && enriched.slopeRatio >= thresholds.climaxSlopeMultiplier) count++;
  if (typeof enriched.dayRangeOverAtr === 'number' && enriched.dayRangeOverAtr >= thresholds.climaxAtrMultiple) count++;
  if (enriched.priceIsAt52wHigh && enriched.volumeIsAt52wMax) count++;
  return count;
}

/** 단일 자산의 디스트리뷰션 카운트 — 윈도우 내 매물 출회 패턴 일수 */
function countDistributionDays(
  enriched: EnrichedIndicatorData,
  thresholds: RiskMatrixThresholds
): number {
  const meta = enriched.distributionDayMeta;
  if (!meta || meta.length === 0) return 0;
  const window = Math.min(thresholds.distributionWindow, meta.length);
  const ratioThr = thresholds.distributionVolumeRatio;
  let count = 0;
  for (let i = meta.length - window; i < meta.length; i++) {
    const d = meta[i];
    if (typeof d.volRatio !== 'number' || d.volRatio < ratioThr) continue;
    const churn =
      d.isBearish === true ||
      d.isLowerHalfClose === true ||
      d.changeRatio < 0.002;
    if (churn) count++;
  }
  return count;
}

/** MA 근접 여부 — 현재가가 MA의 ±proximityPct% 이내 */
function isNearMa(
  enriched: EnrichedIndicatorData,
  currentPrice: number,
  maPeriod: number,
  proximityPct: number
): boolean {
  const ma = enriched.ma[maPeriod];
  if (typeof ma !== 'number' || ma <= 0) return false;
  const ratio = Math.abs(currentPrice - ma) / ma;
  return ratio <= proximityPct / 100;
}

/**
 * 단일 자산의 리스크 티어 산출
 * @param enriched useEnrichedIndicators 결과
 * @param currentPrice 자산의 현재가 (priceOriginal, MA 비교에 사용)
 * @param thresholds 임계값 (사용자 설정에서 주입)
 */
export function computeRiskTier(
  enriched: EnrichedIndicatorData,
  currentPrice: number,
  thresholds: RiskMatrixThresholds = DEFAULT_RISK_MATRIX_THRESHOLDS
): RiskAssessment {
  const climaxFlagCount = countClimaxFlags(enriched, thresholds);
  const distributionCount = countDistributionDays(enriched, thresholds);
  const reasons: string[] = [];

  let tier: RiskTier = null;

  // RED: 클라이맥스 ≥ 2 AND 디스트리뷰션 ≥ 5
  if (climaxFlagCount >= thresholds.redClimaxFlagsMin && distributionCount >= thresholds.redDistributionMin) {
    tier = 'red';
    reasons.push(`클라이맥스 ${climaxFlagCount}/3`, `디스트리뷰션 ${distributionCount}일`);
  }
  // AMBER: 클라이맥스 ≥ 1 AND 3 ≤ 디스트리뷰션 ≤ 4
  else if (
    climaxFlagCount >= thresholds.amberClimaxFlagsMin &&
    distributionCount >= thresholds.amberDistributionMin &&
    distributionCount <= thresholds.amberDistributionMax
  ) {
    tier = 'amber';
    reasons.push(`클라이맥스 ${climaxFlagCount}/3`, `디스트리뷰션 ${distributionCount}일`);
  }
  // BLUE: MA 근접 AND 디스트리뷰션 ≥ 2
  else if (
    isNearMa(enriched, currentPrice, thresholds.blueMaPeriod, thresholds.blueMaProximityPct) &&
    distributionCount >= thresholds.blueDistributionMin
  ) {
    tier = 'blue';
    reasons.push(`MA${thresholds.blueMaPeriod} 근접`, `디스트리뷰션 ${distributionCount}일`);
  }

  const score = climaxFlagCount * 10 + distributionCount;

  return { tier, score, reasons, climaxFlagCount, distributionCount };
}

export interface RiskMatrixRow {
  assetId: string;
  ticker: string;
  assetName: string;
  source: 'portfolio' | 'watchlist';
  assessment: RiskAssessment;
}

/** RED → AMBER → BLUE 순, 동일 티어 내 score 내림차순 정렬 (위험 우선) */
export function sortByRiskPriority(rows: RiskMatrixRow[]): RiskMatrixRow[] {
  const TIER_ORDER: Record<Exclude<RiskTier, null>, number> = { red: 0, amber: 1, blue: 2 };
  return [...rows].sort((a, b) => {
    const ta = a.assessment.tier;
    const tb = b.assessment.tier;
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    const tierDiff = TIER_ORDER[ta] - TIER_ORDER[tb];
    if (tierDiff !== 0) return tierDiff;
    return b.assessment.score - a.assessment.score;
  });
}
