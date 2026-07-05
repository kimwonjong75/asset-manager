// types/cleanup.ts
// ---------------------------------------------------------------------------
// Phase 3 대청소(정리 위저드) 타입 (3a — 순수 계산 전용, 저장/UI는 이후 단계).
//
// 분류 결정(cleanupTag): 사용자가 손실/먼지 종목을 3(+보류)분류로 확정하는 값.
//   · core      — 코어(자산배분 본체)로 편입 확정 (bucket='CORE'와 별개로, "확정" 여부를 기록)
//   · turtle    — 정리 후 55일 돌파 재진입 감시 대상(bucket='SATELLITE'+관심종목 터틀후보).
//                 ※ 기존 보유분을 터틀 포지션으로 인정하는 것이 아님(정리/재검토 대상).
//   · liquidate — Legacy 청산(대청소). 실제 매도는 실행 큐에서 재확인(3d).
//   · keep      — 보류(직접 판단).
//
// 세금 추정은 전부 "참고용"(isReference:true) — 확정 세무 판단 아님.

import type { Currency } from './index';
import type { BucketId } from './bucket';

export type CleanupTag = 'core' | 'turtle' | 'liquidate' | 'keep';

/** 정리 후보 판정 플래그 (자동 제안 근거). */
export interface CleanupCandidateFlags {
  loss: boolean;        // 미실현 수익률 < 0
  deepLoss: boolean;    // 수익률 ≤ deepLossThresholdPct (기본 -50%)
  dust: boolean;        // 총평가 대비 비중 < dustThresholdPct (기본 1%)
  foreign: boolean;     // 종목 통화 ≠ KRW (해외 양도세 통산 프록시 — categoryId보다 신뢰)
}

/** 정리 위저드에 노출할 후보 1건 (순수 계산 산출, 저장 전 표시 모델). */
export interface CleanupCandidate {
  assetId: string;
  ticker: string;
  name: string;
  categoryId: number;
  currency: Currency;
  bucket: BucketId;
  quantity: number;
  currentValueKRW: number;
  profitLossKRW: number;       // 미실현 손익 (KRW)
  returnPercentage: number;
  allocationPct: number;       // 총평가 대비 비중 %
  flags: CleanupCandidateFlags;
  suggestedTag: CleanupTag;    // 자동 제안(보수적: liquidate/keep만 — core/turtle은 사용자 판단)
  suggestReason: string;       // 제안 근거(표시용)
}

export interface CleanupSelectionOptions {
  deepLossThresholdPct?: number; // 기본 -50
  dustThresholdPct?: number;     // 기본 1
}

/**
 * 일괄 분류 저장 시 자산 1건에 적용할 결정 (assetId별 맵으로 전달).
 * 미포함(undefined) 필드는 "변경 안 함" — 미검토 상태를 강제로 keep/false로 덮지 않는다.
 */
export interface CleanupDecision {
  cleanupTag?: CleanupTag;        // 분류 확정 (미포함=태그 변경 안 함)
  excludedFromCleanup?: boolean;  // 가족 제외 토글 (미포함=변경 안 함, false=제외 해제→필드 제거)
}

/** 해외주식 양도세 통산 추정 (참고용). */
export interface CleanupTaxEstimate {
  year: number;
  realizedForeignGainKRW: number;  // 올해 실현 해외손익 (sellHistory 기준)
  plannedForeignGainKRW: number;   // 청산 예정 해외 미실현손익 (선택된 liquidate 후보)
  netForeignGainKRW: number;       // 실현 + 예정
  basicDeductionKRW: number;       // 기본공제 (기본 250만)
  taxableKRW: number;              // max(0, net − 공제)
  estimatedTaxKRW: number;         // taxable × rate
  offsetSavingsKRW: number;        // 손실 통산으로 줄어든 세금 추정
  rate: number;                    // 적용 세율 (기본 0.22)
  isReference: true;               // 항상 참고용 — 확정 세무 판단 아님
}
