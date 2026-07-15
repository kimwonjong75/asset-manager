// scripts/backtest/sectorRotation/lib/strategy.ts
// Phase 2 — Global 후보 신호의 "엄격한 전략 검증"(순수 함수 계층).
// 연구 전용(앱/백엔드/공유캐시 무접촉). 사전등록 PHASE2_PREREGISTRATION.md §2~§5 구현.
// 파라미터 튜닝 금지: 1차 전략은 §3 단일 구성(N=2·월간·완충 상위3·듀얼모멘텀 vs BIL).
//
// 룩어헤드 가드(핵심):
//   신호 = 월말 T 종가까지만(relMomentum on month-end adjClose).
//   체결 = 익월(T+1) 첫 거래일 adjOpen. 보유 = 그 달 → 다음 달 첫 거래일 adjOpen.
//   ⇒ 신호월(월말 T)과 수익창(T+1 첫날~T+2 첫날)은 겹치지 않는다.

import type { AdjSeries } from './yahooData';
import {
  truncateGaps,
  toMonthEnd,
  buildPanel,
  restrictToCommonMonths,
  capMonths,
  relMomentum,
  type MonthlyPanel,
} from './monthly';

// ─── 파라미터 ────────────────────────────────────────────────
export interface StrategyParams {
  /** 신호 유니버스(6종). */
  universe: string[];
  /** 현금 자산(듀얼모멘텀 대피처). */
  cashSymbol: string;
  /** 선정 종목 수(1차=2). */
  topN: number;
  /** 회전 완충: 보유 종목이 상위 bufferTop 이내면 유지(1차=3). */
  bufferTop: number;
  /** 리밸런싱 주기(1차=monthly). */
  rebalance: 'monthly' | 'quarterly';
  /** 편도 거래비용률(1차=0.001). cost = costRate * Σ|Δw|(왕복=2×편도). */
  costRate: number;
  /** 모멘텀 창(Phase 1과 동일 3/6/12). */
  windows: number[];
  /** 절대 모멘텀(현금 대피) 룩백 개월(1차=12). */
  absLookback: number;
  /** 미완료 당월 배제 기준(마지막 완료월). */
  lastCompleteMonth: string;
}

export const PRIMARY_PARAMS: Omit<StrategyParams, 'costRate'> = {
  universe: ['SPY', 'EWY', 'EWJ', 'MCHI', 'GLD', 'DBC'],
  cashSymbol: 'BIL',
  topN: 2,
  bufferTop: 3,
  rebalance: 'monthly',
  windows: [3, 6, 12],
  absLookback: 12,
  lastCompleteMonth: '2026-06',
};

// ─── 결과 타입 ───────────────────────────────────────────────
export interface Holding {
  symbol: string; // 실제 보유 심볼(현금 대피 시 cashSymbol)
  weight: number;
  isCash: boolean;
}

export interface RebalanceRecord {
  execMonth: string; // 체결(보유) 월 YYYY-MM
  signalMonth: string; // 신호 산출 월말 YYYY-MM(= execMonth 직전월)
  entryDate: string; // 실제 첫 거래일(체결일)
  selectedRaw: string[]; // 완충 후 선정(현금 대피 전) 심볼
  holdings: Holding[]; // 현금 대피 반영 최종 보유
  turnover: number; // 편도 회전율 0.5*Σ|Δw| ∈[0,1]
  cost: number; // costRate*Σ|Δw|
  grossReturn: number; // 보유기간 총수익(비용 전) Σ w*r
  netReturn: number; // 비용 반영 (1-cost)*(1+gross)-1
  rebalanced: boolean; // 이번 달 실제 리밸런싱 여부(분기 전략에서 false 가능)
}

export interface RealizedTrade {
  symbol: string;
  execMonth: string;
  weight: number;
  assetReturn: number; // 그 달 그 자산의 수익
  contribution: number; // weight*assetReturn(초과수익 귀속용)
}

export interface StrategyResult {
  params: StrategyParams;
  months: string[]; // 체결(보유) 월 목록 = equity 진행 축
  equity: number[]; // months.length+1 (시작 1.0 포함) — equity[k]=months[k] 시작 시점 자본, 마지막=최종
  monthlyReturns: number[]; // 각 체결월 net 수익(months와 동일 길이)
  grossMonthlyReturns: number[];
  cashMonthlyReturns: number[]; // 각 체결월 현금(BIL) 수익 — Sharpe 무위험 기준
  records: RebalanceRecord[];
  turnoverSeries: number[]; // 각 체결월 편도 회전율
  costSeries: number[];
  trades: RealizedTrade[];
  entryDates: string[]; // months와 정렬된 실제 체결일
  firstSignalMonth: string;
  note: string;
}

// ─── 데이터 준비 헬퍼 ────────────────────────────────────────
export interface FirstOpenPoint {
  date: string;
  open: number;
}

/** 각 캘린더 달의 "첫 유효 거래일"의 adjOpen(체결가). truncateGaps 후 계산. */
export function firstOpenByMonth(series: AdjSeries): Map<string, FirstOpenPoint> {
  const trunc = truncateGaps(series);
  const out = new Map<string, FirstOpenPoint>();
  for (let i = 0; i < trunc.dates.length; i++) {
    const o = trunc.adjOpen[i];
    if (typeof o !== 'number' || !isFinite(o)) continue;
    const key = trunc.dates[i].slice(0, 7);
    if (!out.has(key)) out.set(key, { date: trunc.dates[i], open: o });
  }
  return out;
}

/** 단일 심볼 월말 종가 맵(YYYY-MM → adjClose). 절대 모멘텀·현금 비교용. */
export function monthEndCloseByMonth(series: AdjSeries): Map<string, number> {
  const trunc = truncateGaps(series);
  const me = toMonthEnd(trunc);
  const out = new Map<string, number>();
  for (let k = 0; k < me.dates.length; k++) out.set(me.dates[k].slice(0, 7), me.adjClose[k]);
  return out;
}

/** 다음 캘린더 월 키(YYYY-MM). */
export function nextMonthKey(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

// ─── 선정(완충) ──────────────────────────────────────────────
/**
 * 완충 규칙(사전등록 §3): 보유 종목이 상위 bufferTop 이내면 유지, 밖으로 나가면
 * 신규 상위(최고 순위 비보유)로 채운다. 반환은 자산 인덱스 배열(길이 ≤ topN).
 * scores 는 유니버스 순서의 상대모멘텀 점수(null=계산불가).
 */
export function selectWithBuffer(
  scores: (number | null)[],
  prevHeldIdx: number[],
  topN: number,
  bufferTop: number
): number[] {
  const ranked = scores
    .map((s, i) => ({ i, s }))
    .filter((x): x is { i: number; s: number } => x.s !== null && isFinite(x.s))
    .sort((a, b) => b.s - a.s)
    .map(x => x.i);

  const bufferSet = new Set(ranked.slice(0, bufferTop));
  // 보유 중 상위 bufferTop 이내인 것 유지(원래 보유 순서 보존).
  const kept = prevHeldIdx.filter(i => bufferSet.has(i));
  const result: number[] = [];
  for (const i of kept) if (!result.includes(i) && result.length < topN) result.push(i);
  // 남은 슬롯을 최고 순위 비보유로 채움.
  for (const i of ranked) {
    if (result.length >= topN) break;
    if (!result.includes(i)) result.push(i);
  }
  return result;
}

// ─── 시뮬레이션 ──────────────────────────────────────────────
export interface SimInputs {
  seriesMap: Map<string, AdjSeries>;
}

interface Prepared {
  panel6: MonthlyPanel; // 신호 유니버스 월말 종가(공통구간·capMonths)
  firstOpen: Map<string, Map<string, FirstOpenPoint>>; // symbol → month → open
  cashClose: Map<string, number>; // cashSymbol 월말 종가
  months6: string[];
}

function prepare(inputs: SimInputs, params: StrategyParams): Prepared {
  let panel6 = buildPanel(inputs.seriesMap, params.universe);
  panel6 = restrictToCommonMonths(panel6);
  panel6 = capMonths(panel6, params.lastCompleteMonth);

  const firstOpen = new Map<string, Map<string, FirstOpenPoint>>();
  for (const sym of [...params.universe, params.cashSymbol]) {
    const s = inputs.seriesMap.get(sym);
    if (!s || !s.ok) throw new Error(`series missing/failed for ${sym}: ${s?.error ?? 'no-series'}`);
    firstOpen.set(sym, firstOpenByMonth(s));
  }
  const cashSeries = inputs.seriesMap.get(params.cashSymbol);
  if (!cashSeries || !cashSeries.ok) throw new Error(`cash series ${params.cashSymbol} missing`);
  const cashClose = monthEndCloseByMonth(cashSeries);

  return { panel6, firstOpen, cashClose, months6: panel6.months };
}

/** 심볼의 체결월 e → 다음달 첫 거래일 open 대비 수익. 데이터 없으면 예외(무결성). */
function openToOpenReturn(
  firstOpen: Map<string, Map<string, FirstOpenPoint>>,
  symbol: string,
  execMonth: string,
  exitMonth: string
): { r: number; entryDate: string } {
  const m = firstOpen.get(symbol);
  if (!m) throw new Error(`no firstOpen map for ${symbol}`);
  const a = m.get(execMonth);
  const b = m.get(exitMonth);
  if (!a || !b) throw new Error(`missing open for ${symbol} ${execMonth}->${exitMonth}`);
  return { r: b.open / a.open - 1, entryDate: a.date };
}

/**
 * 1차(및 파라미터화) 전략 시뮬레이션.
 * 반환: 자산곡선·월수익·리밸런싱기록·회전율·실현거래.
 */
export function simulate(inputs: SimInputs, params: StrategyParams): StrategyResult {
  const prep = prepare(inputs, params);
  const { panel6, firstOpen, cashClose, months6 } = prep;
  const n = params.universe.length;

  // 첫 신호가 유효한 시점: relMomentum 은 t-maxWindow<0 이면 null.
  const maxW = Math.max(...params.windows);
  // 체결월 e=months6[t] 의 신호는 months6[t-1]. 신호 유효 조건: (t-1) >= maxW.
  // 또한 절대모멘텀 비교는 signalIdx - absLookback >= 0 필요.
  const minSignalIdx = Math.max(maxW, params.absLookback);
  const firstExecT = minSignalIdx + 1; // t 최소값

  const months: string[] = [];
  const entryDates: string[] = [];
  const equity: number[] = [1];
  const monthlyReturns: number[] = [];
  const grossMonthlyReturns: number[] = [];
  const cashMonthlyReturns: number[] = [];
  const records: RebalanceRecord[] = [];
  const turnoverSeries: number[] = [];
  const costSeries: number[] = [];
  const trades: RealizedTrade[] = [];

  // 시작 상태: 100% 현금(BIL) 보유(첫 진입 시 매수비용 계상).
  let prevWeights = new Map<string, number>([[params.cashSymbol, 1]]);
  let prevHeldIdx: number[] = []; // 완충용(현금 대피 전 자산 인덱스)
  let lastTarget = new Map<string, number>([[params.cashSymbol, 1]]);
  let firstSignalMonth = '';

  const K = months6.length - 1;
  const rebEvery = params.rebalance === 'quarterly' ? 3 : 1;

  for (let t = firstExecT; t <= K; t++) {
    const execMonth = months6[t];
    const signalMonth = months6[t - 1];
    const signalIdx = t - 1;
    const exitMonth = nextMonthKey(execMonth);
    if (!firstSignalMonth) firstSignalMonth = signalMonth;

    const doRebalance = (t - firstExecT) % rebEvery === 0;

    // ── 목표 가중 결정 ──
    let target: Map<string, number>;
    let selectedRaw: string[] = [];
    if (doRebalance) {
      const scores = relMomentum(panel6, signalIdx, params.windows);
      const selIdx = selectWithBuffer(scores, prevHeldIdx, params.topN, params.bufferTop);
      selectedRaw = selIdx.map(i => params.universe[i]);

      // 절대 모멘텀(현금 대피): 자산 12m 절대수익 ≤ BIL 12m → 그 슬롯 현금.
      const bilNow = cashClose.get(signalMonth);
      const bilPast = cashClose.get(months6[signalIdx - params.absLookback]);
      const bil12 =
        typeof bilNow === 'number' && typeof bilPast === 'number' && bilPast !== 0
          ? bilNow / bilPast - 1
          : 0;

      target = new Map<string, number>();
      const slotW = 1 / params.topN;
      for (const i of selIdx) {
        const now = panel6.close[signalIdx][i];
        const past = panel6.close[signalIdx - params.absLookback][i];
        const abs12 =
          typeof now === 'number' && typeof past === 'number' && past !== 0 ? now / past - 1 : -Infinity;
        const useCash = !(abs12 > bil12); // ≤ 이면 현금(동률 포함 현금).
        const sym = useCash ? params.cashSymbol : params.universe[i];
        target.set(sym, (target.get(sym) ?? 0) + slotW);
      }
      // 선정이 topN 미만이면(초기 부분표본) 나머지는 현금.
      const filled = Array.from(target.values()).reduce((a, b) => a + b, 0);
      if (filled < 1 - 1e-12) {
        target.set(params.cashSymbol, (target.get(params.cashSymbol) ?? 0) + (1 - filled));
      }
      prevHeldIdx = selIdx.slice();
    } else {
      // 리밸런싱 안 하는 달: 직전 목표를 그대로 이어간다(드리프트 반영은 회전율=0).
      target = new Map(lastTarget);
      selectedRaw = prevHeldIdx.map(i => params.universe[i]);
    }

    // ── 이번 달 각 심볼 수익 ──
    const symReturns = new Map<string, number>();
    const allSyms = new Set<string>([...target.keys(), ...prevWeights.keys()]);
    let entryDate = '';
    for (const sym of allSyms) {
      const { r, entryDate: ed } = openToOpenReturn(firstOpen, sym, execMonth, exitMonth);
      symReturns.set(sym, r);
      if (!entryDate) entryDate = ed;
    }

    // ── 회전율·비용(드리프트된 직전 가중 대비) ──
    // 직전 보유는 지난 달 수익으로 드리프트되어 있음. 여기서 prevWeights 는
    // "이번 달 시작 시점" 드리프트 완료 상태로 이미 갱신되어 들어온다.
    let sumAbs = 0;
    const symsForTurn = new Set<string>([...target.keys(), ...prevWeights.keys()]);
    for (const sym of symsForTurn) {
      const wNew = target.get(sym) ?? 0;
      const wOld = prevWeights.get(sym) ?? 0;
      sumAbs += Math.abs(wNew - wOld);
    }
    const turnover = doRebalance ? 0.5 * sumAbs : 0;
    const cost = doRebalance ? params.costRate * sumAbs : 0;

    // ── 보유기간 수익 ──
    let gross = 0;
    for (const [sym, w] of target) {
      const r = symReturns.get(sym) ?? 0;
      gross += w * r;
      if (w > 0) {
        trades.push({
          symbol: sym,
          execMonth,
          weight: w,
          assetReturn: r,
          contribution: w * r,
        });
      }
    }
    const net = (1 - cost) * (1 + gross) - 1;

    // 현금 벤치(무위험) 이번 달 수익.
    const cashR = symReturns.has(params.cashSymbol)
      ? (symReturns.get(params.cashSymbol) as number)
      : openToOpenReturn(firstOpen, params.cashSymbol, execMonth, exitMonth).r;

    // ── 다음 달을 위한 드리프트 가중 갱신 ──
    const drift = new Map<string, number>();
    let denom = 0;
    for (const [sym, w] of target) {
      const g = w * (1 + (symReturns.get(sym) ?? 0));
      drift.set(sym, g);
      denom += g;
    }
    const nextWeights = new Map<string, number>();
    if (denom > 0) for (const [sym, g] of drift) nextWeights.set(sym, g / denom);

    // 기록.
    const holdings: Holding[] = Array.from(target.entries()).map(([sym, w]) => ({
      symbol: sym,
      weight: w,
      isCash: sym === params.cashSymbol,
    }));
    records.push({
      execMonth,
      signalMonth,
      entryDate,
      selectedRaw,
      holdings,
      turnover,
      cost,
      grossReturn: gross,
      netReturn: net,
      rebalanced: doRebalance,
    });
    months.push(execMonth);
    entryDates.push(entryDate);
    monthlyReturns.push(net);
    grossMonthlyReturns.push(gross);
    cashMonthlyReturns.push(cashR);
    turnoverSeries.push(turnover);
    costSeries.push(cost);
    equity.push(equity[equity.length - 1] * (1 + net));

    prevWeights = nextWeights;
    lastTarget = target;
    void n;
  }

  return {
    params,
    months,
    equity,
    monthlyReturns,
    grossMonthlyReturns,
    cashMonthlyReturns,
    records,
    turnoverSeries,
    costSeries,
    trades,
    entryDates,
    firstSignalMonth,
    note:
      '신호=월말 T 종가(relMomentum), 체결=T+1 첫 거래일 adjOpen, 보유=다음달 첫 거래일까지. 룩어헤드 없음.',
  };
}

// ─── 벤치마크(동일 체결 그리드·open-to-open·비용 0) ──────────
export interface BenchmarkSpec {
  key: string;
  label: string;
  weights: Record<string, number>; // 매월 리밸런싱되는 고정 가중
}

export interface BenchmarkResult {
  key: string;
  label: string;
  months: string[];
  equity: number[];
  monthlyReturns: number[];
}

/**
 * 전략과 동일한 체결월 그리드에서 고정 가중 포트폴리오(매월 리밸런싱, 비용 0)를
 * open-to-open 으로 시뮬레이션. 벤치마크 순수 성과 기준선.
 */
export function simulateBenchmark(
  inputs: SimInputs,
  params: StrategyParams,
  spec: BenchmarkSpec,
  execMonths: string[]
): BenchmarkResult {
  const firstOpen = new Map<string, Map<string, FirstOpenPoint>>();
  for (const sym of Object.keys(spec.weights)) {
    const s = inputs.seriesMap.get(sym);
    if (!s || !s.ok) throw new Error(`benchmark series ${sym} missing`);
    firstOpen.set(sym, firstOpenByMonth(s));
  }
  const equity: number[] = [1];
  const monthlyReturns: number[] = [];
  for (const e of execMonths) {
    const exit = nextMonthKey(e);
    let r = 0;
    for (const [sym, w] of Object.entries(spec.weights)) {
      const { r: ri } = openToOpenReturn(firstOpen, sym, e, exit);
      r += w * ri;
    }
    monthlyReturns.push(r);
    equity.push(equity[equity.length - 1] * (1 + r));
  }
  void params;
  return { key: spec.key, label: spec.label, months: execMonths.slice(), equity, monthlyReturns };
}
