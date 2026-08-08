// scripts/backtest/usRoughCheck/usFetch.ts
// ---------------------------------------------------------------------------
// 미국 약식 사전점검 — Yahoo v8 일봉(OHLCV + adjclose) 수집·캐시.
//
// `lectureSignals/daaFetch.ts` 패턴을 그대로 본떴다(레이트리밋 350ms, 2초 후 1회 재시도,
// 범위인지 캐시). 다만 개별주 이벤트 스터디이므로 저장 항목이 다르다:
//   · adjClose : 배당·분할 조정 종가 → RS·수익률 계산의 기준(총수익).
//   · close    : Yahoo raw close. **분할조정은 되어 있고 배당조정은 안 되어 있다.**
//                E3(절대주가 $1~10) 판정에 쓰는 "명목주가" 근사치다.
//                ⚠ 나중에 분할한 종목은 과거 close가 소급 하향되어 실제 당시 주가보다 낮게
//                  보인다(4:1 분할 → 과거가 ÷4). 이 편향은 E3 해석에서 반드시 명시한다.
//   · volume   : 분할조정 거래량(close와 정합).
//   · amount   : close × volume = 실제 달러 거래대금(분할조정이 상쇄되어 불변).
//
// 데이터 잠금: period2 는 절대 2022-12-31 을 넘지 않는다(프로젝트 전체 원칙).
//
// 규칙: `any` 금지(파싱 경계 최소 예외), `console.*` 는 CLI 드라이버에서만, `Math.random` 금지.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadSp500Universe } from './universe';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCHEMA_VERSION = 1 as const;
const CACHE_DIR = path.join(__dirname, 'cache');
const FETCH_DELAY_MS = 350;
const RETRY_DELAY_MS = 2000;

/** 분석 구간. 지시대로 2010-01-01~2022-12-31(잠금 이후 확장 금지). */
export const DATA_START = '2010-01-01';
export const DATA_END = '2022-12-31';

/** 시장 벤치마크(B3 · 시장초과수익 차감용). */
export const BENCHMARK_SYMBOL = '^GSPC';

export interface UsBars {
  symbol: string;
  source: 'yahoo-v8';
  dates: string[];
  /** 배당·분할 조정 종가(총수익 레벨). RS·전방수익 계산 기준. */
  adjClose: number[];
  /** Yahoo raw close(분할조정 O, 배당조정 X). E3 명목주가 근사. */
  close: number[];
  /** 분할조정 거래량. */
  volume: number[];
  /** 달러 거래대금 = close × volume. */
  amount: number[];
  ok: boolean;
  error?: string;
}

interface CacheFile {
  schemaVersion: 1;
  symbol: string;
  source: 'yahoo-v8';
  requestedStart: string;
  requestedEnd: string;
  fetchedAt: string;
  series: UsBars;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitize(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9_.^=-]/g, '_');
}

function cachePath(symbol: string): string {
  return path.join(CACHE_DIR, `us_${sanitize(symbol)}.json`);
}

function toEpochSeconds(dateStr: string): number {
  return Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / 1000);
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v);
}

interface RawResult {
  timestamp?: number[];
  indicators?: {
    quote?: Array<{ close?: (number | null)[]; volume?: (number | null)[] }>;
    adjclose?: Array<{ adjclose?: (number | null)[] }>;
  };
}

async function fetchRaw(
  symbol: string,
  start: string,
  end: string
): Promise<{ ok: true; result: RawResult } | { ok: false; error: string }> {
  const p1 = toEpochSeconds(start);
  const p2 = toEpochSeconds(end) + 86400; // end 포함
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${p1}&period2=${p2}&interval=1d&includeAdjustedClose=true`;

  const attempt = async (): Promise<
    { ok: true; result: RawResult } | { ok: false; error: string }
  > => {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    const json: any = await res.json();
    const result = json?.chart?.result?.[0] as RawResult | undefined;
    if (!result) {
      const errDesc = json?.chart?.error?.description as string | undefined;
      return { ok: false, error: errDesc ?? 'no-result' };
    }
    return { ok: true, result };
  };

  try {
    return await attempt();
  } catch {
    await sleep(RETRY_DELAY_MS);
    try {
      return await attempt();
    } catch (e2) {
      return { ok: false, error: String(e2) };
    }
  }
}

function failed(symbol: string, error: string): UsBars {
  return {
    symbol, source: 'yahoo-v8', dates: [], adjClose: [], close: [], volume: [], amount: [],
    ok: false, error,
  };
}

/**
 * 개별주 시계열 재구성. adjclose·close·volume 이 모두 있는 바만 채택한다
 * (총수익·명목주가·거래대금을 모두 써야 하므로 어느 하나라도 없으면 그 바는 버린다).
 * adjclose 가 통째로 없으면 실패 처리(close 폴백 금지 — 배당 누락이 조용한 오류가 된다).
 * 지수(^GSPC)는 adjclose 가 close 와 같게 오므로 같은 경로로 처리된다.
 */
export function reconstruct(symbol: string, result: RawResult, requireVolume: boolean): UsBars {
  const ts = result.timestamp ?? [];
  const adj = result.indicators?.adjclose?.[0]?.adjclose ?? [];
  const closeArr = result.indicators?.quote?.[0]?.close ?? [];
  const volArr = result.indicators?.quote?.[0]?.volume ?? [];

  const hasAnyAdj = adj.some((v) => isNum(v));
  const source: (number | null)[] = hasAnyAdj ? adj : closeArr;
  if (!hasAnyAdj && !closeArr.some((v) => isNum(v))) return failed(symbol, 'no-price-column');

  const dates: string[] = [];
  const adjClose: number[] = [];
  const close: number[] = [];
  const volume: number[] = [];
  const amount: number[] = [];
  for (let i = 0; i < ts.length; i++) {
    const a = source[i];
    if (!isNum(a) || a <= 0) continue;
    const c = closeArr[i];
    if (!isNum(c) || c <= 0) continue;
    const v = volArr[i];
    const vol = isNum(v) && v >= 0 ? v : null;
    if (requireVolume && vol === null) continue;
    dates.push(new Date(ts[i] * 1000).toISOString().slice(0, 10));
    adjClose.push(a);
    close.push(c);
    volume.push(vol ?? 0);
    amount.push(c * (vol ?? 0));
  }
  if (dates.length === 0) return failed(symbol, 'no-usable-rows');
  return { symbol, source: 'yahoo-v8', dates, adjClose, close, volume, amount, ok: true };
}

function readCache(symbol: string, neededStart: string, neededEnd: string): UsBars | null {
  const file = cachePath(symbol);
  if (!existsSync(file)) return null;
  try {
    const cached = JSON.parse(readFileSync(file, 'utf-8')) as CacheFile;
    if (cached.schemaVersion !== SCHEMA_VERSION) return null;
    if (cached.requestedStart <= neededStart && cached.requestedEnd >= neededEnd) return cached.series;
    return null;
  } catch {
    return null;
  }
}

function writeCache(series: UsBars, requestedStart: string, requestedEnd: string): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const payload: CacheFile = {
    schemaVersion: SCHEMA_VERSION,
    symbol: series.symbol,
    source: 'yahoo-v8',
    requestedStart,
    requestedEnd,
    fetchedAt: new Date().toISOString(),
    series,
  };
  writeFileSync(cachePath(series.symbol), JSON.stringify(payload));
}

/** 단일 심볼 조회(캐시 우선). 실패해도 throw 없이 ok:false. */
export async function fetchUsSeries(
  symbol: string,
  start: string,
  end: string,
  requireVolume: boolean,
  onNetwork?: () => void
): Promise<UsBars> {
  const cached = readCache(symbol, start, end);
  if (cached) return cached;
  if (onNetwork) onNetwork();
  const raw = await fetchRaw(symbol, start, end);
  if (!raw.ok) return failed(symbol, 'error' in raw ? raw.error : 'fetch-failed');
  const series = reconstruct(symbol, raw.result, requireVolume);
  if (series.ok) writeCache(series, start, end);
  return series;
}

export interface FetchManyResult {
  bars: Map<string, UsBars>;
  failures: { symbol: string; error: string }[];
  networkCount: number;
  elapsedMs: number;
}

/** 여러 심볼 순차 조회. 네트워크 조회 사이에만 폴라이트 딜레이(캐시 히트엔 미적용). */
export async function fetchUsMany(
  symbols: readonly string[],
  start: string,
  end: string,
  onProgress?: (done: number, total: number, sym: string, ok: boolean, fromNet: boolean) => void
): Promise<FetchManyResult> {
  const t0 = Date.now();
  const uniq = Array.from(new Set(symbols));
  const bars = new Map<string, UsBars>();
  const failures: { symbol: string; error: string }[] = [];
  let networkCount = 0;
  for (let i = 0; i < uniq.length; i++) {
    const sym = uniq[i];
    let didNetwork = false;
    const series = await fetchUsSeries(sym, start, end, true, () => {
      didNetwork = true;
    });
    if (didNetwork) {
      networkCount++;
      await sleep(FETCH_DELAY_MS);
    }
    if (series.ok) bars.set(sym, series);
    else failures.push({ symbol: sym, error: series.error ?? 'unknown' });
    if (onProgress) onProgress(i + 1, uniq.length, sym, series.ok, didNetwork);
  }
  return { bars, failures, networkCount, elapsedMs: Date.now() - t0 };
}

// --- CLI 드라이버 (직접 실행 시에만 캐시 채우기) ----------------------------
async function main(): Promise<void> {

  const snap = await loadSp500Universe(() => console.log('위키백과 S&P500 구성종목 조회...'));
  if (!snap) {
    console.error('유니버스 확보 실패');
    process.exit(1);
    return;
  }
  console.log(`유니버스 ${snap.symbols.length}종목 (출처: ${snap.source}, ${snap.fetchedAt})`);
  console.log(`벤치마크 ${BENCHMARK_SYMBOL} + 개별주 일봉 수집 ${DATA_START}~${DATA_END}`);
  const bench = await fetchUsSeries(BENCHMARK_SYMBOL, DATA_START, DATA_END, false);
  console.log(`  ${bench.ok ? '✓' : '✗'} ${BENCHMARK_SYMBOL} ${bench.ok ? `${bench.dates.length}일` : bench.error}`);
  const res = await fetchUsMany(snap.symbols, DATA_START, DATA_END, (done, total, sym, ok, net) => {
    if (done % 25 === 0 || !ok) {
      console.log(`  [${done}/${total}] ${sym} ${ok ? 'ok' : 'FAIL'} ${net ? '(net)' : '(cache)'}`);
    }
  });
  console.log(
    `완료: 성공 ${res.bars.size} / 실패 ${res.failures.length} / 네트워크 ${res.networkCount}건 / ` +
      `${(res.elapsedMs / 1000).toFixed(1)}초`
  );
  if (res.failures.length > 0) {
    console.log(`실패 목록: ${res.failures.map((f) => `${f.symbol}(${f.error})`).join(', ')}`);
  }

}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((e) => {

    console.error('FETCH ERROR:', e);
    process.exit(1);
  });
}
