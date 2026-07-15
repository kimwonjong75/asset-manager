// scripts/backtest/onboardingPolicy/fetchRepr.ts
// 대표군 19종 중 캐시 미보유분만 기존 연구용 수집 경로(lib/fetchHistory)로 보충한다.
// 동결 명단에 종목을 추가하지 않는다 — 누락분 보충 전용.
// 기간은 기존 캐시(2015-01-01~2026-07-07)와 동일하게 맞춘다(워밍업 비대칭 방지).

import { fetchManySymbols } from '../lib/fetchHistory';
import { REPR_UNIVERSE_19, reprFetchSymbol } from './reprUniverse';

const START = '2015-01-01';
const END = '2026-07-07';

const symbols = REPR_UNIVERSE_19.map(reprFetchSymbol);
console.log(`대표군 19종 수집 (${START} ~ ${END}) — 캐시 보유분은 재다운로드하지 않음\n`);
const res = await fetchManySymbols(symbols, START, END);

console.log('\n── OHLC 정합성·기간 충족 ──');
const failed: string[] = [];
for (const t of REPR_UNIVERSE_19) {
  const sym = reprFetchSymbol(t);
  const s = res.get(sym);
  if (!s || !s.ok || s.dates.length === 0) { failed.push(`${t} (${sym}): ${s?.error ?? 'no-data'}`); continue; }
  // OHLC 정합: low <= open/close <= high 위반 건수
  let viol = 0, bars = 0;
  for (let i = 0; i < s.dates.length; i++) {
    const o = s.open[i], h = s.high[i], l = s.low[i], c = s.close[i];
    if ([o, h, l, c].some(v => typeof v !== 'number' || !Number.isFinite(v))) continue;
    bars++;
    if (!(l! <= o! && o! <= h! && l! <= c! && c! <= h!)) viol++;
  }
  const ok = viol === 0;
  console.log(`  ${ok ? '✓' : '✗'} ${t.padEnd(8)} ${s.dates[0]} ~ ${s.dates[s.dates.length - 1]} | ${s.dates.length}봉 | OHLC완전 ${bars}봉 | 정합위반 ${viol}`);
  if (!ok) failed.push(`${t}: OHLC 정합 위반 ${viol}건`);
}

if (failed.length) {
  console.log(`\n✗ 실패 ${failed.length}종:`);
  for (const f of failed) console.log(`   - ${f}`);
  process.exit(1);
}
console.log(`\n✓ 대표군 19/19 확보 — OHLC 정합 위반 0`);
