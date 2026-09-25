// scripts/backtest/holdingsTurtleCycle/evaluationDesigns.ts
// CLI — §재검증 과제4: "데이터 끝까지"가 아닌 두 가지 대안 평가설계를 실물자산 8종목 + 전체 83종목에 적용.
//   (a) 고정기간 롤링 창(1년·3년) — rollingWindow.ts
//   (b) 하락 에피소드 분해(피한 하락 vs 놓친 반등) — episodeAnalysis.ts
// V1·V3 모두, 비용은 기본단계, 현금이자 0%/2.5% 두 가지. 자산군 집계는 커밋 가능(docs), 종목별 상세는
// 로컬 전용(DB) — 기존 종목별_결과.md 관례와 동일(보유 종목 식별 자체가 개인정보).
//
// 사용법: npx tsx scripts/backtest/holdingsTurtleCycle/evaluationDesigns.ts "<CSV 경로>"

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadHoldingsCsv, dedupeByTicker } from './csvHoldings';
import { resolveSymbol } from './symbolResolve';
import { loadUniverseData, UniverseEntry, SecurityData } from './data';
import { VariantRules } from './engine';
import { runRollingWindow, RollingCell } from './rollingWindow';
import { decomposeEpisodes, EpisodeDecomposition } from './episodeAnalysis';
import { median, percentile, fractionTrue, groupBy } from './aggregate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, '..', '..', '..', 'DB', 'holdingsTurtleCycle');
const REAL_ASSET_CLASS = '실물자산';

const V1: VariantRules = { id: 'V1', name: '표준(20/55)', entryLookback: 55, exitLookback: 20, atrPeriod: 20, stopMultipleN: 2 };
const V3: VariantRules = { id: 'V3', name: '느린판(55/55)', entryLookback: 55, exitLookback: 55, atrPeriod: 20, stopMultipleN: 2 };
const VARIANTS = [V1, V3];
const CASH_RATES = [0, 2.5];
const HORIZONS = [1, 3];
const GRID_START = '2015-01-01';
const GRID_END = new Date().toISOString().slice(0, 10);

function main(): void {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('사용법: npx tsx scripts/backtest/holdingsTurtleCycle/evaluationDesigns.ts "<CSV 경로>"');
    process.exit(1);
  }
  const rows = loadHoldingsCsv(csvPath);
  const unique = dedupeByTicker(rows);
  const entries: UniverseEntry[] = unique.map(u => {
    const r = resolveSymbol({ ticker: u.ticker, exchange: u.exchange, name: u.name });
    return { ticker: u.ticker, fetchSymbol: r.fetchSymbol, name: u.name, assetClass: u.assetClass, currency: r.currency, isCryptoTicker: r.isCryptoTicker, isKrEtf: r.isKrEtf };
  });
  const { securities, missing } = loadUniverseData({ entries, atrPeriod: 20, lookbacks: [10, 20, 55] });
  console.log(`유니버스 ${securities.length}/${entries.length}종 로드 (실패 ${missing.length}종)`);

  // ── (a) 고정기간 롤링 창 ──
  console.log('\n[a] 고정기간 롤링 창(1년/3년) 실행 중...');
  const t0 = Date.now();
  const rollingCells: RollingCell[] = runRollingWindow(
    securities, VARIANTS, [{ tier: 'base', mult: 1 }], HORIZONS, CASH_RATES, GRID_START, GRID_END, true
  );
  console.log(`  완료: ${rollingCells.length}셀, ${((Date.now() - t0) / 1000).toFixed(1)}초`);

  interface RollingSummary { n: number; medianFinalRatioRatio: number; p10: number; p90: number; turtleWinRate: number; medianMddBh: number; medianMddTurtle: number }
  function summarizeRolling(cs: RollingCell[]): RollingSummary {
    return {
      n: cs.length,
      medianFinalRatioRatio: median(cs.map(c => c.finalRatioRatio)),
      p10: percentile(cs.map(c => c.finalRatioRatio), 0.1),
      p90: percentile(cs.map(c => c.finalRatioRatio), 0.9),
      turtleWinRate: fractionTrue(cs.map(c => c.turtleBeatsBh)),
      medianMddBh: median(cs.map(c => c.bhMdd)),
      medianMddTurtle: median(cs.map(c => c.turtleMdd)),
    };
  }

  const rollingKey = (c: RollingCell): string => `${c.variantId}|h${c.horizonYears}|cash${c.cashAnnualRatePct}`;
  const rollingByKeyAll = groupBy(rollingCells, rollingKey);
  const rollingOverall: Record<string, RollingSummary> = {};
  for (const [k, cs] of rollingByKeyAll) rollingOverall[k] = summarizeRolling(cs);

  const realAssetCells = rollingCells.filter(c => c.assetClass === REAL_ASSET_CLASS);
  const rollingByKeyRA = groupBy(realAssetCells, rollingKey);
  const rollingRealAsset: Record<string, RollingSummary> = {};
  for (const [k, cs] of rollingByKeyRA) rollingRealAsset[k] = summarizeRolling(cs);

  console.log('\n  전체 83종 — 변형×기간×현금이자별 중앙 최종가치비율/터틀승률:');
  for (const [k, s] of Object.entries(rollingOverall).sort()) {
    console.log(`    ${k.padEnd(20)} n=${s.n.toString().padStart(5)} median=${s.medianFinalRatioRatio.toFixed(3)} 승률=${(s.turtleWinRate * 100).toFixed(1)}% MDD(B&H→터틀)=${(s.medianMddBh * 100).toFixed(1)}%→${(s.medianMddTurtle * 100).toFixed(1)}%`);
  }
  console.log('\n  실물자산 8종 — 변형×기간×현금이자별:');
  for (const [k, s] of Object.entries(rollingRealAsset).sort()) {
    console.log(`    ${k.padEnd(20)} n=${s.n.toString().padStart(4)} median=${s.medianFinalRatioRatio.toFixed(3)} 승률=${(s.turtleWinRate * 100).toFixed(1)}% MDD(B&H→터틀)=${(s.medianMddBh * 100).toFixed(1)}%→${(s.medianMddTurtle * 100).toFixed(1)}%`);
  }

  // ── (b) 하락 에피소드 분해 ──
  console.log('\n[b] 하락 에피소드 분해(−20%+) 실행 중...');
  interface EpisodeRow extends EpisodeDecomposition { ticker: string; assetClass: string; variantId: string; cashAnnualRatePct: number }
  const episodeRows: EpisodeRow[] = [];
  function firstValidIdxForRules(sec: SecurityData, rules: VariantRules): number {
    const hiArr = sec.highChannel[rules.entryLookback];
    const loArr = sec.lowChannel[rules.exitLookback];
    for (let i = 0; i < sec.ownDates.length; i++) {
      if (sec.atr[i] !== null && hiArr?.[i] != null && loArr?.[i] != null) return i;
    }
    return -1;
  }
  for (const sec of securities) {
    for (const variant of VARIANTS) {
      const warmupIdx = firstValidIdxForRules(sec, variant);
      if (warmupIdx < 0) continue;
      for (const cashRate of CASH_RATES) {
        const { episodes } = decomposeEpisodes(sec, variant, 1, warmupIdx, { cashAnnualRatePct: cashRate, thresholdPct: 20 });
        for (const e of episodes) episodeRows.push({ ...e, ticker: sec.ticker, assetClass: sec.assetClass, variantId: variant.id, cashAnnualRatePct: cashRate });
      }
    }
  }
  console.log(`  완료: 에피소드 ${episodeRows.length}건(전 종목·변형·현금이자 합)`);

  interface EpisodeSummary { episodeCount: number; medianDrawdownPct: number; medianAvoidedDeclinePct: number; medianMissedReboundPct: number; unresolvedCount: number }
  function summarizeEpisodes(rows: EpisodeRow[]): EpisodeSummary {
    return {
      episodeCount: rows.length,
      medianDrawdownPct: median(rows.map(r => r.drawdownPct)),
      medianAvoidedDeclinePct: median(rows.map(r => r.avoidedDeclinePct)),
      medianMissedReboundPct: median(rows.map(r => r.missedReboundPct)),
      unresolvedCount: rows.filter(r => r.recoveredIdx === null).length,
    };
  }
  const episodeKey = (r: EpisodeRow): string => `${r.variantId}|cash${r.cashAnnualRatePct}`;
  const epByKeyAll = groupBy(episodeRows, episodeKey);
  const episodeOverall: Record<string, EpisodeSummary> = {};
  for (const [k, rs] of epByKeyAll) episodeOverall[k] = summarizeEpisodes(rs);

  const epRealAsset = episodeRows.filter(r => r.assetClass === REAL_ASSET_CLASS);
  const epByKeyRA = groupBy(epRealAsset, episodeKey);
  const episodeRealAsset: Record<string, EpisodeSummary> = {};
  for (const [k, rs] of epByKeyRA) episodeRealAsset[k] = summarizeEpisodes(rs);

  console.log('\n  전체 83종 에피소드 요약 (변형×현금이자):');
  for (const [k, s] of Object.entries(episodeOverall).sort()) {
    console.log(`    ${k.padEnd(15)} 건수=${s.episodeCount} 중앙하락폭=${s.medianDrawdownPct.toFixed(1)}% 중앙피한하락=${s.medianAvoidedDeclinePct.toFixed(1)}%p 중앙놓친반등=${s.medianMissedReboundPct.toFixed(1)}%p 미회복=${s.unresolvedCount}`);
  }
  console.log('\n  실물자산 8종 에피소드 요약 (변형×현금이자):');
  for (const [k, s] of Object.entries(episodeRealAsset).sort()) {
    console.log(`    ${k.padEnd(15)} 건수=${s.episodeCount} 중앙하락폭=${s.medianDrawdownPct.toFixed(1)}% 중앙피한하락=${s.medianAvoidedDeclinePct.toFixed(1)}%p 중앙놓친반등=${s.medianMissedReboundPct.toFixed(1)}%p 미회복=${s.unresolvedCount}`);
  }

  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(
    path.join(DB_DIR, 'evaluationDesigns.json'),
    JSON.stringify({
      generatedAt: new Date().toISOString(), csvPath,
      rollingOverall, rollingRealAsset,
      episodeOverall, episodeRealAsset,
      // 종목별 상세(개인정보) — 로컬 전용.
      rollingCellsPerTickerSample: rollingCells.length,
      episodeRowsDetail: episodeRows,
    }, null, 2)
  );
  console.log('\n로컬 기록: DB/holdingsTurtleCycle/evaluationDesigns.json (종목별 상세 포함 — 로컬 전용)');
}

main();
