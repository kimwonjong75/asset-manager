// scripts/backtest/holdingsTurtleCycle/data.ts
// 데이터 로드·정렬·지표 — 순수(파일 읽기만, 네트워크 없음). freshTurtleLifecycle 관례를 그대로 재사용한다.
//
// 핵심 설계 결정(§리서치 범위):
//   · 사이징은 "그 종목 현금 100% 재매수"(비율 기반)이므로 이 엔진은 **환율을 쓰지 않는다** —
//     B&H·터틀사이클 모두 같은 종목의 같은 통화로 비교하므로 환율은 비율 계산에서 소거된다.
//     환율은 오직 비용모델의 "통화 라벨"(KRW 매도세 적용 여부)에만 쓰이고, costs.ts가 담당한다.
//   · 비정상 OHLC 행 제거는 freshTurtleLifecycle.classifyBar를 그대로 재사용한다(재발명 금지).
//   · 채널(고가/저가 극값)은 **현재 봉 제외**, 종목 자신의 유효 거래일 배열 위에서 계산한다.

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateATR } from '../../../utils/maCalculations';
import { classifyBar, ExcludedRow } from '../freshTurtleLifecycle/data';
import type { SymbolSeries } from '../lib/fetchHistory';
import type { Currency } from './symbolResolve';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');

export type { ExcludedRow };

/** 이번 연구에서 쓰는 채널 lookback 전부 (V1=55/20, V2=20/10, V3=55/55) — 종목당 한 번만 계산해 재사용. */
export const CHANNEL_LOOKBACKS = [10, 20, 55] as const;

export interface UniverseEntry {
  ticker: string;
  fetchSymbol: string;
  name: string;
  assetClass: string;
  currency: Currency;
  isCryptoTicker: boolean;
  isKrEtf: boolean;
}

export interface SecurityData {
  ticker: string;
  name: string;
  assetClass: string;
  currency: Currency;
  isCryptoTicker: boolean;
  isKrEtf: boolean;
  excludedRows: ExcludedRow[];
  ownDates: string[];
  ownOpen: (number | null)[];
  ownHigh: (number | null)[];
  ownLow: (number | null)[];
  ownClose: (number | null)[];
  /** i까지의 데이터로 계산한 ATR20 (인과적). utils/turtleEngine.computeN과 동일 알고리즘(calculateATR 재사용). */
  atr: (number | null)[];
  /** lookback → 현재 봉 제외 rolling 최고가(고가 배열 기준). */
  highChannel: Record<number, (number | null)[]>;
  /** lookback → 현재 봉 제외 rolling 최저가(저가 배열 기준). */
  lowChannel: Record<number, (number | null)[]>;
  validUpTo: number[];
}

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function firstValidIdx(values: (number | null)[]): number {
  for (let i = 0; i < values.length; i++) if (isNum(values[i])) return i;
  return -1;
}

/** 현재 봉 제외 rolling 극값 — freshTurtleLifecycle/data.ts와 동일 알고리즘의 로컬 사본(비export 헬퍼라 재사용 불가). */
function rollingExcludingCurrent(
  values: (number | null)[],
  lookback: number,
  mode: 'min' | 'max'
): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - lookback);
    let acc = mode === 'min' ? Infinity : -Infinity;
    let found = false;
    for (let k = start; k < i; k++) {
      const v = values[k];
      if (!isNum(v)) continue;
      found = true;
      if (mode === 'min') { if (v < acc) acc = v; } else { if (v > acc) acc = v; }
    }
    out[i] = found ? acc : null;
  }
  return out;
}

export function readCache(symbol: string): SymbolSeries | null {
  const f = path.join(CACHE_DIR, `${symbol.replace(/[^A-Za-z0-9_.=^-]/g, '_')}.json`);
  if (!existsSync(f)) return null;
  try {
    const s = JSON.parse(readFileSync(f, 'utf-8')) as SymbolSeries;
    return s.ok ? s : null;
  } catch {
    return null;
  }
}

/**
 * 종목 시계열 → SecurityData. ATR은 firstValid부터 슬라이스해 계산(calculateATR 워밍업-null 우회, 기존 관례).
 */
export function buildSecurity(params: {
  ticker: string;
  name: string;
  assetClass: string;
  currency: Currency;
  isCryptoTicker: boolean;
  isKrEtf: boolean;
  raw: SymbolSeries;
  atrPeriod: number;
  lookbacks?: readonly number[];
}): SecurityData {
  const lookbacks = params.lookbacks ?? CHANNEL_LOOKBACKS;
  const s = params.raw;
  const excludedRows: ExcludedRow[] = [];
  const dates: string[] = [];
  const open: (number | null)[] = [];
  const high: (number | null)[] = [];
  const low: (number | null)[] = [];
  const close: (number | null)[] = [];
  for (let i = 0; i < s.dates.length; i++) {
    const v = classifyBar(s.open[i], s.high[i], s.low[i], s.close[i]);
    if (v.valid === false) {
      excludedRows.push({ ticker: params.ticker, date: s.dates[i], reason: v.reason });
      continue;
    }
    dates.push(s.dates[i]);
    open.push(s.open[i]); high.push(s.high[i]); low.push(s.low[i]); close.push(s.close[i]);
  }

  const fv = Math.max(0, firstValidIdx(close));
  const atrSlice = calculateATR(high.slice(fv), low.slice(fv), close.slice(fv), params.atrPeriod);
  const atr: (number | null)[] = new Array(dates.length).fill(null);
  for (let i = 0; i < atrSlice.length; i++) atr[fv + i] = atrSlice[i];

  const validUpTo: number[] = new Array(dates.length).fill(0);
  let c = 0;
  for (let i = 0; i < dates.length; i++) { if (isNum(close[i])) c++; validUpTo[i] = c; }

  const highChannel: Record<number, (number | null)[]> = {};
  const lowChannel: Record<number, (number | null)[]> = {};
  for (const lb of lookbacks) {
    highChannel[lb] = rollingExcludingCurrent(high, lb, 'max');
    lowChannel[lb] = rollingExcludingCurrent(low, lb, 'min');
  }

  return {
    ticker: params.ticker, name: params.name, assetClass: params.assetClass,
    currency: params.currency, isCryptoTicker: params.isCryptoTicker, isKrEtf: params.isKrEtf,
    excludedRows,
    ownDates: dates, ownOpen: open, ownHigh: high, ownLow: low, ownClose: close,
    atr, highChannel, lowChannel, validUpTo,
  };
}

export interface MissingData { ticker: string; detail: string }

export interface LoadResult {
  securities: SecurityData[];
  missing: MissingData[];
}

/** 캐시에서 유니버스 전체를 로드한다. 캐시 없음/전부 결측/ok:false는 missing에 사유와 함께 기록(조용한 누락 금지). */
export function loadUniverseData(params: {
  entries: UniverseEntry[];
  atrPeriod: number;
  lookbacks?: readonly number[];
}): LoadResult {
  const missing: MissingData[] = [];
  const securities: SecurityData[] = [];
  for (const e of params.entries) {
    const raw = readCache(e.fetchSymbol);
    if (!raw) { missing.push({ ticker: e.ticker, detail: `캐시 없음 또는 ok=false (symbol=${e.fetchSymbol})` }); continue; }
    const hasAny = (['open', 'high', 'low', 'close'] as const).some(f => raw[f].some(isNum));
    if (!hasAny) { missing.push({ ticker: e.ticker, detail: `필드 전무 (symbol=${e.fetchSymbol})` }); continue; }
    securities.push(buildSecurity({
      ticker: e.ticker, name: e.name, assetClass: e.assetClass,
      currency: e.currency, isCryptoTicker: e.isCryptoTicker, isKrEtf: e.isKrEtf,
      raw, atrPeriod: params.atrPeriod, lookbacks: params.lookbacks,
    }));
  }
  return { securities, missing };
}
