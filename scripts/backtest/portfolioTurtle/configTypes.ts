// scripts/backtest/portfolioTurtle/configTypes.ts
// 동결 설정의 명시적 타입 + unknown 기반 런타임 검증. 검증 실패 시 즉시 throw(fail-closed).
// "any 절대 금지" 준수 — config를 any로 캐스팅하지 않고 검증 후 좁힌다.

export type ExitRuleId = 'W1' | 'W2' | 'W3' | 'W4';
export type SizingId = 'B' | 'G' | 'A' | 'C';
export type ScopeId = 'S-ALL' | 'S-CORE-EXCL';

export interface DonchianExitRuleConfig { method: 'donchian'; lookback: number; currentBarExcluded: true }
export interface AtrTrailingExitRuleConfig { method: 'atrTrailing'; atrPeriod: number; multiple: number }
export interface SmaCrossExitRuleConfig { method: 'smaCross'; period: number; currentBarIncluded: true }
export type ExitRuleConfig = DonchianExitRuleConfig | AtrTrailingExitRuleConfig | SmaCrossExitRuleConfig;

export interface SizingVariantConfig {
  riskPerUnitPct: number;
  maxUnits: number;
  positionCapPct: number | null;
  pyramid: 'none' | 'fixed-cap-div4' | 'recompute-each-time' | 'fixed-first-entry';
  pyramidStepN?: number;
}

export interface ComboConfig {
  id: string;
  exitRule: ExitRuleId;
  sizing: SizingId;
  positionCapPct: number | null;
  drawdownScaling: boolean;
  scope: ScopeId;
}

export interface PortfolioTurtleConfig {
  hypothesisId: string;
  evidenceGrade: string;
  entry: { method: 'donchian'; lookback: number; currentBarExcluded: true };
  exitRules: Record<ExitRuleId, ExitRuleConfig>;
  reentryStop: { stopMultipleN: number };
  sizingVariants: Record<SizingId, SizingVariantConfig>;
  positionCapSensitivityPct: number[];
  drawdownScaling: { stepDown: number; reduce: number };
  guards: { maxTotalRiskPct: number; minOrderKRW: number };
  costs: {
    baseOneWaySlippageFee: { default: number; crypto: number };
    tiers: { base: number; double: number };
  };
  cashInterest: { annualRatePctOptions: number[] };
  startDates: { list: string[]; count: number };
  periodBuckets: { list: string[] };
  comboList: ComboConfig[];
}

function fail(p: string, why: string): never {
  throw new Error(`config.json 검증 실패 — ${p}: ${why}`);
}
function obj(v: unknown, p: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(p, '객체가 아님');
  return v as Record<string, unknown>;
}
function num(v: unknown, p: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(p, `유한한 숫자가 아님 (${String(v)})`);
  return v;
}
function numOrNull(v: unknown, p: string): number | null {
  if (v === null) return null;
  return num(v, p);
}
function str(v: unknown, p: string): string {
  if (typeof v !== 'string' || v.length === 0) fail(p, '비어있지 않은 문자열이 아님');
  return v;
}
function bool(v: unknown, p: string): boolean {
  if (typeof v !== 'boolean') fail(p, 'boolean이 아님');
  return v;
}
function strArr(v: unknown, p: string): string[] {
  if (!Array.isArray(v)) fail(p, '배열이 아님');
  return v.map((x, i) => str(x, `${p}[${i}]`));
}
function numArr(v: unknown, p: string): number[] {
  if (!Array.isArray(v)) fail(p, '배열이 아님');
  return v.map((x, i) => num(x, `${p}[${i}]`));
}

const EXIT_METHODS = ['donchian', 'atrTrailing', 'smaCross'] as const;

function parseExitRule(v: unknown, p: string): ExitRuleConfig {
  const o = obj(v, p);
  const method = str(o.method, `${p}.method`);
  if (!EXIT_METHODS.includes(method as (typeof EXIT_METHODS)[number])) fail(`${p}.method`, `알 수 없는 방식 (${method})`);
  if (method === 'donchian') {
    return { method: 'donchian', lookback: num(o.lookback, `${p}.lookback`), currentBarExcluded: true };
  }
  if (method === 'atrTrailing') {
    return { method: 'atrTrailing', atrPeriod: num(o.atrPeriod, `${p}.atrPeriod`), multiple: num(o.multiple, `${p}.multiple`) };
  }
  return { method: 'smaCross', period: num(o.period, `${p}.period`), currentBarIncluded: true };
}

const SIZING_IDS: SizingId[] = ['B', 'G', 'A', 'C'];
const PYRAMID_MODES = ['none', 'fixed-cap-div4', 'recompute-each-time', 'fixed-first-entry'] as const;

function parseSizingVariant(v: unknown, p: string): SizingVariantConfig {
  const o = obj(v, p);
  const pyramid = str(o.pyramid, `${p}.pyramid`);
  if (!PYRAMID_MODES.includes(pyramid as (typeof PYRAMID_MODES)[number])) fail(`${p}.pyramid`, `알 수 없는 불타기 모드 (${pyramid})`);
  return {
    riskPerUnitPct: num(o.riskPerUnitPct, `${p}.riskPerUnitPct`),
    maxUnits: num(o.maxUnits, `${p}.maxUnits`),
    positionCapPct: numOrNull(o.positionCapPct, `${p}.positionCapPct`),
    pyramid: pyramid as SizingVariantConfig['pyramid'],
    pyramidStepN: o.pyramidStepN === undefined ? undefined : num(o.pyramidStepN, `${p}.pyramidStepN`),
  };
}

const EXIT_RULE_IDS: ExitRuleId[] = ['W1', 'W2', 'W3', 'W4'];
const SCOPE_IDS: ScopeId[] = ['S-ALL', 'S-CORE-EXCL'];

function parseCombo(v: unknown, p: string): ComboConfig {
  const o = obj(v, p);
  const exitRule = str(o.exitRule, `${p}.exitRule`);
  if (!EXIT_RULE_IDS.includes(exitRule as ExitRuleId)) fail(`${p}.exitRule`, `알 수 없는 청산규칙 (${exitRule})`);
  const sizing = str(o.sizing, `${p}.sizing`);
  if (!SIZING_IDS.includes(sizing as SizingId)) fail(`${p}.sizing`, `알 수 없는 사이징 (${sizing})`);
  const scope = str(o.scope, `${p}.scope`);
  if (!SCOPE_IDS.includes(scope as ScopeId)) fail(`${p}.scope`, `알 수 없는 적용범위 (${scope})`);
  return {
    id: str(o.id, `${p}.id`),
    exitRule: exitRule as ExitRuleId,
    sizing: sizing as SizingId,
    positionCapPct: numOrNull(o.positionCapPct, `${p}.positionCapPct`),
    drawdownScaling: bool(o.drawdownScaling, `${p}.drawdownScaling`),
    scope: scope as ScopeId,
  };
}

export function parseConfig(raw: unknown): PortfolioTurtleConfig {
  const c = obj(raw, 'root');
  const entryO = obj(c.entry, 'entry');
  const exitRulesO = obj(c.exitRules, 'exitRules');
  const reentryStopO = obj(c.reentryStop, 'reentryStop');
  const sizingVariantsO = obj(c.sizingVariants, 'sizingVariants');
  const drawdownO = obj(c.drawdownScaling, 'drawdownScaling');
  const guardsO = obj(c.guards, 'guards');
  const costsO = obj(c.costs, 'costs');
  const oneWayO = obj(costsO.baseOneWaySlippageFee, 'costs.baseOneWaySlippageFee');
  const tiersO = obj(costsO.tiers, 'costs.tiers');
  const cashInterestO = obj(c.cashInterest, 'cashInterest');
  const startDatesO = obj(c.startDates, 'startDates');
  const periodBucketsO = obj(c.periodBuckets, 'periodBuckets');
  const comboListRaw = c.comboList;
  if (!Array.isArray(comboListRaw)) fail('comboList', '배열이 아님');

  return {
    hypothesisId: str(c.hypothesisId, 'hypothesisId'),
    evidenceGrade: str(c.evidenceGrade, 'evidenceGrade'),
    entry: {
      method: 'donchian',
      lookback: num(entryO.lookback, 'entry.lookback'),
      currentBarExcluded: true,
    },
    exitRules: {
      W1: parseExitRule(exitRulesO.W1, 'exitRules.W1'),
      W2: parseExitRule(exitRulesO.W2, 'exitRules.W2'),
      W3: parseExitRule(exitRulesO.W3, 'exitRules.W3'),
      W4: parseExitRule(exitRulesO.W4, 'exitRules.W4'),
    },
    reentryStop: { stopMultipleN: num(reentryStopO.stopMultipleN, 'reentryStop.stopMultipleN') },
    sizingVariants: {
      B: parseSizingVariant(sizingVariantsO.B, 'sizingVariants.B'),
      G: parseSizingVariant(sizingVariantsO.G, 'sizingVariants.G'),
      A: parseSizingVariant(sizingVariantsO.A, 'sizingVariants.A'),
      C: parseSizingVariant(sizingVariantsO.C, 'sizingVariants.C'),
    },
    positionCapSensitivityPct: numArr(c.positionCapSensitivityPct, 'positionCapSensitivityPct'),
    drawdownScaling: { stepDown: num(drawdownO.stepDown, 'drawdownScaling.stepDown'), reduce: num(drawdownO.reduce, 'drawdownScaling.reduce') },
    guards: {
      maxTotalRiskPct: num(guardsO.maxTotalRiskPct, 'guards.maxTotalRiskPct'),
      minOrderKRW: num(guardsO.minOrderKRW, 'guards.minOrderKRW'),
    },
    costs: {
      baseOneWaySlippageFee: { default: num(oneWayO.default, 'costs.baseOneWaySlippageFee.default'), crypto: num(oneWayO.crypto, 'costs.baseOneWaySlippageFee.crypto') },
      tiers: { base: num(tiersO.base, 'costs.tiers.base'), double: num(tiersO.double, 'costs.tiers.double') },
    },
    cashInterest: { annualRatePctOptions: numArr(cashInterestO.annualRatePctOptions, 'cashInterest.annualRatePctOptions') },
    startDates: { list: strArr(startDatesO.list, 'startDates.list'), count: num(startDatesO.count, 'startDates.count') },
    periodBuckets: { list: strArr(periodBucketsO.list, 'periodBuckets.list') },
    comboList: comboListRaw.map((x, i) => parseCombo(x, `comboList[${i}]`)),
  };
}
