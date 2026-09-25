// scripts/backtest/holdingsTurtleCycle/prefetch.ts
// CLI — 보유자산 CSV의 고유 티커를 전부 조회해 캐시(scripts/backtest/data/cache/)에 적재한다.
// 캐시 있으면 재다운로드하지 않음(lib/fetchHistory 관례). 실패/누락은 조용히 넘기지 않고 사유와 함께 기록한다.
//
// 사용법: npx tsx scripts/backtest/holdingsTurtleCycle/prefetch.ts "<CSV 경로>" [end_date(YYYY-MM-DD)]

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadHoldingsCsv, dedupeByTicker } from './csvHoldings';
import { resolveSymbol } from './symbolResolve';
import { fetchManySymbols } from '../lib/fetchHistory';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, '..', '..', '..', 'DB', 'holdingsTurtleCycle');

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('사용법: npx tsx scripts/backtest/holdingsTurtleCycle/prefetch.ts "<CSV 경로>" [end_date]');
  process.exit(1);
}
const endDate = process.argv[3] ?? new Date().toISOString().slice(0, 10);
const START = '2015-01-01';

const rows = loadHoldingsCsv(csvPath);
const unique = dedupeByTicker(rows);
console.log(`보유 CSV: ${rows.length}행 → 고유 티커 ${unique.length}종`);

const resolved = unique.map(u => ({ u, r: resolveSymbol({ ticker: u.ticker, exchange: u.exchange, name: u.name }) }));

console.log(`\n조회 심볼 목록 (${resolved.length}종, 기간 ${START} ~ ${endDate}):`);
for (const { u, r } of resolved) {
  console.log(`  ${u.ticker.padEnd(10)} → ${r.fetchSymbol.padEnd(12)} ${r.currency} ${r.isCryptoTicker ? 'crypto' : ''} ${r.isKrEtf ? 'KR-ETF' : ''}`);
}

const symbols = ['KRW=X', 'JPYKRW=X', ...resolved.map(x => x.r.fetchSymbol)];
console.log(`\n캐시 확인/네트워크 조회 (${symbols.length}개 심볼, 캐시 있으면 재다운로드 안 함):`);
const results = await fetchManySymbols(symbols, START, endDate);

const failures: { ticker: string; fetchSymbol: string; reason: string }[] = [];
const ok: { ticker: string; fetchSymbol: string; dates: number; first: string; last: string }[] = [];
for (const { u, r } of resolved) {
  const s = results.get(r.fetchSymbol);
  if (!s || !s.ok || s.dates.length === 0) {
    failures.push({ ticker: u.ticker, fetchSymbol: r.fetchSymbol, reason: s?.error ?? 'no-data' });
    continue;
  }
  ok.push({ ticker: u.ticker, fetchSymbol: r.fetchSymbol, dates: s.dates.length, first: s.dates[0], last: s.dates[s.dates.length - 1] });
}

console.log(`\n확보 ${ok.length}/${resolved.length}종`);
if (failures.length) {
  console.log(`\n✗ 확보 실패 ${failures.length}종 (제외 목록 + 사유):`);
  for (const f of failures) console.log(`   - ${f.ticker} (심볼=${f.fetchSymbol}): ${f.reason}`);
}

if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
writeFileSync(
  path.join(DB_DIR, 'prefetch_report.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), csvPath, start: START, end: endDate, ok, failures }, null, 2)
);
console.log(`\n로컬 기록: DB/holdingsTurtleCycle/prefetch_report.json`);
