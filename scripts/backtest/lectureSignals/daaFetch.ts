// scripts/backtest/lectureSignals/daaFetch.ts
// ---------------------------------------------------------------------------
// 동적자산배분(DAA) 5전략 백테스트용 미국 ETF 일봉 수집·캐시 (연구 전용, 앱/백엔드 무접촉).
//
// kospiIndex.ts 패턴을 그대로 본떴다. 단, kospiIndex는 지수라 close만 저장하지만
// DAA는 **배당 포함 총수익(total return)이 필수**이므로 adjclose(배당·분할 조정 종가)를
// 저장한다. 개별 ETF에서 close(미조정)를 쓰면 배당 재투자 수익이 통째로 누락된다.
//
// 캐시는 lectureSignals/cache/ 에 `daa_<심볼>.json` 으로 저장한다(파일명 접두사 daa_ 로
// 기존 ^KS11.json / 069500.KS.json 과 충돌 방지).
//
// 이 파일은 모듈이자 CLI 드라이버다. `npx tsx scripts/backtest/lectureSignals/daaFetch.ts`
// 로 직접 실행하면 아래 SYMBOLS 전체 캐시를 채운다. runDaa.ts 가 import 해도
// main()은 실행되지 않는다(직접 실행 가드).
//
// 규칙: `any` 금지(파싱 경계 최소 예외), 외부 I/O는 fs/fetch만. console은 드라이버에서만.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// v2: adjOpen 추가(월말신호→익월 첫 거래일 **시가** 체결에 필수). v1 캐시는 자동 무효화된다.
const SCHEMA_VERSION = 2 as const;
const CACHE_DIR = path.join(__dirname, 'cache');
const FETCH_DELAY_MS = 350;
const RETRY_DELAY_MS = 2000;

// 데이터 잠금: period2 는 절대 2022-12-31 을 넘지 않는다(계획서 엄수).
export const DATA_START = '2003-01-01';
export const DATA_END = '2022-12-31';

/** DAA 백테스트 심볼 전체(채권 8 + 주식/글로벌/안전 3 + 정적 2 + 현금 1). BIL·SPY 중복 제거됨. */
export const DAA_SYMBOLS: readonly string[] = [
  // 채권 8종
  'TLT', 'IEF', 'SHY', 'LQD', 'HYG', 'TIP', 'EMB', 'BWX',
  // 주식/글로벌/안전
  'SPY', 'VEU', 'AGG',
  // 정적(영구 포트폴리오) 전용 추가분
  'GLD', 'BIL',
];

export interface DaaSeries {
  symbol: string;
  source: 'yahoo-v8';
  dates: string[];        // 'YYYY-MM-DD' 오름차순
  adjClose: number[];     // 배당·분할 조정 종가(총수익 레벨). dates 와 index 정렬.
  /**
   * 조정 시가. Yahoo v8은 adjclose만 조정해서 주므로 **같은 날 조정계수**
   * `f = adjclose/close` 를 시가에 곱해 재구성한다(`adjOpen = open × f`).
   * 하루 안에서 배당·분할 계수는 상수이므로 시가·종가에 같은 f를 쓰는 것이 정의상 옳다.
   * 월말신호 → **익월 첫 거래일 시가** 체결(같은 봉 체결 금지)에 쓴다.
   */
  adjOpen: number[];
  ok: boolean;
  error?: string;
}

interface CacheFile {
  schemaVersion: 2;
  symbol: string;
  source: 'yahoo-v8';
  requestedStart: string;
  requestedEnd: string;
  fetchedAt: string;
  series: DaaSeries;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitize(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9_.^=-]/g, '_');
}

function cachePath(symbol: string): string {
  // daa_ 접두사로 기존 지수 캐시(^KS11.json 등)와 절대 충돌하지 않는다.
  return path.join(CACHE_DIR, `daa_${sanitize(symbol)}.json`);
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
    quote?: Array<{ close?: (number | null)[]; open?: (number | null)[] }>;
    adjclose?: Array<{ adjclose?: (number | null)[] }>;
  };
}

async function fetchRaw(
  symbol: string,
  start: string,
  end: string
): Promise<{ ok: true; result: RawResult } | { ok: false; error: string }> {
  const p1 = toEpochSeconds(start);
  const p2 = toEpochSeconds(end) + 86400; // end 포함되도록 하루 여유
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

/**
 * adjclose 시계열 재구성. adjclose 가 통째로 없으면 실패 처리(미조정 종가로 대체 금지 —
 * 총수익 지표가 목적이므로 close 폴백은 조용한 오류를 낳는다).
 */
function reconstruct(symbol: string, result: RawResult): DaaSeries {
  const ts = result.timestamp ?? [];
  const adj = result.indicators?.adjclose?.[0]?.adjclose ?? [];
  const close = result.indicators?.quote?.[0]?.close ?? [];
  const open = result.indicators?.quote?.[0]?.open ?? [];

  const hasAnyAdj = adj.some((v) => isNum(v));
  if (!hasAnyAdj) {
    return {
      symbol, source: 'yahoo-v8', dates: [], adjClose: [], adjOpen: [], ok: false,
      error: 'adjclose-missing',
    };
  }

  const dates: string[] = [];
  const adjClose: number[] = [];
  const adjOpen: number[] = [];
  for (let i = 0; i < ts.length; i++) {
    const a = adj[i];
    // adjclose 필수. close·open 도 필수(조정계수 f=a/c 로 시가를 조정해야 익월 시가 체결이 가능).
    if (!isNum(a) || a <= 0) continue;
    const c = close[i];
    if (!isNum(c) || c <= 0) continue;
    const o = open[i];
    if (!isNum(o) || o <= 0) continue;
    dates.push(new Date(ts[i] * 1000).toISOString().slice(0, 10));
    adjClose.push(a);
    adjOpen.push(o * (a / c));
  }

  if (dates.length === 0) {
    return {
      symbol, source: 'yahoo-v8', dates: [], adjClose: [], adjOpen: [], ok: false,
      error: 'no-usable-rows',
    };
  }
  return { symbol, source: 'yahoo-v8', dates, adjClose, adjOpen, ok: true };
}

function readCache(symbol: string, neededStart: string, neededEnd: string): DaaSeries | null {
  const file = cachePath(symbol);
  if (!existsSync(file)) return null;
  try {
    const cached = JSON.parse(readFileSync(file, 'utf-8')) as CacheFile;
    if (cached.schemaVersion !== SCHEMA_VERSION) return null;
    if (cached.requestedStart <= neededStart && cached.requestedEnd >= neededEnd) {
      return cached.series;
    }
    return null;
  } catch {
    return null;
  }
}

function writeCache(series: DaaSeries, requestedStart: string, requestedEnd: string): void {
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

/**
 * 단일 심볼의 adjclose 총수익 시계열을 가져온다(캐시 우선). 실패해도 throw 없이 ok:false.
 * onNetwork 는 실제 네트워크 조회 시에만 호출(로그/딜레이용).
 */
export async function fetchDaaSeries(
  symbol: string,
  start: string,
  end: string,
  onNetwork?: () => void
): Promise<DaaSeries> {
  const cached = readCache(symbol, start, end);
  if (cached) return cached;
  if (onNetwork) onNetwork();
  const raw = await fetchRaw(symbol, start, end);
  if (!raw.ok) {
    const err = 'error' in raw ? raw.error : 'fetch-failed';
    return { symbol, source: 'yahoo-v8', dates: [], adjClose: [], adjOpen: [], ok: false, error: err };
  }
  const series = reconstruct(symbol, raw.result);
  if (series.ok) writeCache(series, start, end);
  return series;
}

/** 여러 심볼을 순차 조회. 네트워크 조회 사이에만 폴라이트 딜레이(캐시 히트엔 미적용). */
export async function fetchDaaMany(
  symbols: readonly string[],
  start: string,
  end: string
): Promise<Map<string, DaaSeries>> {
  const uniq = Array.from(new Set(symbols));
  const out = new Map<string, DaaSeries>();
  let networkCount = 0;
  for (const sym of uniq) {
    let didNetwork = false;
    const series = await fetchDaaSeries(sym, start, end, () => {
      didNetwork = true;
    });
    if (didNetwork) {
      networkCount++;
      await sleep(FETCH_DELAY_MS);
    }
    out.set(sym, series);
    const tag = didNetwork ? 'net' : 'cache';

    console.log(
      `  ${series.ok ? '✓' : '✗'} ${sym.padEnd(6)} [${tag}]` +
        (series.ok
          ? ` ${series.dates.length}일, ${series.dates[0]}~${series.dates[series.dates.length - 1]}` +
            ` first=${series.adjClose[0].toFixed(2)} last=${series.adjClose[series.adjClose.length - 1].toFixed(2)}`
          : ` — ${series.error}`)
    );
  }

  console.log(`  (네트워크 조회 ${networkCount}건 / 캐시 히트 ${uniq.length - networkCount}건)`);
  return out;
}

// --- CLI 드라이버 (직접 실행 시에만) ---------------------------------------
async function main(): Promise<void> {

  console.log(`DAA 캐시 채우기: ${DAA_SYMBOLS.length}종목, ${DATA_START}~${DATA_END}`);
  const map = await fetchDaaMany(DAA_SYMBOLS, DATA_START, DATA_END);
  const failed = Array.from(map.values()).filter((s) => !s.ok);
  if (failed.length > 0) {

    console.log(`\n실패 티커 ${failed.length}건: ${failed.map((s) => `${s.symbol}(${s.error})`).join(', ')}`);
  } else {

    console.log('\n전체 성공.');
  }
}

// tsx/node ESM 에서 "직접 실행" 판정: import.meta.url === argv[1] 파일 URL.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((e) => {

    console.error('FETCH ERROR:', e);
    process.exit(1);
  });
}
