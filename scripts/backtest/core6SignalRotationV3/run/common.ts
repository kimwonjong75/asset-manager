// scripts/backtest/core6SignalRotationV3/run/common.ts
// 코어 6종 신호 로테이션 V3 — 실행기 공통(패널 로드·신호 캐시·시작 인덱스·CD91 현금금리·지표·해시).
// 사전등록: docs/backtest/PREREG_코어6종_신호로테이션_V3.md §7·§12·§13·§17-4, 정정 1·2.
// 개발 가드: devRun 은 반드시 truncatePanel() 을 거친 패널만 시뮬레이터/신호/현금금리에 넘긴다.

import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeSignals } from '../signals/signals';
import { annualizedVolatility, cagr, calmar, dailyReturns, maxDrawdown } from '../stats/metrics';
import { ASSET_CODES, SIGNAL_RULES, TARGET_WEIGHTS } from '../types';
import type { AssetCode, Panel, SignalRuleId, SignalSeries } from '../types';

const here = path.dirname(fileURLToPath(import.meta.url));
export const V3_DIR = path.resolve(here, '..');
export const OUTPUT_DIR = path.join(V3_DIR, 'output');
export const CD91_PATH = path.resolve(V3_DIR, '..', 'core6SignalRotation', 'data', 'raw', 'ecos_cd91.json');

/** 사전등록 §7: 개발 종료 / 검증 시작. */
export const DEV_END_DATE = '2024-06-28';
export const VAL_START_DATE = '2024-07-01';
export const VAL_END_DATE = '2026-09-30';

export const OFFSETS: readonly number[] = [0, 21, 42, 63];
export const MIN_OFFSET_DAYS = 360;
export const COST_BASE = 0.001;
export const COST_ADVERSE = 0.002;
export const CAP_MULTIPLIER = 1.5;
export const CAP_ABSOLUTE = 0.35;
export const INITIAL_CAPITAL = 100_000_000;
export const MIN_ORDER_KRW = 10_000;
export const CASH_SPREAD = 0.0025;

/** V2 §13.1 / V3 §13 최소 표본·사건. */
export interface Thresholds {
  devDays: number;
  devSells: number;
  devReentries: number;
  devSellAssets: number;
  pyramidCampaigns: number;
  pyramidFills: number;
  valDays: number;
  valSells: number;
  valReentries: number;
  valSellAssets: number;
  valPyramidCampaigns: number;
  valPyramidFills: number;
}
export const THRESHOLDS: Thresholds = {
  devDays: 450,
  devSells: 12,
  devReentries: 6,
  devSellAssets: 3,
  pyramidCampaigns: 6,
  pyramidFills: 6,
  valDays: 240,
  valSells: 6,
  valReentries: 3,
  valSellAssets: 2,
  valPyramidCampaigns: 3,
  valPyramidFills: 3,
};

export const PYRAMID_INTERVALS = ['0.5N', '4N', '10pct'] as const;
export type PyramidInterval = (typeof PYRAMID_INTERVALS)[number];

// ── 해시 ────────────────────────────────────────────────────────────────────
export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
/** JSON.stringify 기반(키 순서는 생성 순서 고정) 해시. */
export function jsonHash(value: unknown): string {
  return sha256(JSON.stringify(value));
}

// ── 패널 ────────────────────────────────────────────────────────────────────
export type PanelName = 'P' | 'P5';

export function panelPath(name: PanelName): string {
  return path.join(OUTPUT_DIR, `panel_${name}.json`);
}

export function loadPanel(name: PanelName): { panel: Panel; sha256: string } {
  const bytes = readFileSync(panelPath(name));
  return { panel: JSON.parse(bytes.toString('utf-8')) as Panel, sha256: sha256(bytes) };
}

/** 가격이 실제로 존재하는(source!='absent') 자산 = 이 패널의 구성 자산. */
export function includedAssets(panel: Panel): AssetCode[] {
  return ASSET_CODES.filter(code => panel.assets[code].source.some(s => s !== 'absent'));
}

/** 목표비중을 구성 자산에 재정규화(P5 에서 19.43/19.43/18.29/14.29/28.57%). 제외 자산은 0. */
export function panelWeights(panel: Panel): Record<AssetCode, number> {
  const inc = includedAssets(panel);
  const sum = inc.reduce((s, c) => s + TARGET_WEIGHTS[c], 0);
  const out = {} as Record<AssetCode, number>;
  for (const code of ASSET_CODES) out[code] = inc.includes(code) ? TARGET_WEIGHTS[code] / sum : 0;
  return out;
}

/** endDate(포함) 이후 세션을 **물리적으로** 잘라낸다. 이후 데이터는 반환값에 존재하지 않는다. */
export function truncatePanel(panel: Panel, endDate: string): Panel {
  let n = 0;
  while (n < panel.dates.length && panel.dates[n] <= endDate) n++;
  const assets = {} as Record<AssetCode, Panel['assets'][AssetCode]>;
  for (const code of ASSET_CODES) {
    const a = panel.assets[code];
    assets[code] = {
      code,
      open: a.open.slice(0, n),
      high: a.high.slice(0, n),
      low: a.low.slice(0, n),
      close: a.close.slice(0, n),
      fresh: a.fresh.slice(0, n),
      source: a.source.slice(0, n),
    };
  }
  return { dates: panel.dates.slice(0, n), assets };
}

/** date 이상인 첫 세션 인덱스(없으면 -1). */
export function firstIndexOnOrAfter(dates: readonly string[], date: string): number {
  for (let i = 0; i < dates.length; i++) if (dates[i] >= date) return i;
  return -1;
}

// ── 신호 캐시(비중 무관) ───────────────────────────────────────────────────
export type SignalCache = Record<SignalRuleId, Partial<Record<AssetCode, SignalSeries>>>;

export function computeSignalCache(panel: Panel): SignalCache {
  const inc = includedAssets(panel);
  const cache = {} as SignalCache;
  for (const rule of SIGNAL_RULES) {
    const per: Partial<Record<AssetCode, SignalSeries>> = {};
    for (const code of inc) per[code] = computeSignals(panel.assets[code], rule);
    cache[rule] = per;
  }
  return cache;
}

export interface SignalCacheFile {
  schema: 'core6-v3-signal-cache-v1';
  panel: PanelName;
  panelSha256: string;
  signalsSha256: string;
  dates: string[];
  signals: SignalCache;
}

export function signalCachePath(name: PanelName): string {
  return path.join(OUTPUT_DIR, name === 'P' ? 'signal_cache.json' : `signal_cache_${name}.json`);
}

/** 전체 패널 신호 캐시를 만들어 저장하고 해시를 기록한다(성과 없음, 비중 무관). */
export function writeSignalCache(name: PanelName, panel: Panel, panelSha: string): SignalCacheFile {
  const signals = computeSignalCache(panel);
  const file: SignalCacheFile = {
    schema: 'core6-v3-signal-cache-v1',
    panel: name,
    panelSha256: panelSha,
    signalsSha256: jsonHash(signals),
    dates: panel.dates,
    signals,
  };
  writeFileSync(signalCachePath(name), JSON.stringify(file));
  return file;
}

/** 캐시가 현재 패널과 일치하면 재사용, 아니면 메모리에서 재계산(파일은 건드리지 않는다). */
export function loadOrComputeSignalCache(name: PanelName, panel: Panel, panelSha: string): SignalCache {
  const p = signalCachePath(name);
  if (existsSync(p)) {
    const f = JSON.parse(readFileSync(p, 'utf-8')) as SignalCacheFile;
    if (f.panelSha256 === panelSha && jsonHash(f.signals) === f.signalsSha256) return f.signals;
  }
  return computeSignalCache(panel);
}

/** 규칙의 시작 인덱스: 구성 자산 모두 valid 인 첫 세션(없으면 null). */
export function ruleStartIndex(cache: SignalCache, rule: SignalRuleId, codes: readonly AssetCode[], n: number): number | null {
  for (let i = 0; i < n; i++) {
    let ok = codes.length > 0;
    for (const code of codes) {
      const s = cache[rule][code];
      if (!s || !s.valid[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return null;
}

// ── CD91 현금금리 ───────────────────────────────────────────────────────────
export interface CdRow {
  date: string;
  /** 퍼센트(예: 0.66). */
  value: number;
}

interface EcosRow {
  TIME: string;
  DATA_VALUE: string;
}

export function loadCd91(file: string = CD91_PATH): CdRow[] {
  const raw = JSON.parse(readFileSync(file, 'utf-8')) as { rows: EcosRow[] };
  const rows: CdRow[] = [];
  for (const r of raw.rows) {
    const v = Number(r.DATA_VALUE);
    if (!/^\d{8}$/.test(r.TIME) || !Number.isFinite(v)) continue;
    rows.push({ date: `${r.TIME.slice(0, 4)}-${r.TIME.slice(4, 6)}-${r.TIME.slice(6, 8)}`, value: v });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows;
}

/**
 * 세션 i 의 연율 현금수익 = max(CD91 − 0.25%p, 0). CD91 은 **세션 날짜 이전(엄격히 <)**의 마지막 공표값만 쓴다
 * (같은 날 공표 시각을 증명할 수 없으므로 보수적). dates 마지막 날짜 이후 값은 읽지 않는다.
 */
export function cashRateArray(dates: readonly string[], cd91: readonly CdRow[]): number[] {
  const last = dates.length > 0 ? dates[dates.length - 1] : '';
  const rows = cd91.filter(r => r.date <= last);
  const out: number[] = [];
  let k = -1;
  for (let i = 0; i < dates.length; i++) {
    while (k + 1 < rows.length && rows[k + 1].date < dates[i]) k++;
    if (k < 0) throw new Error(`cashRateArray: no CD91 value before ${dates[i]}`);
    out.push(Math.max(rows[k].value / 100 - CASH_SPREAD, 0));
  }
  return out;
}

// ── 지표 ────────────────────────────────────────────────────────────────────
export interface Metrics {
  cagr: number;
  mdd: number;
  calmar: number;
  vol: number;
  finalEquity: number;
}

function dayNumber(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86400000;
}

/**
 * 자산곡선 → 지표. 기준점(startEquity, startDate)을 곡선 앞에 붙여 MDD·수익률·CAGR 을 계산한다.
 * 개발 전체: startEquity=초기자본, startDate=첫 세션. 구간 슬라이스: 직전 세션의 값/날짜.
 */
export function metricsFromEquity(equity: readonly number[], dates: readonly string[], startEquity: number, startDate: string): Metrics {
  const series = [startEquity, ...equity];
  const last = equity[equity.length - 1];
  const days = dayNumber(dates[dates.length - 1]) - dayNumber(startDate);
  const c = cagr(startEquity, last, days);
  const m = maxDrawdown(series);
  return { cagr: c, mdd: m, calmar: calmar(c, m), vol: annualizedVolatility(dailyReturns(series)), finalEquity: last };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Calmar 차이를 ±1e6 으로 clamp 하고 ∞−∞ 는 0 으로 둔다(중앙값 계산용). */
export function calmarDelta(strategy: number, bh: number): number {
  if (strategy === bh) return 0;
  const d = strategy - bh;
  if (Number.isNaN(d)) return 0;
  return Math.max(-1e6, Math.min(1e6, d));
}

/** `npx tsx file.ts` 로 직접 실행됐는지(import 시 CLI 가 돌지 않게). */
export function isMainModule(metaUrl: string): boolean {
  const arg = process.argv[1];
  if (!arg) return false;
  return path.resolve(fileURLToPath(metaUrl)) === path.resolve(arg);
}

export function argValue(argv: readonly string[], name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
