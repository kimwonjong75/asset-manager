// scripts/backtest/sectorRotation/phase2.ts
// Phase 2 러너 — Global 후보 신호의 "엄격한 전략 검증"(사전등록 PHASE2_PREREGISTRATION.md).
// "검증된 돈 버는 전략의 실행"이 아니라, 후보 신호가 실제 거래규칙·비용·아웃오브샘플에서
// 버티는지 정직히 검증한다. 결과가 나빠도 그대로 보고(튜닝 재탐색 금지).
// 연구 전용(앱/백엔드/공유캐시 무접촉). 실행: npm run phase2
//
// 초보자용 한글 리포트를 콘솔에 출력하고 phase2_report.json 에 모든 수치를 저장한다.

import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchMany } from './lib/yahooData';
import {
  simulate,
  simulateBenchmark,
  firstOpenByMonth,
  nextMonthKey,
  PRIMARY_PARAMS,
  type StrategyParams,
  type StrategyResult,
  type BenchmarkResult,
  type BenchmarkSpec,
} from './lib/strategy';
import {
  coreMetrics,
  annualReturns,
  annualizedTurnover,
  costDrag,
  slicePeriod,
  windowReturn,
  upDownCapture,
  contributionByAsset,
  dropTopTrades,
  equityFromReturns,
  FIXED_REGIMES,
  type CoreMetrics,
} from './lib/perfMetrics';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const START = '1990-01-01';
const END = '2026-07-13';
const LAST_COMPLETE_MONTH = '2026-06';
const REPORT_PATH = path.join(__dirname, 'phase2_report.json');

const PRIMARY_COST = 0.001; // 편도 0.10%
const COST_SWEEP = [0, 0.0005, 0.001, 0.002, 0.0025]; // {0,0.05,0.10,0.20,0.25%}
const STRESS_COST = 0.003; // 편도 0.30% 강건성
const SUB1 = { from: '2011-03', to: '2018-12', label: '전반(2011-03~2018-12)' };
const SUB2 = { from: '2019-01', to: '2026-06', label: '후반(2019-01~2026-06)' };

// ─── 표기 헬퍼 ───────────────────────────────────────────────
function pct(v: number, d = 2): string {
  return `${(v * 100).toFixed(d)}%`;
}
function num(v: number, d = 2): string {
  return v.toFixed(d);
}
function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function padL(s: string, n: number): string {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

function primaryParams(costRate: number): StrategyParams {
  return { ...PRIMARY_PARAMS, costRate };
}

// ─── 벤치마크 정의(사전등록 §6) ─────────────────────────────
function benchmarkSpecs(): BenchmarkSpec[] {
  return [
    { key: 'SPY', label: 'SPY 매수후보유', weights: { SPY: 1 } },
    {
      key: 'EW6',
      label: '6종 동일가중(월 리밸런싱)',
      weights: { SPY: 1 / 6, EWY: 1 / 6, EWJ: 1 / 6, MCHI: 1 / 6, GLD: 1 / 6, DBC: 1 / 6 },
    },
    { key: '6040', label: '60/40 (SPY·AGG)', weights: { SPY: 0.6, AGG: 0.4 } },
    { key: 'BIL', label: '현금(BIL)', weights: { BIL: 1 } },
  ];
}

interface NamedMetrics {
  key: string;
  label: string;
  metrics: CoreMetrics;
}

function metricsRow(m: CoreMetrics): string {
  return (
    `${padL(pct(m.cagr), 8)} ${padL(pct(m.mdd), 8)} ${padL(num(m.sharpe), 6)} ` +
    `${padL(num(m.sortino), 6)} ${padL(num(m.calmar), 6)} ${padL(pct(m.worst1yr), 8)} ` +
    `${padL(pct(m.worst3yr), 8)} ${padL(pct(m.hitRate, 1), 7)}`
  );
}

function printMetricsTable(title: string, rows: NamedMetrics[]): void {
  console.log(`\n  ${title}`);
  console.log(
    '    ' +
      pad('전략/벤치', 22) +
      padL('CAGR', 8) +
      ' ' +
      padL('MDD', 8) +
      ' ' +
      padL('Sharpe', 6) +
      ' ' +
      padL('Sortino', 6) +
      ' ' +
      padL('Calmar', 6) +
      ' ' +
      padL('최악1년', 8) +
      ' ' +
      padL('최악3년', 8) +
      ' ' +
      padL('승률', 7)
  );
  for (const r of rows) {
    console.log('    ' + pad(r.label, 22) + metricsRow(r.metrics));
  }
}

async function main(): Promise<void> {
  console.log('='.repeat(84));
  console.log('Phase 2 — Global 후보 신호의 "엄격한 전략 검증"');
  console.log('(돈 버는 전략의 실행이 아니라, 신호가 실거래·비용·아웃오브샘플에서 버티는지 검증)');
  console.log(`요청 구간: ${START} ~ ${END} · 마지막 완료월 ${LAST_COMPLETE_MONTH} · 소스 Yahoo v8(캐시 우선)`);
  console.log('='.repeat(84));

  // ── 데이터 로드 ──
  console.log('\n[1/6] 데이터 로드...');
  const symbols = ['SPY', 'EWY', 'EWJ', 'MCHI', 'GLD', 'DBC', 'BIL', 'AGG', 'KRW=X'];
  const seriesMap = await fetchMany(symbols, START, END);
  // 무결성: 핵심 심볼 실패는 명시적으로 알린다(무음 대체 금지).
  const dataStatus: Record<string, { ok: boolean; error?: string; days: number }> = {};
  for (const s of symbols) {
    const ser = seriesMap.get(s);
    dataStatus[s] = { ok: !!ser?.ok, error: ser?.ok ? undefined : ser?.error, days: ser?.dates.length ?? 0 };
  }
  const coreNeeded = ['SPY', 'EWY', 'EWJ', 'MCHI', 'GLD', 'DBC', 'BIL', 'AGG'];
  const missing = coreNeeded.filter(s => !dataStatus[s].ok);
  if (missing.length > 0) {
    console.error(`\n✗ 핵심 데이터 실패: ${missing.join(', ')} — 중단(무음 대체 금지).`);
    process.exit(1);
  }
  const krwOk = dataStatus['KRW=X'].ok;

  // ── 1차 전략(0.10% 비용) ──
  console.log('\n[2/6] 1차 전략 시뮬레이션(N=2·월간·완충 상위3·듀얼모멘텀 vs BIL·편도 0.10%)...');
  const primary = simulate({ seriesMap }, primaryParams(PRIMARY_COST));
  const execMonths = primary.months;
  const rf = primary.cashMonthlyReturns;
  console.log(
    `    체결구간: ${execMonths[0]} ~ ${execMonths[execMonths.length - 1]} (총 ${execMonths.length}개월)` +
      ` · 첫 신호월 ${primary.firstSignalMonth}`
  );

  // ── 벤치마크(동일 체결 그리드) ──
  const benches: BenchmarkResult[] = benchmarkSpecs().map(spec =>
    simulateBenchmark({ seriesMap }, primaryParams(PRIMARY_COST), spec, execMonths)
  );

  // ── 핵심 지표 ──
  const primaryMetrics = coreMetrics(primary.equity, primary.monthlyReturns, rf);
  const benchMetrics: NamedMetrics[] = benches.map(b => ({
    key: b.key,
    label: b.label,
    metrics: coreMetrics(b.equity, b.monthlyReturns, rf),
  }));
  const spyM = benchMetrics.find(b => b.key === 'SPY')!.metrics;
  const ewM = benchMetrics.find(b => b.key === 'EW6')!.metrics;

  console.log('\n[3/6] 성과 지표(전 구간)');
  printMetricsTable('■ 전 구간 성과 (Sharpe/Sortino 는 BIL 초과 기준)', [
    { key: 'PRIMARY', label: '★1차 전략(0.10%)', metrics: primaryMetrics },
    ...benchMetrics,
  ]);

  // 연회전율/비용
  const annTurn = annualizedTurnover(primary.turnoverSeries);
  const drag = costDrag(primary.costSeries);
  console.log(
    `\n    운용현실: 연회전율(편도) ${pct(annTurn, 0)} · 총비용차감 ${pct(drag.total)} · 연비용 ${pct(drag.annualized)}`
  );

  // ── 국면별 ──
  console.log('\n  ■ 국면별 수익(1차 vs SPY)');
  const regimeRows: Array<{ key: string; label: string; strat: number; spy: number; n: number }> = [];
  for (const rg of FIXED_REGIMES) {
    const st = windowReturn(execMonths, primary.monthlyReturns, rg.from, rg.to);
    const sp = windowReturn(benches[0].months, benches[0].monthlyReturns, rg.from, rg.to);
    regimeRows.push({ key: rg.key, label: rg.label, strat: st.ret, spy: sp.ret, n: st.nMonths });
    console.log(`    · ${pad(rg.label, 30)} 1차 ${padL(pct(st.ret), 9)}  SPY ${padL(pct(sp.ret), 9)}  (${st.nMonths}개월)`);
  }
  const cap = upDownCapture(primary.monthlyReturns, benches[0].monthlyReturns);
  console.log(
    `    · 시장 상승월(${cap.upN}): 1차 평균 ${pct(cap.upAvgStrat)} vs SPY ${pct(cap.upAvgBench)}` +
      ` / 하락월(${cap.downN}): 1차 ${pct(cap.downAvgStrat)} vs SPY ${pct(cap.downAvgBench)}`
  );

  // ── 연도별 ──
  const annPrimary = annualReturns(execMonths, primary.monthlyReturns);
  const annSpy = annualReturns(benches[0].months, benches[0].monthlyReturns);
  const annEw = annualReturns(benches[1].months, benches[1].monthlyReturns);
  console.log('\n  ■ 연도별 수익 (1차 / SPY / EW6)');
  for (let i = 0; i < annPrimary.length; i++) {
    const y = annPrimary[i];
    const sp = annSpy.find(a => a.year === y.year);
    const ew = annEw.find(a => a.year === y.year);
    console.log(
      `    ${y.year}: ${padL(pct(y.ret), 9)} / ${padL(pct(sp?.ret ?? 0), 9)} / ${padL(pct(ew?.ret ?? 0), 9)}` +
        (y.nMonths < 12 ? `  (${y.nMonths}개월)` : '')
    );
  }

  // ── 시기 분할(사전등록 §7) ──
  console.log('\n[4/6] 고정 시기 분할 안정성');
  function subMetrics(from: string, to: string, res: { months: string[]; monthlyReturns: number[] }): CoreMetrics {
    const sl = slicePeriod(res.months, res.monthlyReturns, rf, from, to);
    return coreMetrics(sl.equity, sl.monthlyReturns, sl.rf);
  }
  const sub1P = subMetrics(SUB1.from, SUB1.to, primary);
  const sub1S = subMetrics(SUB1.from, SUB1.to, benches[0]);
  const sub1E = subMetrics(SUB1.from, SUB1.to, benches[1]);
  const sub2P = subMetrics(SUB2.from, SUB2.to, primary);
  const sub2S = subMetrics(SUB2.from, SUB2.to, benches[0]);
  const sub2E = subMetrics(SUB2.from, SUB2.to, benches[1]);
  printMetricsTable(`■ ${SUB1.label}`, [
    { key: 'P', label: '1차 전략', metrics: sub1P },
    { key: 'SPY', label: 'SPY', metrics: sub1S },
    { key: 'EW6', label: 'EW6', metrics: sub1E },
  ]);
  printMetricsTable(`■ ${SUB2.label}`, [
    { key: 'P', label: '1차 전략', metrics: sub2P },
    { key: 'SPY', label: 'SPY', metrics: sub2S },
    { key: 'EW6', label: 'EW6', metrics: sub2E },
  ]);
  const sub1BeatsBoth = sub1P.cagr >= sub1S.cagr && sub1P.cagr >= sub1E.cagr;
  const sub2BeatsBoth = sub2P.cagr >= sub2S.cagr && sub2P.cagr >= sub2E.cagr;

  // ── 민감도 그리드 + 비용 스윕(사전등록 §7, 보고용) ──
  console.log('\n[5/6] 민감도 그리드 (보고 전용 — 최고 셀 선택 금지)');
  console.log('  ※ 1차 전략은 §3 단일 구성(N=2·월간)뿐. 아래 표는 "인접값에서 급붕괴 여부"만 본다.');
  interface GridCell {
    topN: number;
    rebalance: 'monthly' | 'quarterly';
    cagr: number;
    mdd: number;
    sharpe: number;
    annTurnover: number;
  }
  const grid: GridCell[] = [];
  console.log('\n    ' + pad('N × 리밸', 14) + padL('CAGR', 9) + padL('MDD', 10) + padL('Sharpe', 8) + padL('연회전', 9));
  for (const topN of [1, 2, 3]) {
    for (const reb of ['monthly', 'quarterly'] as const) {
      const p: StrategyParams = { ...PRIMARY_PARAMS, topN, rebalance: reb, costRate: PRIMARY_COST };
      const res = simulate({ seriesMap }, p);
      const m = coreMetrics(res.equity, res.monthlyReturns, res.cashMonthlyReturns);
      const at = annualizedTurnover(res.turnoverSeries);
      grid.push({ topN, rebalance: reb, cagr: m.cagr, mdd: m.mdd, sharpe: m.sharpe, annTurnover: at });
      const star = topN === 2 && reb === 'monthly' ? ' ←1차' : '';
      console.log(
        '    ' +
          pad(`N=${topN} ${reb === 'monthly' ? '월간' : '분기'}`, 14) +
          padL(pct(m.cagr), 9) +
          padL(pct(m.mdd), 10) +
          padL(num(m.sharpe), 8) +
          padL(pct(at, 0), 9) +
          star
      );
    }
  }

  console.log('\n    비용 스윕(1차 구성 N=2·월간):');
  console.log('    ' + pad('편도비용', 12) + padL('CAGR', 9) + padL('vs SPY', 10) + padL('vs EW6', 10));
  const costSweep: Array<{ cost: number; cagr: number; excessSpy: number; excessEw: number }> = [];
  for (const c of COST_SWEEP) {
    const res = simulate({ seriesMap }, primaryParams(c));
    const m = coreMetrics(res.equity, res.monthlyReturns, res.cashMonthlyReturns);
    const row = { cost: c, cagr: m.cagr, excessSpy: m.cagr - spyM.cagr, excessEw: m.cagr - ewM.cagr };
    costSweep.push(row);
    console.log(
      '    ' +
        pad(pct(c, 2), 12) +
        padL(pct(m.cagr), 9) +
        padL(pct(row.excessSpy), 10) +
        padL(pct(row.excessEw), 10)
    );
  }

  // ── 강건성(사전등록 §8) ──
  console.log('\n[6/6] 강건성 검증');
  // (a) 단일 자산 기여
  const contrib = contributionByAsset(primary.trades);
  const contribArr = Array.from(contrib.entries()).sort((a, b) => b[1] - a[1]);
  const totalContrib = contribArr.reduce((a, b) => a + b[1], 0);
  console.log('  (a) 단일 자산 기여(산술 Σ w·r, 초과수익 집중도):');
  for (const [sym, c] of contribArr) {
    console.log(`      ${pad(sym, 8)} ${padL(pct(c), 9)}  (전체 기여의 ${pct(totalContrib !== 0 ? c / totalContrib : 0, 1)})`);
  }
  const topAsset = contribArr[0];
  const topAssetShare = totalContrib !== 0 ? topAsset[1] / totalContrib : 0;

  // (b) 상위 5개 거래 제거
  const dropped = dropTopTrades(execMonths, primary.grossMonthlyReturns, primary.costSeries, primary.trades, 5);
  const dropEquity = equityFromReturns(dropped.monthlyReturns);
  const dropM = coreMetrics(dropEquity, dropped.monthlyReturns, rf);
  console.log(`\n  (b) 상위 5개 기여 거래 제거 후: CAGR ${pct(dropM.cagr)} (원본 ${pct(primaryMetrics.cagr)})`);
  console.log(
    `      제거된 거래: ${dropped.removed.map(t => `${t.symbol} ${t.execMonth}(${pct(t.contribution)})`).join(', ')}`
  );
  const dropStillBeats = dropM.cagr >= spyM.cagr && dropM.cagr >= ewM.cagr;

  // (c) 편도 0.30% 스트레스
  const stress = simulate({ seriesMap }, primaryParams(STRESS_COST));
  const stressM = coreMetrics(stress.equity, stress.monthlyReturns, stress.cashMonthlyReturns);
  console.log(`\n  (c) 편도 0.30% 비용: CAGR ${pct(stressM.cagr)} · vs SPY ${pct(stressM.cagr - spyM.cagr)} · vs EW6 ${pct(stressM.cagr - ewM.cagr)}`);
  const stressStillBeats = stressM.cagr >= spyM.cagr && stressM.cagr >= ewM.cagr;

  // ── KRW 보조 ──
  let krwReport: {
    ok: boolean;
    cagr?: number;
    mdd?: number;
    usdCagr?: number;
    note: string;
  };
  if (krwOk) {
    const fx = firstOpenByMonth(seriesMap.get('KRW=X')!);
    const krwReturns: number[] = [];
    let fxOk = true;
    for (let i = 0; i < execMonths.length; i++) {
      const e = execMonths[i];
      const a = fx.get(e);
      const b = fx.get(nextMonthKey(e));
      if (!a || !b) {
        fxOk = false;
        break;
      }
      const fxRatio = b.open / a.open; // KRW per USD 변화
      krwReturns.push((1 + primary.monthlyReturns[i]) * fxRatio - 1);
    }
    if (fxOk) {
      const krwEq = equityFromReturns(krwReturns);
      const krwM = coreMetrics(krwEq, krwReturns, rf);
      krwReport = {
        ok: true,
        cagr: krwM.cagr,
        mdd: krwM.mdd,
        usdCagr: primaryMetrics.cagr,
        note: 'USD 자산곡선을 USD/KRW(Yahoo KRW=X) 첫거래일 시가로 환산.',
      };
      console.log('\n  ■ KRW 투자자 관점(보조)');
      console.log(`    KRW 기준 CAGR ${pct(krwM.cagr)} · MDD ${pct(krwM.mdd)}  (USD 기준 CAGR ${pct(primaryMetrics.cagr)})`);
    } else {
      krwReport = { ok: false, note: 'KRW=X 체결월 시가 정렬 실패 — KRW 환산 생략(무음 대체 금지).' };
      console.log('\n  ■ KRW 투자자 관점(보조): KRW=X 정렬 실패 — 생략.');
    }
  } else {
    krwReport = { ok: false, note: `KRW=X 조회 실패(${dataStatus['KRW=X'].error}) — KRW 환산 생략(무음 대체 금지).` };
    console.log(`\n  ■ KRW 투자자 관점(보조): KRW=X 조회 실패(${dataStatus['KRW=X'].error}) — 생략.`);
  }

  // ── 판정(사전등록 §10) ──
  const beatsFullCost = primaryMetrics.cagr >= spyM.cagr && primaryMetrics.cagr >= ewM.cagr;
  const bothSubPeriods = sub1BeatsBoth && sub2BeatsBoth;
  const passOverall = beatsFullCost && bothSubPeriods && dropStillBeats && stressStillBeats;

  console.log('\n' + '='.repeat(84));
  console.log('판정 (사전등록 §10 — 결과와 무관하게 정직히 기록)');
  console.log('='.repeat(84));
  console.log(`  ① 편도 0.10% 후 SPY·EW6 대비 우수:  ${beatsFullCost ? 'O' : 'X'}`);
  console.log(`       1차 CAGR ${pct(primaryMetrics.cagr)} / SPY ${pct(spyM.cagr)} / EW6 ${pct(ewM.cagr)}`);
  console.log(`  ② 시기 분할 양쪽에서 방향 유지:      ${bothSubPeriods ? 'O' : 'X'}`);
  console.log(`       전반 1차 ${pct(sub1P.cagr)} vs SPY ${pct(sub1S.cagr)}/EW6 ${pct(sub1E.cagr)} → ${sub1BeatsBoth ? 'O' : 'X'}`);
  console.log(`       후반 1차 ${pct(sub2P.cagr)} vs SPY ${pct(sub2S.cagr)}/EW6 ${pct(sub2E.cagr)} → ${sub2BeatsBoth ? 'O' : 'X'}`);
  console.log(`  ③ 상위 5개 거래 제거에도 결론 유지:  ${dropStillBeats ? 'O' : 'X'} (제거 후 CAGR ${pct(dropM.cagr)})`);
  console.log(`       (단일 자산 최대 기여: ${topAsset[0]} = 전체 기여의 ${pct(topAssetShare, 1)})`);
  console.log(`  ④ 편도 0.30%에서도 장점 잔존:        ${stressStillBeats ? 'O' : 'X'} (CAGR ${pct(stressM.cagr)})`);
  console.log('  ' + '-'.repeat(80));
  console.log(`  ▶ 종합: ${passOverall ? '통과 후보 (네 조건 모두 충족)' : '불충분 — "Global 순환 신호는 관찰되나 거래전략으로는 불충분"'}`);
  if (!passOverall) {
    const fails: string[] = [];
    if (!beatsFullCost) fails.push('①비용후 벤치 미달');
    if (!bothSubPeriods) fails.push('②시기분할 불안정');
    if (!dropStillBeats) fails.push('③상위거래 의존');
    if (!stressStillBeats) fails.push('④0.3%에서 붕괴');
    console.log(`     무너진 조건: ${fails.join(' · ')} → 튜닝 재탐색 금지, 그대로 기록.`);
  }
  console.log('='.repeat(84));

  // ── JSON 리포트 ──
  const report = {
    generatedAt: new Date().toISOString(),
    preRegistration: 'PHASE2_PREREGISTRATION.md',
    requestedStart: START,
    requestedEnd: END,
    lastCompleteMonth: LAST_COMPLETE_MONTH,
    dataStatus,
    execPeriod: { first: execMonths[0], last: execMonths[execMonths.length - 1], nMonths: execMonths.length, firstSignalMonth: primary.firstSignalMonth },
    primaryParams: primaryParams(PRIMARY_COST),
    metrics: {
      primary: primaryMetrics,
      benchmarks: benchMetrics,
      annualizedTurnover: annTurn,
      costDrag: drag,
    },
    regimes: regimeRows,
    upDownCapture: cap,
    annual: { primary: annPrimary, spy: annSpy, ew6: annEw },
    subPeriods: {
      sub1: { window: SUB1, primary: sub1P, spy: sub1S, ew6: sub1E, primaryBeatsBoth: sub1BeatsBoth },
      sub2: { window: SUB2, primary: sub2P, spy: sub2S, ew6: sub2E, primaryBeatsBoth: sub2BeatsBoth },
    },
    sensitivityGrid: grid,
    costSweep,
    robustness: {
      contributionByAsset: contribArr.map(([sym, c]) => ({ symbol: sym, contribution: c, share: totalContrib !== 0 ? c / totalContrib : 0 })),
      topAsset: { symbol: topAsset[0], share: topAssetShare },
      dropTop5: { cagr: dropM.cagr, original: primaryMetrics.cagr, stillBeats: dropStillBeats, removed: dropped.removed },
      stressCost03: { cagr: stressM.cagr, vsSpy: stressM.cagr - spyM.cagr, vsEw: stressM.cagr - ewM.cagr, stillBeats: stressStillBeats },
    },
    krw: krwReport,
    verdict: {
      beatsFullCost,
      sub1BeatsBoth,
      sub2BeatsBoth,
      dropStillBeats,
      stressStillBeats,
      passOverall,
    },
    equityCurves: {
      months: execMonths,
      primary: primary.equity,
      spy: benches[0].equity,
      ew6: benches[1].equity,
      sixtyForty: benches[2].equity,
      bil: benches[3].equity,
    },
    lookAheadGuard: primary.note,
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n머신리더블 리포트 저장: ${REPORT_PATH}`);
}

main().catch(e => {
  console.error('Phase 2 실행 중 예외:', e);
  process.exit(1);
});
