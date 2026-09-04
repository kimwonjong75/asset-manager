// types/tradePlan.ts
// ---------------------------------------------------------------------------
// 매매 계획(TradePlan) — "사기 전에 언제 팔지 정한다"를 자산 단위로 저장하는 약속 카드.
//
// 원전: 강의 템플릿(총자산·종목당 최대손실 1%·손절폭 7%·익절=손절폭 3배에서 절반·나머지 추세선 이탈 시
//       전량·불타기 옵션) + 연구 엔진 scripts/backtest/coreStopLoss/lib/sellRuleEngine.ts(동일 규칙의
//       백테스트 구현). 계획서: .claude/plans (2026-09-03 승인) §3.
//
// 설계 원칙:
//   · 터틀(N 기반 절대가격) 엔진과 **독립**된 %·R 기반 도메인. turtleLock 과 무관하게 동작한다.
//   · 가격은 종목 원통화(priceOriginal 규약), 돈(KRW)은 환율이 있을 때만 계산 — 미지원 통화(CNY)는 null.
//   · 계획 상태는 사용자의 명시적 행동(매도/추가매수 기록 커밋, 결정 버튼, 편집기)으로만 바뀐다.
//   · 저장은 Asset.tradePlan / WatchlistItem.tradePlan 중첩 optional — 기본값 강제 주입 금지(미지정=계획 없음).
//   · 불타기는 기본 OFF. 트리거는 항상 기준가 위 → 물타기가 구조적으로 불가능하다.

import type { Currency } from './index';

/** 신규 매수 계획(수량 산출) / 보유 종목 계획(수량 고정). */
export type TradePlanMode = 'new-buy' | 'holding';

/** 기준가 출처. today=오늘 가격(기본), purchase=평균 매수가, custom=직접 입력. */
export type TradePlanAnchor = 'today' | 'purchase' | 'custom';

export type ExitLinePeriod = 10 | 20 | 50;

/** 마지막 매도선(추세선): 이동평균 또는 직접 가격. */
export type TradePlanExitLine =
  | { kind: 'ma'; period: ExitLinePeriod }
  | { kind: 'price'; price: number };

/**
 * 추세선 적용 방식. 'after-reclaim'은 계획 시점에 이미 선 아래일 때 기본값 —
 * 종가가 선 위로 올라온 뒤(exitLineArmedAt)부터 이탈을 판정한다(첫날 대량 '긴급' 방지).
 */
export type ExitLineArmMode = 'immediate' | 'after-reclaim';

/** 불타기 간격 단위. pct=기준가 대비 %(전략2: +10%씩), r=손절폭 배수(전략1: +2R씩). */
export type PyramidStepUnit = 'pct' | 'r';
/** 불타기 투입 크기. same=최초와 같은 금액, half=단계마다 절반. */
export type PyramidSizing = 'same' | 'half';
export type PyramidLevel = 1 | 2 | 3;

/** 실제 체결 기록(매도/추가매수 기록 커밋에서만 채운다). */
export interface PlanFill {
  date: string;       // YYYY-MM-DD
  price: number;      // 원통화
  quantity: number;
  sellRecordId?: string;
}

export interface TradePlanPyramidStep {
  level: PyramidLevel;
  triggerPrice: number;     // 원통화. 항상 기준가보다 높다.
  plannedQuantity: number;  // 1% 총손실·2×원투입·총자산 25% 상한으로 캡된 수량
  fill?: PlanFill;
}

export interface TradePlanPyramidConfig {
  enabled: boolean;
  stepUnit: PyramidStepUnit;
  step: number;             // pct면 10(=10%), r이면 2(=2R)
  sizing: PyramidSizing;
  maxAdds: PyramidLevel;
  steps: TradePlanPyramidStep[];
}

/** 평가 신호. unavailable=판정 불가(데이터 결측), stale=시세가 세션일보다 오래됨. */
export type PlanSignal =
  | 'stop-hit'
  | 'take-profit-hit'
  | 'pyramid-hit'
  | 'exit-line-hit'
  | 'exit-line-watch'
  | 'near-stop'
  | 'near-pyramid'
  | 'waiting'
  | 'already-below-stop'
  | 'already-below-exit'
  | 'unavailable'
  | 'stale';

export type PlanDecisionChoice = 'done' | 'skip' | 'tomorrow';

/** 매도 기록이 계획에 미치는 효과. half=절반 익절, stop/exit=계획 종료, none=계획과 무관(기록만). */
export type SellOutcome = 'half' | 'stop' | 'exit' | 'none';

/** 사용자의 명시적 결정 기록(실행/건너뜀/내일). */
export interface PlanDecision {
  date: string;
  signal: PlanSignal;
  choice: PlanDecisionChoice;
  reason?: string;
}

export type TradePlanStatus = 'active' | 'closed';
export type TradePlanCloseReason = 'stop' | 'exit-line' | 'manual';

export interface TradePlan {
  version: 1;
  mode: TradePlanMode;
  createdAt: string;        // ISO
  updatedAt: string;        // ISO
  anchor: TradePlanAnchor;
  anchorPrice: number;      // 원통화 기준가
  anchorDate: string;       // YYYY-MM-DD
  currency: Currency;
  totalEquityKRW: number;   // 계획 당시 총자산(KRW)
  riskPct: number;          // 종목당 최대손실 % (총자산 대비)
  stopPct: number;          // 손절폭 %
  stopPrice: number;        // 원통화. 불타기 체결 후 상향될 수 있다(내려가지 않는다)
  profitMultiple: 2 | 3 | 4 | null;
  takeProfitPrice: number | null;   // 익절선(절반 매도). null=익절 없음
  exitLine: TradePlanExitLine;
  exitLineArmMode: ExitLineArmMode;
  exitLineArmedAt?: string;         // YYYY-MM-DD. after-reclaim 에서 종가가 선 위로 올라온 날(명시 저장)
  pyramid: TradePlanPyramidConfig;
  plannedQuantity: number;          // new-buy: 산출 수량 / holding: 계획 당시 보유수량
  brokerStopOrderRegistered: boolean;
  halfSold?: PlanFill;
  decisions: PlanDecision[];        // 최근 PLAN_DECISION_MAX 건
  status: TradePlanStatus;
  closedReason?: TradePlanCloseReason;
  closedAt?: string;
  memo?: string;
}

// ── 평가 ────────────────────────────────────────────────────────────────

/** 행동 등급. urgent=긴급(손절·추세이탈) / today=오늘 실행(익절) / prepare=준비(근접·불타기). */
export type PlanTier = 'urgent' | 'today' | 'prepare' | 'none';

export type PlanAction = 'sell-all' | 'sell-half' | 'buy-add' | 'arm-exit' | 'check' | 'wait' | 'none';

/** 평가 입력 시장 데이터. 가격은 원통화. MA는 완료 종가 기준(당일 장중가 제외). */
export interface TradePlanMarket {
  price: number | null;
  priceAsOf: string;        // YYYY-MM-DD (가격의 기준 거래일)
  isIntraday: boolean;      // true=장중 가격, false=확정 종가
  sessionDate: string;      // YYYY-MM-DD 최근 완료(또는 진행 중) 세션일 — 이보다 오래된 가격은 stale
  ma: Partial<Record<ExitLinePeriod, number | null>>;
  maAsOf: string;           // YYYY-MM-DD
}

export type PlanLineKey = 'stop' | 'takeProfit' | 'exitLine' | 'pyramid';
export type PlanLineState = 'hit' | 'near' | 'waiting' | 'done' | 'disarmed' | 'unavailable' | 'inactive';

export interface PlanLineStatus {
  key: PlanLineKey;
  label: string;                // 손절선/익절선/추세선/불타기선
  price: number | null;         // 원통화. 추세선은 오늘 값
  distancePct: number | null;   // (현재가−선)/선 ×100. 양수=선 위
  state: PlanLineState;
  note?: string;
}

export interface TradePlanEvaluation {
  signal: PlanSignal;
  tier: PlanTier;
  action: PlanAction;
  lines: PlanLineStatus[];
  sentence: string;             // 초보자용 한 줄 행동문
  distanceToStopPct: number | null;
  stale: boolean;
}

// ── 생성 ────────────────────────────────────────────────────────────────

export interface TradePlanPyramidInput {
  enabled: boolean;
  stepUnit: PyramidStepUnit;
  step: number;
  sizing: PyramidSizing;
  maxAdds: PyramidLevel;
}

export interface TradePlanBuildInput {
  mode: TradePlanMode;
  anchor: TradePlanAnchor;
  anchorPrice: number;
  anchorDate: string;
  currency: Currency;
  totalEquityKRW: number;
  riskPct: number;
  /** 손절폭 %. stopPrice 가 주어지면 그것이 우선이고 pct 는 역산된다. */
  stopPct?: number;
  stopPrice?: number;
  profitMultiple: 2 | 3 | 4 | null;
  exitLine: TradePlanExitLine;
  exitLineArmMode?: ExitLineArmMode;
  /** 계획 시점 추세선 값(있으면 armMode 기본값 결정에 사용). */
  currentExitLineValue?: number | null;
  pyramid: TradePlanPyramidInput;
  /** holding 모드 필수 — 보유 수량. */
  holdingQuantity?: number;
  /** KRW/1단위 환율. KRW=1. 미지원 통화는 null. */
  fxRateToKRW: number | null;
  allowFractional?: boolean;
  /** ISO 시각 — 순수 함수라 주입한다(Date.now 금지). */
  now: string;
  brokerStopOrderRegistered?: boolean;
}

export interface TradePlanPreview {
  quantity: number;
  investmentKRW: number | null;
  riskAmountKRW: number;
  worstLossKRW: number | null;      // 손절선 체결 시 손실(음수)
  worstLossPct: number | null;      // 총자산 대비 %(음수)
  adverseLossKRW: number | null;    // 갭 하락(손절선 −3%) 체결 가정 손실(음수). 수수료·세금 미포함
  stopPrice: number;
  stopPct: number;
  takeProfitPrice: number | null;
  exceedsRiskBudget: boolean;       // holding 모드에서 손절 손실이 허용손실을 넘는가
  capped: boolean;                  // new-buy 사이징이 총자산 캡에 걸렸는가
}

export type TradePlanBuildError =
  | 'invalid-anchor'
  | 'invalid-stop'
  | 'invalid-equity'
  | 'invalid-risk'
  | 'unsupported-currency'
  | 'invalid-quantity';

export type TradePlanBuildResult =
  | { ok: true; plan: TradePlan; preview: TradePlanPreview }
  | { ok: false; reason: TradePlanBuildError };

export const TRADE_PLAN_BUILD_ERROR_LABELS: Record<TradePlanBuildError, string> = {
  'invalid-anchor': '기준가를 0보다 크게 입력하세요.',
  'invalid-stop': '손절선은 0 이상, 기준가보다 낮아야 합니다.',
  'invalid-equity': '총자산을 0보다 크게 입력하세요.',
  'invalid-risk': '최대손실 비율은 0~100% 사이여야 합니다.',
  'unsupported-currency': '이 통화는 원화 환산 환율이 없어 금액을 계산할 수 없습니다.',
  'invalid-quantity': '보유 수량이 0보다 커야 합니다.',
};

// ── 불타기 체결 ──────────────────────────────────────────────────────────

export type PyramidFillError =
  | 'pyramid-disabled'
  | 'no-step'
  | 'price-not-above-last-fill'
  | 'stop-would-fall'
  | 'risk-budget-exceeded'
  | 'cost-cap-exceeded'
  | 'position-cap-exceeded';

export type PyramidFillResult =
  | { ok: true; plan: TradePlan }
  | { ok: false; reason: PyramidFillError };

export const PYRAMID_FILL_ERROR_LABELS: Record<PyramidFillError, string> = {
  'pyramid-disabled': '이 계획은 불타기를 쓰지 않습니다.',
  'no-step': '남은 불타기 단계가 없습니다.',
  'price-not-above-last-fill': '마지막 체결가보다 높은 가격에서만 추가매수합니다(물타기 금지).',
  'stop-would-fall': '추가매수 후 손절선이 내려가면 안 됩니다.',
  'risk-budget-exceeded': '추가매수 후 손절 시 손실이 허용손실(총자산 대비)을 넘습니다.',
  'cost-cap-exceeded': '총 투입이 최초 투입의 2배를 넘습니다.',
  'position-cap-exceeded': '이 종목 비중이 총자산의 25%를 넘습니다.',
};

// ── 상수 ────────────────────────────────────────────────────────────────

export const PLAN_LINE_LABELS: Record<PlanLineKey, string> = {
  stop: '손절선',
  takeProfit: '익절선',
  exitLine: '추세선',
  pyramid: '불타기선',
};

export const PLAN_TIER_LABELS: Record<PlanTier, string> = {
  urgent: '긴급',
  today: '오늘 실행',
  prepare: '준비',
  none: '',
};

/** 결정 기록 보관 상한(최근순). */
export const PLAN_DECISION_MAX = 30;

/** 근접 판정 폭(%). 손절선 위 2% 이내 / 다음 불타기선 아래 2% 이내 → '준비'. */
export const PLAN_NEAR_PCT = 2;

/** 갭 하락 체결 가정(손절선 대비 −3%). 수수료·세금은 미포함. */
export const PLAN_ADVERSE_GAP_PCT = 3;

/** 불타기 총투입 상한 = 최초 투입 × 2. */
export const PYRAMID_COST_CAP_MULTIPLE = 2;

/** 한 종목 총액 상한 = 총자산 × 25%. */
export const PYRAMID_POSITION_CAP_PCT = 25;

/** 강의 기본값(스크린샷 디폴트): 1% · 7% · 3배 · 20일선 · 불타기 안 함. */
export const DEFAULT_TRADE_PLAN_TEMPLATE: {
  riskPct: number;
  stopPct: number;
  profitMultiple: 2 | 3 | 4 | null;
  exitLine: TradePlanExitLine;
  pyramid: TradePlanPyramidInput;
} = {
  riskPct: 1,
  stopPct: 7,
  profitMultiple: 3,
  exitLine: { kind: 'ma', period: 20 },
  pyramid: { enabled: false, stepUnit: 'pct', step: 10, sizing: 'half', maxAdds: 3 },
};
