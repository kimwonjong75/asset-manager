// scripts/backtest/freshTurtleLifecycle/data.ts
// 데이터 로드·정렬·지표 — 순수(파일 읽기만). 네트워크 없음. 신규 종목 추가 없음.
//
// 핵심 규약:
//   · 지표(ATR20·55일 채널·20일 채널)는 **종목 자신의 실제 거래일 배열** 위에서 계산한다.
//     합집합 달력 행이나 carry-forward 된 봉을 20/55일로 세지 않는다.
//   · 채널은 **현재 봉 제외**: ch55High[j] = max(high[j-55..j-1]), ch20Low[j] = min(low[j-20..j-1]).
//   · 합집합 달력 정렬 시 **평가용 종가만 carry-forward**. 시가·고가·저가는 이월하지 않는다(null).
//     tradedOn[i] 가 false 면 그 종목은 그날 신호·체결 대상이 아니다(휴장).
//   · 환율은 기존 경로(lib/fx.ts + KRW=X)를 쓴다. 외화를 환율 1로 처리하지 않는다.

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateATR } from '../../../utils/maCalculations';
import type { SymbolSeries } from '../lib/fetchHistory';
import { fxRateFor, buildFxTable, FxTable } from '../lib/fx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');

const USD_KRW_SYMBOL = 'KRW=X';

export interface MissingData {
  ticker: string;
  detail: string;
}

/** 비정상 행(실제 거래일로 취급하지 않고 제외) 기록 — 보고서에 명시한다. */
export interface ExcludedRow {
  ticker: string;
  date: string;
  reason: 'all-null' | 'partial-null-or-nonpositive' | 'ohlc-relation';
}

export interface SecurityData {
  ticker: string;
  currency: 'KRW' | 'USD';
  isCrypto: boolean;
  /** 제외된 비정상 행 (이 종목) */
  excludedRows: ExcludedRow[];
  // ── 종목 자신의 **유효** 거래일 배열 (비정상 행은 제거됨) ──
  ownDates: string[];
  ownOpen: (number | null)[];
  ownHigh: (number | null)[];
  ownLow: (number | null)[];
  ownClose: (number | null)[];
  atr: (number | null)[];       // own idx — D일까지 사용한 ATR20 (인과적)
  ch55High: (number | null)[];  // own idx — 현재 봉 제외
  ch20Low: (number | null)[];   // own idx — 현재 봉 제외
  validUpTo: number[];          // own idx → 누적 유효 종가 수
  // ── 합집합 달력 매핑 ──
  ownIdxOfCal: number[];        // cal idx → own idx (미거래일 = -1)
  calIdxOfOwn: number[];        // own idx → cal idx (구간 밖 = -1)
  closeForValuation: (number | null)[]; // cal idx — 평가 전용 carry-forward
}

export interface LoadedData {
  calendar: string[];
  securities: SecurityData[];
  fx: FxTable;
  missing: MissingData[];
  /** 전 종목에서 제외된 비정상 행 (보고서 기록용) */
  excludedRows: ExcludedRow[];
}

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
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

/** 현재 봉 제외 rolling 극값 (자기 거래일 배열 기준). */
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
    for (let k = start; k < i; k++) {   // k < i → 현재 봉 제외
      const v = values[k];
      if (!isNum(v)) continue;
      found = true;
      if (mode === 'min') { if (v < acc) acc = v; } else { if (v > acc) acc = v; }
    }
    out[i] = found ? acc : null;
  }
  return out;
}

function firstValidIdx(values: (number | null)[]): number {
  for (let i = 0; i < values.length; i++) if (isNum(values[i])) return i;
  return -1;
}

/**
 * 실제 거래일 판정 (AMENDED-1 #1).
 * O/H/L/C 가 모두 유한한 **양수**이고 OHLC 관계(l ≤ o,c ≤ h)가 정상인 행만 실제 거래일로 취급한다.
 * 비정상 행(예: BTC-USD·ETH-USD 의 2026-07-06 전부 null)은 **배열에서 제거**한다 —
 * 제거하면 ownIdx+1 이 자동으로 "다음 유효 거래일"이 되고, ATR·55/20 채널도 유효 거래일만 세게 된다.
 */
export function classifyBar(
  o: number | null, h: number | null, l: number | null, c: number | null
): { valid: true } | { valid: false; reason: ExcludedRow['reason'] } {
  const vals = [o, h, l, c];
  if (vals.every(v => v === null)) return { valid: false, reason: 'all-null' };
  if (!vals.every(v => isNum(v) && v > 0)) return { valid: false, reason: 'partial-null-or-nonpositive' };
  const O = o as number, H = h as number, L = l as number, Cc = c as number;
  if (!(L <= O && O <= H && L <= Cc && Cc <= H)) return { valid: false, reason: 'ohlc-relation' };
  return { valid: true };
}

/**
 * 종목 시계열 → SecurityData.
 * ATR 은 firstValid 부터 슬라이스해 계산한다 — calculateATR 은 워밍업 창에 null 이 하나라도 있으면
 * 이후 전 구간 null 을 반환한다(앱 코드라 수정 불가). 상장일부터 잘라 우회한다.
 */
export function buildSecurity(
  ticker: string,
  currency: 'KRW' | 'USD',
  isCrypto: boolean,
  s: SymbolSeries,
  calendar: string[],
  atrPeriod: number,
  entryLookback: number,
  exitLookback: number
): SecurityData {
  // ── AMENDED-1 #1: 유효 거래일만 남긴다 (비정상 행 제거) ──
  const excludedRows: ExcludedRow[] = [];
  const dates: string[] = [], open: (number | null)[] = [], high: (number | null)[] = [],
    low: (number | null)[] = [], close: (number | null)[] = [];
  for (let i = 0; i < s.dates.length; i++) {
    const v = classifyBar(s.open[i], s.high[i], s.low[i], s.close[i]);
    if (v.valid === false) { excludedRows.push({ ticker, date: s.dates[i], reason: v.reason }); continue; }
    dates.push(s.dates[i]);
    open.push(s.open[i]); high.push(s.high[i]); low.push(s.low[i]); close.push(s.close[i]);
  }

  // 필터링 후엔 전 행이 유효하므로 fv=0. (calculateATR 워밍업-null 버그 우회는 필터링으로 자동 해소)
  const fv = Math.max(0, firstValidIdx(close));
  const atrSlice = calculateATR(high.slice(fv), low.slice(fv), close.slice(fv), atrPeriod);
  const atr: (number | null)[] = new Array(dates.length).fill(null);
  for (let i = 0; i < atrSlice.length; i++) atr[fv + i] = atrSlice[i];

  const validUpTo: number[] = new Array(dates.length).fill(0);
  let c = 0;
  for (let i = 0; i < dates.length; i++) { if (isNum(close[i])) c++; validUpTo[i] = c; }

  // 달력 매핑 — 제외된 행의 날짜는 ownIdxOfCal 에 매핑되지 않으므로 그날은 신호·체결 대상이 아니다.
  const calIdxByDate = new Map<string, number>();
  calendar.forEach((d, i) => calIdxByDate.set(d, i));
  const ownIdxOfCal: number[] = new Array(calendar.length).fill(-1);
  const calIdxOfOwn: number[] = new Array(dates.length).fill(-1);
  for (let j = 0; j < dates.length; j++) {
    const ci = calIdxByDate.get(dates[j]);
    if (ci === undefined) continue;
    calIdxOfOwn[j] = ci;
    ownIdxOfCal[ci] = j;
  }

  // 평가용 종가만 carry-forward (시가·고가·저가는 이월 금지 — 여기서 만들지 않는다)
  const closeForValuation: (number | null)[] = new Array(calendar.length).fill(null);
  let last: number | null = null;
  for (let i = 0; i < calendar.length; i++) {
    const j = ownIdxOfCal[i];
    if (j >= 0 && isNum(close[j])) last = close[j] as number;
    closeForValuation[i] = last;
  }

  return {
    ticker, currency, isCrypto, excludedRows,
    ownDates: dates,
    ownOpen: open, ownHigh: high, ownLow: low, ownClose: close,
    atr,
    ch55High: rollingExcludingCurrent(high, entryLookback, 'max'),
    ch20Low: rollingExcludingCurrent(low, exitLookback, 'min'),
    validUpTo,
    ownIdxOfCal, calIdxOfOwn, closeForValuation,
  };
}

export function loadData(params: {
  tickers: readonly string[];
  cryptoTickers: readonly string[];
  start: string;
  end: string;
  atrPeriod: number;
  entryLookback: number;
  exitLookback: number;
}): LoadedData {
  const missing: MissingData[] = [];
  const raw = new Map<string, SymbolSeries>();

  for (const t of params.tickers) {
    const s = readCache(t);
    if (!s) { missing.push({ ticker: t, detail: '캐시 없음 또는 ok=false' }); continue; }
    for (const f of ['open', 'high', 'low', 'close'] as const) {
      if (s[f].filter(isNum).length === 0) missing.push({ ticker: t, detail: `필드 전무: ${f}` });
    }
    raw.set(t, s);
  }
  const fxRaw = readCache(USD_KRW_SYMBOL);
  if (!fxRaw) missing.push({ ticker: USD_KRW_SYMBOL, detail: '환율 캐시 없음 — 외화 자산 평가 불가' });
  if (missing.length > 0) return { calendar: [], securities: [], fx: { usdKrw: [], jpyKrw: [] }, missing, excludedRows: [] };

  // 합집합 달력 (거래 구간)
  const set = new Set<string>();
  for (const s of raw.values()) for (const d of s.dates) if (d >= params.start && d <= params.end) set.add(d);
  const calendar = Array.from(set).sort();

  const securities: SecurityData[] = [];
  for (const t of params.tickers) {
    const s = raw.get(t)!;
    const isCrypto = params.cryptoTickers.includes(t);
    const currency: 'KRW' | 'USD' = /^\d{6}$/.test(t) ? 'KRW' : 'USD';
    securities.push(buildSecurity(
      t, currency, isCrypto, s, calendar,
      params.atrPeriod, params.entryLookback, params.exitLookback
    ));
  }

  // 환율: 달력 정렬 + carry-forward (평가·환산용). lib/fx.ts 경로 재사용.
  const fxCalIdx = new Map<string, number>();
  calendar.forEach((d, i) => fxCalIdx.set(d, i));
  const usdKrw: (number | null)[] = new Array(calendar.length).fill(null);
  {
    const idx = new Map<string, number>();
    fxRaw!.dates.forEach((d, i) => idx.set(d, i));
    let last: number | null = null;
    for (let i = 0; i < calendar.length; i++) {
      const j = idx.get(calendar[i]);
      if (j !== undefined && isNum(fxRaw!.close[j])) last = fxRaw!.close[j] as number;
      usdKrw[i] = last;
    }
    // 달력 시작 이전 값이 없으면 첫 유효값으로 backfill (lib/fx.fxRateFor 의 nearestValid 와 동일 의미)
    const fvi = firstValidIdx(usdKrw);
    if (fvi > 0) for (let i = 0; i < fvi; i++) usdKrw[i] = usdKrw[fvi];
  }
  const fx = buildFxTable({ open: [], high: [], low: [], close: usdKrw }, { open: [], high: [], low: [], close: [] });

  const excludedRows = securities.flatMap(s => s.excludedRows);
  return { calendar, securities, fx, missing: [], excludedRows };
}

/** 종목 통화 → KRW 환율 (기존 lib/fx 경로). KRW=1, USD=KRW=X. */
export function fxAt(sec: SecurityData, fx: FxTable, calIdx: number): number {
  return fxRateFor(sec.currency, fx, calIdx);
}
