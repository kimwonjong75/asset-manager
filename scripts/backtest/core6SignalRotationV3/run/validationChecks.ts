// scripts/backtest/core6SignalRotationV3/run/validationChecks.ts
// 코어 6종 신호 로테이션 V3 — 검증구간 **사후 점검**(시작일 오프셋·leave-one-out·부트스트랩 CI·집중 의존·379800 regime·P5 대조·세후·비용).
// 사전등록: docs/backtest/PREREG_코어6종_신호로테이션_V3.md §13~§15, V2 §13.2·§14.2·§15.
// 실행: npx tsx scripts/backtest/core6SignalRotationV3/run/validationChecks.ts
//
// 이 파일은 선택 잠금 해시 대상이 아니다(신규). **선택·규칙·기준을 바꾸지 않는다.** 이미 나온 검증 결과(VALIDATION_RESULT_P.txt)를
// 같은 엔진·같은 구간으로 재현하고(불일치하면 throw), 그 위에 사전등록된 민감도만 얹는다.
// 산출: output/VALIDATION_SENSITIVITY.json, output/VALIDATION_SENSITIVITY_REPORT.md (이미 있으면 덮어쓰지 않고 throw).

import { existsSync, writeFileSync } from 'fs';
import path from 'path';
import { postReentryStats, quarterShare, runSim, simMetrics } from './devRun';
import type { PostReentryStats, QuarterContribution } from './devRun';
import {
  COST_ADVERSE,
  COST_BASE,
  CAP_ABSOLUTE,
  CAP_MULTIPLIER,
  INITIAL_CAPITAL,
  OUTPUT_DIR,
  isMainModule,
  loadCd91,
  loadOrComputeSignalCache,
  loadPanel,
  metricsFromEquity,
} from './common';
import type { CdRow, Metrics, SignalCache } from './common';
import { runValidation, validationEventPass, buildValidationContext } from './runValidation';
import type { ValidationEvents } from './runValidation';
import type { SelectedRule } from './devRun';
import { bootstrapPairedDiff, DEFAULT_ITERATIONS, DEFAULT_MEAN_BLOCK, DEFAULT_SEED } from '../stats/bootstrap';
import type { BootstrapDiffResult } from '../stats/bootstrap';
import { cagr, calmar, dailyReturns, maxDrawdown, mddRelativeReduction } from '../stats/metrics';
import { ASSET_CODES } from '../types';
import type { AssetCode, Panel, SignalRuleId } from '../types';
import type { SimResult, Trade } from '../portfolio/simulate';

// ── 상수 ────────────────────────────────────────────────────────────────────
export const START_OFFSETS: readonly number[] = [21, 42, 63];
export const MIN_REMAINING_DAYS = 180;
export const CAGR_FLOOR = -0.02;
export const MDD_REDUCTION_MIN = 0.2;
export const LOO_MIN_PASS = 5;
export const ASSET_CONCENTRATION_LIMIT = 0.5;
export const QUARTER_CONCENTRATION_LIMIT = 0.6;
export const REGIME_A_END = '2025-01-23';
export const REGIME_B_START = '2025-02-21';
export const TAX_RATE = 0.154;
export const TAX_EXEMPT_CODE: AssetCode = '069500';
export const REGIME_RATE_RATIO = 3;
export const PYRAMID_CAGR_FLOOR = -0.01;

// ── 순수 도우미(테스트 대상) ────────────────────────────────────────────────
/** leave-one-out 비중: removed 를 0 으로 하고 나머지를 합 1 로 재정규화. */
export function looWeights(weights: Readonly<Record<AssetCode, number>>, removed: AssetCode): Record<AssetCode, number> {
  const out = {} as Record<AssetCode, number>;
  let sum = 0;
  for (const c of ASSET_CODES) if (c !== removed) sum += weights[c];
  for (const c of ASSET_CODES) out[c] = c === removed || sum <= 0 ? 0 : weights[c] / sum;
  return out;
}

/** 주 상한(시뮬레이터와 같은 식): min(배수×비중, 절대상한). */
export function capFor(weight: number, multiplier: number = CAP_MULTIPLIER, absolute: number = CAP_ABSOLUTE): number {
  return Math.min(multiplier * weight, absolute);
}

export interface OffsetPlan {
  offset: number;
  startIndex: number;
  /** startIndex..endIndex 세션 수. */
  days: number;
  valid: boolean;
}

/** 검증 시작일 오프셋 계획: 각 오프셋의 시작 인덱스와 잔여 거래일(≥minRemaining 일 때만 valid). 0 은 항상 valid(주 시작). */
export function planOffsets(mainStart: number, endIndex: number, offsets: readonly number[] = START_OFFSETS, minRemaining: number = MIN_REMAINING_DAYS): OffsetPlan[] {
  const plans: OffsetPlan[] = [{ offset: 0, startIndex: mainStart, days: endIndex - mainStart + 1, valid: true }];
  for (const offset of offsets) {
    const startIndex = mainStart + offset;
    const days = endIndex - startIndex + 1;
    plans.push({ offset, startIndex, days, valid: days >= minRemaining });
  }
  return plans;
}

/** 기준 1·2 동시 충족(MDD 상대 축소 ≥20% AND CAGR 차이 ≥ −2%p). */
export function meetsCriteria12(mddBh: number, mddStrat: number, cagrBh: number, cagrStrat: number): boolean {
  const red = mddRelativeReduction(mddBh, mddStrat);
  return red !== null && red >= MDD_REDUCTION_MIN && cagrStrat - cagrBh >= CAGR_FLOOR;
}

/** LOO 통과: 전략 MDD 가 BH 보다 얕고(절댓값 작음) CAGR 차이 ≥ −2%p. */
export function looPass(mddBh: number, mddStrat: number, cagrBh: number, cagrStrat: number): boolean {
  return Math.abs(mddStrat) < Math.abs(mddBh) && cagrStrat - cagrBh >= CAGR_FLOOR;
}

export function quarterOf(date: string): string {
  return `${date.slice(0, 4)}Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
}

/** 분기별 초과손익 = Δ전략 평가액 − ΔB&H 평가액. 합 = (전략 최종 − B&H 최종). initial 은 첫 곡선 값의 직전 기준. */
export function quarterlyExcessFromEquity(dates: readonly string[], strat: readonly number[], bh: readonly number[], initial: number): QuarterContribution[] {
  const out: QuarterContribution[] = [];
  let prevS = initial;
  let prevB = initial;
  let curQ = quarterOf(dates[0]);
  let lastS = prevS;
  let lastB = prevB;
  for (let k = 0; k < dates.length; k++) {
    const q = quarterOf(dates[k]);
    if (q !== curQ) {
      out.push({ quarter: curQ, excessPnl: lastS - prevS - (lastB - prevB) });
      prevS = lastS;
      prevB = lastB;
      curQ = q;
    }
    lastS = strat[k];
    lastB = bh[k];
  }
  out.push({ quarter: curQ, excessPnl: lastS - prevS - (lastB - prevB) });
  return out;
}

/** 최대 |자산 기여| / Σ|자산 기여|. 합이 0이면 null. */
export function maxAssetShare(contrib: Readonly<Record<AssetCode, number>>): { code: AssetCode; share: number } | null {
  let sum = 0;
  let best: AssetCode | null = null;
  for (const c of ASSET_CODES) {
    const a = Math.abs(contrib[c]);
    sum += a;
    if (best === null || a > Math.abs(contrib[best])) best = c;
  }
  if (sum <= 0 || best === null) return null;
  return { code: best, share: Math.abs(contrib[best]) / sum };
}

function lastValidClose(panel: Panel, code: AssetCode, idx: number): number | null {
  const arr = panel.assets[code].close;
  for (let i = Math.min(idx, arr.length - 1); i >= 0; i--) {
    const v = arr[i];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/** 세션 구간 [from..to] 의 자산별 손익 기여(현금이자 제외): 구간 내 체결 현금흐름 + 말 평가 − 초 평가(직전 세션 종가 기준). */
export function windowContributions(panel: Panel, trades: readonly Trade[], from: number, to: number): Record<AssetCode, number> {
  const out = {} as Record<AssetCode, number>;
  for (const code of ASSET_CODES) {
    let qtyBefore = 0;
    let qtyTo = 0;
    let flow = 0;
    for (const t of trades) {
      if (t.code !== code || t.index > to) continue;
      const signed = t.side === 'BUY' ? t.qty : -t.qty;
      qtyTo += signed;
      if (t.index < from) qtyBefore += signed;
      else flow += t.side === 'BUY' ? -(t.amount + t.cost) : t.amount - t.cost;
    }
    const pxBefore = qtyBefore !== 0 ? lastValidClose(panel, code, from - 1) : 0;
    const pxTo = qtyTo !== 0 ? lastValidClose(panel, code, to) : 0;
    out[code] = flow + qtyTo * (pxTo ?? 0) - qtyBefore * (pxBefore ?? 0);
  }
  return out;
}

// ── 세후(단순화 사후 민감도) ───────────────────────────────────────────────
export interface TaxResult {
  /** 매도 시점마다 평균단가 기준 실현손익에 세율 적용(손실 통산 없음, 이익 건만 과세). */
  taxTotal: number;
  taxByCode: Record<AssetCode, number>;
  realizedByCode: Record<AssetCode, number>;
  /** 세후 근사 자산곡선 = equity[k] − (k 이전·당일 납부 세금 누계). 이자 손실·재투자 감소는 반영하지 않는다. */
  netEquity: number[];
  taxCount: number;
}

export function afterTaxFromTrades(
  trades: readonly Trade[],
  equity: readonly number[],
  startIndex: number,
  exemptCode: AssetCode = TAX_EXEMPT_CODE,
  rate: number = TAX_RATE,
): TaxResult {
  const qty = {} as Record<AssetCode, number>;
  const basis = {} as Record<AssetCode, number>;
  const taxByCode = {} as Record<AssetCode, number>;
  const realizedByCode = {} as Record<AssetCode, number>;
  for (const c of ASSET_CODES) {
    qty[c] = 0;
    basis[c] = 0;
    taxByCode[c] = 0;
    realizedByCode[c] = 0;
  }
  const taxAt = new Array<number>(equity.length).fill(0);
  let taxCount = 0;
  const sorted = trades.slice().sort((a, b) => a.index - b.index);
  for (const t of sorted) {
    if (t.side === 'BUY') {
      qty[t.code] += t.qty;
      basis[t.code] += t.amount + t.cost;
      continue;
    }
    const avg = qty[t.code] > 0 ? basis[t.code] / qty[t.code] : 0;
    const realized = t.amount - t.cost - avg * t.qty;
    qty[t.code] -= t.qty;
    basis[t.code] -= avg * t.qty;
    if (qty[t.code] < 1e-9) {
      qty[t.code] = 0;
      basis[t.code] = 0;
    }
    realizedByCode[t.code] += realized;
    if (t.code !== exemptCode && realized > 0) {
      const tax = realized * rate;
      taxByCode[t.code] += tax;
      const k = t.index - startIndex;
      if (k >= 0 && k < taxAt.length) taxAt[k] += tax;
      taxCount += 1;
    }
  }
  const netEquity: number[] = new Array(equity.length);
  let cum = 0;
  for (let k = 0; k < equity.length; k++) {
    cum += taxAt[k];
    netEquity[k] = equity[k] - cum;
  }
  const taxTotal = ASSET_CODES.reduce((s, c) => s + taxByCode[c], 0);
  return { taxTotal, taxByCode, realizedByCode, netEquity, taxCount };
}

/** B&H 를 기간 말에 전량 청산한다고 가정한 참고용 과세(069500 비과세). 기본 결과 비교에는 쓰지 않는다. */
export function bhLiquidationTax(panel: Panel, trades: readonly Trade[], endIndex: number, exemptCode: AssetCode = TAX_EXEMPT_CODE, rate: number = TAX_RATE): number {
  let tax = 0;
  for (const code of ASSET_CODES) {
    if (code === exemptCode) continue;
    let qty = 0;
    let basis = 0;
    for (const t of trades) {
      if (t.code !== code) continue;
      if (t.side === 'BUY') {
        qty += t.qty;
        basis += t.amount + t.cost;
      }
    }
    if (qty <= 0) continue;
    const px = lastValidClose(panel, code, endIndex) ?? 0;
    const gain = qty * px - basis;
    if (gain > 0) tax += gain * rate;
  }
  return tax;
}

// ── 판정(§15 기계 적용) ────────────────────────────────────────────────────
export type CriteriaKey = 'c1Mdd20' | 'c2CagrFloor' | 'c3MinEvents' | 'c4Adverse' | 'c5StartMajority' | 'c6Loo' | 'c7Cap' | 'c8Calmar';
export type Criteria = Record<CriteriaKey, boolean>;
export type FinalLabel = '제한된 기간에서 채택 가능' | '채택하지 않음' | '판단 보류' | '집중 의존/불안정' | '구조변경 의존/불안정' | '집중 의존/불안정 + 구조변경 의존/불안정';

export interface LabelDecision {
  allCriteriaMet: boolean;
  concentrated: boolean;
  structural: boolean;
  /** 기준만 본 라벨(채택 가능/채택하지 않음/판단 보류). */
  criteriaLabel: '제한된 기간에서 채택 가능' | '채택하지 않음' | '판단 보류';
  /** 불안정 판정을 적용한 최종 라벨. */
  finalLabel: FinalLabel;
}

/** 사전등록 §15 기계 적용: c3 실패 → 판단 보류. 8기준 모두 충족 → 채택 가능. 아니면 채택하지 않음. 불안정 플래그가 있으면 최종 라벨은 불안정 표기가 우선. */
export function decideLabel(criteria: Criteria, concentrated: boolean, structural: boolean): LabelDecision {
  const keys: CriteriaKey[] = ['c1Mdd20', 'c2CagrFloor', 'c3MinEvents', 'c4Adverse', 'c5StartMajority', 'c6Loo', 'c7Cap', 'c8Calmar'];
  const allCriteriaMet = keys.every(k => criteria[k]);
  const criteriaLabel: LabelDecision['criteriaLabel'] = !criteria.c3MinEvents ? '판단 보류' : allCriteriaMet ? '제한된 기간에서 채택 가능' : '채택하지 않음';
  let finalLabel: FinalLabel = criteriaLabel;
  if (concentrated && structural) finalLabel = '집중 의존/불안정 + 구조변경 의존/불안정';
  else if (concentrated) finalLabel = '집중 의존/불안정';
  else if (structural) finalLabel = '구조변경 의존/불안정';
  if (!criteria.c3MinEvents) finalLabel = '판단 보류';
  return { allCriteriaMet, concentrated, structural, criteriaLabel, finalLabel };
}

// ── 결과 타입 ───────────────────────────────────────────────────────────────
export interface Compare {
  bh: Metrics;
  strat: Metrics;
  mddReduction: number | null;
  cagrDiff: number;
  calmarImproved: boolean;
  meets12: boolean;
}

export interface OffsetRow extends OffsetPlan {
  startDate: string;
  result: Compare | null;
}

export interface LooRow {
  removed: AssetCode;
  weights: Record<AssetCode, number>;
  caps: Record<AssetCode, number>;
  result: Compare;
  pass: boolean;
}

export interface RegimeRow {
  name: 'A' | 'T' | 'B';
  label: string;
  from: string | null;
  to: string | null;
  sessions: number;
  sells: number;
  reentries: number;
  eventRate: number | null;
  stratReturn: number | null;
  bhReturn: number | null;
  returnDiff: number | null;
  stratMdd: number | null;
  bhMdd: number | null;
  stratContribution: number | null;
  bhContribution: number | null;
  contribution379800Strat: number | null;
  contribution379800Bh: number | null;
}

export interface RegimeRemoval {
  removed: 'A' | 'B' | 'T';
  keptSessions: number;
  result: Compare | null;
}

export interface StructuralResult {
  regimes: RegimeRow[];
  signFlip: boolean | null;
  rateRatio: number | null;
  highRateRegime: 'A' | 'B' | null;
  removalOfHighRate: RegimeRemoval | null;
  removalFailsCriteria12: boolean | null;
  withoutTransition: RegimeRemoval | null;
  structural: boolean;
}

export interface ConcentrationResult {
  strategyContributions: Record<AssetCode, number>;
  bhContributions: Record<AssetCode, number>;
  strategyMaxAsset: { code: AssetCode; share: number } | null;
  bhMaxAsset: { code: AssetCode; share: number } | null;
  assetConcentrated: boolean;
  quarters: QuarterContribution[];
  quarterMax: { quarter: string; share: number } | null;
  quarterConcentrated: boolean;
  quarterSumCheck: number;
  /** windowContributions(전 구간) 대 SimResult.contributions 최대 절대오차(원). */
  contributionIdentityError: number;
}

export interface CostRow {
  label: string;
  turnover: number;
  trades: number;
  sellTrades: number;
  totalCostKRW: number;
  sellEvents: number;
}

export interface TaxRow {
  label: string;
  taxTotal: number;
  taxCount: number;
  taxByCode: Record<AssetCode, number>;
  realizedByCode: Record<AssetCode, number>;
  gross: Metrics;
  net: Metrics;
  netVsBhGrossCagrDiff: number;
  netVsBhGrossMddReduction: number | null;
  netVsBhGrossCalmarImproved: boolean;
}

export interface PyramidJudgement {
  interval: string;
  eventsOk: boolean;
  c: Metrics;
  d: Metrics;
  dMddSmaller: boolean;
  cagrDiff: number;
  cagrOk: boolean;
  post21: { c: PostReentryStats; d: PostReentryStats; dSmaller: boolean };
  post63: { c: PostReentryStats; d: PostReentryStats; dSmaller: boolean };
  verdict: '추가 방어 근거 있음' | '불타기 추가근거 없음' | '판단 보류';
  bootstrapDvsC: BootstrapDiffResult;
}

export interface RuleChecks {
  rule: SignalRuleId;
  pyramidInterval: string | null;
  events: ValidationEvents;
  startDate: string;
  endDate: string;
  sessions: number;
  main: Compare;
  adverse: Compare;
  cap: { cap: number; compare: Compare }[];
  offsets: OffsetRow[];
  startMajority: { validStarts: number; metStarts: number; majorityMet: boolean; threeOffsetsOnly: { valid: number; met: number; majorityMet: boolean } };
  loo: { rows: LooRow[]; passCount: number; required: number; met: boolean };
  bootstrapCvsBh: BootstrapDiffResult;
  concentration: ConcentrationResult;
  structural: StructuralResult;
  costs: CostRow[];
  tax: TaxRow[];
  bhLiquidationTaxReference: number;
  pyramid: PyramidJudgement | null;
  criteria: Criteria;
  decision: LabelDecision;
}

export interface AnalyseOptions {
  iterations?: number;
  seed?: number;
  valStart?: string;
  regimeAEnd?: string;
  regimeBStart?: string;
}

function dayNum(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86400000;
}

function compareOf(bh: SimResult, strat: SimResult): Compare {
  const mb = simMetrics(bh);
  const ms = simMetrics(strat);
  const red = mddRelativeReduction(mb.mdd, ms.mdd);
  return {
    bh: mb,
    strat: ms,
    mddReduction: red,
    cagrDiff: ms.cagr - mb.cagr,
    calmarImproved: ms.calmar > mb.calmar,
    meets12: meetsCriteria12(mb.mdd, ms.mdd, mb.cagr, ms.cagr),
  };
}

function compareMetrics(mb: Metrics, ms: Metrics): Compare {
  return {
    bh: mb,
    strat: ms,
    mddReduction: mddRelativeReduction(mb.mdd, ms.mdd),
    cagrDiff: ms.cagr - mb.cagr,
    calmarImproved: ms.calmar > mb.calmar,
    meets12: meetsCriteria12(mb.mdd, ms.mdd, mb.cagr, ms.cagr),
  };
}

function costRow(label: string, r: SimResult): CostRow {
  let total = 0;
  let sells = 0;
  for (const t of r.trades) {
    total += t.cost;
    if (t.side === 'SELL') sells += 1;
  }
  return { label, turnover: r.turnover, trades: r.trades.length, sellTrades: sells, totalCostKRW: total, sellEvents: r.sellEventCount };
}

/** 일별 수익률(기준점 initial 포함). */
function returnsOf(equity: readonly number[]): number[] {
  return dailyReturns([INITIAL_CAPITAL, ...equity]);
}

/** 제거할 세션을 건너뛴 수익률 연결 → 지표. 경과 달력일은 (남은 세션 수 × 전체 달력일/전체 세션 수)로 근사한다. */
function spliceMetrics(equity: readonly number[], dates: readonly string[], keep: readonly boolean[]): Metrics | null {
  const rets = returnsOf(equity);
  const chain: number[] = [1];
  let kept = 0;
  for (let k = 0; k < equity.length; k++) {
    if (!keep[k]) continue;
    kept += 1;
    chain.push(chain[chain.length - 1] * (1 + rets[k]));
  }
  if (kept < 2) return null;
  const totalDays = dayNum(dates[dates.length - 1]) - dayNum(dates[0]);
  const days = (kept * totalDays) / equity.length;
  const c = cagr(1, chain[chain.length - 1], days);
  const m = maxDrawdown(chain);
  const rr = dailyReturns(chain);
  let mean = 0;
  for (const v of rr) mean += v;
  mean /= rr.length;
  let ss = 0;
  for (const v of rr) ss += (v - mean) * (v - mean);
  const vol = rr.length > 1 ? Math.sqrt(ss / (rr.length - 1)) * Math.sqrt(252) : NaN;
  return { cagr: c, mdd: m, calmar: calmar(c, m), vol, finalEquity: chain[chain.length - 1] * INITIAL_CAPITAL };
}

function periodStats(equity: readonly number[], from: number, to: number): { ret: number; mdd: number } {
  const base = from === 0 ? INITIAL_CAPITAL : equity[from - 1];
  const slice = [base, ...equity.slice(from, to + 1)];
  return { ret: equity[to] / base - 1, mdd: maxDrawdown(slice) };
}

/** 한 규칙의 모든 사후 점검. panel/cache/cd91 는 호출자가 주입한다(테스트는 합성 패널). */
export function analyseRule(
  panel: Panel,
  cache: SignalCache,
  cd91: readonly CdRow[],
  sel: SelectedRule,
  opts: AnalyseOptions = {},
): RuleChecks {
  const rule = sel.rule;
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  const seed = opts.seed ?? DEFAULT_SEED;
  const regimeAEnd = opts.regimeAEnd ?? REGIME_A_END;
  const regimeBStart = opts.regimeBStart ?? REGIME_B_START;
  const ctx = buildValidationContext(panel, cache, rule, cd91, opts.valStart);
  const { setup, startIndex, endIndex } = ctx;
  const n = endIndex - startIndex + 1;
  const interval = sel.pyramidInterval as '0.5N' | '4N' | '10pct' | null | undefined;

  const events = validationEventPass(panel, cache, [sel], cd91, undefined, opts.valStart)[0];

  const bh = runSim(setup, 'BH', startIndex, endIndex, COST_BASE);
  const rot = runSim(setup, 'ROTATE', startIndex, endIndex, COST_BASE);
  const main = compareOf(bh, rot);
  const bhA = runSim(setup, 'BH', startIndex, endIndex, COST_ADVERSE);
  const rotA = runSim(setup, 'ROTATE', startIndex, endIndex, COST_ADVERSE);
  const adverse = compareOf(bhA, rotA);
  const cap = [1.25, 2.0].map(m => ({
    cap: m,
    compare: compareOf(runSim(setup, 'BH', startIndex, endIndex, COST_BASE, undefined, m), runSim(setup, 'ROTATE', startIndex, endIndex, COST_BASE, undefined, m)),
  }));

  // §15-5 시작일 오프셋
  const plans = planOffsets(startIndex, endIndex);
  const offsets: OffsetRow[] = plans.map(p => {
    if (!p.valid) return { ...p, startDate: panel.dates[p.startIndex] ?? '', result: null };
    if (p.offset === 0) return { ...p, startDate: panel.dates[p.startIndex], result: main };
    return {
      ...p,
      startDate: panel.dates[p.startIndex],
      result: compareOf(runSim(setup, 'BH', p.startIndex, endIndex, COST_BASE), runSim(setup, 'ROTATE', p.startIndex, endIndex, COST_BASE)),
    };
  });
  const validRows = offsets.filter(o => o.valid && o.result);
  const metRows = validRows.filter(o => o.result?.meets12);
  const three = validRows.filter(o => o.offset !== 0);
  const threeMet = three.filter(o => o.result?.meets12);
  const startMajority = {
    validStarts: validRows.length,
    metStarts: metRows.length,
    majorityMet: metRows.length * 2 > validRows.length,
    threeOffsetsOnly: { valid: three.length, met: threeMet.length, majorityMet: threeMet.length * 2 > three.length },
  };

  // §15-6 leave-one-out
  const looRows: LooRow[] = ctx.codes.map(removed => {
    const weights = looWeights(setup.weights, removed);
    const s2 = { ...setup, weights };
    const result = compareOf(runSim(s2, 'BH', startIndex, endIndex, COST_BASE), runSim(s2, 'ROTATE', startIndex, endIndex, COST_BASE));
    const caps = {} as Record<AssetCode, number>;
    for (const c of ASSET_CODES) caps[c] = weights[c] > 0 ? capFor(weights[c]) : 0;
    return { removed, weights, caps, result, pass: looPass(result.bh.mdd, result.strat.mdd, result.bh.cagr, result.strat.cagr) };
  });
  const looPassCount = looRows.filter(r => r.pass).length;
  const loo = { rows: looRows, passCount: looPassCount, required: LOO_MIN_PASS, met: looPassCount >= LOO_MIN_PASS };

  // 부트스트랩
  const elapsed = dayNum(rot.dates[rot.dates.length - 1]) - dayNum(rot.dates[0]);
  const bootstrapCvsBh = bootstrapPairedDiff(returnsOf(rot.equity), returnsOf(bh.equity), { seed, iterations, meanBlock: DEFAULT_MEAN_BLOCK, elapsedCalendarDays: elapsed });

  // 집중 의존
  const quarters = quarterlyExcessFromEquity(rot.dates, rot.equity, bh.equity, INITIAL_CAPITAL);
  const qMax = quarterShare(quarters);
  const aMax = maxAssetShare(rot.contributions);
  const concentration: ConcentrationResult = {
    strategyContributions: rot.contributions,
    bhContributions: bh.contributions,
    strategyMaxAsset: aMax,
    bhMaxAsset: maxAssetShare(bh.contributions),
    assetConcentrated: aMax !== null && aMax.share > ASSET_CONCENTRATION_LIMIT,
    quarters,
    quarterMax: qMax,
    quarterConcentrated: qMax !== null && qMax.share > QUARTER_CONCENTRATION_LIMIT,
    contributionIdentityError: (() => {
      const w = windowContributions(panel, rot.trades, startIndex, endIndex);
      return Math.max(...ASSET_CODES.map(c => Math.abs(w[c] - rot.contributions[c])));
    })(),
    quarterSumCheck: quarters.reduce((s, q) => s + q.excessPnl, 0) - (rot.equity[rot.equity.length - 1] - bh.equity[bh.equity.length - 1]),
  };

  // 379800 regime
  const inRange = (i: number, name: 'A' | 'T' | 'B'): boolean => {
    const d = panel.dates[i];
    if (name === 'A') return d <= regimeAEnd;
    if (name === 'B') return d >= regimeBStart;
    return d > regimeAEnd && d < regimeBStart;
  };
  const regimeDefs: { name: 'A' | 'T' | 'B'; label: string }[] = [
    { name: 'A', label: `regime A (~${regimeAEnd})` },
    { name: 'T', label: `전환창 (${regimeAEnd} 다음날 ~ ${regimeBStart} 전날)` },
    { name: 'B', label: `regime B (${regimeBStart}~)` },
  ];
  const regimes: RegimeRow[] = regimeDefs.map(def => {
    const idx: number[] = [];
    for (let i = startIndex; i <= endIndex; i++) if (inRange(i, def.name)) idx.push(i);
    if (idx.length === 0) {
      return { name: def.name, label: def.label, from: null, to: null, sessions: 0, sells: 0, reentries: 0, eventRate: null, stratReturn: null, bhReturn: null, returnDiff: null, stratMdd: null, bhMdd: null, stratContribution: null, bhContribution: null, contribution379800Strat: null, contribution379800Bh: null };
    }
    const f = idx[0];
    const t = idx[idx.length - 1];
    const sells = rot.campaigns.filter(c => c.sellSignalIndex >= f && c.sellSignalIndex <= t).length;
    const reentries = rot.campaigns.filter(c => c.completed && c.reentryIndex !== null && c.reentryIndex >= f && c.reentryIndex <= t).length;
    const ps = periodStats(rot.equity, f - startIndex, t - startIndex);
    const pb = periodStats(bh.equity, f - startIndex, t - startIndex);
    const cs = windowContributions(panel, rot.trades, f, t);
    const cb = windowContributions(panel, bh.trades, f, t);
    const sumOf = (r: Record<AssetCode, number>): number => ASSET_CODES.reduce((s, c) => s + r[c], 0);
    return {
      name: def.name,
      label: def.label,
      from: panel.dates[f],
      to: panel.dates[t],
      sessions: idx.length,
      sells,
      reentries,
      eventRate: sells / idx.length,
      stratReturn: ps.ret,
      bhReturn: pb.ret,
      returnDiff: ps.ret - pb.ret,
      stratMdd: ps.mdd,
      bhMdd: pb.mdd,
      stratContribution: sumOf(cs),
      bhContribution: sumOf(cb),
      contribution379800Strat: cs['379800'],
      contribution379800Bh: cb['379800'],
    };
  });
  const regimeA = regimes[0];
  const regimeB = regimes[2];
  const removal = (removed: 'A' | 'T' | 'B'): RegimeRemoval => {
    const keep: boolean[] = [];
    for (let i = startIndex; i <= endIndex; i++) keep.push(!inRange(i, removed));
    const ms = spliceMetrics(rot.equity, rot.dates, keep);
    const mb = spliceMetrics(bh.equity, bh.dates, keep);
    return { removed, keptSessions: keep.filter(Boolean).length, result: ms && mb ? compareMetrics(mb, ms) : null };
  };
  let signFlip: boolean | null = null;
  if (regimeA.returnDiff !== null && regimeB.returnDiff !== null) signFlip = regimeA.returnDiff * regimeB.returnDiff < 0;
  let rateRatio: number | null = null;
  let highRateRegime: 'A' | 'B' | null = null;
  if (regimeA.eventRate !== null && regimeB.eventRate !== null) {
    const ra = regimeA.eventRate;
    const rb = regimeB.eventRate;
    if (ra > REGIME_RATE_RATIO * rb && ra > 0) {
      highRateRegime = 'A';
      rateRatio = rb > 0 ? ra / rb : Infinity;
    } else if (rb > REGIME_RATE_RATIO * ra && rb > 0) {
      highRateRegime = 'B';
      rateRatio = ra > 0 ? rb / ra : Infinity;
    } else {
      rateRatio = ra > 0 && rb > 0 ? Math.max(ra, rb) / Math.min(ra, rb) : null;
    }
  }
  const removalOfHigh = highRateRegime ? removal(highRateRegime) : null;
  const removalFails = removalOfHigh ? (removalOfHigh.result ? !removalOfHigh.result.meets12 : true) : null;
  const structuralFlag = signFlip === true || (highRateRegime !== null && removalFails === true);
  const structural: StructuralResult = {
    regimes,
    signFlip,
    rateRatio,
    highRateRegime,
    removalOfHighRate: removalOfHigh,
    removalFailsCriteria12: removalFails,
    withoutTransition: regimes[1].sessions > 0 ? removal('T') : null,
    structural: structuralFlag,
  };

  // 비용·세후
  let py: SimResult | null = null;
  if (interval) py = runSim(setup, 'ROTATE_PYRAMID', startIndex, endIndex, COST_BASE, interval);
  const costs: CostRow[] = [costRow('B&H', bh), costRow('C 로테이션', rot)];
  if (py) costs.push(costRow('D 로테이션+불타기', py));
  const taxRowOf = (label: string, r: SimResult): TaxRow => {
    const t = afterTaxFromTrades(r.trades, r.equity, startIndex);
    const net = metricsFromEquity(t.netEquity, r.dates, INITIAL_CAPITAL, r.dates[0]);
    const cmp = compareMetrics(main.bh, net);
    return {
      label,
      taxTotal: t.taxTotal,
      taxCount: t.taxCount,
      taxByCode: t.taxByCode,
      realizedByCode: t.realizedByCode,
      gross: simMetrics(r),
      net,
      netVsBhGrossCagrDiff: cmp.cagrDiff,
      netVsBhGrossMddReduction: cmp.mddReduction,
      netVsBhGrossCalmarImproved: cmp.calmarImproved,
    };
  };
  const tax: TaxRow[] = [taxRowOf('C 로테이션', rot)];
  if (py) tax.push(taxRowOf('D 로테이션+불타기', py));

  // 불타기 vs 비불타기
  let pyramid: PyramidJudgement | null = null;
  if (py && interval) {
    const mc = main.strat;
    const md = simMetrics(py);
    const mk = (h: number): { c: PostReentryStats; d: PostReentryStats; dSmaller: boolean } => {
      const c = postReentryStats(rot, startIndex, h);
      const d = postReentryStats(py as SimResult, startIndex, h);
      // MDD 는 음수: 얕다 = 더 큰(0에 가까운) 값.
      return { c, d, dSmaller: !Number.isNaN(c.medianMdd) && !Number.isNaN(d.medianMdd) && Math.abs(d.medianMdd) < Math.abs(c.medianMdd) };
    };
    const post21 = mk(21);
    const post63 = mk(63);
    const dMddSmaller = Math.abs(md.mdd) < Math.abs(mc.mdd);
    const cagrDiff = md.cagr - mc.cagr;
    const cagrOk = cagrDiff >= PYRAMID_CAGR_FLOOR;
    const verdict: PyramidJudgement['verdict'] = !events.pyramidOk
      ? '판단 보류'
      : dMddSmaller && post21.dSmaller && post63.dSmaller && cagrOk
        ? '추가 방어 근거 있음'
        : '불타기 추가근거 없음';
    pyramid = {
      interval,
      eventsOk: events.pyramidOk,
      c: mc,
      d: md,
      dMddSmaller,
      cagrDiff,
      cagrOk,
      post21,
      post63,
      verdict,
      bootstrapDvsC: bootstrapPairedDiff(returnsOf(py.equity), returnsOf(rot.equity), { seed, iterations, meanBlock: DEFAULT_MEAN_BLOCK, elapsedCalendarDays: elapsed }),
    };
  }

  // §15 기준
  const c7 = cap.every(c => !(main.meets12 && !c.compare.meets12));
  const criteria: Criteria = {
    c1Mdd20: main.mddReduction !== null && main.mddReduction >= MDD_REDUCTION_MIN,
    c2CagrFloor: main.cagrDiff >= CAGR_FLOOR,
    c3MinEvents: events.ok,
    c4Adverse: adverse.mddReduction !== null && adverse.mddReduction > 0 && adverse.cagrDiff >= CAGR_FLOOR,
    c5StartMajority: startMajority.majorityMet,
    c6Loo: loo.met,
    c7Cap: c7,
    c8Calmar: main.calmarImproved,
  };
  const decision = decideLabel(criteria, concentration.assetConcentrated || concentration.quarterConcentrated, structural.structural);

  return {
    rule,
    pyramidInterval: interval ?? null,
    events,
    startDate: panel.dates[startIndex],
    endDate: panel.dates[endIndex],
    sessions: n,
    main,
    adverse,
    cap,
    offsets,
    startMajority,
    loo,
    bootstrapCvsBh,
    concentration,
    structural,
    costs,
    tax,
    bhLiquidationTaxReference: bhLiquidationTax(panel, bh.trades, endIndex),
    pyramid,
    criteria,
    decision,
  };
}

// ── P5 대조 ────────────────────────────────────────────────────────────────
export interface P5Row {
  rule: SignalRuleId;
  startDate: string;
  sessions: number;
  weights: Record<AssetCode, number>;
  compare: Compare;
  eventsOk: boolean;
  events: { sells: number; reentries: number; sellAssets: number };
  criteriaPreview: { c1: boolean; c2: boolean; c8: boolean };
}

export function p5Control(panel5: Panel, cache5: SignalCache, cd91: readonly CdRow[], selected: readonly SelectedRule[], valStart?: string): P5Row[] {
  return selected.map(sel => {
    const ctx = buildValidationContext(panel5, cache5, sel.rule, cd91, valStart);
    const bh = runSim(ctx.setup, 'BH', ctx.startIndex, ctx.endIndex, COST_BASE);
    const rot = runSim(ctx.setup, 'ROTATE', ctx.startIndex, ctx.endIndex, COST_BASE);
    const cmp = compareOf(bh, rot);
    const ev = validationEventPass(panel5, cache5, [sel], cd91, undefined, valStart)[0];
    return {
      rule: sel.rule,
      startDate: panel5.dates[ctx.startIndex],
      sessions: ctx.endIndex - ctx.startIndex + 1,
      weights: ctx.setup.weights,
      compare: cmp,
      eventsOk: ev.ok,
      events: { sells: ev.sells, reentries: ev.reentries, sellAssets: ev.sellAssets },
      criteriaPreview: {
        c1: cmp.mddReduction !== null && cmp.mddReduction >= MDD_REDUCTION_MIN,
        c2: cmp.cagrDiff >= CAGR_FLOOR,
        c8: cmp.calmarImproved,
      },
    };
  });
}

// ── 보고서 ─────────────────────────────────────────────────────────────────
function pct(v: number | null | undefined, d = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return 'n/a';
  if (!Number.isFinite(v)) return v > 0 ? '+∞' : '-∞';
  return `${(v * 100).toFixed(d)}%`;
}
function pp(v: number | null | undefined, d = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return 'n/a';
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%p`;
}
function num(v: number | null | undefined, d = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return 'n/a';
  if (!Number.isFinite(v)) return v > 0 ? '+∞' : '-∞';
  return v.toFixed(d);
}
function krw(v: number): string {
  return `${Math.round(v).toLocaleString('en-US')}원`;
}
function ok(b: boolean): string {
  return b ? '충족' : '미충족';
}
function ci(c: { lo: number; hi: number; point: number }, kind: 'pp' | 'num'): string {
  return kind === 'pp' ? `${pp(c.point)} [${pp(c.lo)}, ${pp(c.hi)}]` : `${num(c.point)} [${num(c.lo)}, ${num(c.hi)}]`;
}

export interface SensitivityDoc {
  schema: 'core6-v3-validation-sensitivity-v1';
  generatedAtUtc: string;
  panel: 'P';
  notice: string;
  rules: RuleChecks[];
  p5: P5Row[];
  reproduction: { rule: SignalRuleId; mddReductionDiff: number; cagrDiffDiff: number }[];
}

const CRITERIA_TEXT: Record<CriteriaKey, string> = {
  c1Mdd20: '1. MDD 상대 축소 ≥ 20%',
  c2CagrFloor: '2. CAGR 차이 ≥ −2%p',
  c3MinEvents: '3. 검증 최소 표본·사건·자산 분산',
  c4Adverse: '4. 불리한 비용(0.20%)에서도 MDD 개선 방향 + CAGR 하한 (기본 비용 1·2는 기준 1·2)',
  c5StartMajority: '5. 시작일 민감도 과반에서 1·2 동시 충족',
  c6Loo: '6. leave-one-out 6개 중 ≥5개 통과',
  c7Cap: '7. 상한 1.25배·2배에서 결론 유지',
  c8Calmar: '8. Calmar가 B&H보다 개선',
};

function criteriaEvidence(r: RuleChecks, key: CriteriaKey): string {
  switch (key) {
    case 'c1Mdd20':
      return `B&H ${pct(r.main.bh.mdd)} → C ${pct(r.main.strat.mdd)}, 상대 축소 ${pct(r.main.mddReduction)}`;
    case 'c2CagrFloor':
      return `B&H ${pct(r.main.bh.cagr)} → C ${pct(r.main.strat.cagr)}, 차이 ${pp(r.main.cagrDiff)}`;
    case 'c3MinEvents':
      return `유효일 ${r.events.days}, 매도 ${r.events.sells}, 재진입 ${r.events.reentries}, 매도 자산 ${r.events.sellAssets}${r.events.reasons.length ? ` (미달: ${r.events.reasons.join('; ')})` : ''}`;
    case 'c4Adverse':
      return `0.20%: MDD 축소 ${pct(r.adverse.mddReduction)}, CAGR 차이 ${pp(r.adverse.cagrDiff)} (기본 비용의 1·2는 기준 1·2에서 별도 판정)`;
    case 'c5StartMajority':
      return `유효 시작 ${r.startMajority.validStarts}개 중 ${r.startMajority.metStarts}개 충족 (오프셋 3개만: ${r.startMajority.threeOffsetsOnly.met}/${r.startMajority.threeOffsetsOnly.valid})`;
    case 'c6Loo':
      return `${r.loo.passCount}/${r.loo.rows.length}개 통과 (기준 ≥${r.loo.required})`;
    case 'c7Cap':
      return r.cap.map(c => `${c.cap}배: MDD 축소 ${pct(c.compare.mddReduction)}, CAGR 차이 ${pp(c.compare.cagrDiff)}`).join(' / ') + ` (기본에서 1·2 ${ok(r.main.meets12)}${r.main.meets12 ? '' : ' → 뒤집힘 없음으로 판정'})`;
    case 'c8Calmar':
      return `B&H ${num(r.main.bh.calmar)} → C ${num(r.main.strat.calmar)}`;
  }
}

function easySummary(rules: RuleChecks[]): string {
  const L: string[] = ['## 쉬운 요약 (50대 초보용)', ''];
  L.push('이미 나온 검증 결과(2024년 7월 ~ 2026년 9월)를 **여러 방식으로 흔들어 보고 다시 확인**한 점검표입니다. 규칙과 기준은 하나도 바꾸지 않았습니다.');
  L.push('"그냥 계속 들고 있기(B&H)"와 "신호가 나쁠 때 팔았다가 다시 사는 방식(로테이션)"을 비교합니다.');
  L.push('');
  for (const r of rules) {
    const d = r.decision;
    L.push(`### ${r.rule} 규칙 — 판정 라벨: **${d.finalLabel}**`);
    L.push(`- 가장 크게 떨어졌던 폭: 계속 들고 있었다면 ${pct(r.main.bh.mdd, 1)}, 이 방식은 ${pct(r.main.strat.mdd, 1)} (줄어든 비율 ${pct(r.main.mddReduction, 1)}; 기준은 20% 이상).`);
    L.push(`- 연 수익률: 계속 들고 있기 ${pct(r.main.bh.cagr, 1)}, 이 방식 ${pct(r.main.strat.cagr, 1)} (차이 ${pp(r.main.cagrDiff, 1)}; 기준은 −2%p 이상).`);
    const fails = (Object.keys(r.criteria) as CriteriaKey[]).filter(k => !r.criteria[k]);
    L.push(`- 8개 기준 중 ${8 - fails.length}개 충족${fails.length ? `, 미충족: ${fails.map(k => CRITERIA_TEXT[k].split('. ')[1]).join(' / ')}` : ''}.`);
    if (d.finalLabel !== d.criteriaLabel) {
      L.push(`- 라벨 설명: 8개 기준만 보면 "${d.criteriaLabel}"이지만, 사전등록 규칙상 ${d.structural ? '379800 전환 전후로 성과 차이의 부호가 뒤집혀(전환 전 구간 ' + pp(r.structural.regimes[0].returnDiff, 1) + ', 전환 후 구간 ' + pp(r.structural.regimes[2].returnDiff, 1) + ')' : ''}${d.concentrated ? ' 한 곳에 쏠려' : ''} "불안정" 표시가 붙어 최종 라벨이 "${d.finalLabel}"입니다. 이 라벨은 "지금 당장 틀렸다"가 아니라 "결과가 특정 구간에 좌우될 수 있어 확신하기 어렵다"는 뜻입니다.`);
    }
    L.push(`- 불확실성: 연 수익률 차이의 95% 구간은 ${pp(r.bootstrapCvsBh.cagrDiff.lo, 1)} ~ ${pp(r.bootstrapCvsBh.cagrDiff.hi, 1)}로 ${r.bootstrapCvsBh.cagrDiff.lo < 0 && r.bootstrapCvsBh.cagrDiff.hi > 0 ? '0을 포함합니다(우연과 구분하기 어렵습니다)' : '0을 포함하지 않습니다'}.`);
    L.push(`- 흔들어 본 결과: 시작일을 늦춰도 ${r.startMajority.metStarts}/${r.startMajority.validStarts}번 기준 충족, 자산 1개를 빼고 다시 해보면 ${r.loo.passCount}/${r.loo.rows.length}번 통과.`);
    const ca = r.concentration.strategyMaxAsset;
    L.push(`- 한 곳에 쏠렸나: 최대 자산(${ca ? ca.code : 'n/a'}) 비중 ${pct(ca?.share, 1)}${r.concentration.assetConcentrated ? ' → 쏠림(기준 50% 초과)' : ''}; 단일 분기 초과성과 비중 ${pct(r.concentration.quarterMax?.share, 1)}${r.concentration.quarterConcentrated ? ' → 쏠림(기준 60% 초과)' : ''}.`);
    L.push(`- 세금까지 빼면(단순 가정, 세무 판단 아님): 연 수익률 ${pct(r.tax[0].net.cagr, 1)} (세전 ${pct(r.tax[0].gross.cagr, 1)}). B&H는 팔기 전까지 세금이 없는 상태 그대로라 이 비교는 로테이션에 불리합니다.`);
    if (r.pyramid) L.push(`- 불타기(오를 때 더 사는 방식)는 ${r.pyramid.verdict}: 연 수익률 ${pp(r.pyramid.cagrDiff, 1)} 차이, 최대낙폭 ${pct(r.pyramid.c.mdd, 1)} → ${pct(r.pyramid.d.mdd, 1)}.`);
    L.push('');
  }
  L.push('**주의**: 검증 기간은 약 2년이고 상승한 시기가 큽니다. 이 결과는 "과거 한 번의 짧은 구간에서 이랬다"는 기록일 뿐 미래 수익을 보장하지 않으며, 투자 조언이나 세무 판단이 아닙니다.');
  L.push('');
  return L.join('\n');
}

export function buildReport(doc: SensitivityDoc): string {
  const L: string[] = [];
  L.push('# 코어 6종 신호 로테이션 V3 — 검증구간 사후 점검 보고서');
  L.push('');
  L.push(`> 생성: ${doc.generatedAtUtc} · 패널 P · 검증구간 ${doc.rules[0]?.startDate}~${doc.rules[0]?.endDate} (${doc.rules[0]?.sessions}세션) · 기본 비용 편도 0.10% · 상한 1.5×/35%`);
  L.push('> 성격: **사후 점검**. 선택(MA50, D55/55, 불타기 간격 10pct)·규칙·기준은 선택 잠금 그대로이며 이 결과로 바꾸지 않는다. 사전등록 §15 규칙을 기계적으로 적용한 값만 라벨로 쓴다.');
  L.push('');
  L.push(easySummary(doc.rules));
  L.push('---');
  L.push('');
  L.push('## 1. §15 기준 체크리스트 (C 로테이션 대 B&H)');
  L.push('');
  for (const r of doc.rules) {
    L.push(`### ${r.rule}`);
    L.push('');
    L.push('| 기준 | 판정 | 근거 수치 |');
    L.push('|---|---|---|');
    for (const k of Object.keys(CRITERIA_TEXT) as CriteriaKey[]) L.push(`| ${CRITERIA_TEXT[k]} | **${ok(r.criteria[k])}** | ${criteriaEvidence(r, k)} |`);
    L.push(`| 불안정(집중): 최대 자산 >50% 또는 단일 분기 >60% | **${r.decision.concentrated ? '해당' : '비해당'}** | 자산 ${r.concentration.strategyMaxAsset?.code ?? 'n/a'} ${pct(r.concentration.strategyMaxAsset?.share)} / 분기 ${r.concentration.quarterMax?.quarter ?? 'n/a'} ${pct(r.concentration.quarterMax?.share)} |`);
    L.push(`| 불안정(구조변경): 379800 regime 부호 반전 또는 사건률 3배+제거 시 1·2 실패 | **${r.decision.structural ? '해당' : '비해당'}** | 부호반전 ${r.structural.signFlip === null ? 'n/a' : r.structural.signFlip ? '예' : '아니오'}; 사건률 배수 ${num(r.structural.rateRatio)} (3배 초과 regime: ${r.structural.highRateRegime ?? '없음'}) |`);
    L.push('');
    L.push(`**라벨 후보(기준만): ${r.decision.criteriaLabel}** · **최종 라벨(불안정 판정 적용): ${r.decision.finalLabel}**`);
    L.push('');
  }
  L.push('## 2. 라벨 후보 요약');
  L.push('');
  L.push('| 규칙 | 충족 기준 수 | 기준 라벨 | 집중 | 구조변경 | 최종 라벨 | 불타기 판정 |');
  L.push('|---|---:|---|---|---|---|---|');
  for (const r of doc.rules) {
    const met = (Object.keys(r.criteria) as CriteriaKey[]).filter(k => r.criteria[k]).length;
    L.push(`| ${r.rule} | ${met}/8 | ${r.decision.criteriaLabel} | ${r.decision.concentrated ? '예' : '아니오'} | ${r.decision.structural ? '예' : '아니오'} | **${r.decision.finalLabel}** | ${r.pyramid?.verdict ?? 'n/a'} |`);
  }
  L.push('');
  L.push('라벨 적용 순서(기계적): 기준 3 미달 → `판단 보류`. 아니면 8기준 모두 충족 → `제한된 기간에서 채택 가능`, 하나라도 미충족 → `채택하지 않음`. 그 위에 집중/구조변경 플래그가 있으면 최종 라벨은 해당 불안정 표기로 대체한다(§15는 두 불안정의 우선순위를 정하지 않아 둘 다 해당하면 병기).');
  L.push('');

  L.push('## 3. 기본 결과 재현 (VALIDATION_RESULT_P.txt와 일치 확인)');
  L.push('');
  L.push('| 규칙 | 전략 | CAGR | MDD | Calmar | 변동성 | 최종 평가액 |');
  L.push('|---|---|---:|---:|---:|---:|---:|');
  for (const r of doc.rules) {
    L.push(`| ${r.rule} | B&H | ${pct(r.main.bh.cagr)} | ${pct(r.main.bh.mdd)} | ${num(r.main.bh.calmar)} | ${pct(r.main.bh.vol)} | ${krw(r.main.bh.finalEquity)} |`);
    L.push(`| ${r.rule} | C 로테이션 | ${pct(r.main.strat.cagr)} | ${pct(r.main.strat.mdd)} | ${num(r.main.strat.calmar)} | ${pct(r.main.strat.vol)} | ${krw(r.main.strat.finalEquity)} |`);
    if (r.pyramid) L.push(`| ${r.rule} | D 불타기(${r.pyramid.interval}) | ${pct(r.pyramid.d.cagr)} | ${pct(r.pyramid.d.mdd)} | ${num(r.pyramid.d.calmar)} | ${pct(r.pyramid.d.vol)} | ${krw(r.pyramid.d.finalEquity)} |`);
  }
  L.push('');
  L.push(`재현 차이(점검 값 − 원 검증 결과): ${doc.reproduction.map(x => `${x.rule} MDD축소 ${x.mddReductionDiff.toExponential(1)}, CAGR차 ${x.cagrDiffDiff.toExponential(1)}`).join(' · ')}`);
  L.push('');

  L.push('## 4. §15-5 시작일 오프셋');
  L.push('');
  for (const r of doc.rules) {
    L.push(`### ${r.rule}`);
    L.push('');
    L.push('| 오프셋(거래일) | 시작일 | 잔여일 | 유효 | B&H MDD | C MDD | MDD 축소 | CAGR 차이 | Calmar(B&H→C) | 1·2 충족 |');
    L.push('|---:|---|---:|---|---:|---:|---:|---:|---|---|');
    for (const o of r.offsets) {
      const c = o.result;
      L.push(`| +${o.offset} | ${o.startDate} | ${o.days} | ${o.valid ? '예' : '아니오(<180)'} | ${c ? pct(c.bh.mdd) : '-'} | ${c ? pct(c.strat.mdd) : '-'} | ${c ? pct(c.mddReduction) : '-'} | ${c ? pp(c.cagrDiff) : '-'} | ${c ? `${num(c.bh.calmar)}→${num(c.strat.calmar)}` : '-'} | ${c ? ok(c.meets12) : '-'} |`);
    }
    L.push('');
    L.push(`과반 판정: 주 시작 포함 유효 ${r.startMajority.validStarts}개 중 ${r.startMajority.metStarts}개 충족 → **${ok(r.startMajority.majorityMet)}** (오프셋 3개만 보면 ${r.startMajority.threeOffsetsOnly.met}/${r.startMajority.threeOffsetsOnly.valid} → ${ok(r.startMajority.threeOffsetsOnly.majorityMet)}).`);
    L.push('');
  }

  L.push('## 5. §15-6 leave-one-out');
  L.push('');
  for (const r of doc.rules) {
    L.push(`### ${r.rule} — ${r.loo.passCount}/${r.loo.rows.length} 통과 (기준 ≥${r.loo.required}) → **${ok(r.loo.met)}**`);
    L.push('');
    L.push('| 제거 자산 | B&H MDD | C MDD | B&H CAGR | C CAGR | CAGR 차이 | MDD 얕음 | 통과 |');
    L.push('|---|---:|---:|---:|---:|---:|---|---|');
    for (const x of r.loo.rows) {
      L.push(`| ${x.removed} | ${pct(x.result.bh.mdd)} | ${pct(x.result.strat.mdd)} | ${pct(x.result.bh.cagr)} | ${pct(x.result.strat.cagr)} | ${pp(x.result.cagrDiff)} | ${Math.abs(x.result.strat.mdd) < Math.abs(x.result.bh.mdd) ? '예' : '아니오'} | **${x.pass ? '통과' : '실패'}** |`);
    }
    L.push('');
  }

  L.push('## 6. 부트스트랩 신뢰구간 (stationary block, 평균 21일, 10,000회, seed 260101, 95% percentile)');
  L.push('');
  L.push('기술적 구간이다. 후보 선택 절차를 보정한 확증적 검정이 아니다. 차이 = 전략 − 비교대상(MDD는 음수이므로 양수 = 전략이 얕음).');
  L.push('');
  L.push('| 비교 | CAGR 차이 [95% CI] | MDD 차이 [95% CI] | Calmar 차이 [95% CI] |');
  L.push('|---|---|---|---|');
  for (const r of doc.rules) {
    const b = r.bootstrapCvsBh;
    L.push(`| ${r.rule}: C − B&H | ${ci(b.cagrDiff, 'pp')} | ${ci(b.mddDiff, 'pp')} | ${ci(b.calmarDiff, 'num')} |`);
    if (r.pyramid) {
      const d = r.pyramid.bootstrapDvsC;
      L.push(`| ${r.rule}: D(불타기) − C | ${ci(d.cagrDiff, 'pp')} | ${ci(d.mddDiff, 'pp')} | ${ci(d.calmarDiff, 'num')} |`);
    }
  }
  L.push('');

  L.push('## 7. 집중 의존');
  L.push('');
  for (const r of doc.rules) {
    const c = r.concentration;
    L.push(`### ${r.rule}`);
    L.push('');
    L.push(`자산별 손익 기여(원, 현금이자 제외; 합 ≠ 총손익, 이자 별도). 최대 자산 비중(C): ${c.strategyMaxAsset ? `${c.strategyMaxAsset.code} ${pct(c.strategyMaxAsset.share)}` : 'n/a'} → ${c.assetConcentrated ? '**집중(>50%)**' : '비집중'} · 참고 B&H: ${c.bhMaxAsset ? `${c.bhMaxAsset.code} ${pct(c.bhMaxAsset.share)}` : 'n/a'}`);
    L.push('');
    L.push('| 자산 | C 기여 | B&H 기여 | C − B&H | |C| 비중 |');
    L.push('|---|---:|---:|---:|---:|');
    const sumAbs = ASSET_CODES.reduce((s, k) => s + Math.abs(c.strategyContributions[k]), 0);
    for (const k of ASSET_CODES) {
      L.push(`| ${k} | ${krw(c.strategyContributions[k])} | ${krw(c.bhContributions[k])} | ${krw(c.strategyContributions[k] - c.bhContributions[k])} | ${pct(sumAbs > 0 ? Math.abs(c.strategyContributions[k]) / sumAbs : null, 1)} |`);
    }
    L.push('');
    L.push(`분기별 초과손익(C − B&H, 원). 단일 분기 최대 비중(양의 초과손익 합 대비): ${c.quarterMax ? `${c.quarterMax.quarter} ${pct(c.quarterMax.share)}` : 'n/a'} → ${c.quarterConcentrated ? '**집중(>60%)**' : '비집중'}. 합계 항등식 오차 ${num(c.quarterSumCheck, 6)}원.`);
    L.push('');
    L.push('| 분기 | 초과손익 |');
    L.push('|---|---:|');
    for (const q of c.quarters) L.push(`| ${q.quarter} | ${krw(q.excessPnl)} |`);
    L.push('');
  }

  L.push('## 8. 379800 구조변경 서술 (2025-01-24 분배형 전환, 2025-02-21 기초지수 TR→PR)');
  L.push('');
  L.push('TR 단일 장부에서는 경제적으로 연속이므로 서술 중심이며, 판정은 V2 §15 산식을 기계 적용한 것이다. 기여는 현금이자를 제외한 자산 손익.');
  L.push('');
  for (const r of doc.rules) {
    const s = r.structural;
    L.push(`### ${r.rule}`);
    L.push('');
    L.push('| 구간 | 기간 | 세션 | 매도 사건 | 재진입 | 세션당 사건률 | C 수익률 | B&H 수익률 | 차이 | C MDD | B&H MDD | C 기여합 | 379800 기여(C / B&H) |');
    L.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|');
    for (const g of s.regimes) {
      L.push(`| ${g.label} | ${g.from ?? '-'}~${g.to ?? '-'} | ${g.sessions} | ${g.sells} | ${g.reentries} | ${g.eventRate === null ? 'n/a' : g.eventRate.toFixed(4)} | ${pct(g.stratReturn)} | ${pct(g.bhReturn)} | ${pp(g.returnDiff)} | ${pct(g.stratMdd)} | ${pct(g.bhMdd)} | ${g.stratContribution === null ? 'n/a' : krw(g.stratContribution)} | ${g.contribution379800Strat === null ? 'n/a' : `${krw(g.contribution379800Strat)} / ${krw(g.contribution379800Bh ?? 0)}`} |`);
    }
    L.push('');
    L.push(`- 성과 차이(C−B&H) 부호 반전(A vs B): **${s.signFlip === null ? 'n/a' : s.signFlip ? '예' : '아니오'}**`);
    L.push(`- 세션당 사건률 비: ${num(s.rateRatio)} (3배 초과 regime: ${s.highRateRegime ?? '없음'})`);
    if (s.removalOfHighRate) {
      const x = s.removalOfHighRate.result;
      L.push(`- 사건률 높은 regime(${s.removalOfHighRate.removed}) 제거(남은 ${s.removalOfHighRate.keptSessions}세션, 수익률 연결): ${x ? `MDD 축소 ${pct(x.mddReduction)}, CAGR 차이 ${pp(x.cagrDiff)} → 1·2 ${ok(x.meets12)}` : 'n/a'}`);
    }
    if (s.withoutTransition?.result) {
      const x = s.withoutTransition.result;
      L.push(`- 전환창 제외(남은 ${s.withoutTransition.keptSessions}세션): MDD 축소 ${pct(x.mddReduction)}, CAGR 차이 ${pp(x.cagrDiff)}, Calmar ${num(x.bh.calmar)}→${num(x.strat.calmar)} → 1·2 ${ok(x.meets12)}`);
    }
    L.push(`- **구조변경 의존/불안정 판정: ${s.structural ? '해당' : '비해당'}**`);
    L.push('');
  }

  L.push('## 9. P5 대조 (464470 제외 5종, 비중 재정규화)');
  L.push('');
  L.push('검증구간에는 합성 구간이 없으므로 P와의 차이는 464470 포함 여부와 비중 재정규화뿐이다. 판정이 아니라 대조.');
  L.push('');
  L.push('| 규칙 | 시작 | B&H CAGR/MDD | C CAGR/MDD | MDD 축소 | CAGR 차이 | Calmar(B&H→C) | 사건 충족 | 기준1 | 기준2 | 기준8 |');
  L.push('|---|---|---|---|---:|---:|---|---|---|---|---|');
  for (const p of doc.p5) {
    L.push(`| ${p.rule} | ${p.startDate} | ${pct(p.compare.bh.cagr)} / ${pct(p.compare.bh.mdd)} | ${pct(p.compare.strat.cagr)} / ${pct(p.compare.strat.mdd)} | ${pct(p.compare.mddReduction)} | ${pp(p.compare.cagrDiff)} | ${num(p.compare.bh.calmar)}→${num(p.compare.strat.calmar)} | ${p.eventsOk ? '예' : '아니오'} | ${ok(p.criteriaPreview.c1)} | ${ok(p.criteriaPreview.c2)} | ${ok(p.criteriaPreview.c8)} |`);
  }
  L.push('');

  L.push('## 10. 세후 사후 민감도 (단순화 · 세무 판단 아님)');
  L.push('');
  L.push('가정: 일반 위탁계좌. 069500(국내 주식형 ETF) 매매차익 비과세. 나머지 5종은 **매도 건별** 실현이익(평균단가 기준, 매수 비용 포함 취득가)에 15.4%, 손실 통산·이월 없음, 매도 시점에 현금에서 납부(세후 자산곡선은 세금 누계를 차감한 근사이며 납부 현금의 이자·재투자 감소는 반영하지 않음). 과표기준가·분배 과세·금융소득종합과세·세법 변경 미반영.');
  L.push('**B&H는 기간 말까지 팔지 않아 미실현 상태(과세 없음)로 두었으므로 이 비교는 로테이션에 불리하게 설계된 것**이다. 참고로 B&H를 기간 말에 전량 청산한다고 가정하면 세금은 규칙과 무관하게 약 ' + krw(doc.rules[0]?.bhLiquidationTaxReference ?? 0) + '이다(참고값, 비교에는 쓰지 않음).');
  L.push('');
  L.push('| 규칙 | 전략 | 세금 합계 | 과세 매도 건수 | 세전 CAGR | 세후 CAGR | 세후 MDD | 세후 최종 평가액 | 세후 − B&H(세전) CAGR | MDD 축소 | Calmar 개선 |');
  L.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const r of doc.rules) {
    L.push(`| ${r.rule} | B&H(세금 없음) | 0원 | 0 | ${pct(r.main.bh.cagr)} | ${pct(r.main.bh.cagr)} | ${pct(r.main.bh.mdd)} | ${krw(r.main.bh.finalEquity)} | - | - | - |`);
    for (const t of r.tax) {
      L.push(`| ${r.rule} | ${t.label} | ${krw(t.taxTotal)} | ${t.taxCount} | ${pct(t.gross.cagr)} | ${pct(t.net.cagr)} | ${pct(t.net.mdd)} | ${krw(t.net.finalEquity)} | ${pp(t.netVsBhGrossCagrDiff)} | ${pct(t.netVsBhGrossMddReduction)} | ${t.netVsBhGrossCalmarImproved ? '예' : '아니오'} |`);
    }
  }
  L.push('');

  L.push('## 11. 비용·회전율 비교');
  L.push('');
  L.push('| 규칙 | 전략 | 회전율 | 체결 횟수 | 매도 체결 | 매도 신호 사건 | 총 비용(편도 0.10%) |');
  L.push('|---|---|---:|---:|---:|---:|---:|');
  for (const r of doc.rules) for (const c of r.costs) L.push(`| ${r.rule} | ${c.label} | ${num(c.turnover)} | ${c.trades} | ${c.sellTrades} | ${c.sellEvents} | ${krw(c.totalCostKRW)} |`);
  L.push('');

  L.push('## 12. 불타기 판정 (같은 신호의 비불타기 C 대비, §15 마지막 문단)');
  L.push('');
  L.push('| 규칙 | 간격 | 사건 기준 | D MDD(C MDD) | MDD 더 얕음 | 21일 재진입후 MDD 중앙값 D(C) | 63일 D(C) | CAGR 차이(D−C) | ≥−1%p | 판정 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of doc.rules) {
    const p = r.pyramid;
    if (!p) continue;
    L.push(`| ${r.rule} | ${p.interval} | ${p.eventsOk ? '충족' : '미충족'} | ${pct(p.d.mdd)} (${pct(p.c.mdd)}) | ${p.dMddSmaller ? '예' : '아니오'} | ${pct(p.post21.d.medianMdd)} (${pct(p.post21.c.medianMdd)}) ${p.post21.dSmaller ? '더 얕음' : '더 얕지 않음'} | ${pct(p.post63.d.medianMdd)} (${pct(p.post63.c.medianMdd)}) ${p.post63.dSmaller ? '더 얕음' : '더 얕지 않음'} | ${pp(p.cagrDiff)} | ${p.cagrOk ? '예' : '아니오'} | **${p.verdict}** |`);
  }
  L.push('');
  L.push('재진입 후 horizon 우측 검열(관측 불가) 건수: ' + doc.rules.map(r => (r.pyramid ? `${r.rule} 21일 C ${r.pyramid.post21.c.censored}/D ${r.pyramid.post21.d.censored}, 63일 C ${r.pyramid.post63.c.censored}/D ${r.pyramid.post63.d.censored}` : '')).filter(Boolean).join(' · '));
  L.push('');

  L.push('## 13. 한계 (정직하게)');
  L.push('');
  L.push('- 검증구간은 약 2년(547세션)으로 짧고, 하나의 시장 국면(상승 위주 + 2025년 급락·반등)만 담는다. 통계적 확증이 아니다.');
  L.push('- 이 구간의 B&H CAGR이 이미 매우 높고(금·주식 동반 상승) 한 자산(금 411060)의 기여가 크다. 집중 판정은 시장 구성 효과와 전략 효과를 구분하지 못한다.');
  L.push('- 개발 순위가 2022년 한 국면에 의존했을 가능성(`개발 순위 불안정`)이 선택 잠금에 기록되어 있다(MA50 rankUnstable=true).');
  L.push('- 사건 수가 작다(D55/55 매도 17건 등). 부트스트랩 CI는 선택 절차를 보정하지 않았다.');
  L.push('- 시작일 오프셋 4개·LOO 6개는 서로 크게 겹치는 표본이라 독립 증거가 아니다.');
  L.push('- 데이터 출처는 앱 백엔드 조정 시세(정정 2)이며 독립 KRX 검증(DG5)이 없다.');
  L.push('- 세후는 단순 근사이며 B&H에 유리하게(미실현 이연) 설계되어 실제 세후 우열을 판단하지 못한다.');
  L.push('- 이 보고서는 연구 기록이며 투자 조언이나 세무 판단이 아니다.');
  L.push('');
  L.push('## 14. 해석이 모호했던 점 (구현 선택)');
  L.push('');
  L.push('1. 기준 5 "과반": 주 시작(0) 포함 유효 시작 전체 중 엄격 과반(>½)을 주 판정으로 쓰고, 오프셋 3개만 본 값을 병기했다.');
  L.push('2. 기준 4·7: 원 검증 실행기(`runValidation.ts`)와 같은 정의를 썼다. 특히 기준 7은 "기본에서 1·2를 충족했는데 상한 변경 시 깨지는가"로 정의돼 있어, 기본에서 1·2를 충족하지 못하는 규칙은 자동 충족이 된다(기준 1·2 미충족이 이미 반영됨).');
  L.push('3. 사건률: 세션당 **매도 신호 사건 수(전 자산 합)**. 재진입 수는 병기만 한다.');
  L.push('4. regime 제거: 해당 세션을 건너뛰고 일별 수익률을 이어 붙였으며 경과 일수는 남은 세션 비례로 근사했다.');
  L.push('5. 성과 차이 부호 반전: regime별 **기간 수익률 차이(C − B&H)** 의 부호로 판단(연율화 안 함).');
  L.push('6. 두 불안정 판정이 동시에 해당할 때의 우선순위는 §15에 없어 병기했다. 불안정 플래그가 있으면 기준 충족 여부와 무관하게 최종 라벨은 불안정 표기가 우선한다(채택 불가 방향으로 보수적 해석).');
  L.push('7. 구조변경 부호 반전은 regime A의 성과 차이가 작은 음수(수 %p)라 해석(기간 수익률 대 연율화, regime 경계 포함 여부)에 민감하다. 수치는 §8 표를 직접 볼 것. 라벨은 위 정의대로 기계 적용했다.');
  L.push('8. 세후: 매도 건별 과세(손실 통산 없음)로 해석했으며, 1과세연도 합산·기본공제는 반영하지 않았다.');
  L.push('');
  L.push(doc.notice);
  L.push('');
  return L.join('\n');
}

function jsonReplacer(_k: string, v: unknown): unknown {
  if (typeof v === 'number' && !Number.isFinite(v)) return Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity';
  return v;
}

const NOTICE = '※ 사후 탐색적 점검입니다. 규칙·후보·기준을 바꾸는 근거로 쓸 수 없고, 세무·투자 판단이 아닙니다.';

export function runChecks(opts: AnalyseOptions = {}): SensitivityDoc {
  const run = runValidation('P'); // 잠금 해시 검증 포함(불일치 시 throw)
  const { panel, sha256: panelSha } = loadPanel('P');
  const cache = loadOrComputeSignalCache('P', panel, panelSha);
  const cd91 = loadCd91();
  const rules = run.lock.selected.map(sel => analyseRule(panel, cache, cd91, sel, opts));
  const reproduction = rules.map((r, i) => {
    const perf = run.performance[i];
    if (!perf) throw new Error(`원 검증 성과가 없습니다(${r.rule}) — 재현 불가.`);
    const dRed = (r.main.mddReduction ?? NaN) - (perf.mddReduction ?? NaN);
    const dCagr = r.main.cagrDiff - perf.cagrDiff;
    if (!(Math.abs(dRed) < 1e-9) || !(Math.abs(dCagr) < 1e-9)) throw new Error(`재현 불일치(${r.rule}): MDD축소 ${dRed}, CAGR차 ${dCagr}`);
    if (perf.criteria.capStable !== r.criteria.c7Cap || perf.criteria.adverseHolds !== r.criteria.c4Adverse) {
      throw new Error(`기준 4/7 재현 불일치(${r.rule})`);
    }
    return { rule: r.rule, mddReductionDiff: dRed, cagrDiffDiff: dCagr };
  });
  const p5 = loadPanel('P5');
  const p5rows = p5Control(p5.panel, loadOrComputeSignalCache('P5', p5.panel, p5.sha256), cd91, run.lock.selected);
  return { schema: 'core6-v3-validation-sensitivity-v1', generatedAtUtc: new Date().toISOString(), panel: 'P', notice: NOTICE, rules, p5: p5rows, reproduction };
}

if (isMainModule(import.meta.url)) {
  const jsonPath = path.join(OUTPUT_DIR, 'VALIDATION_SENSITIVITY.json');
  const mdPath = path.join(OUTPUT_DIR, 'VALIDATION_SENSITIVITY_REPORT.md');
  if (existsSync(jsonPath) || existsSync(mdPath)) throw new Error('산출물이 이미 존재합니다(덮어쓰기 금지). 지우고 다시 실행하세요.');
  const doc = runChecks();
  writeFileSync(jsonPath, JSON.stringify(doc, jsonReplacer, 2));
  writeFileSync(mdPath, buildReport(doc));
  process.stdout.write(`저장: ${jsonPath}\n저장: ${mdPath}\n`);
  for (const r of doc.rules) {
    process.stdout.write(`${r.rule}: ${r.decision.criteriaLabel} / 최종 ${r.decision.finalLabel} / 기준 ${Object.entries(r.criteria).map(([k, v]) => `${k}=${v ? 'O' : 'X'}`).join(' ')}\n`);
  }
}
