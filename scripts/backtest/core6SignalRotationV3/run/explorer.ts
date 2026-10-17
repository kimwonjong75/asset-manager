// scripts/backtest/core6SignalRotationV3/run/explorer.ts
// 코어 6종 신호 로테이션 V3 — 사후 비중 탐색기(사전등록 §19). EXPLORATORY-POSTHOC.
// 실행: npx tsx scripts/backtest/core6SignalRotationV3/run/explorer.ts --panel P --set W0
//       npx tsx .../explorer.ts --panel P --weights 0.17,0.17,0.16,0.125,0.125,0.25     (순서: 069500,379800,283580,385560,464470,411060)
// 신호 캐시·패널을 다시 받지 않고 비중만 바꿔 BH/CASH/ROTATE 를 재계산한다. 상한은 min(1.5×비중, 35%) 자동 재계산.
// 이 도구의 결과는 채택 판정(§15)과 선택 잠금을 바꾸지 못한다. 개발/검증 구간 구분을 항상 표시한다.

import { simulate } from '../portfolio/simulate';
import { SIGNAL_RULES, ASSET_CODES } from '../types';
import type { AssetCode, Panel, SignalRuleId } from '../types';
import { runSim } from './devRun';
import type { SimMode, SimSetup } from './devRun';
import {
  CAP_ABSOLUTE,
  CAP_MULTIPLIER,
  COST_BASE,
  DEV_END_DATE,
  INITIAL_CAPITAL,
  MIN_ORDER_KRW,
  VAL_START_DATE,
  argValue,
  cashRateArray,
  includedAssets,
  isMainModule,
  loadCd91,
  loadOrComputeSignalCache,
  loadPanel,
  metricsFromEquity,
  panelWeights,
  ruleStartIndex,
} from './common';
import type { CdRow, Metrics, PanelName, SignalCache } from './common';

export const EXPLORER_WARNING =
  '[사후 탐색용 · 채택 판정 불가] 비중을 결과를 보고 고르면 과최적화입니다. 이 결과는 사전등록 §15 판정과 선택 잠금을 바꾸지 못합니다.';

export type WeightSetName = 'W0' | 'W1' | 'W2' | 'W3' | 'W4' | 'W5';
export const WEIGHT_SET_NAMES: readonly WeightSetName[] = ['W0', 'W1', 'W2', 'W3', 'W4', 'W5'];

const STOCKS: readonly AssetCode[] = ['069500', '379800', '283580'];
const BONDS: readonly AssetCode[] = ['385560', '464470'];
const GOLD: AssetCode = '411060';

function scaleGroup(base: Record<AssetCode, number>, group: readonly AssetCode[], total: number, out: Record<AssetCode, number>): void {
  const sum = group.reduce((s, c) => s + base[c], 0);
  for (const c of group) out[c] = sum > 0 ? (base[c] / sum) * total : 0;
}

/** 사전 지정 비중 세트(§19). W0 = 현재 목표비중(types.TARGET_WEIGHTS). */
export function weightSet(name: WeightSetName, w0: Record<AssetCode, number>): Record<AssetCode, number> {
  const out = {} as Record<AssetCode, number>;
  for (const c of ASSET_CODES) out[c] = 0;
  switch (name) {
    case 'W0':
      return { ...w0 };
    case 'W1':
      for (const c of ASSET_CODES) out[c] = 1 / ASSET_CODES.length;
      return out;
    case 'W2':
    case 'W3': {
      const gold = name === 'W2' ? 0.15 : 0.35;
      out[GOLD] = gold;
      scaleGroup(w0, [...STOCKS, ...BONDS], 1 - gold, out);
      return out;
    }
    case 'W4':
      scaleGroup(w0, [...STOCKS, GOLD], 1, out);
      return out;
    case 'W5':
      scaleGroup(w0, STOCKS, 0.7, out);
      scaleGroup(w0, [...BONDS, GOLD], 0.3, out);
      return out;
  }
}

/** 제출된 비중표 검증: 합 1(±1e-6), 음수 없음, 패널에 없는 자산에는 0. 구성 자산 밖 비중이 양수면 throw. */
export function validateWeights(weights: Record<AssetCode, number>, panel: Panel): void {
  const inc = includedAssets(panel);
  let sum = 0;
  for (const c of ASSET_CODES) {
    const w = weights[c];
    if (!Number.isFinite(w) || w < 0) throw new Error(`비중 오류: ${c}=${w}`);
    if (w > 0 && !inc.includes(c)) throw new Error(`비중 오류: ${c} 는 이 패널에 가격이 없습니다(비중 0 이어야 함).`);
    sum += w;
  }
  if (Math.abs(sum - 1) > 1e-6) throw new Error(`비중 합 ${sum} ≠ 1`);
}

/** 패널에 없는 자산 비중을 0으로 만들고 나머지를 재정규화(세트를 P5 에 적용할 때). */
export function renormalizeToPanel(weights: Record<AssetCode, number>, panel: Panel): Record<AssetCode, number> {
  const inc = includedAssets(panel);
  const sum = inc.reduce((s, c) => s + weights[c], 0);
  const out = {} as Record<AssetCode, number>;
  for (const c of ASSET_CODES) out[c] = inc.includes(c) && sum > 0 ? weights[c] / sum : 0;
  return out;
}

export interface PeriodMetrics {
  dev: Metrics | null;
  validation: Metrics | null;
  full: Metrics;
}

export interface ExplorerRow {
  rule: SignalRuleId;
  mode: 'BH' | 'CASH' | 'ROTATE';
  startDate: string;
  metrics: PeriodMetrics;
  turnover: number;
  sells: number;
}

export interface ExplorerResult {
  warning: string;
  weights: Record<AssetCode, number>;
  rows: ExplorerRow[];
}

/** 한 연속 실행의 자산곡선을 개발(≤DEV_END)·검증(≥VAL_START) 구간으로 나눠 구간별 지표를 만든다. */
export function splitMetrics(dates: readonly string[], equity: readonly number[]): PeriodMetrics {
  const full = metricsFromEquity(equity, dates, INITIAL_CAPITAL, dates[0]);
  let devEnd = -1;
  for (let i = 0; i < dates.length; i++) if (dates[i] <= DEV_END_DATE) devEnd = i;
  const valStart = dates.findIndex(d => d >= VAL_START_DATE);
  const dev = devEnd >= 0 ? metricsFromEquity(equity.slice(0, devEnd + 1), dates.slice(0, devEnd + 1), INITIAL_CAPITAL, dates[0]) : null;
  let validation: Metrics | null = null;
  if (valStart >= 1) {
    validation = metricsFromEquity(equity.slice(valStart), dates.slice(valStart), equity[valStart - 1], dates[valStart - 1]);
  } else if (valStart === 0) {
    validation = metricsFromEquity(equity, dates, INITIAL_CAPITAL, dates[0]);
  }
  return { dev, validation, full };
}

export function runExplorer(
  panel: Panel,
  cache: SignalCache,
  weights: Record<AssetCode, number>,
  cd91: readonly CdRow[],
  cost: number = COST_BASE,
): ExplorerResult {
  validateWeights(weights, panel);
  const codes = ASSET_CODES.filter(c => weights[c] > 0);
  const cashRates = cashRateArray(panel.dates, cd91);
  const rows: ExplorerRow[] = [];
  for (const rule of SIGNAL_RULES) {
    // 비중 0 자산은 시작 조건에서도 제외한다.
    const start = ruleStartIndex(cache, rule, codes, panel.dates.length);
    if (start === null) continue;
    const setup: SimSetup = { panel, signals: cache[rule], weights, cashRates };
    for (const mode of ['BH', 'CASH', 'ROTATE'] as SimMode[]) {
      const res = runSim(setup, mode, start, panel.dates.length - 1, cost);
      rows.push({
        rule,
        mode: mode as ExplorerRow['mode'],
        startDate: panel.dates[start],
        metrics: splitMetrics(res.dates, res.equity),
        turnover: res.turnover,
        sells: res.sellEventCount,
      });
    }
  }
  return { warning: EXPLORER_WARNING, weights, rows };
}

/**
 * CASH(B) 선형성 검산(§19): 칸 독립이라 결과 자산곡선 = Σ w_i × (자산 i 단독, 자본 w_i×초기자본). 최대 절대오차(원)를 반환한다.
 * 같은 startIndex 를 쓴다.
 */
export function cashLinearityError(
  panel: Panel,
  cache: SignalCache,
  rule: SignalRuleId,
  weights: Record<AssetCode, number>,
  cashRates: number[],
  startIndex: number,
  endIndex: number,
  cost: number = COST_BASE,
): number {
  const codes = ASSET_CODES.filter(c => weights[c] > 0);
  const whole = runSim({ panel, signals: cache[rule], weights, cashRates }, 'CASH', startIndex, endIndex, cost);
  const sum = new Array<number>(whole.equity.length).fill(0);
  for (const code of codes) {
    const single = {} as Record<AssetCode, number>;
    for (const c of ASSET_CODES) single[c] = c === code ? 1 : 0;
    const res = runSimScaled({ panel, signals: cache[rule], weights: single, cashRates }, startIndex, endIndex, cost, weights[code] * INITIAL_CAPITAL);
    for (let k = 0; k < sum.length; k++) sum[k] += res[k];
  }
  let maxErr = 0;
  for (let k = 0; k < sum.length; k++) maxErr = Math.max(maxErr, Math.abs(sum[k] - whole.equity[k]));
  return maxErr;
}

function runSimScaled(setup: SimSetup, startIndex: number, endIndex: number, cost: number, capital: number): number[] {
  return simulate(setup.panel, setup.signals, {
    mode: 'CASH',
    weights: setup.weights,
    capMultiplier: CAP_MULTIPLIER,
    capAbsolute: CAP_ABSOLUTE,
    costOneWay: cost,
    initialCapital: capital,
    minOrderKRW: MIN_ORDER_KRW,
    startIndex,
    endIndex,
    annualCashRate: setup.cashRates,
  }).equity;
}

function pct(v: number): string {
  return Number.isNaN(v) ? 'n/a' : `${(v * 100).toFixed(2)}%`;
}
function fmt(m: Metrics | null): string {
  return m ? `CAGR ${pct(m.cagr)} MDD ${pct(m.mdd)} Calmar ${Number.isFinite(m.calmar) ? m.calmar.toFixed(2) : String(m.calmar)}` : '-';
}

export function formatExplorer(r: ExplorerResult, label: string): string {
  const L: string[] = [r.warning, `비중(${label}): ${ASSET_CODES.map(c => `${c}=${(r.weights[c] * 100).toFixed(2)}%`).join(' ')}`];
  for (const row of r.rows) {
    L.push(`\n${row.rule} ${row.mode} (시작 ${row.startDate}, 회전율 ${row.turnover.toFixed(2)}, 매도 ${row.sells})`);
    L.push(`  [개발 ~${DEV_END_DATE}] ${fmt(row.metrics.dev)}`);
    L.push(`  [검증 ${VAL_START_DATE}~ (사후 탐색)] ${fmt(row.metrics.validation)}`);
    L.push(`  [전체] ${fmt(row.metrics.full)}`);
  }
  L.push(`\n${r.warning}`);
  return L.join('\n');
}

if (isMainModule(import.meta.url)) {
  const panelArg = argValue(process.argv, '--panel') ?? 'P';
  if (panelArg !== 'P' && panelArg !== 'P5') throw new Error('사용법: explorer.ts --panel P|P5 (--set W0..W5 | --weights a,b,c,d,e,f) [--cost 0.001]');
  const name: PanelName = panelArg;
  const { panel, sha256: panelSha } = loadPanel(name);
  const setArg = argValue(process.argv, '--set');
  const wArg = argValue(process.argv, '--weights');
  let weights: Record<AssetCode, number>;
  let label: string;
  if (wArg) {
    const parts = wArg.split(',').map(Number);
    if (parts.length !== ASSET_CODES.length) throw new Error(`--weights 는 ${ASSET_CODES.length}개(${ASSET_CODES.join(',')})`);
    weights = {} as Record<AssetCode, number>;
    ASSET_CODES.forEach((c, i) => (weights[c] = parts[i]));
    label = '사용자 입력';
  } else {
    const s = (setArg ?? 'W0') as WeightSetName;
    if (!WEIGHT_SET_NAMES.includes(s)) throw new Error(`알 수 없는 세트 ${s}`);
    weights = renormalizeToPanel(weightSet(s, panelWeights(panel)), panel);
    label = s;
  }
  const costArg = argValue(process.argv, '--cost');
  const result = runExplorer(panel, loadOrComputeSignalCache(name, panel, panelSha), weights, loadCd91(), costArg ? Number(costArg) : COST_BASE);
  process.stdout.write(`${formatExplorer(result, label)}\n`);
}
