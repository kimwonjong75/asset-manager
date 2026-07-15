// scripts/backtest/conditionalChannel/simulator.ts
// ---------------------------------------------------------------------------
// 조건부 돌파 채널 가설(PROMPT_3 §9·§10·§11) — 신호·체결·포지션·비용 순수 엔진.
//
// 핵심 설계(스펙 대비 명시적 선택):
//   · 신호는 종목별 실제 거래일 바 배열의 인덱스 룩백으로 계산한다(§9-1). 합집합 달력 행 수를
//     20/55로 세지 않는다 — 포트폴리오 자본 배분의 "순서"에만 합집합 달력을 쓴다.
//   · 진입 채널은 현재 바 제외(§9-2), 신호는 close[t] > H_N(t) 엄격 부등호('>=' 금지).
//   · 1차 체결은 종가 확인 후 다음 실제 거래일 t+1 시가(§9-4). 종목별 바 배열은 실제 거래일만
//     담으므로 t+1 인덱스 = 첫 거래 재개일(거래정지 갭 자동 처리, §9-5).
//   · 보호 손절은 장중 즉시(같은 날) 체결: 시가가 손절가보다 불리(≤)면 시가, 장중 저가만
//     손절가 통과면 손절가+슬리피지(§9-8). 채널 청산은 종가 확인 후 익일 시가.
//   · 같은 날 손절과 채널청산이 동시 성립하면 손절을 먼저 적용한다(가장 보수적 손익 순서, §9-8) —
//     손절은 같은 날 더 낮은 가격에 나가고 채널청산은 익일 시가라 손절이 손익상 열위이기 때문.
//   · ATR/손절 수식은 utils(calculateATR)·utils/turtleEngine 규약을 재사용한다(§9-7).
//     calculateATR의 워밍업 null 지속 버그를 피하려 firstValidIndex부터 슬라이스한다
//     (satelliteTurtle.ts와 동일 우회, 앱 코드 무수정).
//
// 규칙: `any` 금지, `console.*` 금지(순수 로직), 외부 I/O 없음, Math.random 없음(결정론).
// ---------------------------------------------------------------------------

import { calculateATR } from '../../../utils/maCalculations';
import { calculateDonchianHigh, calculateDonchianLow } from '../../../utils/donchianChannel';
import { firstValidIndex } from '../lib/calendar';
import { resolveFrozenClassification } from './classifier';
import type {
  ConditionalExitReason,
  ConditionalTradeRecord,
  CorporateActionRecord,
  CostModelParams,
  CostTier,
  EntrySignalRecord,
  ExclusionRecord,
  IsoDate,
  LedgerCurrency,
  Market,
  MonthlyGroupFlags,
  OpenPositionCloseMethod,
  OrderFill,
  PositionGroup,
  SellTaxScheduleEntry,
  StrategyId,
  UnfilledReason,
  UnfilledSignalRecord,
} from '../../../types/backtestConditionalChannel';

// ===========================================================================
// 0. 종목별 바 배열 (실제 거래일만 — 합집합 달력 carry-forward 금지, §9-1)
// ===========================================================================

/** 한 종목의 실제 거래일 OHLCV 시계열(날짜 오름차순, split-adjusted). */
export interface SecurityBars {
  securityId: string;
  symbol: string;
  market: Market;
  currency: LedgerCurrency;
  dates: IsoDate[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

// ===========================================================================
// 1. 신호 — 돈치안 채널(현재 바 제외, §9-2). utils/donchianChannel 재사용.
// ===========================================================================

/**
 * H_N(t) = max(high[t-N..t-1]) — 현재 바(t) 제외 이전 N일 최고가(§9-2).
 * 선행 바가 부족하면(t < N) 가용 범위 최고가, 전무하면 null.
 */
export function entryChannelHigh(
  bars: SecurityBars,
  t: number,
  lookback: number
): number | null {
  if (t <= 0) return null;
  return calculateDonchianHigh(bars.high.slice(0, t + 1), lookback, { excludeToday: true });
}

/** 20일 청산 저가 채널 L_N(t) = min(low[t-N..t-1]) — 현재 바 제외(§9-6). */
export function exitChannelLow(
  bars: SecurityBars,
  t: number,
  lookback: number
): number | null {
  if (t <= 0) return null;
  return calculateDonchianLow(bars.low.slice(0, t + 1), lookback, { excludeToday: true });
}

/** 진입 신호: close[t] > H_N(t) 엄격 부등호(§9-2). 채널 null이면 신호 없음. */
export function isEntrySignal(bars: SecurityBars, t: number, lookback: number): boolean {
  const h = entryChannelHigh(bars, t, lookback);
  if (h === null) return false;
  return bars.close[t] > h; // '>=' 금지
}

/** 청산 신호: close[t] < L_N(t) — 20일 저가 하향 돌파(§9-6). */
export function isChannelExitSignal(
  bars: SecurityBars,
  t: number,
  exitLookback: number
): boolean {
  const l = exitChannelLow(bars, t, exitLookback);
  if (l === null) return false;
  return bars.close[t] < l;
}

// ===========================================================================
// 2. ATR 워밍업 · 공통/자연 시작 게이팅 (§7·§9-3)
// ===========================================================================

/**
 * ATR(atrLookback) 시계열. firstValidIndex부터 슬라이스해 calculateATR의 워밍업 null-지속
 * 버그를 우회한다(satelliteTurtle.ts와 동일 우회). 반환 길이는 bars와 동일(앞부분 null).
 */
export function atrSeries(bars: SecurityBars, atrLookback: number): (number | null)[] {
  const start = Math.max(0, firstValidIndex(bars.close));
  const sliced = calculateATR(
    bars.high.slice(start),
    bars.low.slice(start),
    bars.close.slice(start),
    atrLookback
  );
  const out: (number | null)[] = new Array<number | null>(bars.close.length).fill(null);
  for (let i = 0; i < sliced.length; i++) out[start + i] = sliced[i];
  return out;
}

/** ATR이 처음으로 유효(non-null)해지는 인덱스. 전부 null이면 배열 길이(=영원히 미준비). */
export function firstAtrReadyIndex(bars: SecurityBars, atrLookback: number): number {
  const atr = atrSeries(bars, atrLookback);
  for (let i = 0; i < atr.length; i++) {
    if (atr[i] !== null) return i;
  }
  return atr.length;
}

/**
 * 공통 시작 인덱스(§9-3): 20/55 공정 비교를 위해 양쪽 모두 ≥commonStartBars 선행 바 +
 * ATR 준비가 끝난 인덱스부터 신호 가능. = max(commonStartBars, firstAtrReadyIndex).
 * (인덱스 t에서 선행 바 수 = t이므로 t ≥ commonStartBars 필요.)
 */
export function commonStartIndex(
  bars: SecurityBars,
  atrLookback: number,
  commonStartBars: number
): number {
  return Math.max(commonStartBars, firstAtrReadyIndex(bars, atrLookback));
}

/**
 * 자연 시작 인덱스(§9-3 민감도): 20일 전략이 자기 진입 룩백만 채우면 되는 시작.
 * = max(entryLookback, firstAtrReadyIndex). 1차 결과와 섞지 않고 민감도로만 사용.
 */
export function naturalStartIndex(
  bars: SecurityBars,
  atrLookback: number,
  entryLookback: number
): number {
  return Math.max(entryLookback, firstAtrReadyIndex(bars, atrLookback));
}

// ===========================================================================
// 3. 체결 인덱스 해석 (§9-4·5, 지연 스트레스 §12.3)
// ===========================================================================

/**
 * 신호일 signalIndex의 종가 확인 후 fillDelayDays(1차=1)만큼 뒤의 실제 거래일 인덱스.
 * 종목별 바 배열이 실제 거래일만 담으므로 인덱스 +N = N번째 재개 거래일(거래정지 갭 이월, §9-5).
 * 존재하지 않으면 null(NO_NEXT_BAR).
 */
export function resolveFillIndex(
  bars: SecurityBars,
  signalIndex: number,
  fillDelayDays: number
): number | null {
  const idx = signalIndex + fillDelayDays;
  if (idx >= bars.dates.length) return null;
  return idx;
}

// ===========================================================================
// 4. 보호 손절 (§9-7·8) — ATR/손절 수식은 turtleEngine 규약 재사용
// ===========================================================================

/** 진입 손절가 = entryFill − stopMultiple×ATR(진입 시점)(§9-7, turtleEngine과 동일 수식). */
export function computeStopPrice(
  entryFillPrice: number,
  atrAtEntry: number,
  stopMultiple: number
): number {
  return entryFillPrice - stopMultiple * atrAtEntry;
}

export interface StopFillResult {
  hit: boolean;
  /** 체결가(§9-8). 갭하락(시가 ≤ 손절가)이면 시가, 장중 저가만 통과면 손절가+슬리피지. */
  price: number;
  /** 어떤 경로로 체결됐는지(감사용). */
  path: 'GAP_OPEN' | 'INTRADAY_STOP' | 'NONE';
}

/**
 * 손절 체결 판정(§9-8, 롱 포지션). slippageFrac은 손절가에 곱해 더하는 비율(예: 0.001).
 *   · 시가 ≤ 손절가(갭하락, 시가가 손절가보다 불리) → 시가 체결(더 나쁜 가격 반영).
 *   · 시가 > 손절가지만 장중 저가 ≤ 손절가 → 손절가 + 슬리피지 체결.
 *   · 그 외 → 미발동.
 */
export function stopFill(
  open: number,
  low: number,
  stopPrice: number,
  slippageFrac: number
): StopFillResult {
  if (open <= stopPrice) {
    return { hit: true, price: open, path: 'GAP_OPEN' };
  }
  if (low <= stopPrice) {
    return { hit: true, price: stopPrice + Math.abs(stopPrice) * slippageFrac, path: 'INTRADAY_STOP' };
  }
  return { hit: false, price: 0, path: 'NONE' };
}

// ===========================================================================
// 5. 비용 모형 (§11) — 티어(ZERO/BASE/DOUBLE)와 한국 매도세
// ===========================================================================

/**
 * 시점 date에 유효한 매도세율(bps)(§11: 시행일별, 오늘 세율 소급 금지). 없으면 0.
 */
export function resolveSellTaxBps(
  schedule: readonly SellTaxScheduleEntry[],
  date: IsoDate
): number {
  for (const e of schedule) {
    if (e.effectiveFrom > date) continue;
    if (e.effectiveTo !== null && e.effectiveTo < date) continue;
    return e.taxBps;
  }
  return 0;
}

/**
 * 티어별 비용 배수(§11). ZERO=0(비용 없음 스트레스), BASE=1, DOUBLE=2.
 * ⚠ 이 배수는 수수료·스프레드·슬리피지·시장충격에만 곱한다. 매도세(tax)는 실제 법정 부담이라
 *    티어와 무관하게 항상 실세율로 적용한다(ZERO 티어에서도 세금은 살아있음). — 설계 선택, §11.
 */
export function costTierMultiplier(tier: CostTier): number {
  return tier === 'ZERO' ? 0 : tier === 'DOUBLE' ? 2 : 1;
}

/**
 * 한 체결의 총 비용(종목 통화, 양수)(§11). 매수·매도 양방향.
 *   variable = notional × (commission+spread+slippage+impact)bps × tierMult
 *   sell tax = (side==='SELL') ? notional × taxBps(그 시점) : 0   ← 티어 배수 미적용(항상 실세율)
 */
export function tradeCost(
  notional: number,
  params: CostModelParams,
  tier: CostTier,
  side: 'BUY' | 'SELL',
  date: IsoDate
): number {
  const mult = costTierMultiplier(tier);
  const variableBps =
    (params.commissionBps + params.spreadBps + params.slippageBps + params.marketImpactBps) * mult;
  let cost = (notional * variableBps) / 10_000;
  if (side === 'SELL') {
    const taxBps = resolveSellTaxBps(params.sellTaxSchedule, date);
    cost += (notional * taxBps) / 10_000; // 세금은 티어 무관 실세율
  }
  return cost;
}

// ===========================================================================
// 6. 포지션 사이징 · 위험 (§10)
// ===========================================================================

export interface SizingParams {
  equity: number;          // 계좌 자산(종목 통화 원장 기준)
  riskPerTradePct: number; // 0.5
  singleNameValueCapPct: number; // 25
  entryPrice: number;      // 진입 체결가
  stopPrice: number;       // 손절가
}

export interface SizingResult {
  shares: number;          // 정수(내림, §10)
  riskAmount: number;      // shares × 손절폭
  notional: number;        // shares × entryPrice
  capped: boolean;         // 단일 종목 평가액 한도(25%)로 축소됐는가
}

/**
 * 0.5% 위험 사이징(§10): 목표위험 = equity×riskPct, 손절폭 = entryPrice−stopPrice,
 * shares = floor(목표위험 / 손절폭). 단일 종목 평가액 한도(25%) 초과 시 축소. 잔여현금 보유(피라미딩 없음).
 */
export function positionSize(p: SizingParams): SizingResult {
  const stopDistance = p.entryPrice - p.stopPrice;
  const empty: SizingResult = { shares: 0, riskAmount: 0, notional: 0, capped: false };
  if (!(stopDistance > 0) || !(p.entryPrice > 0) || !(p.equity > 0)) return empty;

  const targetRisk = p.equity * (p.riskPerTradePct / 100);
  let shares = Math.floor(targetRisk / stopDistance);

  let capped = false;
  if (p.singleNameValueCapPct > 0) {
    const capValue = p.equity * (p.singleNameValueCapPct / 100);
    if (shares * p.entryPrice > capValue) {
      capped = true;
      shares = Math.floor(capValue / p.entryPrice);
    }
  }
  if (shares <= 0) return empty;
  return {
    shares,
    riskAmount: shares * stopDistance,
    notional: shares * p.entryPrice,
    capped,
  };
}

// ===========================================================================
// 7. 같은 날 다중 신호 비례 배분 (§10 — 선착순 금지)
// ===========================================================================

export interface RiskCandidate {
  securityId: string;
  desiredRisk: number;        // 후보가 원하는 위험액(0.5% 사이징 결과)
  stopDistancePerShare: number;
  price: number;
}

/**
 * 같은 날 신호가 가용 위험 한도를 넘으면 배열 순서로 선착순 체결하지 않고, 가용 위험을
 * 후보들에게 desiredRisk 비례로 배분한다(§10). 결정론적(securityId ASC로 순회).
 *
 * @returns securityId → 배분된 위험액(정수 주식 내림은 호출부가 stopDistancePerShare로 수행).
 */
export function proRataRiskAllocation(
  candidates: readonly RiskCandidate[],
  availableRisk: number
): Map<string, number> {
  const sorted = [...candidates].sort((a, b) =>
    a.securityId < b.securityId ? -1 : a.securityId > b.securityId ? 1 : 0
  );
  const totalDesired = sorted.reduce((s, c) => s + Math.max(0, c.desiredRisk), 0);
  const out = new Map<string, number>();
  if (totalDesired <= 0) {
    for (const c of sorted) out.set(c.securityId, 0);
    return out;
  }
  if (totalDesired <= availableRisk) {
    for (const c of sorted) out.set(c.securityId, Math.max(0, c.desiredRisk));
    return out;
  }
  const factor = availableRisk / totalDesired; // < 1
  for (const c of sorted) out.set(c.securityId, Math.max(0, c.desiredRisk) * factor);
  return out;
}

// ===========================================================================
// 8. ADV 수용 가능 규모 (§11) — 순수 술어 + 처리 선택(reject-to-UnfilledSignalRecord)
// ===========================================================================

/** 이전 lookback 거래일 중앙 거래대금(close×volume)(§11). 현재 바(t) 제외. */
export function medianDailyValue(
  bars: SecurityBars,
  t: number,
  lookback: number
): number | null {
  const end = t; // exclusive(현재 바 제외)
  const start = Math.max(0, end - lookback);
  const vals: number[] = [];
  for (let i = start; i < end; i++) {
    const p = bars.close[i];
    const v = bars.volume[i];
    if (Number.isFinite(p) && Number.isFinite(v)) vals.push(p * v);
  }
  if (vals.length === 0) return null;
  vals.sort((a, b) => a - b);
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 === 1 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

/**
 * ADV 참여 한도 술어(§11): 주문금액이 60일 중앙 거래대금의 cap(5%) 이하인가.
 * medianValue가 null(데이터 없음)이면 보수적으로 false(미체결 처리).
 * ⚠ 처리 선택: 초과 시 부분체결이 아니라 전량 미체결(reject → UnfilledSignalRecord, 사유 ADV_CAP)로
 *    단순화한다(§11 "제한 또는 미체결"에서 미체결 채택 — 부분체결 복잡도 회피). — 설계 선택.
 */
export function advParticipationOk(
  orderNotional: number,
  medianValue: number | null,
  cap: number
): boolean {
  if (medianValue === null || !(medianValue > 0)) return false;
  return orderNotional <= medianValue * cap;
}

// ===========================================================================
// 9. 상장폐지/합병 처리 (§9-10) — 임의 대체 금지
// ===========================================================================

export interface DelistingResolution {
  /** 청산 가능(대가/수익률 확인됨)인가. false면 제외 대상. */
  resolvable: boolean;
  /** 주당 청산 대가(종목 통화). resolvable=true & proceeds 방식일 때. */
  proceedsPerShare: number | null;
  /** 청산 수익률(예: -1 = 전액손실). resolvable=true & return 방식일 때. */
  delistingReturn: number | null;
}

/**
 * 상장폐지 대가 해석(§9-10). delistingProceedsPerShare 또는 delistingReturn 중 실제 확인값을 쓴다.
 * 둘 다 null(불명)이면 resolvable=false → 0/최종종가로 임의 대체하지 않고 제외한다(하드스톱 회피).
 */
export function resolveDelisting(action: CorporateActionRecord): DelistingResolution {
  if (action.type !== 'DELISTING') {
    return { resolvable: false, proceedsPerShare: null, delistingReturn: null };
  }
  if (action.delistingProceedsPerShare !== null) {
    return {
      resolvable: true,
      proceedsPerShare: action.delistingProceedsPerShare,
      delistingReturn: null,
    };
  }
  if (action.delistingReturn !== null) {
    return { resolvable: true, proceedsPerShare: null, delistingReturn: action.delistingReturn };
  }
  return { resolvable: false, proceedsPerShare: null, delistingReturn: null };
}

// ===========================================================================
// 10. 열린 포지션 종료 처리 세 방식 (§9-10) — swappable, 개별 테스트 가능
// ===========================================================================

export interface OpenPosition {
  securityId: string;
  entryFillPrice: number;
  shares: number;
  stopDistancePerShare: number; // R 계산용(entryFill − stopPrice)
  buyCost: number;              // 진입 시 지불한 비용(종목 통화)
}

export interface ClosedTradeResult {
  /** EXCLUDE_OPEN이면 excluded=true(수익률 미산출). */
  excluded: boolean;
  exitPrice: number | null;   // 청산가(MTM은 마지막 종가, FORCED는 종가)
  sellCost: number;           // 청산 비용(MARK_TO_MARKET은 0 — 미청산이므로)
  netReturn: number | null;   // 비용 차감 수익률
  rMultiple: number | null;   // R 배수
}

/**
 * 데이터 종료 시 열린 포지션 처리 세 방식(§9-10):
 *   · FORCED_CLOSE(1차): 마지막 종가에 매도 비용 반영 강제 청산.
 *   · MARK_TO_MARKET(민감도): 마지막 종가로 미실현 평가(매도 비용 없음).
 *   · EXCLUDE_OPEN(민감도): 미청산 거래 제외(수익률 미산출).
 */
export function closeOpenPosition(
  method: OpenPositionCloseMethod,
  pos: OpenPosition,
  lastClose: number,
  costParams: CostModelParams,
  tier: CostTier,
  lastDate: IsoDate
): ClosedTradeResult {
  if (method === 'EXCLUDE_OPEN') {
    return { excluded: true, exitPrice: null, sellCost: 0, netReturn: null, rMultiple: null };
  }
  const grossProceeds = pos.shares * lastClose;
  const buyNotional = pos.shares * pos.entryFillPrice;
  const sellCost =
    method === 'FORCED_CLOSE' ? tradeCost(grossProceeds, costParams, tier, 'SELL', lastDate) : 0;
  const netPnl = grossProceeds - buyNotional - sellCost - pos.buyCost;
  const netReturn = buyNotional > 0 ? netPnl / buyNotional : null;
  const riskAmount = pos.shares * pos.stopDistancePerShare;
  const rMultiple = riskAmount > 0 ? netPnl / riskAmount : null;
  return {
    excluded: false,
    exitPrice: lastClose,
    sellCost,
    netReturn,
    rMultiple,
  };
}

// ===========================================================================
// 11. 단일 종목 백테스트 (§9 신호·체결 통합) — 신호 진단용(고정 equity, 자본 미공유)
// ===========================================================================

export interface SecuritySimConfig {
  strategyId: StrategyId;
  group: PositionGroup;
  entryLookback: number;
  exitLookback: number;
  atrLookback: number;
  stopMultiple: number;
  startIndex: number;      // commonStartIndex 또는 naturalStartIndex
  fillDelayDays: number;   // 1차 = 1
  equity: number;          // 사이징 기준 자산(단일 종목 진단은 고정)
  riskPerTradePct: number;
  singleNameValueCapPct: number;
  costParams: CostModelParams;
  costTier: CostTier;
  slippageFrac: number;    // 손절 슬리피지 비율
  closeMethod: OpenPositionCloseMethod;
}

export interface SecuritySimOutput {
  trades: ConditionalTradeRecord[];
  unfilled: UnfilledSignalRecord[];
  exclusions: ExclusionRecord[];
}

/**
 * 한 종목의 전체 신호→체결→청산 시뮬레이션(신호 자체 진단용, §10: 자본 미공유 1R 결과).
 * 진입: startIndex 이후 flat 상태에서 진입 신호 → t+1 시가 체결(피라미딩 없음, 최대 1유닛).
 * 보유: 매 바 손절(장중) → 채널청산(종가확인·익일시가) → 상장폐지 순. 데이터 종료 시 closeMethod.
 * corpActions: 이 종목의 상장폐지 등(exDate에 처리).
 */
export function simulateSecurity(
  bars: SecurityBars,
  config: SecuritySimConfig,
  corpActions: readonly CorporateActionRecord[] = []
): SecuritySimOutput {
  const trades: ConditionalTradeRecord[] = [];
  const unfilled: UnfilledSignalRecord[] = [];
  const exclusions: ExclusionRecord[] = [];
  const atr = atrSeries(bars, config.atrLookback);
  const n = bars.dates.length;

  const delistingByDate = new Map<IsoDate, CorporateActionRecord>();
  for (const a of corpActions) {
    if (a.securityId === bars.securityId && a.type === 'DELISTING') delistingByDate.set(a.exDate, a);
  }

  let tradeSeq = 0;
  let t = Math.max(1, config.startIndex);

  while (t < n) {
    // ── flat: 진입 신호 탐색 ──
    if (!isEntrySignal(bars, t, config.entryLookback)) {
      t++;
      continue;
    }
    const atrAtSignal = atr[t];
    if (atrAtSignal === null || !(atrAtSignal > 0)) {
      t++;
      continue;
    }
    const signalDate = bars.dates[t];
    const channelHigh = entryChannelHigh(bars, t, config.entryLookback) as number;

    // ── 체결 인덱스(t+1 시가) ──
    const fillIdx = resolveFillIndex(bars, t, config.fillDelayDays);
    if (fillIdx === null) {
      unfilled.push(mkUnfilled(bars, config.strategyId, signalDate, 'NO_NEXT_BAR'));
      break; // 더 이상 바 없음
    }
    const entryFillPrice = bars.open[fillIdx];
    const stopPrice = computeStopPrice(entryFillPrice, atrAtSignal, config.stopMultiple);
    const stopDistance = entryFillPrice - stopPrice;

    const sizing = positionSize({
      equity: config.equity,
      riskPerTradePct: config.riskPerTradePct,
      singleNameValueCapPct: config.singleNameValueCapPct,
      entryPrice: entryFillPrice,
      stopPrice,
    });
    if (sizing.shares <= 0) {
      unfilled.push(mkUnfilled(bars, config.strategyId, signalDate, 'ZERO_SHARES'));
      t = fillIdx + 1;
      continue;
    }

    const buyCost = tradeCost(sizing.notional, config.costParams, config.costTier, 'BUY', bars.dates[fillIdx]);
    const entrySignal: EntrySignalRecord = {
      securityId: bars.securityId,
      symbol: bars.symbol,
      market: bars.market,
      strategyId: config.strategyId,
      group: config.group,
      signalDate,
      breakoutChannelHigh: channelHigh,
      signalClose: bars.close[t],
      entryLookbackUsed: config.entryLookback,
    };
    const entryFill: OrderFill = {
      securityId: bars.securityId,
      intendedDate: signalDate,
      fillDate: bars.dates[fillIdx],
      fillPrice: entryFillPrice,
      side: 'BUY',
      quantity: sizing.shares,
      slippageBps: 0,
      costTier: config.costTier,
      totalCostAmount: buyCost,
      currency: bars.currency,
    };

    // ── 보유 루프: fillIdx부터 손절 → 채널청산 → 상장폐지 ──
    let exitFill: OrderFill | null = null;
    let exitReason: ConditionalExitReason | null = null;
    let exitStopHitPrice: number | null = null;
    let excludedTrade = false;
    let h = fillIdx;

    while (h < n) {
      const date = bars.dates[h];
      // (1) 상장폐지 우선 확인 — 그 날 상장폐지면 대가로 청산 또는 제외
      const delist = delistingByDate.get(date);
      if (delist) {
        const res = resolveDelisting(delist);
        if (!res.resolvable) {
          // 임의 대체 금지 — 제외하고 ExclusionRecord 기록(§9-10)
          exclusions.push({
            securityId: bars.securityId,
            symbol: bars.symbol,
            market: bars.market,
            reason: 'delisting-proceeds-unknown(임의대체 금지 — 확증 세트 제외)',
          });
          excludedTrade = true;
          h = -1; // 사유: 제외
          break;
        }
        const exitPrice =
          res.proceedsPerShare !== null
            ? res.proceedsPerShare
            : entryFillPrice * (1 + (res.delistingReturn as number));
        exitFill = mkExitFill(bars, h, exitPrice, sizing.shares, config, 'DELISTING');
        exitReason = 'DELISTING';
        break;
      }

      // (2) 손절(장중, 같은 날) — 채널청산보다 먼저(가장 보수적 손익 순서, §9-8)
      const sf = stopFill(bars.open[h], bars.low[h], stopPrice, config.slippageFrac);
      if (sf.hit) {
        exitFill = mkExitFill(bars, h, sf.price, sizing.shares, config, 'PROTECTIVE_STOP');
        exitReason = 'PROTECTIVE_STOP';
        exitStopHitPrice = sf.price;
        break;
      }

      // (3) 채널 청산(종가 확인 → 익일 시가)
      if (isChannelExitSignal(bars, h, config.exitLookback)) {
        const exitIdx = resolveFillIndex(bars, h, config.fillDelayDays);
        if (exitIdx === null) {
          // 익일 바 없음 → 데이터 종료 처리로 넘어감(아래 close)
          break;
        }
        exitFill = mkExitFill(bars, exitIdx, bars.open[exitIdx], sizing.shares, config, 'CHANNEL_EXIT');
        exitReason = 'CHANNEL_EXIT';
        break;
      }
      h++;
    }

    if (excludedTrade) {
      t = fillIdx + 1;
      continue;
    }

    // ── 청산 완료 또는 데이터 종료 강제 처리 ──
    if (exitFill === null) {
      const closeRes = closeOpenPosition(
        config.closeMethod,
        {
          securityId: bars.securityId,
          entryFillPrice,
          shares: sizing.shares,
          stopDistancePerShare: stopDistance,
          buyCost,
        },
        bars.close[n - 1],
        config.costParams,
        config.costTier,
        bars.dates[n - 1]
      );
      if (closeRes.excluded) {
        // EXCLUDE_OPEN: 미청산 거래 제외 — 거래 로그에 남기지 않음
        t = n;
        break;
      }
      exitFill = {
        securityId: bars.securityId,
        intendedDate: bars.dates[n - 1],
        fillDate: bars.dates[n - 1],
        fillPrice: closeRes.exitPrice as number,
        side: 'SELL',
        quantity: sizing.shares,
        slippageBps: 0,
        costTier: config.costTier,
        totalCostAmount: closeRes.sellCost,
        currency: bars.currency,
      };
      exitReason = 'FORCED_CLOSE';
    }

    trades.push(
      buildTradeRecord(
        bars,
        ++tradeSeq,
        config,
        entrySignal,
        entryFill,
        stopPrice,
        atrAtSignal,
        exitFill,
        exitReason as ConditionalExitReason,
        exitStopHitPrice,
        buyCost
      )
    );

    // 다음 진입 탐색: 청산 체결일 다음 바부터
    const resumeIdx = bars.dates.indexOf(exitFill.fillDate);
    t = (resumeIdx >= 0 ? resumeIdx : fillIdx) + 1;
  }

  return { trades, unfilled, exclusions };
}

// ── 내부 헬퍼 ──────────────────────────────────────────────────────────────

function mkUnfilled(
  bars: SecurityBars,
  strategyId: StrategyId,
  signalDate: IsoDate,
  reason: UnfilledReason
): UnfilledSignalRecord {
  return {
    securityId: bars.securityId,
    symbol: bars.symbol,
    market: bars.market,
    strategyId,
    signalDate,
    reason,
    note: null,
  };
}

function mkExitFill(
  bars: SecurityBars,
  fillIdx: number,
  fillPrice: number,
  shares: number,
  config: SecuritySimConfig,
  _reason: ConditionalExitReason
): OrderFill {
  const notional = shares * fillPrice;
  const cost = tradeCost(notional, config.costParams, config.costTier, 'SELL', bars.dates[fillIdx]);
  return {
    securityId: bars.securityId,
    intendedDate: bars.dates[fillIdx],
    fillDate: bars.dates[fillIdx],
    fillPrice,
    side: 'SELL',
    quantity: shares,
    slippageBps: 0,
    costTier: config.costTier,
    totalCostAmount: cost,
    currency: bars.currency,
  };
}

function buildTradeRecord(
  bars: SecurityBars,
  seq: number,
  config: SecuritySimConfig,
  entrySignal: EntrySignalRecord,
  entryFill: OrderFill,
  stopPrice: number,
  atrAtEntry: number,
  exitFill: OrderFill,
  exitReason: ConditionalExitReason,
  exitStopHitPrice: number | null,
  buyCost: number
): ConditionalTradeRecord {
  const shares = entryFill.quantity;
  const buyNotional = shares * entryFill.fillPrice;
  const sellNotional = shares * exitFill.fillPrice;
  const netPnl = sellNotional - buyNotional - buyCost - exitFill.totalCostAmount;
  const netReturn = buyNotional > 0 ? netPnl / buyNotional : null;
  const stopDistance = entryFill.fillPrice - stopPrice;
  const riskAmount = shares * stopDistance;
  const rMultiple = riskAmount > 0 ? netPnl / riskAmount : null;
  const entryIdx = bars.dates.indexOf(entryFill.fillDate);
  const exitIdx = bars.dates.indexOf(exitFill.fillDate);
  const holdingDays = entryIdx >= 0 && exitIdx >= 0 ? exitIdx - entryIdx : null;

  return {
    tradeId: `${bars.securityId}-${config.strategyId}-${seq}`,
    securityId: bars.securityId,
    symbol: bars.symbol,
    market: bars.market,
    strategyId: config.strategyId,
    group: config.group,
    entrySignal,
    entryFill,
    stopPrice,
    atrAtEntry,
    exitFill,
    exitReason,
    exitStopHitPrice,
    netReturn,
    rMultiple,
    holdingDays,
    ledgerCurrency: bars.currency,
  };
}

// ===========================================================================
// 12. 포트폴리오 드라이버 (§10) — 자본 공유, 합집합 달력은 순서 배정에만 사용
// ===========================================================================

export interface PortfolioSimConfig {
  strategyId: StrategyId;
  entryLookback: (group: PositionGroup) => number; // 전략별 그룹→진입 룩백
  exitLookback: number;
  atrLookback: number;
  stopMultiple: number;
  commonStartBars: number;
  fillDelayDays: number;
  initialEquity: number;
  riskPerTradePct: number;
  totalRiskCapPct: number;
  singleNameValueCapPct: number;
  costTierByMarket: (market: Market) => CostModelParams;
  costTier: CostTier;
  slippageFrac: number;
  closeMethod: OpenPositionCloseMethod;
  advCap: number;
}

export interface PortfolioSecurity {
  bars: SecurityBars;
  /**
   * 이 종목의 월별 그룹 플래그(§6). 정적 group 필드는 제거됨(Bug2 수정) — 그룹은 진입 신호가
   * 발생한 달의 effectiveMonth 플래그로 `classifier.resolveFrozenClassification`을 통해 진입
   * 시점에 해석·동결한다(§6-5). 미리 고정한 단일 group을 전 구간에 쓰던 예전 방식은 월별 동결
   * 메커니즘(resolveFrozenGroup)을 실제로 호출하지 않는 사문(死文) 버그였다.
   * 여러 월의 플래그를 함께 넣어도 되며(진입 월 것만 사용), 진입 월 플래그가 없거나
   * unclassifiable이면 A/B 조건부 전략에서 진입 불가(§6, UNCLASSIFIED_GROUP)로 처리한다.
   */
  monthlyFlags: readonly MonthlyGroupFlags[];
}

export interface PortfolioSimOutput {
  trades: ConditionalTradeRecord[];
  unfilled: UnfilledSignalRecord[];
  exclusions: ExclusionRecord[];
  /**
   * 비용 차감 일별 자산곡선(합집합 달력 기준). cash는 결제 완료된 현금 잔고,
   * equity = cash + 보유 포지션 종가 평가(§10). ⚠ 현금/평가액은 실제 체결일(fillDate)에만
   * 변하고 신호일에는 변하지 않는다(Bug1 pending-order 결제 모델).
   */
  equityCurve: { date: IsoDate; equity: number; cash: number }[];
  finalEquity: number;
}

interface LivePosition {
  securityId: string;
  entrySignal: EntrySignalRecord;
  entryFill: OrderFill;
  stopPrice: number;
  atrAtEntry: number;
  stopDistance: number;
  shares: number;
  buyCost: number;
  group: PositionGroup;
  seq: number;
  /** 채널청산 주문이 이미 큐잉되어 결제 대기 중인가. true면 손절/재청산/재진입 재평가 안 함(보유·평가만 유지). */
  exitPending: boolean;
}

/** 결제 대기 진입 주문(신호일에 큐잉, fillDate에 현금 차감·포지션 생성 — Bug1 결제 모델). */
interface PendingEntry {
  securityId: string;
  fillDate: IsoDate;
  entrySignal: EntrySignalRecord;
  entryFill: OrderFill;
  stopPrice: number;
  atrAtSignal: number;
  stopDistance: number;
  shares: number;
  buyCost: number;
  notional: number;
  group: PositionGroup;
  seq: number;
}

/** 결제 대기 청산 주문(신호일에 큐잉, fillDate에 현금 회수·포지션 종료 — Bug1 결제 모델). */
interface PendingExit {
  securityId: string;
  fillDate: IsoDate;
  fillIdx: number;
  fillPrice: number;
  reason: ConditionalExitReason;
  stopHitPrice: number | null;
}

/** securityId 오름차순 비교자(결정론적 tie-break — 이 파일 전역 규약). */
function bySecurityIdAsc(a: { securityId: string }, b: { securityId: string }): number {
  return a.securityId < b.securityId ? -1 : a.securityId > b.securityId ? 1 : 0;
}

/**
 * 자본을 공유하는 포트폴리오 시뮬레이션(§10 1차 정책 판단용).
 *   · 신호·채널·ATR은 종목별 실제 거래일 인덱스로 계산(§9-1). 합집합 달력은 "그 날 무슨 종목을
 *     처리할지" 순서에만 쓴다(룩백 카운팅에 사용하지 않음).
 *   · 총 위험 12%·단일 종목 25%·최대 1유닛. 같은 날 신규 진입 후보가 가용 위험을 넘으면
 *     proRataRiskAllocation로 비례 배분(선착순 금지).
 *   · ADV 5% 초과 주문은 미체결(UnfilledSignalRecord, ADV_CAP).
 *
 * ── Bug1: 미결제 주문(pending-order) 결제 모델 ──
 * 채널청산·신규진입은 종가 확인(t) 후 다음 거래일(fillIdx) 시가에 체결된다. 예전 코드는 신호일 t의
 * 루프 안에서 즉시 cash/positions를 변형해, 실제 체결이 일어나기 하루(또는 거래정지 이월 시 그 이상)
 * 전에 원장이 바뀌는 룩어헤드 타이밍 버그가 있었다(신호일 자산곡선 blip + openRisk 왜곡).
 * 이제 각 날짜 반복은 다음 순서를 따른다:
 *   (1) fillDate === 오늘인 큐잉된 주문을 먼저 결제(현금/포지션 실제 변형은 지금 = 실제 체결일).
 *       같은 날 다중 결제는 securityId 오름차순, 청산(현금 유입)을 진입(현금 유출)보다 먼저.
 *   (2) 오늘 바로 손절·상장폐지(당일 체결, §9-8·§9-10) 평가 — 즉시 변형 유지(정상).
 *   (3) 오늘 바로 채널청산·신규진입 신호 평가 — 즉시 변형하지 않고 fillDate로 **큐잉**만.
 *   (4) 오늘 자산 평가는 (1)까지 결제 완료된 cash/positions만 사용(오늘 큐잉분은 미반영).
 * openRisk()는 실제 보유(결제 완료) 포지션만 반영한다. 결제 대기 진입은 positions에 없고
 * pendingEntryIds로 별도 추적해 중복 신호를 막는다. 채널청산 대기 포지션은 여전히 보유·평가되며
 * (exitPending=true) 손절/재청산/재진입 재평가만 건너뛴다.
 * 손절·상장폐지 처리는 simulateSecurity와 동일 규칙을 인라인으로 적용한다.
 */
export function simulatePortfolio(
  securities: readonly PortfolioSecurity[],
  config: PortfolioSimConfig,
  corpActions: readonly CorporateActionRecord[] = []
): PortfolioSimOutput {
  const trades: ConditionalTradeRecord[] = [];
  const unfilled: UnfilledSignalRecord[] = [];
  const exclusions: ExclusionRecord[] = [];
  const equityCurve: { date: IsoDate; equity: number; cash: number }[] = [];

  // 종목별 부가 데이터
  const byId = new Map<string, PortfolioSecurity>();
  const atrById = new Map<string, (number | null)[]>();
  const startById = new Map<string, number>();
  const idxByDate = new Map<string, Map<IsoDate, number>>();
  const delistById = new Map<string, Map<IsoDate, CorporateActionRecord>>();
  const dateSet = new Set<IsoDate>();

  for (const s of securities) {
    byId.set(s.bars.securityId, s);
    atrById.set(s.bars.securityId, atrSeries(s.bars, config.atrLookback));
    startById.set(
      s.bars.securityId,
      commonStartIndex(s.bars, config.atrLookback, config.commonStartBars)
    );
    const dmap = new Map<IsoDate, number>();
    s.bars.dates.forEach((d, i) => {
      dmap.set(d, i);
      dateSet.add(d);
    });
    idxByDate.set(s.bars.securityId, dmap);
    const dl = new Map<IsoDate, CorporateActionRecord>();
    for (const a of corpActions) {
      if (a.securityId === s.bars.securityId && a.type === 'DELISTING') dl.set(a.exDate, a);
    }
    delistById.set(s.bars.securityId, dl);
  }

  const calendar = Array.from(dateSet).sort(); // 합집합 달력(순서 배정 전용)
  const positions = new Map<string, LivePosition>();
  // 결제 대기 큐(fillDate → 주문 배열). Bug1: 실제 체결일에만 원장 변형.
  const pendingEntriesByDate = new Map<IsoDate, PendingEntry[]>();
  const pendingExitsByDate = new Map<IsoDate, PendingExit[]>();
  // 종목별 마지막 유효 종가(평가 전용 carry-forward). 신호/채널/ATR 계산에는 절대 쓰지 않는다(§9-1) —
  // 오직 그 날 그 종목 바가 없을 때(휴장·거래정지 등) 자산 평가값이 진입가로 리셋되는 것을 막는 용도.
  const lastCloseById = new Map<string, number>();
  const pendingEntryIds = new Set<string>(); // 결제 대기 진입이 걸린 종목(중복 신호 방지)
  let cash = config.initialEquity;
  let equity = config.initialEquity;
  let seq = 0;

  // 그룹 민감 전략인가(A/B 진입 룩백이 다른가). 다르면 ADAPTIVE/REVERSE(그룹으로 채널 갈림),
  // 같으면 ALL_20/ALL_55(그룹 무관 — 미분류 종목도 채널 동일하므로 진입 가능).
  const groupSensitive = config.entryLookback('A') !== config.entryLookback('B');

  // openRisk: 실제 보유(결제 완료) 포지션만. exitPending 포지션도 아직 주식을 보유 중이므로 포함.
  const openRisk = (): number => {
    let r = 0;
    for (const p of positions.values()) r += p.shares * p.stopDistance;
    return r;
  };

  for (const date of calendar) {
    // ── (1) 오늘 결제일인 큐잉 주문 정산 ── (실제 체결일 = 원장 변형 시점)
    // (1a) 청산 결제(현금 유입) 먼저, securityId ASC
    const exitsToday = (pendingExitsByDate.get(date) ?? []).slice().sort(bySecurityIdAsc);
    for (const pe of exitsToday) {
      const pos = positions.get(pe.securityId);
      const sec = byId.get(pe.securityId);
      if (!pos || !sec) continue;
      closeLive(pos, sec, pe.fillIdx, pe.fillPrice, pe.reason, config, trades, (c) => (cash += c), pe.stopHitPrice);
      positions.delete(pe.securityId);
    }
    pendingExitsByDate.delete(date);
    // (1b) 진입 결제(현금 유출), securityId ASC
    const entriesToday = (pendingEntriesByDate.get(date) ?? []).slice().sort(bySecurityIdAsc);
    for (const pen of entriesToday) {
      cash -= pen.notional + pen.buyCost;
      positions.set(pen.securityId, {
        securityId: pen.securityId,
        entrySignal: pen.entrySignal,
        entryFill: pen.entryFill,
        stopPrice: pen.stopPrice,
        atrAtEntry: pen.atrAtSignal,
        stopDistance: pen.stopDistance,
        shares: pen.shares,
        buyCost: pen.buyCost,
        group: pen.group,
        seq: pen.seq,
        exitPending: false,
      });
      pendingEntryIds.delete(pen.securityId);
    }
    pendingEntriesByDate.delete(date);

    // ── (2) 기존 포지션: 상장폐지·손절(당일 체결·즉시) 또는 채널청산(큐잉) ──
    for (const [securityId, pos] of Array.from(positions.entries())) {
      if (pos.exitPending) continue; // 이미 청산 큐잉됨 — 재평가 안 함(보유·평가만 유지)
      const sec = byId.get(securityId);
      if (!sec) continue;
      const t = idxByDate.get(securityId)?.get(date);
      if (t === undefined) continue; // 그 종목은 그 날 거래 안 함

      const delist = delistById.get(securityId)?.get(date);
      if (delist) {
        const res = resolveDelisting(delist);
        if (!res.resolvable) {
          exclusions.push({
            securityId,
            symbol: sec.bars.symbol,
            market: sec.bars.market,
            reason: 'delisting-proceeds-unknown(임의대체 금지 — 확증 세트 제외)',
          });
          // 원금 회수 없이 포지션만 제거(제외 거래는 로그에 남기지 않음)
          cash += 0;
          positions.delete(securityId);
          continue;
        }
        const exitPrice =
          res.proceedsPerShare !== null
            ? res.proceedsPerShare
            : pos.entryFill.fillPrice * (1 + (res.delistingReturn as number));
        // 상장폐지는 당일(t) 체결(§9-10) — 즉시 현금 변형(정상, Bug1 무관).
        closeLive(pos, sec, t, exitPrice, 'DELISTING', config, trades, (c) => (cash += c));
        positions.delete(securityId);
        continue;
      }

      const sf = stopFill(sec.bars.open[t], sec.bars.low[t], pos.stopPrice, config.slippageFrac);
      if (sf.hit) {
        // 보호 손절은 당일(t) 체결(§9-8) — 즉시 현금 변형(정상, Bug1 무관).
        closeLive(pos, sec, t, sf.price, 'PROTECTIVE_STOP', config, trades, (c) => (cash += c), sf.price);
        positions.delete(securityId);
        continue;
      }
      if (isChannelExitSignal(sec.bars, t, config.exitLookback)) {
        const exitIdx = resolveFillIndex(sec.bars, t, config.fillDelayDays);
        if (exitIdx !== null) {
          // 채널청산은 익일 시가 체결 — 지금 변형하지 않고 fillDate로 큐잉(Bug1 수정).
          const fillDate = sec.bars.dates[exitIdx];
          const arr = pendingExitsByDate.get(fillDate) ?? [];
          arr.push({
            securityId,
            fillDate,
            fillIdx: exitIdx,
            fillPrice: sec.bars.open[exitIdx],
            reason: 'CHANNEL_EXIT',
            stopHitPrice: null,
          });
          pendingExitsByDate.set(fillDate, arr);
          pos.exitPending = true;
        }
      }
    }

    // ── (3) 신규 진입 후보 수집(그 날 신호 확인 → 익일 시가 체결 예정 → 큐잉) ──
    interface Candidate {
      securityId: string;
      signalIdx: number;
      fillIdx: number;
      entryFillPrice: number;
      stopPrice: number;
      stopDistance: number;
      atrAtSignal: number;
      channelHigh: number;
      signalClose: number;
      group: PositionGroup;
    }
    const candidates: Candidate[] = [];
    for (const s of securities) {
      const securityId = s.bars.securityId;
      // 이미 보유 중이거나 결제 대기 진입이 걸린 종목은 재진입 금지(1유닛).
      if (positions.has(securityId) || pendingEntryIds.has(securityId)) continue;
      const t = idxByDate.get(securityId)?.get(date);
      if (t === undefined) continue;
      if (t < (startById.get(securityId) ?? 0)) continue;

      // 진입 월 동결 분류 해석(§6-5, Bug2): 정적 group이 아니라 월별 플래그에서 진입 시점 그룹 확정.
      const signalDateStr = s.bars.dates[t];
      const cls = resolveFrozenClassification(s.monthlyFlags, securityId, signalDateStr);
      if (!cls.hasFlag) continue; // 그 달 투자가능 종목군에 없음 → 후보 아님(조용히 스킵)
      let group: PositionGroup;
      if (cls.group === null) {
        // unclassifiable(시총 해석 불가): A/B 조건부 전략은 채널을 정할 수 없음 → 진입 불가(추측 금지).
        if (groupSensitive) {
          unfilled.push(mkUnfilled(s.bars, config.strategyId, signalDateStr, 'UNCLASSIFIED_GROUP'));
          continue;
        }
        // 그룹 무관 전략(ALL_20/ALL_55): 두 그룹 채널이 동일하므로 진입 가능. group 라벨은
        // 명목상 'B'(A/B 주장이 아님 — 채널에 영향 없음). 문서화된 설계 선택.
        group = 'B';
      } else {
        group = cls.group;
      }

      const entryLb = config.entryLookback(group);
      if (!isEntrySignal(s.bars, t, entryLb)) continue;
      const atrAtSignal = atrById.get(securityId)?.[t] ?? null;
      if (atrAtSignal === null || !(atrAtSignal > 0)) continue;
      const fillIdx = resolveFillIndex(s.bars, t, config.fillDelayDays);
      if (fillIdx === null) {
        unfilled.push(mkUnfilled(s.bars, config.strategyId, signalDateStr, 'NO_NEXT_BAR'));
        continue;
      }
      const entryFillPrice = s.bars.open[fillIdx];
      const stopPrice = computeStopPrice(entryFillPrice, atrAtSignal, config.stopMultiple);
      const stopDistance = entryFillPrice - stopPrice;
      if (!(stopDistance > 0)) continue;
      candidates.push({
        securityId,
        signalIdx: t,
        fillIdx,
        entryFillPrice,
        stopPrice,
        stopDistance,
        atrAtSignal,
        channelHigh: entryChannelHigh(s.bars, t, entryLb) as number,
        signalClose: s.bars.close[t],
        group,
      });
    }

    if (candidates.length > 0) {
      // 가용 위험 = 총 위험 한도 − 기존 오픈 위험(결제 완료 포지션만).
      const totalRiskBudget = equity * (config.totalRiskCapPct / 100);
      const availableRisk = Math.max(0, totalRiskBudget - openRisk());
      // 각 후보 desiredRisk = 0.5% 사이징 위험
      const riskCandidates: RiskCandidate[] = candidates.map((c) => {
        const sizing = positionSize({
          equity,
          riskPerTradePct: config.riskPerTradePct,
          singleNameValueCapPct: config.singleNameValueCapPct,
          entryPrice: c.entryFillPrice,
          stopPrice: c.stopPrice,
        });
        return {
          securityId: c.securityId,
          desiredRisk: sizing.riskAmount,
          stopDistancePerShare: c.stopDistance,
          price: c.entryFillPrice,
        };
      });
      const alloc = proRataRiskAllocation(riskCandidates, availableRisk);

      // 결정론적 순서(securityId ASC)로 큐잉
      const ordered = [...candidates].sort(bySecurityIdAsc);
      // 하루 안의 현금 선착순 게이팅을 위한 일-지역 예약치(실제 cash는 결제일에만 변동).
      let availCash = cash;
      for (const c of ordered) {
        const sec = byId.get(c.securityId);
        if (!sec) continue;
        const allocatedRisk = alloc.get(c.securityId) ?? 0;
        let shares = Math.floor(allocatedRisk / c.stopDistance);
        // 단일 종목 25% 한도
        const capValue = equity * (config.singleNameValueCapPct / 100);
        if (shares * c.entryFillPrice > capValue) {
          shares = Math.floor(capValue / c.entryFillPrice);
        }
        if (shares <= 0) {
          unfilled.push(mkUnfilled(sec.bars, config.strategyId, sec.bars.dates[c.signalIdx], 'ZERO_SHARES'));
          continue;
        }
        // ADV 수용 규모(§11)
        const notional = shares * c.entryFillPrice;
        const mdv = medianDailyValue(sec.bars, c.signalIdx, 60);
        if (!advParticipationOk(notional, mdv, config.advCap)) {
          unfilled.push(mkUnfilled(sec.bars, config.strategyId, sec.bars.dates[c.signalIdx], 'ADV_CAP'));
          continue;
        }
        const costParams = config.costTierByMarket(sec.bars.market);
        const buyCost = tradeCost(notional, costParams, config.costTier, 'BUY', sec.bars.dates[c.fillIdx]);
        if (notional + buyCost > availCash) {
          unfilled.push(mkUnfilled(sec.bars, config.strategyId, sec.bars.dates[c.signalIdx], 'RISK_CAP'));
          continue;
        }
        availCash -= notional + buyCost; // 예약(실제 cash 차감은 fillDate에)
        seq++;
        const entrySignal: EntrySignalRecord = {
          securityId: c.securityId,
          symbol: sec.bars.symbol,
          market: sec.bars.market,
          strategyId: config.strategyId,
          group: c.group,
          signalDate: sec.bars.dates[c.signalIdx],
          breakoutChannelHigh: c.channelHigh,
          signalClose: c.signalClose,
          entryLookbackUsed: config.entryLookback(c.group),
        };
        const entryFill: OrderFill = {
          securityId: c.securityId,
          intendedDate: sec.bars.dates[c.signalIdx],
          fillDate: sec.bars.dates[c.fillIdx],
          fillPrice: c.entryFillPrice,
          side: 'BUY',
          quantity: shares,
          slippageBps: 0,
          costTier: config.costTier,
          totalCostAmount: buyCost,
          currency: sec.bars.currency,
        };
        // 즉시 변형하지 않고 fillDate로 큐잉(Bug1 수정).
        const fillDate = sec.bars.dates[c.fillIdx];
        const arr = pendingEntriesByDate.get(fillDate) ?? [];
        arr.push({
          securityId: c.securityId,
          fillDate,
          entrySignal,
          entryFill,
          stopPrice: c.stopPrice,
          atrAtSignal: c.atrAtSignal,
          stopDistance: c.stopDistance,
          shares,
          buyCost,
          notional,
          group: c.group,
          seq,
        });
        pendingEntriesByDate.set(fillDate, arr);
        pendingEntryIds.add(c.securityId);
      }
    }

    // ── (4) 그 날 자산 평가(결제 완료된 현금 + 보유 포지션 종가 평가) ──
    // Bug(halt-day valuation): 그 날 그 종목 바가 없으면(휴장·거래정지·시장별 휴일 불일치 등)
    // 진입가로 근사하지 않는다 — 진입가 근사는 매 휴장일마다 자산곡선이 진입가로 리셋되는
    // 허위 변동을 만든다. 대신 그 종목의 "마지막으로 관측된 종가"를 carry-forward한다
    // (평가 전용 — 신호/채널/ATR 계산에는 이 carry-forward를 쓰지 않는다, §9-1과 별개 사안).
    let holdingsValue = 0;
    for (const [securityId, pos] of positions) {
      const t = idxByDate.get(securityId)?.get(date);
      const sec = byId.get(securityId);
      if (t === undefined || !sec) {
        const lastClose = lastCloseById.get(securityId) ?? pos.entryFill.fillPrice;
        holdingsValue += pos.shares * lastClose;
        continue;
      }
      lastCloseById.set(securityId, sec.bars.close[t]);
      holdingsValue += pos.shares * sec.bars.close[t];
    }
    equity = cash + holdingsValue;
    equityCurve.push({ date, equity, cash });
  }

  // (D) 데이터 종료 시 열린 포지션 종료 처리(큐잉 주문은 fillDate가 달력 내라 이미 모두 결제됨).
  const lastDate = calendar[calendar.length - 1] ?? '';
  for (const [securityId, pos] of Array.from(positions.entries())) {
    const sec = byId.get(securityId);
    if (!sec) continue;
    const lastIdx = sec.bars.dates.length - 1;
    const closeRes = closeOpenPosition(
      config.closeMethod,
      {
        securityId,
        entryFillPrice: pos.entryFill.fillPrice,
        shares: pos.shares,
        stopDistancePerShare: pos.stopDistance,
        buyCost: pos.buyCost,
      },
      sec.bars.close[lastIdx],
      config.costTierByMarket(sec.bars.market),
      config.costTier,
      sec.bars.dates[lastIdx]
    );
    positions.delete(securityId);
    if (closeRes.excluded) continue;
    const exitFill: OrderFill = {
      securityId,
      intendedDate: sec.bars.dates[lastIdx],
      fillDate: sec.bars.dates[lastIdx],
      fillPrice: closeRes.exitPrice as number,
      side: 'SELL',
      quantity: pos.shares,
      slippageBps: 0,
      costTier: config.costTier,
      totalCostAmount: closeRes.sellCost,
      currency: sec.bars.currency,
    };
    cash += pos.shares * (closeRes.exitPrice as number) - closeRes.sellCost;
    trades.push(finalizeLiveTrade(pos, sec, exitFill, 'FORCED_CLOSE'));
  }
  equity = cash;
  if (lastDate) equityCurve.push({ date: lastDate, equity, cash });

  return { trades, unfilled, exclusions, equityCurve, finalEquity: equity };
}

// ── 포트폴리오 내부 헬퍼 ────────────────────────────────────────────────────

function closeLive(
  pos: LivePosition,
  sec: PortfolioSecurity,
  fillIdx: number,
  fillPrice: number,
  reason: ConditionalExitReason,
  config: PortfolioSimConfig,
  trades: ConditionalTradeRecord[],
  addCash: (amount: number) => void,
  stopHitPrice: number | null = null
): void {
  const costParams = config.costTierByMarket(sec.bars.market);
  const notional = pos.shares * fillPrice;
  const sellCost = tradeCost(notional, costParams, config.costTier, 'SELL', sec.bars.dates[fillIdx]);
  addCash(notional - sellCost);
  const exitFill: OrderFill = {
    securityId: pos.securityId,
    intendedDate: sec.bars.dates[fillIdx],
    fillDate: sec.bars.dates[fillIdx],
    fillPrice,
    side: 'SELL',
    quantity: pos.shares,
    slippageBps: 0,
    costTier: config.costTier,
    totalCostAmount: sellCost,
    currency: sec.bars.currency,
  };
  trades.push(finalizeLiveTrade(pos, sec, exitFill, reason, stopHitPrice));
}

function finalizeLiveTrade(
  pos: LivePosition,
  sec: PortfolioSecurity,
  exitFill: OrderFill,
  reason: ConditionalExitReason,
  stopHitPrice: number | null = null
): ConditionalTradeRecord {
  const shares = pos.shares;
  const buyNotional = shares * pos.entryFill.fillPrice;
  const sellNotional = shares * exitFill.fillPrice;
  const netPnl = sellNotional - buyNotional - pos.buyCost - exitFill.totalCostAmount;
  const netReturn = buyNotional > 0 ? netPnl / buyNotional : null;
  const riskAmount = shares * pos.stopDistance;
  const rMultiple = riskAmount > 0 ? netPnl / riskAmount : null;
  const entryIdx = sec.bars.dates.indexOf(pos.entryFill.fillDate);
  const exitIdx = sec.bars.dates.indexOf(exitFill.fillDate);
  const holdingDays = entryIdx >= 0 && exitIdx >= 0 ? exitIdx - entryIdx : null;

  return {
    tradeId: `${pos.securityId}-${pos.entrySignal.strategyId}-${pos.seq}`,
    securityId: pos.securityId,
    symbol: sec.bars.symbol,
    market: sec.bars.market,
    strategyId: pos.entrySignal.strategyId,
    group: pos.group,
    entrySignal: pos.entrySignal,
    entryFill: pos.entryFill,
    stopPrice: pos.stopPrice,
    atrAtEntry: pos.atrAtEntry,
    exitFill,
    exitReason: reason,
    exitStopHitPrice: stopHitPrice,
    netReturn,
    rMultiple,
    holdingDays,
    ledgerCurrency: sec.bars.currency,
  };
}
