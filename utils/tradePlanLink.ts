// utils/tradePlanLink.ts
// ---------------------------------------------------------------------------
// 매매 계획(TradePlan)의 **상태 전이**를 실제 돈이 움직이는 기록 모달(매도/추가매수)에 연결하는
// 순수 브리지 레이어(P2b). `utils/tradePlan.ts`(도메인)는 모달을 모르고, 모달은 도메인 규칙을
// 다시 구현하지 않는다 — 그 사이의 "기본값 고르기 / 사전 검사 / 문구"만 여기 모은다.
//
// 설계 원칙(P2a와 동일):
//   · side effect 금지 · Date.now 금지(`now` 주입) · 돈 계산 재구현 금지.
//   · 상태 전이는 전부 `utils/tradePlan.ts`의 기존 함수(applyHalfSell/closePlan/applyPyramidFill)에
//     위임한다 — 여기서 TradePlan 필드를 직접 조립하지 않는다(규칙 이중 구현 방지).
//   · 'none'은 **계획을 건드리지 않는다**(같은 참조 반환) — 매도 기록만 남기는 경로.
//
// 소비처: components/SellAssetModal · BuyMoreAssetModal · trade-plan/TradePlanCard ·
//         trade-plan/TradePlanSection · contexts/PortfolioContext.
// 회귀 테스트: tests/tradePlanLinkParity.ts

import type { Asset } from '../types';
import { isBaseType } from '../types/category';
import type {
  PlanFill,
  PlanSignal,
  PyramidFillError,
  PyramidLevel,
  SellOutcome,
  TradePlan,
  TradePlanEvaluation,
} from '../types/tradePlan';
import { PYRAMID_FILL_ERROR_LABELS } from '../types/tradePlan';
import { applyHalfSell, applyPyramidFill, closePlan, floorQuantity, nextPyramidStep } from './tradePlan';

// ═══════════════════════════════════════════════════════════════════════════
// 매도 — 기본 효과 & 입력 프리필
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 지금 신호가 가리키는 매도 효과의 **기본 선택**. 사용자가 모달에서 바꿀 수 있는 제안일 뿐이다.
 * 계획과 무관한 신호(대기·근접·불타기·장중 관찰 등)에서는 'none' — 기록만 남기고 계획은 그대로.
 */
export function defaultSellOutcome(evaluation: TradePlanEvaluation | null): SellOutcome {
  if (evaluation === null) return 'none';
  switch (evaluation.signal) {
    case 'take-profit-hit':
      return 'half';
    case 'stop-hit':
    case 'already-below-stop':
      return 'stop';
    case 'exit-line-hit':
      return 'exit';
    default:
      return 'none';
  }
}

/**
 * 선택한 효과에 맞는 매도 모달 초기값(수량·원통화 가격).
 * 'half'만 보유 수량의 절반(암호화폐는 1e-8 절사, 그 외 정수 내림), 나머지는 전량.
 *
 * `plan`은 호출 규약상 **활성 계획이 있을 때만** 부르라는 표시로 받는다(효과 판단은 outcome이 전담).
 */
export function sellPrefillFor(
  plan: TradePlan,
  asset: Pick<Asset, 'quantity' | 'priceOriginal' | 'categoryId'>,
  outcome: SellOutcome
): { quantity: number; priceOriginal: number } {
  const allowFractional = isBaseType(asset.categoryId, 'CRYPTOCURRENCY');
  const quantity = outcome === 'half'
    ? floorQuantity(asset.quantity / 2, allowFractional)
    : asset.quantity;
  return { quantity, priceOriginal: asset.priceOriginal };
}

/**
 * 매도 기록이 확정된 뒤 계획에 반영한다(전부 `utils/tradePlan.ts`에 위임, 불변).
 *   half → 절반 익절 기록(익절선 완료) / stop·exit → 계획 종료 / none → 무변경(같은 참조).
 */
export function applySellOutcome(
  plan: TradePlan,
  outcome: SellOutcome,
  fill: PlanFill,
  now: string
): TradePlan {
  switch (outcome) {
    case 'half':
      return applyHalfSell(plan, fill, now);
    case 'stop':
      return closePlan(plan, 'stop', fill.date, now);
    case 'exit':
      return closePlan(plan, 'exit-line', fill.date, now);
    case 'none':
    default:
      return plan;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 추가매수 — 불타기 사전 검사
// ═══════════════════════════════════════════════════════════════════════════

export type PyramidPrecheckResult =
  | { ok: true; nextPlan: TradePlan; level: PyramidLevel }
  | { ok: false; reason: PyramidFillError; label: string };

/**
 * 추가매수 입력을 **커밋 전에** 불타기 체결로 시뮬레이션한다 — 통과 시 올라갈 손절선(nextPlan)과
 * 몇 차인지(level)를, 실패 시 사용자에게 그대로 보여줄 사유 문구(label)를 돌려준다.
 *
 * 가드 순서는 `applyPyramidFill`과 **같다**(disabled → no-step) — 체결 단계와 다른 사유가
 * 표시되면 "화면에선 되는데 눌러보면 안 된다"가 된다. 단계는 체결 **전에** 잡아 둔다
 * (성공 후 `nextPyramidStep`은 이미 다음 단계를 가리킨다).
 */
export function pyramidPrecheck(
  plan: TradePlan,
  fill: PlanFill,
  fxRateToKRW: number | null
): PyramidPrecheckResult {
  if (!plan.pyramid.enabled) {
    return { ok: false, reason: 'pyramid-disabled', label: PYRAMID_FILL_ERROR_LABELS['pyramid-disabled'] };
  }
  const step = nextPyramidStep(plan);
  if (!step) {
    return { ok: false, reason: 'no-step', label: PYRAMID_FILL_ERROR_LABELS['no-step'] };
  }
  const result = applyPyramidFill(plan, fill, { fxRateToKRW });
  if (!result.ok) {
    return { ok: false, reason: result.reason, label: PYRAMID_FILL_ERROR_LABELS[result.reason] };
  }
  return { ok: true, nextPlan: result.plan, level: step.level };
}

// ═══════════════════════════════════════════════════════════════════════════
// 결정 기록 문구
// ═══════════════════════════════════════════════════════════════════════════

/** '건너뜀' 사유 빠른 선택지 — 자유 입력도 가능(칩은 입력칸을 채울 뿐 제출하지 않는다). */
export const DECISION_REASON_PRESETS = ['현금 부족', '이미 증권사에서 처리함', '다시 생각해 보겠음'] as const;

/**
 * 결정 버튼 옆에 붙는 안내 문구. 손절 국면에서만 나온다 —
 * 초보자가 손절을 "실패 확정"으로 받아들여 미루는 것이 이 기능이 막으려는 핵심 행동이다.
 */
export function decisionHelpText(signal: PlanSignal): string | null {
  if (signal === 'stop-hit' || signal === 'already-below-stop') {
    return '손절은 끝이 아닙니다. 다시 오르면 다시 사면 됩니다 — 큰 손실만 피하면 됩니다';
  }
  return null;
}
