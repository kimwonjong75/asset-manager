// scripts/backtest/spxDipBuy/engine.ts
// ---------------------------------------------------------------------------
// S&P500 전고점 대비 하락 분할매수 + 50일선 규칙 백테스트 엔진 (연구 전용, 순수 로직 — I/O 없음).
// 노드(검증)와 브라우저(결과 페이지) 양쪽에서 같은 코드가 돈다.
//
// 체결 규약(명세 §5):
//   · 거래일 i 종가로 신호를 확정하고 **다음 거래일 i+1 종가**에 체결한다. 마지막 관측일 신호는 미체결.
//   · 전고점 = 시계열 처음(1950~)부터의 종가 최고값. 시작일을 전고점으로 리셋하지 않는다.
//   · 각 하락 구간은 한 번만 실행(rearmOnNewHigh=false 기본). 하루에 여러 구간 통과 시 합산해 다음 날 체결.
//   · 매수금액은 초기원금 기준(잔여현금 비율 아님), 보유 현금을 넘으면 현금만큼만.
//   · 신호(전고점·이평선)는 항상 가격지수 `px`, 성과 계산은 `perf`(가격 또는 총수익지수).
//
// 규칙: `any`·`console.*`·`Math.random` 금지.
// ---------------------------------------------------------------------------

export interface SpxSeries {
  dates: string[]; // YYYY-MM-DD 오름차순
  px: number[]; // 신호용 가격지수
  perf: number[]; // 성과용 지수(가격 또는 총수익). 없으면 NaN
  /** 현금 연이율(%) — 날짜별. fixed 모드면 호출자가 상수 배열을 넣는다. */
  cashRate: number[];
}

export interface Tranche {
  /** 전고점 대비 하락률(%) — 예: -15 */
  dd: number;
  /** 초기원금 대비 투입 비중(%) */
  pct: number;
}

export type Reentry = 'none' | 'ma' | 'dip';
export type StartState = 'wait' | 'out';

export interface StrategyParams {
  label: string;
  kind: 'lump' | 'dca' | 'rule';
  /** dca: 균등 분할 개월 수 */
  dcaMonths: number;
  /** rule: 시작일 다음 거래일에 즉시 투입할 비중(%) */
  upfrontPct: number;
  tranches: Tranche[];
  /** >0 이면 시작 후 N개월 시점에 남은 현금을 전부 투입 */
  deadlineMonths: number;
  /** 신고가(전고점 갱신) 시 실행 이력을 초기화(명세 기본 false) */
  rearmOnNewHigh: boolean;
  /** rule 시작 상태: wait(하락 대기) | out(이평선 재진입 대기 — 추세추종 전용) */
  startState: StartState;
  ma: {
    n: number;
    sellEnabled: boolean;
    /** 이평선 이탈 폭(%) — 종가 < MA×(1−band) 이어야 이탈 */
    band: number;
    /** 연속 이탈 확인 일수 */
    confirmDays: number;
    /** true: 매수 후 한 번이라도 종가가 MA 위로 회복한 다음부터 매도 규칙 작동 */
    requireArm: boolean;
    reentry: Reentry;
    /** 재진입 시 MA×(1+reentryBand) 위에서만 */
    reentryBand: number;
    /** 재진입 매수 범위: all=보유 현금 전부 / sold=매도로 회수한 금액만(하락 대기 현금은 남김) */
    reentryScope: 'all' | 'sold';
    /** true: 하락 매수 신호가 와도 종가가 MA 위일 때만 체결 */
    buyGate: boolean;
  };
}

export interface CommonParams {
  /** 거래비용 (편도, bp) */
  costBps: number;
  /** 원금(표시 정규화 값) */
  principal: number;
}

export interface RunEvent {
  idx: number;
  kind: 'buy' | 'sell';
  /** 체결금액(원금 단위) */
  amount: number;
  note: string;
}

export interface RunResult {
  startIdx: number;
  endIdx: number;
  finalValue: number;
  years: number;
  cagr: number; // 소수 (0.0868)
  totalReturn: number;
  mdd: number; // 계좌 MDD, 음수 소수
  marketMdd: number; // 같은 구간 지수(perf) MDD
  daysToFirstBuy: number | null; // 캘린더 일
  daysToFullInvest: number | null;
  endCashPct: number; // 종료 시 현금 비중 %
  avgInvestedPct: number; // 기간 평균 투자비중 %
  buys: number;
  sells: number;
  /** 상세 모드에서만 채움 */
  curve?: number[];
  events?: RunEvent[];
}

export const DEFAULT_COMMON: CommonParams = { costBps: 0, principal: 100 };

export const DEFAULT_TRANCHES: Tranche[] = [
  { dd: -15, pct: 20 },
  { dd: -20, pct: 20 },
  { dd: -25, pct: 20 },
  { dd: -30, pct: 40 },
];

function baseMa(n: number): StrategyParams['ma'] {
  return {
    n,
    sellEnabled: false,
    band: 0,
    confirmDays: 1,
    requireArm: true,
    reentry: 'none',
    reentryBand: 0,
    reentryScope: 'all',
    buyGate: false,
  };
}

function baseRule(label: string, n: number): StrategyParams {
  return {
    label,
    kind: 'rule',
    dcaMonths: 12,
    upfrontPct: 0,
    tranches: [],
    deadlineMonths: 0,
    rearmOnNewHigh: false,
    startState: 'wait',
    ma: baseMa(n),
  };
}

/** 기본 프리셋 6종: A 일시 · B 12개월 분할 · C 하락분할 · D 이평선만 · E 하락분할+이평선매도(가) · F 하락분할+이평선확인(나). */
export function defaultStrategies(maN = 50): StrategyParams[] {
  const A: StrategyParams = { ...baseRule('A 일시매수', maN), kind: 'lump' };
  const B: StrategyParams = { ...baseRule('B 12개월 분할', maN), kind: 'dca', dcaMonths: 12 };
  const C: StrategyParams = { ...baseRule('C 하락 분할', maN), tranches: DEFAULT_TRANCHES.map(t => ({ ...t })) };
  const D: StrategyParams = {
    ...baseRule('D 이평선만', maN),
    startState: 'out',
    ma: { ...baseMa(maN), sellEnabled: true, requireArm: false, reentry: 'ma' },
  };
  const E: StrategyParams = {
    ...baseRule('E 하락분할+이평선 매도', maN),
    tranches: DEFAULT_TRANCHES.map(t => ({ ...t })),
    ma: { ...baseMa(maN), sellEnabled: true, requireArm: true, reentry: 'ma', reentryScope: 'sold' },
  };
  const F: StrategyParams = {
    ...baseRule('F 하락분할+이평선 확인', maN),
    tranches: DEFAULT_TRANCHES.map(t => ({ ...t })),
    ma: { ...baseMa(maN), buyGate: true },
  };
  return [A, B, C, D, E, F];
}

// ---------------------------------------------------------------------------
// 사전 계산
// ---------------------------------------------------------------------------

export interface Prepared {
  s: SpxSeries;
  runHigh: number[];
  /** 달력 간격(일) dayGap[i] = date[i]-date[i-1] */
  dayGap: number[];
  epochDays: number[];
  smaCache: Map<number, number[]>;
}

function toEpochDay(d: string): number {
  return Math.floor(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000);
}

export function prepare(s: SpxSeries): Prepared {
  const n = s.px.length;
  const runHigh = new Array<number>(n);
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (s.px[i] > hi) hi = s.px[i];
    runHigh[i] = hi;
  }
  const epochDays = s.dates.map(toEpochDay);
  const dayGap = epochDays.map((e, i) => (i === 0 ? 0 : e - epochDays[i - 1]));
  return { s, runHigh, dayGap, epochDays, smaCache: new Map() };
}

export function getSma(p: Prepared, n: number): number[] {
  const hit = p.smaCache.get(n);
  if (hit) return hit;
  const px = p.s.px;
  const out = new Array<number>(px.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < px.length; i++) {
    sum += px[i];
    if (i >= n) sum -= px[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  p.smaCache.set(n, out);
  return out;
}

/** 날짜 이상인 첫 거래일 인덱스(없으면 -1) */
export function firstIdxOnOrAfter(p: Prepared, date: string): number {
  const d = p.s.dates;
  let lo = 0;
  let hi = d.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (d[mid] >= date) {
      ans = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  return ans;
}

export function addMonths(date: string, months: number): string {
  const y = +date.slice(0, 4);
  const m = +date.slice(5, 7) - 1 + months;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  const dim = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  const dd = Math.min(+date.slice(8, 10), dim);
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// 단일 실행
// ---------------------------------------------------------------------------

export function runStrategy(
  p: Prepared,
  strat: StrategyParams,
  common: CommonParams,
  startIdx: number,
  endIdx: number,
  detail = false
): RunResult | null {
  const { s, runHigh } = p;
  if (startIdx < 0 || endIdx <= startIdx || endIdx >= s.px.length) return null;
  if (!isFinite(s.perf[startIdx]) || !isFinite(s.perf[endIdx])) return null;

  const cost = common.costBps / 10000;
  const principal = common.principal;
  const ma = strat.ma;
  const sma = getSma(p, ma.n);

  let cash = principal;
  let shares = 0;
  const startDate = s.dates[startIdx];

  // 예약 주문(다음 거래일 체결)
  let pendBuy = 0; // 원금 단위 금액
  let pendBuyAll = false;
  let pendSell = false;
  let soldProceeds = 0;
  // 하락 구간 상태
  const executed = strat.tranches.map(() => false);
  let queuedAmt = 0; // buyGate 대기 중인 하락 매수액
  // 이평선 상태
  type State = 'wait' | 'in' | 'out';
  let state: State = strat.kind === 'rule' ? strat.startState : 'wait';
  let armed = false;
  let belowCount = 0;
  let deadlineDone = false;
  const deadlineIdx = strat.deadlineMonths > 0 ? firstIdxOnOrAfter(p, addMonths(startDate, strat.deadlineMonths)) : -1;

  // DCA 신호일 테이블
  const dcaSignal = new Map<number, number>();
  if (strat.kind === 'dca') {
    const per = principal / strat.dcaMonths;
    for (let m = 0; m < strat.dcaMonths; m++) {
      const idx = m === 0 ? startIdx : firstIdxOnOrAfter(p, addMonths(startDate, m));
      if (idx >= 0) dcaSignal.set(idx, (dcaSignal.get(idx) ?? 0) + per);
    }
  }

  const events: RunEvent[] = [];
  const curve: number[] = detail ? [] : [];
  let buys = 0;
  let sells = 0;
  let firstBuyIdx = -1;
  let fullIdx = -1;
  let spentTotal = 0;
  let peakVal = principal;
  let mdd = 0;
  let investedSum = 0;
  let investedDays = 0;

  let mPeak = s.perf[startIdx];
  let mMdd = 0;

  const upfront = strat.kind === 'rule' ? (principal * strat.upfrontPct) / 100 : 0;

  for (let i = startIdx; i <= endIdx; i++) {
    // 1) 현금 이자 (이전 거래일→오늘)
    if (i > startIdx && cash > 0) {
      cash *= 1 + (s.cashRate[i - 1] / 100) * (p.dayGap[i] / 365);
    }

    // 2) 어제 확정한 주문을 오늘 종가에 체결
    if (i > startIdx) {
      const perf = s.perf[i];
      if (pendSell && shares > 0) {
        const proceeds = shares * perf * (1 - cost);
        events.push({ idx: i, kind: 'sell', amount: proceeds, note: 'MA 이탈 매도' });
        cash += proceeds;
        soldProceeds = proceeds;
        shares = 0;
        sells++;
        state = 'out';
        if (ma.reentryScope === 'all') for (let k = 0; k < executed.length; k++) executed[k] = false;
        queuedAmt = 0;
        armed = false;
      }
      pendSell = false;
      let spend = 0;
      if (pendBuyAll) spend = cash;
      else if (pendBuy > 0) spend = Math.min(pendBuy, cash);
      if (spend > 1e-12) {
        shares += (spend * (1 - cost)) / perf;
        cash -= spend;
        spentTotal += spend;
        buys++;
        if (firstBuyIdx < 0) firstBuyIdx = i;
        if (state !== 'in') state = 'in';
        armed = false;
        events.push({ idx: i, kind: 'buy', amount: spend, note: pendBuyAll ? '전액 매수' : '분할 매수' });
        if (spentTotal >= principal - 1e-6 && fullIdx < 0) fullIdx = i;
      }
      pendBuy = 0;
      pendBuyAll = false;
    }

    // 3) 계좌 평가 기록
    const value = cash + shares * s.perf[i];
    if (detail) curve.push(value);
    if (value > peakVal) peakVal = value;
    const dd = value / peakVal - 1;
    if (dd < mdd) mdd = dd;
    if (s.perf[i] > mPeak) mPeak = s.perf[i];
    const mdd0 = s.perf[i] / mPeak - 1;
    if (mdd0 < mMdd) mMdd = mdd0;
    if (value > 0) {
      investedSum += (shares * s.perf[i]) / value;
      investedDays++;
    }

    // 마지막 관측일 신호는 미체결
    if (i === endIdx) break;

    // 4) 종가 기준 신호 확정 → 다음 거래일 주문
    const px = s.px[i];
    const maNow = sma[i];
    const maOk = isFinite(maNow);

    if (strat.kind === 'lump') {
      if (i === startIdx) pendBuyAll = true;
    } else if (strat.kind === 'dca') {
      const amt = dcaSignal.get(i);
      if (amt) pendBuy += amt;
    } else {
      if (i === startIdx && upfront > 0) pendBuy += upfront;

      // 신고가 시 구간 재무장
      if (strat.rearmOnNewHigh && px >= runHigh[i] && i > startIdx) {
        for (let k = 0; k < executed.length; k++) executed[k] = false;
      }

      // MA 위/아래 상태
      const above = maOk && px > maNow;
      if (above) armed = true;

      // 이평선 매도
      if (ma.sellEnabled && shares > 0 && !pendSell && maOk) {
        const below = px < maNow * (1 - ma.band / 100);
        belowCount = below ? belowCount + 1 : 0;
        if (below && belowCount >= ma.confirmDays && (armed || !ma.requireArm)) pendSell = true;
      } else if (!ma.sellEnabled) belowCount = 0;

      // OUT 상태 재진입
      if (state === 'out' && !pendSell) {
        if (ma.reentry === 'ma' && maOk && px > maNow * (1 + ma.reentryBand / 100) && cash > 1e-9) {
          if (ma.reentryScope === 'sold' && soldProceeds > 0) pendBuy += soldProceeds;
          else pendBuyAll = true;
        } else if (ma.reentry === 'dip' && px >= runHigh[i]) {
          state = 'wait';
          for (let k = 0; k < executed.length; k++) executed[k] = false;
        }
      }

      // 하락 분할 매수 신호 (wait / in 상태에서만)
      if (state !== 'out' && strat.tranches.length > 0 && !pendSell) {
        const ddNow = (px / runHigh[i] - 1) * 100;
        let add = 0;
        for (let k = 0; k < strat.tranches.length; k++) {
          const t = strat.tranches[k];
          // 부동소수점 경계(정확히 -20.000% 가 -19.999999…로 계산되는 경우) 보정
          if (!executed[k] && ddNow <= t.dd + 1e-9) {
            executed[k] = true;
            add += (principal * t.pct) / 100;
          }
        }
        // upfront 비율이 있으면 하락 구간 합계가 (100-upfront)가 되도록 스케일
        if (add > 0 && strat.upfrontPct > 0) {
          const totalPct = strat.tranches.reduce((a, t) => a + t.pct, 0);
          if (totalPct > 0) add *= (100 - strat.upfrontPct) / totalPct;
        }
        if (ma.buyGate) {
          queuedAmt += add;
          if (queuedAmt > 0 && maOk && px > maNow) {
            pendBuy += queuedAmt;
            queuedAmt = 0;
          }
        } else pendBuy += add;
      }

      // 데드라인: 남은 현금 전액
      if (!deadlineDone && deadlineIdx >= 0 && i >= deadlineIdx && state !== 'out' && cash > 1e-9) {
        pendBuyAll = true;
        deadlineDone = true;
      }
    }
  }

  const years = (p.epochDays[endIdx] - p.epochDays[startIdx]) / 365.25;
  const finalValue = cash + shares * s.perf[endIdx];
  const totalReturn = finalValue / principal - 1;
  const cagr = years > 0 ? Math.pow(finalValue / principal, 1 / years) - 1 : 0;
  const res: RunResult = {
    startIdx,
    endIdx,
    finalValue,
    years,
    cagr,
    totalReturn,
    mdd,
    marketMdd: mMdd,
    daysToFirstBuy: firstBuyIdx >= 0 ? p.epochDays[firstBuyIdx] - p.epochDays[startIdx] : null,
    daysToFullInvest: fullIdx >= 0 ? p.epochDays[fullIdx] - p.epochDays[startIdx] : null,
    endCashPct: finalValue > 0 ? (cash / finalValue) * 100 : 0,
    avgInvestedPct: investedDays > 0 ? (investedSum / investedDays) * 100 : 0,
    buys,
    sells,
  };
  if (detail) {
    res.curve = curve;
    res.events = events;
  }
  return res;
}

// ---------------------------------------------------------------------------
// 시작일 격자 + 집계
// ---------------------------------------------------------------------------

export interface Sweep {
  stepMonths: number; // 12 = 매년 초, 1 = 매월
  firstDate: string; // 이 날짜 이상 첫 거래일부터
  lastDate: string; // 이 날짜 이하 시작만
  horizonYears: number;
  /** true 면 종료일이 데이터 끝을 넘는 사례를 데이터 끝까지로 잘라 포함(미완료 표시) */
  allowIncomplete: boolean;
}

export interface StartCase {
  startIdx: number;
  endIdx: number;
  complete: boolean;
}

export function buildStarts(p: Prepared, sw: Sweep): StartCase[] {
  const out: StartCase[] = [];
  const last = p.s.px.length - 1;
  let cur = sw.firstDate;
  for (let guard = 0; guard < 2000 && cur <= sw.lastDate; guard++) {
    const si = firstIdxOnOrAfter(p, cur);
    if (si >= 0) {
      const endDate = addMonths(p.s.dates[si], Math.round(sw.horizonYears * 12));
      let ei = firstIdxOnOrAfter(p, endDate);
      let complete = true;
      if (ei < 0) {
        ei = last;
        complete = false;
      }
      if ((complete || sw.allowIncomplete) && ei > si) out.push({ startIdx: si, endIdx: ei, complete });
    }
    cur = addMonths(cur, sw.stepMonths);
  }
  return out;
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface Summary {
  n: number;
  finalMedian: number;
  finalMean: number;
  finalWorst: number;
  cagrMedian: number;
  cagrMean: number;
  cagrWorst: number;
  cagrP10: number;
  cagrP90: number;
  mddMedian: number;
  mddWorst: number;
  lossRate: number; // 손실 종료 비율
  beatBaseRate: number; // 기준 전략(A)을 앞선 비율
  excessMedian: number; // 기준 대비 최종가치 차이 중앙값
  firstBuyDaysMedian: number;
  fullInvestDaysMedian: number | null;
  fullInvestRate: number; // 전액 투자까지 간 비율
  endCashPctMedian: number;
  avgInvestedMedian: number;
}

const sortAsc = (a: number[]): number[] => a.slice().sort((x, y) => x - y);
const med = (a: number[]): number => quantile(sortAsc(a), 0.5);
const mean = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

export function summarize(runs: RunResult[], base: RunResult[] | null): Summary {
  const finals = runs.map(r => r.finalValue);
  const cagrs = sortAsc(runs.map(r => r.cagr));
  const mdds = runs.map(r => r.mdd);
  let beat = 0;
  const excess: number[] = [];
  if (base) {
    for (let k = 0; k < runs.length; k++) {
      if (runs[k].finalValue > base[k].finalValue) beat++;
      excess.push(runs[k].finalValue - base[k].finalValue);
    }
  }
  const fb = runs.map(r => r.daysToFirstBuy).filter((v): v is number => v !== null);
  const fi = runs.map(r => r.daysToFullInvest).filter((v): v is number => v !== null);
  return {
    n: runs.length,
    finalMedian: med(finals),
    finalMean: mean(finals),
    finalWorst: Math.min(...finals),
    cagrMedian: quantile(cagrs, 0.5),
    cagrMean: mean(cagrs),
    cagrWorst: cagrs[0],
    cagrP10: quantile(cagrs, 0.1),
    cagrP90: quantile(cagrs, 0.9),
    mddMedian: med(mdds),
    mddWorst: Math.min(...mdds),
    lossRate: runs.filter(r => r.finalValue < 100 - 1e-9).length / runs.length,
    beatBaseRate: base ? beat / runs.length : NaN,
    excessMedian: base ? med(excess) : NaN,
    firstBuyDaysMedian: fb.length ? med(fb) : NaN,
    fullInvestDaysMedian: fi.length ? med(fi) : null,
    fullInvestRate: fi.length / runs.length,
    endCashPctMedian: med(runs.map(r => r.endCashPct)),
    avgInvestedMedian: med(runs.map(r => r.avgInvestedPct)),
  };
}

export interface SweepResult {
  starts: StartCase[];
  runs: RunResult[][]; // [strategy][start]
  summaries: Summary[];
}

export function runSweep(
  p: Prepared,
  strategies: StrategyParams[],
  common: CommonParams,
  sw: Sweep,
  baseIndex = 0
): SweepResult {
  const starts = buildStarts(p, sw).filter(c => isFinite(p.s.perf[c.startIdx]) && isFinite(p.s.perf[c.endIdx]));
  const runs: RunResult[][] = strategies.map(st => {
    const out: RunResult[] = [];
    for (const c of starts) {
      const r = runStrategy(p, st, common, c.startIdx, c.endIdx, false);
      if (r) out.push(r);
    }
    return out;
  });
  const base = runs[baseIndex] ?? null;
  const summaries = runs.map((r, k) => summarize(r, k === baseIndex ? null : base));
  return { starts, runs, summaries };
}
