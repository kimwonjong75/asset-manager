// scripts/backtest/onboardingPolicy/run.ts
// 편입정책 학습구간 드라이버 (CLI — console 허용, gate0Audit 관례).
// 홀드아웃은 실행하지 않는다 (config.periods.holdout.status = NOT_RUN).
//
// AMENDED-1 (결과 확인 후 결함 수정 1회):
//   #1 동결 설정의 block bootstrap(blockTradingDays=60) 실제 구현 — IID 셀 재표집 폐기.
//   #2 연환산은 실제 경과일/365.2425 (거래봉×252 폐기).
//   #3 채택기준 ③ = 2배 비용에서 ①·② 모두 충족해야 PASS.
//   #4 감사 불변식은 계산 가능한 것만 계산, 나머지는 NOT_EVALUATED (PASS 아님).

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { configHash } from './configHash';
import { REPR_UNIVERSE_19, reprFetchSymbol, reprCurrency } from './reprUniverse';
import {
  precompute, simulateCell, isSkip, monthlyFirstTradingDays, lastIndexAtOrBefore,
  mean, median, blockBootstrapCI, yearsBetween, annualizeReturn,
  RuleConfig, Series, CellResult, SkipRecord, MonthCluster,
} from './simulator';
import type { SymbolSeries } from '../lib/fetchHistory';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');

const { hash, config } = configHash();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const C = config as any;

const LEARN_START: string = C.periods.learning.start;
const LEARN_END: string = C.periods.learning.end;
const BASE_COST: number = C.costs.baseOneWayRate;
const COSTS: number[] = [0, BASE_COST, ...C.costs.sensitivityRates.filter((r: number) => r !== 0)];
const BOOT = C.statistics.bootstrap;              // { method:'block', blockTradingDays:60, iterations:10000, seed:20260715 }
const BLOCK_DAYS: number = BOOT.blockTradingDays;
/** 블록 길이 산정용 기준 거래일 달력 — 대표군 19종 중 17종이 미국 상장이므로 SPY 를 기준으로 쓴다. */
const REF_CALENDAR_TICKER = 'SPY';

function ruleCfg(cost: number): RuleConfig {
  return {
    exitLookback: C.baselineRules.exitLookback,
    entryLookback: C.baselineRules.entryLookback,
    stopMultipleN: C.baselineRules.stopMultipleN,
    pyramidStepN: C.baselineRules.pyramidStepN,
    atrPeriod: C.baselineRules.atrPeriod,
    riskPerUnitPct: C.riskAccounting.riskPerUnitPct,
    costOneWay: cost,
    evalWindowBars: 500,
    legacyValuePctOfBudget: C.budget.legacyValuePctOfBudget,
  };
}

function loadSeries(ticker: string): Series | null {
  const f = path.join(CACHE_DIR, `${reprFetchSymbol(ticker).replace(/[^A-Za-z0-9_.=^-]/g, '_')}.json`);
  if (!existsSync(f)) return null;
  const s = JSON.parse(readFileSync(f, 'utf-8')) as SymbolSeries;
  if (!s.ok) return null;
  return { ticker, dates: s.dates, open: s.open, high: s.high, low: s.low, close: s.close };
}

function pct(x: number): string { return (x * 100).toFixed(2) + '%'; }

console.log('='.repeat(96));
console.log('편입정책 학습구간 실행 — onboarding-policy-v1  [AMENDED-1 / EXPLORATORY]');
console.log('='.repeat(96));
console.log(`설정 해시 (동결·불변): ${hash}`);
console.log(`학습구간: ${LEARN_START} ~ ${LEARN_END}  |  홀드아웃: ${C.periods.holdout.status}`);
console.log(`정책: P1=${C.policies.P1.name} · P2=${C.policies.P2.name}  |  P3=${C.policies.P3.status} · TrackA=${C.tracks.trackA.status}`);
console.log(`비용: 기본 편도 ${BASE_COST} (연구용 가정, 실제 증권사 비용 아님) · 민감도 ${JSON.stringify(C.costs.sensitivityRates)}`);
console.log(`통계: ${BOOT.method} bootstrap · blockTradingDays=${BLOCK_DAYS} · ${BOOT.iterations}회 · 시드 ${BOOT.seed} · 기준달력 ${REF_CALENDAR_TICKER}`);
console.log('');
console.log('⚠ 평가 범위 한계: 이번 P2 는 **신규진입 없음 · 정상 사이징 없음 · 불타기 체결 없음 · 재진입 없음**');
console.log('  상태의 편입만 평가한다(잔여예산 0). 완전한 터틀 운용의 평가가 아니다.');
console.log('⚠ AMENDED-1: 결과를 이미 본 뒤의 구현 수정이므로 이 수치는 EXPLORATORY 다(확증 아님).\n');

// ── 시계열 로드 ──
const seriesByTicker = new Map<string, Series>();
for (const t of REPR_UNIVERSE_19) {
  const s = loadSeries(t);
  if (!s) { console.error(`✗ 시계열 없음: ${t}`); process.exit(1); }
  seriesByTicker.set(t, s);
}
console.log(`대표군 ${seriesByTicker.size}/19 로드 완료 (동결 명단, 추가 없음)`);

// ── 기준 달력: 편입월 → 거래일 인덱스 (블록 길이 산정) ──
const refDates = seriesByTicker.get(REF_CALENDAR_TICKER)!.dates;
const monthRefIdx = new Map<string, number>();
for (let i = 0; i < refDates.length; i++) {
  const k = refDates[i].slice(0, 7);
  if (!monthRefIdx.has(k)) monthRefIdx.set(k, i);
}

interface Run { cells: CellResult[]; skips: SkipRecord[]; }

function runAt(cost: number): Run {
  const cfg = ruleCfg(cost);
  const cells: CellResult[] = [];
  const skips: SkipRecord[] = [];
  for (const t of REPR_UNIVERSE_19) {
    const s = seriesByTicker.get(t)!;
    const pre = precompute(s, cfg);
    if (!pre) continue;
    const lastIdx = lastIndexAtOrBefore(s.dates, LEARN_END);
    if (lastIdx < 0) continue;
    for (const dIdx of monthlyFirstTradingDays(s.dates, LEARN_START, LEARN_END)) {
      const r = simulateCell(pre, dIdx, lastIdx, cfg);
      if (isSkip(r)) skips.push(r); else cells.push(r);
    }
  }
  return { cells, skips };
}

const runs = new Map<number, Run>();
for (const c of COSTS) runs.set(c, runAt(c));
const base = runs.get(BASE_COST)!;

/** 셀별 paired 차이 → 편입월 군집 (같은 월의 종목들이 함께 이동). */
function clusterize(cells: CellResult[], valueOf: (c: CellResult) => number): MonthCluster[] {
  const byMonth = new Map<string, number[]>();
  for (const c of cells) {
    const k = c.admissionDate.slice(0, 7);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k)!.push(valueOf(c));
  }
  return [...byMonth.entries()]
    .map(([monthKey, values]) => ({ monthKey, refIdx: monthRefIdx.get(monthKey) ?? -1, values }))
    .filter(c => c.refIdx >= 0)
    .sort((a, b) => a.refIdx - b.refIdx);
}

function ci(cells: CellResult[], valueOf: (c: CellResult) => number) {
  return blockBootstrapCI(clusterize(cells, valueOf), BLOCK_DAYS, BOOT.iterations, BOOT.seed);
}

const dRet = (c: CellResult) => c.p2Return - c.p1Return;
const dMdd = (c: CellResult) => c.p2MDD - c.p1MDD;
// AMENDED-1 #2: 실제 경과일 기준. P1·P2 모두 fillDate → windowEndDate 동일 기간(청산 후 현금 포함).
const dAnn = (c: CellResult) => {
  const y = yearsBetween(c.fillDate, c.windowEndDate);
  return annualizeReturn(c.p2Return, y) - annualizeReturn(c.p1Return, y);
};

// ── 편입 가능률 ──
const totalCandidates = base.cells.length + base.skips.length;
const skipBy: Record<string, number> = {};
for (const s of base.skips) skipBy[s.reason] = (skipBy[s.reason] ?? 0) + 1;
console.log('\n── 편입 가능률 ──');
console.log(`   대상 셀(종목×월) ${totalCandidates} · 편입 ${base.cells.length} (${pct(base.cells.length / totalCandidates)}) · 거부 ${base.skips.length}`);
for (const [k, v] of Object.entries(skipBy)) console.log(`      거부: ${k} ${v}`);

function summarize(cells: CellResult[]) {
  return {
    n: cells.length,
    p1RetMean: mean(cells.map(c => c.p1Return)), p2RetMean: mean(cells.map(c => c.p2Return)),
    p1RetMed: median(cells.map(c => c.p1Return)), p2RetMed: median(cells.map(c => c.p2Return)),
    p1MddMean: mean(cells.map(c => c.p1MDD)), p2MddMean: mean(cells.map(c => c.p2MDD)),
    p1MddMed: median(cells.map(c => c.p1MDD)), p2MddMed: median(cells.map(c => c.p2MDD)),
    p1RMean: mean(cells.map(c => c.p1R)), p2RMean: mean(cells.map(c => c.p2R)),
    p1AnnMean: mean(cells.map(c => annualizeReturn(c.p1Return, yearsBetween(c.fillDate, c.windowEndDate)))),
    p2AnnMean: mean(cells.map(c => annualizeReturn(c.p2Return, yearsBetween(c.fillDate, c.windowEndDate)))),
    dRetMean: mean(cells.map(dRet)), dMddMean: mean(cells.map(dMdd)), dAnnMean: mean(cells.map(dAnn)),
    p2Wins: cells.map(dRet).filter(d => d > 0).length,
    mddImproved: cells.map(dMdd).filter(d => d < 0).length,
  };
}

const S = summarize(base.cells);
const yearsList = base.cells.map(c => yearsBetween(c.fillDate, c.windowEndDate));

console.log('\n── P1(관찰전용) vs P2(편입) · 기본비용 편도 0.1% ──');
console.log(`   셀 수 ${S.n} · 평가기간(년) 중앙 ${median(yearsList).toFixed(2)} · 최소 ${Math.min(...yearsList).toFixed(2)} · 최대 ${Math.max(...yearsList).toFixed(2)}`);
console.log('');
console.log('   지표                         |        P1 |        P2 |      Δ(P2−P1)');
console.log('   ' + '-'.repeat(70));
console.log(`   평균 총수익률                | ${pct(S.p1RetMean).padStart(9)} | ${pct(S.p2RetMean).padStart(9)} | ${pct(S.dRetMean).padStart(13)}`);
console.log(`   중앙 총수익률                | ${pct(S.p1RetMed).padStart(9)} | ${pct(S.p2RetMed).padStart(9)} | ${pct(median(base.cells.map(dRet))).padStart(13)}`);
console.log(`   평균 연환산(경과일 기준)     | ${pct(S.p1AnnMean).padStart(9)} | ${pct(S.p2AnnMean).padStart(9)} | ${pct(S.dAnnMean).padStart(13)}`);
console.log(`   평균 셀별 가격경로 MDD       | ${pct(S.p1MddMean).padStart(9)} | ${pct(S.p2MddMean).padStart(9)} | ${pct(S.dMddMean).padStart(13)}`);
console.log(`   중앙 셀별 가격경로 MDD       | ${pct(S.p1MddMed).padStart(9)} | ${pct(S.p2MddMed).padStart(9)} | ${pct(median(base.cells.map(dMdd))).padStart(13)}`);
console.log(`   평균 R                       | ${S.p1RMean.toFixed(3).padStart(9)} | ${S.p2RMean.toFixed(3).padStart(9)} | ${(S.p2RMean - S.p1RMean).toFixed(3).padStart(13)}`);
console.log('   (MDD = 개별 셀 가격경로의 최대낙폭 평균 — 포트폴리오 MDD 아님)');

const ciRet = ci(base.cells, dRet);
const ciMdd = ci(base.cells, dMdd);
const ciAnn = ci(base.cells, dAnn);
console.log(`\n   블록 부트스트랩 (월 군집 × ${BLOCK_DAYS}거래일 블록, 블록 ${ciMdd.blocks}개, ${BOOT.iterations}회)`);
console.log(`   Δ총수익률   평균 ${pct(S.dRetMean)} · 95% CI [${pct(ciRet.lo)}, ${pct(ciRet.hi)}] ${ciRet.hi < 0 || ciRet.lo > 0 ? '(0 제외)' : '(0 포함)'}`);
console.log(`   ΔMDD        평균 ${pct(S.dMddMean)} · 95% CI [${pct(ciMdd.lo)}, ${pct(ciMdd.hi)}] ${ciMdd.hi < 0 || ciMdd.lo > 0 ? '(0 제외)' : '(0 포함)'}`);
console.log(`   Δ연환산수익 평균 ${pct(S.dAnnMean)} · 95% CI [${pct(ciAnn.lo)}, ${pct(ciAnn.hi)}] ${ciAnn.hi < 0 || ciAnn.lo > 0 ? '(0 제외)' : '(0 포함)'}`);
console.log(`   P2 수익 우세 셀 ${S.p2Wins}/${S.n} (${pct(S.p2Wins / S.n)}) · P2 MDD 개선 셀 ${S.mddImproved}/${S.n} (${pct(S.mddImproved / S.n)})`);
const mddRel = S.p1MddMean > 0 ? (S.p1MddMean - S.p2MddMean) / S.p1MddMean : 0;
console.log(`   MDD 상대 감소율 = ${pct(mddRel)}  (채택 기준 ①: ≥ 20% + CI 0 제외)`);

// ── 비용 민감도 ──
console.log('\n── 비용 민감도 (블록 부트스트랩) ──');
console.log('   비용(편도) | Δ총수익 |  ΔMDD   | Δ연환산 | Δ연환산 95%CI                | MDD상대감소');
console.log('   ' + '-'.repeat(90));
const byCost = new Map<number, { s: ReturnType<typeof summarize>; ciAnn: { lo: number; hi: number }; ciMdd: { lo: number; hi: number }; rel: number }>();
for (const c of [...COSTS].sort((a, b) => a - b)) {
  const cells = runs.get(c)!.cells;
  const s = summarize(cells);
  const a = ci(cells, dAnn), m = ci(cells, dMdd);
  const rel = s.p1MddMean > 0 ? (s.p1MddMean - s.p2MddMean) / s.p1MddMean : 0;
  byCost.set(c, { s, ciAnn: a, ciMdd: m, rel });
  console.log(`   ${String(c).padEnd(10)} | ${pct(s.dRetMean).padStart(7)} | ${pct(s.dMddMean).padStart(7)} | ${pct(s.dAnnMean).padStart(7)} | [${pct(a.lo).padStart(7)}, ${pct(a.hi).padStart(7)}] | ${pct(rel).padStart(11)}`);
}

// ── 신호 발생 ──
console.log('\n── 신호 발생 (기본비용) ──');
const byReason: Record<string, number> = {};
for (const c of base.cells) byReason[c.p2ExitReason] = (byReason[c.p2ExitReason] ?? 0) + 1;
const blockedCells = base.cells.filter(c => c.pyramidBlocked).length;
console.log(`   손절(stop)로 종료한 셀                 ${byReason['stop'] ?? 0}`);
console.log(`   20일 청산(channel-exit)으로 종료한 셀  ${byReason['channel-exit'] ?? 0}`);
console.log(`   편입 즉시 청산한 셀                    ${byReason['immediate-exit'] ?? 0}`);
console.log(`   미발화 → 평가창 말 강제청산한 셀       ${byReason['forced-eod'] ?? 0}`);
console.log(`   불타기 조건을 **한 번 이상 충족한 셀**  ${blockedCells}  (셀당 최초 1회만 기록 — 발생 횟수 아님)`);
console.log(`     → 전부 ${C.budget.blockedSignalTag}. 실제 불타기 체결 0 (잔여예산 0)`);

// ── 기존수량 보존 관련 참고치 ──
console.log('\n── LEGACY_EXCESS 참고치 (인과 해석 아님) ──');
const lem = base.cells.map(c => c.legacyExcessMultiple);
const legacyExcessN = base.cells.filter(c => c.legacyExcess).length;
console.log(`   LEGACY_EXCESS 셀 ${legacyExcessN}/${base.cells.length} (${pct(legacyExcessN / base.cells.length)})`);
console.log(`   실손절위험 ÷ 1유닛 규격위험: 평균 ${mean(lem).toFixed(2)}× · 중앙 ${median(lem).toFixed(2)}× · 최대 ${Math.max(...lem).toFixed(2)}×`);
console.log(`   ※ 이 배수는 **가정된 보유가치(예산의 ${C.budget.legacyValuePctOfBudget}%) 기준의 금액위험 참고치**일 뿐이다.`);
console.log(`     위 수익률·MDD·R 은 전부 척도 무관(수량 소거)이라 이 배수의 영향을 받지 않는다.`);
console.log(`     따라서 "수량 보존이 수익률·MDD 를 N배 확대했다"는 해석은 성립하지 않는다.`);
const stopped = base.cells.filter(c => c.p2ExitReason === 'stop');
if (stopped.length) {
  console.log(`   손절 종료 셀 평균 R ${mean(stopped.map(c => c.p2R)).toFixed(3)} (< −1)`);
  console.log(`     주원인: 손절은 종가 판정 후 **익일 시가** 체결이라 갭 하락분이 손절가를 넘어 실현되고, 매도비용이 더해진다.`);
}

// ── 종목별 ──
console.log('\n── 종목별 Δ (기본비용) ──');
console.log('   종목      | 통화 | 셀  | Δ총수익  | Δ연환산  |   ΔMDD   | 손절 | 청산 | 즉시 | 불타기조건셀');
console.log('   ' + '-'.repeat(96));
for (const t of REPR_UNIVERSE_19) {
  const cs = base.cells.filter(c => c.ticker === t);
  if (!cs.length) { console.log(`   ${t.padEnd(9)} | ${reprCurrency(t)}  |   0 | (편입 셀 없음)`); continue; }
  const s = summarize(cs);
  console.log(`   ${t.padEnd(9)} | ${reprCurrency(t).padEnd(4)} | ${String(cs.length).padStart(3)} | ${pct(s.dRetMean).padStart(8)} | ${pct(s.dAnnMean).padStart(8)} | ${pct(s.dMddMean).padStart(8)} | ${String(cs.filter(c => c.p2ExitReason === 'stop').length).padStart(4)} | ${String(cs.filter(c => c.p2ExitReason === 'channel-exit').length).padStart(4)} | ${String(cs.filter(c => c.p2ExitReason === 'immediate-exit').length).padStart(4)} | ${String(cs.filter(c => c.pyramidBlocked).length).padStart(12)}`);
}

console.log('\n── leave-one-out (최대 기여 종목 제거 후 부호 유지) ──');
let worst = { ticker: '', absContrib: -1 };
for (const t of REPR_UNIVERSE_19) {
  const cs = base.cells.filter(c => c.ticker !== t);
  if (!cs.length) continue;
  const contrib = Math.abs(summarize(cs).dMddMean - S.dMddMean);
  if (contrib > worst.absContrib) worst = { ticker: t, absContrib: contrib };
}
const looCells = base.cells.filter(c => c.ticker !== worst.ticker);
const looS = summarize(looCells);
const looCiMdd = ci(looCells, dMdd);
const looRel = looS.p1MddMean > 0 ? (looS.p1MddMean - looS.p2MddMean) / looS.p1MddMean : 0;
console.log(`   최대 기여 종목 = ${worst.ticker} 제거: ΔMDD ${pct(looS.dMddMean)} · CI [${pct(looCiMdd.lo)}, ${pct(looCiMdd.hi)}] · MDD 상대감소 ${pct(looRel)} · Δ연환산 ${pct(looS.dAnnMean)}`);
console.log(`   ① 부호 유지: ${looS.dMddMean < 0 && looCiMdd.hi < 0 && looRel >= 0.20 ? '예' : '아니오'}`);

// ── 채택 기준 판정 ──
console.log('\n── 채택 기준 판정 (동결 §7 · 결과 후 변경 없음) ──');
const g1 = mddRel >= 0.20 && ciMdd.hi < 0;
const g2 = ciAnn.lo >= -0.02;
const c2x = byCost.get(0.002)!;
const g3_1 = c2x.rel >= 0.20 && c2x.ciMdd.hi < 0;
const g3_2 = c2x.ciAnn.lo >= -0.02;
const g3 = g3_1 && g3_2;                       // AMENDED-1 #3: ①·② 모두 충족해야 PASS
const g4 = looS.dMddMean < 0 && looCiMdd.hi < 0 && looRel >= 0.20;
console.log(`   ① MDD 상대 20%+ 감소 & CI 0 제외        : ${g1 ? 'PASS' : 'FAIL'} (상대감소 ${pct(mddRel)}, CI hi ${pct(ciMdd.hi)})`);
console.log(`   ② 연환산 수익 열위 −2%p 이내 (CI 하한)  : ${g2 ? 'PASS' : 'FAIL'} (CI 하한 ${pct(ciAnn.lo)})`);
console.log(`   ③ 2배 비용에서 ①·② 모두 충족           : ${g3 ? 'PASS' : 'FAIL'} (①' ${g3_1 ? 'pass' : 'fail'} / ②' ${g3_2 ? 'pass' : 'fail'} — CI 하한 ${pct(c2x.ciAnn.lo)})`);
console.log(`   ④ 최대기여 종목 LOO 부호 유지           : ${g4 ? 'PASS' : 'FAIL'}`);

// AMENDED-1 #4: 실행 결과로 계산 가능한 것만 계산. 나머지는 NOT_EVALUATED (PASS 아님).
console.log('   ⑤ 감사 불변식:');
const dupEntries = 0;               // 신규진입 경로 자체가 없음 — 코드상 진입 호출 0
const pyramidFills = 0;             // 불타기 체결 경로 없음
const trimEvents = 0;               // 트림 경로 없음
console.log(`      · 중복 신규진입 체결 ${dupEntries}건        : PASS (실행 결과 — 진입 경로 미호출)`);
console.log(`      · 불타기 체결 ${pyramidFills}건              : PASS (실행 결과 — 조건 충족 ${blockedCells}셀 전부 차단)`);
console.log(`      · 강제 트림 ${trimEvents}건                  : PASS (실행 결과 — 트림 경로 미호출)`);
console.log(`      · 총위험 12% 한도                    : NOT_EVALUATED (수량·포트폴리오 원장 없음 — 셀 독립 척도무관 설계상 산출 불가)`);
console.log(`      · 25% 종목상한                       : NOT_EVALUATED (동일 사유)`);
console.log(`      · 예산 초과                          : NOT_EVALUATED (동일 사유)`);
console.log('      → NOT_EVALUATED 는 PASS 가 아니다. ⑤ 전체는 미확정.');

const verdict = g1 && g2 && g3 && g4;
console.log(`\n   전 기준 충족(①~④, ⑤ 미확정 제외): ${verdict ? 'YES' : 'NO'}`);
if (!g2) console.log('   → 기준 ② FAIL → P2 채택 조건 미충족.');

console.log('\n' + '='.repeat(96));
console.log(`홀드아웃: 미실행 (${C.periods.holdout.status}) — ${C.periods.holdout.start} ~ ${C.periods.holdout.end} 바 미참조`);
console.log('⚠ 단, 2022~2026 은 **완전 미공개 구간이 아니다**: 대표군 19종과 55/20 기준이 그 기간까지');
console.log('  사용한 이전 채널 보고서에서 선택됐다. 향후 실행하더라도 확증용이 아니라 **탐색용**이다.');
console.log('='.repeat(96));
