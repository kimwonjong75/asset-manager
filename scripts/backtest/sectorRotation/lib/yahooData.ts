// scripts/backtest/sectorRotation/lib/yahooData.ts
// 섹터/테마 로테이션 백테스트 Gate 0 데이터 계층 — 연구 전용(앱/백엔드 무접촉).
// Yahoo v8 chart API를 직접 조회해 수정(총수익) OHLC를 재구성하고,
// 날짜 범위를 인지하는 전용 디스크 캐시에 저장한다.
//
// 왜 전용 캐시인가: 공유 scripts/backtest/data/cache/ 는 날짜 범위를 무시해서
// 짧은 구간으로 캐시된 파일을 긴 구간 요청 때도 그대로 재사용하는 버그가 있다.
// 여기서는 requestedStart/End 를 캐시에 기록하고 커버 여부를 검사한다.

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

// Yahoo 원시 JSON은 구조가 느슨하므로 파싱 지점에서만 any 를 허용한다(내부 한정).
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
  // end 는 포함되도록 하루치 여유(+1일)를 더한다.
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // 1회 재시도
    await sleep(RETRY_DELAY_MS);
    try {
      return await attempt();
    } catch (e2) {
      return { ok: false, error: String(e2) };
    }
  }
}

/**
 * 수정 OHLC 재구성.
 * Yahoo 는 수정 CLOSE 만 주고 open/high/low 는 원시값이다.
 * 일별 factor = adjclose/close 를 구해 open/high/low 에 곱해 내부 일관된 수정 OHLC 를 만든다.
 * (다음날 시가 체결 시 배당락/분할일에 가짜 수익이 생기지 않도록.)
 * close 나 adjclose 가 null/NaN 인 날은 건너뛴다.
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

  // adjclose 가 통째로 없으면 실패 처리 — 절대 미조정으로 대체하지 않는다.
  const hasAnyAdj = adj.some(v => isNum(v));
  if (!hasAnyAdj) {
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
      error: 'adjclose-missing',
    };
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
    // close/adjclose 필수 — 없으면 그 날 건너뜀
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

  if (dates.length === 0) {
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
      error: 'no-usable-rows',
    };
  }

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

function readCache(symbol: string, neededStart: string, neededEnd: string): AdjSeries | null {
  const file = cachePath(symbol);
  if (!existsSync(file)) return null;
  try {
    const cached = JSON.parse(readFileSync(file, 'utf-8')) as CacheFile;
    if (cached.schemaVersion !== SCHEMA_VERSION) return null;
    // 범위 인지: 캐시가 요청 범위를 완전히 포함할 때만 사용.
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

/**
 * 단일 심볼의 수정 OHLC 시계열을 가져온다.
 * 캐시가 요청 범위를 커버하면 네트워크 없이 반환(캐시 히트).
 * 실패해도 throw 하지 않고 ok:false 로 반환.
 * @param onNetwork 실제 네트워크 조회를 수행할 때 호출되는 콜백(폴라이트 딜레이 제어용).
 */
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
      error: 'error' in raw ? raw.error : 'fetch-failed',
    };
  }

  const series = reconstruct(symbol, raw.result);
  // 성공/실패 모두 캐시에 기록해두면 재실행이 빨라진다.
  // 단, 실패는 캐시하지 않는다(일시적 오류일 수 있으므로 다음 실행 때 재시도).
  if (series.ok) writeCache(series, start, end);
  return series;
}

/**
 * 여러 심볼을 순차 조회. 네트워크 조회 사이에만 ~300ms 딜레이(캐시 히트 사이엔 딜레이 없음).
 */
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
    // 첫 심볼이 아니고 직전에 네트워크를 탔으면 이번 조회 전에 딜레이.
    const series = await fetchAdjSeries(sym, start, end, () => {
      didNetwork = true;
    });
    if (didNetwork) {
      networkCount++;
      // 다음 네트워크 조회를 위한 폴라이트 딜레이(캐시 히트엔 적용 안 됨).
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
