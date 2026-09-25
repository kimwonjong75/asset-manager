// scripts/backtest/holdingsTurtleCycle/configTypes.ts
// 동결 설정의 명시적 타입 + unknown 기반 런타임 검증. 검증 실패 시 즉시 throw(fail-closed).
// "any 절대 금지" 준수 — config를 any로 캐스팅하지 않고 검증 후 좁힌다.

export interface VariantConfig {
  name: string;
  entryLookback: number;
  exitLookback: number;
  atrPeriod: number;
  stopMultipleN: number;
}

export interface HoldingsTurtleCycleConfig {
  hypothesisId: string;
  evidenceGrade: string;
  variants: { V1: VariantConfig; V2: VariantConfig; V3: VariantConfig };
  costTiers: { zero: number; base: number; double: number };
  periodBuckets: string[];
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
function str(v: unknown, p: string): string {
  if (typeof v !== 'string' || v.length === 0) fail(p, '비어있지 않은 문자열이 아님');
  return v;
}
function strArr(v: unknown, p: string): string[] {
  if (!Array.isArray(v)) fail(p, '배열이 아님');
  return v.map((x, i) => str(x, `${p}[${i}]`));
}

function parseVariant(v: unknown, p: string): VariantConfig {
  const o = obj(v, p);
  return {
    name: str(o.name, `${p}.name`),
    entryLookback: num(o.entryLookback, `${p}.entryLookback`),
    exitLookback: num(o.exitLookback, `${p}.exitLookback`),
    atrPeriod: num(o.atrPeriod, `${p}.atrPeriod`),
    stopMultipleN: num(o.stopMultipleN, `${p}.stopMultipleN`),
  };
}

export function parseConfig(raw: unknown): HoldingsTurtleCycleConfig {
  const c = obj(raw, 'root');
  const variants = obj(c.variants, 'variants');
  const costs = obj(c.costs, 'costs');
  const tiers = obj(costs.tiers, 'costs.tiers');
  const grid = obj(c.grid, 'grid');

  return {
    hypothesisId: str(c.hypothesisId, 'hypothesisId'),
    evidenceGrade: str(c.evidenceGrade, 'evidenceGrade'),
    variants: {
      V1: parseVariant(variants.V1, 'variants.V1'),
      V2: parseVariant(variants.V2, 'variants.V2'),
      V3: parseVariant(variants.V3, 'variants.V3'),
    },
    costTiers: {
      zero: num(tiers.zero, 'costs.tiers.zero'),
      base: num(tiers.base, 'costs.tiers.base'),
      double: num(tiers.double, 'costs.tiers.double'),
    },
    periodBuckets: strArr(grid.periodBuckets, 'grid.periodBuckets'),
  };
}
