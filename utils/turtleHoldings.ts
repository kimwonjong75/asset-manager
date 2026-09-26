// utils/turtleHoldings.ts
// ---------------------------------------------------------------------------
// P0 — "보유종목 터틀"(계획서 `docs/PLAN_터틀중심_앱재정비_260925.md` §3.1·§6 P0) 순수 계산 모듈.
//
// 범위: 이 파일은 **계산만** 한다. 저장·주문 실행·UI는 다음 단계(P1~P2)다.
// 안전 원칙:
//   · 순수 함수만 — side effect·console·any 금지.
//   · fail-closed — N·채널·환율 등 데이터가 부족하면 null/사유를 반환한다(값을 지어내지 않는다).
//   · ExchangeRates는 USD/JPY만 보유(CNY 등은 undefined 가능) — 환율 없으면 null 반환(0원 대체 금지).
//   · 청산/재진입 채널은 **당일 제외**(`utils/todayTurtle.entryBreakoutLine`/`exitChannelLine` 재사용),
//     이동평균 청산은 **당일 포함**(SMA 공통 관례 — scripts/backtest/coreStopLoss/lib/movingAverage.ts와 동일 정의).
//   · N(20일 ATR)은 `utils/turtleEngine.computeN` 재사용 — 재발명 금지.
//   · 백테스트 엔진(`scripts/backtest/portfolioTurtle/{exitRules,sizing}.ts`)과 같은 입력이면 같은 값이
//     나와야 한다(파리티) — 이 파일은 그 계약을 앱 쪽에서 재현한다(스크립트 파일을 import하지 않는다 —
//     scripts/는 연구 전용, utils/는 앱 배포 대상이라 계층을 분리한다).

import { calculateATR } from './maCalculations';
import { computeN } from './turtleEngine';
import { entryBreakoutLine, exitChannelLine, DailyBar } from './todayTurtle';
import { getAssetOwner } from '../types/owner';
import { formatPlanPrice } from './tradePlan';
import {
  TurtleHoldingsSettings,
  DEFAULT_TURTLE_HOLDINGS_SETTINGS,
  VolatilityLabel,
  HoldingsSkipReason,
  LegacyHoldingsStatus,
  HoldingsExitMethod,
} from '../types/turtleHoldings';

export { computeN };
export type { DailyBar };

function isPos(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function clamp(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return v < min ? min : v > max ? max : v;
}
function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const c = clamp(v, min, max, fallback);
  return Math.round(c);
}

// ── 0. 설정 병합 (fail-closed 가드) ─────────────────────────────────────────

/**
 * 저장본 병합 — `{...DEFAULT, ...saved}` + 범위 가드. 잘못된 값(범위 밖·타입 불일치)은 기본값으로
 * 대체한다(throw 하지 않음 — 화면이 깨지면 안 된다). 순수 함수, 부분 필드도 허용한다.
 */
export function resolveHoldingsSettings(saved?: Partial<TurtleHoldingsSettings> | null): TurtleHoldingsSettings {
  const s = saved ?? {};
  const D = DEFAULT_TURTLE_HOLDINGS_SETTINGS;
  const exitMethod = s.exitMethod === 'donchian' || s.exitMethod === 'ma' || s.exitMethod === 'atrTrail'
    ? s.exitMethod : D.exitMethod;
  const pyramidSpacing = s.pyramidSpacing === '2R' || s.pyramidSpacing === 'halfN' || s.pyramidSpacing === 'custom'
    ? s.pyramidSpacing : D.pyramidSpacing;
  const pyramidSizeMultiplier: 1 | 0.5 = s.pyramidSizeMultiplier === 0.5 ? 0.5 : 1;
  return {
    entryLookback: clampInt(s.entryLookback, 20, 100, D.entryLookback),
    exitMethod,
    exitLookback: clampInt(s.exitLookback, 10, 55, D.exitLookback),
    maPeriod: isPos(s.maPeriod) ? Math.round(s.maPeriod as number) : D.maPeriod,
    atrTrailMultiple: isPos(s.atrTrailMultiple) ? (s.atrTrailMultiple as number) : D.atrTrailMultiple,
    stopMultipleN: clamp(s.stopMultipleN, 1.5, 3, D.stopMultipleN),
    riskPerUnitPct: clamp(s.riskPerUnitPct, 0.25, 1, D.riskPerUnitPct),
    maxUnitsPerPosition: clampInt(s.maxUnitsPerPosition, 1, 4, D.maxUnitsPerPosition),
    pyramidSpacing,
    pyramidCustomN: isPos(s.pyramidCustomN) ? (s.pyramidCustomN as number) : D.pyramidCustomN,
    pyramidSizeMultiplier,
    positionCapPct: clamp(s.positionCapPct, 5, 25, D.positionCapPct),
    maxTotalRiskPct: clamp(s.maxTotalRiskPct, 12, 24, D.maxTotalRiskPct),
    drawdownScalingEnabled: typeof s.drawdownScalingEnabled === 'boolean' ? s.drawdownScalingEnabled : D.drawdownScalingEnabled,
    minOrderKRW: typeof s.minOrderKRW === 'number' && Number.isFinite(s.minOrderKRW) && s.minOrderKRW >= 0 ? s.minOrderKRW : D.minOrderKRW,
    excludeFamilyOwner: typeof s.excludeFamilyOwner === 'boolean' ? s.excludeFamilyOwner : D.excludeFamilyOwner,
    excludedAssetIds: Array.isArray(s.excludedAssetIds) ? s.excludedAssetIds.filter((x): x is string => typeof x === 'string') : [],
    excludedCategoryIds: Array.isArray(s.excludedCategoryIds) ? s.excludedCategoryIds.filter((x): x is number => typeof x === 'number') : [],
    // P3(2026-09-26) — 계좌 축소 기준 자산. 잘못된 값(음수·NaN·빈 문자열)은 undefined로 되돌린다
    // (throw 금지 원칙 — 화면이 깨지는 대신 "미설정"으로 fail-closed).
    drawdownReferenceKRW: isPos(s.drawdownReferenceKRW) ? (s.drawdownReferenceKRW as number) : undefined,
    drawdownReferenceSetAt: typeof s.drawdownReferenceSetAt === 'string' && s.drawdownReferenceSetAt.trim() !== ''
      ? s.drawdownReferenceSetAt : undefined,
  };
}

// ── 1. 청산선 ────────────────────────────────────────────────────────────────

/**
 * 이동평균(SMA) 청산선 — **당일 포함**, 관례상 마지막 `period`개 종가 평균. 부족/결측이면 null.
 * 로컬 변수명 `win`(과거 `window`) — 카카오톡 GAS 번들 가드가 브라우저 전역 `window` 참조를
 * 문자열 그렙으로 잡는데 식별자 vs 전역을 구분 못해 오탐한다(2026-09-26, P4 — 이 함수가 GAS
 * 번들에 처음 포함됨. `utils/todayTurtle.ts`의 동일 사유 주석 참고).
 */
export function computeMaExitLine(bars: readonly DailyBar[], period: number): number | null {
  if (!Number.isInteger(period) || period <= 0) return null;
  if (bars.length < period) return null;
  const win = bars.slice(bars.length - period);
  let sum = 0;
  for (const b of win) {
    if (!isNum(b.close)) return null;
    sum += b.close;
  }
  return sum / period;
}

/** ATR 추적 상태 — 진입/보유 시작 이후 최고 종가 기준 래칫(하향 금지). trailStop=null이면 아직 미확정. */
export interface AtrTrailState {
  runningHigh: number;
  trailStop: number | null;
}

/** 보유 시작(또는 재매수 진입)일 봉으로 상태를 초기화한다. */
export function initAtrTrailState(entryBar: DailyBar, n: number | null, multiple: number): AtrTrailState {
  const runningHigh = isNum(entryBar.high) ? entryBar.high : (isNum(entryBar.close) ? entryBar.close : 0);
  const trailStop = isPos(n) ? runningHigh - multiple * n : null;
  return { runningHigh, trailStop };
}

/** 하루치 갱신 — 최고가는 상향만, 추적선은 하향 금지(래칫). */
export function updateAtrTrailState(state: AtrTrailState, bar: DailyBar, n: number | null, multiple: number): AtrTrailState {
  const newHigh = isNum(bar.high) && bar.high > state.runningHigh ? bar.high : state.runningHigh;
  let trailStop = state.trailStop;
  if (isPos(n)) {
    const candidate = newHigh - multiple * n;
    if (trailStop === null || candidate > trailStop) trailStop = candidate;
  }
  return { runningHigh: newHigh, trailStop };
}

/**
 * ATR 추적선 — 진입일(entryIdx)부터 currentIdx까지 `initAtrTrailState`/`updateAtrTrailState`를 순서대로
 * 적용한 최종 상태. 필요한 만큼 봉이 없거나(entryIdx 범위 밖) N을 한 번도 못 구했으면 trailStop=null.
 */
export function computeAtrTrailExitLine(
  bars: readonly DailyBar[], entryIdx: number, currentIdx: number, multiple: number, period: number = 20
): number | null {
  if (entryIdx < 0 || currentIdx < entryIdx || currentIdx >= bars.length) return null;
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const closes = bars.map(b => b.close);
  const atrSeries = calculateATR(highs, lows, closes, period);
  let state = initAtrTrailState(bars[entryIdx], atrSeries[entryIdx] ?? null, multiple);
  for (let i = entryIdx + 1; i <= currentIdx; i++) {
    state = updateAtrTrailState(state, bars[i], atrSeries[i] ?? null, multiple);
  }
  return state.trailStop;
}

/** 청산선 계산 입력 — atrTrail만 entryIdx/currentIdx가 필요(진입 시점을 알아야 래칫을 시작할 수 있음). */
export interface ExitLineInput {
  bars: readonly DailyBar[];   // 완료봉(날짜 오름차순), 마지막 = 오늘(D)
  settings: TurtleHoldingsSettings;
  /** atrTrail 전용 — 보유/진입 시작 인덱스(bars 기준). 미지정이면 null 반환(fail-closed). */
  entryIdx?: number;
}

/**
 * 설정된 청산 방식에 따른 청산선. donchian/ma는 당일까지 봉이 필요한 만큼 있어야 값을 낸다.
 * atrTrail은 entryIdx가 있어야 하고, 그 구간에서 N을 한 번도 못 구하면 null(짧은 데이터로 값 내지 않음).
 */
export function computeExitLine(input: ExitLineInput): number | null {
  const { bars, settings } = input;
  if (bars.length === 0) return null;
  if (settings.exitMethod === 'donchian') return exitChannelLine(bars as DailyBar[], settings.exitLookback);
  if (settings.exitMethod === 'ma') return computeMaExitLine(bars, settings.maPeriod);
  // atrTrail
  if (input.entryIdx === undefined) return null;
  return computeAtrTrailExitLine(bars, input.entryIdx, bars.length - 1, settings.atrTrailMultiple);
}

// ── 2. 재진입선 (55일 최고가, 당일 제외, 확정 종가 기준) ───────────────────────

/** 재진입 판정선 — 직전 entryLookback개 완료봉 high 최댓값(당일 제외). 부족하면 null. */
export function computeReentryLine(bars: readonly DailyBar[], settings: TurtleHoldingsSettings): number | null {
  return entryBreakoutLine(bars as DailyBar[], settings.entryLookback);
}

/** 재진입 발생 여부 — 확정 종가가 재진입선 이상(당일 제외 채널과 비교). */
export function checkReentrySignal(bars: readonly DailyBar[], settings: TurtleHoldingsSettings): boolean {
  if (bars.length === 0) return false;
  const line = computeReentryLine(bars, settings);
  if (line === null) return false;
  const close = bars[bars.length - 1].close;
  return isNum(close) && close >= line;
}

// ── 4. 유닛 사이징 ───────────────────────────────────────────────────────────

export interface HoldingsUnitSizeResult {
  qty: number;
  riskAmountKRW: number;
  positionValueKRW: number;
  cappedByPosition: boolean;
  skipReason: HoldingsSkipReason | null;
}

const EMPTY_UNIT: HoldingsUnitSizeResult = {
  qty: 0, riskAmountKRW: 0, positionValueKRW: 0, cappedByPosition: false, skipReason: 'no-n',
};

/** 코인 1e-8 내림, 그 외 정수 내림(기존 앱·연구스크립트 공통 관례). */
export function roundHoldingsQty(qty: number, isCrypto: boolean): number {
  if (!(qty > 0)) return 0;
  return isCrypto ? Math.floor(qty * 1e8) / 1e8 : Math.floor(qty);
}

/**
 * 최초 유닛 크기 — min(관리자산×riskPct÷(N×fx), positionCapPct×관리자산÷maxUnits) 중 작은 값.
 * @param managedEquityKRW 관리자산(KRW) — 드로다운 감쇄가 켜져 있으면 호출부가 `applyDrawdownScaling`
 *   결과를 넣는다(이 함수는 감쇄를 모른다 — 순수 사이징만).
 * @param n 종목 통화 기준 N(20일 ATR). null이면 skip('no-n').
 * @param priceLocal 종목 통화 원본 가격(priceOriginal).
 * @param fx KRW/종목통화 환율. null이면 skip('no-fx')(D6 — ExchangeRates에 없는 통화는 0 대체 금지).
 */
export function computeFirstUnitSize(
  managedEquityKRW: number, n: number | null, priceLocal: number, fx: number | null,
  settings: TurtleHoldingsSettings, isCrypto: boolean
): HoldingsUnitSizeResult {
  if (n === null || !(n > 0)) return { ...EMPTY_UNIT, skipReason: 'no-n' };
  if (fx === null || !(fx > 0)) return { ...EMPTY_UNIT, skipReason: 'no-fx' };
  if (!(managedEquityKRW > 0)) return { ...EMPTY_UNIT, skipReason: 'no-cash' };

  const riskAmountKRW = managedEquityKRW * (settings.riskPerUnitPct / 100);
  const qtyRisk = riskAmountKRW / (n * fx);
  const capKRW = managedEquityKRW * (settings.positionCapPct / 100) / settings.maxUnitsPerPosition;
  const qtyCap = isPos(priceLocal) ? capKRW / (priceLocal * fx) : 0;

  const cappedByPosition = qtyCap < qtyRisk;
  const rawQty = cappedByPosition ? qtyCap : qtyRisk;
  const qty = roundHoldingsQty(rawQty, isCrypto);
  const positionValueKRW = qty * priceLocal * fx;

  if (!(qty > 0) || positionValueKRW < settings.minOrderKRW) {
    return { qty: 0, riskAmountKRW, positionValueKRW, cappedByPosition, skipReason: 'below-min-order' };
  }
  return { qty, riskAmountKRW, positionValueKRW, cappedByPosition, skipReason: null };
}

/**
 * 추가(불타기) 유닛 크기 — 최초 유닛 수량 × pyramidSizeMultiplier(고정, 재계산 금지).
 * 종목 한도(유닛 수) 초과 시 'max-units-reached'.
 */
export function computePyramidUnitSize(
  firstUnitQty: number, currentUnitCount: number, priceLocal: number, fx: number | null,
  settings: TurtleHoldingsSettings, isCrypto: boolean
): HoldingsUnitSizeResult {
  if (currentUnitCount >= settings.maxUnitsPerPosition) {
    return { qty: 0, riskAmountKRW: 0, positionValueKRW: 0, cappedByPosition: false, skipReason: 'max-units-reached' };
  }
  if (fx === null || !(fx > 0)) return { ...EMPTY_UNIT, skipReason: 'no-fx' };
  const rawQty = firstUnitQty * settings.pyramidSizeMultiplier;
  const qty = roundHoldingsQty(rawQty, isCrypto);
  const positionValueKRW = qty * priceLocal * fx;
  if (!(qty > 0) || positionValueKRW < settings.minOrderKRW) {
    return { qty: 0, riskAmountKRW: 0, positionValueKRW, cappedByPosition: false, skipReason: 'below-min-order' };
  }
  return { qty, riskAmountKRW: 0, positionValueKRW, cappedByPosition: false, skipReason: null };
}

// ── 5. 불타기 트리거·손절 상향 ───────────────────────────────────────────────

/**
 * 불타기(추가 매수) 트리거 가격 — 마지막 **실제 체결가** 기준.
 *   2R    = lastFillPrice + 2×stopMultipleN×N (강의식 — 손절 폭의 2배)
 *   halfN = lastFillPrice + 0.5×N
 *   custom= lastFillPrice + pyramidCustomN×N
 */
export function computePyramidTriggerPrice(lastFillPrice: number, n: number, settings: TurtleHoldingsSettings): number {
  if (settings.pyramidSpacing === '2R') return lastFillPrice + 2 * settings.stopMultipleN * n;
  if (settings.pyramidSpacing === 'halfN') return lastFillPrice + 0.5 * n;
  return lastFillPrice + settings.pyramidCustomN * n;
}

/** 공통 손절가 = 최신 체결가 − stopMultipleN×N (진입·불타기 공통 재계산 규칙). */
export function computeCommonStopPrice(latestFillPrice: number, n: number, settings: TurtleHoldingsSettings): number {
  return latestFillPrice - settings.stopMultipleN * n;
}

// ── 6. 원래 보유분(터틀 매수 이력 없음) 상태 ─────────────────────────────────

/** 원래 보유분 — 청산선만 적용(진입 N 기록이 없어 2N 손절 불가). */
export function evaluateLegacyHoldingsStatus(lastClose: number | null, exitLine: number | null): LegacyHoldingsStatus {
  if (lastClose === null || exitLine === null) return 'unavailable';
  return lastClose <= exitLine ? 'sell-check' : 'hold';
}

// ── 7. 동시 매수 현금 부족 — 공통비율 λ 축소 ─────────────────────────────────

export interface LambdaBuyCandidate {
  ticker: string;        // λ 대상 식별(정렬은 호출부가 티커 오름차순으로 넘긴다 — 선착순 금지)
  qtyAtFull: number;     // λ=1일 때 수량(사이징 결과, 라운딩 전 or 후 무관 — 내부에서 재라운딩)
  priceLocal: number;
  fx: number;
  isCrypto: boolean;
  /** 이 후보가 체결되면 늘어나는 위험액(KRW) — 최초 유닛 = qty×stopMultipleN×N×fx, 불타기는 호출부가 순증분을 계산해 넘긴다. */
  riskDeltaKRWAtFull: number;
}

export interface LambdaScaleResult {
  lambda: number;                       // 0~1
  qtys: Record<string, number>;         // ticker → 최종(라운딩된) 수량
  wasScaled: boolean;                   // λ<1이 실제로 적용됐는지(현금 또는 위험한도 제약)
}

/**
 * 현금·전체 위험 한도가 부족할 때 후보들에 **같은 비율(λ)**을 적용해 축소(선착순 아님).
 * 이분탐색(freshTurtleLifecycle/portfolioTurtle과 동일 알고리즘) — qty는 λ마다 다시 라운딩하므로
 * feasible(1)이 라운딩 후 예산을 살짝 넘을 수 있어 이분탐색으로 최대 실행 가능 λ를 찾는다.
 */
export function computeLambdaScale(
  candidates: readonly LambdaBuyCandidate[], availableCashKRW: number, baseOpenRiskKRW: number, riskCapKRW: number
): LambdaScaleResult {
  if (candidates.length === 0) return { lambda: 1, qtys: {}, wasScaled: false };

  const qtysAt = (lambda: number): number[] =>
    candidates.map(c => roundHoldingsQty(c.qtyAtFull * lambda, c.isCrypto));

  const feasible = (qtys: number[]): boolean => {
    let needCash = 0;
    let riskAfter = baseOpenRiskKRW;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const q = qtys[i];
      if (!(q > 0)) continue;
      needCash += q * c.priceLocal * c.fx;
      // 위험 증분은 qty에 비례(1유닛 내에서는 선형) — 부분 체결 시 비례 축소.
      riskAfter += c.qtyAtFull > 0 ? c.riskDeltaKRWAtFull * (q / c.qtyAtFull) : 0;
    }
    return needCash <= availableCashKRW + 1e-6 && riskAfter <= riskCapKRW + 1e-6;
  };

  const fullQtys = qtysAt(1);
  if (feasible(fullQtys)) {
    return { lambda: 1, qtys: Object.fromEntries(candidates.map((c, i) => [c.ticker, fullQtys[i]])), wasScaled: false };
  }

  let lo = 0, hi = 1;
  for (let it = 0; it < 60; it++) {
    const mid = (lo + hi) / 2;
    if (feasible(qtysAt(mid))) lo = mid; else hi = mid;
  }
  const finalQtys = qtysAt(lo);
  return { lambda: lo, qtys: Object.fromEntries(candidates.map((c, i) => [c.ticker, finalQtys[i]])), wasScaled: true };
}

// ── 8. 전체 위험 한도 ────────────────────────────────────────────────────────

export interface TotalRiskCheckResult {
  ok: boolean;
  totalRiskKRW: number;
  totalRiskPct: number;
}

/** 재매수분 2N 손절 기준 위험 합이 maxTotalRiskPct(관리자산 대비)를 넘는지. */
export function checkTotalRiskLimit(
  currentOpenRiskKRW: number, addedRiskKRW: number, managedEquityKRW: number, settings: TurtleHoldingsSettings
): TotalRiskCheckResult {
  const totalRiskKRW = currentOpenRiskKRW + addedRiskKRW;
  const totalRiskPct = managedEquityKRW > 0 ? (totalRiskKRW / managedEquityKRW) * 100 : Infinity;
  return { ok: totalRiskPct <= settings.maxTotalRiskPct, totalRiskKRW, totalRiskPct };
}

// ── 9. 적용 범위 판정 ────────────────────────────────────────────────────────

export interface ScopeCheckAsset {
  id: string;
  categoryId: number;
  owner?: 'WONJONG' | 'YUSEON';
}

/** 이 자산이 "보유종목 터틀"의 적용 범위 안인가 — 가족 계정·개별 제외·카테고리 제외 판정. */
export function isInHoldingsScope(asset: ScopeCheckAsset, settings: TurtleHoldingsSettings): boolean {
  if (settings.excludeFamilyOwner && getAssetOwner(asset) === 'YUSEON') return false;
  if (settings.excludedAssetIds.includes(asset.id)) return false;
  if (settings.excludedCategoryIds.includes(asset.categoryId)) return false;
  return true;
}

// ── 10. 변동성 라벨 + 쉬운 말 설명 ───────────────────────────────────────────

/** 변동성 라벨 — N/가격(%) 기준. 잔잔 <2% · 보통 2~4% · 출렁임 큼 >4%. */
export function classifyVolatility(nPctOfPrice: number): VolatilityLabel {
  if (nPctOfPrice < 2) return 'calm';
  if (nPctOfPrice <= 4) return 'normal';
  return 'volatile';
}

/** 원통화 표기 — KRW 기본, USD는 $·소수 2자리(카톡과 동일 규약, utils/tradePlan.formatPlanPrice 재사용). */
export function formatMoney(v: number, currency: string = 'KRW'): string {
  return formatPlanPrice(v, currency);
}
function formatPct(v: number): string {
  return `${(Math.round(v * 10) / 10).toFixed(1)}%`;
}

/**
 * 손절가 설명 — 예: "이 종목은 하루 평균 1,500원(3%)씩 움직입니다.
 * 그래서 손절가를 3,000원(6%) 아래인 47,000원으로 잡았습니다."
 */
export function describeStopExplanation(params: {
  priceLocal: number; n: number; stopMultipleN: number; stopPrice: number; currency?: string;
}): string {
  const { priceLocal, n, stopMultipleN, stopPrice, currency } = params;
  const nPct = priceLocal > 0 ? (n / priceLocal) * 100 : 0;
  const stopDistance = stopMultipleN * n;
  const stopPct = priceLocal > 0 ? (stopDistance / priceLocal) * 100 : 0;
  return `이 종목은 하루 평균 ${formatMoney(n, currency)}(${formatPct(nPct)})씩 움직입니다. ` +
    `그래서 손절가를 ${formatMoney(stopDistance, currency)}(${formatPct(stopPct)}) 아래인 ${formatMoney(stopPrice, currency)}으로 잡았습니다.`;
}

/**
 * 청산선 설명(도치안 예) — 예: "20일 최저가 51,200원 아래로 마감 (종가 50,800원)".
 */
export function describeExitLineExplanation(params: {
  exitLookback: number; exitLine: number; lastClose: number; currency?: string;
  /** 청산 방식별 선 이름 — 미지정이면 donchian(기존 문구 그대로). Advisor 보정 2026-09-26 */
  exitMethod?: HoldingsExitMethod; maPeriod?: number; atrTrailMultiple?: number;
}): string {
  const { exitLookback, exitLine, lastClose, currency, exitMethod, maPeriod, atrTrailMultiple } = params;
  const lineName = exitMethod === 'ma' ? `${maPeriod ?? 50}일 이동평균`
    : exitMethod === 'atrTrail' ? `추적 손절선(최고 종가 − ${atrTrailMultiple ?? 3}N)`
    : `${exitLookback}일 최저가`;
  // 판정은 종가 <= 청산선(백테스트·todayTurtle 동일 규약) — 같은 값도 포함하므로 '이하'로 표기(Advisor 보정 2026-09-26)
  return `${lineName} ${formatMoney(exitLine, currency)} 이하로 마감 (종가 ${formatMoney(lastClose, currency)})`;
}

/** 재진입선 설명 — 예: "55일 최고가 62,000원 위로 마감 (종가 62,400원)". */
export function describeReentryLineExplanation(params: {
  entryLookback: number; reentryLine: number; lastClose: number; currency?: string;
}): string {
  const { entryLookback, reentryLine, lastClose, currency } = params;
  return `${entryLookback}일 최고가 ${formatMoney(reentryLine, currency)} 위로 마감 (종가 ${formatMoney(lastClose, currency)})`;
}

/**
 * 재매수분 손절 이탈 설명 — 예: "손절가 68,000원 아래로 마감했습니다(종가 67,500원)."
 * P4(2026-09-26) — 카카오톡 알림(GAS)·화면(`turtleHoldingsView.buildTurtleHoldingsReentryRow`)이
 * 같은 문장을 공유하도록 분리(재구현 금지 원칙, `describeExitLineExplanation`과 동일 패턴).
 */
export function describeStopHitExplanation(params: {
  stopPrice: number; lastClose: number; currency?: string;
}): string {
  const { stopPrice, lastClose, currency } = params;
  return `손절가 ${formatMoney(stopPrice, currency)} 아래로 마감했습니다(종가 ${formatMoney(lastClose, currency)}).`;
}

/**
 * 불타기(추가 매수) 트리거 도달 설명 — 예: "마지막 매수가 60,000원에서 6,000원 오른 66,000원
 * 이상으로 마감해 추가 매수(불타기) 기준을 충족했습니다." P4 — 화면·GAS 공유(위와 동일 사유).
 */
export function describePyramidHitExplanation(params: {
  lastFillPrice: number; triggerPrice: number; currency?: string;
}): string {
  const { lastFillPrice, triggerPrice, currency } = params;
  return `마지막 매수가 ${formatMoney(lastFillPrice, currency)}에서 ${formatMoney(triggerPrice - lastFillPrice, currency)} 오른 ${formatMoney(triggerPrice, currency)} 이상으로 마감해 추가 매수(불타기) 기준을 충족했습니다.`;
}

/**
 * 손절 예약주문 점검 문구(재매수분 '보유 유지'/'추가 매수' 전용, §4.1 "손절선 확인" 칸).
 * 증권사에 실제로 손절 예약이 걸려 있는지 점검하라는 용도이지, 손절/청산 여부 판정문(§"팔 때" 칸의
 * `사유` 텍스트)과는 목적이 다르다 — 같은 문장을 두 칸에 중복 표시하지 않도록 별도 함수로 분리한다.
 * 예: "증권사 손절 예약 48,800원이 걸려 있는지 확인하세요 (청산선 49,000원)."
 */
export function describeStopOrderCheckText(params: {
  stopPrice: number; exitLine: number | null; currency?: string;
}): string {
  const { stopPrice, exitLine, currency } = params;
  const exitPart = exitLine != null ? ` (청산선 ${formatMoney(exitLine, currency)})` : '';
  return `증권사 손절 예약 ${formatMoney(stopPrice, currency)}이 걸려 있는지 확인하세요${exitPart}.`;
}
