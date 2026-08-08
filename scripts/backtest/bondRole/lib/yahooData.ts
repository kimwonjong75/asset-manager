// scripts/backtest/bondRole/lib/yahooData.ts
// 채권 역할(bond-role) 연구 백테스트 전용 데이터 계층 — 연구 전용(앱/백엔드 무접촉).
// sectorRotation/lib/yahooData.ts 의 자기완결 복사본. 캐시 디렉토리만 이 폴더의 cache/ 로 격리한다
// (sectorRotation 캐시를 오염시키지 않기 위함 — 브리프 요구).
// Yahoo v8 chart API를 직접 조회해 수정(총수익) OHLC를 재구성하고, 날짜 범위 인지 캐시에 저장한다.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AdjSeries {
  symbol: string;
  source: 'yahoo-v8';
  dates: string[];
  adjOpen: (number | null)[];
  adjHigh: (number | null)[];
  adjLow: (number | null)[];
  adjClose: (number | null)[];
  volume: (number | null)[];
  rawClose: (number | null)[];
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
  series: AdjSeries;
}

const SCHEMA_VERSION = 1 as const;
const CACHE_DIR = path.join(__dirname, '..', 'cache');
const FETCH_DELAY_MS = 300;
const RETRY_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    quote?: Array<{
      open?: (number | null)[];
      high?: (number | null)[];
      low?: (number | null)[];
      close?: (number | null)[];
      volume?: (number | null)[];
    }>;
    adjclose?: Array<{ adjclose?: (number | null)[] }>;
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
    `?period1=${p1}&period2=${p2}&interval=1d&includeAdjustedClose=true`;

  const attempt = async (): Promise<{ ok: true; result: RawResult } | { ok: false; error: string }> => {
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
  } catch (e) {
    await sleep(RETRY_DELAY_MS);
    try {
      return await attempt();
    } catch (e2) {
      return { ok: false, error: String(e2) };
    }
  }
}

/**
 * 수정 OHLC 재구성. Yahoo 는 수정 CLOSE 만 주므로 factor=adjclose/close 를 open/high/low 에 곱해
 * 내부 일관 수정 OHLC 를 만든다. close/adjclose 가 없는 날은 건너뛴다. adjclose 전무 시 실패 처리.
 */
function reconstruct(symbol: string, result: RawResult): AdjSeries {
  const ts = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const adj = result.indicators?.adjclose?.[0]?.adjclose ?? [];

  const open = q.open ?? [];
  const high = q.high ?? [];
  const low = q.low ?? [];
  const close = q.close ?? [];
  const volume = q.volume ?? [];

  const hasAnyAdj = adj.some(v => isNum(v));
  if (!hasAnyAdj) {
    return emptySeries(symbol, 'adjclose-missing');
  }

  const dates: string[] = [];
  const adjOpen: (number | null)[] = [];
  const adjHigh: (number | null)[] = [];
  const adjLow: (number | null)[] = [];
  const adjClose: (number | null)[] = [];
  const vol: (number | null)[] = [];
  const rawClose: (number | null)[] = [];

  for (let i = 0; i < ts.length; i++) {
    const c = close[i];
    const a = adj[i];
    if (!isNum(c) || !isNum(a) || c === 0) continue;

    const factor = a / c;
    const o = open[i];
    const h = high[i];
    const l = low[i];
    const v = volume[i];

    dates.push(new Date(ts[i] * 1000).toISOString().slice(0, 10));
    adjOpen.push(isNum(o) ? o * factor : null);
    adjHigh.push(isNum(h) ? h * factor : null);
    adjLow.push(isNum(l) ? l * factor : null);
    adjClose.push(a);
    vol.push(isNum(v) ? v : null);
    rawClose.push(c);
  }

  if (dates.length === 0) return emptySeries(symbol, 'no-usable-rows');

  return {
    symbol,
    source: 'yahoo-v8',
    dates,
    adjOpen,
    adjHigh,
    adjLow,
    adjClose,
    volume: vol,
    rawClose,
    ok: true,
  };
}

function emptySeries(symbol: string, error: string): AdjSeries {
  return {
    symbol,
    source: 'yahoo-v8',
    dates: [],
    adjOpen: [],
    adjHigh: [],
    adjLow: [],
    adjClose: [],
    volume: [],
    rawClose: [],
    ok: false,
    error,
  };
}

function readCache(symbol: string, neededStart: string, neededEnd: string): AdjSeries | null {
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

function writeCache(series: AdjSeries, requestedStart: string, requestedEnd: string): void {
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

export async function fetchAdjSeries(
  symbol: string,
  start: string,
  end: string,
  onNetwork?: () => void
): Promise<AdjSeries> {
  const cached = readCache(symbol, start, end);
  if (cached) return cached;

  if (onNetwork) onNetwork();

  const raw = await fetchRaw(symbol, start, end);
  if (!raw.ok) {
    return emptySeries(symbol, 'error' in raw ? raw.error : 'fetch-failed');
  }

  const series = reconstruct(symbol, raw.result);
  if (series.ok) writeCache(series, start, end);
  return series;
}

export async function fetchMany(
  symbols: string[],
  start: string,
  end: string
): Promise<Map<string, AdjSeries>> {
  const uniq = Array.from(new Set(symbols));
  const out = new Map<string, AdjSeries>();
  let networkCount = 0;

  for (const sym of uniq) {
    let didNetwork = false;
    const series = await fetchAdjSeries(sym, start, end, () => {
      didNetwork = true;
    });
    if (didNetwork) {
      networkCount++;
      await sleep(FETCH_DELAY_MS);
    }
    out.set(sym, series);
    const tag = didNetwork ? 'net' : 'cache';
    console.log(
      `  ${series.ok ? '✓' : '✗'} ${sym.padEnd(11)} [${tag}]` +
        (series.ok
          ? ` ${series.dates.length}일, ${series.dates[0]}~${series.dates[series.dates.length - 1]}`
          : ` — ${series.error}`)
    );
  }
  console.log(`  (네트워크 조회 ${networkCount}건 / 캐시 히트 ${uniq.length - networkCount}건)`);
  return out;
}
