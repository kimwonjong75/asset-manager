// scripts/backtest/lectureSignals/batch2Common.ts
// ---------------------------------------------------------------------------
// 2차 배치(보유 열화 H3/H4/H5 · 런치패드) 공용 이벤트 스터디 엔진.
//
// pipeline.ts의 D2 파이프라인과 동일한 설계(전방수익·매칭 대조군·§5.6 팩터 분해·
// 연도분해·상위기여 제거·거래 반사실·부트스트랩·Holm)를 재사용한다. 다만 pipeline.ts의
// eligibleAt/periodIndexRange/CrossSectionCache/makeControlForwardCache/factorDecomposition
// 는 모듈 private로 export되지 않아(그리고 pipeline.ts 수정 금지) 여기서 동일 로직을 재구현한다.
// 이벤트 판정만 신호별로 주입(scanFn)하고 나머지는 공유한다.
//
// 신호 방향: 보유 열화·급성 매도는 '나쁨'(신호 종목 시장초과 < 대조군, 음의 diff), 런치패드는
// '좋음'(양의 diff). 통계량(bootstrapDiff/summarize)은 방향 불문이고, 등급 판정에서만 해석한다.
//
// 규칙: `any`·`console.*`·`Math.random` 금지. 순수 로직(외부 I/O 없음).
// ---------------------------------------------------------------------------

import type { Market, SamplePeriod, SecurityBars } from './configTypes';
import { CONST } from './configTypes';
import type { LectureDataset, RegimeSeries } from './dataAccess';
import { pitLookup } from './dataAccess';
import { priorMean } from './features';
import type { ForwardResult, IndexLevelLookup } from './forwardReturns';
import { computeForward } from './forwardReturns';
import type { CrossSection, FactorPanelLabels, StockFeatures } from './factorPanel';
import { buildCrossSection, factorLabels, stockFeaturesAt } from './factorPanel';
import { matchControls } from './matching';
import { FACTOR_DECOMP_AXES } from './pipeline';
import {
  bootstrapDiff,
  decomposeByYear,
  summarize,
  topContributorRemoval,
  type EventSummary,
  type StatEvent,
  type YearDecomposition,
} from './eventStats';
import {
  summarizeTradeCf,
  tradeCounterfactual,
  type TradeCf,
  type TradeCfSummary,
} from './portfolio';

export function normMarket(m: string): Market | null {
  return m === 'KOSPI' ? 'KOSPI' : m === 'KOSDAQ' ? 'KOSDAQ' : null;
}

/** date D의 bar index i에서 이벤트/대조군 자격(유니버스·시장·유동성). D2 eligibleAt와 동일. */
export function eligibleAt(
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

/** 표본기간 [from,to] 에 해당하는 bar-index 범위. pipeline.ts와 동일. */
export function periodIndexRange(bars: SecurityBars, period: SamplePeriod): [number, number] {
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

/** cross-section 캐시(날짜별). pipeline.ts CrossSectionCache와 동일. */
export class CrossSectionCache {
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

/** 대조군 전방 시장초과 메모(코드|날짜). pipeline.ts와 동일. */
export function makeControlForwardCache(
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

export interface FactorDecomp {
  axis: string;
  groups: { label: string; events: number; medianSignalExcess: number; inconclusive: boolean }[];
}

function medianOf(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function factorDecomposition(events: readonly Batch2Event[], h: number): FactorDecomp[] {
  const axes: { axis: string; get: (e: Batch2Event) => string }[] = [
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
  // 축 목록이 §5.6 선언(pipeline.FACTOR_DECOMP_AXES)과 어긋나면 즉시 실패.
  // 초판 batch2Common은 ret5Tertile·vol20Tertile 두 축이 빠져 있었다(D2 P0-1과 동일 결함).
  const declared = axes.map((a) => a.axis).join(',');
  if (declared !== FACTOR_DECOMP_AXES.join(',')) {
    throw new Error(`분해 축 불일치: ${declared} != ${FACTOR_DECOMP_AXES.join(',')}`);
  }
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
        medianSignalExcess: medianOf(arr),
        inconclusive: arr.length < CONST.inconclusiveMinEvents,
      }))
      .sort((a, b) => (a.label < b.label ? -1 : 1));
    return { axis, groups };
  });
}

// ===========================================================================
// 이벤트 스캔 · 강화 · 통계 (신호 판정만 주입)
// ===========================================================================

export interface RawBatch2Event {
  code: string;
  date: string;
  barIndex: number;
}

/**
 * 한 종목·한 신호를 스캔하며 "처음 되는 날"(전이/crossing) + 중복제거(dedupHorizon).
 * cond(i): 그 bar에서 조건 충족 여부(true/false/null=판정불가).
 * crossing 규율: cond(i)===true AND cond(i-1)===false 일 때만 발화(둘 다 계산 가능한 명확한 상향 전이).
 *   cond(i-1)===null(웜업)이면 전이로 보지 않고 skip(보수적) — H3/H4/H5 모두 웜업이 깊어 경계 문제 없음.
 * dedup: 발화 후 dedupHorizon 거래일 동안 재발화 금지(D2 §5.3과 동일).
 */
export function scanCrossingEvents(
  bars: SecurityBars,
  cond: (i: number) => boolean | null,
  dedupHorizon: number,
  fromIdx: number,
  toIdx: number,
  eligible: (i: number) => boolean
): RawBatch2Event[] {
  const out: RawBatch2Event[] = [];
  let blockUntil = -1;
  const n = bars.dates.length;
  const lo = Math.max(1, fromIdx);
  const hi = Math.min(n - 1, toIdx);
  if (hi < lo) return out;
  // cond(i)는 바당 1회만 평가하고 직전 값을 이월한다(H3 63일창·런치패드 150일창에서
  // 2배 평가는 비용이 크다). eligible(i)는 전이 후보일에만 평가한다.
  let prev = cond(lo - 1);
  for (let i = lo; i <= hi; i++) {
    const cur = cond(i);
    if (cur === true && prev === false && i > blockUntil && eligible(i)) {
      out.push({ code: bars.code, date: bars.dates[i], barIndex: i });
      blockUntil = i + dedupHorizon;
    }
    prev = cur;
  }
  return out;
}

export interface Batch2Event {
  code: string;
  signal: string;
  date: string;
  year: number;
  forward: ForwardResult;
  controlExcess: Record<number, number | null>;
  matchMethod: string;
  nControls: number;
  factors: FactorPanelLabels;
  tradeCf: TradeCf;
}

export interface Batch2SignalResult {
  signal: string;
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
}

/** 신호 판정 콜백. bars의 bar index i에서 조건 충족 여부. */
export type SignalCondFactory = (bars: SecurityBars) => (i: number) => boolean | null;

/**
 * 한 신호·한 표본기간의 이벤트 스터디 실행. pipeline.runSignal과 동일 구조이나 신호 판정을 주입.
 * dedupHorizon/primaryHorizon는 신호 트랙별로 지정(보유열화 63, 런치패드 126).
 */
export function runBatch2Signal(
  signal: string,
  ds: LectureDataset,
  regime: RegimeSeries,
  index: IndexLevelLookup,
  period: SamplePeriod,
  csCache: CrossSectionCache,
  controlFwd: (code: string, date: string) => ForwardResult | null,
  condFactory: SignalCondFactory,
  dedupHorizon: number,
  primaryHorizon: number,
  seed: number
): Batch2SignalResult {
  const minAmount = CONST.liquidityMainMinAmountKRW;

  // 1) 이벤트 스캔(전 종목)
  const raws: RawBatch2Event[] = [];
  for (const bars of ds.bars.values()) {
    const [lo, hi] = periodIndexRange(bars, period);
    if (hi < lo) continue;
    const cond = condFactory(bars);
    const evs = scanCrossingEvents(
      bars,
      cond,
      dedupHorizon,
      lo,
      hi,
      (i) => eligibleAt(bars, i, ds, minAmount) !== null
    );
    for (const e of evs) raws.push(e);
  }

  // 2) 날짜별 신호 종목 집합(대조군 제외)
  const signalingByDate = new Map<string, Set<string>>();
  for (const r of raws) {
    const s = signalingByDate.get(r.date) ?? new Set<string>();
    s.add(r.code);
    signalingByDate.set(r.date, s);
  }

  // 3) 이벤트 강화
  const enriched: Batch2Event[] = [];
  for (const r of raws) {
    const bars = ds.bars.get(r.code);
    if (!bars) continue;
    const i = r.barIndex;
    const fwd = computeForward(bars, i, CONST.forwardHorizons, index);
    const cs = csCache.get(r.date);
    const excludeSet = signalingByDate.get(r.date) ?? new Set<string>();
    const match = matchControls(r.code, cs, excludeSet);
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
    const tradeCf = tradeCounterfactual(bars, i, primaryHorizon);
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
      signal: 'S1_RUNUP_21D_100', // StatEvent.signal 타입 요건 충족용 더미(통계에 미사용)
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

  const primaryStats = statEventsAt(primaryHorizon);
  const primaryBootstrapMedian = bootstrapDiff(primaryStats, seed, 'median');
  const primaryBootstrapMeanMatched = bootstrapDiff(primaryStats, seed + 1, 'meanMatched');
  const yearDecomp = decomposeByYear(primaryStats);
  const topContributor = topContributorRemoval(primaryStats);
  const tradeCf = summarizeTradeCf(enriched.map((e) => e.tradeCf));
  const factorDecomp = factorDecomposition(enriched, primaryHorizon);

  const withCtl = primaryStats.filter((e) => e.excess !== null && e.controlExcess !== null).length;
  const withExcess = primaryStats.filter((e) => e.excess !== null).length;

  return {
    signal,
    nEvents: enriched.length,
    primaryHorizon,
    summaryByHorizon,
    primaryBootstrapMedian,
    primaryBootstrapMeanMatched,
    yearDecomp,
    topContributor,
    tradeCf,
    factorDecomp,
    matchRate: withExcess ? withCtl / withExcess : 0,
  };
}
