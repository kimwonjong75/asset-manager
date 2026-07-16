// scripts/backtest/freshTurtleLifecycle/configTypes.ts
// 동결 설정의 명시적 타입 + `unknown` 기반 런타임 검증 (AMENDED-1 #4).
// 프로젝트 규칙 "any 절대 금지" 준수 — 파싱 결과를 any 로 캐스팅하지 않고 검증 후 좁힌다.
// 검증 실패 시 즉시 throw — 조용한 기본값 주입 금지(fail-closed).

export interface FreshTurtleConfig {
  hypothesisId: string;
  evidenceGrade: string;
  evidenceGradeReason: string;
  account: {
    satelliteBudgetKRW: number;
    initialCashKRW: number;
  };
  rules: {
    entryLookback: number;
    exitLookback: number;
    atrPeriod: number;
    stopMultipleN: number;
    pyramidStepN: number;
    riskPerUnitPct: number;
    maxTotalRiskPct: number;
    positionValueCapPct: number;
    quantityGranularity: { cryptoTickers: string[] };
  };
  costs: {
    baseOneWayRate: number;
    sensitivityRates: number[];
  };
  universe: { tickers: string[] };
  periods: {
    full: { start: string; end: string };
    robustness: { id: string; start: string; end: string }[];
  };
}

function fail(path: string, why: string): never {
  throw new Error(`config.json 검증 실패 — ${path}: ${why}`);
}

function obj(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, '객체가 아님');
  return v as Record<string, unknown>;
}

function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, `유한한 숫자가 아님 (${String(v)})`);
  return v;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.length === 0) fail(path, '비어있지 않은 문자열이 아님');
  return v;
}

function strArr(v: unknown, path: string): string[] {
  if (!Array.isArray(v)) fail(path, '배열이 아님');
  return v.map((x, i) => str(x, `${path}[${i}]`));
}

function numArr(v: unknown, path: string): number[] {
  if (!Array.isArray(v)) fail(path, '배열이 아님');
  return v.map((x, i) => num(x, `${path}[${i}]`));
}

/** 파싱된 JSON(unknown) → 검증된 FreshTurtleConfig. 필요한 필드만 좁게 검증한다. */
export function parseConfig(raw: unknown): FreshTurtleConfig {
  const c = obj(raw, 'root');
  const account = obj(c.account, 'account');
  const rules = obj(c.rules, 'rules');
  const gran = obj(rules.quantityGranularity, 'rules.quantityGranularity');
  const costs = obj(c.costs, 'costs');
  const universe = obj(c.universe, 'universe');
  const periods = obj(c.periods, 'periods');
  const full = obj(periods.full, 'periods.full');

  const robustnessRaw = periods.robustness;
  if (!Array.isArray(robustnessRaw)) fail('periods.robustness', '배열이 아님');
  const robustness = robustnessRaw.map((w, i) => {
    const o = obj(w, `periods.robustness[${i}]`);
    return {
      id: str(o.id, `periods.robustness[${i}].id`),
      start: str(o.start, `periods.robustness[${i}].start`),
      end: str(o.end, `periods.robustness[${i}].end`),
    };
  });

  return {
    hypothesisId: str(c.hypothesisId, 'hypothesisId'),
    evidenceGrade: str(c.evidenceGrade, 'evidenceGrade'),
    evidenceGradeReason: str(c.evidenceGradeReason, 'evidenceGradeReason'),
    account: {
      satelliteBudgetKRW: num(account.satelliteBudgetKRW, 'account.satelliteBudgetKRW'),
      initialCashKRW: num(account.initialCashKRW, 'account.initialCashKRW'),
    },
    rules: {
      entryLookback: num(rules.entryLookback, 'rules.entryLookback'),
      exitLookback: num(rules.exitLookback, 'rules.exitLookback'),
      atrPeriod: num(rules.atrPeriod, 'rules.atrPeriod'),
      stopMultipleN: num(rules.stopMultipleN, 'rules.stopMultipleN'),
      pyramidStepN: num(rules.pyramidStepN, 'rules.pyramidStepN'),
      riskPerUnitPct: num(rules.riskPerUnitPct, 'rules.riskPerUnitPct'),
      maxTotalRiskPct: num(rules.maxTotalRiskPct, 'rules.maxTotalRiskPct'),
      positionValueCapPct: num(rules.positionValueCapPct, 'rules.positionValueCapPct'),
      quantityGranularity: { cryptoTickers: strArr(gran.cryptoTickers, 'rules.quantityGranularity.cryptoTickers') },
    },
    costs: {
      baseOneWayRate: num(costs.baseOneWayRate, 'costs.baseOneWayRate'),
      sensitivityRates: numArr(costs.sensitivityRates, 'costs.sensitivityRates'),
    },
    universe: { tickers: strArr(universe.tickers, 'universe.tickers') },
    periods: {
      full: { start: str(full.start, 'periods.full.start'), end: str(full.end, 'periods.full.end') },
      robustness,
    },
  };
}
