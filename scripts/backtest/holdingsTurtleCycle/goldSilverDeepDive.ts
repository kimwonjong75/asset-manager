// scripts/backtest/holdingsTurtleCycle/goldSilverDeepDive.ts
// CLI — §재검증 과제3(거래 일지)·과제4(SLV·GLD 개별 에피소드 분해). 결과를 콘솔 + JSON으로 남긴다.
// SLV·GLD는 시장 상품 티커라 보고서에 이름을 실을 수 있다(개인정보 아님) — 사용자 실제 매수일·금액은
// 별도로 DB(로컬)에만 남기고(personalPurchaseAnalysis.ts), 여기서는 "그 날짜"만 참고용으로 쓴다.
//
// 사용법: npx tsx scripts/backtest/holdingsTurtleCycle/goldSilverDeepDive.ts

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readCache, buildSecurity, SecurityData } from './data';
import { simulateCell, isSkip, VariantRules, CellResult } from './engine';
import { decomposeEpisodes, EpisodeDecomposition } from './episodeAnalysis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, '..', '..', '..', 'DB', 'holdingsTurtleCycle');

const V1: VariantRules = { id: 'V1', name: '표준(20/55)', entryLookback: 55, exitLookback: 20, atrPeriod: 20, stopMultipleN: 2 };
const V3: VariantRules = { id: 'V3', name: '느린판(55/55)', entryLookback: 55, exitLookback: 55, atrPeriod: 20, stopMultipleN: 2 };
const COST_MULT = 1; // 기본 비용단계
const CASH_RATES = [0, 2.5];
// 실제 매수일(2025-10-01)은 personalPurchaseAnalysis.ts 산출과 동일 값 — 여기서는 SLV·GLD 심층분석용으로 고정 인용.
const START_CANDIDATES = ['2015-01', '2020-01', '2024-01', '2025-06'];
const REAL_PURCHASE_DATE = '2025-10-01';

function loadSecurity(ticker: string, assetClass: string): SecurityData {
  const raw = readCache(ticker);
  if (!raw) throw new Error(`캐시 없음: ${ticker}`);
  return buildSecurity({
    ticker, name: ticker, assetClass, currency: 'USD', isCryptoTicker: false, isKrEtf: false,
    raw, atrPeriod: 20, lookbacks: [20, 55],
  });
}

function firstValidIdxForRules(sec: SecurityData, rules: VariantRules): number {
  const hiArr = sec.highChannel[rules.entryLookback];
  const loArr = sec.lowChannel[rules.exitLookback];
  for (let i = 0; i < sec.ownDates.length; i++) {
    if (sec.atr[i] !== null && hiArr?.[i] != null && loArr?.[i] != null) return i;
  }
  return -1;
}

function resolveStartIdx(sec: SecurityData, yyyymmOrDate: string): { idx: number; date: string; note: string } | null {
  // "YYYY-MM" 형식이면 그 달의 첫 거래일, "YYYY-MM-DD"면 그 날짜 이후 첫 거래일.
  const isFullDate = yyyymmOrDate.length === 10;
  for (let i = 0; i < sec.ownDates.length; i++) {
    const d = sec.ownDates[i];
    if (isFullDate ? d >= yyyymmOrDate : d.startsWith(yyyymmOrDate)) {
      return { idx: i, date: d, note: isFullDate && d !== yyyymmOrDate ? `요청일(${yyyymmOrDate}) 비거래일 → 다음 거래일로 대체` : '' };
    }
  }
  return null;
}

interface JournalRow {
  ticker: string; startLabel: string; startDate: string; cashRatePct: number;
  bhFinalRatio: number; turtleFinalRatio: number; finalRatioRatio: number; turtleBeatsBh: boolean;
  bhMdd: number; turtleMdd: number; roundTrips: number; whipsaws: number; fills: CellResult['fills'];
  phase: { peakDate: string; toPeak: { bh: number; turtle: number }; fromPeak: { bh: number; turtle: number } } | null;
}

function phaseSplit(sec: SecurityData, r: CellResult, peakDate: string): JournalRow['phase'] {
  if (!r.series) return null;
  const { dates, bh, turtle } = r.series;
  const peakIdx = dates.indexOf(peakDate);
  if (peakIdx < 0) return null;
  const toPeakBh = bh[peakIdx] / bh[0];
  const toPeakTurtle = turtle[peakIdx] / turtle[0];
  const fromPeakBh = bh[bh.length - 1] / bh[peakIdx];
  const fromPeakTurtle = turtle[turtle.length - 1] / turtle[peakIdx];
  return { peakDate, toPeak: { bh: toPeakBh, turtle: toPeakTurtle }, fromPeak: { bh: fromPeakBh, turtle: fromPeakTurtle } };
}

function main(): void {
  const output: { tickers: Record<string, { journal: JournalRow[]; episodesV1: Record<number, EpisodeDecomposition[]>; episodesV3: Record<number, EpisodeDecomposition[]>; peakDate: string; peakPrice: number }> } = { tickers: {} };

  for (const ticker of ['SLV', 'GLD']) {
    const sec = loadSecurity(ticker, '실물자산');
    // 전체 이력에서 고점(2026년 랠리 고점) 자동 탐지 — 하드코딩 금지.
    let peakIdx = 0, peakPrice = -Infinity;
    for (let i = 0; i < sec.ownClose.length; i++) {
      const c = sec.ownClose[i];
      if (c !== null && c > peakPrice) { peakPrice = c; peakIdx = i; }
    }
    const peakDate = sec.ownDates[peakIdx];
    console.log(`\n${'='.repeat(90)}\n${ticker} — 전체 이력 고점: ${peakDate} @ ${peakPrice.toFixed(2)} (현재까지 최고 종가)`);

    const journal: JournalRow[] = [];
    const warmupIdx = firstValidIdxForRules(sec, V1);
    const startsToRun = [...START_CANDIDATES, REAL_PURCHASE_DATE];
    for (const label of startsToRun) {
      let resolved = resolveStartIdx(sec, label);
      if (resolved && resolved.idx < warmupIdx) {
        // 워밍업 미충족(주로 2015-01) — 가장 이른 유효 시작일로 대체하고 명시.
        const noteExtra = `요청 시작(${label})이 워밍업(ATR20+채널55) 미충족 → 최초 유효 시작일(${sec.ownDates[warmupIdx]})로 대체`;
        resolved = { idx: warmupIdx, date: sec.ownDates[warmupIdx], note: noteExtra };
      }
      if (!resolved) { console.log(`  ${label}: 데이터 범위 밖 — 스킵`); continue; }
      if (resolved.note) console.log(`  [참고] ${ticker} ${label}: ${resolved.note}`);

      for (const cashRate of CASH_RATES) {
        const r = simulateCell(sec, resolved.idx, V1, COST_MULT, { cashAnnualRatePct: cashRate, includeSeries: true });
        if (isSkip(r)) { console.log(`  ${label} cash=${cashRate}%: 스킵(워밍업)`); continue; }
        const phase = phaseSplit(sec, r, peakDate);
        journal.push({
          ticker, startLabel: label, startDate: resolved.date, cashRatePct: cashRate,
          bhFinalRatio: r.bhFinalRatio, turtleFinalRatio: r.turtleFinalRatio, finalRatioRatio: r.finalRatioRatio,
          turtleBeatsBh: r.turtleBeatsBh, bhMdd: r.bhMdd, turtleMdd: r.turtleMdd,
          roundTrips: r.roundTrips, whipsaws: r.whipsaws, fills: r.fills, phase,
        });
        console.log(
          `  시작=${resolved.date} 현금이자=${cashRate}% → B&H=${r.bhFinalRatio.toFixed(3)} 터틀=${r.turtleFinalRatio.toFixed(3)} ` +
          `(비율=${r.finalRatioRatio.toFixed(3)}, ${r.turtleBeatsBh ? '터틀승' : 'B&H승'}) MDD B&H=${(r.bhMdd * 100).toFixed(1)}% 터틀=${(r.turtleMdd * 100).toFixed(1)}% ` +
          `왕복=${r.roundTrips} 휩쏘=${r.whipsaws}`
        );
        if (phase) {
          console.log(
            `    [고점 분해] 시작→고점(${peakDate}): B&H×${phase.toPeak.bh.toFixed(3)} 터틀×${phase.toPeak.turtle.toFixed(3)} | ` +
            `고점→현재: B&H×${phase.fromPeak.bh.toFixed(3)} 터틀×${phase.fromPeak.turtle.toFixed(3)}`
          );
        }
      }
    }

    // 에피소드 분해(V1·V3, 현금이자 0%/2.5%) — 워밍업 이후 전체 이력 1회 실행.
    const episodesV1: Record<number, EpisodeDecomposition[]> = {};
    const episodesV3: Record<number, EpisodeDecomposition[]> = {};
    for (const cashRate of CASH_RATES) {
      const dV1 = decomposeEpisodes(sec, V1, COST_MULT, warmupIdx, { cashAnnualRatePct: cashRate, thresholdPct: 20 });
      const dV3 = decomposeEpisodes(sec, V3, COST_MULT, warmupIdx, { cashAnnualRatePct: cashRate, thresholdPct: 20 });
      episodesV1[cashRate] = dV1.episodes;
      episodesV3[cashRate] = dV3.episodes;
      console.log(`\n  [에피소드 분해 V1, 현금${cashRate}%] ${dV1.episodes.length}건`);
      for (const e of dV1.episodes) {
        console.log(
          `    고점 ${e.peakDate}(${e.peakPrice.toFixed(2)}) → 저점 ${e.troughDate}(${e.troughPrice.toFixed(2)}, -${e.drawdownPct.toFixed(1)}%) → ` +
          `${e.recoveredDate ? `회복 ${e.recoveredDate}` : '미회복(데이터 끝)'} | 피한하락=${e.avoidedDeclinePct.toFixed(1)}%p 놓친반등=${e.missedReboundPct.toFixed(1)}%p`
        );
      }
    }

    output.tickers[ticker] = { journal, episodesV1, episodesV3, peakDate, peakPrice };
  }

  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
  writeFileSync(path.join(DB_DIR, 'goldSilverDeepDive.json'), JSON.stringify(output, null, 2));
  console.log(`\n로컬 기록: DB/holdingsTurtleCycle/goldSilverDeepDive.json (SLV·GLD는 시장상품 — 이 JSON은 개인정보 없음, 참고용으로 로컬 보관)`);
}

main();
