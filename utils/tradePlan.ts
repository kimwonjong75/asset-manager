// utils/tradePlan.ts
// ---------------------------------------------------------------------------
// 매매 계획(TradePlan) 순수 로직 — 생성(사이징)·평가(신호/등급)·상태 전이·문구.
// 앱(React 훅)과 카카오톡 알림 스크립트(Google Apps Script 번들)가 **이 파일 하나**를 공유한다.
// 따라서: side effect 금지, Date.now 금지(`now` 주입), 브라우저 API 금지, any 금지.
//
// 규칙 원전: 강의 템플릿 + scripts/backtest/coreStopLoss/lib/sellRuleEngine.ts(연구 엔진).
//   · 손절선 = 기준가 × (1 − 손절폭)            · 익절선 = 기준가 × (1 + 손절폭 × 배수), 절반 매도
//   · 추세선 = 완료 종가 이동평균(10/20/50) 또는 직접 가격 — 확정 종가가 선 아래면 나머지 전량
//   · 불타기 트리거 = 기준가 × (1+step)^k (pct) / 기준가 + k·step·(기준가−손절선) (r)
//   · 우선순위 손절 > 익절 > 불타기 > 추세이탈 (연구 엔진과 동일)
//   · 불타기 체결 후 손절선 = max(기존, 체결가×(1−손절폭), 기준가) — 내려가지 않는다
// 통화 규약(D6): 가격은 원통화, 돈은 KRW. 환율 없는 통화(CNY)는 KRW 값 null (|| 0 금지).

import type { Asset } from '../types';
import { isBaseType } from '../types/category';
import { calculatePositionSize, stopLossPercentFromPrice, stopPriceFromPercent } from './positionSizing';
import { calculateSMA } from './maCalculations';
import type {
  TradePlan,
  TradePlanBuildInput,
  TradePlanBuildResult,
  TradePlanPreview,
  TradePlanPyramidStep,
  TradePlanMarket,
  TradePlanEvaluation,
  TradePlanExitLine,
  PlanLineStatus,
  PlanSignal,
  PlanTier,
  PlanAction,
  PlanFill,
  PlanDecision,
  PyramidFillResult,
  PyramidLevel,
  TradePlanCloseReason,
} from '../types/tradePlan';
import {
  PLAN_LINE_LABELS,
  PLAN_TIER_LABELS,
  PLAN_DECISION_MAX,
  PLAN_NEAR_PCT,
  PLAN_ADVERSE_GAP_PCT,
  PYRAMID_COST_CAP_MULTIPLE,
  PYRAMID_POSITION_CAP_PCT,
} from '../types/tradePlan';

const EPS = 1e-9;

// ═══════════════════════════════════════════════════════════════════════════
// 헬퍼
// ═══════════════════════════════════════════════════════════════════════════

/** 수량 라운딩: 정수 내림, 암호화폐는 1e-8 절사. */
export function floorQuantity(q: number, allowFractional: boolean): number {
  if (!(q > 0)) return 0;
  return allowFractional ? Math.floor(q * 1e8) / 1e8 : Math.floor(q);
}

/** 익절선. 배수가 없으면 null. */
export function takeProfitPriceFor(anchorPrice: number, stopPct: number, multiple: 2 | 3 | 4 | null): number | null {
  if (multiple === null) return null;
  return anchorPrice * (1 + (stopPct / 100) * multiple);
}

/** k번째 불타기 트리거 가격. 항상 기준가보다 높다(물타기 구조적 불가). */
export function pyramidTriggerPrice(
  anchorPrice: number,
  stopPrice: number,
  stepUnit: 'pct' | 'r',
  step: number,
  level: number
): number {
  if (stepUnit === 'pct') return anchorPrice * Math.pow(1 + step / 100, level);
  const r = anchorPrice - stopPrice; // 1R = 손절폭(가격)
  return anchorPrice + level * step * r;
}

/** 불타기 체결 후 손절선. 내려가지 않고, 최소 기준가(본전)까지 올린다. */
export function stopAfterPyramid(prevStop: number, fillPrice: number, stopPct: number, anchorPrice: number): number {
  return Math.max(prevStop, fillPrice * (1 - stopPct / 100), anchorPrice);
}

/** 계획의 허용손실(KRW). */
export function planRiskAmountKRW(plan: Pick<TradePlan, 'totalEquityKRW' | 'riskPct'>): number {
  return plan.totalEquityKRW * (plan.riskPct / 100);
}

interface HeldUnit { price: number; quantity: number }

/** 현재 보유 유닛(원 진입분 − 절반 익절분, + 체결된 불타기). 가격은 원통화. */
export function heldUnits(plan: TradePlan): HeldUnit[] {
  const originalQty = plan.plannedQuantity - (plan.halfSold?.quantity ?? 0);
  const units: HeldUnit[] = [];
  if (originalQty > 0) units.push({ price: plan.anchorPrice, quantity: originalQty });
  for (const s of plan.pyramid.steps) {
    if (s.fill && s.fill.quantity > 0) units.push({ price: s.fill.price, quantity: s.fill.quantity });
  }
  return units;
}

/** 아직 체결되지 않은 다음 불타기 단계. 없으면 null. */
export function nextPyramidStep(plan: TradePlan): TradePlanPyramidStep | null {
  if (!plan.pyramid.enabled) return null;
  return plan.pyramid.steps.find(s => !s.fill) ?? null;
}

export interface CapPyramidInput {
  anchorPrice: number;
  stopPct: number;
  currentStop: number;
  riskAmountKRW: number;
  totalEquityKRW: number;
  fxRateToKRW: number | null;
  /** 현재 보유 유닛(원통화 가격·수량). */
  held: HeldUnit[];
  /** 지금까지 이 사이클에 투입한 원통화 금액(최초 투입 포함). */
  costSoFar: number;
  originalCost: number;
  triggerPrice: number;
  desiredQuantity: number;
  allowFractional: boolean;
}

/**
 * 불타기 수량 캡 — 세 상한을 모두 만족하는 최대 수량(내림).
 *   ③ 새 손절선에서 전량 체결돼도 총손실 ≤ 허용손실(KRW)   ④-a 총투입 ≤ 최초 투입 × 2
 *   ④-b 종목 총액 ≤ 총자산 × 25%
 * 환율이 없으면(KRW 환산 불가) ③·④-b는 판정할 수 없어 적용하지 않는다(원통화 ④-a만).
 */
export function capPyramidQuantity(input: CapPyramidInput): number {
  const {
    anchorPrice, stopPct, currentStop, riskAmountKRW, totalEquityKRW, fxRateToKRW,
    held, costSoFar, originalCost, triggerPrice, desiredQuantity, allowFractional,
  } = input;
  if (!(desiredQuantity > 0) || !(triggerPrice > 0)) return 0;
  let cap = desiredQuantity;

  // ④-a 총투입 상한 (원통화)
  const costRoom = originalCost * PYRAMID_COST_CAP_MULTIPLE - costSoFar;
  cap = Math.min(cap, Math.max(costRoom, 0) / triggerPrice);

  if (fxRateToKRW !== null && fxRateToKRW > 0) {
    // ③ 1% 총손실 불변식 — 새 손절선 기준
    const newStop = stopAfterPyramid(currentStop, triggerPrice, stopPct, anchorPrice);
    const existingLoss = held.reduce((s, u) => s + u.quantity * (u.price - newStop), 0); // 원통화(음수=이익)
    const perUnitLoss = triggerPrice - newStop; // > 0 (newStop ≤ trigger×(1−pct) < trigger)
    if (perUnitLoss > EPS) {
      const room = riskAmountKRW / fxRateToKRW - existingLoss;
      cap = Math.min(cap, Math.max(room, 0) / perUnitLoss);
    }
    // ④-b 종목 총액 상한
    const heldValue = held.reduce((s, u) => s + u.quantity * u.price, 0);
    const valueRoom = (totalEquityKRW * PYRAMID_POSITION_CAP_PCT) / 100 / fxRateToKRW - heldValue;
    cap = Math.min(cap, Math.max(valueRoom, 0) / triggerPrice);
  }
  return floorQuantity(cap, allowFractional);
}

// ═══════════════════════════════════════════════════════════════════════════
// 생성
// ═══════════════════════════════════════════════════════════════════════════

export function buildTradePlan(input: TradePlanBuildInput): TradePlanBuildResult {
  const { anchorPrice, totalEquityKRW, riskPct, fxRateToKRW } = input;
  const allowFractional = input.allowFractional ?? false;
  if (!(anchorPrice > 0)) return { ok: false, reason: 'invalid-anchor' };
  if (!(totalEquityKRW > 0)) return { ok: false, reason: 'invalid-equity' };
  if (!(riskPct > 0) || riskPct > 100) return { ok: false, reason: 'invalid-risk' };

  // 손절선: 직접 가격 우선, 없으면 손절폭 %
  let stopPrice: number;
  let stopPct: number;
  if (typeof input.stopPrice === 'number') {
    if (!(input.stopPrice >= 0) || input.stopPrice >= anchorPrice) return { ok: false, reason: 'invalid-stop' };
    stopPrice = input.stopPrice;
    stopPct = stopLossPercentFromPrice(anchorPrice, stopPrice);
  } else {
    if (typeof input.stopPct !== 'number' || !(input.stopPct > 0) || input.stopPct >= 100) {
      return { ok: false, reason: 'invalid-stop' };
    }
    stopPct = input.stopPct;
    stopPrice = stopPriceFromPercent(anchorPrice, stopPct);
  }

  const fx = fxRateToKRW !== null && fxRateToKRW > 0 ? fxRateToKRW : null;
  const riskAmountKRW = totalEquityKRW * (riskPct / 100);

  // 수량
  let quantity: number;
  let capped = false;
  if (input.mode === 'new-buy') {
    if (fx === null) return { ok: false, reason: 'unsupported-currency' };
    const sized = calculatePositionSize({
      totalEquity: totalEquityKRW,
      riskPercentPerTrade: riskPct,
      entryPrice: anchorPrice * fx,
      stopPrice: stopPrice * fx,
      lotSize: 1,
      allowFractional,
    });
    if (!sized.valid) {
      const map: Record<string, TradePlanBuildResult> = {
        'invalid-equity': { ok: false, reason: 'invalid-equity' },
        'invalid-risk': { ok: false, reason: 'invalid-risk' },
        'invalid-entry': { ok: false, reason: 'invalid-anchor' },
        'invalid-stop': { ok: false, reason: 'invalid-stop' },
      };
      return map[sized.reason ?? 'invalid-stop'] ?? { ok: false, reason: 'invalid-stop' };
    }
    quantity = sized.maxQuantity;
    capped = sized.capped;
    if (!(quantity > 0)) return { ok: false, reason: 'invalid-quantity' };
  } else {
    if (typeof input.holdingQuantity !== 'number' || !(input.holdingQuantity > 0)) {
      return { ok: false, reason: 'invalid-quantity' };
    }
    quantity = input.holdingQuantity;
  }

  const takeProfitPrice = takeProfitPriceFor(anchorPrice, stopPct, input.profitMultiple);

  // 추세선 적용 방식: 계획 시점에 이미 선 아래면 '재돌파 후 적용'이 기본
  const exitLineArmMode =
    input.exitLineArmMode ??
    (typeof input.currentExitLineValue === 'number' && anchorPrice < input.currentExitLineValue
      ? 'after-reclaim'
      : 'immediate');

  // 불타기 단계 사전 계산(캡 적용). 체결 시 applyPyramidFill 이 실제 값으로 재검사한다.
  const steps: TradePlanPyramidStep[] = [];
  const originalCost = quantity * anchorPrice;
  if (input.pyramid.enabled) {
    let stop = stopPrice;
    let costSoFar = originalCost;
    const held: HeldUnit[] = [{ price: anchorPrice, quantity }];
    for (let k = 1; k <= input.pyramid.maxAdds; k++) {
      const level = k as PyramidLevel;
      const trigger = pyramidTriggerPrice(anchorPrice, stopPrice, input.pyramid.stepUnit, input.pyramid.step, level);
      const desired = input.pyramid.sizing === 'same' ? quantity : quantity * Math.pow(0.5, level);
      const q = capPyramidQuantity({
        anchorPrice, stopPct, currentStop: stop, riskAmountKRW, totalEquityKRW, fxRateToKRW: fx,
        held: [...held], costSoFar, originalCost, triggerPrice: trigger, desiredQuantity: desired, allowFractional,
      });
      steps.push({ level, triggerPrice: trigger, plannedQuantity: q });
      if (q > 0) {
        held.push({ price: trigger, quantity: q });
        costSoFar += q * trigger;
        stop = stopAfterPyramid(stop, trigger, stopPct, anchorPrice);
      }
    }
  }

  const plan: TradePlan = {
    version: 1,
    mode: input.mode,
    createdAt: input.now,
    updatedAt: input.now,
    anchor: input.anchor,
    anchorPrice,
    anchorDate: input.anchorDate,
    currency: input.currency,
    totalEquityKRW,
    riskPct,
    stopPct,
    stopPrice,
    profitMultiple: input.profitMultiple,
    takeProfitPrice,
    exitLine: input.exitLine,
    exitLineArmMode,
    pyramid: {
      enabled: input.pyramid.enabled,
      stepUnit: input.pyramid.stepUnit,
      step: input.pyramid.step,
      sizing: input.pyramid.sizing,
      maxAdds: input.pyramid.maxAdds,
      steps,
    },
    plannedQuantity: quantity,
    brokerStopOrderRegistered: input.brokerStopOrderRegistered ?? false,
    decisions: [],
    status: 'active',
  };

  const worstLossKRW = fx === null ? null : -quantity * (anchorPrice - stopPrice) * fx;
  const adverseFill = stopPrice * (1 - PLAN_ADVERSE_GAP_PCT / 100);
  const preview: TradePlanPreview = {
    quantity,
    investmentKRW: fx === null ? null : quantity * anchorPrice * fx,
    riskAmountKRW,
    worstLossKRW,
    worstLossPct: worstLossKRW === null ? null : (worstLossKRW / totalEquityKRW) * 100,
    adverseLossKRW: fx === null ? null : -quantity * (anchorPrice - adverseFill) * fx,
    stopPrice,
    stopPct,
    takeProfitPrice,
    exceedsRiskBudget: worstLossKRW !== null && -worstLossKRW > riskAmountKRW + 1e-6,
    capped,
  };
  return { ok: true, plan, preview };
}

// ═══════════════════════════════════════════════════════════════════════════
// 추세선 값
// ═══════════════════════════════════════════════════════════════════════════

/** 완료 종가 배열(오래된→최근)에서 추세선 값. 데이터 부족이면 null. */
export function computeExitLineValue(closes: number[], exitLine: TradePlanExitLine): number | null {
  if (exitLine.kind === 'price') return exitLine.price > 0 ? exitLine.price : null;
  const period = exitLine.period;
  const valid = closes.filter(c => typeof c === 'number' && isFinite(c) && c > 0);
  if (valid.length < period) return null;
  const series = calculateSMA(valid.map(price => ({ date: '', price })), period);
  const last = series[series.length - 1];
  return typeof last === 'number' && isFinite(last) ? last : null;
}

function exitLineValueFromMarket(plan: TradePlan, market: TradePlanMarket): number | null {
  if (plan.exitLine.kind === 'price') return plan.exitLine.price > 0 ? plan.exitLine.price : null;
  const v = market.ma[plan.exitLine.period];
  return typeof v === 'number' && isFinite(v) && v > 0 ? v : null;
}

function distancePct(price: number, line: number | null): number | null {
  if (line === null || !(line > 0)) return null;
  return ((price - line) / line) * 100;
}

// ═══════════════════════════════════════════════════════════════════════════
// 평가
// ═══════════════════════════════════════════════════════════════════════════

function tierFor(signal: PlanSignal): PlanTier {
  switch (signal) {
    case 'stop-hit':
    case 'exit-line-hit':
      return 'urgent';
    case 'take-profit-hit':
      return 'today';
    case 'pyramid-hit':
    case 'near-stop':
    case 'near-pyramid':
    case 'exit-line-watch':
      return 'prepare';
    default:
      return 'none';
  }
}

/**
 * 계획을 시장 데이터로 평가한다. fail-closed: 가격 결측=판정 불가, 오래된 시세=stale(익절·불타기 미발화).
 * 추세선은 확정 종가(isIntraday=false)에서만 '이탈'로 판정하고, 장중에는 '종가 확인 필요'로만 알린다.
 */
export function evaluateTradePlan(plan: TradePlan, market: TradePlanMarket): TradePlanEvaluation {
  const inactiveLines = (): PlanLineStatus[] => [
    { key: 'stop', label: PLAN_LINE_LABELS.stop, price: plan.stopPrice, distancePct: null, state: 'inactive' },
    { key: 'takeProfit', label: PLAN_LINE_LABELS.takeProfit, price: plan.takeProfitPrice, distancePct: null, state: 'inactive' },
    { key: 'exitLine', label: PLAN_LINE_LABELS.exitLine, price: null, distancePct: null, state: 'inactive' },
    { key: 'pyramid', label: PLAN_LINE_LABELS.pyramid, price: null, distancePct: null, state: 'inactive' },
  ];

  if (plan.status !== 'active') {
    return {
      signal: 'waiting', tier: 'none', action: 'none', lines: inactiveLines(),
      sentence: '이 계획은 종료되었습니다.', distanceToStopPct: null, stale: false,
    };
  }

  const price = market.price;
  if (price === null || !(price > 0)) {
    const lines = inactiveLines().map(l => ({ ...l, state: 'unavailable' as const, note: '시세 없음' }));
    return {
      signal: 'unavailable', tier: 'none', action: 'check', lines,
      sentence: '시세가 없어 판정할 수 없습니다. 새로고침 후에도 없으면 종목 코드를 확인하세요.',
      distanceToStopPct: null, stale: false,
    };
  }

  const stale = market.priceAsOf < market.sessionDate;
  const exitValue = exitLineValueFromMarket(plan, market);
  const next = nextPyramidStep(plan);
  const takeProfitActive = plan.takeProfitPrice !== null && !plan.halfSold;
  const exitArmed = plan.exitLineArmMode === 'immediate' || !!plan.exitLineArmedAt;

  const dStop = distancePct(price, plan.stopPrice);
  const dTp = distancePct(price, plan.takeProfitPrice);
  const dExit = distancePct(price, exitValue);
  const dPy = next ? distancePct(price, next.triggerPrice) : null;

  // ── 신호 결정(우선순위: 손절 > 익절 > 불타기 > 추세선) ──
  let signal: PlanSignal;
  let action: PlanAction;
  const stopHit = price <= plan.stopPrice + EPS;
  const tpHit = takeProfitActive && price >= (plan.takeProfitPrice as number) - EPS;
  const pyHit = !stale && next !== null && next.plannedQuantity > 0 && price >= next.triggerPrice - EPS;
  const exitBelow = exitValue !== null && price < exitValue - EPS;

  if (stopHit) {
    signal = 'stop-hit';
    action = stale ? 'check' : 'sell-all';
  } else if (stale) {
    signal = 'stale';
    action = 'check';
  } else if (tpHit) {
    signal = 'take-profit-hit';
    action = 'sell-half';
  } else if (pyHit) {
    signal = 'pyramid-hit';
    action = 'buy-add';
  } else if (exitValue !== null && !exitArmed) {
    if (!market.isIntraday && price > exitValue + EPS) {
      signal = 'waiting';
      action = 'arm-exit';
    } else if (exitBelow) {
      signal = 'already-below-exit';
      action = 'wait';
    } else {
      signal = 'waiting';
      action = 'wait';
    }
  } else if (exitValue !== null && exitArmed && exitBelow) {
    if (market.isIntraday) {
      signal = 'exit-line-watch';
      action = 'check';
    } else {
      signal = 'exit-line-hit';
      action = 'sell-all';
    }
  } else if (dStop !== null && dStop <= PLAN_NEAR_PCT) {
    signal = 'near-stop';
    action = 'check';
  } else if (next !== null && next.plannedQuantity > 0 && dPy !== null && dPy >= -PLAN_NEAR_PCT) {
    signal = 'near-pyramid';
    action = 'wait';
  } else {
    signal = 'waiting';
    action = 'wait';
  }

  // ── 선별 상태 ──
  const lines: PlanLineStatus[] = [
    {
      key: 'stop', label: PLAN_LINE_LABELS.stop, price: plan.stopPrice, distancePct: dStop,
      state: stopHit ? 'hit' : dStop !== null && dStop <= PLAN_NEAR_PCT ? 'near' : 'waiting',
      note: stale ? '시세가 오래됨 — 확인 필요' : undefined,
    },
    {
      key: 'takeProfit', label: PLAN_LINE_LABELS.takeProfit, price: plan.takeProfitPrice, distancePct: dTp,
      state: plan.takeProfitPrice === null ? 'inactive' : plan.halfSold ? 'done' : tpHit ? 'hit' : 'waiting',
      note: plan.halfSold ? `${plan.halfSold.date} 절반 매도함` : undefined,
    },
    {
      key: 'exitLine', label: PLAN_LINE_LABELS.exitLine, price: exitValue, distancePct: dExit,
      state: exitValue === null
        ? 'unavailable'
        : !exitArmed
          ? 'disarmed'
          : exitBelow
            ? (market.isIntraday ? 'near' : 'hit')
            : 'waiting',
      note: exitValue === null
        ? '추세선 값 없음'
        : !exitArmed
          ? '선 위로 올라오면 그때부터 적용'
          : exitBelow && market.isIntraday
            ? '종가 확인 필요'
            : plan.exitLine.kind === 'ma' ? '매일 변함 · 종가 기준' : undefined,
    },
    {
      key: 'pyramid', label: PLAN_LINE_LABELS.pyramid, price: next ? next.triggerPrice : null, distancePct: dPy,
      state: !plan.pyramid.enabled
        ? 'inactive'
        : next === null
          ? 'done'
          : next.plannedQuantity <= 0
            ? 'inactive'
            : pyHit
              ? 'hit'
              : dPy !== null && dPy >= -PLAN_NEAR_PCT
                ? 'near'
                : 'waiting',
      note: !plan.pyramid.enabled
        ? '안 함'
        : next && next.plannedQuantity <= 0
          ? '한도 때문에 추가매수 수량 0'
          : next
            ? `${next.level}차 · 계획 ${next.plannedQuantity}주`
            : '모든 단계 완료',
    },
  ];

  const evaluation: TradePlanEvaluation = {
    signal,
    tier: action === 'arm-exit' ? 'prepare' : tierFor(signal), // 재돌파 확인은 '준비'(사용자 클릭 필요)
    action,
    lines,
    sentence: '',
    distanceToStopPct: dStop,
    stale,
  };
  evaluation.sentence = formatPlanSentence(evaluation);
  return evaluation;
}

/** 초보자용 한 줄 행동문. */
export function formatPlanSentence(ev: TradePlanEvaluation): string {
  switch (ev.signal) {
    case 'stop-hit':
      return ev.action === 'check'
        ? '손절선 아래입니다. 시세가 오래됐으니 새로고침 후 확인하세요.'
        : '손절선에 닿았습니다. 계획대로면 전량 매도입니다.';
    case 'take-profit-hit':
      return '익절선에 닿았습니다. 계획대로면 절반만 팝니다.';
    case 'pyramid-hit':
      return '불타기선에 닿았습니다. 계획 수량만큼 추가매수를 검토하세요(손절선이 올라갑니다).';
    case 'exit-line-hit':
      return '종가가 추세선 아래로 내려왔습니다. 계획대로면 나머지 전량 매도입니다.';
    case 'exit-line-watch':
      return '장중 가격이 추세선 아래입니다. 종가로 확정되면 나머지 전량 매도입니다.';
    case 'near-stop':
      return '손절선까지 2% 안쪽입니다. 증권사 손절 예약주문을 확인하세요.';
    case 'near-pyramid':
      return '다음 불타기선에 가까워졌습니다. 추가매수 자금을 준비하세요.';
    case 'already-below-exit':
      return '지금은 추세선 아래에서 시작한 계획입니다. 선 위로 올라오면 그때부터 추세선을 적용합니다.';
    case 'stale':
      return '시세가 오래됐습니다. 새로고침 후 확인하세요.';
    case 'unavailable':
      return '시세가 없어 판정할 수 없습니다.';
    case 'waiting':
      return ev.action === 'arm-exit'
        ? '종가가 추세선 위로 올라왔습니다. [적용 시작]을 누르면 이탈 감시를 시작합니다.'
        : '기다리는 중입니다. 기다리는 것도 계획입니다.';
    default:
      return '기다리는 중입니다.';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 상태 전이 (전부 불변 — 새 객체 반환)
// ═══════════════════════════════════════════════════════════════════════════

function touch(plan: TradePlan, now: string): TradePlan {
  return { ...plan, updatedAt: now };
}

/** 절반 익절 기록. 익절선은 이후 비활성(done). */
export function applyHalfSell(plan: TradePlan, fill: PlanFill, now: string = fill.date): TradePlan {
  return touch({ ...plan, halfSold: { ...fill } }, now);
}

/**
 * 불타기 체결 기록 — 4중 사전검사(물타기 금지·손절선 하향 금지·1% 총손실·투입/비중 상한)를
 * 실제 체결값으로 다시 검사하고, 통과 시 손절선을 올린다.
 */
export function applyPyramidFill(
  plan: TradePlan,
  fill: PlanFill,
  ctx: { fxRateToKRW: number | null },
  now: string = fill.date
): PyramidFillResult {
  if (!plan.pyramid.enabled) return { ok: false, reason: 'pyramid-disabled' };
  const step = nextPyramidStep(plan);
  if (!step) return { ok: false, reason: 'no-step' };

  const filled = plan.pyramid.steps.filter(s => s.fill);
  const lastFillPrice = filled.length > 0 ? (filled[filled.length - 1].fill as PlanFill).price : plan.anchorPrice;
  if (!(fill.price > lastFillPrice + EPS)) return { ok: false, reason: 'price-not-above-last-fill' };
  if (!(fill.quantity > 0)) return { ok: false, reason: 'no-step' };

  const newStop = stopAfterPyramid(plan.stopPrice, fill.price, plan.stopPct, plan.anchorPrice);
  if (newStop < plan.stopPrice - EPS) return { ok: false, reason: 'stop-would-fall' };

  const held = heldUnits(plan);
  const originalCost = plan.plannedQuantity * plan.anchorPrice;
  const costSoFar = originalCost + filled.reduce((s, st) => s + (st.fill as PlanFill).price * (st.fill as PlanFill).quantity, 0);
  if (costSoFar + fill.price * fill.quantity > originalCost * PYRAMID_COST_CAP_MULTIPLE + EPS) {
    return { ok: false, reason: 'cost-cap-exceeded' };
  }

  const fx = ctx.fxRateToKRW !== null && ctx.fxRateToKRW > 0 ? ctx.fxRateToKRW : null;
  if (fx !== null) {
    const lossAtStop = held.reduce((s, u) => s + u.quantity * (u.price - newStop), 0) + fill.quantity * (fill.price - newStop);
    if (lossAtStop * fx > planRiskAmountKRW(plan) + 1e-6) return { ok: false, reason: 'risk-budget-exceeded' };
    const value = held.reduce((s, u) => s + u.quantity * u.price, 0) + fill.quantity * fill.price;
    if (value * fx > (plan.totalEquityKRW * PYRAMID_POSITION_CAP_PCT) / 100 + 1e-6) {
      return { ok: false, reason: 'position-cap-exceeded' };
    }
  }

  const steps = plan.pyramid.steps.map(s => (s.level === step.level ? { ...s, fill: { ...fill } } : s));
  return {
    ok: true,
    plan: touch({ ...plan, stopPrice: newStop, pyramid: { ...plan.pyramid, steps } }, now),
  };
}

/** 사용자 결정(실행/건너뜀/내일) 기록 — 최근 PLAN_DECISION_MAX 건만 보관. */
export function recordDecision(plan: TradePlan, decision: PlanDecision, now: string = decision.date): TradePlan {
  const decisions = [...plan.decisions, { ...decision }].slice(-PLAN_DECISION_MAX);
  return touch({ ...plan, decisions }, now);
}

/** 같은 신호를 연속으로 미룬 횟수(최근 결정부터 거슬러 셈). */
export function consecutiveTomorrowCount(plan: TradePlan, signal: PlanSignal): number {
  let n = 0;
  for (let i = plan.decisions.length - 1; i >= 0; i--) {
    const d = plan.decisions[i];
    if (d.signal !== signal) continue;
    if (d.choice !== 'tomorrow') break;
    n++;
  }
  return n;
}

/** 추세선 적용 시작(재돌파 확인). */
export function armExitLine(plan: TradePlan, date: string, now: string = date): TradePlan {
  return touch({ ...plan, exitLineArmedAt: date }, now);
}

export function closePlan(plan: TradePlan, reason: TradePlanCloseReason, date: string, now: string = date): TradePlan {
  return touch({ ...plan, status: 'closed', closedReason: reason, closedAt: date }, now);
}

export function cancelPlan(plan: TradePlan, date: string, now: string = date): TradePlan {
  return closePlan(plan, 'manual', date, now);
}

// ═══════════════════════════════════════════════════════════════════════════
// 일괄 계획 대상
// ═══════════════════════════════════════════════════════════════════════════

/** 일괄 계획 마법사 대상인가. 투더문(기본)·현금 아님·유선 제외·시세 있음·활성 계획 없음. */
export function isEligibleForBulkPlan(asset: Asset, opts: { includeCore?: boolean } = {}): boolean {
  const bucket = asset.bucket ?? 'CORE';
  if (bucket !== 'SATELLITE' && !(opts.includeCore && bucket === 'CORE')) return false;
  if ((asset.owner ?? 'WONJONG') === 'YUSEON') return false;
  if (isBaseType(asset.categoryId, 'CASH')) return false;
  if (!(asset.quantity > 0)) return false;
  if (!(asset.priceOriginal > 0)) return false;
  if (asset.tradePlan && asset.tradePlan.status === 'active') return false;
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// 카카오톡 문구 (≤200자)
// ═══════════════════════════════════════════════════════════════════════════

export const KAKAO_TEXT_MAX = 200;

/** 원통화 가격 표기(카톡·카드 공용). KRW/JPY 정수, 그 외 소수 2자리. */
export function formatPlanPrice(price: number, currency: string): string {
  if (currency === 'KRW') return `${Math.round(price).toLocaleString('en-US')}원`;
  if (currency === 'JPY') return `¥${Math.round(price).toLocaleString('en-US')}`;
  const sym = currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : '';
  return `${sym}${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatQty(q: number): string {
  return Number.isInteger(q) ? `${q}주` : `${q}`;
}

function clip(s: string, max = KAKAO_TEXT_MAX): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

export interface KakaoTextInput {
  name: string;
  evaluation: TradePlanEvaluation;
  plan: TradePlan;
  price: number;
  priceAsOf: string;   // YYYY-MM-DD
  timeLabel?: string;  // '14:00' 등 (없으면 생략)
  isIntraday: boolean;
  quantity: number;    // 현재 보유 수량
}

/**
 * 카톡 문구 선두 이모지 — 앱 색 규약(TradePlanCard, Stage B)에 맞춘다(2026-09-16 Stage D2 F3).
 *   손절선 = 🟠 주황(warning) · 추세선 이탈 = 🔵 파랑(내림) · 익절선 = 🔴 빨강(오름) · 불타기선 = 🔺 빨강 삼각(오름)
 *   근접/장중 확인·시세 문제 = ⚠️ · 정보(대기·불타기 근접) = ℹ️ · 추세선 회복 = 🟢 초록(ok) · 요약 = 📋
 * 🔴는 '오름'(익절) 전용 — 손절에 쓰지 말 것. ⚠️·ℹ️는 VS16(U+FE0F)을 붙여 컬러 이모지로 렌더한다.
 * 카톡은 앱 밖 평문이라 lucide 아이콘을 쓸 수 없어 이모지가 유일한 색 채널이다
 * (RULES §8 '이모지로 의미 색 표시 금지'는 components/·App.tsx 한정).
 * 바꾸면 GAS에 반영하려면 `npm run gas:push` 재배포 필요(번들이 이 파일을 그대로 import).
 */
const KAKAO_EMOJI = {
  stopHit: '\u{1F7E0}',        // 🟠
  exitLineHit: '\u{1F535}',    // 🔵
  takeProfitHit: '\u{1F534}',  // 🔴
  pyramidHit: '\u{1F53A}',     // 🔺
  caution: '⚠️',     // ⚠️ (near-stop · exit-line-watch · stale · unavailable)
  info: 'ℹ️',        // ℹ️ (near-pyramid · waiting)
  armExit: '\u{1F7E2}',        // 🟢
  digest: '\u{1F4CB}',         // 📋
} as const;

/** 카카오톡 "나에게 보내기" 본문. 행동 → 숫자 → 근거 → 계획 기준일 순, 200자 이내. */
export function formatKakaoText(input: KakaoTextInput): string {
  const { name, evaluation: ev, plan, price, priceAsOf, timeLabel, isIntraday, quantity } = input;
  const cur = plan.currency;
  const when = `${priceAsOf.slice(5)}${timeLabel ? ` ${timeLabel}` : ''} ${isIntraday ? '장중' : '확정'}`;
  const tier = PLAN_TIER_LABELS[ev.tier];
  const basis = `계획 ${plan.anchorDate.slice(5)} 기준`;
  const shortName = name.length > 14 ? name.slice(0, 13) + '…' : name;
  const exitLine = ev.lines.find(l => l.key === 'exitLine');
  const py = nextPyramidStep(plan);
  let body: string;
  switch (ev.signal) {
    case 'stop-hit':
      body = `${KAKAO_EMOJI.stopHit} [${tier}·손절선] ${shortName} 전량 매도 확인\n현재 ${formatPlanPrice(price, cur)} ≤ 손절선 ${formatPlanPrice(plan.stopPrice, cur)} (${when})\n수량 ${formatQty(quantity)} · ${basis}`;
      break;
    case 'take-profit-hit':
      body = `${KAKAO_EMOJI.takeProfitHit} [${tier}·익절선] ${shortName} 절반 매도\n현재 ${formatPlanPrice(price, cur)} ≥ 익절선 ${formatPlanPrice(plan.takeProfitPrice ?? 0, cur)} (${when})\n수량 ${formatQty(Math.floor(quantity / 2))} · ${basis}`;
      break;
    case 'exit-line-hit':
      body = `${KAKAO_EMOJI.exitLineHit} [${tier}·추세선] ${shortName} 나머지 전량 매도\n종가 ${formatPlanPrice(price, cur)} < 추세선 ${exitLine && exitLine.price !== null ? formatPlanPrice(exitLine.price, cur) : '-'} (${priceAsOf.slice(5)} 확정)\n수량 ${formatQty(quantity)} · ${basis}`;
      break;
    case 'exit-line-watch':
      body = `${KAKAO_EMOJI.caution} [${tier}·추세선] ${shortName} 장중 추세선 아래\n현재 ${formatPlanPrice(price, cur)} < 추세선 ${exitLine && exitLine.price !== null ? formatPlanPrice(exitLine.price, cur) : '-'} (${when})\n종가로 확정되면 나머지 전량 매도 · ${basis}`;
      break;
    case 'pyramid-hit':
      body = `${KAKAO_EMOJI.pyramidHit} [${tier}·불타기선] ${shortName} ${py ? `${py.level}차` : ''} 도달\n현재 ${formatPlanPrice(price, cur)} ≥ ${py ? formatPlanPrice(py.triggerPrice, cur) : '-'} (${when})\n계획: ${py ? formatQty(py.plannedQuantity) : '-'} 추가매수 검토 (손절선 상향)\n※ 검증되지 않은 기능 · ${basis}`;
      break;
    case 'near-stop':
      body = `${KAKAO_EMOJI.caution} [${tier}·손절선] ${shortName} 손절선 근접\n현재 ${formatPlanPrice(price, cur)} · 손절선 ${formatPlanPrice(plan.stopPrice, cur)} (${when})\n증권사 손절 예약주문 확인 · ${basis}`;
      break;
    case 'near-pyramid':
      body = `${KAKAO_EMOJI.info} [${tier}·불타기선] ${shortName} 불타기선 근접\n현재 ${formatPlanPrice(price, cur)} · 다음 선 ${py ? formatPlanPrice(py.triggerPrice, cur) : '-'} (${when})\n${basis}`;
      break;
    case 'stale':
      body = `${KAKAO_EMOJI.caution} [시세 오래됨] ${shortName}\n마지막 시세 ${priceAsOf.slice(5)} — 앱에서 새로고침 후 확인하세요\n${basis}`;
      break;
    case 'unavailable':
      body = `${KAKAO_EMOJI.caution} [시세 조회 실패] ${shortName}\n앱에서 직접 확인하세요\n${basis}`;
      break;
    default:
      body = ev.action === 'arm-exit'
        ? `${KAKAO_EMOJI.armExit} [준비·추세선] ${shortName} 추세선 위로 회복\n종가 ${formatPlanPrice(price, cur)} > 추세선 ${exitLine && exitLine.price !== null ? formatPlanPrice(exitLine.price, cur) : '-'} (${priceAsOf.slice(5)} 확정)\n앱에서 [적용 시작]을 누르면 이탈 감시 시작 · ${basis}`
        : `${KAKAO_EMOJI.info} ${shortName} 대기 중\n현재 ${formatPlanPrice(price, cur)} (${when}) · ${basis}`;
  }
  return clip(body);
}

export interface KakaoDigestInput {
  timeLabel: string;              // '15:40'
  urgent: number;
  today: number;
  prepare: number;
  unavailable: number;
  brokerStopMissing: number;
  planless: number;
}

/** 일일 요약(무신호도 발송 = 생존 신호). */
export function formatKakaoDigest(d: KakaoDigestInput): string {
  const body =
    `${KAKAO_EMOJI.digest} [오늘 점검 ${d.timeLabel}] 긴급 ${d.urgent} · 오늘 실행 ${d.today} · 준비 ${d.prepare}\n` +
    `확인 필요: 시세 없음 ${d.unavailable} · 손절주문 미등록 ${d.brokerStopMissing}\n` +
    (d.planless > 0 ? `계획 없는 투더문 ${d.planless}종` : '모든 투더문 종목에 계획 있음');
  return clip(body);
}
