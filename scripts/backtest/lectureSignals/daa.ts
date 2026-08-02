// scripts/backtest/lectureSignals/daa.ts
// ---------------------------------------------------------------------------
// 독립 트랙 — 동적자산배분 5전략 비교(§11). 순수 계산(외부 I/O·console 없음).
// 데이터 수집은 daaFetch.ts, 실행 드라이버는 runBatch2.ts.
//
// ⚠ 가정 티커(계획서 §11이 "정의 확정 전 BLOCKED_DEFINITION"으로 둔 항목을 가정으로 고정):
//   채권8 = TLT IEF SHY LQD HYG TIP EMB BWX / 주식·글로벌·안전 = SPY VEU AGG
//   정적 = SPY TLT GLD BIL 각 25% / 현금대용 = BIL(상장 전이면 무이자 현금 0%)
//   → 사용자 확인 후 티커가 바뀌면 재실행해야 한다(문서 최상단 가정표에 게재).
//
// 체결 규약(같은 봉 체결 금지):
//   신호는 **그 달 마지막 거래일 종가**로 계산하고, 체결은 **다음 거래일(=익월 첫 거래일)
//   시가**에서 한다. 신호일 당일에는 절대 체결하지 않는다(골든 테스트로 고정).
//   공통 거래일 달력에서 "그 달 마지막 거래일의 바로 다음 거래일"은 정의상 익월 첫 거래일이다.
//
// 비용: 편도 0.1%(=10bps)를 **매매된 명목금액**에 부과한다. cost = 0.001 × Σ|Δw|.
//   세금은 생략한다(§11 미정의 — 결과 문서에 명시).
//
// 규칙: `any`·`console.*`·`Math.random` 금지. 순수 로직.
// ---------------------------------------------------------------------------

import type { DaaSeries } from './daaFetch';
import { perfStats, type PerfStats } from './portfolio';

// ===========================================================================
// 가정 티커 (문서 최상단 가정표와 1:1 대응)
// ===========================================================================

export const DAA_ASSUMPTIONS = {
  /** 채권 DAA 후보 8종. 순서는 동점 시 결정론적 tie-break 순서이기도 하다. */
  bonds8: ['TLT', 'IEF', 'SHY', 'LQD', 'HYG', 'TIP', 'EMB', 'BWX'] as const,
  /** 오리지널 듀얼모멘텀: 위험자산 2 + 안전자산 1. */
  equityUs: 'SPY',
  equityIntl: 'VEU',
  safeOriginal: 'AGG',
  /** 정적 배분(각 25%, 연 1회 리밸런싱). */
  staticSleeve: ['SPY', 'TLT', 'GLD', 'BIL'] as const,
  staticWeight: 0.25,
  /** 현금 대용(상장 전이면 무이자 현금). */
  cashProxy: 'BIL',
  /** 모멘텀 창(거래일). */
  lookback12M: 252,
  lookback6M: 126,
  /** 편도 거래비용(비율). */
  costOneWay: 0.001,
  /** 채권 DAA 슬롯 수. */
  bondSlots: 3,
  /** 정적50 + 변형동적50 혼합 비중. */
  blendStatic: 0.5,
} as const;

export type StrategyCode =
  | 'STATIC'
  | 'BOND_DAA'
  | 'DUAL_ORIGINAL'
  | 'DUAL_VARIANT'
  | 'BLEND_50_50';

export const STRATEGY_CODES: readonly StrategyCode[] = [
  'STATIC',
  'BOND_DAA',
  'DUAL_ORIGINAL',
  'DUAL_VARIANT',
  'BLEND_50_50',
];

export const STRATEGY_LABEL: Record<StrategyCode, string> = {
  STATIC: '정적 자산배분(SPY/TLT/GLD/BIL 25%, 연1회)',
  BOND_DAA: '채권 DAA(8종 중 6개월 모멘텀 상위3, 음수슬롯=BIL)',
  DUAL_ORIGINAL: '오리지널 듀얼모멘텀(SPY/VEU, 안전=AGG)',
  DUAL_VARIANT: '변형 듀얼모멘텀(SPY/VEU, 안전=채권DAA)',
  BLEND_50_50: '정적 50% + 변형 듀얼모멘텀 50%',
};

// ===========================================================================
// 가격표(공통 거래일 달력)
// ===========================================================================

export interface PriceTable {
  symbols: string[];
  dates: string[];
  adjClose: Map<string, number[]>;
  adjOpen: Map<string, number[]>;
}

/**
 * 여러 심볼 시계열의 **교집합 거래일**로 가격표를 만든다(공통 구간).
 * 한 심볼이라도 그 날짜가 없으면 그 날짜는 통째로 제외한다 — 전략 간 달력이 어긋나
 * 비교가 깨지는 것을 막는다. from/to 로 추가 절단(잠금표본 방어: to 는 2022-12-31 고정).
 */
export function buildPriceTable(
  series: ReadonlyMap<string, DaaSeries>,
  symbols: readonly string[],
  from: string,
  to: string
): PriceTable {
  const idxMaps: { sym: string; idx: Map<string, number>; s: DaaSeries }[] = [];
  for (const sym of symbols) {
    const s = series.get(sym);
    if (!s || !s.ok) throw new Error(`DAA 시계열 결측: ${sym}`);
    const idx = new Map<string, number>();
    s.dates.forEach((d, i) => idx.set(d, i));
    idxMaps.push({ sym, idx, s });
  }
  // 기준 달력 = 첫 심볼의 날짜에서 시작해 전 심볼 교집합으로 좁힌다.
  const base = idxMaps[0].s.dates.filter((d) => d >= from && d <= to);
  const dates = base.filter((d) => idxMaps.every((m) => m.idx.has(d)));
  const adjClose = new Map<string, number[]>();
  const adjOpen = new Map<string, number[]>();
  for (const m of idxMaps) {
    const c: number[] = [];
    const o: number[] = [];
    for (const d of dates) {
      const i = m.idx.get(d) as number;
      c.push(m.s.adjClose[i]);
      o.push(m.s.adjOpen[i]);
    }
    adjClose.set(m.sym, c);
    adjOpen.set(m.sym, o);
  }
  return { symbols: [...symbols], dates, adjClose, adjOpen };
}

/** 각 심볼의 첫 거래일(공통구간 산정용). */
export function firstDates(series: ReadonlyMap<string, DaaSeries>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [sym, s] of series.entries()) {
    if (s.ok && s.dates.length > 0) out.set(sym, s.dates[0]);
  }
  return out;
}

// ===========================================================================
// 월말 신호 / 익월 첫 거래일 체결
// ===========================================================================

export interface RebalanceDay {
  /** 신호 계산일(그 달 마지막 거래일) bar index. */
  signalIdx: number;
  /** 체결일(익월 첫 거래일) bar index. 항상 signalIdx + 1. */
  tradeIdx: number;
}

/**
 * 월말 신호 → 익월 첫 거래일 체결 쌍. dates[i]의 월이 dates[i+1]의 월과 다르면
 * i는 그 달 마지막 거래일이고 i+1은 익월 첫 거래일이다.
 * **tradeIdx === signalIdx + 1 이 항상 성립하므로 같은 봉 체결은 구조적으로 불가능하다.**
 */
export function monthlyRebalanceDays(dates: readonly string[]): RebalanceDay[] {
  const out: RebalanceDay[] = [];
  for (let i = 0; i + 1 < dates.length; i++) {
    if (dates[i].slice(0, 7) !== dates[i + 1].slice(0, 7)) {
      out.push({ signalIdx: i, tradeIdx: i + 1 });
    }
  }
  return out;
}

/** 연 1회 리밸런싱: 체결일이 **해가 바뀐 첫 거래일**인 쌍만. */
export function isAnnualRebalance(dates: readonly string[], r: RebalanceDay): boolean {
  return dates[r.signalIdx].slice(0, 4) !== dates[r.tradeIdx].slice(0, 4);
}

// ===========================================================================
// 모멘텀
// ===========================================================================

/** lookback 거래일 총수익 모멘텀 adjClose[i]/adjClose[i-lookback] - 1. 창부족이면 null. */
export function momentum(
  table: PriceTable,
  symbol: string,
  i: number,
  lookback: number
): number | null {
  const c = table.adjClose.get(symbol);
  if (!c) return null;
  const j = i - lookback;
  if (j < 0 || i >= c.length) return null;
  const base = c[j];
  if (!(base > 0)) return null;
  return c[i] / base - 1;
}

// ===========================================================================
// 전략별 목표 비중
// ===========================================================================

export type Weights = Map<string, number>;

function addW(w: Weights, sym: string, amount: number): void {
  w.set(sym, (w.get(sym) ?? 0) + amount);
}

/** 정적 배분: SPY/TLT/GLD/BIL 각 25%. */
export function staticWeights(): Weights {
  const w: Weights = new Map();
  for (const s of DAA_ASSUMPTIONS.staticSleeve) addW(w, s, DAA_ASSUMPTIONS.staticWeight);
  return w;
}

export interface BondDaaDetail {
  ranked: { symbol: string; mom: number }[];
  picks: { symbol: string; mom: number; toCash: boolean }[];
}

/**
 * 채권 DAA: 8종을 최근 126거래일 모멘텀 내림차순 정렬 → 상위 3개 각 1/3.
 * 그 슬롯의 모멘텀이 **음수(<0)** 면 그 1/3은 현금(BIL)으로 돌린다.
 * 모멘텀 산출 불가(창부족)면 최하위로 취급하고 그 슬롯도 현금 처리된다.
 * 동점은 bonds8 선언 순서로 결정론적 tie-break.
 */
export function bondDaaWeights(table: PriceTable, i: number): { w: Weights; detail: BondDaaDetail } {
  const order = new Map(DAA_ASSUMPTIONS.bonds8.map((s, k) => [s as string, k]));
  const scored = DAA_ASSUMPTIONS.bonds8.map((sym) => ({
    symbol: sym as string,
    mom: momentum(table, sym, i, DAA_ASSUMPTIONS.lookback6M),
  }));
  const ranked = [...scored].sort((a, b) => {
    const av = a.mom === null ? -Infinity : a.mom;
    const bv = b.mom === null ? -Infinity : b.mom;
    if (bv !== av) return bv - av;
    return (order.get(a.symbol) as number) - (order.get(b.symbol) as number);
  });
  const slot = 1 / DAA_ASSUMPTIONS.bondSlots;
  const w: Weights = new Map();
  const picks: BondDaaDetail['picks'] = [];
  for (let k = 0; k < DAA_ASSUMPTIONS.bondSlots; k++) {
    const r = ranked[k];
    const toCash = r.mom === null || r.mom < 0;
    if (toCash) {
      // 현금 대용 BIL. 그 날 BIL 가격이 없으면(상장 전) 무이자 현금 → 비중 미배정(수익 0%).
      if (table.adjClose.has(DAA_ASSUMPTIONS.cashProxy)) addW(w, DAA_ASSUMPTIONS.cashProxy, slot);
    } else {
      addW(w, r.symbol, slot);
    }
    picks.push({ symbol: r.symbol, mom: r.mom ?? NaN, toCash });
  }
  return {
    w,
    detail: {
      ranked: ranked.map((r) => ({ symbol: r.symbol, mom: r.mom ?? NaN })),
      picks,
    },
  };
}

export interface DualDetail {
  momUs: number | null;
  momIntl: number | null;
  winner: string;
  momWinner: number | null;
  riskOn: boolean;
}

/**
 * 듀얼모멘텀 신호(오리지널·변형 공통). 12개월(252거래일) 총수익 기준.
 *   상대: SPY vs VEU 중 모멘텀 우세 종목.
 *   절대: **우세 종목의 12개월 수익이 양수(>0)** 면 위험자산 100%, 아니면 안전자산.
 * (절대 필터를 "우세 종목 기준"으로 잡은 것은 사전 고정 선택이며 오리지널·변형에 동일 적용한다.
 *  두 전략의 차이가 오직 **안전자산**뿐이어야 (b) 비교가 성립하기 때문이다.)
 */
export function dualMomentumSignal(table: PriceTable, i: number): DualDetail {
  const momUs = momentum(table, DAA_ASSUMPTIONS.equityUs, i, DAA_ASSUMPTIONS.lookback12M);
  const momIntl = momentum(table, DAA_ASSUMPTIONS.equityIntl, i, DAA_ASSUMPTIONS.lookback12M);
  const us = momUs === null ? -Infinity : momUs;
  const intl = momIntl === null ? -Infinity : momIntl;
  // 동점이면 SPY 우선(결정론적).
  const winner = us >= intl ? DAA_ASSUMPTIONS.equityUs : DAA_ASSUMPTIONS.equityIntl;
  const momWinner = winner === DAA_ASSUMPTIONS.equityUs ? momUs : momIntl;
  const riskOn = momWinner !== null && momWinner > 0;
  return { momUs, momIntl, winner, momWinner, riskOn };
}

/** 오리지널 듀얼모멘텀 비중: 위험 100% 또는 AGG 100%. */
export function dualOriginalWeights(table: PriceTable, i: number): { w: Weights; detail: DualDetail } {
  const detail = dualMomentumSignal(table, i);
  const w: Weights = new Map();
  if (detail.riskOn) addW(w, detail.winner, 1);
  else addW(w, DAA_ASSUMPTIONS.safeOriginal, 1);
  return { w, detail };
}

/** 변형 듀얼모멘텀 비중: 위험 100% 또는 **채권 DAA** 100%. */
export function dualVariantWeights(
  table: PriceTable,
  i: number
): { w: Weights; detail: DualDetail; bond: BondDaaDetail | null } {
  const detail = dualMomentumSignal(table, i);
  if (detail.riskOn) {
    const w: Weights = new Map();
    addW(w, detail.winner, 1);
    return { w, detail, bond: null };
  }
  const b = bondDaaWeights(table, i);
  return { w: b.w, detail, bond: b.detail };
}

// ===========================================================================
// 시뮬레이터
// ===========================================================================

export interface SimResult {
  strategy: string;
  /** 수익률 시계열의 시작 bar index(첫 체결일). dailyReturns[k] ↔ dates[startIdx + k]. */
  startIdx: number;
  dates: string[];
  dailyReturns: number[];
  perf: PerfStats;
  /** 리밸런싱 횟수(첫 진입 포함). */
  rebalances: number;
  /** 평균 월 회전율 = mean(Σ|Δw| / 2) — 첫 진입일 제외. */
  avgMonthlyTurnover: number;
  /** 총 비용(누적 비율 합, 참고치). */
  totalCost: number;
  /** 연도별 수익률. */
  byYear: { year: number; ret: number }[];
}

function driftWeights(
  w: Weights,
  assetReturn: (sym: string) => number,
  portReturn: number
): Weights {
  const out: Weights = new Map();
  const denom = 1 + portReturn;
  if (!(denom > 0)) return new Map(w);
  for (const [sym, x] of w.entries()) out.set(sym, (x * (1 + assetReturn(sym))) / denom);
  return out;
}

function weightedReturn(w: Weights, r: (sym: string) => number): number {
  let s = 0;
  for (const [sym, x] of w.entries()) s += x * r(sym);
  return s; // 미배정분(현금)은 0% 수익
}

function turnoverOf(from: Weights, to: Weights): number {
  const syms = new Set<string>([...from.keys(), ...to.keys()]);
  let s = 0;
  for (const sym of syms) s += Math.abs((to.get(sym) ?? 0) - (from.get(sym) ?? 0));
  return s; // Σ|Δw| (매수+매도 명목 합)
}

/** 연도별 수익률(일간수익 누적). */
export function yearlyReturns(
  dates: readonly string[],
  dailyReturns: readonly number[]
): { year: number; ret: number }[] {
  const acc = new Map<number, number>();
  for (let k = 0; k < dailyReturns.length; k++) {
    const y = Number(dates[k].slice(0, 4));
    acc.set(y, (acc.get(y) ?? 1) * (1 + dailyReturns[k]));
  }
  return [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([year, v]) => ({ year, ret: v - 1 }));
}

/**
 * 전략 시뮬레이션. weightFn(signalIdx) → 목표 비중.
 * rebalanceFilter 가 false 인 리밸런싱일은 건너뛴다(정적=연1회). 단 **첫 체결일은 항상 진입**한다.
 *
 * 체결일 t 의 하루는 두 구간으로 쪼갠다(같은 봉 체결 금지의 구현):
 *   ① 전일 종가 → 당일 시가 : **직전 비중**으로 수익 발생
 *   ② 당일 시가 → 당일 종가 : **신규 비중**으로 수익 발생 (그 사이에 비용 차감)
 */
export function simulate(
  strategy: string,
  table: PriceTable,
  weightFn: (signalIdx: number) => Weights,
  rebalanceDays: readonly RebalanceDay[],
  rebalanceFilter: (r: RebalanceDay) => boolean,
  minSignalIdx: number
): SimResult {
  const { dates } = table;
  const usable = rebalanceDays.filter((r) => r.signalIdx >= minSignalIdx);
  if (usable.length === 0) throw new Error(`${strategy}: 리밸런싱일 없음`);
  const startIdx = usable[0].tradeIdx;
  const tradeMap = new Map<number, RebalanceDay>();
  for (const r of usable) tradeMap.set(r.tradeIdx, r);

  const closeOf = (sym: string, t: number): number => (table.adjClose.get(sym) as number[])[t];
  const openOf = (sym: string, t: number): number => (table.adjOpen.get(sym) as number[])[t];

  let w: Weights = new Map();
  const dailyReturns: number[] = [];
  const outDates: string[] = [];
  const turnovers: number[] = [];
  let rebalances = 0;
  let totalCost = 0;

  for (let t = startIdx; t < dates.length; t++) {
    const reb = tradeMap.get(t);
    const isFirst = t === startIdx;
    const doRebalance = reb !== undefined && (isFirst || rebalanceFilter(reb));
    let dayRet: number;
    if (doRebalance && reb) {
      const rPre = weightedReturn(w, (s) => openOf(s, t) / closeOf(s, t - 1) - 1);
      const wOpen = driftWeights(w, (s) => openOf(s, t) / closeOf(s, t - 1) - 1, rPre);
      const target = weightFn(reb.signalIdx);
      const to = turnoverOf(wOpen, target);
      const cost = DAA_ASSUMPTIONS.costOneWay * to;
      const rPost = weightedReturn(target, (s) => closeOf(s, t) / openOf(s, t) - 1);
      dayRet = (1 + rPre) * (1 - cost) * (1 + rPost) - 1;
      w = driftWeights(target, (s) => closeOf(s, t) / openOf(s, t) - 1, rPost);
      rebalances++;
      totalCost += cost;
      if (!isFirst) turnovers.push(to / 2);
    } else {
      const r = weightedReturn(w, (s) => closeOf(s, t) / closeOf(s, t - 1) - 1);
      w = driftWeights(w, (s) => closeOf(s, t) / closeOf(s, t - 1) - 1, r);
      dayRet = r;
    }
    dailyReturns.push(dayRet);
    outDates.push(dates[t]);
  }

  return {
    strategy,
    startIdx,
    dates: outDates,
    dailyReturns,
    perf: perfStats(dailyReturns),
    rebalances,
    avgMonthlyTurnover: turnovers.length
      ? turnovers.reduce((a, b) => a + b, 0) / turnovers.length
      : 0,
    totalCost,
    byYear: yearlyReturns(outDates, dailyReturns),
  };
}

/**
 * 정적50 + 변형동적50 혼합. 두 슬리브의 **일간수익 시계열**을 50:50으로 합치고,
 * 매월 체결일에 50:50으로 되돌린다(슬리브 간 이체분에 편도 0.1% 부과).
 * 두 SimResult 는 같은 startIdx·같은 길이여야 한다.
 */
export function blendSleeves(
  strategy: string,
  a: SimResult,
  b: SimResult,
  table: PriceTable,
  rebalanceDays: readonly RebalanceDay[],
  wA: number = DAA_ASSUMPTIONS.blendStatic
): SimResult {
  if (a.startIdx !== b.startIdx || a.dailyReturns.length !== b.dailyReturns.length) {
    throw new Error('혼합 슬리브 정렬 불일치');
  }
  const tradeSet = new Set(rebalanceDays.map((r) => r.tradeIdx));
  let x: number = wA; // 정적 슬리브 비중
  const out: number[] = [];
  const turnovers: number[] = [];
  let totalCost = 0;
  let rebalances = 0;
  for (let k = 0; k < a.dailyReturns.length; k++) {
    const t = a.startIdx + k;
    let cost = 0;
    if (tradeSet.has(t) && k > 0) {
      const to = 2 * Math.abs(wA - x); // Σ|Δw| (슬리브 2개)
      cost = DAA_ASSUMPTIONS.costOneWay * to;
      if (to > 0) turnovers.push(to / 2);
      totalCost += cost;
      rebalances++;
      x = wA;
    }
    const ra = a.dailyReturns[k];
    const rb = b.dailyReturns[k];
    const r = (1 - cost) * (x * (1 + ra) + (1 - x) * (1 + rb)) - 1;
    // 슬리브 비중 드리프트
    const denom = x * (1 + ra) + (1 - x) * (1 + rb);
    x = denom > 0 ? (x * (1 + ra)) / denom : x;
    out.push(r);
  }
  return {
    strategy,
    startIdx: a.startIdx,
    dates: [...a.dates],
    dailyReturns: out,
    perf: perfStats(out),
    rebalances,
    avgMonthlyTurnover:
      (a.avgMonthlyTurnover + b.avgMonthlyTurnover) / 2 +
      (turnovers.length ? turnovers.reduce((p, q) => p + q, 0) / turnovers.length : 0),
    totalCost: (a.totalCost + b.totalCost) / 2 + totalCost,
    byYear: yearlyReturns(a.dates, out),
  };
}

/** 매수후보유 기준선(비교용, 1회 진입 비용만). */
export function buyAndHold(symbol: string, table: PriceTable, startIdx: number): SimResult {
  const w: Weights = new Map([[symbol, 1]]);
  return simulate(
    `BH_${symbol}`,
    table,
    () => w,
    [{ signalIdx: startIdx - 1, tradeIdx: startIdx }],
    () => true,
    startIdx - 1
  );
}

// ===========================================================================
// 전체 실행
// ===========================================================================

export interface DaaRunResult {
  from: string;
  to: string;
  tradingDays: number;
  firstSignalDate: string;
  firstTradeDate: string;
  strategies: SimResult[];
  benchmarks: SimResult[];
  /** 신호 로그(월별) — 감사용. */
  signalLog: {
    signalDate: string;
    tradeDate: string;
    dual: DualDetail;
    bondPicks: { symbol: string; mom: number; toCash: boolean }[];
  }[];
}

export function runDaa(table: PriceTable): DaaRunResult {
  const rebs = monthlyRebalanceDays(table.dates);
  const minSignal = DAA_ASSUMPTIONS.lookback12M; // 12개월 창이 완전히 형성된 뒤
  const usable = rebs.filter((r) => r.signalIdx >= minSignal);
  if (usable.length === 0) throw new Error('DAA: 워밍업 후 리밸런싱일 없음');

  const staticSim = simulate(
    'STATIC',
    table,
    () => staticWeights(),
    rebs,
    (r) => isAnnualRebalance(table.dates, r),
    minSignal
  );
  const bondSim = simulate(
    'BOND_DAA',
    table,
    (i) => bondDaaWeights(table, i).w,
    rebs,
    () => true,
    minSignal
  );
  const dualOrig = simulate(
    'DUAL_ORIGINAL',
    table,
    (i) => dualOriginalWeights(table, i).w,
    rebs,
    () => true,
    minSignal
  );
  const dualVar = simulate(
    'DUAL_VARIANT',
    table,
    (i) => dualVariantWeights(table, i).w,
    rebs,
    () => true,
    minSignal
  );
  const blend = blendSleeves('BLEND_50_50', staticSim, dualVar, table, usable);

  const startIdx = staticSim.startIdx;
  const benchmarks = ['SPY', 'AGG', 'GLD', 'TLT']
    .filter((s) => table.adjClose.has(s))
    .map((s) => buyAndHold(s, table, startIdx));

  const signalLog = usable.map((r) => {
    const dual = dualMomentumSignal(table, r.signalIdx);
    const bond = bondDaaWeights(table, r.signalIdx);
    return {
      signalDate: table.dates[r.signalIdx],
      tradeDate: table.dates[r.tradeIdx],
      dual,
      bondPicks: bond.detail.picks,
    };
  });

  return {
    from: table.dates[0],
    to: table.dates[table.dates.length - 1],
    tradingDays: table.dates.length,
    firstSignalDate: table.dates[usable[0].signalIdx],
    firstTradeDate: table.dates[usable[0].tradeIdx],
    strategies: [staticSim, bondSim, dualOrig, dualVar, blend],
    benchmarks,
    signalLog,
  };
}
