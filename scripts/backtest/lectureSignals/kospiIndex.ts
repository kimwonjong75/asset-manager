// scripts/backtest/lectureSignals/kospiIndex.ts
// ---------------------------------------------------------------------------
// D1(시장 레짐) 검증용 KOSPI 종합주가지수(^KS11) 일봉 수집·캐시.
//
// 이 파일은 이번 작업에서 유일하게 허용된 신규 외부 데이터 수집이다.
// sectorRotation/lib/yahooData.ts 패턴을 그대로 본떠 Yahoo v8 chart API를
// 직접 조회하고, 날짜 범위를 인지하는 전용 캐시(lectureSignals/cache/)에 저장한다.
//
// 지수는 배당·분할 이슈가 없으므로 종가(close)만 사용한다. adjclose가 없어도
// close를 그대로 레벨로 쓴다(개별주와 달리 지수 레벨은 미조정 종가가 정답).
//
// 규칙: `any` 금지(파싱 경계 최소 예외), 외부 I/O는 fs/fetch만.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCHEMA_VERSION = 1 as const;
const CACHE_DIR = path.join(__dirname, 'cache');
const RETRY_DELAY_MS = 2000;

export interface IndexSeries {
  symbol: string;
  source: 'yahoo-v8';
  dates: string[];
  close: number[];
  ok: boolean;
  error?: string;
}

interface CacheFile {
  schemaVersion: 1;
  symbol: string;
  requestedStart: string;
  requestedEnd: string;
  fetchedAt: string;
  series: IndexSeries;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitize(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9_.^=-]/g, '_');
}

function cachePath(symbol: string): string {
  return path.join(CACHE_DIR, `${sanitize(symbol)}.json`);
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
    quote?: Array<{ close?: (number | null)[] }>;
  };
}

async function fetchRaw(
  symbol: string,
  start: string,
  end: string
): Promise<{ ok: true; result: RawResult } | { ok: false; error: string }> {
  const p1 = toEpochSeconds(start);
  const p2 = toEpochSeconds(end) + 86400;
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${p1}&period2=${p2}&interval=1d`;

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

function reconstruct(symbol: string, result: RawResult): IndexSeries {
  const ts = result.timestamp ?? [];
  const close = result.indicators?.quote?.[0]?.close ?? [];
  const dates: string[] = [];
  const closes: number[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = close[i];
    if (!isNum(c) || c <= 0) continue;
    dates.push(new Date(ts[i] * 1000).toISOString().slice(0, 10));
    closes.push(c);
  }
  if (dates.length === 0) {
    return { symbol, source: 'yahoo-v8', dates: [], close: [], ok: false, error: 'no-usable-rows' };
  }
  return { symbol, source: 'yahoo-v8', dates, close: closes, ok: true };
}

function readCache(symbol: string, neededStart: string, neededEnd: string): IndexSeries | null {
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

function writeCache(series: IndexSeries, requestedStart: string, requestedEnd: string): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const payload: CacheFile = {
    schemaVersion: SCHEMA_VERSION,
    symbol: series.symbol,
    requestedStart,
    requestedEnd,
    fetchedAt: new Date().toISOString(),
    series,
  };
  writeFileSync(cachePath(series.symbol), JSON.stringify(payload));
}

/**
 * 지수 종가 시계열을 가져온다(캐시 우선). 실패해도 throw 없이 ok:false.
 * onNetwork는 실제 네트워크 조회 시에만 호출(로그/딜레이용).
 */
export async function fetchIndexSeries(
  symbol: string,
  start: string,
  end: string,
  onNetwork?: () => void
): Promise<IndexSeries> {
  const cached = readCache(symbol, start, end);
  if (cached) return cached;
  if (onNetwork) onNetwork();
  const raw = await fetchRaw(symbol, start, end);
  if (!raw.ok) {
    const err = 'error' in raw ? raw.error : 'fetch-failed';
    return { symbol, source: 'yahoo-v8', dates: [], close: [], ok: false, error: err };
  }
  const series = reconstruct(symbol, raw.result);
  if (series.ok) writeCache(series, start, end);
  return series;
}
