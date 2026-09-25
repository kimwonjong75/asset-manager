// scripts/backtest/portfolioTurtle/sizing.ts
// 순수 함수 — 재매수분 사이징 변형 B/G/A/C. 위험 기준 = 그 시점 포트폴리오 평가액(mark-to-market).
// docs/터틀_사이징_불타기_기준_260925.md §⑤·§⑥·Advisor 보충(변형 G) 그대로.
//
// B: 1%/N, 1유닛, 상한 10% (§보정 = utils/turtleEngine.computeUnitSize의 cap 분기와 동일 공식, 사이징
//    분모만 위성예산 대신 포트폴리오 평가액으로 바꾼 버전 — computeUnitSize는 "기존 포지션에 더하는"
//    경우(A의 2번째 유닛 이후)를 지원하지 않아 이 파일에서 자체 구현한다).
// G: 유닛 = min(리스크공식, 상한÷maxUnits) — 최초 1회만 계산해 고정 크기로 재사용.
// A: 리스크공식을 매번(모든 유닛마다) 그 시점 N으로 재계산 — 상한은 "기존 포지션 가치 대비 남은 여유"로 작동.
// C: 리스크공식을 최초 1회만 계산해 고정 크기로 재사용, 상한 없음(현금·총위험 한도만 구속).

export interface SizingContext {
  /** 사이징 분모 — 현재(또는 드로다운 감쇄된) 포트폴리오 평가액 KRW. */
  equityKRW: number;
  riskPerUnitPct: number;
  /** null = 상한 없음(C). */
  positionCapPct: number | null;
  maxUnits: number;
}

export interface UnitSizeResult {
  /** 반올림 전 raw 수량(종목 통화 가격 기준). */
  qty: number;
  riskAmountKRW: number;
  cappedByPosition: boolean;
}

function isPos(v: number): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** 리스크공식 raw 수량(상한 미적용) = (equity × risk%) ÷ (N × fx). */
export function riskFormulaQty(ctx: SizingContext, nLocal: number, fx: number): number {
  if (!isPos(ctx.equityKRW) || !isPos(nLocal) || !isPos(fx)) return 0;
  const riskAmountKRW = ctx.equityKRW * (ctx.riskPerUnitPct / 100);
  return riskAmountKRW / (nLocal * fx);
}

function riskAmountKRWOf(ctx: SizingContext): number {
  return isPos(ctx.equityKRW) ? ctx.equityKRW * (ctx.riskPerUnitPct / 100) : 0;
}

/**
 * B(1유닛)·A(매번 재계산) 공통 — 기존 포지션 가치(existingValueKRW)를 고려해 상한까지 남은 여유로 깎는다.
 * positionCapPct=null이면 상한 없음(리스크공식 그대로).
 */
export function sizeUnitWithRoom(
  ctx: SizingContext, nLocal: number, priceLocal: number, fx: number, existingValueKRW: number
): UnitSizeResult {
  const riskAmountKRW = riskAmountKRWOf(ctx);
  const qtyRisk = riskFormulaQty(ctx, nLocal, fx);
  if (ctx.positionCapPct === null) return { qty: qtyRisk, riskAmountKRW, cappedByPosition: false };
  const capKRW = ctx.equityKRW * (ctx.positionCapPct / 100);
  const roomKRW = Math.max(0, capKRW - existingValueKRW);
  const qtyCap = isPos(priceLocal) && isPos(fx) ? roomKRW / (priceLocal * fx) : 0;
  return qtyRisk <= qtyCap
    ? { qty: qtyRisk, riskAmountKRW, cappedByPosition: false }
    : { qty: qtyCap, riskAmountKRW, cappedByPosition: true };
}

/** G — 유닛 크기 = min(리스크공식, 상한÷maxUnits). 최초 진입 시 1회만 호출해 캐시한다. */
export function sizeFixedUnitCapDiv(ctx: SizingContext, nLocal: number, priceLocal: number, fx: number): UnitSizeResult {
  const riskAmountKRW = riskAmountKRWOf(ctx);
  const qtyRisk = riskFormulaQty(ctx, nLocal, fx);
  if (ctx.positionCapPct === null || ctx.maxUnits <= 0) return { qty: qtyRisk, riskAmountKRW, cappedByPosition: false };
  const perUnitCapKRW = (ctx.equityKRW * (ctx.positionCapPct / 100)) / ctx.maxUnits;
  const qtyCap = isPos(priceLocal) && isPos(fx) ? perUnitCapKRW / (priceLocal * fx) : 0;
  return qtyRisk <= qtyCap
    ? { qty: qtyRisk, riskAmountKRW, cappedByPosition: false }
    : { qty: qtyCap, riskAmountKRW, cappedByPosition: true };
}

/** C — 리스크공식 그대로(상한 없음). 최초 진입 시 1회만 호출해 캐시한다. */
export function sizeFixedUnitNoCap(ctx: SizingContext, nLocal: number, fx: number): UnitSizeResult {
  return { qty: riskFormulaQty(ctx, nLocal, fx), riskAmountKRW: riskAmountKRWOf(ctx), cappedByPosition: false };
}

/** 수량 반올림 — 코인 1e-8 내림, 그 외 정수 내림(기존 앱·연구스크립트 공통 관례). */
export function roundQty(qty: number, isCrypto: boolean): number {
  if (!(qty > 0)) return 0;
  return isCrypto ? Math.floor(qty * 1e8) / 1e8 : Math.floor(qty);
}
