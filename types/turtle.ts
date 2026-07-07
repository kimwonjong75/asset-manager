// types/turtle.ts
// ---------------------------------------------------------------------------
// 터틀 트레이딩(투더문/위성 10%) 전략 포지션 모델 및 설정.
// 규칙 원전: 터틀트레이딩_통합검증_최종본.md §4(유닛 사이징)·§6(피라미딩)·§7(손절)·§8(청산)·§14(규칙 카드).
//
// 설계 원칙:
//   · 터틀 규칙은 예측이 아니라 "계산"이다 — N(변동성)이 수량·손절·추가매수 간격을 전부 결정한다.
//   · 손절가는 "약속"으로 포지션에 저장된다 (결과 기준 %손절이 아니라, 진입 시 확정되는 절대 가격).
//   · 1% 손실규칙의 계좌 = 위성 예산(satelliteBudgetKRW). 코어(90%)에는 손절이 없다.
//   · 물타기 불가: 추가매수(피라미딩)는 "직전 체결가보다 위"에서만 발생하므로 하락 시 추가매수는 구조적으로 불가능.

export type TurtleExitReason = 'stop' | 'channel-exit' | 'manual';

/** 한 번의 체결(최초 진입 또는 피라미딩) 기록. */
export interface TurtleUnit {
  fillDate: string;     // YYYY-MM-DD
  fillPrice: number;    // 체결가 (priceOriginal 기준, 종목 통화 — KRW 환산 금지)
  quantity: number;     // 체결 수량
  nAtFill: number;      // 체결 시점의 N (20일 ATR, 종목 통화) — 손절 재계산의 기준
  fxRateAtFill?: number; // 체결 시점 환율 (KRW/종목통화, 감사·추적용). 손절가 역환산에 절대 사용 금지 — 리스크 게이지는 최신 환율 사용. (D6)
}

/** 하나의 터틀 포지션 (최초 진입 + 피라미딩 유닛들 + 공통 손절가). */
export interface TurtlePosition {
  id: string;
  ticker: string;
  name: string;
  assetId?: string;              // 실행 후 Asset과 연결
  units: TurtleUnit[];           // 최초 진입 = units[0], 이후 피라미딩
  stopPrice: number;             // 전체 포지션 공통 손절가 = 마지막 체결가 − stopMultipleN×N (피라미딩 시 동반 상향)
  entryDonchianHigh: number;     // 진입 근거 스냅샷 (돌파한 55일 최고가)
  status: 'open' | 'closed';
  openedAt: string;              // YYYY-MM-DD
  closedAt?: string;
  exitReason?: TurtleExitReason;
}

/** 터틀 운영 파라미터. 기본값은 DEFAULT_TURTLE_SETTINGS. */
export interface TurtleSettings {
  satelliteBudgetKRW: number;    // 위성 예산 (수동 입력, 권장 총자산의 10%). 모든 사이징의 분모.
  riskPerUnitPct: number;        // 유닛당 사이징 리스크 % (위성 예산 대비). 기본 0.5 (= 총자산 0.05%). 2N 손절 시 실손실 = riskPerUnitPct×stopMultipleN.
  maxUnitsPerPosition: number;   // 한 포지션 최대 유닛 수. 기본 2 (상한 4).
  entryLookback: number;         // 진입 돌파 채널. 기본 55.
  exitLookback: number;          // 청산 채널. 기본 20.
  stopMultipleN: number;         // 손절 배수. 기본 2 (진입가 − 2N).
  pyramidStepN: number;          // 피라미딩 간격 (N 배수). 기본 0.5.
  maxTotalRiskPct: number;       // 동시 전멸 한도 % (위성 예산 대비). 기본 12.
  positionValueCapPct: number;   // 1종목 매수금액 상한 % (위성 예산 대비). 기본 25. 0이면 상한 없음.
  drawdownScalingEnabled: boolean; // 드로다운 감쇄 사용. 기본 true.
  /**
   * 오늘 주문 자동 생성 (자동 검토 Phase C, opt-in). true면 앱 시작 후 시세 준비 시
   * 하루 1회 "오늘 주문 생성"을 자동 실행(큐 저장). 기본 false — "보이지 않는 쓰기 금지"
   * 원칙상 사용자가 설정으로 명시 동의했을 때만 켜진다. (구 저장본은 필드 없음 → false 취급)
   */
  autoGenerateQueue?: boolean;
}

export const DEFAULT_TURTLE_SETTINGS: TurtleSettings = {
  satelliteBudgetKRW: 0,   // 사용자가 반드시 설정 — 0이면 진입 주문이 생성되지 않음(fail-closed)
  riskPerUnitPct: 0.5,
  maxUnitsPerPosition: 2,
  entryLookback: 55,
  exitLookback: 20,
  stopMultipleN: 2,
  pyramidStepN: 0.5,
  maxTotalRiskPct: 12,
  positionValueCapPct: 25,
  drawdownScalingEnabled: true,
  autoGenerateQueue: false, // opt-in — 사용자가 실행 큐 설정 패널에서 명시적으로 켜야 함
};

// ── 엔진 산출물(주문안) 타입 — Phase 2 실행 큐가 ActionItem으로 변환 ──

export type EntryRejectReason =
  | 'no-n'               // N 미산출 (OHLC 부족) — fail-closed
  | 'no-breakout'        // 55일 최고가 미돌파
  | 'zero-qty'           // 사이징 결과 0주 (예산/변동성 대비 과소)
  | 'insufficient-budget'// 위성 예산 잔여로 1유닛도 못 삼
  | 'risk-limit';        // 동시 전멸 한도(12%) 초과

export interface TurtleUnitSize {
  riskAmount: number;      // 사이징 리스크 금액 = 위성예산 × riskPerUnitPct% (KRW)
  unitsExact: number;      // 라운딩 전 수량
  units: number;           // 최종 수량 (정수 내림 또는 소수 허용)
  positionValueKRW: number;// units × price(원통화) × fxRate × dollarPerPoint (KRW)
  capped: boolean;         // positionValueCapPct 상한(KRW)에 걸렸는지
}

export interface TurtleEntryProposal {
  ticker: string;
  name: string;
  quantity: number;
  refPrice: number;        // 돌파 시점 기준가 (원통화)
  stopPrice: number;       // 진입가 − stopMultipleN×N (원통화 — 실제 주문 가격, 환율 불변)
  nAtEntry: number;        // 종목 통화 기준 N
  donchianHigh: number;    // 돌파한 55일 최고가 (원통화)
  riskKRW: number;         // 이 포지션 손절 시 손실 (KRW, fxRate 적용됨)
  positionValueKRW: number;// 매수금액 (KRW)
  capped: boolean;
  fxRateUsed: number;      // 사이징에 사용한 환율 (KRW/종목통화). Phase 2가 fxRateAtFill로 저장 (D6)
}

export interface TurtleEntryDecision {
  ok: boolean;
  reason?: EntryRejectReason;
  proposal?: TurtleEntryProposal;
}

export interface TurtlePyramidProposal {
  positionId: string;
  ticker: string;
  name: string;
  quantity: number;        // 추가 유닛 수량
  refPrice: number;        // 트리거 가격 (≥ 마지막 체결가 + pyramidStepN×N)
  newStopPrice: number;    // 피라미딩 후 전체 손절가 (refPrice − stopMultipleN×N)
  nAtFill: number;
  unitIndex: number;       // 몇 번째 유닛인지 (0-based)
}

export interface TurtleSellProposal {
  positionId: string;
  ticker: string;
  name: string;
  quantity: number;        // 전량
  refPrice: number;
  reason: 'stop' | 'channel-exit';
  triggerPrice: number;    // 손절가 또는 20일 최저가
}

export interface TurtleTotalRisk {
  riskKRW: number;         // 전 포지션 동시 손절 시 손실 합 (음수 미포함, 포지션별 max(0,·))
  riskPct: number;         // riskKRW / satelliteBudgetKRW × 100
}
