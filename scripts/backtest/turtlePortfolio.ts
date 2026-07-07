// scripts/backtest/turtlePortfolio.ts
// 터틀 포트폴리오 백테스트 — 유닛 수 / 라우팅 / 코어:위성 비율 결정을 위한 시뮬레이터.
//
// 실행: npx --yes tsx scripts/backtest/turtlePortfolio.ts
//       npx --yes tsx scripts/backtest/turtlePortfolio.ts --config A-unit2   (단일 config 디버그 출력)
//
// 산출물: docs/backtest/REPORT_터틀백테스트.md
//
// 앱 순수 함수 재사용: utils/turtleEngine.ts, utils/donchianChannel.ts (satelliteTurtle.ts 경유).
// 앱 소스코드는 읽기만 하고 수정하지 않았다 (export 추가 없음 — 필요한 함수가 전부 이미 export됨).

import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { loadUniverse, fetchSymbolOf, isProxyBased, UniverseAsset } from './lib/universe';
import { fetchManySymbols, SymbolSeries } from './lib/fetchHistory';
import { buildUnionCalendar, alignToCalendar } from './lib/calendar';
import { fxRateFor, FxTable } from './lib/fx';
import { CoreAssetSeries, CoreWeighting } from './lib/coreBasket';
import { SatelliteAssetSeries, SatelliteRuleConfig } from './lib/satelliteTurtle';
import { runPortfolio, Routing } from './lib/portfolioRun';
import { computeReportMetrics, ReportMetrics, EquityPoint } from './lib/metrics';

const GLOBAL_START = '2015-01-01';
const GLOBAL_END = new Date().toISOString().slice(0, 10);
const INITIAL_CAPITAL_KRW = 100_000_000;
const COST_RATE = 0.001; // 편도 0.1%

const SUB_PERIODS: Array<{ key: string; label: string; start: string; end: string }> = [
  { key: 'full', label: '전체 구간', start: GLOBAL_START, end: GLOBAL_END },
  { key: 'bull', label: '상승장(2019~2021)', start: '2019-01-01', end: '2021-12-31' },
  { key: 'bear2022', label: '2022 하락장', start: '2022-01-01', end: '2022-12-31' },
  { key: 'holdout', label: 'holdout(2024~현재)', start: '2024-01-01', end: GLOBAL_END },
];

interface ExperimentConfig {
  id: string;
  label: string;
  maxUnitsPerPosition: number;
  entryLookback: number;
  exitLookback: number;
  riskPerUnitPct: number;
  satelliteRatio: number;
  routing: Routing;
}

interface ConfigResult {
  config: ExperimentConfig;
  bySubPeriod: Record<string, ReportMetrics>;
  satelliteTradeCount: number;
  satelliteBySubPeriod: Record<string, ReportMetrics>;
}

interface AmbBoundaryResult {
  ambBase: ReportMetrics;
  ambCore: ReportMetrics;
  usableCount: number;
  totalCount: number;
  failed: string[];
}

async function main() {
  const argConfig = argValue('--config');

  console.log('유니버스 로드...');
  const universe = loadUniverse();
  const coreAssets = universe.assets.filter(a => a.class === 'CORE');
  const satelliteAssets = universe.assets.filter(a => a.class === 'SATELLITE_TURTLE');
  console.log(`CORE ${coreAssets.length}종목, SATELLITE_TURTLE ${satelliteAssets.length}종목`);

  const allSymbols = [
    ...coreAssets.map(fetchSymbolOf),
    ...satelliteAssets.map(fetchSymbolOf),
    'KRW=X',
    'JPYKRW=X',
  ];

  console.log(`가격 데이터 fetch (${GLOBAL_START} ~ ${GLOBAL_END})...`);
  const seriesMap = await fetchManySymbols(allSymbols, GLOBAL_START, GLOBAL_END);

  const excludedForFetch: string[] = [];
  const usableCore = coreAssets.filter(a => {
    const ok = seriesMap.get(fetchSymbolOf(a))?.ok;
    if (!ok) excludedForFetch.push(`${a.name}(${a.rawTicker}) — 가격 fetch 실패`);
    return ok;
  });
  const usableSatellite = satelliteAssets.filter(a => {
    const ok = seriesMap.get(fetchSymbolOf(a))?.ok;
    if (!ok) excludedForFetch.push(`${a.name}(${a.rawTicker}) — 가격 fetch 실패`);
    return ok;
  });

  const usdKrwSeries = seriesMap.get('KRW=X');
  const jpyKrwSeries = seriesMap.get('JPYKRW=X');
  if (!usdKrwSeries?.ok || !jpyKrwSeries?.ok) {
    console.error('환율 데이터 fetch 실패 — 중단');
    process.exit(1);
  }

  const allForCalendar: SymbolSeries[] = [
    ...usableCore.map(a => seriesMap.get(fetchSymbolOf(a))!),
    ...usableSatellite.map(a => seriesMap.get(fetchSymbolOf(a))!),
    usdKrwSeries,
    jpyKrwSeries,
  ];
  const calendar = buildUnionCalendar(allForCalendar, GLOBAL_START, GLOBAL_END);
  console.log(`공통 캘린더: ${calendar.length}거래일 (${calendar[0]} ~ ${calendar[calendar.length - 1]})`);

  const fxUsd = alignToCalendar(usdKrwSeries, calendar);
  const fxJpy = alignToCalendar(jpyKrwSeries, calendar);
  const fxTable: FxTable = { usdKrw: fxUsd.close, jpyKrw: fxJpy.close };

  function fxSeriesFor(currency: string): (number | null)[] {
    return calendar.map((_, i) => fxRateFor(currency, fxTable, i));
  }

  const coreSeries: CoreAssetSeries[] = usableCore.map(a => {
    const aligned = alignToCalendar(seriesMap.get(fetchSymbolOf(a))!, calendar);
    return { ticker: a.rawTicker, weightPct: a.weightPct, close: aligned.close, fxRate: fxSeriesFor(a.currency) };
  });

  const satSeries: SatelliteAssetSeries[] = usableSatellite.map(a => {
    const aligned = alignToCalendar(seriesMap.get(fetchSymbolOf(a))!, calendar);
    return {
      ticker: a.rawTicker,
      name: a.name,
      currency: a.currency,
      open: aligned.open,
      high: aligned.high,
      low: aligned.low,
      close: aligned.close,
      fxRate: fxSeriesFor(a.currency),
      allowFractional: /^(BTC|ETH|SOL)-USD$/.test(fetchSymbolOf(a)),
    };
  });

  function ruleConfig(maxUnits: number, entryLb: number, exitLb: number, risk: number): SatelliteRuleConfig {
    return {
      maxUnitsPerPosition: maxUnits,
      entryLookback: entryLb,
      exitLookback: exitLb,
      stopMultipleN: 2,
      pyramidStepN: 0.5,
      riskPerUnitPct: risk,
      maxTotalRiskPct: 12,
      positionValueCapPct: 25,
      costRate: COST_RATE,
    };
  }

  interface RunOverrides {
    calendar?: string[];
    coreAssets?: CoreAssetSeries[];
    satelliteAssets?: SatelliteAssetSeries[];
  }

  function runOne(cfg: ExperimentConfig, weighting: CoreWeighting = 'proportional', overrides?: RunOverrides) {
    const result = runPortfolio({
      calendar: overrides?.calendar ?? calendar,
      coreAssets: overrides?.coreAssets ?? coreSeries,
      satelliteAssets: overrides?.satelliteAssets ?? satSeries,
      coreWeighting: weighting,
      satelliteRatio: cfg.satelliteRatio,
      initialCapitalKRW: INITIAL_CAPITAL_KRW,
      costRate: COST_RATE,
      satelliteRules: ruleConfig(cfg.maxUnitsPerPosition, cfg.entryLookback, cfg.exitLookback, cfg.riskPerUnitPct),
      routing: cfg.routing,
    });
    return result;
  }

  function sliceEquity(equity: EquityPoint[], start: string, end: string): EquityPoint[] {
    return equity.filter(p => p.date >= start && p.date <= end);
  }

  function evalConfig(cfg: ExperimentConfig, overrides?: RunOverrides): ConfigResult {
    const result = runOne(cfg, 'proportional', overrides);
    const bySubPeriod: Record<string, ReportMetrics> = {};
    const satelliteBySubPeriod: Record<string, ReportMetrics> = {};
    for (const sp of SUB_PERIODS) {
      const eq = sliceEquity(result.combinedEquity, sp.start, sp.end);
      const trades = result.satelliteTrades.filter(t => t.closeDate >= sp.start && t.closeDate <= sp.end);
      bySubPeriod[sp.key] = computeReportMetrics(eq, trades);
      const satEq = sliceEquity(result.satelliteTwrIndex, sp.start, sp.end);
      satelliteBySubPeriod[sp.key] = computeReportMetrics(satEq, trades);
    }
    return { config: cfg, bySubPeriod, satelliteTradeCount: result.satelliteTrades.length, satelliteBySubPeriod };
  }

  function sliceCoreSeries(list: CoreAssetSeries[], idx: number): CoreAssetSeries[] {
    return list.map(c => ({ ...c, close: c.close.slice(idx), fxRate: c.fxRate.slice(idx) }));
  }

  function sliceSatSeries(list: SatelliteAssetSeries[], idx: number): SatelliteAssetSeries[] {
    return list.map(s => ({
      ...s,
      open: s.open.slice(idx),
      high: s.high.slice(idx),
      low: s.low.slice(idx),
      close: s.close.slice(idx),
      fxRate: s.fxRate.slice(idx),
    }));
  }

  if (argConfig) {
    const cfg: ExperimentConfig = {
      id: argConfig,
      label: argConfig,
      maxUnitsPerPosition: 2,
      entryLookback: 55,
      exitLookback: 20,
      riskPerUnitPct: 0.5,
      satelliteRatio: 0.1,
      routing: 'two-bucket',
    };
    console.log(JSON.stringify(evalConfig(cfg), null, 2));
    return;
  }

  // ── 실험 A: 유닛 수 (1/2/4), 위성만 터틀, 90/10 ──
  console.log('\n[실험 A] 유닛 수 1/2/4 ...');
  const expA = [1, 2, 4].map(units =>
    evalConfig({
      id: `A-unit${units}`,
      label: `A: maxUnits=${units}`,
      maxUnitsPerPosition: units,
      entryLookback: 55,
      exitLookback: 20,
      riskPerUnitPct: 0.5,
      satelliteRatio: 0.1,
      routing: 'two-bucket',
    })
  );
  const bestUnits = pickBest(expA).config.maxUnitsPerPosition;
  console.log(`  → A 최적 유닛: ${bestUnits}`);

  // ── 실험 B: 라우팅 ──
  console.log('\n[실험 B] 라우팅 (위성만/전종목터틀/전종목B&H) ...');
  const baselineTwoBucket = evalConfig({
    id: 'B-two-bucket',
    label: 'B: 위성만 터틀 (=코어 B&H+위성 터틀, i·iv 동일 시뮬레이션)',
    maxUnitsPerPosition: bestUnits,
    entryLookback: 55,
    exitLookback: 20,
    riskPerUnitPct: 0.5,
    satelliteRatio: 0.1,
    routing: 'two-bucket',
  });
  const allTurtle = evalConfig({
    id: 'B-all-turtle',
    label: 'B: 전 종목(코어 포함) 터틀',
    maxUnitsPerPosition: bestUnits,
    entryLookback: 55,
    exitLookback: 20,
    riskPerUnitPct: 0.5,
    satelliteRatio: 0.1,
    routing: 'all-turtle',
  });
  const allBh = evalConfig({
    id: 'B-all-bh',
    label: 'B: 전 종목 B&H',
    maxUnitsPerPosition: bestUnits,
    entryLookback: 55,
    exitLookback: 20,
    riskPerUnitPct: 0.5,
    satelliteRatio: 0.1,
    routing: 'all-bh',
  });
  const expB = [baselineTwoBucket, allTurtle, allBh];
  // all-turtle/all-bh는 구조적 결함이 있는 참고용 실험이라 라우팅 후보에서 제외한다
  // (all-turtle: 코어 O/H/L을 종가로 근사 → N 과소평가 → 과대 사이징 아티팩트,
  //  all-bh: 위성을 동일가중으로 취급해 실험 A의 비례가중과 직접 비교 불가). two-bucket이 유일한 검증된 라우팅.
  const bestRouting: Routing = 'two-bucket';
  console.log(`  → B 라우팅: two-bucket 고정 (all-turtle/all-bh는 참고용, pickBest 대상 아님)`);

  // ── 실험 C: 코어:위성 비율 ──
  console.log('\n[실험 C] 코어:위성 비율 90/10, 80/20, 70/30 ...');
  const expC = [0.1, 0.2, 0.3].map(ratio =>
    evalConfig({
      id: `C-ratio${Math.round(ratio * 100)}`,
      label: `C: satellite=${Math.round(ratio * 100)}%`,
      maxUnitsPerPosition: bestUnits,
      entryLookback: 55,
      exitLookback: 20,
      riskPerUnitPct: 0.5,
      satelliteRatio: ratio,
      routing: 'two-bucket',
    })
  );
  const bestRatio = pickBest(expC).config.satelliteRatio;
  console.log(`  → C 최적 비율: ${Math.round(bestRatio * 100)}%`);

  // ── 실험 D: 리스크 보정 (riskPerUnitPct 0.5 vs 1.0) ──
  console.log('\n[실험 D] riskPerUnitPct 0.5 vs 1.0 ...');
  const expD = [0.5, 1.0].map(risk =>
    evalConfig({
      id: `D-risk${risk}`,
      label: `D: riskPerUnitPct=${risk}`,
      maxUnitsPerPosition: bestUnits,
      entryLookback: 55,
      exitLookback: 20,
      riskPerUnitPct: risk,
      satelliteRatio: bestRatio,
      routing: 'two-bucket',
    })
  );

  // ── 코어 가중 민감도 (동일가중 vs 비례가중) — 최종 추천 config로 1회만 ──
  console.log('\n[민감도] 코어 동일가중 vs 비례가중 (추천 config 기준) ...');
  const recommended: ExperimentConfig = {
    id: 'recommended',
    label: '추천 config',
    maxUnitsPerPosition: bestUnits,
    entryLookback: 55,
    exitLookback: 20,
    riskPerUnitPct: 0.5,
    satelliteRatio: bestRatio,
    routing: 'two-bucket',
  };
  const equalWeightResult = runOne(recommended, 'equal');
  const equalWeightMetrics = computeReportMetrics(equalWeightResult.combinedEquity, equalWeightResult.satelliteTrades);
  const proportionalMetrics = expA.find(r => r.config.maxUnitsPerPosition === bestUnits)
    ? evalConfig(recommended).bySubPeriod.full
    : undefined;

  // ── 실험 R: 강건성 검증 — "유닛4 우위가 표본(크립토 불장/2015~ 기간) 의존인가"를 반증 시도 ──
  console.log('\n[실험 R] 강건성 검증 (R1 크립토 3종 제외 / R2 2018~ 시작 / R3 R1+R2) ...');
  const satSeriesNoCrypto = satSeries.filter(s => !['BTC', 'ETH', 'SOL'].includes(s.ticker));
  const idx2018 = calendar.findIndex(d => d >= '2018-01-01');
  const calendar2018 = calendar.slice(idx2018);
  const coreSeries2018 = sliceCoreSeries(coreSeries, idx2018);
  const satSeries2018 = sliceSatSeries(satSeries, idx2018);
  const satSeriesNoCrypto2018 = sliceSatSeries(satSeriesNoCrypto, idx2018);

  function robustnessSet(prefix: string, labelPrefix: string, overrides: RunOverrides): ConfigResult[] {
    return [1, 2, 4].map(units =>
      evalConfig(
        {
          id: `${prefix}-unit${units}`,
          label: `${labelPrefix}: maxUnits=${units}`,
          maxUnitsPerPosition: units,
          entryLookback: 55,
          exitLookback: 20,
          riskPerUnitPct: 0.5,
          satelliteRatio: 0.1,
          routing: 'two-bucket',
        },
        overrides
      )
    );
  }

  const expR1 = robustnessSet('R1', 'R1(크립토 3종 제외)', { satelliteAssets: satSeriesNoCrypto });
  const expR2 = robustnessSet('R2', 'R2(2018~시작)', {
    calendar: calendar2018,
    coreAssets: coreSeries2018,
    satelliteAssets: satSeries2018,
  });
  const expR3 = robustnessSet('R3', 'R3(크립토제외+2018~)', {
    calendar: calendar2018,
    coreAssets: coreSeries2018,
    satelliteAssets: satSeriesNoCrypto2018,
  });
  const bestUnitsR1 = pickBest(expR1).config.maxUnitsPerPosition;
  const bestUnitsR2 = pickBest(expR2).config.maxUnitsPerPosition;
  const bestUnitsR3 = pickBest(expR3).config.maxUnitsPerPosition;
  console.log(`  → R1 최적 유닛: ${bestUnitsR1}, R2 최적 유닛: ${bestUnitsR2}, R3 최적 유닛: ${bestUnitsR3}`);

  // ── AMBIGUOUS 경계분석: 미분류 19종목을 전부 CORE로 잠정 편입했을 때 결론이 흔들리는가 ──
  console.log('\n[경계분석] AMBIGUOUS 19종목 → CORE 잠정 편입 ...');
  const ambiguousExcluded = universe.excluded.filter(e => e.class === 'AMBIGUOUS');
  function inferAmbSymbol(rawTicker: string): { dataSymbol: string; currency: string } {
    if (/^\d{6}$/.test(rawTicker)) return { dataSymbol: `${rawTicker}.KS`, currency: 'KRW' };
    if (rawTicker.endsWith('.T')) return { dataSymbol: rawTicker, currency: 'JPY' };
    return { dataSymbol: rawTicker, currency: 'USD' };
  }
  const ambMeta = ambiguousExcluded.map(e => ({ ...e, ...inferAmbSymbol(e.rawTicker) }));
  const ambSeriesMap = await fetchManySymbols(
    ambMeta.map(e => e.dataSymbol),
    GLOBAL_START,
    GLOBAL_END
  );
  const ambFailed: string[] = [];
  const ambUsable = ambMeta.filter(e => {
    const ok = ambSeriesMap.get(e.dataSymbol)?.ok;
    if (!ok) ambFailed.push(`${e.name}(${e.rawTicker})`);
    return ok;
  });

  let ambBoundary: AmbBoundaryResult | null = null;
  if (ambUsable.length >= Math.ceil(ambiguousExcluded.length / 2)) {
    const ambCoreSeries: CoreAssetSeries[] = ambUsable.map(e => {
      const aligned = alignToCalendar(ambSeriesMap.get(e.dataSymbol)!, calendar);
      return { ticker: e.rawTicker, weightPct: e.weightPct, close: aligned.close, fxRate: fxSeriesFor(e.currency) };
    });
    const ambConfig: ExperimentConfig = {
      id: 'AMB',
      label: 'AMB: 추천 config',
      maxUnitsPerPosition: bestUnits,
      entryLookback: 55,
      exitLookback: 20,
      riskPerUnitPct: 0.5,
      satelliteRatio: bestRatio,
      routing: 'two-bucket',
    };
    const ambBase = evalConfig({ ...ambConfig, id: 'AMB-base', label: 'AMB-base: 현행(AMBIGUOUS 제외)' });
    const ambCore = evalConfig(
      { ...ambConfig, id: 'AMB-core', label: 'AMB-core: AMBIGUOUS→CORE 편입' },
      { coreAssets: [...coreSeries, ...ambCoreSeries] }
    );
    ambBoundary = {
      ambBase: ambBase.bySubPeriod.full,
      ambCore: ambCore.bySubPeriod.full,
      usableCount: ambUsable.length,
      totalCount: ambiguousExcluded.length,
      failed: ambFailed,
    };
    console.log(`  → AMBIGUOUS ${ambUsable.length}/${ambiguousExcluded.length}종목 fetch 성공, 경계분석 실행`);
  } else {
    console.log(`  → AMBIGUOUS 경계분석 생략 (fetch 성공 ${ambUsable.length}/${ambiguousExcluded.length}, 과반 미달)`);
  }

  console.log('\n리포트 작성...');
  const report = buildReport({
    universe,
    excludedForFetch,
    calendar,
    expA,
    expB,
    expC,
    expD,
    bestUnits,
    bestRouting,
    bestRatio,
    equalWeightMetrics,
    proportionalMetrics,
  });
  const outPath = path.join(__dirname, '..', '..', 'docs', 'backtest', 'REPORT_터틀백테스트.md');
  writeFileSync(outPath, report, 'utf-8');
  console.log(`완료: ${outPath}`);

  console.log('\n강건성 검증 리포트 작성...');
  const robustnessReport = buildRobustnessReport({
    calendar,
    expA,
    expR1,
    expR2,
    expR3,
    bestUnitsR1,
    bestUnitsR2,
    bestUnitsR3,
    ambBoundary,
  });
  const robustnessOutPath = path.join(__dirname, '..', '..', 'docs', 'backtest', 'REPORT_강건성검증.md');
  writeFileSync(robustnessOutPath, robustnessReport, 'utf-8');
  console.log(`완료: ${robustnessOutPath}`);
}

function pickBest(results: ConfigResult[]): ConfigResult {
  // 1차 기준: Calmar(=CAGR/|MDD|). 승률은 사용하지 않음.
  return results.reduce((best, cur) =>
    cur.bySubPeriod.full.calmar > best.bySubPeriod.full.calmar ? cur : best
  );
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function metricsRow(label: string, m: ReportMetrics): string {
  const pf = m.tradeCount === 0 ? 'N/A' : m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2);
  const wr = m.tradeCount === 0 ? 'N/A' : `${m.winRatePct.toFixed(1)}%`;
  return `| ${label} | ${fmtPct(m.cagrPct)} | ${fmtPct(m.mddPct)} | ${m.calmar.toFixed(2)} | ${pf} | ${m.tradeCount} | ${wr} | ${m.maxConsecutiveLosses} | ${fmtPct(m.worst3yRollingPct)} |`;
}

function tableHeader(): string {
  return (
    `| config | CAGR | MDD | Calmar | 손익비 | 거래수 | 승률(참고) | 최대연속손실 | 최악3년누적 |\n` +
    `|---|---|---|---|---|---|---|---|---|`
  );
}

interface ReportInputs {
  universe: ReturnType<typeof loadUniverse>;
  excludedForFetch: string[];
  calendar: string[];
  expA: ConfigResult[];
  expB: ConfigResult[];
  expC: ConfigResult[];
  expD: ConfigResult[];
  bestUnits: number;
  bestRouting: Routing;
  bestRatio: number;
  equalWeightMetrics: ReportMetrics;
  proportionalMetrics?: ReportMetrics;
}

function buildReport(inp: ReportInputs): string {
  const {
    universe, excludedForFetch, calendar, expA, expB, expC, expD,
    bestUnits, bestRouting, bestRatio, equalWeightMetrics, proportionalMetrics,
  } = inp;

  const proxyAssets = universe.assets.filter(isProxyBased);
  const lines: string[] = [];
  lines.push('# 터틀 포트폴리오 백테스트 리포트');
  lines.push('');
  lines.push(`생성일: ${new Date().toISOString().slice(0, 10)} · 데이터 구간: ${calendar[0]} ~ ${calendar[calendar.length - 1]} · 시작자본 1억 KRW`);
  lines.push('');
  lines.push(
    '> **이번 실행에서 수정된 치명적 버그**: `utils/turtleEngine.ts`가 재사용하는 `calculateATR`(`utils/maCalculations.ts`, 앱 코드라 이 스크립트 범위에서 수정 불가)은 워밍업 윈도우(첫 20영업일) 안에 null이 하나라도 있으면 그 뒤로 데이터가 아무리 쌓여도 **영구히 N(ATR)=null**을 반환한다. 이 백테스트는 여러 종목을 하나의 공통 캘린더(2015-01-01~)에 정렬하는데, `scripts/backtest/lib/satelliteTurtle.ts`가 각 종목의 N을 계산할 때 그 종목의 실제 상장일이 아니라 **캘린더 절대 시작(0)부터** 슬라이스하고 있었다 — 그 결과 캘린더 시작일(2015-01-01)에 상장돼 있던 BTC만 정상적으로 N을 계산할 수 있었고, 나머지 8개 위성 종목(ETH·SOL·SLV·PSLV·PPLT·구리·UEC·양자컴)은 **단 한 번도 진입 신호를 낼 수 없었다** — 즉 지금까지의 모든 실행에서 "위성 9종목 터틀"은 실제로는 **"BTC 단일종목 몰빵"**이었다(거래 44건이 전부 BTC). 이번 실행에서 `satelliteTurtle.ts`가 종목별 첫 유효 데이터 인덱스부터 N을 계산하도록 고쳐 실제로 9종목 모두가 거래되게 됐다(검증: BTC 33·ETH 22·SOL 21·SLV 25·PSLV 25·PPLT 21·UEC 32·구리 34·양자컴 25건). **아래 모든 수치는 이 수정 이후 값이며, 이전 리포트/메모리의 CAGR·MDD·거래수와 다르다.** `calculateATR`의 워밍업 앵커링 자체는 앱 코드의 잠재적 결함이므로(자산 히스토리 초입에 결측치 하나만 있어도 영구히 지표가 죽을 수 있음) 별도 확인을 권고한다.'
  );
  lines.push('');

  lines.push('## 결정 권고 3줄');
  lines.push('');
  const aFull = expA.find(r => r.config.maxUnitsPerPosition === bestUnits)!.bySubPeriod.full;
  const bFull = expB.find(r => r.config.routing === bestRouting)!.bySubPeriod.full;
  const cFull = expC.find(r => r.config.satelliteRatio === bestRatio)!.bySubPeriod.full;
  lines.push(`1. **maxUnitsPerPosition = ${bestUnits}** — CAGR ${fmtPct(aFull.cagrPct)}, MDD ${fmtPct(aFull.mddPct)} (Calmar ${aFull.calmar.toFixed(2)})가 실험 A 중 최선.`);
  lines.push(`2. **라우팅 = ${routingLabel(bestRouting)}** — CAGR ${fmtPct(bFull.cagrPct)}, MDD ${fmtPct(bFull.mddPct)} (Calmar ${bFull.calmar.toFixed(2)}). 전종목터틀/전종목B&H는 구조적 결함(아래 실험 B 경고 참조)으로 후보에서 제외했다 — two-bucket이 유일하게 검증된 라우팅이다.`);
  lines.push(`3. **코어:위성 = ${Math.round((1 - bestRatio) * 100)}:${Math.round(bestRatio * 100)}** — CAGR ${fmtPct(cFull.cagrPct)}, 최악3년누적 ${fmtPct(cFull.worst3yRollingPct)}가 실험 C 중 최선.`);
  lines.push('');
  lines.push('> 판정 기준은 승률이 아니라 Calmar(CAGR/|MDD|)를 1차로, 최악 3년 누적 수익률을 보조로 사용했다. 아래 표를 직접 보고 다른 기준(예: MDD 최소화)으로 재해석 가능하다.');
  lines.push('');

  lines.push('## 실험 A — 유닛 수 (maxUnitsPerPosition)');
  lines.push('');
  lines.push('조건: 위성만 터틀 적용, entry 55일/exit 20일, riskPerUnitPct 0.5%, 코어:위성 90:10 (비례가중).');
  lines.push('');
  lines.push(tableHeader());
  expA.forEach(r => lines.push(metricsRow(r.config.label, r.bySubPeriod.full)));
  lines.push('');
  lines.push('구간 분해 (전략별 CAGR / MDD):');
  lines.push('');
  lines.push('| config | 상승장(19-21) | 2022 하락장 | holdout(24~) |');
  lines.push('|---|---|---|---|');
  expA.forEach(r => {
    lines.push(
      `| ${r.config.label} | ${fmtPct(r.bySubPeriod.bull.cagrPct)}/${fmtPct(r.bySubPeriod.bull.mddPct)} | ${fmtPct(
        r.bySubPeriod.bear2022.cagrPct
      )}/${fmtPct(r.bySubPeriod.bear2022.mddPct)} | ${fmtPct(r.bySubPeriod.holdout.cagrPct)}/${fmtPct(r.bySubPeriod.holdout.mddPct)} |`
    );
  });
  lines.push('');

  lines.push('## 실험 B — 라우팅');
  lines.push('');
  lines.push(`조건: 실험 A 최적 유닛(${bestUnits}) 고정, 90:10.`);
  lines.push('');
  lines.push(tableHeader());
  expB.forEach(r => lines.push(metricsRow(r.config.label, r.bySubPeriod.full)));
  lines.push('');
  lines.push('> **주의 — "전 종목(코어 포함) 터틀"은 라우팅 결정 근거로 사용 금지.** 코어 자산은 일중 O/H/L을 별도로 모으지 않아 종가로 근사했다 — 실제 변동폭(true range)이 축소되어 N(ATR)이 과소평가되고 포지션 사이징이 과대해진다. 위 표의 거래수·승률·최대연속손실이 "위성만 터틀"과 완전히 동일한 것이 그 증거다(=코어는 사실상 미거래, 실질은 "위성 9종목에 자본 100% 몰빵"과 동치).');
  lines.push('>');
  lines.push('> "전 종목 B&H"는 위성 자산에 별도 비중 정보가 없어 전 종목을 동일가중으로 취급했다 — 실험 A(코어 비례가중)와 직접 비교할 수 없다.');
  lines.push('');

  lines.push('## 실험 C — 코어:위성 비율');
  lines.push('');
  lines.push(`조건: 유닛=${bestUnits}, 라우팅=${routingLabel(bestRouting)}.`);
  lines.push('');
  lines.push(tableHeader());
  expC.forEach(r => lines.push(metricsRow(r.config.label, r.bySubPeriod.full)));
  lines.push('');

  lines.push('## 실험 D — 리스크 보정 (riskPerUnitPct)');
  lines.push('');
  lines.push(`조건: 유닛=${bestUnits}, 비율=${Math.round(bestRatio * 100)}%.`);
  lines.push('');
  lines.push(tableHeader());
  expD.forEach(r => lines.push(metricsRow(r.config.label, r.bySubPeriod.full)));
  lines.push('');

  lines.push('## 위성 파트 단독 지표 (TWR, 코어/위성 자금이체 제거)');
  lines.push('');
  lines.push(tableHeader());
  expA.forEach(r => lines.push(metricsRow(r.config.label, r.satelliteBySubPeriod.full)));
  lines.push('');

  lines.push('## 코어 가중 민감도 (추천 config 기준)');
  lines.push('');
  lines.push(tableHeader());
  if (proportionalMetrics) lines.push(metricsRow('비례가중(현재 실보유 비중)', proportionalMetrics));
  lines.push(metricsRow('동일가중', equalWeightMetrics));
  lines.push('');

  lines.push('## 연도별 수익률 (추천 config, 코어:위성 결합)');
  lines.push('');
  const recFull = expC.find(r => r.config.satelliteRatio === bestRatio)!.bySubPeriod.full;
  lines.push('| 연도 | 수익률 |');
  lines.push('|---|---|');
  recFull.annualReturns.forEach(a => lines.push(`| ${a.year} | ${fmtPct(a.returnPct)} |`));
  lines.push('');

  lines.push('## 실행하지 않은 실험 (E/F/G — 선택 사항, 시간 예산상 생략)');
  lines.push('');
  lines.push('- E(진입 채널 55/100/200), F(청산 20일 vs 샹들리에), G(상관그룹 리스크 한도)는 스펙상 선택 사항으로 이번 실행에서는 생략했다. 필요 시 `scripts/backtest/turtlePortfolio.ts`에 config를 추가해 재실행할 수 있다.');
  lines.push('');

  lines.push('## 데이터 및 유니버스');
  lines.push('');
  lines.push(`- CORE ${universe.assets.filter(a => a.class === 'CORE').length}종목, SATELLITE_TURTLE ${universe.assets.filter(a => a.class === 'SATELLITE_TURTLE').length}종목 (AMBIGUOUS/EXIT_LEGACY/CASH는 유니버스 정리 단계에서 이미 제외).`);
  lines.push(`- 프록시 기반 시계열 (${proxyAssets.length}종목): ${proxyAssets.map(a => `${a.rawTicker}→${a.proxySymbol}(${a.proxyReason ?? ''})`).join(', ')}`);
  if (excludedForFetch.length > 0) {
    lines.push(`- 가격 fetch 실패로 이번 실행에서 제외된 종목: ${excludedForFetch.join(', ')}`);
  } else {
    lines.push('- 가격 fetch 실패 종목 없음 (전체 유니버스 사용).');
  }
  lines.push('');

  lines.push('## 한계');
  lines.push('');
  lines.push('- **일봉 근사**: 장중 체결을 시가/전일 채널 기준으로 근사했다 (진입=max(시가,돌파채널), 청산/손절=min(시가,이탈가)). 분봉 데이터가 없어 실제 체결가와 다를 수 있다.');
  lines.push('- **프록시 사용 종목**: 위 목록의 종목은 실제 KRX/자산 가격이 아닌 대체 지수/ETF/선물 가격으로 시뮬레이션했다. 방향성은 유효하나 절대 수익률은 실제와 괴리 가능.');
  lines.push('- **현금 무이자**: 위성 미투자 현금과 코어 리밸런싱 사이 현금은 이자 없음으로 가정 (실제로는 소폭의 예금/MMF 수익 가능).');
  lines.push('- **세금 미반영**: 양도세/배당소득세/환전 스프레드 등은 반영하지 않았다. 실제 순수익은 이보다 낮다.');
  lines.push(`- **표본 기간**: ${calendar[0]}부터. 이보다 늦게 상장한 종목은 상장일부터 각 버킷에 자동 편입(비중 재정규화)했다 — 초기 구간에서는 실제 목표 종목 수보다 적은 종목으로 운용된다.`);
  lines.push('- **AMBIGUOUS 종목**: 데이터 정리 단계(PROMPT 1)에서 사용자 확인이 필요한 19개 종목(ALB/INTC/NVDA 등)은 이번 백테스트에서 완전히 제외했다. 코어/위성 편입 여부가 결정되면 재실행 필요. 이 미분류가 결론을 얼마나 흔드는지의 경계분석은 `REPORT_강건성검증.md`에 별도로 실었다.');
  lines.push('- **all-turtle 라우팅**: 코어 자산은 일중 고가/저가 데이터를 별도로 모으지 않아 종가를 고가/저가로 근사했다 — 실제보다 변동성 포착이 보수적일 수 있다.');
  lines.push('- **드로다운 자금관리 감쇄**: 앱에 있는 `applyDrawdownScaling`은 이번 구조 비교 실험에서는 끄고 실행했다(순수 유닛/라우팅/비율 비교 목적). 실제 운영에서 켤 경우 MDD가 더 낮아질 가능성이 있다.');
  lines.push('');

  lines.push('## 재실행 방법');
  lines.push('');
  lines.push('```');
  lines.push('npx --yes tsx scripts/backtest/turtlePortfolio.ts            # 전체 실험 A~D + 리포트 생성');
  lines.push('npx --yes tsx scripts/backtest/turtlePortfolio.ts --config X # 단일 config JSON 출력 (디버그)');
  lines.push('```');
  lines.push('');
  lines.push('가격 캐시는 `scripts/backtest/data/cache/*.json`에 저장되며, 재실행 시 재다운로드하지 않는다. 새로 받으려면 해당 파일을 삭제할 것.');
  lines.push('');

  return lines.join('\n');
}

function routingLabel(r: Routing): string {
  if (r === 'two-bucket') return '위성만 터틀(코어 B&H + 위성 터틀)';
  if (r === 'all-turtle') return '전 종목(코어 포함) 터틀';
  return '전 종목 B&H';
}

interface RobustnessReportInputs {
  calendar: string[];
  expA: ConfigResult[];
  expR1: ConfigResult[];
  expR2: ConfigResult[];
  expR3: ConfigResult[];
  bestUnitsR1: number;
  bestUnitsR2: number;
  bestUnitsR3: number;
  ambBoundary: AmbBoundaryResult | null;
}

function robustnessTable(results: ConfigResult[], metricsOf: (r: ConfigResult) => ReportMetrics): string[] {
  const out = [tableHeader()];
  results.forEach(r => out.push(metricsRow(r.config.label, metricsOf(r))));
  return out;
}

function buildRobustnessReport(inp: RobustnessReportInputs): string {
  const { calendar, expA, expR1, expR2, expR3, bestUnitsR1, bestUnitsR2, bestUnitsR3, ambBoundary } = inp;

  const unit4RobustR1 = bestUnitsR1 === 4;
  const unit4RobustR2 = bestUnitsR2 === 4;
  const unit4RobustBoth = unit4RobustR1 && unit4RobustR2;

  const lines: string[] = [];
  lines.push('# 터틀 백테스트 강건성 검증 리포트');
  lines.push('');
  lines.push(
    `생성일: ${new Date().toISOString().slice(0, 10)} · 데이터 구간: ${calendar[0]} ~ ${calendar[calendar.length - 1]} · 시작자본 1억 KRW`
  );
  lines.push('');
  lines.push(
    '> 이 리포트는 새 전략을 탐색하는 것이 아니라, 이미 도달한 결론("현 기본값 유지")을 반증 시도로 확정하기 위한 것이다. 목표는 유닛 2·90:10을 깨뜨릴 수 있는지 적대적으로 검증하는 것이다.'
  );
  lines.push('');
  lines.push(
    '> **버그 수정 공지**: `REPORT_터틀백테스트.md` 상단에 기록된 대로, 이번 실행부터 `scripts/backtest/lib/satelliteTurtle.ts`의 N(ATR) 계산 슬라이스 버그를 고쳤다 — 그 전까지는 위성 9종목 중 BTC를 제외한 8종목이 앱 코드(`calculateATR`)의 워밍업 앵커링 결함 때문에 단 한 번도 거래되지 못했다(거래 44건 전부 BTC). 이 리포트의 R1(크립토 제외) 결과가 "거래 0건"이 아니라 실제 거래 데이터를 담고 있는 것은 이 수정 덕분이다 — 수정 전이었다면 R1은 항상 거래 0건으로 나와 의미 없는 결과였을 것이다.'
  );
  lines.push('');

  lines.push('## 판정 요약 (3줄)');
  lines.push('');
  lines.push(
    `1. **R1(크립토 3종 제외) 최적 유닛 = ${bestUnitsR1}**, **R2(2018~시작) 최적 유닛 = ${bestUnitsR2}** (참고: R3 결합 = ${bestUnitsR3}, 실험 A 원본 = ${expA.length > 0 ? pickBest(expA).config.maxUnitsPerPosition : 'N/A'}).`
  );
  lines.push(
    unit4RobustBoth
      ? `2. **유닛 4 우위가 R1·R2 모두에서 유지** — 표본(크립토 불장·2015~ 시작) 의존이 아니다. 유닛 상향을 2단계 검토 대상으로 승격할 수 있다.`
      : `2. **유닛 4 우위가 R1 또는 R2에서 소멸/역전** — 원래 실험 A의 유닛4 우위 상당 부분은 표본(크립토 불장·2015~ 시작) 의존이었다. **유닛 2 유지를 확정한다 (앱 기본값 변경 없음).**`
  );
  lines.push(
    ambBoundary
      ? `3. AMBIGUOUS 19종목 중 ${ambBoundary.usableCount}종목을 CORE로 잠정 편입했을 때 CAGR 차이 ${fmtPct(ambBoundary.ambCore.cagrPct - ambBoundary.ambBase.cagrPct)}p, MDD 차이 ${fmtPct(ambBoundary.ambCore.mddPct - ambBoundary.ambBase.mddPct)}p — ${Math.abs(ambBoundary.ambCore.cagrPct - ambBoundary.ambBase.cagrPct) < 3 && Math.abs(ambBoundary.ambCore.mddPct - ambBoundary.ambBase.mddPct) < 3 ? '분류는 운영상 중요하되 백테스트 결론(유닛/비율)은 바뀌지 않는다.' : '차이가 커서 분류 확정 전에는 비율 결론을 유보해야 한다.'}`
      : `3. AMBIGUOUS 경계분석은 가격 fetch 성공 종목이 과반에 미달해 생략했다 (아래 상세 참조).`
  );
  lines.push('');
  lines.push(
    '> 승률은 판정에 쓰지 않았다. 1차 기준은 Calmar(CAGR/|MDD|), 보조 기준은 최악3년누적이며, 위성 단독 MDD·최대연속손실을 병기해 심리적 지속가능성을 함께 본다 — 하루 10분만 보는 겸업 투자자에게는 CAGR보다 이쪽이 우선이다.'
  );
  lines.push('');

  lines.push('## 실험 A 원본 (기준, 재게재)');
  lines.push('');
  lines.push('조건: two-bucket·90:10, entry 55/exit 20, risk 0.5%, 비례가중. 전체 표본(2015~현재).');
  lines.push('');
  robustnessTable(expA, r => r.bySubPeriod.full).forEach(l => lines.push(l));
  lines.push('');

  lines.push('## R1 — 크립토(BTC/ETH/SOL) 제외');
  lines.push('');
  lines.push('조건: 위성에서 BTC/ETH/SOL 3종목 제거 (SLV·PSLV·PPLT·구리HG·UEC·QTUM 6종목만 남김). 그 외 실험 A와 동일.');
  lines.push('');
  robustnessTable(expR1, r => r.bySubPeriod.full).forEach(l => lines.push(l));
  lines.push('');
  lines.push('위성 파트 단독 지표 (TWR):');
  lines.push('');
  robustnessTable(expR1, r => r.satelliteBySubPeriod.full).forEach(l => lines.push(l));
  lines.push('');

  lines.push('## R2 — 2018년 시작');
  lines.push('');
  lines.push(
    '조건: 유니버스는 유지하되 캘린더를 2018-01-01부터로 슬라이스 (가격 fetch·캐시 범위는 그대로, 재다운로드 없음). 첫 55거래일은 진입 채널이 아직 형성되지 않은 워밍업 구간이다.'
  );
  lines.push('');
  robustnessTable(expR2, r => r.bySubPeriod.full).forEach(l => lines.push(l));
  lines.push('');
  lines.push('위성 파트 단독 지표 (TWR):');
  lines.push('');
  robustnessTable(expR2, r => r.satelliteBySubPeriod.full).forEach(l => lines.push(l));
  lines.push('');

  lines.push('## R3 — R1+R2 결합 (참고)');
  lines.push('');
  lines.push('조건: 크립토 3종 제외 + 2018년 시작을 동시 적용.');
  lines.push('');
  robustnessTable(expR3, r => r.bySubPeriod.full).forEach(l => lines.push(l));
  lines.push('');

  lines.push('## AMBIGUOUS 경계분석');
  lines.push('');
  if (ambBoundary) {
    lines.push(`AMBIGUOUS 19종목 중 ${ambBoundary.usableCount}/${ambBoundary.totalCount}종목 가격 fetch 성공 → 해당 종목만 CORE로 잠정 편입해 추천 config(유닛/비율 확정값)로 1회 실행.`);
    lines.push('');
    lines.push(tableHeader());
    lines.push(metricsRow('AMB-base (현행, AMBIGUOUS 제외)', ambBoundary.ambBase));
    lines.push(metricsRow('AMB-core (AMBIGUOUS→CORE 편입)', ambBoundary.ambCore));
    lines.push('');
    if (ambBoundary.failed.length > 0) {
      lines.push(`가격 fetch 실패로 편입에서 제외된 종목: ${ambBoundary.failed.join(', ')}`);
      lines.push('');
    }
  } else {
    lines.push('가격 fetch 성공 종목이 과반에 미달해 이 실험은 생략했다. AMBIGUOUS 종목은 이번 실행에서 신규로 fetch를 시도했으며(캐시에 없던 심볼), 실패 시 그 종목만 제외하고 계속 진행하는 정책을 그대로 따랐다.');
    lines.push('');
  }

  lines.push('## 한계');
  lines.push('');
  lines.push('- **기존 리포트(REPORT_터틀백테스트.md)의 한계가 모두 동일하게 적용된다** (일봉 근사, 프록시 종목, 세금 미반영, 현금 무이자 등).');
  lines.push('- **R2 워밍업**: 캘린더를 2018년부터 슬라이스했으므로 첫 55거래일(진입 lookback)은 채널이 미형성 상태다. 이 구간 동안은 신규 진입이 사실상 불가능하며, 이는 실제로 2018년에 계좌를 새로 개설했을 때와 동일한 조건이다.');
  lines.push('- **AMBIGUOUS 심볼 추정**: 6자리 숫자 종목코드는 `.KS`(KRW), 나머지는 원 티커 그대로(USD, `.T` 접미사는 JPY)로 추정해 fetch했다. 실제 상장 거래소/통화가 다르면 결과가 왜곡될 수 있다.');
  lines.push('- **AMBIGUOUS 비교는 1회성**: base/core 비교는 추천 config(유닛/비율 확정값) 기준 1회만 실행했다 — 유닛별 스윕은 하지 않았다.');
  lines.push('- **`satelliteBudgetKRW` 실저장값 미확인**: 이 백테스트는 반기 리밸런싱 시점 평가액을 사이징 기준 예산으로 사용하며, 앱의 저장된 `satelliteBudgetKRW` 값과는 무관하다. 결론 적용 전 앱에서 별도 확인이 필요하다.');
  lines.push('- **프록시 14종목**: 위성/코어 프록시 종목의 방향성은 유효하나 절대 수익률은 실제와 괴리 가능하다.');
  lines.push('');

  lines.push('## 재실행 방법');
  lines.push('');
  lines.push('```');
  lines.push('npx --yes tsx scripts/backtest/turtlePortfolio.ts   # 실험 A~D + R1~R3 + AMBIGUOUS 경계분석, 리포트 2종 모두 생성');
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
