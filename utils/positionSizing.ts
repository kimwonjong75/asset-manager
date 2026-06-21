// 리스크 기반 포지션 사이징 계산기 (순수 함수)
// ---------------------------------------------------------------------------
// 지식 근거: constants/knowledgeBase.ts `rule-position-sizing-calc`
//   · claim risk-1pct-per-trade   — 한 번의 거래로 총자산의 1%(최대 2%)만 잃도록 설계.
//   · claim position-size-from-stop — 포지션 = (총자산 × 리스크%) / 손절폭%.
// 원리: 진입가에서 손절가까지 손절폭%만큼 하락 시 손실이 (총자산 × 허용손실%)를 넘지
//       않도록 투자금액을 역산한다. 손절폭이 좁을수록 투자금액이 커지므로, 레버리지를
//       허용하지 않으면 총자산으로 캡한다.
// 규칙: side effect 금지(utils 규칙), any 금지. 모든 화폐값은 동일 통화 단위로 전달하며
//       (호출부가 환산 책임) 결과도 같은 통화 단위로 반환한다.

export type PositionSizingError =
  | 'invalid-equity' // 총자산 ≤ 0
  | 'invalid-risk'   // 허용손실% ≤ 0 또는 > 100
  | 'invalid-entry'  // 진입가 ≤ 0
  | 'invalid-stop';  // 손절가 < 0 또는 ≥ 진입가

export const POSITION_SIZING_ERROR_LABELS: Record<PositionSizingError, string> = {
  'invalid-equity': '총자산을 0보다 크게 입력하세요.',
  'invalid-risk': '허용 손실 비율은 0~100% 사이여야 합니다.',
  'invalid-entry': '현재가(진입가)를 0보다 크게 입력하세요.',
  'invalid-stop': '손절가는 0 이상이며 진입가보다 낮아야 합니다.',
};

export interface PositionSizingInput {
  totalEquity: number;          // 총자산 (단일 통화)
  riskPercentPerTrade: number;  // 1회 허용손실 % (예: 1 = 1%)
  entryPrice: number;           // 진입가/현재가 (totalEquity와 동일 통화)
  stopPrice: number;            // 손절가 (entryPrice와 동일 통화, < entryPrice)
  lotSize?: number;             // 1주 단위 (기본 1). 정수 종목 수량 라운딩용
  allowFractional?: boolean;    // 소수 수량 허용 (암호화폐). true면 lotSize 무시
  allowLeverage?: boolean;      // 손절폭이 좁아 투자금액이 총자산을 초과해도 허용 (기본 false → 총자산 캡)
}

export interface PositionSizingResult {
  valid: boolean;
  reason?: PositionSizingError;  // valid=false일 때 사유
  stopLossPercent: number;       // 손절폭 % = (entry − stop) / entry × 100
  riskAmount: number;            // 허용 손실 금액 = totalEquity × risk%
  rawInvestment: number;         // 캡 적용 전 리스크 기반 투자금액
  maxInvestment: number;         // 최종 권장 투자금액 (총자산 캡 적용 후)
  maxQuantity: number;           // 권장 수량 (lotSize/fractional 기준 내림)
  maxQuantityExact: number;      // 라운딩 전 수량
  actualRiskAmount: number;      // 권장 수량 기준 실제 손실 노출액 = maxQuantity × (entry − stop)
  investmentRatio: number;       // maxInvestment / totalEquity × 100
  capped: boolean;               // 총자산 캡에 걸렸는지 (손절폭 < 허용손실% → 레버리지 필요)
}

const invalidResult = (reason: PositionSizingError): PositionSizingResult => ({
  valid: false,
  reason,
  stopLossPercent: 0,
  riskAmount: 0,
  rawInvestment: 0,
  maxInvestment: 0,
  maxQuantity: 0,
  maxQuantityExact: 0,
  actualRiskAmount: 0,
  investmentRatio: 0,
  capped: false,
});

/**
 * 리스크 기반 권장 포지션을 계산한다.
 * 손절 시 손실이 (총자산 × 허용손실%)를 넘지 않는 최대 투자금액·수량을 반환한다.
 */
export function calculatePositionSize(input: PositionSizingInput): PositionSizingResult {
  const { totalEquity, riskPercentPerTrade, entryPrice, stopPrice } = input;
  const lotSize = input.lotSize && input.lotSize > 0 ? input.lotSize : 1;
  const allowFractional = input.allowFractional ?? false;
  const allowLeverage = input.allowLeverage ?? false;

  if (!(totalEquity > 0)) return invalidResult('invalid-equity');
  if (!(riskPercentPerTrade > 0) || riskPercentPerTrade > 100) return invalidResult('invalid-risk');
  if (!(entryPrice > 0)) return invalidResult('invalid-entry');
  if (!(stopPrice >= 0) || stopPrice >= entryPrice) return invalidResult('invalid-stop');

  const stopDistance = entryPrice - stopPrice;
  const stopLossPercent = (stopDistance / entryPrice) * 100;
  const riskAmount = totalEquity * (riskPercentPerTrade / 100);

  // 손절 시 손실 = 투자금액 × (손절폭/진입가)가 riskAmount가 되도록 역산.
  const rawInvestment = (riskAmount * entryPrice) / stopDistance;
  const capped = !allowLeverage && rawInvestment > totalEquity;
  const maxInvestment = capped ? totalEquity : rawInvestment;

  const maxQuantityExact = maxInvestment / entryPrice;
  const maxQuantity = allowFractional
    ? Math.floor(maxQuantityExact * 1e8) / 1e8
    : Math.floor(maxQuantityExact / lotSize) * lotSize;

  const actualRiskAmount = maxQuantity * stopDistance;
  const investmentRatio = (maxInvestment / totalEquity) * 100;

  return {
    valid: true,
    stopLossPercent,
    riskAmount,
    rawInvestment,
    maxInvestment,
    maxQuantity,
    maxQuantityExact,
    actualRiskAmount,
    investmentRatio,
    capped,
  };
}

/** 손절폭(%)으로부터 손절가를 역산 (UI에서 % 입력 모드 지원용). */
export function stopPriceFromPercent(entryPrice: number, stopLossPercent: number): number {
  return entryPrice * (1 - stopLossPercent / 100);
}

/** 손절가로부터 손절폭(%)을 계산 (진입가 대비). 유효하지 않으면 0. */
export function stopLossPercentFromPrice(entryPrice: number, stopPrice: number): number {
  if (!(entryPrice > 0) || stopPrice >= entryPrice) return 0;
  return ((entryPrice - stopPrice) / entryPrice) * 100;
}
