// scripts/backtest/bondRole/run.ts
// 채권 역할(bond-role) 연구 백테스트 — 한국형 올웨더 포트폴리오, 채권 포함(A) vs 채권 제외(B).
// 최근 3년(2023-07-24 ~ 2026-07-24) 정적배분 + 반기 리밸런싱 비교.
// 연구 전용(앱/백엔드 무접촉). 실행: npx tsx scripts/backtest/bondRole/run.ts
//
// 데이터: Yahoo v8 배당/분할 수정(총수익) 종가(캐시 우선). USD 자산은 Yahoo KRW=X(원/달러)로 환산.
// 시뮬레이터: lib/coreBasket.CoreBasketSim(정적배분+반기 리밸런싱, all-bh 패턴).

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchMany, type AdjSeries } from './lib/yahooData';
import { buildUnionCalendar, alignAdjCloseToCalendar, firstValidIndex } from './lib/align';
import { CoreBasketSim, type CoreAssetSeries } from '../lib/coreBasket';
import { semiAnnualRebalanceIndices } from '../lib/rebalanceDates';
import { cagr, maxDrawdown, annualReturns, type EquityPoint } from '../lib/metrics';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const START = '2023-07-24';
const END = '2026-07-24';
const FX_SYMBOL = 'KRW=X'; // Yahoo: 원/달러 (KRW per 1 USD)
const COST_RATE = 0.001; // 편도 거래비용률 (프로젝트 관례, phase2/turtlePortfolio 와 동일)
const INITIAL_KRW = 100_000_000; // 두 시나리오 동일 시작금액
const TRADING_DAYS = 252;
const OUTPUT_PATH = path.join(__dirname, 'output', 'result.json');

type Currency = 'KRW' | 'USD';

interface Leg {
  key: string; // 한글 다리 이름
  intended: string; // 원래 의도한 KRX/해외 상품
  ticker: string; // 실제 사용 티커
  currency: Currency;
  rawWeight: number; // GRVT 재분배 반영 원비중(16개 합 = 62.5)
  isBond: boolean;
  note?: string; // 대체/가정 설명
}

// ── 채권 티어 GRVT(4.0%) 재분배: 한국채(4.0)·미국채(4.5)에 pro-rata, 티어 합 12.5 유지 ──
const KR_BOND_RAW = 4.0 + 4.0 * (4.0 / 8.5); // ≈ 5.882353
const US_BOND_RAW = 4.5 + 4.0 * (4.5 / 8.5); // ≈ 6.617647

// 원비중(합 62.5). 현금 티어(GRVT 17%/USDT/CMA)는 백테스트에서 전면 제외(Advisor 결정).
const LEGS: Leg[] = [
  { key: '선진국 주식', intended: 'iShares MSCI EAFE', ticker: 'EFA', currency: 'USD', rawWeight: 12.5, isBond: false },
  { key: '한국 주식', intended: 'KODEX 200', ticker: '069500.KS', currency: 'KRW', rawWeight: 5.0, isBond: false },
  {
    key: '미국 주식-가치주',
    intended: 'KIWOOM 미국원유에너지기업(US 에너지)',
    ticker: 'XLE',
    currency: 'USD',
    rawWeight: 2.5,
    isBond: false,
    note: 'KIWOOM 미국원유에너지기업(한국상장)의 직접 총수익 히스토리 확보가 어렵고 브리프가 XLE 프록시를 지정 → XLE(US 에너지 섹터) 대체.',
  },
  {
    key: '미국 주식-성장주',
    intended: 'KODEX 미국나스닥100(379810)',
    ticker: '379810.KS',
    currency: 'KRW',
    rawWeight: 2.5,
    isBond: false,
    note: 'KODEX 미국나스닥100 (KRX 379810, 2021-04 상장, 무헤지 TR) — 창 전체 커버. 한국투자자 실제 보유형태(원화표시)라 QQQ 폴백보다 충실.',
  },
  { key: '이스라엘 주식', intended: 'iShares MSCI Israel', ticker: 'EIS', currency: 'USD', rawWeight: 2.5, isBond: false },
  {
    key: '중국주식(CSI300)',
    intended: 'KODEX 차이나CSI300(283580)',
    ticker: '283580.KS',
    currency: 'KRW',
    rawWeight: 4.0,
    isBond: false,
    note: 'KODEX 차이나CSI300 (KRX 283580, 2017-11 상장) — 창 전체 커버.',
  },
  {
    key: '중국주식(항셍테크)',
    intended: 'KODEX 차이나항셍테크(372330)',
    ticker: '372330.KS',
    currency: 'KRW',
    rawWeight: 2.0,
    isBond: false,
    note: 'KODEX 차이나항셍테크 (KRX 372330, 2021-08 상장) — 창 전체 커버.',
  },
  { key: '칠레 주식', intended: 'iShares MSCI Chile', ticker: 'ECH', currency: 'USD', rawWeight: 2.5, isBond: false },
  { key: '브라질 주식', intended: 'iShares MSCI Brazil', ticker: 'EWZ', currency: 'USD', rawWeight: 2.0, isBond: false },
  { key: '인도네시아 주식', intended: 'iShares MSCI Indonesia', ticker: 'EIDO', currency: 'USD', rawWeight: 2.0, isBond: false },
  {
    key: '한국채권',
    intended: 'RISE KIS국고채30년Enhanced(385560)',
    ticker: '385560.KS',
    currency: 'KRW',
    rawWeight: KR_BOND_RAW,
    isBond: true,
    note: 'RISE(구 KBSTAR) KIS국고채30년Enhanced (KRX 385560, 2021-05 상장) — 창 전체 커버. GRVT 4.0% pro-rata 흡수 후 원비중 4.0→5.882.',
  },
  {
    key: '미국채권',
    intended: 'PLUS 미국채30년액티브(464470)',
    ticker: 'TLT',
    currency: 'USD',
    rawWeight: US_BOND_RAW,
    isBond: true,
    note: 'PLUS 미국채30년액티브(KRX 464470)는 2023-08-22 상장으로 창 시작(2023-07-24)을 커버 못함 → TLT(20년+ 미국채) 대체. GRVT 4.0% pro-rata 흡수 후 원비중 4.5→6.618.',
  },
  {
    key: '금',
    intended: 'ACE KRX금현물(411060)',
    ticker: '411060.KS',
    currency: 'KRW',
    rawWeight: 6.0,
    isBond: false,
    note: 'ACE KRX금현물 (KRX 411060, 2021-12 상장) — 창 전체 커버.',
  },
  {
    key: '은',
    intended: 'TIGER 은액티브(0189B0)',
    ticker: 'SLV',
    currency: 'USD',
    rawWeight: 3.0,
    isBond: false,
    note: 'TIGER 은액티브(KRX 0189B0)는 2026-04-28 상장으로 히스토리 부재 → SLV(은 현물) 대체.',
  },
  {
    key: '구리',
    intended: 'TIGER 구리실물(160580)',
    ticker: '160580.KS',
    currency: 'KRW',
    rawWeight: 1.5,
    isBond: false,
    note: 'TIGER 구리실물 (KRX 160580, 2012-12 상장) — 창 전체 커버.',
  },
  { key: '우라늄', intended: 'Global X Uranium', ticker: 'URA', currency: 'USD', rawWeight: 2.0, isBond: false },
];

const RAW_SUM = LEGS.reduce((s, l) => s + l.rawWeight, 0); // 62.5
const RENORM = RAW_SUM / 100; // 0.625

interface ResolvedLeg extends Leg {
  weightPctA: number; // 시나리오 A 비중(합 100)
  weightPctB: number; // 시나리오 B 비중(채권 제외 후 재분배, 합 100; 채권 다리는 0)
}

function resolveWeights(): ResolvedLeg[] {
  // A: 전체 재정규화 (÷0.625 → 합 100)
  const withA = LEGS.map(l => ({ ...l, weightPctA: l.rawWeight / RENORM, weightPctB: 0 }));
  // B: 채권 제거 후 남은 비중을 pro-rata 확대 (× 1/(1-bondFrac))
  const bondFrac = withA.filter(l => l.isBond).reduce((s, l) => s + l.weightPctA, 0) / 100;
  const scaleB = 1 / (1 - bondFrac);
  return withA.map(l => ({ ...l, weightPctB: l.isBond ? 0 : l.weightPctA * scaleB }));
}

// ── 시뮬레이션: all-bh(정적 바스켓 + 반기 리밸런싱) ──
function simulate(assets: CoreAssetSeries[], calendar: string[]): EquityPoint[] {
  const sim = new CoreBasketSim(assets, 'proportional', COST_RATE);
  const reb = new Set(semiAnnualRebalanceIndices(calendar));
  const equity: EquityPoint[] = [];
  for (let t = 0; t < calendar.length; t++) {
    if (t === 0 || reb.has(t)) {
      sim.rebalanceTo(t, t === 0 ? INITIAL_KRW : sim.currentValueKRW(t));
    }
    equity.push({ date: calendar[t], value: sim.currentValueKRW(t) });
  }
  return equity;
}

// ── 지표 ──
interface Metrics {
  cagrPct: number;
  mddPct: number;
  mddTroughDate: string | null;
  annualizedVolPct: number;
  sharpe: number; // rf=0
  finalValueKRW: number;
  calendarYearReturns: Array<{ year: string; returnPct: number }>;
}

function mddTrough(equity: EquityPoint[]): { mdd: number; date: string | null } {
  let peak = -Infinity;
  let mdd = 0;
  let date: string | null = null;
  for (const p of equity) {
    if (p.value > peak) peak = p.value;
    if (peak > 0) {
      const dd = (p.value - peak) / peak;
      if (dd < mdd) {
        mdd = dd;
        date = p.date;
      }
    }
  }
  return { mdd, date };
}

function annualizedVolAndSharpe(equity: EquityPoint[]): { volPct: number; sharpe: number } {
  const rets: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1].value;
    if (prev > 0) rets.push(equity[i].value / prev - 1);
  }
  if (rets.length < 2) return { volPct: 0, sharpe: 0 };
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1); // 표본분산
  const std = Math.sqrt(variance);
  const annVol = std * Math.sqrt(TRADING_DAYS);
  // Sharpe(rf=0) = 연율화 산술평균수익 / 연율화 변동성 = mean/std * sqrt(252)
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(TRADING_DAYS) : 0;
  return { volPct: annVol * 100, sharpe };
}

function computeMetrics(equity: EquityPoint[]): Metrics {
  const c = cagr(equity);
  const { mdd, date } = mddTrough(equity);
  const { volPct, sharpe } = annualizedVolAndSharpe(equity);
  // 교차검증: metrics.maxDrawdown 과 동일해야 함
  const mddCheck = maxDrawdown(equity);
  if (Math.abs(mddCheck - mdd) > 1e-9) {
    console.warn(`  [경고] MDD 불일치: scan=${mdd} vs metrics=${mddCheck}`);
  }
  return {
    cagrPct: c * 100,
    mddPct: mdd * 100,
    mddTroughDate: date,
    annualizedVolPct: volPct,
    sharpe,
    finalValueKRW: equity[equity.length - 1]?.value ?? 0,
    calendarYearReturns: annualReturns(equity),
  };
}

function fmtKRW(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}

async function main(): Promise<void> {
  console.log('='.repeat(88));
  console.log('채권 역할 백테스트 — 한국형 올웨더: 채권 포함(A) vs 채권 제외(B)');
  console.log(`구간: ${START} ~ ${END}  |  소스: Yahoo v8 수정종가(총수익)  |  환산: KRW=X(원/달러)`);
  console.log(`정적배분 + 반기(1/7월) 리밸런싱  |  편도비용 ${COST_RATE}  |  시작금액 ${fmtKRW(INITIAL_KRW)} KRW`);
  console.log('='.repeat(88));

  const resolved = resolveWeights();
  const bondFracA = resolved.filter(l => l.isBond).reduce((s, l) => s + l.weightPctA, 0);
  console.log(`\n원비중 합=${RAW_SUM.toFixed(4)} (÷${RENORM} 로 재정규화). A 채권비중=${bondFracA.toFixed(4)}%`);

  // 데이터 로드 (시나리오 A 전 티커 + FX)
  const tickers = Array.from(new Set(resolved.map(l => l.ticker)));
  const allSymbols = [...tickers, FX_SYMBOL];
  console.log('\n[1/4] 데이터 로드(전용 캐시)...');
  const seriesMap = await fetchMany(allSymbols, START, END);

  // 필수 데이터 실패 검사
  const failed = allSymbols.filter(s => !(seriesMap.get(s)?.ok));
  if (failed.length > 0) {
    console.error(`\n[치명] 조회 실패 티커: ${failed.join(', ')} — 무음 대체 금지, 중단.`);
    process.exit(1);
  }
  const fxSeries = seriesMap.get(FX_SYMBOL)!;

  // 유니온 캘린더 (시나리오 A 전 티커 기준; B는 A의 부분집합이므로 동일 창 사용 → 직접 비교 가능)
  console.log('\n[2/4] 캘린더 정렬 + 데이터 가용성 점검...');
  const aSeriesList: AdjSeries[] = tickers.map(t => seriesMap.get(t)!);
  const unionCal = buildUnionCalendar([...aSeriesList, fxSeries], START, END);

  // 각 티커 정렬 종가 + FX 정렬
  const alignedClose = new Map<string, (number | null)[]>();
  for (const t of tickers) alignedClose.set(t, alignAdjCloseToCalendar(seriesMap.get(t)!, unionCal));
  const alignedFx = alignAdjCloseToCalendar(fxSeries, unionCal);

  // 공통 시작 = 모든 A 티커 + FX 의 첫 유효 인덱스의 최댓값
  let commonStart = firstValidIndex(alignedFx);
  for (const t of tickers) commonStart = Math.max(commonStart, firstValidIndex(alignedClose.get(t)!));
  if (commonStart < 0) {
    console.error('[치명] 공통 시작 인덱스를 찾지 못함.');
    process.exit(1);
  }
  const calendar = unionCal.slice(commonStart);

  // 데이터 가용성 리포트 (원시 첫/마지막 날짜, 창 시작 커버 여부)
  const dataAvailability = tickers.map(t => {
    const s = seriesMap.get(t)!;
    const firstDate = s.dates[0] ?? null;
    const lastDate = s.dates[s.dates.length - 1] ?? null;
    return {
      ticker: t,
      intended: resolved.find(l => l.ticker === t)?.intended ?? '',
      ok: s.ok,
      firstDate,
      lastDate,
      coversWindowStart: !!firstDate && firstDate <= START,
    };
  });
  console.log(`  유니온 거래일 ${unionCal.length} → 공통구간 ${calendar.length}일 (${calendar[0]} ~ ${calendar[calendar.length - 1]})`);
  console.log(`  FX(${FX_SYMBOL}): ${fxSeries.dates[0]} ~ ${fxSeries.dates[fxSeries.dates.length - 1]}`);
  for (const d of dataAvailability) {
    const flag = d.coversWindowStart ? '' : '  ⚠ 창 시작 미커버';
    console.log(`    ${d.ticker.padEnd(11)} ${d.firstDate} ~ ${d.lastDate}${flag}`);
  }
  const notCovering = dataAvailability.filter(d => !d.coversWindowStart);
  if (notCovering.length > 0) {
    console.log(`  ※ 창 시작(${START}) 이후 상장 티커: ${notCovering.map(d => d.ticker).join(', ')} — 공통구간이 그만큼 늦게 시작.`);
  }

  // CoreAssetSeries 빌더 (공통구간으로 슬라이스, KRW→fx=1 / USD→KRW=X)
  function buildAssets(weightKey: 'weightPctA' | 'weightPctB'): CoreAssetSeries[] {
    const out: CoreAssetSeries[] = [];
    for (const l of resolved) {
      const w = l[weightKey];
      if (w <= 0) continue; // 시나리오 B 채권 제외
      const close = alignedClose.get(l.ticker)!.slice(commonStart);
      const fx =
        l.currency === 'KRW'
          ? close.map(() => 1)
          : alignedFx.slice(commonStart);
      out.push({ ticker: l.ticker, weightPct: w, close, fxRate: fx });
    }
    return out;
  }

  console.log('\n[3/4] 시뮬레이션...');
  const assetsA = buildAssets('weightPctA');
  const assetsB = buildAssets('weightPctB');
  const equityA = simulate(assetsA, calendar);
  const equityB = simulate(assetsB, calendar);
  const metricsA = computeMetrics(equityA);
  const metricsB = computeMetrics(equityB);
  const rebIdx = semiAnnualRebalanceIndices(calendar);

  // ── 콘솔 리포트 ──
  console.log('\n[4/4] 리포트');
  console.log('\n' + '─'.repeat(88));
  console.log('최종 비중표 (실제 사용 티커)');
  console.log('─'.repeat(88));
  console.log('  ' + '다리'.padEnd(20) + '티커'.padEnd(12) + '통화'.padEnd(6) + 'A%'.padStart(9) + 'B%'.padStart(9) + '  비고');
  for (const l of resolved) {
    const bondTag = l.isBond ? ' [채권]' : '';
    console.log(
      '  ' +
        (l.key + bondTag).padEnd(20) +
        l.ticker.padEnd(12) +
        l.currency.padEnd(6) +
        l.weightPctA.toFixed(3).padStart(9) +
        (l.isBond ? '—' : l.weightPctB.toFixed(3)).padStart(9) +
        (l.ticker !== resolved.find(x => x.key === l.key)!.intended && l.note ? '  *대체/가정' : '')
    );
  }
  const sumA = resolved.reduce((s, l) => s + l.weightPctA, 0);
  const sumB = resolved.reduce((s, l) => s + l.weightPctB, 0);
  console.log('  ' + '합계'.padEnd(20) + ''.padEnd(12) + ''.padEnd(6) + sumA.toFixed(3).padStart(9) + sumB.toFixed(3).padStart(9));

  const rows: Array<[string, string, string]> = [
    ['CAGR', `${metricsA.cagrPct.toFixed(2)}%`, `${metricsB.cagrPct.toFixed(2)}%`],
    ['MDD', `${metricsA.mddPct.toFixed(2)}% (${metricsA.mddTroughDate})`, `${metricsB.mddPct.toFixed(2)}% (${metricsB.mddTroughDate})`],
    ['연변동성', `${metricsA.annualizedVolPct.toFixed(2)}%`, `${metricsB.annualizedVolPct.toFixed(2)}%`],
    ['Sharpe(rf=0)', metricsA.sharpe.toFixed(3), metricsB.sharpe.toFixed(3)],
    ['최종자산(KRW)', fmtKRW(metricsA.finalValueKRW), fmtKRW(metricsB.finalValueKRW)],
  ];
  console.log('\n' + '─'.repeat(88));
  console.log('지표 비교' + '  '.padEnd(4) + 'A(채권 포함)'.padStart(28) + 'B(채권 제외)'.padStart(28));
  console.log('─'.repeat(88));
  for (const [k, a, b] of rows) {
    console.log('  ' + k.padEnd(16) + a.padStart(30) + b.padStart(30));
  }

  console.log('\n  연도별 수익률(연말대비연말, 첫해는 시작일대비):');
  const yearsSet = new Set<string>([
    ...metricsA.calendarYearReturns.map(y => y.year),
    ...metricsB.calendarYearReturns.map(y => y.year),
  ]);
  for (const y of Array.from(yearsSet).sort()) {
    const a = metricsA.calendarYearReturns.find(x => x.year === y)?.returnPct ?? 0;
    const b = metricsB.calendarYearReturns.find(x => x.year === y)?.returnPct ?? 0;
    console.log(`    ${y}:  A ${a.toFixed(2).padStart(8)}%    B ${b.toFixed(2).padStart(8)}%`);
  }

  console.log('\n  리밸런싱 시점(반기 첫 거래일): ' + rebIdx.map(i => calendar[i]).join(', '));

  // ── JSON 출력 ──
  const equityCurve = calendar.map((date, i) => ({
    date,
    scenarioA: Math.round(equityA[i].value),
    scenarioB: Math.round(equityB[i].value),
  }));

  const weightTable = (key: 'weightPctA' | 'weightPctB') =>
    resolved
      .filter(l => l[key] > 0)
      .map(l => ({
        key: l.key,
        intended: l.intended,
        ticker: l.ticker,
        currency: l.currency,
        weightPct: Number(l[key].toFixed(6)),
        isBond: l.isBond,
        note: l.note,
      }));

  const report = {
    generatedAt: new Date().toISOString(),
    requestedStart: START,
    requestedEnd: END,
    source: 'yahoo-v8 adjusted (total return)',
    fxSymbol: FX_SYMBOL,
    costRate: COST_RATE,
    initialCapitalKRW: INITIAL_KRW,
    alignedStart: calendar[0],
    alignedEnd: calendar[calendar.length - 1],
    tradingDays: calendar.length,
    rebalanceDates: rebIdx.map(i => calendar[i]),
    grvtRedistribution: {
      note: '채권 티어 GRVT 4.0%를 한국채(4.0)·미국채(4.5)에 pro-rata 흡수, 티어 합 12.5 유지. 현금 티어(GRVT 17%/USDT/CMA)는 전면 제외.',
      krBondRaw: Number(KR_BOND_RAW.toFixed(6)),
      usBondRaw: Number(US_BOND_RAW.toFixed(6)),
    },
    dataAvailability,
    scenarioA: {
      label: '채권 포함 (16개 다리)',
      weights: weightTable('weightPctA'),
      metrics: metricsA,
    },
    scenarioB: {
      label: '채권 제외 (14개 다리, 채권비중 pro-rata 재분배)',
      weights: weightTable('weightPctB'),
      metrics: metricsB,
    },
    equityCurve,
  };

  const outDir = path.dirname(OUTPUT_PATH);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n결과 저장: ${OUTPUT_PATH}`);
  console.log(`  (equityCurve ${equityCurve.length}포인트, 첫 ${equityCurve[0].date} / 끝 ${equityCurve[equityCurve.length - 1].date})`);
  console.log('='.repeat(88));
}

main().catch(e => {
  console.error('bondRole 백테스트 실행 중 예외:', e);
  process.exit(1);
});
