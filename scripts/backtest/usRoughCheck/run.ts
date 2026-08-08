// scripts/backtest/usRoughCheck/run.ts
// ---------------------------------------------------------------------------
// 미국 약식 사전점검 — 실행 드라이버.
//
// ⚠ 이 러너의 산출물은 **생존편향이 있는 약식 결과**다(universe.ts 상단 참조).
//   채택 근거로 쓸 수 없고, "유료 정밀검증에 투자할 가치가 있는지"를 가늠하는 용도다.
//
// 실행: npx tsx scripts/backtest/usRoughCheck/run.ts
// 산출: scripts/backtest/usRoughCheck/output/us_rough_check.json + 콘솔 요약
//
// 규칙: `any`·`Math.random` 금지. `console.*`는 이 파일(런너)에서만 허용.

// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildE1Events,
  buildE2Records,
  buildEntryPanel,
  buildRegimePanel,
  makeIndexLookup,
  periodOf,
  priceBucket,
  tertileSplit,
  volumeBucket,
  type EntryRecord,
} from './analysis';
import { buildUsRsRanks, smaInclusive as smaInclusiveBench, US_RS } from './rsUs';
import {
  bootstrapPairedDiff,
  bootstrapTwoGroupDiff,
  holmAdjust,
  mean,
  median,
  summarize,
  type DiffEstimate,
  type GroupEvent,
  MASTER_SEED,
  BOOTSTRAP_ITERATIONS,
} from './stats';
import { loadSp500Universe } from './universe';
import {
  BENCHMARK_SYMBOL,
  DATA_END,
  DATA_START,
  fetchUsMany,
  fetchUsSeries,
  type UsBars,
} from './usFetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output');

const PRIMARY_HORIZON = 63;
const LONG_HORIZON = 126;

interface HypothesisResult {
  code: string;
  label: string;
  /** 강의 주장 방향: 'A>B' = 그룹A가 더 높아야 강의 지지. */
  claimDirection: 'A>B' | 'A<B';
  groupALabel: string;
  groupBLabel: string;
  horizon: number;
  estimate: DiffEstimate;
  holmP?: number;
  matchesClaim: boolean;
  note: string;
}

function pct(x: number): string {
  return Number.isFinite(x) ? `${(x * 100).toFixed(2)}%` : 'n/a';
}

function fmtEstimate(e: DiffEstimate): string {
  return `${pct(e.point)} [95%CI ${pct(e.ciLower)}~${pct(e.ciUpper)}] p=${e.pValue.toFixed(4)} (nA=${e.nA}, nB=${e.nB})`;
}

async function main(): Promise<void> {
  const tStart = Date.now();
  console.log('='.repeat(78));
  console.log('미국 약식 사전점검 (생존편향 있음) — S&P500 현재 구성종목 · Yahoo v8 무료 데이터');
  console.log('='.repeat(78));

  // --- 1. 유니버스 -----------------------------------------------------------
  const snap = await loadSp500Universe(() => console.log('위키백과 조회 중...'));
  if (!snap) {
    console.error('유니버스 확보 실패 — 중단');
    process.exit(1);
    return;
  }
  console.log(`\n[1] 유니버스: ${snap.symbols.length}종목 (출처 ${snap.source}, 스냅샷 ${snap.fetchedAt})`);

  // --- 2. 데이터 -------------------------------------------------------------
  const bench = await fetchUsSeries(BENCHMARK_SYMBOL, DATA_START, DATA_END, false);
  if (!bench.ok) {
    console.error(`벤치마크 ${BENCHMARK_SYMBOL} 수집 실패: ${bench.error}`);
    process.exit(1);
    return;
  }
  const fetched = await fetchUsMany(snap.symbols, DATA_START, DATA_END);
  console.log(
    `[2] 데이터: 성공 ${fetched.bars.size} / 실패 ${fetched.failures.length} ` +
      `(네트워크 ${fetched.networkCount}건, ${(fetched.elapsedMs / 1000).toFixed(1)}초)`
  );
  if (fetched.failures.length > 0) {
    console.log(`    실패: ${fetched.failures.map((f) => `${f.symbol}(${f.error})`).join(', ')}`);
  }

  // 데이터 길이가 너무 짧은 종목(RS 계산 불가)은 통계에서 자연 제외되지만, 카운트는 보고한다.
  let shortHistory = 0;
  const barsMap = new Map<string, UsBars>();
  for (const [sym, bars] of fetched.bars.entries()) {
    if (bars.dates.length < US_RS.minBarsForR252 + 2) shortHistory++;
    barsMap.set(sym, bars);
  }
  console.log(`    벤치마크 ${BENCHMARK_SYMBOL}: ${bench.dates.length}일 (${bench.dates[0]}~${bench.dates[bench.dates.length - 1]})`);
  console.log(`    252바 미만(RS 계산 불가) 종목: ${shortHistory}`);

  const index = makeIndexLookup(bench.dates, bench.adjClose);

  // --- 3. RS 랭킹 ------------------------------------------------------------
  const tRs = Date.now();
  const ranks = buildUsRsRanks(barsMap, DATA_END);
  console.log(
    `\n[3] RS 랭킹: 캘린더 ${ranks.calendar.length}일 · 랭킹생성 ${ranks.daysRanked}일 · ` +
      `적격 평균 ${ranks.avgEligible.toFixed(1)}종목(min ${ranks.minEligible} / max ${ranks.maxEligible}) · ` +
      `${((Date.now() - tRs) / 1000).toFixed(1)}초`
  );

  const panel = buildEntryPanel(barsMap, ranks, index);
  const entries = panel.entries;
  const devEntries = entries.filter((e) => periodOf(e.date) === 'dev');
  const valEntries = entries.filter((e) => periodOf(e.date) === 'val');
  console.log(
    `[4] RS90 진입 이벤트: ${entries.length}건 (고유 ${new Set(entries.map((e) => e.symbol)).size}종목) · ` +
      `개발(2010-2019) ${devEntries.length} / 검증(2020-2022) ${valEntries.length} · ` +
      `첫 진입 ${entries[0]?.date ?? 'n/a'}`
  );

  const results: HypothesisResult[] = [];

  // =========================================================================
  // H-RS90: 진입 코호트 기준선 — 진입 자체가 시장을 이겼는가
  // =========================================================================
  const cohortPaired = entries
    .map((e) => ({ date: e.date, diff: e.excess[LONG_HORIZON] }))
    .filter((x): x is { date: string; diff: number } => x.diff !== null && x.diff !== undefined);
  const cohortEst = bootstrapPairedDiff(cohortPaired, MASTER_SEED + 1, 'median');
  const cohortVals126 = cohortPaired.map((x) => x.diff);
  const cohortVals63 = entries
    .map((e) => e.excess[PRIMARY_HORIZON])
    .filter((v): v is number => v !== null && v !== undefined);
  results.push({
    code: 'RS90',
    label: 'RS90 진입 코호트 126일 시장초과수익 중앙값 ≠ 0',
    claimDirection: 'A>B',
    groupALabel: 'RS90 진입 코호트',
    groupBLabel: '시장(0)',
    horizon: LONG_HORIZON,
    estimate: cohortEst,
    matchesClaim: cohortEst.point > 0,
    note: '강의는 RS90 진입 자체를 매수 후보로 본다 → 중앙값이 양수여야 지지.',
  });

  const summary126 = summarize(cohortVals126);
  const summary63 = summarize(cohortVals63);
  const cohortByPeriod = {
    dev: summarize(devEntries.map((e) => e.excess[LONG_HORIZON]).filter((v): v is number => v !== null)),
    val: summarize(valEntries.map((e) => e.excess[LONG_HORIZON]).filter((v): v is number => v !== null)),
  };

  // =========================================================================
  // B3: S&P500 200일선 레짐
  // =========================================================================
  const regimeLevel = buildRegimePanel(bench, barsMap, 'US200_LEVEL', LONG_HORIZON);
  const regimeSlope = buildRegimePanel(bench, barsMap, 'US200_SLOPE', LONG_HORIZON);
  const toRegimeEvents = (days: typeof regimeLevel): GroupEvent[] =>
    days
      .filter((d) => d.equalWeightForward !== null)
      .map((d) => ({
        date: d.date,
        group: d.risk ? ('A' as const) : ('B' as const),
        value: d.equalWeightForward as number,
      }));
  const b3Events = toRegimeEvents(regimeLevel);
  const b3Est = bootstrapTwoGroupDiff(b3Events, MASTER_SEED + 2, 'mean');
  const b3SlopeEst = bootstrapTwoGroupDiff(toRegimeEvents(regimeSlope), MASTER_SEED + 3, 'mean');

  // B3 보조 — **생존편향 없는** 측정: 결과변수를 ^GSPC 지수 자체의 126일 전방수익으로 둔다.
  // 500종목 등가중 결과변수는 "오늘까지 살아남은 종목"만 담고 있어 하락 레짐 뒤 회복이
  // 사후적으로 보장돼 있다. 지수 레벨은 그런 편향이 없다(당시 실제 구성종목의 가중 결과).
  const b3IndexEvents: GroupEvent[] = [];
  for (let i = 0; i < bench.dates.length; i++) {
    const ma = smaInclusiveBench(bench.adjClose, i, 200);
    if (ma === null) continue;
    const fwd = i + LONG_HORIZON < bench.adjClose.length
      ? bench.adjClose[i + LONG_HORIZON] / bench.adjClose[i] - 1
      : null;
    if (fwd === null) continue;
    b3IndexEvents.push({
      date: bench.dates[i],
      group: bench.adjClose[i] < ma ? 'A' : 'B',
      value: fwd,
    });
  }
  const b3IndexEst = bootstrapTwoGroupDiff(b3IndexEvents, MASTER_SEED + 10, 'mean');
  results.push({
    code: 'B3',
    label: 'S&P500 200일선 아래 레짐에서 미국주식 126일 등가중 수익이 더 나쁘다',
    claimDirection: 'A<B',
    groupALabel: '위험(종가<MA200)',
    groupBLabel: '정상(종가≥MA200)',
    horizon: LONG_HORIZON,
    estimate: b3Est,
    matchesClaim: b3Est.point < 0,
    note: 'MA200은 당일 종가 포함(한국 D1과 동일 규약). 전방수익도 같은 종가에서 시작 → 룩어헤드 없음.',
  });

  // =========================================================================
  // E1: RS 90 → 50 미만
  // =========================================================================
  const e1 = buildE1Events(panel, barsMap, index, PRIMARY_HORIZON);
  const e1Est = bootstrapPairedDiff(
    e1.events.map((e) => ({ date: e.date, diff: e.diff })),
    MASTER_SEED + 4,
    'median'
  );
  const e1Long = buildE1Events(panel, barsMap, index, LONG_HORIZON);
  const e1LongEst = bootstrapPairedDiff(
    e1Long.events.map((e) => ({ date: e.date, diff: e.diff })),
    MASTER_SEED + 5,
    'median'
  );
  results.push({
    code: 'E1',
    label: 'RS 90→50 미만 하락 후 63일 성과가 코호트(미하락) 대비 부진하다 → 매도',
    claimDirection: 'A<B',
    groupALabel: 'RS<50 하락 종목',
    groupBLabel: '같은 코호트 미하락(not-yet-treated)',
    horizon: PRIMARY_HORIZON,
    estimate: e1Est,
    matchesClaim: e1Est.point < 0,
    note: `경고 발생률 ${(e1.warnRate * 100).toFixed(1)}% (진입 ${e1.totalEntries}건 중). 코호트 매칭 = 한국 A12(H7)와 동일 방법론.`,
  });

  // =========================================================================
  // E2: 50~70 밴드 50거래일 미회복
  // =========================================================================
  const e2 = buildE2Records(panel, barsMap, index);
  const mkE2 = (h: number): GroupEvent[] =>
    e2.records
      .filter((r) => r.excess[h] !== null)
      .map((r) => ({ date: r.date, group: r.stalled ? ('A' as const) : ('B' as const), value: r.excess[h] as number }));
  const e2Est = bootstrapTwoGroupDiff(mkE2(PRIMARY_HORIZON), MASTER_SEED + 6, 'mean');
  const e2LongEst = bootstrapTwoGroupDiff(mkE2(LONG_HORIZON), MASTER_SEED + 7, 'mean');
  results.push({
    code: 'E2',
    label: 'RS 50~70 밴드에서 50거래일간 70 미회복 종목이 회복 종목보다 부진하다 → 교체',
    claimDirection: 'A<B',
    groupALabel: '정체(70 미회복)',
    groupBLabel: '회복(≥70 도달)',
    horizon: PRIMARY_HORIZON,
    estimate: e2Est,
    matchesClaim: e2Est.point < 0,
    note: `밴드 진입 ${e2.bandEntries}건 중 평가일 확보 ${e2.records.length}건. 한국식 엄격정의(연속 50일 체류) 이벤트 = ${e2.strictStallCount}건.`,
  });

  // =========================================================================
  // E3: 절대주가 $1~10 VIP
  // =========================================================================
  const e3Usable = entries.filter((e) => e.excess[LONG_HORIZON] !== null && e.priceAtEntry > 0);
  const e3Events: GroupEvent[] = e3Usable.map((e) => ({
    date: e.date,
    group: e.priceAtEntry >= 1 && e.priceAtEntry <= 10 ? ('A' as const) : ('B' as const),
    value: e.excess[LONG_HORIZON] as number,
  }));
  const e3Est = bootstrapTwoGroupDiff(e3Events, MASTER_SEED + 8, 'mean');
  results.push({
    code: 'E3',
    label: 'RS90 진입 시 절대주가 $1~10 종목이 $10 초과 종목보다 126일 성과가 좋다(VIP)',
    claimDirection: 'A>B',
    groupALabel: '$1~10',
    groupBLabel: '>$10',
    horizon: LONG_HORIZON,
    estimate: e3Est,
    matchesClaim: e3Est.point > 0,
    note: '⚠ Yahoo raw close는 분할조정되어 있어 과거 명목주가가 소급 하향된다(나중에 분할한 종목일수록 과거가 싸 보임). E3는 이 편향에 직접 노출된다.',
  });

  const priceBuckets = new Map<string, number[]>();
  for (const e of e3Usable) {
    const b = priceBucket(e.priceAtEntry);
    const arr = priceBuckets.get(b) ?? [];
    arr.push(e.excess[LONG_HORIZON] as number);
    priceBuckets.set(b, arr);
  }
  // E3 집중도 진단: "$1~10" 그룹이 소수 종목·특정 연도에 몰려 있으면 통계가 사실상 사례 몇 건이다.
  const e3Vip = e3Usable.filter((e) => e.priceAtEntry >= 1 && e.priceAtEntry <= 10);
  const e3VipBySymbol = new Map<string, number>();
  const e3VipByYear = new Map<string, number>();
  for (const e of e3Vip) {
    e3VipBySymbol.set(e.symbol, (e3VipBySymbol.get(e.symbol) ?? 0) + 1);
    const y = e.date.slice(0, 4);
    e3VipByYear.set(y, (e3VipByYear.get(y) ?? 0) + 1);
  }
  const e3VipTopSymbols = [...e3VipBySymbol.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  // =========================================================================
  // E4: 거래량 폭발 우대(한국과 정반대 검증)
  // =========================================================================
  const e4Usable = entries.filter(
    (e): e is EntryRecord & { volumeExcess60: number } =>
      e.volumeExcess60 !== null && e.excess[LONG_HORIZON] !== null
  );
  const e4Sorted = [...e4Usable].sort((a, b) =>
    a.volumeExcess60 !== b.volumeExcess60
      ? a.volumeExcess60 - b.volumeExcess60
      : a.date < b.date
        ? -1
        : a.date > b.date
          ? 1
          : a.symbol < b.symbol
            ? -1
            : 1
  );
  const e4T = tertileSplit(e4Sorted, (e) => e.volumeExcess60);
  const e4Events: GroupEvent[] = [
    ...e4T.high.map((e) => ({ date: e.date, group: 'A' as const, value: e.excess[LONG_HORIZON] as number })),
    ...e4T.low.map((e) => ({ date: e.date, group: 'B' as const, value: e.excess[LONG_HORIZON] as number })),
  ];
  const e4Est = bootstrapTwoGroupDiff(e4Events, MASTER_SEED + 9, 'mean');
  results.push({
    code: 'E4',
    label: '진입 전 60일 거래량 폭발 상위 1/3이 하위 1/3보다 126일 성과가 좋다(미국은 거래량 폭발이 好)',
    claimDirection: 'A>B',
    groupALabel: '거래량폭발 상위1/3',
    groupBLabel: '거래량폭발 하위1/3',
    horizon: LONG_HORIZON,
    estimate: e4Est,
    matchesClaim: e4Est.point > 0,
    note: '한국 Q6_VOLUME_EXCESS_60D는 "낮을수록 우수"(상위−하위 = -10.83%)가 개발표본 생존. 미국이 반대면 강의 지지.',
  });

  const e4Tertiles = {
    low: summarize(e4T.low.map((e) => e.excess[LONG_HORIZON] as number)),
    mid: summarize(e4T.mid.map((e) => e.excess[LONG_HORIZON] as number)),
    high: summarize(e4T.high.map((e) => e.excess[LONG_HORIZON] as number)),
    lowRange: e4T.low.length ? [e4T.low[0].volumeExcess60, e4T.low[e4T.low.length - 1].volumeExcess60] : [],
    highRange: e4T.high.length ? [e4T.high[0].volumeExcess60, e4T.high[e4T.high.length - 1].volumeExcess60] : [],
  };
  const volumeMultBuckets = new Map<string, number[]>();
  for (const e of entries) {
    if (e.volumeMultiple === null || e.excess[LONG_HORIZON] === null) continue;
    const b = volumeBucket(e.volumeMultiple);
    const arr = volumeMultBuckets.get(b) ?? [];
    arr.push(e.excess[LONG_HORIZON] as number);
    volumeMultBuckets.set(b, arr);
  }

  // =========================================================================
  // Holm 보정(6개 주검정 하나의 패밀리)
  // =========================================================================
  const holm = holmAdjust(results.map((r) => r.estimate.pValue));
  results.forEach((r, i) => {
    r.holmP = holm[i];
  });

  // =========================================================================
  // 콘솔 보고
  // =========================================================================
  console.log('\n[5] RS90 코호트 기준선');
  console.log(
    `    126일 초과: n=${summary126.n} 평균 ${pct(summary126.mean)} 중앙 ${pct(summary126.median)} ` +
      `Q25 ${pct(summary126.q25)} Q75 ${pct(summary126.q75)} 양(+)비율 ${(summary126.positiveShare * 100).toFixed(1)}%`
  );
  console.log(
    `     63일 초과: n=${summary63.n} 평균 ${pct(summary63.mean)} 중앙 ${pct(summary63.median)}`
  );
  console.log(
    `    개발 중앙 ${pct(cohortByPeriod.dev.median)}(n=${cohortByPeriod.dev.n}) / 검증 중앙 ${pct(cohortByPeriod.val.median)}(n=${cohortByPeriod.val.n})`
  );

  console.log('\n[6] 가설별 결과');
  for (const r of results) {
    console.log(`  ${r.code.padEnd(5)} ${r.matchesClaim ? '방향일치' : '방향불일치'}  ${fmtEstimate(r.estimate)}  HolmP=${(r.holmP ?? 1).toFixed(4)}`);
    console.log(`        ${r.label}`);
  }
  console.log(`\n  B3 보조변형 US200_SLOPE: ${fmtEstimate(b3SlopeEst)} (Holm 패밀리 제외)`);
  console.log(`  B3 보조 — 지수자체(^GSPC 126일, 생존편향 없음): ${fmtEstimate(b3IndexEst)}`);
  console.log(`  E1 126일: ${fmtEstimate(e1LongEst)}`);
  console.log(`  E2 126일: ${fmtEstimate(e2LongEst)}`);

  console.log('\n[7] E3 가격 구간별 126일 초과(중앙값)');
  for (const b of ['<$1', '$1-10', '$10-20', '$20-50', '$50-100', '>$100']) {
    const arr = priceBuckets.get(b);
    if (!arr || arr.length === 0) {
      console.log(`    ${b.padEnd(9)} n=0`);
      continue;
    }
    console.log(`    ${b.padEnd(9)} n=${String(arr.length).padStart(5)} 중앙 ${pct(median(arr))} 평균 ${pct(mean(arr))}`);
  }
  console.log(
    `    $1~10 그룹 집중도: 고유 ${e3VipBySymbol.size}종목 · 상위 ` +
      `${e3VipTopSymbols.map(([s, c]) => `${s}(${c})`).join(' ')}`
  );
  console.log(
    `    $1~10 연도분포: ${[...e3VipByYear.entries()].sort().map(([y, c]) => `${y}:${c}`).join(' ')}`
  );

  console.log('\n[8] E4 거래량폭발 3분위 126일 초과');
  console.log(`    하위1/3 n=${e4Tertiles.low.n} 중앙 ${pct(e4Tertiles.low.median)} 평균 ${pct(e4Tertiles.low.mean)}`);
  console.log(`    중간1/3 n=${e4Tertiles.mid.n} 중앙 ${pct(e4Tertiles.mid.median)} 평균 ${pct(e4Tertiles.mid.mean)}`);
  console.log(`    상위1/3 n=${e4Tertiles.high.n} 중앙 ${pct(e4Tertiles.high.median)} 평균 ${pct(e4Tertiles.high.mean)}`);
  console.log('    진입 당일 거래량 배수 구간별(한국 팩터패널과 동일 경계):');
  for (const b of ['<1x', '1-2x', '2-5x', '>=5x']) {
    const arr = volumeMultBuckets.get(b);
    if (!arr || arr.length === 0) {
      console.log(`      ${b.padEnd(5)} n=0`);
      continue;
    }
    console.log(`      ${b.padEnd(5)} n=${String(arr.length).padStart(5)} 중앙 ${pct(median(arr))}`);
  }

  const regimeRiskDays = regimeLevel.filter((d) => d.risk).length;
  console.log(
    `\n[9] B3 레짐 일수: 위험 ${regimeRiskDays} / 정상 ${regimeLevel.length - regimeRiskDays} ` +
      `(총 ${regimeLevel.length}일, 종목 평균 ${(mean(regimeLevel.map((d) => d.stockCount))).toFixed(0)}종목/일)`
  );

  // =========================================================================
  // JSON 산출
  // =========================================================================
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    warning:
      '생존편향 있는 약식 검증(S&P500 현재 구성종목 · Yahoo v8 무료). 최종 채택 근거로 사용 금지.',
    universe: {
      source: snap.source,
      snapshotAt: snap.fetchedAt,
      requested: snap.symbols.length,
      collected: fetched.bars.size,
      failures: fetched.failures,
      shortHistory,
    },
    data: {
      start: DATA_START,
      end: DATA_END,
      benchmark: BENCHMARK_SYMBOL,
      benchmarkDays: bench.dates.length,
      fetchElapsedSec: Number((fetched.elapsedMs / 1000).toFixed(1)),
    },
    rs: {
      formula: 'rsRaw = 0.40*R21 + 0.20*R63 + 0.20*R126 + 0.20*R252 (adj_close)',
      calendarDays: ranks.calendar.length,
      daysRanked: ranks.daysRanked,
      avgEligible: Number(ranks.avgEligible.toFixed(2)),
      minEligible: ranks.minEligible,
      maxEligible: ranks.maxEligible,
      minDollarVolume: US_RS.minDollarVolume,
    },
    entries: {
      total: entries.length,
      uniqueSymbols: new Set(entries.map((e) => e.symbol)).size,
      dev: devEntries.length,
      val: valEntries.length,
      firstDate: entries[0]?.date ?? null,
      lastDate: entries[entries.length - 1]?.date ?? null,
    },
    cohortBaseline: {
      h126: summary126,
      h63: summary63,
      byPeriod: cohortByPeriod,
    },
    hypotheses: results,
    secondary: {
      b3Slope: b3SlopeEst,
      b3IndexOnly: b3IndexEst,
      e1H126: e1LongEst,
      e2H126: e2LongEst,
      e2StrictStallCount: e2.strictStallCount,
      e2BandEntries: e2.bandEntries,
      e1WarnRate: e1.warnRate,
    },
    e3PriceBuckets: Object.fromEntries(
      [...priceBuckets.entries()].map(([k, v]) => [k, summarize(v)])
    ),
    e3VipConcentration: {
      uniqueSymbols: e3VipBySymbol.size,
      topSymbols: e3VipTopSymbols,
      byYear: Object.fromEntries([...e3VipByYear.entries()].sort()),
    },
    e4: {
      tertiles: e4Tertiles,
      volumeMultipleBuckets: Object.fromEntries(
        [...volumeMultBuckets.entries()].map(([k, v]) => [k, summarize(v)])
      ),
    },
    b3: {
      riskDays: regimeRiskDays,
      normalDays: regimeLevel.length - regimeRiskDays,
      totalDays: regimeLevel.length,
    },
    statistics: {
      masterSeed: MASTER_SEED,
      bootstrapIterations: BOOTSTRAP_ITERATIONS,
      blockCalendarDays: 84,
      holmApplied: true,
      holmFamilySize: results.length,
    },
    elapsedSec: Number(((Date.now() - tStart) / 1000).toFixed(1)),
  };
  const outFile = path.join(OUT_DIR, 'us_rough_check.json');
  writeFileSync(outFile, JSON.stringify(payload, null, 2));
  console.log(`\n[10] JSON 저장: ${outFile}`);
  console.log(`총 소요 ${payload.elapsedSec}초`);
}

main().catch((e) => {
  console.error('RUN ERROR:', e);
  process.exit(1);
});
