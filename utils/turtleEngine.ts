// utils/turtleEngine.ts
// ---------------------------------------------------------------------------
// 터틀 트레이딩 규칙 엔진 (전부 순수 함수, side effect/any 금지).
// 규칙 원전: 터틀트레이딩_통합검증_최종본.md §4·§6·§7·§8·§10·§14.
//
// 이 파일은 "계산"만 한다. 상태 변경·저장·주문 실행은 Phase 2 훅(useActionQueue)이 담당한다.
// 모든 가격은 종목 통화(priceOriginal) 기준, 예산(satelliteBudgetKRW)은 KRW 기준.
//   → riskKRW 등 "KRW"가 붙은 반환값은 종목 통화가 KRW인 경우에만 그대로 KRW다.
//     외화 종목은 호출부(Phase 2)가 환율로 환산해야 한다 (엔진은 통화를 모른다).
//
// fail-closed 원칙: N 미산출·데이터 부족·돌파 미발생 시 주문안을 만들지 않는다(null/ok:false).

import { calculateATR } from './maCalculations';
import {
  TurtleSettings,
  TurtlePosition,
  TurtleUnitSize,
  TurtleEntryDecision,
  TurtleEntryProposal,
  TurtlePyramidProposal,
  TurtleSellProposal,
  TurtleTotalRisk,
} from '../types/turtle';

/**
 * N = 20일 ATR의 마지막(현재) 값.
 * calculateATR(period=20)을 재사용. OHLC 부족 시 null → 진입 fail-closed.
 */
export function computeN(
  highs: (number | null)[],
  lows: (number | null)[],
  closes: (number | null)[],
  period: number = 20
): number | null {
  const atr = calculateATR(highs, lows, closes, period);
  for (let i = atr.length - 1; i >= 0; i--) {
    const v = atr[i];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

export interface UnitSizeOptions {
  allowFractional?: boolean;  // 암호화폐 등 소수 수량 허용
  /**
   * 1 유닛(수량 1)이 가격 1.00 움직일 때의 통화가치.
   * 현물 주식/코인 = 1 (수량 1주가 가격 1원 움직이면 1원). 선물 = 계약승수(예: 난방유 42,000).
   * 터틀 원본 선물 공식 검증용으로만 ≠1을 쓴다.
   */
  dollarPerPoint?: number;
  /**
   * 환율 (KRW per 1 종목통화). 돈-공간(예산 KRW)과 가격-공간(원통화 price/N)을 잇는 유일한 다리(D6).
   * KRW 자산 = 1. 미설정 시 1 (단일통화 가정 — 원전 선물 예시·KRW 종목).
   */
  fxRate?: number;
}

/**
 * 유닛 사이징 — riskAmountKRW ÷ (N_원통화 × fxRate × dollarPerPoint) (D6 통화 규약).
 * 현물 KRW: 수량 = (위성예산 × 0.5%) ÷ N.  현물 외화: N을 fxRate로 KRW 환산해 나눔.
 * positionValueCapPct(기본 25%, KRW 기준)를 넘으면 수량을 상한에 맞춰 축소(capped=true).
 * @param price 종목 통화 원본 가격 (priceOriginal). KRW 환산하지 않음.
 * @param n 종목 통화 기준 N (20일 ATR). KRW 환산하지 않음.
 */
export function computeUnitSize(
  settings: TurtleSettings,
  n: number,
  price: number,
  opts: UnitSizeOptions = {}
): TurtleUnitSize {
  const dpp = opts.dollarPerPoint ?? 1;
  const fx = opts.fxRate ?? 1;
  const allowFractional = opts.allowFractional ?? false;
  const empty: TurtleUnitSize = { riskAmount: 0, unitsExact: 0, units: 0, positionValueKRW: 0, capped: false };

  if (!(settings.satelliteBudgetKRW > 0)) return empty;
  if (!(n > 0) || !(dpp > 0) || !(fx > 0)) return empty;

  const riskAmount = settings.satelliteBudgetKRW * (settings.riskPerUnitPct / 100); // KRW
  const unitsExact = riskAmount / (n * fx * dpp);
  let units = roundQty(unitsExact, allowFractional);

  // 1종목 매수금액 상한 (위성 예산 대비 %, KRW 기준). 0이면 상한 없음.
  // 판정: priceOriginal × fxRate × qty ≤ capValueKRW.
  let capped = false;
  if (settings.positionValueCapPct > 0 && price > 0) {
    const capValueKRW = settings.satelliteBudgetKRW * (settings.positionValueCapPct / 100);
    if (units * price * fx * dpp > capValueKRW) {
      capped = true;
      units = roundQty(capValueKRW / (price * fx * dpp), allowFractional);
    }
  }

  return {
    riskAmount,
    unitsExact,
    units,
    positionValueKRW: units * price * fx * dpp,
    capped,
  };
}

function roundQty(qty: number, allowFractional: boolean): number {
  if (!(qty > 0)) return 0;
  return allowFractional ? Math.floor(qty * 1e8) / 1e8 : Math.floor(qty);
}

export interface EntryContext {
  ticker: string;
  name: string;
  price: number;                 // 현재가 (priceOriginal 기준, 원통화)
  n: number | null;              // computeN 결과 (원통화)
  donchianHigh: number | null;   // 55일 최고가 (당일 제외, 원통화)
  settings: TurtleSettings;
  openRiskKRW: number;           // 기존 오픈 포지션 리스크 합 KRW (computeTotalOpenRisk().riskKRW)
  remainingBudgetKRW: number;    // 위성 예산 잔여 KRW (배정 가능 현금)
  fxRate?: number;               // KRW/종목통화 (D6, KRW 자산=1). 사이징·리스크 환산에만 사용.
  allowFractional?: boolean;
  dollarPerPoint?: number;
}

/**
 * 신규 진입 판정 — 55일 최고가 돌파 시에만 주문안 생성.
 * 가드: N 미산출 / 미돌파 / 0주 / 예산 부족 / 동시 전멸 한도(12%) 초과 → ok:false + 사유.
 * 통화 규약(D6): stopPrice/donchianHigh는 원통화 유지, riskKRW/positionValueKRW는 fxRate로 KRW 환산.
 */
export function evaluateEntry(ctx: EntryContext): TurtleEntryDecision {
  const { settings, price, n, donchianHigh } = ctx;
  const fx = ctx.fxRate ?? 1;
  const dpp = ctx.dollarPerPoint ?? 1;

  if (n === null || !(n > 0)) return { ok: false, reason: 'no-n' };
  if (donchianHigh === null || !(price >= donchianHigh)) return { ok: false, reason: 'no-breakout' };

  const size = computeUnitSize(settings, n, price, {
    allowFractional: ctx.allowFractional,
    dollarPerPoint: dpp,
    fxRate: fx,
  });
  if (!(size.units > 0)) return { ok: false, reason: 'zero-qty' };
  if (size.positionValueKRW > ctx.remainingBudgetKRW) return { ok: false, reason: 'insufficient-budget' };

  const stopPrice = price - settings.stopMultipleN * n; // 원통화 (환율 불변, 실제 주문 가격)
  const riskKRW = size.units * (price - stopPrice) * fx * dpp; // KRW = units × stopMultipleN×N × fx
  const budget = settings.satelliteBudgetKRW;
  const totalRiskPct = budget > 0 ? ((ctx.openRiskKRW + riskKRW) / budget) * 100 : Infinity;
  if (totalRiskPct > settings.maxTotalRiskPct) return { ok: false, reason: 'risk-limit' };

  const proposal: TurtleEntryProposal = {
    ticker: ctx.ticker,
    name: ctx.name,
    quantity: size.units,
    refPrice: price,
    stopPrice,
    nAtEntry: n,
    donchianHigh,
    riskKRW,
    positionValueKRW: size.positionValueKRW,
    capped: size.capped,
    fxRateUsed: fx,
  };
  return { ok: true, proposal };
}

/**
 * 피라미딩(불타기) 판정 — 가격이 마지막 체결가 + pyramidStepN×N 이상이고 유닛 여유가 있을 때만.
 * **물타기 불가**: 조건이 "마지막 체결가보다 위"라 하락 시엔 절대 트리거되지 않는다.
 * 추가 후 전체 손절가는 recomputeStop 규칙대로 refPrice − stopMultipleN×N 으로 동반 상향된다.
 */
export function evaluatePyramid(
  position: TurtlePosition,
  price: number,
  n: number | null,
  settings: TurtleSettings,
  opts: UnitSizeOptions = {}
): TurtlePyramidProposal | null {
  if (position.status !== 'open') return null;
  if (n === null || !(n > 0)) return null;
  if (position.units.length >= settings.maxUnitsPerPosition) return null;

  const lastUnit = position.units[position.units.length - 1];
  if (!lastUnit) return null;
  const trigger = lastUnit.fillPrice + settings.pyramidStepN * n;
  if (!(price >= trigger)) return null;

  const size = computeUnitSize(settings, n, price, opts);
  if (!(size.units > 0)) return null;

  const newStopPrice = price - settings.stopMultipleN * n;
  return {
    positionId: position.id,
    ticker: position.ticker,
    name: position.name,
    quantity: size.units,
    refPrice: price,
    newStopPrice,
    nAtFill: n,
    unitIndex: position.units.length,
  };
}

/**
 * 피라미딩/진입 후 전체 포지션의 공통 손절가 재계산.
 * = 마지막 체결가 − stopMultipleN × (마지막 체결 시 N).  (문서 §7: 전체 손절이 최근 유닛 −2N에 정렬)
 */
export function recomputeStop(position: TurtlePosition, settings: TurtleSettings): number {
  const lastUnit = position.units[position.units.length - 1];
  if (!lastUnit) return position.stopPrice;
  return lastUnit.fillPrice - settings.stopMultipleN * lastUnit.nAtFill;
}

/** 손절 판정 — 가격이 손절가 이하로 닿으면 전량 매도 주문안 (예외 없음). */
export function evaluateStop(position: TurtlePosition, price: number): TurtleSellProposal | null {
  if (position.status !== 'open') return null;
  if (!(price <= position.stopPrice)) return null;
  return {
    positionId: position.id,
    ticker: position.ticker,
    name: position.name,
    quantity: positionQuantity(position),
    refPrice: price,
    reason: 'stop',
    triggerPrice: position.stopPrice,
  };
}

/** 청산 판정 — 가격이 20일 최저가(당일 제외) 이하로 이탈하면 전량 매도. 손절과 별개 장치(문서 §8). */
export function evaluateExit(
  position: TurtlePosition,
  donchianLow: number | null,
  price: number
): TurtleSellProposal | null {
  if (position.status !== 'open') return null;
  if (donchianLow === null || !(price <= donchianLow)) return null;
  return {
    positionId: position.id,
    ticker: position.ticker,
    name: position.name,
    quantity: positionQuantity(position),
    refPrice: price,
    reason: 'channel-exit',
    triggerPrice: donchianLow,
  };
}

/** 포지션 총 보유 수량 (전 유닛 합). */
export function positionQuantity(position: TurtlePosition): number {
  return position.units.reduce((sum, u) => sum + u.quantity, 0);
}

/**
 * 포지션의 "지금 손절되면 잃는 금액" (KRW).
 * = Σ 유닛 수량 × (체결가 − 손절가) × fxRate. 체결가·손절가는 원통화(불변), fxRate로 KRW 환산(D6).
 * 손절가가 체결가보다 높으면(수익 확정) 음수 → 포지션 단위로 max(0,·).
 * @param fxRate KRW/종목통화 (KRW 자산=1). 게이지는 **최신 환율**을 넣는다 — 손절가 자체는 불변, KRW 환산액만 변동.
 */
export function positionRiskAtStop(position: TurtlePosition, fxRate: number = 1): number {
  const raw = position.units.reduce(
    (sum, u) => sum + u.quantity * (u.fillPrice - position.stopPrice),
    0
  );
  return Math.max(0, raw) * fxRate;
}

/**
 * 전 포지션 동시 손절 시 손실 합(KRW)과 위성 예산 대비 %.
 * 통화 규약(D6): 포지션별 손절가는 원통화 불변, getFxRate로 현재 환율을 받아 KRW로 환산해 합산.
 * @param getFxRate 포지션 → 현재 환율(KRW/종목통화). 미지정 시 전부 1 (단일통화/KRW 가정).
 *   Phase 2 호출부가 position→asset→currency→최신환율을 매핑해 주입한다.
 */
export function computeTotalOpenRisk(
  positions: TurtlePosition[],
  settings: TurtleSettings,
  getFxRate: (position: TurtlePosition) => number = () => 1
): TurtleTotalRisk {
  const riskKRW = positions
    .filter(p => p.status === 'open')
    .reduce((sum, p) => sum + positionRiskAtStop(p, getFxRate(p)), 0);
  const riskPct = settings.satelliteBudgetKRW > 0
    ? (riskKRW / settings.satelliteBudgetKRW) * 100
    : 0;
  return { riskKRW, riskPct };
}

/**
 * 드로다운 자금관리 감쇄 (문서 §10) — 기준자산 대비 10% 손실마다 명목 계좌 20% 축소.
 * 트리거는 "현 명목계좌의 10% 추가 하락"마다 복리로 발생 (문서 예: 100→90에서 80, 82에서 64).
 * @param currentEquity 현재 위성 자산 평가액
 * @param referenceEquity 기준자산 (연초 시작 자산 — 회복 시 이 값으로 복귀. 문서: "역대 최고 잔고" 아님)
 * @returns 사이징에 사용할 명목 예산 (감쇄 반영). currentEquity ≥ referenceEquity면 referenceEquity 그대로.
 */
export function applyDrawdownScaling(
  currentEquity: number,
  referenceEquity: number,
  opts: { stepDown?: number; reduce?: number } = {}
): number {
  const stepDown = opts.stepDown ?? 0.10;
  const reduce = opts.reduce ?? 0.20;
  if (!(referenceEquity > 0) || !(currentEquity >= 0)) return Math.max(0, referenceEquity);

  let nominal = referenceEquity;
  let triggerLoss = referenceEquity * stepDown;   // 다음 트리거까지의 누적 손실
  const loss = referenceEquity - currentEquity;
  // 무한루프 방지 (실무상 몇 스텝이면 종료하나 안전 상한)
  let guard = 0;
  while (loss >= triggerLoss - 1e-9 && guard < 1000) {
    nominal = nominal * (1 - reduce);
    triggerLoss += nominal * stepDown;
    guard++;
  }
  return nominal;
}
