// scripts/backtest/holdingsTurtleCycle/refreshStale.ts
// CLI — 캐시가 정체된(오래된) 종목만 골라 강제로 재조회한다(fetchSymbolHistory force=true).
// 배경: results.json perTicker[].dataLastDate 감사 결과 83종목 중 30종목이 2026-07-06~07-10에서
//   멈춰 있었다(직전 워커가 기존 캐시를 재사용만 하고 갱신하지 않음). 이미 최신인 종목까지
//   전부 재조회하면 불필요한 네트워크 호출이라, "가장 최신인 종목 대비 STALE_TOLERANCE_DAYS 이상
//   뒤처진" 종목만 강제 갱신 대상으로 삼는다(하드코딩 날짜 목록 금지 — 데이터 기반 판정).
//
// 사용법: npx tsx scripts/backtest/holdingsTurtleCycle/refreshStale.ts "<CSV 경로>" [end_date]

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadHoldingsCsv, dedupeByTicker } from './csvHoldings';
import { resolveSymbol } from './symbolResolve';
import { fetchSymbolHistory } from '../lib/fetchHistory';
import type { SymbolSeries } from '../lib/fetchHistory';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, '..', '..', '..', 'DB', 'holdingsTurtleCycle');
const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');

const STALE_TOLERANCE_DAYS = 21;
const START = '2015-01-01';

function cacheFile(symbol: string): string {
  const safe = symbol.replace(/[^A-Za-z0-9_.=^-]/g, '_');
  return path.join(CACHE_DIR, `${safe}.json`);
}

function readCachedLastDate(symbol: string): string | null {
  const f = cacheFile(symbol);
  if (!existsSync(f)) return null;
  try {
    const s = JSON.parse(readFileSync(f, 'utf-8')) as SymbolSeries;
    if (!s.ok || s.dates.length === 0) return null;
    return s.dates[s.dates.length - 1];
  } catch {
    return null;
  }
}

function daysBetween(aISO: string, bISO: string): number {
  const a = Date.parse(`${aISO}T00:00:00Z`), b = Date.parse(`${bISO}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

async function main(): Promise<void> {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('사용법: npx tsx scripts/backtest/holdingsTurtleCycle/refreshStale.ts "<CSV 경로>" [end_date]');
    process.exit(1);
  }
  const endDate = process.argv[3] ?? new Date().toISOString().slice(0, 10);

  const rows = loadHoldingsCsv(csvPath);
  const unique = dedupeByTicker(rows);
  const resolved = unique.map(u => ({ u, r: resolveSymbol({ ticker: u.ticker, exchange: u.exchange, name: u.name }) }));

  // 1) 현재 캐시 상태 감사 — 종목별 마지막 날짜.
  const before: { ticker: string; fetchSymbol: string; lastDateBefore: string | null }[] = resolved.map(({ u, r }) => ({
    ticker: u.ticker, fetchSymbol: r.fetchSymbol, lastDateBefore: readCachedLastDate(r.fetchSymbol),
  }));
  const maxLastDate = before.reduce<string | null>((m, b) => {
    if (!b.lastDateBefore) return m;
    return !m || b.lastDateBefore > m ? b.lastDateBefore : m;
  }, null);
  if (!maxLastDate) {
    console.error('캐시가 전무합니다 — 먼저 npm run prefetch:holdingscycle 로 초기 적재하세요.');
    process.exit(1);
  }
  console.log(`캐시 전체 중 가장 최신 날짜(기준선): ${maxLastDate}`);

  const staleTargets = before.filter(
    b => !b.lastDateBefore || daysBetween(b.lastDateBefore, maxLastDate) > STALE_TOLERANCE_DAYS
  );
  console.log(`정체 판정(기준선 대비 ${STALE_TOLERANCE_DAYS}일 이상 뒤처짐 또는 캐시 없음): ${staleTargets.length}/${resolved.length}종`);
  for (const t of staleTargets) console.log(`  - ${t.ticker.padEnd(10)} (심볼=${t.fetchSymbol}) 이전 마지막일=${t.lastDateBefore ?? '(캐시 없음)'}`);

  // 2) 강제 재조회 (force=true — 캐시 무시, 결과로 캐시 파일 덮어씀).
  const after: { ticker: string; fetchSymbol: string; lastDateBefore: string | null; lastDateAfter: string | null; ok: boolean; error?: string }[] = [];
  for (const t of staleTargets) {
    const s = await fetchSymbolHistory(t.fetchSymbol, START, endDate, true);
    const lastDateAfter = s.ok && s.dates.length > 0 ? s.dates[s.dates.length - 1] : null;
    after.push({ ticker: t.ticker, fetchSymbol: t.fetchSymbol, lastDateBefore: t.lastDateBefore, lastDateAfter, ok: s.ok, error: s.error });
    console.log(`  ${s.ok ? '✓' : '✗'} ${t.ticker.padEnd(10)} ${t.lastDateBefore ?? '(없음)'} → ${lastDateAfter ?? '(실패)'}${s.error ? ` (${s.error})` : ''}`);
  }

  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(
    path.join(DB_DIR, 'refresh_report.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), staleToleranceDays: STALE_TOLERANCE_DAYS, maxLastDateBefore: maxLastDate, endDate, results: after }, null, 2)
  );
  console.log(`\n로컬 기록: DB/holdingsTurtleCycle/refresh_report.json`);
  const stillFailed = after.filter(a => !a.ok);
  if (stillFailed.length) {
    console.log(`\n갱신 실패 ${stillFailed.length}종 — 사유와 함께 기록됨(조용한 누락 금지).`);
  }
}

main();
