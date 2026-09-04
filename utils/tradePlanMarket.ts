// utils/tradePlanMarket.ts
// ---------------------------------------------------------------------------
// 매매 계획(TradePlan)을 "앱 상태"(자산/관심종목/enriched 지표/환율/시세 기준시각)에
// 연결하는 순수 어댑터 레이어. `utils/tradePlan.ts`(도메인 로직)는 앱을 모르고,
// `hooks/useTradePlanSignals.ts`(오케스트레이션)는 여기 함수만 호출한다.
//
// 통화 규약(RULES.md): `rates[asset.currency]`는 USD/JPY만 실제 값이 있다. KRW=1, CNY 등은
// null — 여기서 `|| 0`으로 뭉개지 않는다(계획 저장에 0원 환산이 새어 들어가면 안 됨).
//
// side effect 금지 — `now`/`priceDataAsOf`는 전부 호출부(훅·액션)가 주입한다(Date.now 금지).

import { Currency } from '../types';
import type { Asset, ExchangeRates, WatchlistItem } from '../types';
import { isBaseType } from '../types/category';
import { isMarketOpen, lastSessionDate, type MarketId } from './marketHours';
import { marketIdForExchange } from './holdingMarkets';
import { localDateString } from './localDate';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';
import { DEFAULT_TRADE_PLAN_TEMPLATE, PLAN_ADVERSE_GAP_PCT } from '../types/tradePlan';
import { heldUnits } from './tradePlan';
import type {
  ExitLinePeriod,
  PlanTier,
  TradePlan,
  TradePlanAnchor,
  TradePlanBuildInput,
  TradePlanEvaluation,
  TradePlanMarket,
} from '../types/tradePlan';

// ═══════════════════════════════════════════════════════════════════════════
// 환율
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 통화 → KRW 환산 환율. KRW=1, USD/JPY는 `rates`에 값이 있을 때만(0 이하는 무효),
 * 그 외(CNY 등)는 항상 null — 호출부가 "환율 없음"을 명시적으로 다루게 한다(`|| 0` 금지).
 */
export function fxRateToKRWFor(currency: Currency, rates: ExchangeRates): number | null {
  if (currency === Currency.KRW) return 1;
  if (currency === Currency.USD) return typeof rates.USD === 'number' && rates.USD > 0 ? rates.USD : null;
  if (currency === Currency.JPY) return typeof rates.JPY === 'number' && rates.JPY > 0 ? rates.JPY : null;
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 시장 데이터 조립
// ═══════════════════════════════════════════════════════════════════════════

export interface BuildTradePlanMarketInput {
  /** 원통화 현재가(`Asset.priceOriginal`/`WatchlistItem.priceOriginal`). 0 이하면 시세 없음으로 취급. */
  priceOriginal: number;
  exchange: string;
  enriched: EnrichedIndicatorData | undefined;
  /** `derived.priceDataAsOf` — 마지막 시세 갱신 완료 시각(ISO). 아직 한 번도 갱신 안 했으면 null. */
  priceDataAsOf: string | null;
  /** 판정 기준 시각(ISO) — 호출부가 주입. */
  now: string;
}

/**
 * 자산/관심종목 하나를 `TradePlanMarket`으로 변환한다.
 *   · priceAsOf: priceDataAsOf가 있으면 그 로컬 날짜, 없으면(한 번도 안 갱신) 세션일로
 *     간주한다("기준시각 기록이 없으면 지금 세션 시세로 가정" — evaluateTradePlan의 stale 판정은
 *     `priceAsOf < sessionDate`이므로, 이 폴백은 최초 1회 stale 오탐을 막기 위함이다).
 *   · isIntraday: priceDataAsOf가 없으면 장중 여부를 판정할 근거가 없으므로 false(확정 종가로 간주).
 */
export function buildTradePlanMarket(input: BuildTradePlanMarketInput): TradePlanMarket {
  const market: MarketId = marketIdForExchange(input.exchange);
  const sessionDate = lastSessionDate(market, input.now);
  const priceAsOf = input.priceDataAsOf ? localDateString(new Date(input.priceDataAsOf)) : sessionDate;
  const isIntraday = input.priceDataAsOf ? isMarketOpen(market, input.priceDataAsOf) : false;
  const ma: Partial<Record<ExitLinePeriod, number | null>> = {
    10: input.enriched?.ma[10] ?? null,
    20: input.enriched?.ma[20] ?? null,
    50: input.enriched?.ma[50] ?? null,
  };
  return {
    price: input.priceOriginal > 0 ? input.priceOriginal : null,
    priceAsOf,
    isIntraday,
    sessionDate,
    ma,
    maAsOf: sessionDate,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 신호 요약(오늘 화면 배지·카톡 일일 요약 공용 재료)
// ═══════════════════════════════════════════════════════════════════════════

export interface TradePlanSignalSummary {
  urgent: number;
  today: number;
  prepare: number;
  /** 시세 결측(unavailable)으로 판정 불가한 계획 수 */
  unavailable: number;
  /** 시세가 오래되어(stale) 확인이 필요한 계획 수 */
  stale: number;
  /** 증권사 손절 예약주문 미등록 계획 수 */
  brokerStopMissing: number;
}

export interface TradePlanSignalRowLike {
  evaluation: TradePlanEvaluation;
  plan: Pick<TradePlan, 'brokerStopOrderRegistered'>;
}

const EMPTY_SUMMARY: TradePlanSignalSummary = {
  urgent: 0, today: 0, prepare: 0, unavailable: 0, stale: 0, brokerStopMissing: 0,
};

/** 신호 행 배열 → 등급별 건수 + 확인 필요 건수. 활성 계획만 넘어온다는 전제(호출부 필터 책임). */
export function summarizeTradePlanSignals(rows: TradePlanSignalRowLike[]): TradePlanSignalSummary {
  const summary: TradePlanSignalSummary = { ...EMPTY_SUMMARY };
  for (const row of rows) {
    const tier: PlanTier = row.evaluation.tier;
    if (tier === 'urgent') summary.urgent++;
    else if (tier === 'today') summary.today++;
    else if (tier === 'prepare') summary.prepare++;
    if (row.evaluation.signal === 'unavailable') summary.unavailable++;
    if (row.evaluation.stale) summary.stale++;
    if (!row.plan.brokerStopOrderRegistered) summary.brokerStopMissing++;
  }
  return summary;
}

// ═══════════════════════════════════════════════════════════════════════════
// 편집기 기본값
// ═══════════════════════════════════════════════════════════════════════════

/** `defaultEditorInput`의 대상 — 보유 자산(holding) / 관심종목(new-buy) 판별을 명시적으로 받는다(덕 타이핑 금지). */
export type TradePlanTarget =
  | { kind: 'asset'; asset: Asset }
  | { kind: 'watch'; item: WatchlistItem };

export interface DefaultEditorInputOptions {
  totalEquityKRW: number;
  rates: ExchangeRates;
  enriched: EnrichedIndicatorData | undefined;
  /** ISO 시각 — 순수 함수라 주입한다. */
  now: string;
  anchor: TradePlanAnchor;
}

/**
 * 편집기 초기값 — `DEFAULT_TRADE_PLAN_TEMPLATE`(강의 기본값: 1%·7%·3배·20일선·불타기 안 함)로
 * 채운 `TradePlanBuildInput`. 보유 자산은 mode='holding'(수량 고정), 관심종목은 mode='new-buy'.
 * 추세선 무장 기본값 판정을 위해 `currentExitLineValue`에 오늘 MA20을 싣는다(buildTradePlan이
 * 기준가 < 추세선이면 'after-reclaim'을 자동 선택).
 */
export function defaultEditorInput(target: TradePlanTarget, opts: DefaultEditorInputOptions): TradePlanBuildInput {
  const { totalEquityKRW, rates, enriched, now, anchor } = opts;

  const currency: Currency = target.kind === 'asset' ? target.asset.currency : (target.item.currency ?? Currency.KRW);
  const priceOriginal = target.kind === 'asset'
    ? target.asset.priceOriginal
    : (target.item.priceOriginal ?? target.item.currentPrice ?? 0);
  const purchasePrice = target.kind === 'asset' ? target.asset.purchasePrice : priceOriginal;
  const categoryId = target.kind === 'asset' ? target.asset.categoryId : target.item.categoryId;

  const anchorPrice = anchor === 'purchase' ? purchasePrice : priceOriginal;
  const anchorDate = localDateString(new Date(now));
  const currentExitLineValue = enriched?.ma[20] ?? null;

  return {
    mode: target.kind === 'asset' ? 'holding' : 'new-buy',
    anchor,
    anchorPrice,
    anchorDate,
    currency,
    totalEquityKRW,
    riskPct: DEFAULT_TRADE_PLAN_TEMPLATE.riskPct,
    stopPct: DEFAULT_TRADE_PLAN_TEMPLATE.stopPct,
    profitMultiple: DEFAULT_TRADE_PLAN_TEMPLATE.profitMultiple,
    exitLine: DEFAULT_TRADE_PLAN_TEMPLATE.exitLine,
    currentExitLineValue,
    pyramid: { ...DEFAULT_TRADE_PLAN_TEMPLATE.pyramid },
    holdingQuantity: target.kind === 'asset' ? target.asset.quantity : undefined,
    fxRateToKRW: fxRateToKRWFor(currency, rates),
    allowFractional: isBaseType(categoryId, 'CRYPTOCURRENCY'),
    now,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 카드 표시용 손실 추정 (TradePlanCard 렌더 전용 — 계산은 여기, 컴포넌트는 표시만)
// ═══════════════════════════════════════════════════════════════════════════

export interface TradePlanLossEstimate {
  /** 현재 보유 유닛 합계 수량(원 진입분 − 절반 익절분 + 체결된 불타기분) */
  remainingQuantity: number;
  /** 손절선 체결 시 예상 손실(KRW, 음수). 환율 없으면 null */
  worstLossKRW: number | null;
  /** 총자산 대비 % (음수). 환율 없으면 null */
  worstLossPct: number | null;
  /** 갭 하락(손절선 −3%) 체결 가정 손실(KRW, 음수). 환율 없으면 null */
  adverseLossKRW: number | null;
}

/**
 * 계획 카드의 "예상 손실 / 갭 손실" 표시값 — `buildTradePlan`의 preview 공식(수량×(가격−손절선)×환율)을
 * **현재 보유 유닛**(불타기 체결 반영)에 그대로 적용한다. `TradePlan`은 preview 스냅샷을 들고
 * 있지 않으므로(체결/절반매도로 계속 바뀜) 표시 시점에 재계산한다.
 */
export function estimateTradePlanStopLoss(plan: TradePlan, fxRateToKRW: number | null): TradePlanLossEstimate {
  const units = heldUnits(plan);
  const remainingQuantity = units.reduce((s, u) => s + u.quantity, 0);
  if (fxRateToKRW === null || fxRateToKRW <= 0) {
    return { remainingQuantity, worstLossKRW: null, worstLossPct: null, adverseLossKRW: null };
  }
  const worstLossOriginal = -units.reduce((s, u) => s + u.quantity * (u.price - plan.stopPrice), 0);
  const worstLossKRW = worstLossOriginal * fxRateToKRW;
  const worstLossPct = plan.totalEquityKRW > 0 ? (worstLossKRW / plan.totalEquityKRW) * 100 : null;
  const adverseFill = plan.stopPrice * (1 - PLAN_ADVERSE_GAP_PCT / 100);
  const adverseLossOriginal = -units.reduce((s, u) => s + u.quantity * (u.price - adverseFill), 0);
  const adverseLossKRW = adverseLossOriginal * fxRateToKRW;
  return { remainingQuantity, worstLossKRW, worstLossPct, adverseLossKRW };
}
