// scripts/backtest/lib/fetchHistory.ts
// Cloud Run /history 엔드포인트로 일봉 OHLC를 가져오고 디스크 캐시(scripts/backtest/data/cache/)에 저장.
// 캐시가 있으면 재다운로드하지 않는다 (재실행 시 네트워크 재요청 금지 — 사용자 요구사항).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CLOUD_RUN_BASE_URL } from '../../../constants/api';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface SymbolSeries {
  symbol: string;
  dates: string[];
  open: (number | null)[];
  high: (number | null)[];
  low: (number | null)[];
  close: (number | null)[];
  ok: boolean;
  error?: string;
}

interface HistoryEntry {
  data?: Record<string, number>;
  open?: Record<string, number>;
  high?: Record<string, number>;
  low?: Record<string, number>;
  error?: string;
}

const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');

function cachePath(symbol: string): string {
  const safe = symbol.replace(/[^A-Za-z0-9_.=^-]/g, '_');
  return path.join(CACHE_DIR, `${safe}.json`);
}

async function fetchRaw(symbol: string, startDate: string, endDate: string): Promise<HistoryEntry | null> {
  const res = await fetch(`${CLOUD_RUN_BASE_URL}/history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers: [symbol], start_date: startDate, end_date: endDate }),
  });
  if (!res.ok) {
    return { error: `HTTP ${res.status}` };
  }
  const text = await res.text();
  const json = JSON.parse(text.replace(/\bNaN\b/g, 'null'));
  return json[symbol] ?? null;
}

function toSeries(symbol: string, entry: HistoryEntry | null): SymbolSeries {
  if (!entry || entry.error || !entry.data) {
    return { symbol, dates: [], open: [], high: [], low: [], close: [], ok: false, error: entry?.error ?? 'no-data' };
  }
  const dates = Object.keys(entry.data).sort();
  const close = dates.map(d => (typeof entry.data![d] === 'number' && isFinite(entry.data![d]) ? entry.data![d] : null));
  const open = dates.map(d => (entry.open && typeof entry.open[d] === 'number' && isFinite(entry.open[d]) ? entry.open[d] : null));
  const high = dates.map(d => (entry.high && typeof entry.high[d] === 'number' && isFinite(entry.high[d]) ? entry.high[d] : null));
  const low = dates.map(d => (entry.low && typeof entry.low[d] === 'number' && isFinite(entry.low[d]) ? entry.low[d] : null));
  return { symbol, dates, open, high, low, close, ok: true };
}

/**
 * 심볼별 일봉 히스토리를 가져온다. 캐시 파일이 있으면 그대로 사용(재다운로드 금지).
 * 실패해도 예외를 던지지 않고 ok:false 로 반환 — 호출부가 해당 종목만 제외하고 계속 진행.
 */
export async function fetchSymbolHistory(symbol: string, startDate: string, endDate: string): Promise<SymbolSeries> {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const file = cachePath(symbol);
  if (existsSync(file)) {
    try {
      const cached = JSON.parse(readFileSync(file, 'utf-8')) as SymbolSeries;
      if (cached.ok) return cached;
    } catch {
      // 캐시 손상 시 재조회
    }
  }
  try {
    const raw = await fetchRaw(symbol, startDate, endDate);
    const series = toSeries(symbol, raw);
    writeFileSync(file, JSON.stringify(series));
    return series;
  } catch (e) {
    const failed: SymbolSeries = { symbol, dates: [], open: [], high: [], low: [], close: [], ok: false, error: String(e) };
    return failed;
  }
}

export async function fetchManySymbols(
  symbols: string[],
  startDate: string,
  endDate: string
): Promise<Map<string, SymbolSeries>> {
  const uniq = Array.from(new Set(symbols));
  const out = new Map<string, SymbolSeries>();
  for (const sym of uniq) {
    const series = await fetchSymbolHistory(sym, startDate, endDate);
    out.set(sym, series);
    console.log(`  ${series.ok ? '✓' : '✗'} ${sym}${series.ok ? ` (${series.dates.length}일, ${series.dates[0]}~${series.dates[series.dates.length - 1]})` : ` — ${series.error}`}`);
  }
  return out;
}
