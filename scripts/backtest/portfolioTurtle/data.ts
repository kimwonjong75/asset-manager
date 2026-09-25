// scripts/backtest/portfolioTurtle/data.ts
// 데이터 로드·정렬·지표 — 순수(파일 읽기만, 네트워크 없음). CSV·티커해석·비용은 holdingsTurtleCycle을
// 재사용하고, 비정상 OHLC 제거는 freshTurtleLifecycle.classifyBar를 재사용한다(재발명 금지).
//
// holdingsTurtleCycle/data.ts(종목별 독립 자본곡선, 환율 불필요)와 달리 이 스크립트는 **공유 현금
// 포트폴리오**를 KRW 한 계좌로 평가해야 하므로 union 캘린더 + 환율 테이블(freshTurtleLifecycle 방식)이
// 필요하다. JPY는 fx.ts가 usdKrw만 기본 제공하므로 JPY=X(USD/JPY) 캐시와 교차환산한다:
//   JPY/KRW = (USD/KRW) ÷ (USD/JPY)

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateATR } from '../../../utils/maCalculations';
import { simpleMovingAverage } from '../coreStopLoss/lib/movingAverage';
import { classifyBar, ExcludedRow } from '../freshTurtleLifecycle/data';
import { fxRateFor, FxTable } from '../lib/fx';
import type { SymbolSeries } from '../lib/fetchHistory';
import { loadHoldingsCsv, dedupeByTicker } from '../holdingsTurtleCycle/csvHoldings';
import { resolveSymbol, Currency } from '../holdingsTurtleCycle/symbolResolve';
import { classifyScope, ScopeClass } from './classification';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');
const USD_KRW_SYMBOL = 'KRW=X';
const USD_JPY_SYMBOL = 'JPY=X';

export const EXIT20_LOOKBACK = 20;
export const EXIT55_LOOKBACK = 55;
export const ENTRY_LOOKBACK = 55;
export const SMA_PERIOD = 50;
export const ATR_PERIOD = 20;

export type { ExcludedRow };

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function firstValidIdx(values: (number | null)[]): number {
  for (let i = 0; i < values.length; i++) if (isNum(values[i])) return i;
  return -1;
}

/** 현재 봉 제외 rolling 극값 — 로컬 사본(freshTurtleLifecycle/holdingsTurtleCycle의 비export 헬퍼와 동일 알고리즘). */
function rollingExcludingCurrent(values: (number | null)[], lookback: number, mode: 'min' | 'max'): (number | null)[] {
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

function readCache(symbol: string): SymbolSeries | null {
  const f = path.join(CACHE_DIR, `${symbol.replace(/[^A-Za-z0-9_.=^-]/g, '_')}.json`);
  if (!existsSync(f)) return null;
  try {
    const s = JSON.parse(readFileSync(f, 'utf-8')) as SymbolSeries;
    return s.ok ? s : null;
  } catch {
    return null;
  }
}

export interface PortfolioSecurity {
  ticker: string;
  name: string;
  assetClass: string;
  currency: Currency;
  isCryptoTicker: boolean;
  isKrEtf: boolean;
  /** CSV 현재평가금액 ÷ 전체 합계 (0~1). 12개 시작일 전부에 동일하게(가상으로) 적용한다. */
  weightPct: number;
  scopeClass: ScopeClass;
  excludedRows: ExcludedRow[];
  // ── 종목 자신의 유효 거래일 배열 ──
  ownDates: string[];
  ownOpen: (number | null)[];
  ownHigh: (number | null)[];
  ownLow: (number | null)[];
  ownClose: (number | null)[];
  atr: (number | null)[];             // 인과적 ATR20
  highChannel55: (number | null)[];   // 현재봉 제외, 재진입(55일 신고가)
  lowChannel20: (number | null)[];    // 현재봉 제외, W1
  lowChannel55: (number | null)[];    // 현재봉 제외, W2
  sma50: (number | null)[];           // 당일 포함, W4
  // ── 합집합 달력 매핑 ──
  ownIdxOfCal: number[];
  calIdxOfOwn: number[];
  closeForValuation: (number | null)[];
}

export interface MissingData { ticker: string; detail: string }

export interface LoadedPortfolioData {
  calendar: string[];
  securities: PortfolioSecurity[];
  fx: FxTable;
  /** CSV 고유 티커 전체 평가금액 합(원화) — 시작 예산으로 쓴다. */
  totalBudgetKRW: number;
  missing: MissingData[];
  csvRowCount: number;
  csvUniqueCount: number;
}

/** export된 순수 빌더 — 테스트가 합성 SymbolSeries로 PortfolioSecurity를 직접 구성할 때 재사용(캐시/CSV 불필요). */
export function buildSecurityIndicators(params: {
  ticker: string; name: string; assetClass: string; currency: Currency;
  isCryptoTicker: boolean; isKrEtf: boolean; weightPct: number; scopeClass: ScopeClass;
  raw: SymbolSeries; calendar: string[];
}): PortfolioSecurity {
  const s = params.raw;
  const excludedRows: ExcludedRow[] = [];
  const dates: string[] = [], open: (number | null)[] = [], high: (number | null)[] = [],
    low: (number | null)[] = [], close: (number | null)[] = [];
  for (let i = 0; i < s.dates.length; i++) {
    const v = classifyBar(s.open[i], s.high[i], s.low[i], s.close[i]);
    if (v.valid === false) { excludedRows.push({ ticker: params.ticker, date: s.dates[i], reason: v.reason }); continue; }
    dates.push(s.dates[i]);
    open.push(s.open[i]); high.push(s.high[i]); low.push(s.low[i]); close.push(s.close[i]);
  }

  const fv = Math.max(0, firstValidIdx(close));
  const atrSlice = calculateATR(high.slice(fv), low.slice(fv), close.slice(fv), ATR_PERIOD);
  const atr: (number | null)[] = new Array(dates.length).fill(null);
  for (let i = 0; i < atrSlice.length; i++) atr[fv + i] = atrSlice[i];

  const sma50 = simpleMovingAverage(close, SMA_PERIOD);

  const calIdxByDate = new Map<string, number>();
  params.calendar.forEach((d, i) => calIdxByDate.set(d, i));
  const ownIdxOfCal: number[] = new Array(params.calendar.length).fill(-1);
  const calIdxOfOwn: number[] = new Array(dates.length).fill(-1);
  for (let j = 0; j < dates.length; j++) {
    const ci = calIdxByDate.get(dates[j]);
    if (ci === undefined) continue;
    calIdxOfOwn[j] = ci;
    ownIdxOfCal[ci] = j;
  }

  const closeForValuation: (number | null)[] = new Array(params.calendar.length).fill(null);
  let last: number | null = null;
  for (let i = 0; i < params.calendar.length; i++) {
    const j = ownIdxOfCal[i];
    if (j >= 0 && isNum(close[j])) last = close[j] as number;
    closeForValuation[i] = last;
  }

  return {
    ticker: params.ticker, name: params.name, assetClass: params.assetClass, currency: params.currency,
    isCryptoTicker: params.isCryptoTicker, isKrEtf: params.isKrEtf, weightPct: params.weightPct, scopeClass: params.scopeClass,
    excludedRows,
    ownDates: dates, ownOpen: open, ownHigh: high, ownLow: low, ownClose: close,
    atr,
    highChannel55: rollingExcludingCurrent(high, ENTRY_LOOKBACK, 'max'),
    lowChannel20: rollingExcludingCurrent(low, EXIT20_LOOKBACK, 'min'),
    lowChannel55: rollingExcludingCurrent(low, EXIT55_LOOKBACK, 'min'),
    sma50,
    ownIdxOfCal, calIdxOfOwn, closeForValuation,
  };
}

function buildFx(calendar: string[]): { fx: FxTable; missing: MissingData[] } {
  const missing: MissingData[] = [];
  const usdRaw = readCache(USD_KRW_SYMBOL);
  const jpyRaw = readCache(USD_JPY_SYMBOL);
  if (!usdRaw) missing.push({ ticker: USD_KRW_SYMBOL, detail: '환율 캐시 없음 — USD 자산 평가 불가' });
  if (!jpyRaw) missing.push({ ticker: USD_JPY_SYMBOL, detail: '환율 캐시 없음 — JPY 자산 평가 불가(USD/JPY 교차환산 필요)' });

  const alignCarryForward = (raw: SymbolSeries | null): (number | null)[] => {
    const out: (number | null)[] = new Array(calendar.length).fill(null);
    if (!raw) return out;
    const idx = new Map<string, number>();
    raw.dates.forEach((d, i) => idx.set(d, i));
    let last: number | null = null;
    for (let i = 0; i < calendar.length; i++) {
      const j = idx.get(calendar[i]);
      if (j !== undefined && isNum(raw.close[j])) last = raw.close[j] as number;
      out[i] = last;
    }
    const fvi = firstValidIdx(out);
    if (fvi > 0) for (let i = 0; i < fvi; i++) out[i] = out[fvi];
    return out;
  };

  const usdKrw = alignCarryForward(usdRaw);
  const usdJpy = alignCarryForward(jpyRaw);
  // JPY/KRW = (USD/KRW) ÷ (USD/JPY) — 교차환산. 둘 다 유효할 때만 계산, 아니면 null(fail-closed).
  const jpyKrw: (number | null)[] = calendar.map((_, i) => {
    const u = usdKrw[i], j = usdJpy[i];
    return isNum(u) && isNum(j) && j > 0 ? u / j : null;
  });

  return { fx: { usdKrw, jpyKrw }, missing };
}

export function loadPortfolioData(csvPath: string): LoadedPortfolioData {
  const rows = loadHoldingsCsv(csvPath);
  const unique = dedupeByTicker(rows);
  const missing: MissingData[] = [];

  interface RawEntry {
    ticker: string; name: string; assetClass: string; currency: Currency;
    isCryptoTicker: boolean; isKrEtf: boolean; weightPct: number; scopeClass: ScopeClass; raw: SymbolSeries;
  }
  const totalKRW = unique.reduce((s, u) => s + u.totalCurrentValueKRW, 0);
  const rawEntries: RawEntry[] = [];
  for (const u of unique) {
    const r = resolveSymbol({ ticker: u.ticker, exchange: u.exchange, name: u.name });
    const raw = readCache(r.fetchSymbol);
    if (!raw) { missing.push({ ticker: u.ticker, detail: `캐시 없음 또는 ok=false (symbol=${r.fetchSymbol})` }); continue; }
    const hasAny = (['open', 'high', 'low', 'close'] as const).some(f => raw[f].some(isNum));
    if (!hasAny) { missing.push({ ticker: u.ticker, detail: `필드 전무 (symbol=${r.fetchSymbol})` }); continue; }
    const scopeClass = classifyScope({ ticker: u.ticker, name: u.name, assetClass: u.assetClass, isKrEtf: r.isKrEtf });
    rawEntries.push({
      ticker: u.ticker, name: u.name, assetClass: u.assetClass, currency: r.currency,
      isCryptoTicker: r.isCryptoTicker, isKrEtf: r.isKrEtf,
      weightPct: totalKRW > 0 ? u.totalCurrentValueKRW / totalKRW : 0,
      scopeClass, raw,
    });
  }

  // union 달력 — 확보된 종목들의 유효 거래일 전체
  const dateSet = new Set<string>();
  for (const e of rawEntries) {
    for (let i = 0; i < e.raw.dates.length; i++) {
      const v = classifyBar(e.raw.open[i], e.raw.high[i], e.raw.low[i], e.raw.close[i]);
      if (v.valid) dateSet.add(e.raw.dates[i]);
    }
  }
  const calendar = Array.from(dateSet).sort();

  const { fx, missing: fxMissing } = buildFx(calendar);
  missing.push(...fxMissing);

  const securities: PortfolioSecurity[] = rawEntries.map(e => buildSecurityIndicators({
    ticker: e.ticker, name: e.name, assetClass: e.assetClass, currency: e.currency,
    isCryptoTicker: e.isCryptoTicker, isKrEtf: e.isKrEtf, weightPct: e.weightPct, scopeClass: e.scopeClass,
    raw: e.raw, calendar,
  }));

  return { calendar, securities, fx, totalBudgetKRW: totalKRW, missing, csvRowCount: rows.length, csvUniqueCount: unique.length };
}

/** 종목 통화 → KRW 환율 (기존 lib/fx 경로 재사용). */
export function fxAt(currency: Currency, fx: FxTable, calIdx: number): number {
  return fxRateFor(currency, fx, calIdx);
}

/** calIdx 이전(포함) 가장 최근의 그 종목 own 인덱스 — 상장 전/휴장일에도 시작일을 잡을 수 있게. */
export function ownIdxOnOrBefore(sec: PortfolioSecurity, calIdx: number): number {
  for (let c = calIdx; c >= 0; c--) {
    const j = sec.ownIdxOfCal[c];
    if (j >= 0) return j;
  }
  return -1;
}

/** "YYYY-MM" → 그 달의 union 캘린더 첫 거래일 인덱스. 없으면 -1. */
export function resolveMonthStartCalIdx(calendar: string[], yyyyMm: string): number {
  const prefix = `${yyyyMm}-`;
  for (let i = 0; i < calendar.length; i++) if (calendar[i].startsWith(prefix)) return i;
  return -1;
}
