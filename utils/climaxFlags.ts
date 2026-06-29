// utils/climaxFlags.ts
// 클라이맥스 톱 플래그 카운팅 — riskMatrix(종합 리스크 티어)와 smartFilterLogic(CLIMAX_TOP 필터)의
// 공용 순수 함수. 이전에는 두 곳에 동일 로직이 복제(주석상 "drift 방지로 동일 유지")돼 있었다.
//
// 엔진별 정책 차이는 "코드"가 아니라 "주입 옵션"으로만 둔다 (round-5 합의: 계산 코드 공유 + 엔진별 프로필):
//   · riskMatrix      → requireBullishCandle/requireLongTrendUp 항상 true (고정 분류 프로필)
//   · smartFilterLogic → extraConfig 토글(기본 true) 그대로 전달 (사용자 설정 프로필)
// 임계값(slopeMultiplier/atrMultiple)도 호출부가 자기 프로필에서 주입한다.
//
// 회귀 가드: tests/climaxDistributionParity.ts (npm run test:parity). side effect/any 없음.

import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';

/**
 * 클라이맥스 (c) 보조 임계: 52주 거래량 최대가 아니어도 직전일 거래량이 50일 평균의 N배 이상이면 (c) 인정 (P4.5 C3).
 * (c) 로직의 소유 상수 — 이전엔 buildEnrichedIndicator에 있었으나 빌더가 내부에서 쓰지 않아 사용처(여기)로 이관.
 */
export const CLIMAX_C_VOL_SURGE_RATIO = 2.0;

export interface ClimaxFlagOptions {
  /** (a) slopeRatio >= 임계 */
  slopeMultiplier: number;
  /** (b) dayRangeOverAtr >= 임계 */
  atrMultiple: number;
  /** (b) ATR 폭발을 양봉(close>open)일 때만 카운트 */
  requireBullishCandle: boolean;
  /** "수개월 상승" 전제 — longTrendUp이 명시적 false면 0 (null=데이터부족은 보수적 통과) */
  requireLongTrendUp: boolean;
}

/**
 * 클라이맥스 (a)+(b)+(c) 플래그 카운트.
 *  (a) 단기/장기 기울기 비율(slopeRatio) ≥ slopeMultiplier
 *  (b) 당일 (고-저)/ATR(dayRangeOverAtr) ≥ atrMultiple — requireBullishCandle 시 양봉일 때만 (null 캔들은 통과)
 *  (c) 52주 신고가 AND (거래량 52주 최대 OR 직전일 volRatio ≥ CLIMAX_C_VOL_SURGE_RATIO)
 * OHLCV 미수신(dayRangeOverAtr=null) 등 지표 미산출은 해당 플래그 미카운트(보수적).
 */
export function countClimaxFlags(e: EnrichedIndicatorData, opts: ClimaxFlagOptions): number {
  if (opts.requireLongTrendUp && e.longTrendUp === false) return 0;

  let count = 0;
  // (a)
  if (typeof e.slopeRatio === 'number' && e.slopeRatio >= opts.slopeMultiplier) count++;
  // (b)
  if (typeof e.dayRangeOverAtr === 'number' && e.dayRangeOverAtr >= opts.atrMultiple) {
    if (!opts.requireBullishCandle || e.isBullishCandle !== false) count++;
  }
  // (c)
  if (e.priceIsAt52wHigh) {
    const todayMeta = e.distributionDayMeta?.[e.distributionDayMeta.length - 1];
    const volRatio = todayMeta?.volRatio ?? null;
    if (e.volumeIsAt52wMax || (typeof volRatio === 'number' && volRatio >= CLIMAX_C_VOL_SURGE_RATIO)) {
      count++;
    }
  }
  return count;
}

/**
 * 클라이맥스 카운트가 의미 있으려면 핵심 정량 입력(기울기비 OR 당일범위/ATR) 중 최소 하나가 있어야 한다.
 * 둘 다 null(OHLCV 결손)이면 (a)(b)를 못 보고 카운트가 0으로 degrade — fail-closed 판정용 단일 소스.
 * alertDiagnostics.compositeInputQuality의 'missing' 경계 + guruSignalEngine.buildMetricValues가 공유(drift 차단).
 */
export function hasClimaxInputs(e: EnrichedIndicatorData): boolean {
  return typeof e.slopeRatio === 'number' || typeof e.dayRangeOverAtr === 'number';
}
