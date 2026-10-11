// scripts/backtest/holdingsTurtleCycle/run2ExitCompare.ts
// 2차 백테스트(§⑤ docs/터틀_청산기준_최신조사_260925.md) — 청산 방식 비교(W1~W4 + W3 감도 2x/4x).
// 재진입은 전부 55일 도치안 돌파로 통일, 사이징(종목별 독립 자본곡선)·비용모델·체결규약은 1차와 완전히 동일
// (scripts/backtest/holdingsTurtleCycle/의 기존 엔진을 그대로 재사용 — 새 시뮬레이션 로직 없음).
//
// 원본 CSV는 DB/(gitignore)라 이 실행에서는 새로 요구하지 않는다 — 1차 결과
// (DB/holdingsTurtleCycle/results.json.perTicker: ticker/name/assetClass)와 이미 캐시된 시세
// (scripts/backtest/data/cache/)를 그대로 재사용해 동일 유니버스를 재구성한다("데이터를 지어내지 않는다"
// 원칙 — 실제 1차 실행이 확보한 종목만 쓴다).
//
// 사용법: npx tsx scripts/backtest/holdingsTurtleCycle/run2ExitCompare.ts [출력태그]

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveSymbol } from './symbolResolve';
import { loadUniverseData, UniverseEntry } from './data';
import { VariantRules } from './engine';
import { runGrid, GridCell, CostTierName } from './gridRunner';
import { runRollingWindow, RollingCell } from './rollingWindow';
import { summarize, CellStats, groupBy, leaveOneOutMaxContributor, LeaveOneOutResult } from './aggregate';
import { configHash } from './configHash';
import { parseConfig, VariantConfig } from './configTypes';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, '..', '..', '..', 'DB', 'holdingsTurtleCycle');
const DOCS_DIR = path.join(__dirname, '..', '..', '..', 'docs', 'backtest');

const outTag = process.argv[2] ? `_${process.argv[2]}` : '';

interface Round1PerTicker { ticker: string; name: string; assetClass: string; currentReturnPct: number | null }
interface Round1Results { perTicker: Round1PerTicker[] }

const round1Path = path.join(DB_DIR, 'results.json');
if (!existsSync(round1Path)) {
  console.error(`1차 결과 파일이 없음: ${round1Path} — 원본 보유 CSV로 run.ts를 먼저 실행해야 함.`);
  process.exit(1);
}
const round1 = JSON.parse(readFileSync(round1Path, 'utf-8')) as Round1Results;
console.log(`1차 결과(${round1Path})에서 유니버스 재구성: ${round1.perTicker.length}종`);

const { hash, config } = configHash();
const C = parseConfig(config);
console.log('='.repeat(100));
console.log('holdings-turtle-cycle-v1 — 2차 백테스트: 청산 방식 비교 (W1~W4 + W3 감도)   [EXPLORATORY]');
console.log('='.repeat(100));
console.log(`설정 해시: ${hash}`);

function toRules(id: string, v: VariantConfig): VariantRules {
  return {
    id, name: v.name, entryLookback: v.entryLookback, exitLookback: v.exitLookback,
    atrPeriod: v.atrPeriod, stopMultipleN: v.stopMultipleN,
    exitType: v.exitType, atrTrailMultiple: v.atrTrailMultiple, smaPeriod: v.smaPeriod,
  };
}

const VARIANT_IDS = ['W1', 'W2', 'W3', 'W3_2x', 'W3_4x', 'W4'] as const;
const VARIANTS: VariantRules[] = VARIANT_IDS.map(id => toRules(id, C.variants[id]));
const COST_TIERS: { tier: CostTierName; mult: number }[] = [
  { tier: 'zero', mult: C.costTiers.zero },
  { tier: 'base', mult: C.costTiers.base },
  { tier: 'double', mult: C.costTiers.double },
];
const LOOKBACKS = Array.from(new Set(VARIANTS.flatMap(v => [v.entryLookback, v.exitLookback])));
const SMA_PERIODS = Array.from(new Set(VARIANTS.map(v => v.smaPeriod).filter((x): x is number => x !== undefined)));
const ATR_PERIOD = VARIANTS[0].atrPeriod;

// ── 1) 유니버스 로드(1차와 동일 티커, 캐시 재사용) ──
const entries: UniverseEntry[] = round1.perTicker.map(p => {
  // symbolResolve는 exchange 문자열이 필요하지만 1차 결과에는 없음 — assetClass/ticker 형태로 역추정한다.
  // (자산군 라벨과 티커 형태로 충분히 복원 가능: 6자리 숫자→KRX, 그 외는 티커 자체를 그대로 fetchSymbol로 사용)
  const isKr6 = /^\d{4,6}[A-Z0-9]?$/.test(p.ticker) && p.assetClass.includes('한국');
  const exchange = isKr6 ? 'KRX (코스피/코스닥)'
    : p.assetClass === '암호화폐' ? '주요 거래소 (종합)'
    : p.ticker.endsWith('.T') ? 'TSE (도쿄)'
    : 'NYSE';
  const r = resolveSymbol({ ticker: p.ticker, exchange, name: p.name });
  return {
    ticker: p.ticker, fetchSymbol: r.fetchSymbol, name: p.name, assetClass: p.assetClass,
    currency: r.currency, isCryptoTicker: r.isCryptoTicker, isKrEtf: r.isKrEtf,
  };
});

const { securities, missing } = loadUniverseData({
  entries, atrPeriod: ATR_PERIOD, lookbacks: LOOKBACKS, smaPeriods: SMA_PERIODS,
});
console.log(`데이터 확보 ${securities.length}/${entries.length}종 (캐시 재사용, 신규 조회 없음)`);
if (missing.length) {
  console.log(`\n✗ 데이터 확보 실패 — 제외 목록 + 사유 (${missing.length}종):`);
  for (const m of missing) console.log(`   - ${m.ticker}: ${m.detail}`);
}

// ── 2) 그리드 실행 ──
const GRID_START = '2015-01-01';
const GRID_END = new Date().toISOString().slice(0, 10);
console.log(`\n그리드 실행: ${securities.length}종 × 변형 ${VARIANTS.length} × 비용 3단계 × 월별 시작일 (${GRID_START} ~ ${GRID_END})...`);
const t0 = Date.now();
const { cells, skipped } = runGrid(securities, VARIANTS, COST_TIERS, GRID_START, GRID_END);
console.log(`완료: 셀 ${cells.length}개, 소요 ${((Date.now() - t0) / 1000).toFixed(1)}초`);
console.log(`스킵: ${skipped.map(s => `${s.reason}=${s.count}`).join(' · ') || '없음'}`);

// ── 3) 재현성 확인: W1≡V1, W2≡V3 (같은 규칙, 같은 데이터·그리드로 재계산해 완전 일치해야 함) ──
const V1 = toRules('V1', C.variants.V1);
const V3 = toRules('V3', C.variants.V3);
const { cells: repro } = runGrid(securities, [V1, V3], COST_TIERS, GRID_START, GRID_END);
function reproCheck(wId: string, vId: string): { match: boolean; n: number; maxDiff: number } {
  const wCells = cells.filter(c => c.variantId === wId);
  const vCells = repro.filter(c => c.variantId === vId);
  const key = (c: GridCell): string => `${c.ticker}|${c.startDate}|${c.costTier}`;
  const vMap = new Map(vCells.map(c => [key(c), c]));
  let maxDiff = 0, n = 0;
  for (const w of wCells) {
    const v = vMap.get(key(w));
    if (!v) continue;
    n++;
    maxDiff = Math.max(maxDiff, Math.abs(w.turtleFinalRatio - v.turtleFinalRatio));
  }
  return { match: maxDiff < 1e-9 && n === wCells.length && n === vCells.length, n, maxDiff };
}
const reproW1 = reproCheck('W1', 'V1');
const reproW2 = reproCheck('W2', 'V3');
console.log(`\n── 재현성 확인 ──`);
console.log(`  W1≡V1: n=${reproW1.n} maxDiff=${reproW1.maxDiff} 일치=${reproW1.match}`);
console.log(`  W2≡V3: n=${reproW2.n} maxDiff=${reproW2.maxDiff} 일치=${reproW2.match}`);

// ── 4) 집계(자산군별 포함) — base 비용 기준 ──
const cellsByVariantCost: Map<string, GridCell[]> = groupBy(cells, c => `${c.variantId}|${c.costTier}`);
const overallByVariantCost: Record<string, CellStats> = {};
for (const [key, cs] of cellsByVariantCost) overallByVariantCost[key] = summarize(cs);

function statsByGroup<K extends string>(cs: GridCell[], keyFn: (c: GridCell) => K): Record<K, CellStats> {
  const g = groupBy(cs, keyFn);
  const out = {} as Record<K, CellStats>;
  for (const [k, v] of g) out[k] = summarize(v);
  return out;
}

const byAssetClass: Record<string, Record<string, CellStats>> = {};
const leaveOneOut: Record<string, LeaveOneOutResult | null> = {};
for (const v of VARIANT_IDS) {
  const baseCells = cellsByVariantCost.get(`${v}|base`) ?? [];
  byAssetClass[v] = statsByGroup(baseCells, c => c.assetClass);
  leaveOneOut[v] = leaveOneOutMaxContributor(baseCells);
}

// 왕복거래·휩쏘 비교 (W1·W2 대비, base 비용, 셀당 median)
console.log('\n── 변형별 요약 (base 비용) ──');
for (const v of VARIANT_IDS) {
  const s = overallByVariantCost[`${v}|base`];
  if (!s) continue;
  console.log(`  ${v.padEnd(6)} n=${s.n} 중앙CAGR(B&H)=${(s.medianCagrBh * 100).toFixed(2)}% 중앙CAGR(터틀)=${(s.medianCagrTurtle * 100).toFixed(2)}% p50비율=${s.p50FinalRatioRatio.toFixed(3)} 터틀승률=${(s.turtleWinRate * 100).toFixed(1)}% 중앙왕복=${s.medianRoundTrips} 중앙휩쏘=${s.medianWhipsaws} 중앙MDD(터틀)=${(s.medianMddTurtle * 100).toFixed(1)}% give-back중앙=${(s.medianGiveback * 100).toFixed(1)}%`);
}

console.log('\n── 자산군별 (base 비용, p50최종가치비율·터틀승률) ──');
for (const v of VARIANT_IDS) {
  console.log(`  [${v}]`);
  for (const [ac, s] of Object.entries(byAssetClass[v])) {
    console.log(`    ${ac.padEnd(10)} n=${s.n} p50비율=${s.p50FinalRatioRatio.toFixed(3)} 터틀승률=${(s.turtleWinRate * 100).toFixed(1)}% MDD중앙=${(s.medianMddTurtle * 100).toFixed(1)}%`);
  }
}

console.log('\n── 최대 기여 종목 제거 민감도 (base 비용) ──');
for (const v of VARIANT_IDS) {
  const l = leaveOneOut[v];
  if (!l) continue;
  console.log(`  [${v}] 최대기여=${l.droppedTicker} 제거전=${l.before.toFixed(3)} 제거후=${l.after.toFixed(3)} 방향불변=${l.directionUnchanged}`);
}

// ── 4b) 고정기간 롤링창 강건성(3년/5년, base 비용) — §과제 "롤링창 비교" 재사용, 새 로직 없음 ──
const ROLLING_HORIZONS = [3, 5] as const;
const rollingCells: RollingCell[] = runRollingWindow(
  securities, VARIANTS, [{ tier: 'base', mult: C.costTiers.base }], ROLLING_HORIZONS, [0], GRID_START, GRID_END, true
);
const rollingByVariantHorizon: Record<string, CellStats> = {};
for (const [key, cs] of groupBy(rollingCells, c => `${c.variantId}|${c.horizonYears}y`)) {
  rollingByVariantHorizon[key] = summarize(cs);
}
console.log('\n── 고정기간 롤링창 강건성(3년/5년, base 비용, 창 완성분만) ──');
for (const v of VARIANT_IDS) {
  for (const h of ROLLING_HORIZONS) {
    const s = rollingByVariantHorizon[`${v}|${h}y`];
    if (!s) continue;
    console.log(`  ${v.padEnd(6)} ${h}년 n=${s.n} p50비율=${s.p50FinalRatioRatio.toFixed(3)} 터틀승률=${(s.turtleWinRate * 100).toFixed(1)}%`);
  }
}

// ── 5) 저장 ──
if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });
writeFileSync(
  path.join(DB_DIR, `exitCompare_results${outTag}.json`),
  JSON.stringify({
    generatedAt: new Date().toISOString(), configHash: hash,
    universeCount: entries.length, dataOkCount: securities.length, missing,
    gridCellCount: cells.length, skipped,
    reproduction: { W1_vs_V1: reproW1, W2_vs_V3: reproW2 },
    overallByVariantCost, byAssetClass, leaveOneOut, rollingByVariantHorizon,
  }, null, 2)
);
console.log(`\n로컬 산출물: DB/holdingsTurtleCycle/exitCompare_results${outTag}.json`);
console.log('\n' + '='.repeat(100));
console.log('완료. 리포트: docs/backtest/REPORT_청산방식비교_2차_260927.md (수동 작성).');
console.log('='.repeat(100));
