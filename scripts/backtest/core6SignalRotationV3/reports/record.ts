// scripts/backtest/core6SignalRotationV3/reports/record.ts
// 코어 6종 V3 — 비중별 결과 레코드 생성(사후 탐색용). explorer 와 같은 계산 경로(runSim + splitMetrics)를 재사용한다.
// 구간 방식: 개발·전체는 규칙별 "전체 기간 1회 연속 실행"의 자산곡선을 잘라 계산(신호는 인과적이라 개발만 따로 돌린 것과 동일).
// 시험 구간은 runValidation 과 같이 시험 시작일에 새로 시작하는 독립 실행(시작일 B&H 신규 매수, 초기자본 1억)으로 계산한다.
// 이 결과는 채택 판정(§15)과 선택 잠금을 바꾸지 못한다.

import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mddRelativeReduction } from '../stats/metrics';
import { ASSET_CODES, SIGNAL_RULES } from '../types';
import type { AssetCode, Panel, SignalRuleId } from '../types';
import { runSim, simMetrics } from '../run/devRun';
import type { SimMode } from '../run/devRun';
import { splitMetrics, validateWeights } from '../run/explorer';
import {
  CAP_ABSOLUTE,
  CAP_MULTIPLIER,
  COST_BASE,
  DEV_END_DATE,
  INITIAL_CAPITAL,
  VAL_START_DATE,
  cashRateArray,
  firstIndexOnOrAfter,
  ruleStartIndex,
} from '../run/common';
import type { CdRow, Metrics, SignalCache } from '../run/common';

export const REPORTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPORT_OUT_DIR = path.join(REPORTS_DIR, 'out');
export const RECORDS_DIR = path.join(REPORT_OUT_DIR, 'records');

export const REPORT_WARNING =
  '사후 탐색용 — 채택 판정 불가. 비중을 결과를 보고 고르면 과최적화입니다. 이 결과는 사전등록 §15 판정과 선택 잠금을 바꾸지 못합니다.';

export type ReportAsset = AssetCode;
export type ReportRule = SignalRuleId;
export type ReportPeriod = 'dev' | 'val' | 'full';
export type ReportMode = 'BH' | 'CASH' | 'ROTATE';

export interface ReportRow {
  rule: ReportRule;
  period: ReportPeriod;
  mode: ReportMode;
  cagr: number;
  mdd: number;
  calmar: number;
  vol: number;
  finalEquity: number;
  turnover: number | null;
  sells: number | null;
  reentries: number | null;
  mddReductionVsBH: number | null;
  cagrDiffVsBH: number | null;
}

export interface ReportRecord {
  schemaVersion: 1;
  id: string;
  label: string;
  createdAt: string;
  panel: 'P' | 'P5';
  weights: Record<AssetCode, number>;
  assetNames: Record<string, string>;
  caps: Record<string, number>;
  config: { costOneWay: number; capMultiplier: number; capAbsolute: number; initialCapital: number; cashRule: string };
  periods: { dev: { start: string; end: string }; val: { start: string; end: string }; full: { start: string; end: string } };
  rows: ReportRow[];
  warnings: string[];
}

export const ASSET_NAMES: Record<AssetCode, string> = {
  '069500': 'KODEX 200',
  '379800': 'KODEX 미국S&P500',
  '283580': 'KODEX 차이나CSI300',
  '385560': 'RISE KIS 국고채30년 Enhanced',
  '464470': 'PLUS 미국채30년액티브',
  '411060': 'ACE KRX금현물',
};

/** 파일명 안전 slug: 영문/숫자/_/- 만, 1~64자. */
export function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id);
}

export function computeCaps(weights: Record<AssetCode, number>): Record<string, number> {
  const caps: Record<string, number> = {};
  for (const c of ASSET_CODES) if (weights[c] > 0) caps[c] = Math.min(CAP_MULTIPLIER * weights[c], CAP_ABSOLUTE);
  return caps;
}

function toRow(
  rule: ReportRule,
  period: ReportPeriod,
  mode: ReportMode,
  m: Metrics,
  bh: Metrics,
  extra: { turnover: number | null; sells: number | null; reentries: number | null },
): ReportRow {
  const isBh = mode === 'BH';
  return {
    rule,
    period,
    mode,
    cagr: m.cagr,
    mdd: m.mdd,
    calmar: m.calmar,
    vol: m.vol,
    finalEquity: m.finalEquity,
    ...extra,
    mddReductionVsBH: isBh ? null : mddRelativeReduction(bh.mdd, m.mdd),
    cagrDiffVsBH: isBh ? null : m.cagr - bh.cagr,
  };
}

export function buildRecord(args: {
  panelName: 'P' | 'P5';
  panel: Panel;
  cache: SignalCache;
  cd91: readonly CdRow[];
  weights: Record<AssetCode, number>;
  id: string;
  label: string;
  createdAt?: string;
  cost?: number;
}): ReportRecord {
  const { panelName, panel, cache, cd91, weights, id, label } = args;
  const cost = args.cost ?? COST_BASE;
  if (!isSafeId(id)) throw new Error(`id 오류: '${id}' (영문/숫자/_/- 만, 64자 이하)`);
  validateWeights(weights, panel);
  const codes = ASSET_CODES.filter(c => weights[c] > 0);
  const cashRates = cashRateArray(panel.dates, cd91);
  const n = panel.dates.length;
  const rows: ReportRow[] = [];
  let earliest = n - 1;
  for (const rule of SIGNAL_RULES) {
    const start = ruleStartIndex(cache, rule, codes, n);
    if (start === null) continue;
    earliest = Math.min(earliest, start);
    const setup = { panel, signals: cache[rule], weights, cashRates };
    const per: Record<string, { split: ReturnType<typeof splitMetrics>; turnover: number; sells: number; reentries: number }> = {};
    for (const mode of ['BH', 'CASH', 'ROTATE'] as ReportMode[]) {
      const res = runSim(setup, mode as SimMode, start, n - 1, cost);
      per[mode] = { split: splitMetrics(res.dates, res.equity), turnover: res.turnover, sells: res.sellEventCount, reentries: res.reentryEventCount };
    }
    const valIdx = firstIndexOnOrAfter(panel.dates, VAL_START_DATE);
    // 시험 구간: runValidation 과 동일하게 시험 시작일부터 독립 실행.
    const valPer: Record<string, { m: Metrics; turnover: number; sells: number; reentries: number }> = {};
    if (valIdx >= 0 && valIdx >= start) {
      for (const mode of ['BH', 'CASH', 'ROTATE'] as ReportMode[]) {
        const res = runSim(setup, mode as SimMode, valIdx, n - 1, cost);
        valPer[mode] = { m: simMetrics(res), turnover: res.turnover, sells: res.sellEventCount, reentries: res.reentryEventCount };
      }
    }
    for (const period of ['dev', 'val', 'full'] as ReportPeriod[]) {
      const pick = (mode: ReportMode): Metrics | null => {
        if (period === 'val') return valPer[mode]?.m ?? null;
        const s = per[mode].split;
        return period === 'dev' ? s.dev : s.full;
      };
      const bh = pick('BH');
      if (!bh) continue;
      for (const mode of ['BH', 'CASH', 'ROTATE'] as ReportMode[]) {
        const m = pick(mode);
        if (!m) continue;
        const src = period === 'val' ? valPer[mode] : period === 'full' ? per[mode] : null;
        const extra = src ? { turnover: src.turnover, sells: src.sells, reentries: src.reentries } : { turnover: null, sells: null, reentries: null };
        rows.push(toRow(rule, period, mode, m, bh, extra));
      }
    }
  }
  let devEndIdx = -1;
  for (let i = 0; i < n; i++) if (panel.dates[i] <= DEV_END_DATE) devEndIdx = i;
  const valIdx = panel.dates.findIndex(d => d >= VAL_START_DATE);
  const last = panel.dates[n - 1];
  return {
    schemaVersion: 1,
    id,
    label,
    createdAt: args.createdAt ?? new Date().toISOString(),
    panel: panelName,
    weights: { ...weights },
    assetNames: { ...ASSET_NAMES },
    caps: computeCaps(weights),
    config: {
      costOneWay: cost,
      capMultiplier: CAP_MULTIPLIER,
      capAbsolute: CAP_ABSOLUTE,
      initialCapital: INITIAL_CAPITAL,
      cashRule: 'CASH 칸은 max(CD91 − 0.25%p, 0) 연율 현금수익(세션 이전 공표값)',
    },
    periods: {
      dev: { start: panel.dates[earliest], end: devEndIdx >= 0 ? panel.dates[devEndIdx] : DEV_END_DATE },
      val: { start: valIdx >= 0 ? panel.dates[valIdx] : VAL_START_DATE, end: last },
      full: { start: panel.dates[earliest], end: last },
    },
    rows,
    warnings: [
      REPORT_WARNING,
      '개발·전체 구간은 규칙별 1회 연속 실행의 자산곡선을 잘라 계산하고, 시험 구간은 시험 시작일에 새로 시작하는 독립 실행(사전등록 검증 실행과 동일 방식)입니다. 회전율·매도·재진입은 전체·시험 구간만 제공합니다(개발 구간은 null).',
    ],
  };
}

export function writeRecord(rec: ReportRecord): string {
  mkdirSync(RECORDS_DIR, { recursive: true });
  const p = path.join(RECORDS_DIR, `${rec.id}.json`);
  writeFileSync(p, JSON.stringify(rec, null, 2));
  return p;
}
