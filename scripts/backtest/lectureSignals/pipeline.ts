// scripts/backtest/lectureSignals/pipeline.ts
// ---------------------------------------------------------------------------
// D1(시장 레짐)·D2(급성 매도) 계산 파이프라인. 순수 계산(외부 I/O·console 없음).
// run.ts가 데이터셋·레짐을 주입하면 결과 객체를 돌려준다.
//
// 규칙: `any`·`console.*`·`Math.random` 금지.
// ---------------------------------------------------------------------------

import type {
  AcuteSignalCode,
  Market,
  RegimeVariantCode,
  SamplePeriod,
  SecurityBars,
} from './configTypes';
import { ACUTE_SIGNAL_CODES, CONST, S5_VARIANTS } from './configTypes';
import type { LectureDataset, RegimeSeries } from './dataAccess';
import { pitLookup } from './dataAccess';
import { priorMean } from './features';
import { scanSignalEvents } from './events';
import type { ForwardResult, IndexLevelLookup } from './forwardReturns';
import { computeForward } from './forwardReturns';
import type { CrossSection, FactorPanelLabels, StockFeatures } from './factorPanel';
import { buildCrossSection, factorLabels, stockFeaturesAt } from './factorPanel';
import { matchControls } from './matching';
import {
  bootstrapDiff,
  decomposeByYear,
  holmAdjust,
  summarize,
  topContributorRemoval,
  type EventSummary,
  type StatEvent,
  type YearDecomposition,
} from './eventStats';
import {
  applyOverlay,
  perfStats,
  regimeForwardTest,
  summarizeTradeCf,
  tradeCounterfactual,
  type PerfStats,
  type RegimeForwardTest,
  type TradeCf,
  type TradeCfSummary,
} from './portfolio';

// ===========================================================================
// 공통 유틸
// ===========================================================================

function normMarket(m: string): Market | null {
  return m === 'KOSPI' ? 'KOSPI' : m === 'KOSDAQ' ? 'KOSDAQ' : null;
}

/** date D의 bar index i에서 이벤트/대조군 자격 판정(유니버스·시장·유동성 10억). */
function eligibleAt(
  bars: SecurityBars,
  i: number,
  ds: LectureDataset,
  minAmount: number
): { market: Market; percentile: number } | null {
  const date = bars.dates[i];
  const market = normMarket(bars.market[i]);
  if (market === null) return null;
  const rec = pitLookup(ds.pit, bars.code, date);
  if (rec === null) return null;
  const avgAmt = priorMean(bars.amount, i, CONST.amountAvgWindow);
  if (avgAmt === null || avgAmt < minAmount) return null;
  return { market, percentile: rec.percentile };
}

/** 표본기간 [from,to] 에 해당하는 bar-index 범위(신호일 자격). */
function periodIndexRange(bars: SecurityBars, period: SamplePeriod): [number, number] {
  const n = bars.dates.length;
  let lo = n;
  let hi = -1;
  for (let i = 0; i < n; i++) {
    if (bars.dates[i] >= period.from && bars.dates[i] <= period.to) {
      if (i < lo) lo = i;
      if (i > hi) hi = i;
    }
  }
  return [lo, hi];
}

// ===========================================================================
// D2 — 급성 매도 신호
// ===========================================================================

export interface EnrichedEvent {
  code: string;
  signal: AcuteSignalCode;
  date: string;
  year: number;
  forward: ForwardResult; // 신호 종목 전방(시장초과 포함)
  controlExcess: Record<number, number | null>; // 대조군 평균 시장초과
  matchMethod: string;
  nControls: number;
  factors: FactorPanelLabels;
  tradeCf: TradeCf; // 63일 A/B
}

export interface SignalResult {
  signal: AcuteSignalCode;
  nEvents: number;
  primaryHorizon: number;
  summaryByHorizon: Record<number, EventSummary>;
  primaryBootstrapMedian: ReturnType<typeof bootstrapDiff>;
  primaryBootstrapMeanMatched: ReturnType<typeof bootstrapDiff>;
  yearDecomp: YearDecomposition;
  topContributor: ReturnType<typeof topContributorRemoval>;
  tradeCf: TradeCfSummary;
  factorDecomp: FactorDecomp[];
  matchRate: number;
  /**
   * 이벤트 식별키(`code|date`) 정렬 목록. S5 3자 신호 일치율(Jaccard·재현율·정밀도) 계산용.
   * JSON 산출물에는 크기 때문에 싣지 않는다(run.ts가 직렬화 시 제외).
   */
  eventKeys: string[];
}

export interface FactorDecomp {
  axis: string;
  groups: { label: string; events: number; medianSignalExcess: number; inconclusive: boolean }[];
}

/** cross-section 캐시(날짜별). 이벤트/대조군 매칭·팩터가 공유. */
class CrossSectionCache {
  private cache = new Map<string, CrossSection>();
  constructor(
    private ds: LectureDataset,
    private minAmount: number
  ) {}

  get(date: string): CrossSection {
    const hit = this.cache.get(date);
    if (hit) return hit;
    const eff = date.slice(0, 7);
    const inner = this.ds.pit.get(eff);
    const feats: StockFeatures[] = [];
    if (inner) {
      for (const [code, rec] of inner.entries()) {
        const bars = this.ds.bars.get(code);
        if (!bars) continue;
        const i = bars.dateIndex.get(date);
        if (i === undefined) continue;
        const el = eligibleAt(bars, i, this.ds, this.minAmount);
        if (!el) continue;
        feats.push(stockFeaturesAt(bars, i, el.market, rec.percentile));
      }
    }
    const cs = buildCrossSection(date, feats);
    this.cache.set(date, cs);
    return cs;
  }
}

/** 대조군 전방 시장초과 메모(코드|날짜). */
function makeControlForwardCache(
  ds: LectureDataset,
  index: IndexLevelLookup
): (code: string, date: string) => ForwardResult | null {
  const cache = new Map<string, ForwardResult | null>();
  return (code: string, date: string): ForwardResult | null => {
    const key = `${code}|${date}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const bars = ds.bars.get(code);
    let res: ForwardResult | null = null;
    if (bars) {
      const i = bars.dateIndex.get(date);
      if (i !== undefined) res = computeForward(bars, i, CONST.forwardHorizons, index);
    }
    cache.set(key, res);
    return res;
  };
}

/**
 * §5.6 필수 팩터 패널 전 축(분해표 축 목록). ret5Tertile·vol20Tertile은 초판에서
 * 계산만 되고 축 배열에 빠져 있던 축이다(P0-1 보수).
 * FactorPanelLabels의 키 집합과 1:1로 대응해야 한다.
 */
export const FACTOR_DECOMP_AXES: readonly string[] = [
  'market',
  'size',
  'liquidityTertile',
  'volumeMultiple',
  'ret5Tertile',
  'ret21Tertile',
  'ret63Tertile',
  'dailyReturn',
  'dailyAbsShock',
  'vol20Tertile',
  'vol63Tertile',
  'regime',
];

function factorDecomposition(events: readonly EnrichedEvent[], h: number): FactorDecomp[] {
  const axes: { axis: string; get: (e: EnrichedEvent) => string }[] = [
    { axis: 'market', get: (e) => e.factors.market },
    { axis: 'size', get: (e) => e.factors.size },
    { axis: 'liquidityTertile', get: (e) => e.factors.liquidityTertile },
    { axis: 'volumeMultiple', get: (e) => e.factors.volumeMultiple },
    { axis: 'ret5Tertile', get: (e) => e.factors.ret5Tertile },
    { axis: 'ret21Tertile', get: (e) => e.factors.ret21Tertile },
    { axis: 'ret63Tertile', get: (e) => e.factors.ret63Tertile },
    { axis: 'dailyReturn', get: (e) => e.factors.dailyReturn },
    { axis: 'dailyAbsShock', get: (e) => e.factors.dailyAbsShock },
    { axis: 'vol20Tertile', get: (e) => e.factors.vol20Tertile },
    { axis: 'vol63Tertile', get: (e) => e.factors.vol63Tertile },
    { axis: 'regime', get: (e) => e.factors.regime },
  ];
  // 축 목록이 선언과 어긋나면 즉시 실패(§5.6 축 누락 재발 방지).
  const declared = axes.map((a) => a.axis).join(',');
  if (declared !== FACTOR_DECOMP_AXES.join(',')) {
    throw new Error(`분해 축 불일치: ${declared} != ${FACTOR_DECOMP_AXES.join(',')}`);
  }
  const median = (xs: number[]): number => {
    if (xs.length === 0) return NaN;
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  return axes.map(({ axis, get }) => {
    const byLabel = new Map<string, number[]>();
    for (const e of events) {
      const ex = e.forward.marketExcess[h];
      if (ex === null) continue;
      const lab = get(e);
      const arr = byLabel.get(lab) ?? [];
      arr.push(ex);
      byLabel.set(lab, arr);
    }
    const groups = [...byLabel.entries()]
      .map(([label, arr]) => ({
        label,
        events: arr.length,
        medianSignalExcess: median(arr),
        inconclusive: arr.length < CONST.inconclusiveMinEvents,
      }))
      .sort((a, b) => (a.label < b.label ? -1 : 1));
    return { axis, groups };
  });
}

/** 한 신호·한 표본기간의 D2 계산. */
export function runSignal(
  signal: AcuteSignalCode,
  ds: LectureDataset,
  regime: RegimeSeries,
  index: IndexLevelLookup,
  period: SamplePeriod,
  csCache: CrossSectionCache,
  controlFwd: (code: string, date: string) => ForwardResult | null,
  seed: number
): SignalResult {
  const dedup = CONST.d2PrimaryHorizon;
  const minAmount = CONST.liquidityMainMinAmountKRW;

  // 1) 이벤트 스캔(전 종목)
  interface Raw {
    code: string;
    date: string;
    barIndex: number;
  }
  const raws: Raw[] = [];
  for (const bars of ds.bars.values()) {
    const [lo, hi] = periodIndexRange(bars, period);
    if (hi < lo) continue;
    const evs = scanSignalEvents(
      signal,
      bars,
      ds.corpActionDates,
      dedup,
      lo,
      hi,
      (i) => eligibleAt(bars, i, ds, minAmount) !== null
    );
    for (const e of evs) raws.push({ code: e.code, date: e.date, barIndex: e.barIndex });
  }

  // 2) 날짜별 신호 종목 집합(대조군 제외용)
  const signalingByDate = new Map<string, Set<string>>();
  for (const r of raws) {
    const s = signalingByDate.get(r.date) ?? new Set<string>();
    s.add(r.code);
    signalingByDate.set(r.date, s);
  }

  // 3) 이벤트 강화(전방·매칭·팩터·반사실)
  const enriched: EnrichedEvent[] = [];
  for (const r of raws) {
    const bars = ds.bars.get(r.code);
    if (!bars) continue;
    const i = r.barIndex;
    const fwd = computeForward(bars, i, CONST.forwardHorizons, index);
    const cs = csCache.get(r.date);
    const excludeSet = signalingByDate.get(r.date) ?? new Set<string>();
    const match = matchControls(r.code, cs, excludeSet);
    // 대조군 평균 시장초과(호라이즌별)
    const controlExcess: Record<number, number | null> = {};
    for (const h of CONST.forwardHorizons) {
      const vals: number[] = [];
      for (const cc of match.controls) {
        const cf = controlFwd(cc, r.date);
        const v = cf?.marketExcess[h];
        if (v !== null && v !== undefined) vals.push(v);
      }
      controlExcess[h] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
    const evFeat = cs.byCode.get(r.code);
    const regimeRisk = regime.riskAtOrBefore('KR150_LEVEL', r.date) === true;
    const factors: FactorPanelLabels = evFeat
      ? factorLabels(evFeat, cs, regimeRisk)
      : {
          market: normMarket(bars.market[i]) ?? 'KOSPI',
          size: 'NA',
          liquidityTertile: 'NA',
          volumeMultiple: 'NA',
          ret5Tertile: 'NA',
          ret21Tertile: 'NA',
          ret63Tertile: 'NA',
          dailyReturn: 'NA',
          dailyAbsShock: 'NA',
          vol20Tertile: 'NA',
          vol63Tertile: 'NA',
          regime: regimeRisk ? 'RISK' : 'NORMAL',
        };
    const tradeCf = tradeCounterfactual(bars, i, CONST.d2PrimaryHorizon);
    enriched.push({
      code: r.code,
      signal,
      date: r.date,
      year: Number(r.date.slice(0, 4)),
      forward: fwd,
      controlExcess,
      matchMethod: match.method,
      nControls: match.controls.length,
      factors,
      tradeCf,
    });
  }

  // 4) 통계
  const statEventsAt = (h: number): StatEvent[] =>
    enriched.map((e) => ({
      code: e.code,
      signal: e.signal,
      date: e.date,
      year: e.year,
      excess: e.forward.marketExcess[h],
      controlExcess: e.controlExcess[h],
      stockReturn: e.forward.stockReturn[h],
      mae: e.forward.mae[h],
      mfe: e.forward.mfe[h],
    }));

  const summaryByHorizon: Record<number, EventSummary> = {};
  for (const h of CONST.forwardHorizons) summaryByHorizon[h] = summarize(statEventsAt(h));

  const primaryStats = statEventsAt(CONST.d2PrimaryHorizon);
  const primaryBootstrapMedian = bootstrapDiff(primaryStats, seed, 'median');
  const primaryBootstrapMeanMatched = bootstrapDiff(primaryStats, seed + 1, 'meanMatched');
  const yearDecomp = decomposeByYear(primaryStats);
  const topContributor = topContributorRemoval(primaryStats);
  const tradeCf = summarizeTradeCf(enriched.map((e) => e.tradeCf));
  const factorDecomp = factorDecomposition(enriched, CONST.d2PrimaryHorizon);

  const withCtl = primaryStats.filter((e) => e.excess !== null && e.controlExcess !== null).length;
  const withExcess = primaryStats.filter((e) => e.excess !== null).length;

  return {
    signal,
    nEvents: enriched.length,
    primaryHorizon: CONST.d2PrimaryHorizon,
    summaryByHorizon,
    primaryBootstrapMedian,
    primaryBootstrapMeanMatched,
    yearDecomp,
    topContributor,
    tradeCf,
    factorDecomp,
    matchRate: withExcess ? withCtl / withExcess : 0,
    eventKeys: enriched.map((e) => `${e.code}|${e.date}`).sort(),
  };
}

// ===========================================================================
// S5 3자 신호 일치율(§P0-3) — 앱 이식 시 "같은 신호가 뜨는가"의 정량 답
// ===========================================================================

export interface SignalOverlap {
  a: string;
  b: string;
  nA: number;
  nB: number;
  intersection: number;
  union: number;
  jaccard: number;
  /** 기준(a)을 참으로 볼 때 b의 재현율 = |a∩b| / |a| */
  recallOfBvsA: number;
  /** 기준(a)을 참으로 볼 때 b의 정밀도 = |a∩b| / |b| */
  precisionOfBvsA: number;
}

/** 두 이벤트키 집합의 Jaccard·재현율·정밀도. a가 기준(참). */
export function computeOverlap(
  aName: string,
  aKeys: readonly string[],
  bName: string,
  bKeys: readonly string[]
): SignalOverlap {
  const A = new Set(aKeys);
  const B = new Set(bKeys);
  let inter = 0;
  for (const k of B) if (A.has(k)) inter++;
  const union = A.size + B.size - inter;
  return {
    a: aName,
    b: bName,
    nA: A.size,
    nB: B.size,
    intersection: inter,
    union,
    jaccard: union > 0 ? inter / union : 0,
    recallOfBvsA: A.size > 0 ? inter / A.size : 0,
    precisionOfBvsA: B.size > 0 ? inter / B.size : 0,
  };
}

export interface D2FamilyResult {
  period: SamplePeriod['name'];
  bySignal: SignalResult[];
  holmAdjustedP: Record<string, number>; // signal → Holm 보정 p(주호라이즌 median 부트스트랩)
  /** S5 세 변형 쌍별 신호 일치율(기준 a = S5_AMOUNT 우선). */
  s5Overlap: SignalOverlap[];
}

/** D2 전체(8신호) 한 표본기간 실행 + Holm 보정. */
export function runD2Family(
  ds: LectureDataset,
  regime: RegimeSeries,
  index: IndexLevelLookup,
  period: SamplePeriod
): D2FamilyResult {
  const csCache = new CrossSectionCache(ds, CONST.liquidityMainMinAmountKRW);
  const controlFwd = makeControlForwardCache(ds, index);
  const bySignal: SignalResult[] = [];
  let seed = CONST.masterSeed;
  for (const sig of ACUTE_SIGNAL_CODES) {
    bySignal.push(runSignal(sig, ds, regime, index, period, csCache, controlFwd, seed));
    seed += 100;
  }
  const ps = bySignal.map((s) => s.primaryBootstrapMedian.pValue);
  const adj = holmAdjust(ps);
  const holmAdjustedP: Record<string, number> = {};
  bySignal.forEach((s, k) => (holmAdjustedP[s.signal] = adj[k]));

  // S5 3자 일치율(쌍별). 기준(a)은 항상 앞선 변형 — AMOUNT가 기준일 때가 주보고치.
  const keysOf = (sig: string): readonly string[] =>
    bySignal.find((s) => s.signal === sig)?.eventKeys ?? [];
  const s5Overlap: SignalOverlap[] = [];
  for (let x = 0; x < S5_VARIANTS.length; x++) {
    for (let y = x + 1; y < S5_VARIANTS.length; y++) {
      s5Overlap.push(
        computeOverlap(S5_VARIANTS[x], keysOf(S5_VARIANTS[x]), S5_VARIANTS[y], keysOf(S5_VARIANTS[y]))
      );
    }
  }
  return { period: period.name, bySignal, holmAdjustedP, s5Overlap };
}

// ===========================================================================
// D1 — 시장 레짐
// ===========================================================================

export interface RegimeVariantResult {
  variant: RegimeVariantCode;
  forwardTest: RegimeForwardTest; // 126일 전방(레짐별 차이)
  baseline: PerfStats;
  block: PerfStats;
  halve: PerfStats;
  sharpeDeltaBlock: number;
  sharpeDeltaHalve: number;
  mddDeltaBlock: number; // baseline MDD − block MDD (양수=개선)
  mddDeltaHalve: number;
  cagrSacrificeBlock: number; // baseline − block (양수=희생)
  cagrSacrificeHalve: number;
}

export interface D1Result {
  period: SamplePeriod['name'];
  proxySymbol: string;
  variants: RegimeVariantResult[];
  ewDays: number;
}

/**
 * 등가중 투자가능 유니버스 일간수익 시계열을 KOSPI 캘린더에 정렬해 만든다.
 * r_ew[t] = mean over investable(effmonth) of adjClose[t]/adjClose[prev]-1.
 */
function buildEwDailyReturns(
  ds: LectureDataset,
  regime: RegimeSeries,
  period: SamplePeriod
): { dates: string[]; rEw: number[] } {
  const dates = regime.dates.filter((d) => d >= period.from && d <= period.to);
  const rEw: number[] = [];
  for (const d of dates) {
    const eff = d.slice(0, 7);
    const inner = ds.pit.get(eff);
    let sum = 0;
    let cnt = 0;
    if (inner) {
      for (const code of inner.keys()) {
        const bars = ds.bars.get(code);
        if (!bars) continue;
        const i = bars.dateIndex.get(d);
        if (i === undefined || i < 1) continue;
        const prev = bars.adjClose[i - 1];
        if (!(prev > 0)) continue;
        sum += bars.adjClose[i] / prev - 1;
        cnt++;
      }
    }
    rEw.push(cnt > 0 ? sum / cnt : 0);
  }
  return { dates, rEw };
}

export function runD1(
  ds: LectureDataset,
  regime: RegimeSeries,
  period: SamplePeriod
): D1Result {
  const { dates, rEw } = buildEwDailyReturns(ds, regime, period);
  // 각 변형의 레짐 시계열을 EW 캘린더에 정렬(그 날의 종가 기준 위험여부)
  const variants: RegimeVariantResult[] = [];
  let seed = CONST.masterSeed + 500;
  for (const variant of ['KR150_LEVEL', 'KR150_SLOPE', 'KR150_COMBINED', 'KR200_LEVEL'] as RegimeVariantCode[]) {
    const risk: (boolean | null)[] = dates.map((d) => regime.riskAtOrBefore(variant, d));
    const forwardTest = regimeForwardTest(rEw, risk, CONST.d1PrimaryHorizon, seed);
    seed += 10;
    const baseline = perfStats(applyOverlay(rEw, risk, 'BASELINE'));
    const block = perfStats(applyOverlay(rEw, risk, 'BLOCK'));
    const halve = perfStats(applyOverlay(rEw, risk, 'HALVE'));
    variants.push({
      variant,
      forwardTest,
      baseline,
      block,
      halve,
      sharpeDeltaBlock: block.sharpe - baseline.sharpe,
      sharpeDeltaHalve: halve.sharpe - baseline.sharpe,
      mddDeltaBlock: baseline.mdd - block.mdd,
      mddDeltaHalve: baseline.mdd - halve.mdd,
      cagrSacrificeBlock: baseline.cagr - block.cagr,
      cagrSacrificeHalve: baseline.cagr - halve.cagr,
    });
  }
  return { period: period.name, proxySymbol: regime.symbol, variants, ewDays: rEw.length };
}
