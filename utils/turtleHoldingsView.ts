// utils/turtleHoldingsView.ts
// ---------------------------------------------------------------------------
// P2(2026-09-26) — "보유종목 터틀" 화면용 순수 view-model (계획서
// `docs/PLAN_터틀중심_앱재정비_260925.md` §4.1~4.4·§6 P2 2-1).
//
// 이 파일은 계산만 한다 — fetch·저장·주문 실행 없음. 데이터는 `hooks/useTurtleHoldings.ts`가
// 공급한다(각 종목의 완료봉 raw 시계열 + fxRate + effectiveManagedEquityKRW).
//
// 안전 원칙(RULES §8·계획서 §5):
//   · 순수 함수만 — side effect·console·any 금지. 입력 불변.
//   · fail-closed — 데이터 부족·환율 미확보 시 값을 지어내지 않고 null/사유를 반환한다.
//   · 청산/재진입 채널 계산은 `utils/todayTurtle.extractCompletedBars`(완전한 유효 OHLC·당일 제외)를
//     그대로 재사용한다 — 재발명 금지. N·사이징·손절 상향 등은 `utils/turtleHoldings.ts`(P0) 재사용.
//   · 원래 보유분(kind='legacy-holding')은 진입 N 기록이 없어 청산선만 적용한다(2N 손절 없음, 재매수 계산 없음).
//   · 재매수분(kind='reentry-position')의 불타기 판정·사이징은 **라이브 N**(오늘 완료봉 기준 20일 ATR)을
//     쓴다 — 위성 엔진의 `evaluatePyramid`와 동일 관례(`utils/turtlePositionView.ts`의 저장N 기반 미리보기와는
//     다른 용도: 그쪽은 fetch 없는 동기 표시, 이쪽은 fetch된 라이브 데이터 기반의 정확한 판정).

import { Currency, WatchlistItem, normalizeExchange } from '../types';
import { EnrichedAsset } from '../types/ui';
import { TurtlePosition } from '../types/turtle';
import { isBaseType } from '../types/category';
import { applyDrawdownScaling } from './turtleEngine';
import { resolveMarketTz, extractCompletedBars, todayInstrumentKey, DailyBar, RawSeries } from './todayTurtle';
import { resolvePositionFxRate } from './turtlePositionView';
import {
  TurtleHoldingsSettings,
  VolatilityLabel,
  HoldingsSkipReason,
} from '../types/turtleHoldings';
import {
  computeN,
  computeExitLine,
  computeReentryLine,
  computeFirstUnitSize,
  computePyramidUnitSize,
  computePyramidTriggerPrice,
  computeCommonStopPrice,
  evaluateLegacyHoldingsStatus,
  isInHoldingsScope,
  classifyVolatility,
  describeExitLineExplanation,
  describeReentryLineExplanation,
  describeStopOrderCheckText,
  formatMoney,
  ScopeCheckAsset,
} from './turtleHoldings';

export { resolvePositionFxRate };

// ── 관리자산(§3.1 "터틀 관리 자산") ───────────────────────────────────────────

export interface ManagedEquityBreakdown {
  /** 범위 내(가족·개별·카테고리 제외 적용 후) 비현금 보유 평가액(KRW) */
  holdingsValueKRW: number;
  /** 범위 내 현금성(카테고리 CASH) 평가액(KRW) — "대기 자금" 표시에 재사용 */
  parkedCashKRW: number;
  managedEquityKRW: number;
}

/**
 * 관리자산 = 범위 내 평가액 + 대기 자금. "대기 자금"은 새 저장 필드를 만들지 않고
 * 기존 CASH 카테고리 자산(범위 내)을 그대로 합산한다 — 판 돈을 파킹형 상품(CMA·MMF 등)으로
 * 옮겨 CASH 카테고리로 기록해 둔 값을 그대로 인식한다.
 */
export function computeManagedEquity(
  assets: readonly EnrichedAsset[],
  settings: TurtleHoldingsSettings,
): ManagedEquityBreakdown {
  let holdingsValueKRW = 0;
  let parkedCashKRW = 0;
  for (const a of assets) {
    if (!isInHoldingsScope(a, settings)) continue;
    const v = a.metrics.currentValueKRW;
    if (isBaseType(a.categoryId, 'CASH')) parkedCashKRW += v;
    else holdingsValueKRW += v;
  }
  return { holdingsValueKRW, parkedCashKRW, managedEquityKRW: holdingsValueKRW + parkedCashKRW };
}

export interface EffectiveManagedEquity {
  equityKRW: number;
  drawdownApplied: boolean;
}

/**
 * 계좌 축소(드로다운 감쇄) 적용 — `drawdownScalingEnabled`면 `applyDrawdownScaling`(utils/turtleEngine,
 * 원조 §10)을 반드시 거친 뒤에 사이징에 넘긴다(P0 §6 체크 항목).
 *
 * **기준자산(연초 시작 자산) 출처(P3, 2026-09-26 확정)**: 사용자가 설정 화면에서 직접 정한다
 * (`TurtleHoldingsSettings.drawdownReferenceKRW`, [지금 자산으로 기준 정하기] 버튼 — 보이지 않는
 * 자동 기록 없음). 호출부(`hooks/useTurtleHoldings.ts`)가 그 값을 `referenceEquityKRW`로 넘긴다.
 * 아직 기준을 정하지 않았으면(undefined 또는 0 이하) **현재 관리자산을 그 자체의 기준으로 삼아**(자기참조)
 * 항상 감쇄가 적용되지 않은 값을 반환한다 — 잘못된 기준으로 사이징을 과소평가하는 것보다 안전한 기본값이다.
 */
export function resolveEffectiveManagedEquity(
  managedEquityKRW: number,
  settings: TurtleHoldingsSettings,
  referenceEquityKRW?: number,
): EffectiveManagedEquity {
  if (!settings.drawdownScalingEnabled) return { equityKRW: managedEquityKRW, drawdownApplied: false };
  const reference = referenceEquityKRW != null && referenceEquityKRW > 0 ? referenceEquityKRW : managedEquityKRW;
  const scaled = applyDrawdownScaling(managedEquityKRW, reference);
  return { equityKRW: scaled, drawdownApplied: scaled < reference - 1e-6 };
}

/**
 * 계좌 축소 기준 자산을 새로 정할 시점인지(표시 전용, §4.7) — 매년 1월이거나 기준을 정한 지
 * 365일이 지났으면 true. 기준이 아예 없으면(아직 안 정함) false — "기준을 정하세요"가 아니라
 * "기준을 정할 수 있습니다"(설정 화면 버튼)로 충분하다.
 */
export function shouldPromptDrawdownReferenceRefresh(referenceSetAt: string | undefined, now: Date): boolean {
  if (!referenceSetAt) return false;
  const set = new Date(`${referenceSetAt}T00:00:00`);
  if (Number.isNaN(set.getTime())) return false;
  const daysSince = (now.getTime() - set.getTime()) / 86_400_000;
  if (daysSince >= 365) return true;
  return now.getMonth() === 0; // 1월(로컬 기준, 0-indexed)
}

// ── 행 모델 ──────────────────────────────────────────────────────────────────

export type TurtleHoldingsRowKind = 'legacy-holding' | 'reentry-position' | 'watch';

/** 상태: 계획서 §4.1 4칸 + 보조 상태(보유 유지/감시 중/확인 불가/범위 제외). */
export type TurtleHoldingsStatus =
  | 'hold'          // 보유 유지
  | 'sell'          // 팔 때
  | 'watching'      // 감시 중 (재진입 대기)
  | 'reentry'       // 다시 살 때
  | 'pyramid'       // 추가 매수
  | 'unavailable'   // 확인 불가
  | 'out-of-scope'; // 범위 제외

export type TurtleHoldingsDataIssue = 'fetch-failed' | 'no-high-low' | 'no-completed-bar' | 'insufficient-bars' | 'no-fx';

export interface TurtleHoldingsRebuy {
  qty: number;
  positionValueKRW: number;
  /** 증권사에 걸 손절 예약가(원통화). qty=0이면 null. */
  stopPriceOriginal: number | null;
  /** 다음 불타기(추가 매수) 트리거가(원통화). 유닛 한도 도달/계산 불가면 null. */
  nextPyramidPriceOriginal: number | null;
  skipReason: HoldingsSkipReason | null;
}

export interface TurtleHoldingsRow {
  kind: TurtleHoldingsRowKind;
  assetId?: string;
  watchItemId?: string;
  positionId?: string;
  ticker: string;
  name: string;
  currency: Currency;
  status: TurtleHoldingsStatus;
  lastClose: number | null;
  exitLine: number | null;
  reentryLine: number | null;
  /** (종가−청산선)/청산선×100 — 음수면 이미 청산선 아래. exitLine 없으면 null. */
  exitGapPct: number | null;
  n: number | null;
  volatilityLabel: VolatilityLabel | null;
  unitsCount: number | null;
  maxUnits: number | null;
  rebuy: TurtleHoldingsRebuy | null;
  /** "왜 떴는지" 한 줄 설명(계획서 §4.1). */
  reasonText: string;
  /**
   * "손절선 확인" 칸 전용 문구(증권사 손절 예약주문 점검 용도) — 재매수분(reentry-position)의
   * '보유 유지'/'추가 매수' 상태에서만 값이 있다. `reasonText`(판정 사유)와 절대 같은 문장을
   * 재사용하지 않는다(칸 의미 혼동 방지, 계획서 §4.1 Advisor 지적 2026-09-26).
   */
  stopCheckText: string | null;
  dataIssue: TurtleHoldingsDataIssue | null;
  asOfDate: string | null;
}

function dataIssueText(issue: TurtleHoldingsDataIssue): string {
  switch (issue) {
    case 'fetch-failed': return '시세를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.';
    case 'no-high-low': return '고가·저가 자료를 받지 못해 계산하지 않았습니다.';
    case 'no-completed-bar': return '완료된 일봉이 아직 없습니다.';
    case 'insufficient-bars': return '판정에 필요한 일봉이 부족합니다.';
    case 'no-fx': return '환율 정보가 없어 계산을 보류합니다.';
  }
}

/** raw 시계열 → 완료봉 + 1차 데이터 이슈 판정 공통 로직(legacy/reentry/watch 공용). */
function resolveCompletedBars(
  raw: RawSeries | undefined, exchange: string, isCrypto: boolean, now: Date, fetchFailed: boolean,
): { bars: DailyBar[]; issue: TurtleHoldingsDataIssue | null } {
  if (fetchFailed) return { bars: [], issue: 'fetch-failed' };
  const marketTz = resolveMarketTz(exchange, isCrypto);
  const r = extractCompletedBars(raw, marketTz, now);
  if (!r.hasHighLow) return { bars: [], issue: 'no-high-low' };
  if (r.bars.length === 0) return { bars: [], issue: 'no-completed-bar' };
  return { bars: r.bars, issue: null };
}

// ── 1. 원래 보유분(legacy-holding) ───────────────────────────────────────────

export interface LegacyHoldingRowInput {
  asset: EnrichedAsset;
  raw: RawSeries | undefined;
  isCrypto: boolean;
  fetchFailed: boolean;
  now: Date;
  settings: TurtleHoldingsSettings;
}

export function buildTurtleHoldingsLegacyRow(input: LegacyHoldingRowInput): TurtleHoldingsRow {
  const { asset, raw, isCrypto, fetchFailed, now, settings } = input;
  const base = {
    kind: 'legacy-holding' as const, assetId: asset.id, ticker: asset.ticker,
    name: asset.customName?.trim() || asset.name, currency: asset.currency,
    reentryLine: null, unitsCount: null, maxUnits: null, rebuy: null, stopCheckText: null,
  };
  if (!isInHoldingsScope(asset, settings)) {
    return {
      ...base, status: 'out-of-scope', lastClose: null, exitLine: null, exitGapPct: null,
      n: null, volatilityLabel: null, reasonText: '터틀 적용 범위에서 제외된 자산입니다.',
      dataIssue: null, asOfDate: null,
    };
  }
  const { bars, issue } = resolveCompletedBars(raw, asset.exchange, isCrypto, now, fetchFailed);
  if (issue) {
    return {
      ...base, status: 'unavailable', lastClose: null, exitLine: null, exitGapPct: null,
      n: null, volatilityLabel: null, reasonText: dataIssueText(issue), dataIssue: issue, asOfDate: null,
    };
  }
  const lastClose = bars[bars.length - 1].close;
  const asOfDate = bars[bars.length - 1].date;
  const exitLine = computeExitLine({ bars, settings });
  const n = computeN(bars.map(b => b.high), bars.map(b => b.low), bars.map(b => b.close));
  const priceForVol = asset.priceOriginal > 0 ? asset.priceOriginal : lastClose;
  const volatilityLabel = n != null && priceForVol > 0 ? classifyVolatility((n / priceForVol) * 100) : null;
  const legacyStatus = evaluateLegacyHoldingsStatus(lastClose, exitLine);
  const status: TurtleHoldingsStatus =
    legacyStatus === 'sell-check' ? 'sell' : legacyStatus === 'hold' ? 'hold' : 'unavailable';
  const exitGapPct = exitLine != null ? ((lastClose - exitLine) / exitLine) * 100 : null;
  const dataIssue: TurtleHoldingsDataIssue | null = status === 'unavailable' ? 'insufficient-bars' : null;
  const reasonText = status === 'sell' && exitLine != null
    ? describeExitLineExplanation({ exitLookback: settings.exitLookback, exitLine, lastClose, currency: asset.currency })
    : status === 'hold'
      ? `청산선 ${exitLine != null ? formatMoney(exitLine, asset.currency) : '—'} 위에서 마감했습니다(종가 ${formatMoney(lastClose, asset.currency)}). 규칙상 보유를 유지합니다.`
      : dataIssueText('insufficient-bars');
  return { ...base, status, lastClose, exitLine, exitGapPct, n, volatilityLabel, reasonText, dataIssue, asOfDate };
}

// ── 2. 재매수분(reentry-position) ───────────────────────────────────────────

export interface ReentryPositionRowInput {
  /** origin==='holdings-reentry' && status==='open' 인 포지션만 넘길 것(호출부 필터). */
  position: TurtlePosition;
  asset: EnrichedAsset;
  raw: RawSeries | undefined;
  isCrypto: boolean;
  fetchFailed: boolean;
  now: Date;
  settings: TurtleHoldingsSettings;
  fxRate: number | null;
  effectiveManagedEquityKRW: number;
}

export function buildTurtleHoldingsReentryRow(input: ReentryPositionRowInput): TurtleHoldingsRow {
  const { position, asset, raw, isCrypto, fetchFailed, now, settings, fxRate } = input;
  const unitsCount = position.units.length;
  const maxUnits = settings.maxUnitsPerPosition;
  const base = {
    kind: 'reentry-position' as const, assetId: asset.id, positionId: position.id,
    ticker: position.ticker, name: asset.customName?.trim() || asset.name, currency: asset.currency,
    reentryLine: null, unitsCount, maxUnits, stopCheckText: null,
  };
  if (!isInHoldingsScope(asset, settings)) {
    return {
      ...base, status: 'out-of-scope', lastClose: null, exitLine: null, exitGapPct: null,
      n: null, volatilityLabel: null, rebuy: null, reasonText: '터틀 적용 범위에서 제외된 자산입니다.',
      dataIssue: null, asOfDate: null,
    };
  }
  const { bars, issue } = resolveCompletedBars(raw, asset.exchange, isCrypto, now, fetchFailed);
  if (issue) {
    return {
      ...base, status: 'unavailable', lastClose: null, exitLine: null, exitGapPct: null,
      n: null, volatilityLabel: null, rebuy: null, reasonText: dataIssueText(issue), dataIssue: issue, asOfDate: null,
    };
  }
  const lastClose = bars[bars.length - 1].close;
  const asOfDate = bars[bars.length - 1].date;
  // atrTrail 청산 전용 — 포지션 시작일(또는 그 이후 첫 완료봉)을 진입 인덱스로 잡는다.
  const entryIdxRaw = bars.findIndex(b => b.date >= position.openedAt);
  const entryIdx = entryIdxRaw >= 0 ? entryIdxRaw : 0;
  const exitLine = computeExitLine({ bars, settings, entryIdx });
  const n = computeN(bars.map(b => b.high), bars.map(b => b.low), bars.map(b => b.close));
  const priceForVol = asset.priceOriginal > 0 ? asset.priceOriginal : lastClose;
  const volatilityLabel = n != null && priceForVol > 0 ? classifyVolatility((n / priceForVol) * 100) : null;
  const stopPrice = position.stopPrice;
  const exitGapPct = exitLine != null ? ((lastClose - exitLine) / exitLine) * 100 : null;

  let status: TurtleHoldingsStatus;
  let reasonText: string;
  let dataIssue: TurtleHoldingsDataIssue | null = null;
  const lastUnit = position.units[unitsCount - 1];

  if (lastClose <= stopPrice) {
    status = 'sell';
    reasonText = `손절가 ${formatMoney(stopPrice, asset.currency)} 아래로 마감했습니다(종가 ${formatMoney(lastClose, asset.currency)}). 손절 매도 후 [팔았음 기록]하세요.`;
  } else if (exitLine != null && lastClose <= exitLine) {
    status = 'sell';
    reasonText = describeExitLineExplanation({ exitLookback: settings.exitLookback, exitLine, lastClose, currency: asset.currency });
  } else {
    const canPyramid = unitsCount < maxUnits && n != null;
    const triggerPrice = canPyramid ? computePyramidTriggerPrice(lastUnit.fillPrice, n as number, settings) : null;
    if (canPyramid && triggerPrice != null && lastClose >= triggerPrice) {
      status = 'pyramid';
      reasonText = `마지막 매수가 ${formatMoney(lastUnit.fillPrice, asset.currency)}에서 ${formatMoney(triggerPrice - lastUnit.fillPrice, asset.currency)} 오른 ${formatMoney(triggerPrice, asset.currency)} 이상으로 마감해 추가 매수(불타기) 기준을 충족했습니다.`;
    } else {
      status = 'hold';
      reasonText = exitLine != null
        ? `손절가 ${formatMoney(stopPrice, asset.currency)}, 청산선 ${formatMoney(exitLine, asset.currency)} 어디에도 닿지 않았습니다. 규칙상 보유를 유지합니다.`
        : `손절가 ${formatMoney(stopPrice, asset.currency)} 위에 있습니다. 규칙상 보유를 유지합니다.`;
      if (exitLine == null) dataIssue = 'insufficient-bars';
    }
  }

  // "손절선 확인" 칸 전용 문구(증권사 손절 예약주문 점검) — '보유 유지'/'추가 매수'에서만.
  // reasonText(판정 사유)와 다른 문장이어야 칸 의미가 혼동되지 않는다(§4.1 Advisor 지적 2026-09-26).
  const stopCheckText = status === 'hold' || status === 'pyramid'
    ? describeStopOrderCheckText({ stopPrice, exitLine, currency: asset.currency })
    : null;

  // 불타기 사이징 미리보기 — 손절('sell') 상태에서는 매수 미리보기를 만들지 않는다.
  let rebuy: TurtleHoldingsRebuy | null = null;
  if ((status === 'hold' || status === 'pyramid') && unitsCount < maxUnits) {
    if (n == null) {
      rebuy = { qty: 0, positionValueKRW: 0, stopPriceOriginal: null, nextPyramidPriceOriginal: null, skipReason: 'no-n' };
    } else {
      const triggerPrice = computePyramidTriggerPrice(lastUnit.fillPrice, n, settings);
      const sizing = computePyramidUnitSize(position.units[0].quantity, unitsCount, triggerPrice, fxRate, settings, isCrypto);
      const projectedStop = sizing.qty > 0 ? Math.max(stopPrice, computeCommonStopPrice(triggerPrice, n, settings)) : null;
      const nextTriggerPrice = sizing.qty > 0 && unitsCount + 1 < maxUnits
        ? computePyramidTriggerPrice(triggerPrice, n, settings) : null;
      rebuy = {
        qty: sizing.qty, positionValueKRW: sizing.positionValueKRW,
        stopPriceOriginal: projectedStop, nextPyramidPriceOriginal: nextTriggerPrice, skipReason: sizing.skipReason,
      };
    }
  }

  return { ...base, status, lastClose, exitLine, exitGapPct, n, volatilityLabel, rebuy, reasonText, stopCheckText, dataIssue, asOfDate };
}

// ── 3. 관심종목 감시(watch) ──────────────────────────────────────────────────

export interface WatchRowInput {
  watchItem: WatchlistItem;
  raw: RawSeries | undefined;
  isCrypto: boolean;
  fetchFailed: boolean;
  now: Date;
  settings: TurtleHoldingsSettings;
  fxRate: number | null;
  effectiveManagedEquityKRW: number;
  /**
   * 범위 내 보유 자산(원래 보유분·재매수분)의 정규화 티커 키 집합(`todayInstrumentKey`,
   * 티커+`normalizeExchange` 거래소) — 같은 종목을 이미 보유/재매수 중이면 감시 행을 만들지 않는다
   * (방금 [샀음 기록]한 종목이 '다시 살 때'로 계속 뜨는 중복 매수 유도 방지, Advisor 지적 2026-09-26).
   */
  heldTickerKeys: ReadonlySet<string>;
}

export function buildTurtleHoldingsWatchRow(input: WatchRowInput): TurtleHoldingsRow {
  const { watchItem, raw, isCrypto, fetchFailed, now, settings, fxRate, effectiveManagedEquityKRW, heldTickerKeys } = input;
  const scopeAsset: ScopeCheckAsset = { id: watchItem.id, categoryId: watchItem.categoryId };
  const base = {
    kind: 'watch' as const, watchItemId: watchItem.id, ticker: watchItem.ticker,
    name: watchItem.name, currency: watchItem.currency ?? Currency.KRW,
    exitLine: null, exitGapPct: null, unitsCount: null, maxUnits: null, stopCheckText: null,
  };
  const watchKey = todayInstrumentKey(watchItem.ticker, watchItem.exchange, normalizeExchange);
  if (heldTickerKeys.has(watchKey)) {
    return {
      ...base, status: 'out-of-scope', lastClose: null, reentryLine: null, n: null,
      volatilityLabel: null, rebuy: null,
      reasonText: '이미 보유 중이거나 재매수 포지션이 있어 감시 대상에서 제외했습니다(중복 매수 방지).',
      dataIssue: null, asOfDate: null,
    };
  }
  if (!isInHoldingsScope(scopeAsset, settings)) {
    return {
      ...base, status: 'out-of-scope', lastClose: null, reentryLine: null, n: null,
      volatilityLabel: null, rebuy: null, reasonText: '터틀 적용 범위에서 제외된 관심종목입니다.',
      dataIssue: null, asOfDate: null,
    };
  }
  const { bars, issue } = resolveCompletedBars(raw, watchItem.exchange, isCrypto, now, fetchFailed);
  if (issue) {
    return {
      ...base, status: 'unavailable', lastClose: null, reentryLine: null, n: null,
      volatilityLabel: null, rebuy: null, reasonText: dataIssueText(issue), dataIssue: issue, asOfDate: null,
    };
  }
  const lastClose = bars[bars.length - 1].close;
  const asOfDate = bars[bars.length - 1].date;
  const reentryLine = computeReentryLine(bars, settings);
  const n = computeN(bars.map(b => b.high), bars.map(b => b.low), bars.map(b => b.close));
  const volatilityLabel = n != null && lastClose > 0 ? classifyVolatility((n / lastClose) * 100) : null;

  let status: TurtleHoldingsStatus;
  let reasonText: string;
  let dataIssue: TurtleHoldingsDataIssue | null = null;
  if (reentryLine == null) {
    status = 'unavailable';
    dataIssue = 'insufficient-bars';
    reasonText = dataIssueText('insufficient-bars');
  } else if (lastClose >= reentryLine) {
    status = 'reentry';
    reasonText = describeReentryLineExplanation({ entryLookback: settings.entryLookback, reentryLine, lastClose, currency: watchItem.currency ?? Currency.KRW });
  } else {
    status = 'watching';
    const gapPct = ((reentryLine - lastClose) / lastClose) * 100;
    reasonText = `${settings.entryLookback}일 최고가 ${formatMoney(reentryLine, watchItem.currency ?? Currency.KRW)}까지 ${gapPct.toFixed(1)}% 남았습니다.`;
  }

  let rebuy: TurtleHoldingsRebuy | null = null;
  if (status === 'reentry' || status === 'watching') {
    if (n == null) {
      rebuy = { qty: 0, positionValueKRW: 0, stopPriceOriginal: null, nextPyramidPriceOriginal: null, skipReason: 'no-n' };
    } else {
      const sizing = computeFirstUnitSize(effectiveManagedEquityKRW, n, lastClose, fxRate, settings, isCrypto);
      const stopPriceOriginal = sizing.qty > 0 ? computeCommonStopPrice(lastClose, n, settings) : null;
      const nextPyramidPriceOriginal = sizing.qty > 0 && settings.maxUnitsPerPosition > 1
        ? computePyramidTriggerPrice(lastClose, n, settings) : null;
      rebuy = { qty: sizing.qty, positionValueKRW: sizing.positionValueKRW, stopPriceOriginal, nextPyramidPriceOriginal, skipReason: sizing.skipReason };
    }
  }

  return { ...base, status, lastClose, reentryLine, n, volatilityLabel, rebuy, reasonText, dataIssue, asOfDate };
}

// ── 4. 요약 + 정렬 ───────────────────────────────────────────────────────────

export interface TurtleHoldingsCounts {
  sellCount: number;      // 팔 때
  reentryCount: number;   // 다시 살 때
  pyramidCount: number;   // 추가 매수
  stopCheckCount: number; // 손절선 확인(재매수분 오픈 포지션 — 보유/불타기 상태)
}

export function summarizeTurtleHoldingsRows(rows: readonly TurtleHoldingsRow[]): TurtleHoldingsCounts {
  let sellCount = 0, reentryCount = 0, pyramidCount = 0, stopCheckCount = 0;
  for (const row of rows) {
    if (row.status === 'sell') sellCount++;
    else if (row.status === 'reentry') reentryCount++;
    else if (row.status === 'pyramid') pyramidCount++;
    if (row.kind === 'reentry-position' && (row.status === 'hold' || row.status === 'pyramid')) stopCheckCount++;
  }
  return { sellCount, reentryCount, pyramidCount, stopCheckCount };
}

/** 표시 우선순위 — 낮을수록 위(확인 필요 → 액션 → 감시/보유 → 범위 제외). */
export function turtleHoldingsRowRank(row: TurtleHoldingsRow): number {
  if (row.status === 'unavailable') return 0;
  if (row.status === 'sell' || row.status === 'reentry' || row.status === 'pyramid') return 1;
  if (row.status === 'watching') return 2;
  if (row.status === 'hold') return 3;
  return 4; // out-of-scope
}

/** 결정적 정렬 — 순위 → 티커(입력 순서 무관). */
export function sortTurtleHoldingsRows(rows: readonly TurtleHoldingsRow[]): TurtleHoldingsRow[] {
  return [...rows].sort((a, b) => {
    const d = turtleHoldingsRowRank(a) - turtleHoldingsRowRank(b);
    if (d !== 0) return d;
    return a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0;
  });
}

// ── 5. 조회 기간 산정(훅의 fetch 창 크기 결정용) ─────────────────────────────

/** 필요한 최소 거래일수 — 진입/청산/이동평균 청산/ATR 워밍업(21일) 중 가장 큰 값. */
export function turtleHoldingsRequiredTradingDays(settings: TurtleHoldingsSettings): number {
  return Math.max(settings.entryLookback + 1, settings.exitLookback + 1, settings.maPeriod, 21);
}

/**
 * 달력일 환산 — 주말·휴장을 감안한 여유 배수(기존 useTodayTurtle의 130일/56거래일 ≈ 2.36배 관례 재사용)
 * + 30일 안전 여유. 값 자체는 골든 대상이 아니다(넉넉하면 그만 — 과도해도 배치 조회 1회 비용만 늘 뿐).
 */
export function turtleHoldingsLookbackCalendarDays(settings: TurtleHoldingsSettings): number {
  const tradingDays = turtleHoldingsRequiredTradingDays(settings);
  return Math.ceil(tradingDays * 2.4) + 30;
}
