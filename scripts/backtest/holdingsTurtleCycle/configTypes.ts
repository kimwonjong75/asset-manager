// scripts/backtest/holdingsTurtleCycle/configTypes.ts
// 동결 설정의 명시적 타입 + unknown 기반 런타임 검증. 검증 실패 시 즉시 throw(fail-closed).
// "any 절대 금지" 준수 — config를 any로 캐스팅하지 않고 검증 후 좁힌다.

export interface VariantConfig {
  name: string;
  entryLookback: number;
  exitLookback: number;
  atrPeriod: number;
  stopMultipleN: number;
  /** 2차 백테스트(§⑤ W1~W4) — 미지정 시 'donchian'(1차 V1~V3와 동일, 하위호환). */
  exitType?: 'donchian' | 'atrTrail' | 'sma';
  atrTrailMultiple?: number;
  smaPeriod?: number;
}

export interface HoldingsTurtleCycleConfig {
  hypothesisId: string;
  evidenceGrade: string;
  /** V1~V3(1차, 필수)는 하위호환을 위해 항상 존재. W1~W4·감도변형(W3_2x 등)은 선택적 추가 키. */
  variants: { V1: VariantConfig; V2: VariantConfig; V3: VariantConfig } & Record<string, VariantConfig>;
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

function optStr(v: unknown, p: string): string | undefined {
  if (v === undefined) return undefined;
  return str(v, p);
}
function optNum(v: unknown, p: string): number | undefined {
  if (v === undefined) return undefined;
  return num(v, p);
}

function parseVariant(v: unknown, p: string): VariantConfig {
  const o = obj(v, p);
  const exitType = optStr(o.exitType, `${p}.exitType`);
  if (exitType !== undefined && exitType !== 'donchian' && exitType !== 'atrTrail' && exitType !== 'sma') {
    fail(`${p}.exitType`, `donchian|atrTrail|sma 중 하나가 아님 (${exitType})`);
  }
  return {
    name: str(o.name, `${p}.name`),
    entryLookback: num(o.entryLookback, `${p}.entryLookback`),
    exitLookback: num(o.exitLookback, `${p}.exitLookback`),
    atrPeriod: num(o.atrPeriod, `${p}.atrPeriod`),
    stopMultipleN: num(o.stopMultipleN, `${p}.stopMultipleN`),
    exitType: exitType as VariantConfig['exitType'],
    atrTrailMultiple: optNum(o.atrTrailMultiple, `${p}.atrTrailMultiple`),
    smaPeriod: optNum(o.smaPeriod, `${p}.smaPeriod`),
  };
}

export function parseConfig(raw: unknown): HoldingsTurtleCycleConfig {
  const c = obj(raw, 'root');
  const variants = obj(c.variants, 'variants');
  const costs = obj(c.costs, 'costs');
  const tiers = obj(costs.tiers, 'costs.tiers');
  const grid = obj(c.grid, 'grid');

  const allVariants: Record<string, VariantConfig> = {};
  for (const key of Object.keys(variants)) {
    allVariants[key] = parseVariant(variants[key], `variants.${key}`);
  }
  if (!allVariants.V1 || !allVariants.V2 || !allVariants.V3) {
    fail('variants', 'V1/V2/V3(1차 변형)가 모두 있어야 함');
  }

  return {
    hypothesisId: str(c.hypothesisId, 'hypothesisId'),
    evidenceGrade: str(c.evidenceGrade, 'evidenceGrade'),
    variants: allVariants as HoldingsTurtleCycleConfig['variants'],
    costTiers: {
      zero: num(tiers.zero, 'costs.tiers.zero'),
      base: num(tiers.base, 'costs.tiers.base'),
      double: num(tiers.double, 'costs.tiers.double'),
    },
    periodBuckets: strArr(grid.periodBuckets, 'grid.periodBuckets'),
  };
}
