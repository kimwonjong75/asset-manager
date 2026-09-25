// scripts/backtest/holdingsTurtleCycle/run.ts
// CLI 드라이버 — 보유자산 CSV → 유니버스 로드 → 3변형×3비용×월별시작일 그리드 실행 → 집계 →
// DB/holdingsTurtleCycle/(로컬, 개인정보) + docs/backtest/(집계만, 커밋 가능) 산출.
//
// 사용법: npx tsx scripts/backtest/holdingsTurtleCycle/run.ts "<CSV 경로>" [출력태그]
//   출력태그를 주면 결과 파일명이 results_<태그>.json / 종목별_결과_<태그>.md 로 저장된다(기존 결과 보존,
//   §재검증 과제6 — 데이터 갱신 후 재실행을 results_v1_1.json 처럼 버전 구분해서 남기기 위함).
//   생략하면 기존과 동일하게 results.json / 종목별_결과.md (하위호환).

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadHoldingsCsv, dedupeByTicker, UniqueHolding } from './csvHoldings';
import { resolveSymbol } from './symbolResolve';
import { loadUniverseData, UniverseEntry } from './data';
import { VariantRules, latestChannelStatus, LatestChannelStatus } from './engine';
import { runGrid, GridCell, CostTierName } from './gridRunner';
import {
  summarize, CellStats, groupBy, periodBucketOf, leaveOneOutMaxContributor, LeaveOneOutResult,
} from './aggregate';
import { configHash } from './configHash';
import { parseConfig } from './configTypes';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, '..', '..', '..', 'DB', 'holdingsTurtleCycle');
const DOCS_DIR = path.join(__dirname, '..', '..', '..', 'docs', 'backtest');

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('사용법: npx tsx scripts/backtest/holdingsTurtleCycle/run.ts "<CSV 경로>" [출력태그]');
  process.exit(1);
}
const outTag = process.argv[3] ? `_${process.argv[3]}` : '';
const resultsFileName = `results${outTag}.json`;
const perTickerFileName = `종목별_결과${outTag}.md`;

const { hash, config } = configHash();
const C = parseConfig(config);
console.log('='.repeat(100));
console.log('holdings-turtle-cycle-v1 — 완전한 터틀 사이클 vs B&H (보유 종목)   [EXPLORATORY]');
console.log('='.repeat(100));
console.log(`설정 해시: ${hash}`);

const VARIANTS: VariantRules[] = [
  { id: 'V1', name: C.variants.V1.name, entryLookback: C.variants.V1.entryLookback, exitLookback: C.variants.V1.exitLookback, atrPeriod: C.variants.V1.atrPeriod, stopMultipleN: C.variants.V1.stopMultipleN },
  { id: 'V2', name: C.variants.V2.name, entryLookback: C.variants.V2.entryLookback, exitLookback: C.variants.V2.exitLookback, atrPeriod: C.variants.V2.atrPeriod, stopMultipleN: C.variants.V2.stopMultipleN },
  { id: 'V3', name: C.variants.V3.name, entryLookback: C.variants.V3.entryLookback, exitLookback: C.variants.V3.exitLookback, atrPeriod: C.variants.V3.atrPeriod, stopMultipleN: C.variants.V3.stopMultipleN },
];
const COST_TIERS: { tier: CostTierName; mult: number }[] = [
  { tier: 'zero', mult: C.costTiers.zero },
  { tier: 'base', mult: C.costTiers.base },
  { tier: 'double', mult: C.costTiers.double },
];
const LOOKBACKS = Array.from(new Set(VARIANTS.flatMap(v => [v.entryLookback, v.exitLookback])));
const ATR_PERIOD = VARIANTS[0].atrPeriod;

// ── 1) CSV → 유니버스 ──
const rows = loadHoldingsCsv(csvPath);
const unique: UniqueHolding[] = dedupeByTicker(rows);
console.log(`\n보유 CSV: ${rows.length}행 → 고유 티커 ${unique.length}종`);

const entries: UniverseEntry[] = unique.map(u => {
  const r = resolveSymbol({ ticker: u.ticker, exchange: u.exchange, name: u.name });
  return { ticker: u.ticker, fetchSymbol: r.fetchSymbol, name: u.name, assetClass: u.assetClass, currency: r.currency, isCryptoTicker: r.isCryptoTicker, isKrEtf: r.isKrEtf };
});

const { securities, missing } = loadUniverseData({ entries, atrPeriod: ATR_PERIOD, lookbacks: LOOKBACKS });
console.log(`데이터 확보 ${securities.length}/${entries.length}종`);
if (missing.length) {
  console.log(`\n✗ 데이터 확보 실패 — 제외 목록 + 사유 (${missing.length}종):`);
  for (const m of missing) console.log(`   - ${m.ticker}: ${m.detail}`);
}
const totalExcludedRows = securities.reduce((s, sec) => s + sec.excludedRows.length, 0);
console.log(`비정상 OHLC 행 제거: ${totalExcludedRows}행 (전 종목 합)`);

// ── 2) 그리드 실행 ──
const GRID_START = '2015-01-01';
const GRID_END = new Date().toISOString().slice(0, 10);
console.log(`\n그리드 실행: ${securities.length}종 × 변형 3 × 비용 3단계 × 월별 시작일 (${GRID_START} ~ ${GRID_END})...`);
const t0 = Date.now();
const { cells, skipped } = runGrid(securities, VARIANTS, COST_TIERS, GRID_START, GRID_END);
console.log(`완료: 셀 ${cells.length}개, 소요 ${((Date.now() - t0) / 1000).toFixed(1)}초`);
console.log(`스킵: ${skipped.map(s => `${s.reason}=${s.count}`).join(' · ') || '없음'}`);

// ── 3) 집계 ──
const holdingByTicker = new Map(unique.map(u => [u.ticker, u]));

function pnlBucketOf(returnPct: number | null): '<=-30%' | '-30~0%' | '>=0%' | 'unknown' {
  if (returnPct === null) return 'unknown';
  if (returnPct <= -30) return '<=-30%';
  if (returnPct < 0) return '-30~0%';
  return '>=0%';
}

const cellsByVariantCost: Map<string, GridCell[]> = groupBy(cells, c => `${c.variantId}|${c.costTier}`);
const overallByVariantCost: Record<string, CellStats> = {};
for (const [key, cs] of cellsByVariantCost) overallByVariantCost[key] = summarize(cs);

const BASE_KEY_FOR = (v: string): string => `${v}|base`;

function statsByGroup<K extends string>(cs: GridCell[], keyFn: (c: GridCell) => K): Record<K, CellStats> {
  const g = groupBy(cs, keyFn);
  const out = {} as Record<K, CellStats>;
  for (const [k, v] of g) out[k] = summarize(v);
  return out;
}

const byAssetClass: Record<string, Record<string, CellStats>> = {};
const byPnlBucket: Record<string, Record<string, CellStats>> = {};
const byPeriodBucket: Record<string, Record<string, CellStats>> = {};
const leaveOneOut: Record<string, LeaveOneOutResult | null> = {};

for (const v of VARIANTS) {
  const baseCells = cellsByVariantCost.get(BASE_KEY_FOR(v.id)) ?? [];
  byAssetClass[v.id] = statsByGroup(baseCells, c => c.assetClass);
  byPnlBucket[v.id] = statsByGroup(baseCells, c => pnlBucketOf(holdingByTicker.get(c.ticker)?.currentReturnPct ?? null));
  byPeriodBucket[v.id] = statsByGroup(baseCells, c => periodBucketOf(c.startDate));
  leaveOneOut[v.id] = leaveOneOutMaxContributor(baseCells);
}

// ── 4) 종목별 요약 + 최신 채널 상태 ──
interface PerTickerSummary {
  ticker: string;
  name: string;
  assetClass: string;
  currentReturnPct: number | null;
  dataFirstDate: string;
  dataLastDate: string;
  byVariantBase: Record<string, { n: number; medianCagrBh: number; medianCagrTurtle: number; medianFinalRatioRatio: number; turtleWinRate: number }>;
  latestStatus: Record<string, LatestChannelStatus>;
}

const perTicker: PerTickerSummary[] = [];
for (const sec of securities) {
  const byVariantBase: PerTickerSummary['byVariantBase'] = {};
  const latestStatus: Record<string, LatestChannelStatus> = {};
  for (const v of VARIANTS) {
    const cs = cells.filter(c => c.ticker === sec.ticker && c.variantId === v.id && c.costTier === 'base');
    const st = summarize(cs);
    byVariantBase[v.id] = {
      n: st.n, medianCagrBh: st.medianCagrBh, medianCagrTurtle: st.medianCagrTurtle,
      medianFinalRatioRatio: st.p50FinalRatioRatio, turtleWinRate: st.turtleWinRate,
    };
    latestStatus[v.id] = latestChannelStatus(sec, v);
  }
  const h = holdingByTicker.get(sec.ticker);
  perTicker.push({
    ticker: sec.ticker, name: sec.name, assetClass: sec.assetClass,
    currentReturnPct: h?.currentReturnPct ?? null,
    dataFirstDate: sec.ownDates[0], dataLastDate: sec.ownDates[sec.ownDates.length - 1],
    byVariantBase, latestStatus,
  });
}

// ── 5) 산출물 저장 ──
if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });

writeFileSync(
  path.join(DB_DIR, resultsFileName),
  JSON.stringify({
    generatedAt: new Date().toISOString(), configHash: hash, csvPath,
    universeCount: entries.length, dataOkCount: securities.length, missing,
    totalExcludedRows, gridCellCount: cells.length, skipped,
    overallByVariantCost, byAssetClass, byPnlBucket, byPeriodBucket, leaveOneOut,
    perTicker,
  }, null, 2)
);

const md: string[] = [];
md.push('# 보유 종목별 결과 — 완전한 터틀 사이클 vs B&H (로컬 전용, 개인정보 포함)\n');
md.push(`생성: ${new Date().toISOString()} · 설정 해시 ${hash}\n`);
md.push('형식: `티커 (종목명) [자산구분, 현재수익률%] — B&H 중앙CAGR | V1/V2/V3 중앙CAGR·최종가치비율·터틀승률 || V1 최신상태`\n');
for (const p of perTicker) {
  const line1 = `${p.ticker} (${p.name}) [${p.assetClass}, 현재 ${p.currentReturnPct === null ? 'N/A' : p.currentReturnPct.toFixed(1) + '%'}]`;
  const bh = p.byVariantBase.V1 ? (p.byVariantBase.V1.medianCagrBh * 100).toFixed(1) + '%' : 'N/A';
  const vparts = VARIANTS.map(v => {
    const s = p.byVariantBase[v.id];
    if (!s || s.n === 0) return `${v.id}=데이터부족`;
    return `${v.id}(중앙CAGR ${(s.medianCagrTurtle * 100).toFixed(1)}%·비율${s.medianFinalRatioRatio.toFixed(2)}·승률${(s.turtleWinRate * 100).toFixed(0)}%·n${s.n})`;
  }).join(' · ');
  const st = p.latestStatus.V1;
  const statusStr = st.belowExit === null
    ? 'V1 상태 판정불가(데이터부족)'
    : `V1 최신상태: ${st.belowExit ? '청산선 아래' : '청산선 위'}${st.distanceToEntryPct !== null ? ` · 재진입선까지 ${st.distanceToEntryPct.toFixed(1)}%` : ''}`;
  md.push(`- ${line1} — B&H 중앙CAGR ${bh} | ${vparts} || ${statusStr}`);
}
for (const m of missing) md.push(`- ${m.ticker} — 제외됨: ${m.detail}`);
writeFileSync(path.join(DB_DIR, perTickerFileName), md.join('\n') + '\n');

console.log(`\n로컬 산출물:`);
console.log(`  DB/holdingsTurtleCycle/${resultsFileName}`);
console.log(`  DB/holdingsTurtleCycle/${perTickerFileName}`);

// ── 6) 요약 출력 (콘솔) ──
console.log('\n── 변형별 전체 요약 (모든 종목·모든 시작일, 비용단계별) ──');
for (const v of VARIANTS) {
  for (const ct of COST_TIERS) {
    const s = overallByVariantCost[`${v.id}|${ct.tier}`];
    if (!s) continue;
    console.log(`  ${v.id}(${v.name}) / ${ct.tier.padEnd(6)} : n=${s.n} 중앙CAGR(B&H)=${(s.medianCagrBh * 100).toFixed(2)}% 중앙CAGR(터틀)=${(s.medianCagrTurtle * 100).toFixed(2)}% p50비율=${s.p50FinalRatioRatio.toFixed(3)} 터틀승률=${(s.turtleWinRate * 100).toFixed(1)}%`);
  }
}

console.log('\n── 자산군별 (base 비용) ──');
for (const v of VARIANTS) {
  console.log(`  [${v.id}]`);
  for (const [ac, s] of Object.entries(byAssetClass[v.id])) {
    console.log(`    ${ac.padEnd(10)} n=${s.n} p50비율=${s.p50FinalRatioRatio.toFixed(3)} 터틀승률=${(s.turtleWinRate * 100).toFixed(1)}%`);
  }
}

console.log('\n── 최대 기여 종목 제거 민감도 (base 비용) ──');
for (const v of VARIANTS) {
  const l = leaveOneOut[v.id];
  if (!l) continue;
  console.log(`  [${v.id}] 최대기여=${l.droppedTicker} 제거전 median비율=${l.before.toFixed(3)} 제거후=${l.after.toFixed(3)} 방향불변=${l.directionUnchanged}`);
}

console.log('\n' + '='.repeat(100));
console.log('완료. 자산군별 집계 리포트는 docs/backtest/REPORT_보유종목_터틀사이클_260925.md 를 참고하세요(수동 작성).');
console.log('='.repeat(100));
