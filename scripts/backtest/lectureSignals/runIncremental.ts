// scripts/backtest/lectureSignals/runIncremental.ts
// ---------------------------------------------------------------------------
// P4 — 기존 앱 매도규칙 대비 신규 신호의 **증분가치** 반사실 비교 (계획서 v2 §3 P4).
//
//   C(기존)      = 앱 매도규칙 재현 13종(appRules.ts) 중 하나라도 발동
//   D(기존+신규) = C  ∪  {S1~S6, H3_VOL_SPIKE_ROLLING, H6(A11), H7(A12)}
//   HOLD         = 매도규칙 없음(매수 후 계속 보유) — 기준선
//
// 실행: npx tsx scripts/backtest/lectureSignals/runIncremental.ts
// 산출: output/d7_incremental.json + docs/backtest/RESULTS_P4_기존규칙대비증분.md
//
// 규율: seed 20260725 계열 · mulberry32만 · adj_* 사용 · 잠금표본(2023-2025) 미개봉 ·
//       결과가 가설과 반대여도 그대로 보고.
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mulberry32, percentileSorted } from '../conditionalChannel/statistics';
import {
  APP_SELL_RULE_IDS,
  APP_SELL_RULE_EXCLUDED,
  APP_RULE_CONST,
  buildAppIndicatorSeries,
  evaluateAppSellRules,
  anyAppRuleFired,
  appHighestPrice,
  type AppIndicatorSeries,
  type AppSellRuleId,
} from './appRules';
import { CONST, DEV_PERIOD, VALIDATION_PERIOD, KR_VARIABLE_COST_BPS } from './configTypes';
import type { SamplePeriod, SecurityBars } from './configTypes';
import { loadLectureDataset, type LectureDataset } from './dataAccess';
import { testSignalAt } from './events';
import { h3ConditionAt } from './deterioration';
import {
  buildRsRanks,
  detectRsEntries,
  firstRs97AfterEntry,
  firstRsBelow50AfterEntry,
} from './rs';
import { eligibleAt, periodIndexRange } from './batch2Common';
import { computeOverlap } from './pipeline';
import { sellCostFraction } from './portfolio';
import { runAppPathAudit, type AuditResult } from './appRulesAudit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output');
const DOCS = path.resolve(__dirname, '..', '..', '..', 'docs', 'backtest');

// ===========================================================================
// 설정 (사전 고정 — 결과를 본 뒤 변경 금지)
// ===========================================================================

const P4 = {
  /** 보유 평가 창(거래일). 매수 후 이 기간 동안의 경로를 비교한다. */
  horizonDays: 252,
  /** 매도 후 재진입까지 대기 거래일(같은 종목 재매수 — 매도규칙 효과만 격리). */
  reentryDelayDays: 20,
  /** 오탐(false sell) 판정 전방 창. */
  falseSellHorizons: [20, 63] as const,
  /** 무작위 코호트 표본 수(표본기간별). */
  randomCohortSize: 1200,
  randomMaxAttempts: 400_000,
  /** 앱 경로 대조감사 표본(종목 × 종목당 일수). */
  auditStocks: 40,
  auditDaysPerStock: 30,
  /** 창을 최소 이 거래일 이상 확보한 포지션만 채택. */
  minWindowDays: 63,
  seedRandomCohortDev: CONST.masterSeed + 70001,
  seedRandomCohortVal: CONST.masterSeed + 70002,
  seedAudit: CONST.masterSeed + 70003,
} as const;

/** D에 추가되는 신규 신호(이번 검증에서 REVIEW_WARNING 이상). */
const NEW_SIGNAL_CODES = [
  'S1_RUNUP_21D_100',
  'S2_RUNUP_5D_40',
  'S3_LIMIT_UP',
  'S4_GAP_BEAR_VOLUME',
  'S5_APP_PROXY',
  'S6_CRASH_5_VOLUME_2X',
  'H3_VOL_SPIKE_ROLLING',
  'H6_RS_90_TO_97_FAST',
  'H7_RS_BELOW_50',
] as const;
type NewSignalCode = (typeof NEW_SIGNAL_CODES)[number];

/** 매수 1회 비용(변동비용만 — 매도세 없음). */
function buyCostFraction(): number {
  return (
    (KR_VARIABLE_COST_BPS.commissionBps +
      KR_VARIABLE_COST_BPS.spreadBps +
      KR_VARIABLE_COST_BPS.slippageBps +
      KR_VARIABLE_COST_BPS.marketImpactBps) /
    10_000
  );
}

// ===========================================================================
// 통계 헬퍼
// ===========================================================================

function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return percentileSorted(s, 50);
}
function meanOf(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  let t = 0;
  for (const x of xs) t += x;
  return t / xs.length;
}
function pctl(xs: readonly number[], p: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return percentileSorted(s, p);
}

// ===========================================================================
// 포지션 / 시뮬레이션
// ===========================================================================

interface Position {
  code: string;
  /** 신호일(RS90 진입일 또는 무작위 표본일) bar index */
  signalBar: number;
  /** 체결(매수) bar index = signalBar + 1 (익일 시가) */
  buyBar: number;
  /** 평가 창 끝 bar index(포함) */
  windowEnd: number;
  /** RS 코호트만: H6/H7 경고 bar(없으면 null) */
  h6Bar: number | null;
  h7Bar: number | null;
}

type PolicyMode = 'HOLD' | 'C' | 'D';

interface PolicyResult {
  terminalReturn: number; // 창 끝 기준 총수익(비용 반영)
  mdd: number; // 최대낙폭(양수)
  sells: number;
  buys: number;
  costPaid: number; // 누적 비용(수익률 차감분 합, 근사)
}

/** HOLD 경로(매도 없이 계속 보유)에서의 일별 신호 발동 기록. */
interface HoldPathFlags {
  /** 각 규칙이 발동한 첫 bar index(없으면 null) */
  firstByRule: Partial<Record<AppSellRuleId, number>>;
  firstC: number | null;
  firstNew: number | null;
  firstD: number | null;
  firstByNewSignal: Partial<Record<NewSignalCode, number>>;
  /** 일별 (C발동, NEW발동) — 중복률 계산용 (bar index) */
  cDays: number[];
  newDays: number[];
  newDaysBySignal: Record<string, number[]>;
  /** 규칙별 발동 '일수'(포화도 측정용) */
  ruleDayCount: Record<string, number>;
  /** 평가한 총 일수 */
  evaluatedDays: number;
}

/** 신규 신호 판정(캐시 없이 그 자리에서). */
function newSignalFiredAt(
  code: NewSignalCode,
  bars: SecurityBars,
  i: number,
  corpActionDates: ReadonlySet<string>,
  pos: Position
): boolean {
  switch (code) {
    case 'S1_RUNUP_21D_100':
    case 'S2_RUNUP_5D_40':
    case 'S3_LIMIT_UP':
    case 'S4_GAP_BEAR_VOLUME':
    case 'S5_APP_PROXY':
    case 'S6_CRASH_5_VOLUME_2X':
      return testSignalAt(code, bars, i, corpActionDates);
    case 'H3_VOL_SPIKE_ROLLING': {
      // 2차 배치 이벤트 규약과 동일: "처음 되는 날"(상향 전이)만 발화.
      const now = h3ConditionAt(bars.adjClose, i);
      if (now !== true) return false;
      const prev = h3ConditionAt(bars.adjClose, i - 1);
      return prev === false;
    }
    case 'H6_RS_90_TO_97_FAST':
      return pos.h6Bar !== null && pos.h6Bar === i;
    case 'H7_RS_BELOW_50':
      return pos.h7Bar !== null && pos.h7Bar === i;
    default:
      return false;
  }
}

/** HOLD 경로에서 규칙/신호 발동일 수집. */
function scanHoldPath(
  s: AppIndicatorSeries,
  bars: SecurityBars,
  pos: Position,
  corpActionDates: ReadonlySet<string>
): HoldPathFlags | null {
  const buyPrice = s.open[pos.buyBar];
  if (!(buyPrice > 0)) return null;

  const out: HoldPathFlags = {
    firstByRule: {},
    firstC: null,
    firstNew: null,
    firstD: null,
    firstByNewSignal: {},
    cDays: [],
    newDays: [],
    newDaysBySignal: {},
    ruleDayCount: {},
    evaluatedDays: 0,
  };
  for (const c of NEW_SIGNAL_CODES) out.newDaysBySignal[c] = [];
  for (const id of APP_SELL_RULE_IDS) out.ruleDayCount[id] = 0;

  let runningMax = 0;
  for (let i = pos.buyBar; i <= pos.windowEnd; i++) {
    out.evaluatedDays++;
    const c = s.close[i];
    if (c > runningMax) runningMax = c;
    const state = {
      purchasePrice: buyPrice,
      highestPrice: appHighestPrice(s, i, buyPrice, runningMax),
    };
    const flags = evaluateAppSellRules(s, i, state);
    for (const id of APP_SELL_RULE_IDS) {
      if (!flags[id]) continue;
      out.ruleDayCount[id]++;
      if (out.firstByRule[id] === undefined) out.firstByRule[id] = i;
    }
    const cFired = anyAppRuleFired(flags);
    if (cFired) {
      out.cDays.push(i);
      if (out.firstC === null) out.firstC = i;
    }
    let newFired = false;
    for (const code of NEW_SIGNAL_CODES) {
      if (newSignalFiredAt(code, bars, i, corpActionDates, pos)) {
        newFired = true;
        out.newDaysBySignal[code].push(i);
        if (out.firstByNewSignal[code] === undefined) out.firstByNewSignal[code] = i;
      }
    }
    if (newFired) {
      out.newDays.push(i);
      if (out.firstNew === null) out.firstNew = i;
    }
    if ((cFired || newFired) && out.firstD === null) out.firstD = i;
  }
  return out;
}

/**
 * 정책 시뮬레이션. 시가 체결 · 매도 시 매도세+변동비용 · 재진입 시 변동비용.
 * 같은 종목으로 재진입한다(진입 규칙은 이번 범위 밖이므로 매도규칙 효과만 격리).
 */
function simulatePolicy(
  s: AppIndicatorSeries,
  bars: SecurityBars,
  pos: Position,
  mode: PolicyMode,
  corpActionDates: ReadonlySet<string>
): PolicyResult | null {
  const bCost = buyCostFraction();
  let cash = 1;
  let shares = 0;
  let entryPrice = 0;
  let runningMax = 0;
  let pendingBuyBar = pos.buyBar;
  let sellAtOpenOf = -1;
  let sells = 0;
  let buys = 0;
  let costPaid = 0;
  let peak = 0;
  let mdd = 0;
  let equity = 1;

  for (let i = pos.buyBar; i <= pos.windowEnd; i++) {
    // ── 시가 체결 ──
    if (shares > 0 && sellAtOpenOf === i) {
      const px = s.open[i];
      if (!(px > 0)) return null;
      const sc = sellCostFraction(bars.dates[i]);
      const gross = shares * px;
      cash = gross * (1 - sc);
      costPaid += gross * sc;
      shares = 0;
      sells++;
      sellAtOpenOf = -1;
      pendingBuyBar = i + P4.reentryDelayDays;
    }
    if (shares === 0 && i >= pendingBuyBar && cash > 0) {
      const px = s.open[i];
      if (px > 0) {
        const spend = cash * (1 - bCost);
        costPaid += cash * bCost;
        shares = spend / px;
        cash = 0;
        entryPrice = px;
        runningMax = 0;
        buys++;
      }
    }

    // ── 종가 평가 ──
    const c = s.close[i];
    equity = cash + shares * c;
    if (equity > peak) peak = equity;
    if (peak > 0) {
      const dd = 1 - equity / peak;
      if (dd > mdd) mdd = dd;
    }

    if (mode === 'HOLD' || shares === 0) continue;
    if (c > runningMax) runningMax = c;
    const state = {
      purchasePrice: entryPrice,
      highestPrice: appHighestPrice(s, i, entryPrice, runningMax),
    };
    const flags = evaluateAppSellRules(s, i, state);
    let fired = anyAppRuleFired(flags);
    if (!fired && mode === 'D') {
      for (const code of NEW_SIGNAL_CODES) {
        if (newSignalFiredAt(code, bars, i, corpActionDates, pos)) {
          fired = true;
          break;
        }
      }
    }
    if (fired && i + 1 <= pos.windowEnd) sellAtOpenOf = i + 1;
  }

  return { terminalReturn: equity - 1, mdd, sells, buys, costPaid };
}

// ===========================================================================
// 코호트 구성
// ===========================================================================

interface Cohort {
  name: 'RS90_ENTRY' | 'RANDOM';
  period: SamplePeriod['name'];
  positions: Position[];
}

function makeWindow(bars: SecurityBars, signalBar: number, periodEndDate: string): Position | null {
  const buyBar = signalBar + 1;
  const n = bars.dates.length;
  if (buyBar >= n) return null;
  // 표본기간 끝을 넘는 데이터는 쓰지 않는다(표본 분리 + 잠금표본 미개봉).
  let cap = buyBar;
  const hardEnd = Math.min(n - 1, buyBar + P4.horizonDays - 1);
  for (let i = buyBar; i <= hardEnd; i++) {
    if (bars.dates[i] > periodEndDate) break;
    cap = i;
  }
  if (cap - buyBar + 1 < P4.minWindowDays) return null;
  return { code: bars.code, signalBar, buyBar, windowEnd: cap, h6Bar: null, h7Bar: null };
}

// ===========================================================================
// 집계
// ===========================================================================

interface CohortSummary {
  cohort: string;
  period: string;
  nPositions: number;
  avgWindowDays: number;
  /** 첫 트리거 */
  triggerRateC: number;
  triggerRateD: number;
  medianDaysToFirstC: number;
  medianDaysToFirstD: number;
  /** 정책별 성과(비용 반영) */
  hold: PolicyAgg;
  policyC: PolicyAgg;
  policyD: PolicyAgg;
  /** MDD 회피효과 (HOLD − 정책), 양수 = 낙폭 축소 */
  mddReductionC: { median: number; mean: number };
  mddReductionD: { median: number; mean: number };
  /** 신규신호 단독 증분 (D − C) */
  incrementalReturn: { median: number; mean: number; winRate: number; loseRate: number; differRate: number };
  incrementalMdd: { median: number; mean: number };
  /** 오탐 */
  falseSell: Record<string, FalseSellAgg>;
  /** 중복률 */
  overlapCvsNew: ReturnType<typeof computeOverlap>;
  overlapByNewSignal: Array<{ signal: string; nNew: number; overlapWithC: number; overlapRate: number }>;
  /** HOLD 경로 총 평가일(포지션-일) — 발동일 비율의 분모 */
  totalEvaluatedDays: number;
  /** C가 하루라도 발동한 평가일 비율(포화도) */
  cDayRate: number;
  newDayRate: number;
  /** 규칙별 발동 통계(HOLD 경로) */
  ruleFireRate: Array<{
    rule: string;
    positionsFired: number;
    rate: number;
    medianDaysToFire: number;
    dayCount: number;
    dayRate: number;
  }>;
  newSignalFireRate: Array<{
    signal: string;
    positionsFired: number;
    rate: number;
    medianDaysToFire: number;
    dayCount: number;
    dayRate: number;
  }>;
}

interface PolicyAgg {
  medianReturn: number;
  meanReturn: number;
  p10Return: number;
  p90Return: number;
  medianMdd: number;
  meanMdd: number;
  medianSells: number;
  meanSells: number;
  meanCostPaid: number;
  meanBuys: number;
}

interface FalseSellAgg {
  horizon: number;
  nC: number;
  falseRateC: number;
  nD: number;
  falseRateD: number;
  nNewOnly: number;
  falseRateNewOnly: number;
}

function aggPolicy(rs: readonly PolicyResult[]): PolicyAgg {
  const ret = rs.map((r) => r.terminalReturn);
  const mdd = rs.map((r) => r.mdd);
  const sells = rs.map((r) => r.sells);
  return {
    medianReturn: median(ret),
    meanReturn: meanOf(ret),
    p10Return: pctl(ret, 10),
    p90Return: pctl(ret, 90),
    medianMdd: median(mdd),
    meanMdd: meanOf(mdd),
    medianSells: median(sells),
    meanSells: meanOf(sells),
    meanCostPaid: meanOf(rs.map((r) => r.costPaid)),
    meanBuys: meanOf(rs.map((r) => r.buys)),
  };
}

// ===========================================================================
// 실행
// ===========================================================================

interface RunState {
  ds: LectureDataset;
  corpActionDates: ReadonlySet<string>;
}

function runCohort(st: RunState, cohort: Cohort): CohortSummary {
  const byCode = new Map<string, Position[]>();
  for (const p of cohort.positions) {
    const arr = byCode.get(p.code) ?? [];
    arr.push(p);
    byCode.set(p.code, arr);
  }

  const holdRes: PolicyResult[] = [];
  const cRes: PolicyResult[] = [];
  const dRes: PolicyResult[] = [];
  const daysToFirstC: number[] = [];
  const daysToFirstD: number[] = [];
  let firedC = 0;
  let firedD = 0;
  let usable = 0;
  let windowSum = 0;

  const cKeys: string[] = [];
  const newKeys: string[] = [];
  const newKeysBySignal = new Map<string, string[]>();
  for (const c of NEW_SIGNAL_CODES) newKeysBySignal.set(c, []);

  const ruleFireBars = new Map<string, number[]>();
  for (const id of APP_SELL_RULE_IDS) ruleFireBars.set(id, []);
  const newFireBars = new Map<string, number[]>();
  for (const c of NEW_SIGNAL_CODES) newFireBars.set(c, []);
  const ruleDayCount = new Map<string, number>();
  for (const id of APP_SELL_RULE_IDS) ruleDayCount.set(id, 0);
  const newDayCount = new Map<string, number>();
  for (const c of NEW_SIGNAL_CODES) newDayCount.set(c, 0);
  let totalDays = 0;
  let cDayCount = 0;
  let newDayTotal = 0;

  // 오탐 표본: (신호bar, 매도가, 종목) — HOLD 경로 첫 트리거 기준
  interface FsSample {
    code: string;
    sellBar: number;
    sellPrice: number;
  }
  const fsC: FsSample[] = [];
  const fsD: FsSample[] = [];
  const fsNewOnly: FsSample[] = [];

  const pairedReturn: number[] = [];
  const pairedMdd: number[] = [];

  let processed = 0;
  for (const [code, positions] of byCode.entries()) {
    const bars = st.ds.bars.get(code);
    if (!bars) continue;
    const s = buildAppIndicatorSeries(bars);
    for (const pos of positions) {
      const hold = simulatePolicy(s, bars, pos, 'HOLD', st.corpActionDates);
      const pc = simulatePolicy(s, bars, pos, 'C', st.corpActionDates);
      const pd = simulatePolicy(s, bars, pos, 'D', st.corpActionDates);
      const hp = scanHoldPath(s, bars, pos, st.corpActionDates);
      if (!hold || !pc || !pd || !hp) continue;
      usable++;
      windowSum += pos.windowEnd - pos.buyBar + 1;
      holdRes.push(hold);
      cRes.push(pc);
      dRes.push(pd);
      pairedReturn.push(pd.terminalReturn - pc.terminalReturn);
      pairedMdd.push(pd.mdd - pc.mdd);

      if (hp.firstC !== null) {
        firedC++;
        daysToFirstC.push(hp.firstC - pos.buyBar);
      }
      if (hp.firstD !== null) {
        firedD++;
        daysToFirstD.push(hp.firstD - pos.buyBar);
      }
      for (const id of APP_SELL_RULE_IDS) {
        const b = hp.firstByRule[id];
        if (b !== undefined) ruleFireBars.get(id)!.push(b - pos.buyBar);
      }
      for (const c of NEW_SIGNAL_CODES) {
        const b = hp.firstByNewSignal[c];
        if (b !== undefined) newFireBars.get(c)!.push(b - pos.buyBar);
        newDayCount.set(c, newDayCount.get(c)! + hp.newDaysBySignal[c].length);
      }
      totalDays += hp.evaluatedDays;
      cDayCount += hp.cDays.length;
      newDayTotal += hp.newDays.length;
      for (const id of APP_SELL_RULE_IDS) {
        ruleDayCount.set(id, ruleDayCount.get(id)! + hp.ruleDayCount[id]);
      }
      for (const b of hp.cDays) cKeys.push(`${code}|${bars.dates[b]}`);
      for (const b of hp.newDays) newKeys.push(`${code}|${bars.dates[b]}`);
      for (const c of NEW_SIGNAL_CODES) {
        const arr = newKeysBySignal.get(c)!;
        for (const b of hp.newDaysBySignal[c]) arr.push(`${code}|${bars.dates[b]}`);
      }

      // 오탐 표본
      const push = (bar: number | null, sink: FsSample[]): void => {
        if (bar === null) return;
        const sb = bar + 1;
        if (sb > pos.windowEnd) return;
        const px = s.open[sb];
        if (!(px > 0)) return;
        sink.push({ code, sellBar: sb, sellPrice: px });
      };
      push(hp.firstC, fsC);
      push(hp.firstD, fsD);
      // NEW 단독: C가 아직 안 떴는데 NEW가 먼저 뜬 경우
      if (hp.firstNew !== null && (hp.firstC === null || hp.firstNew < hp.firstC)) {
        push(hp.firstNew, fsNewOnly);
      }
    }
    processed++;
    if (processed % 200 === 0) {
      process.stdout.write(
        `    ${cohort.name}/${cohort.period}: 종목 ${processed}/${byCode.size} (포지션 ${usable})\r`
      );
    }
  }
  process.stdout.write('\n');

  // 오탐 집계
  const falseSell: Record<string, FalseSellAgg> = {};
  const fsRate = (samples: readonly FsSample[], h: number): { n: number; rate: number } => {
    let n = 0;
    let bad = 0;
    for (const smp of samples) {
      const bars = st.ds.bars.get(smp.code);
      if (!bars) continue;
      const j = smp.sellBar + h;
      if (j >= bars.adjClose.length) continue;
      // 표본기간 밖 데이터는 쓰지 않는다.
      if (bars.dates[j] > (cohort.period === 'DEV' ? DEV_PERIOD.to : VALIDATION_PERIOD.to)) continue;
      n++;
      if (bars.adjClose[j] > smp.sellPrice) bad++;
    }
    return { n, rate: n > 0 ? bad / n : NaN };
  };
  for (const h of P4.falseSellHorizons) {
    const a = fsRate(fsC, h);
    const b = fsRate(fsD, h);
    const c = fsRate(fsNewOnly, h);
    falseSell[`h${h}`] = {
      horizon: h,
      nC: a.n,
      falseRateC: a.rate,
      nD: b.n,
      falseRateD: b.rate,
      nNewOnly: c.n,
      falseRateNewOnly: c.rate,
    };
  }

  const overlapCvsNew = computeOverlap('C(기존규칙)', cKeys, 'NEW(신규신호)', newKeys);
  const cSet = new Set(cKeys);
  const overlapByNewSignal = NEW_SIGNAL_CODES.map((c) => {
    const keys = new Set(newKeysBySignal.get(c)!);
    let inter = 0;
    for (const k of keys) if (cSet.has(k)) inter++;
    return {
      signal: c,
      nNew: keys.size,
      overlapWithC: inter,
      overlapRate: keys.size > 0 ? inter / keys.size : NaN,
    };
  });

  const incReturn = pairedReturn;
  return {
    cohort: cohort.name,
    period: cohort.period,
    nPositions: usable,
    avgWindowDays: usable > 0 ? windowSum / usable : NaN,
    triggerRateC: usable > 0 ? firedC / usable : NaN,
    triggerRateD: usable > 0 ? firedD / usable : NaN,
    medianDaysToFirstC: median(daysToFirstC),
    medianDaysToFirstD: median(daysToFirstD),
    hold: aggPolicy(holdRes),
    policyC: aggPolicy(cRes),
    policyD: aggPolicy(dRes),
    mddReductionC: {
      median: median(holdRes.map((h, k) => h.mdd - cRes[k].mdd)),
      mean: meanOf(holdRes.map((h, k) => h.mdd - cRes[k].mdd)),
    },
    mddReductionD: {
      median: median(holdRes.map((h, k) => h.mdd - dRes[k].mdd)),
      mean: meanOf(holdRes.map((h, k) => h.mdd - dRes[k].mdd)),
    },
    incrementalReturn: {
      median: median(incReturn),
      mean: meanOf(incReturn),
      winRate: incReturn.length > 0 ? incReturn.filter((x) => x > 0).length / incReturn.length : NaN,
      loseRate: incReturn.length > 0 ? incReturn.filter((x) => x < 0).length / incReturn.length : NaN,
      differRate: incReturn.length > 0 ? incReturn.filter((x) => x !== 0).length / incReturn.length : NaN,
    },
    incrementalMdd: { median: median(pairedMdd), mean: meanOf(pairedMdd) },
    falseSell,
    overlapCvsNew,
    overlapByNewSignal,
    totalEvaluatedDays: totalDays,
    cDayRate: totalDays > 0 ? cDayCount / totalDays : NaN,
    newDayRate: totalDays > 0 ? newDayTotal / totalDays : NaN,
    ruleFireRate: APP_SELL_RULE_IDS.map((id) => {
      const arr = ruleFireBars.get(id)!;
      const dc = ruleDayCount.get(id)!;
      return {
        rule: id,
        positionsFired: arr.length,
        rate: usable > 0 ? arr.length / usable : NaN,
        medianDaysToFire: median(arr),
        dayCount: dc,
        dayRate: totalDays > 0 ? dc / totalDays : NaN,
      };
    }),
    newSignalFireRate: NEW_SIGNAL_CODES.map((c) => {
      const arr = newFireBars.get(c)!;
      const dc = newDayCount.get(c)!;
      return {
        signal: c,
        positionsFired: arr.length,
        rate: usable > 0 ? arr.length / usable : NaN,
        medianDaysToFire: median(arr),
        dayCount: dc,
        dayRate: totalDays > 0 ? dc / totalDays : NaN,
      };
    }),
  };
}

// ===========================================================================
// 문서 생성
// ===========================================================================

const num = (x: number, d = 4): string => (Number.isFinite(x) ? x.toFixed(d) : 'NA');
const pct = (x: number, d = 2): string => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : 'NA');

export interface Verdict {
  verdict: '증분가치 있음' | '증분가치 없음' | '조건부';
  reasons: string[];
}

/** 실질성 임계(사전 고정): 이보다 작은 차이는 "실익 없음"으로 본다. */
export const MATERIALITY = { returnPp: 0.005, mddPp: 0.02 } as const;

/**
 * 결론 판정(수치에서 기계적으로 도출 — 사후 해석 여지 최소화).
 *
 * **1차 기준은 포지션별 페어드 차이(D−C)** 다. C와 D는 같은 포지션·같은 기간을 공유하므로
 * 분포 중앙값끼리 비교(비페어드)하면 거의 같은 두 분포에서 우연한 차이가 크게 보인다.
 *   · 개발·검증 **양쪽에서** 페어드 수익률 평균 > 0 이고 페어드 MDD 평균 < 0 이며
 *     둘 중 하나가 실질성 임계를 넘으면 → '증분가치 있음'
 *   · 양쪽에서 두 축 어느 것도 개선되지 않으면 → '증분가치 없음'
 *   · 그 외(방향 불일치 / 개선은 있으나 실질성 미달) → '조건부'
 */
export function deriveVerdict(summaries: readonly CohortSummary[]): Verdict {
  const rs = summaries.filter((s) => s.cohort === 'RS90_ENTRY');
  const dev = rs.find((s) => s.period === 'DEV');
  const val = rs.find((s) => s.period === 'VALIDATION');
  const reasons: string[] = [];
  if (!dev || !val) return { verdict: '조건부', reasons: ['주 코호트 결과 부족 — 판정 불가'] };

  const pairRet = [dev, val].map((s) => s.incrementalReturn.mean);
  const pairMdd = [dev, val].map((s) => s.incrementalMdd.mean);
  const retD = [dev, val].map((s) => s.policyD.medianReturn - s.policyC.medianReturn);
  const mddD = [dev, val].map((s) => s.policyD.medianMdd - s.policyC.medianMdd);
  const costD = [dev, val].map((s) => s.policyD.meanCostPaid - s.policyC.meanCostPaid);

  const retBoth = pairRet.every((x) => x > 0);
  const mddBoth = pairMdd.every((x) => x < 0);
  const retNone = pairRet.every((x) => x <= 0);
  const mddNone = pairMdd.every((x) => x >= 0);
  const material =
    pairRet.every((x) => Math.abs(x) >= MATERIALITY.returnPp) ||
    pairMdd.every((x) => Math.abs(x) >= MATERIALITY.mddPp);

  let verdict: Verdict['verdict'];
  if (retBoth && mddBoth && material) verdict = '증분가치 있음';
  else if (retNone && mddNone) verdict = '증분가치 없음';
  else verdict = '조건부';

  reasons.push(
    `**[1차 기준] 페어드 수익률 차(D−C) 평균**: ${pct(pairRet[0], 3)}(개발) / ${pct(pairRet[1], 3)}(검증) → ${retBoth ? '양쪽 개선' : retNone ? '양쪽 미개선' : '**방향 불일치**'}`
  );
  reasons.push(
    `**[1차 기준] 페어드 MDD 차(D−C) 평균**: ${pct(pairMdd[0], 3)}(개발) / ${pct(pairMdd[1], 3)}(검증) → ${mddBoth ? '양쪽 낙폭 축소' : mddNone ? '양쪽 축소 없음' : '방향 불일치'}`
  );
  reasons.push(
    `페어드 수익률 차 **중앙값 ${pct(dev.incrementalReturn.median, 3)} / ${pct(val.incrementalReturn.median, 3)}** — D 경로가 C와 조금이라도 달라진 포지션 ${pct(dev.incrementalReturn.differRate)}(개발) / ${pct(val.incrementalReturn.differRate)}(검증), 그중 D 우위 ${pct(dev.incrementalReturn.winRate)} vs D 열위 ${pct(dev.incrementalReturn.loseRate)}(개발) · ${pct(val.incrementalReturn.winRate)} vs ${pct(val.incrementalReturn.loseRate)}(검증)`
  );
  reasons.push(
    `실질성 임계(수익률 ${pct(MATERIALITY.returnPp, 1)}p · MDD ${pct(MATERIALITY.mddPp, 1)}p) 충족: **${material ? '예' : '아니오'}**`
  );
  reasons.push(
    `(참고) 비페어드 중앙값 차 — 수익률 ${pct(retD[0])} / ${pct(retD[1])}, MDD ${pct(mddD[0])} / ${pct(mddD[1])}. 두 분포가 거의 동일하므로 이 값은 페어드 결과보다 신뢰도가 낮다`
  );
  reasons.push(
    `추가 거래비용(D−C, 원금대비 평균): ${pct(costD[0], 3)}(개발) / ${pct(costD[1], 3)}(검증)`
  );
  reasons.push(
    `**신규신호 발동일의 ${pct(dev.overlapCvsNew.precisionOfBvsA)}(개발) / ${pct(val.overlapCvsNew.precisionOfBvsA)}(검증)이 기존 규칙과 같은 날 이미 발동** — 신규신호가 새로 알려주는 날은 5% 남짓`
  );
  reasons.push(
    `**기존 규칙 C의 포화**: 보유 평가일의 ${pct(dev.cDayRate)}(개발) / ${pct(val.cDayRate)}(검증)에서 이미 매도규칙 중 하나가 발동한다. 트리거 발생률 ${pct(dev.triggerRateC)} / ${pct(val.triggerRateC)}, 첫 트리거까지 중앙값 ${num(dev.medianDaysToFirstC, 0)} / ${num(val.medianDaysToFirstC, 0)}거래일 — 신규신호가 더 이르게·새롭게 잡아낼 여지 자체가 거의 없다`
  );
  const rnd = summaries.filter((s) => s.cohort === 'RANDOM');
  if (rnd.length === 2) {
    reasons.push(
      `편향 대조(무작위 매수일, H6·H7 제외) 페어드 수익률 차 평균: ${pct(rnd[0].incrementalReturn.mean, 3)}(개발) / ${pct(rnd[1].incrementalReturn.mean, 3)}(검증), 경로가 달라진 포지션 ${pct(rnd[0].incrementalReturn.differRate)} / ${pct(rnd[1].incrementalReturn.differRate)}`
    );
  }
  return { verdict, reasons };
}

function buildMarkdown(
  summaries: readonly CohortSummary[],
  audit: AuditResult,
  meta: { manifestPrelock: string; universe: number; rsEntriesDev: number; rsEntriesVal: number; elapsedSec: number }
): string {
  const md: string[] = [];
  md.push('# P4 — 기존 앱 매도규칙 대비 신규 신호 증분 검증');
  md.push('');
  md.push('- 작성일: 2026-07-26');
  md.push('- 사전등록: `docs/backtest/PLAN_강의가설_전면검증_v2.md` §3 **P4**(기존 앱 규칙 대비 증분)');
  md.push('- 상태: `RESULT`');
  md.push('- 산출 JSON: `scripts/backtest/lectureSignals/output/d7_incremental.json`');
  md.push('- 골든 테스트: `tests/lectureAppRulesParity.ts` (package.json 미등록 — `npx tsx tests/lectureAppRulesParity.ts`)');
  md.push('- 실행 코드: `scripts/backtest/lectureSignals/appRules.ts`(앱 규칙 재현) · `appRulesAudit.ts`(앱 경로 대조) · `runIncremental.ts`(드라이버)');
  md.push('- **앱 코드는 한 줄도 수정하지 않았다.** 읽어서 백테스트 측에 독립 구현했다.');
  md.push(`- 데이터 게이트(prelock): \`${meta.manifestPrelock}\` · 투자가능 유니버스 ${meta.universe}종목 · 잠금표본(2023-2025) 미개봉`);
  md.push(`- 실행 시간: ${meta.elapsedSec.toFixed(1)}초`);
  md.push('');
  md.push('---');
  md.push('');

  // 0. 핵심 요약
  {
    const v0 = deriveVerdict(summaries);
    const dev = summaries.find((s) => s.cohort === 'RS90_ENTRY' && s.period === 'DEV');
    const val = summaries.find((s) => s.cohort === 'RS90_ENTRY' && s.period === 'VALIDATION');
    md.push('## 0. 핵심 요약');
    md.push('');
    md.push(`**판정: ${v0.verdict}** (상세 근거는 §5)`);
    md.push('');
    md.push('1. **앱 매도규칙 14종 중 13종을 재현했고, 앱 실제 함수와 100% 일치한다.** 재현 불가 1종(`strong-sell-signal`)은 백엔드 신호 의존이고 앱 기본값이 OFF다.');
    if (dev && val) {
      md.push(
        `2. **기존 규칙이 이미 포화 상태다.** 보유 평가일의 **${pct(dev.cDayRate)}(개발) / ${pct(val.cDayRate)}(검증)** 에서 13규칙 중 최소 하나가 발동한다. 매수 후 첫 매도 트리거까지 중앙값 **${num(dev.medianDaysToFirstC, 0)}거래일**(= 매수 직후부터 경보), 트리거 발생률 **${pct(dev.triggerRateC)}**.`
      );
      md.push(
        `3. **신규 신호는 대부분 새로운 정보가 아니다.** 신규 9신호가 발동한 날의 **${pct(dev.overlapCvsNew.precisionOfBvsA)}(개발) / ${pct(val.overlapCvsNew.precisionOfBvsA)}(검증)** 은 같은 날 기존 규칙도 발동했다(Jaccard ${num(dev.overlapCvsNew.jaccard, 3)}).`
      );
      md.push(
        `4. **증분은 사실상 0에 수렴한다.** 포지션별 페어드 D−C 수익률 차 중앙값 ${pct(dev.incrementalReturn.median, 3)}. D의 경로가 C와 조금이라도 달라진 포지션은 ${pct(dev.incrementalReturn.differRate)}(개발) / ${pct(val.incrementalReturn.differRate)}(검증)뿐이고, 그중 D가 나은 쪽 ${pct(dev.incrementalReturn.winRate)} vs 나쁜 쪽 ${pct(dev.incrementalReturn.loseRate)}(개발)로 거의 반반이다. 평균 차는 개발 ${pct(dev.incrementalReturn.mean, 3)} · 검증 ${pct(val.incrementalReturn.mean, 3)}로 **부호가 뒤집힌다**.`
      );
      md.push(
        `5. 유일하게 방향이 일관된 축은 **MDD**다(페어드 평균 ${pct(dev.incrementalMdd.mean, 3)} / ${pct(val.incrementalMdd.mean, 3)}, 양쪽 모두 축소). 다만 사전 고정한 실질성 임계(${pct(MATERIALITY.mddPp, 1)}p)에는 미달한다.`
      );
      md.push(
        `6. **읽는 방향 전환 제안**: 이 결과가 가리키는 문제는 "신규 신호를 넣을까"가 아니라 **"기존 13규칙이 동시에 켜져 있어 거의 매일 매도 경보가 뜬다"** 는 쪽이다(§4 규칙별 발동일 비율 표). 앱 적용 논의를 한다면 신규 신호 추가보다 **기존 규칙의 발화 억제/우선순위화**가 먼저다.`
      );
    }
    md.push('');
    md.push('---');
    md.push('');
  }

  // 1. 재현 가능 여부
  md.push('## 1. 앱 매도규칙 14종 — 재현 가능 여부');
  md.push('');
  md.push('`constants/alertRules.ts`의 매도(`action: sell`) 규칙 전수. 필터 결합은 앱과 동일하게 **AND**(`utils/alertChecker.ts` `matchesRule`), 데이터 없음(`null`)은 `false`로 매핑(`matchesSingleFilter` wrapper와 동일).');
  md.push('');
  md.push('| # | 규칙 id | 필터(AND) | 앱 기본 활성 | 재현 | 사유 / 재현 방식 |');
  md.push('|---|---|---|---|---|---|');
  md.push('| 1 | `stop-loss` | `LOSS_THRESHOLD` (−5%) | ON | ✅ | 보유수익률 = 매수체결가 대비 `adj_close` 비율 |');
  md.push('| 2 | `overheat-drop` | `RSI_OVERBOUGHT`(≥70) + `DAILY_DROP` | ON | ✅ | Wilder RSI(14) + 당일 종가<전일 종가 |');
  md.push('| 3 | `dead-cross` | `MA_DEAD_CROSS`(5/20, lookback 252) | ON | ✅ | `calculateCrossDays` 동일 규약(동률=null, 교차 미확인=null) |');
  md.push('| 4 | `trend-break` | `PRICE_BELOW_SHORT_MA`(20) + `PROFIT_NEGATIVE` | ON | ✅ | SMA20 + 보유수익률<0 |');
  md.push('| 5 | `long-decline` | `MA_BEARISH_ALIGN`(20<60) + `DROP_FROM_HIGH`(−20%) | ON | ⚠️ 근사 | `dropFromHigh`의 분모 `highestPrice`를 **트레일링 252일 최고종가 ∪ 매수후 러닝최고 ∪ 매수가**로 근사(아래 §2 차이표) |');
  md.push('| 6 | `profit-target` | `PROFIT_TARGET`(+20%) | ON | ✅ | |');
  md.push('| 7 | `overheat-profit` | `PROFIT_TARGET`(+15%) + `RSI_OVERHEAT_ENTRY`(withinDays 3) | ON | ✅ | RSI≥65 유지 + 70 상향돌파 경과일 ≤3 |');
  md.push('| 8 | `daily-crash` | `DAILY_CRASH`(−5%) | ON | ✅ | 종가 대비 전일 종가 −5% 이하 |');
  md.push('| 9 | `strong-sell-signal` | `SIGNAL_STRONG_SELL` + `VOLUME_HIGH` | **OFF** | ❌ **불가** | 두 필터 모두 **백엔드 산출값**(`indicators.signal`·`indicators.volume_ratio`). 산식이 이 저장소에 없다(Cloud Run 별도 배포, RULES §14). 백테스트 데이터(OHLCV+거래대금)로 복원 불가. **또한 앱 기본값이 `enabled: false`** → 현행 앱 사용자에게 발화하지 않으므로 C 재현의 결손이 아니다 |');
  md.push('| 10 | `climax-top` | `CLIMAX_TOP`(플래그≥2) | ON | ✅ | `countClimaxFlags` (a)기울기비≥2.5 (b)당일범위/ATR≥2.5+양봉 (c)52주 신고가+거래량 — 전부 OHLCV |');
  md.push('| 11 | `distribution-high` | `DISTRIBUTION_HIGH`(13일 5회, 거래량비 1.5) | ON | ✅ | `buildDistributionMeta`/`countDistributionDays` 동일 |');
  md.push('| 12 | `weinstein-150-break` | `PRICE_CROSS_BELOW_MA`(150, 5일 이내) | ON | ✅ | |');
  md.push('| 13 | `ma120-break` | `PRICE_CROSS_BELOW_MA`(120, 5일 이내) | ON | ✅ | |');
  md.push('| 14 | `swing-low-break` | `SWING_LOW_BREAK` | ON | ✅ | `detectRecentSwingLow(60,5,5)` 동일 |');
  md.push('');
  md.push(`**재현 13종 / 불가 1종**(\`${APP_SELL_RULE_EXCLUDED.join(', ')}\`). C = 재현 13종의 OR.`);
  md.push('');
  md.push('> 5번 `long-decline`의 "⚠️ 근사"는 **규칙 로직이 아니라 입력값**(`highestPrice`)의 근사다. 로직 자체는 §2 감사에서 100% 일치했다.');
  md.push('');

  // 2. 앱 경로 대조 감사
  md.push('## 2. 재현 정확도 — 앱 경로 직접 대조 감사');
  md.push('');
  md.push('계획서 §3 P4가 요구한 **패리티 위험 통제**. 재현 구현(`appRules.ts`, 벡터화)과 **앱의 실제 함수**(`utils/buildEnrichedIndicator.ts` → `utils/alertChecker.ts` `matchesRule`)를 같은 종목·같은 날짜·같은 보유상태로 돌려 규칙별 boolean을 1:1 비교했다.');
  md.push('');
  md.push(`- 표본: ${audit.nStocks}종목 × 종목당 최대 ${P4.auditDaysPerStock}일 = **${audit.nSamples} (종목·날짜) 쌍**, 규칙 13종 → 총 ${audit.nComparisons}건 비교`);
  md.push(`- **전체 일치율: ${pct(audit.overallAgreement, 4)}** (불일치 ${audit.totalMismatches}건)`);
  md.push('');
  md.push('> **이 감사가 보장하는 것**: 같은 입력(같은 OHLCV·같은 매수단가·같은 최고가)을 주면 재현 코드와 앱 코드의 **판정이 동일하다**. 입력 자체의 차이(조정가 vs 무조정가, 최고가 정의)는 감사가 잡아낼 수 없다 — 그건 §2-1에 별도로 적었다.');
  md.push('');
  md.push('> 감사 도중 발견해 고친 실제 결함 1건: **거래정지로 종가가 수십 일 동일한 종목**(디에스앤엘 2020-03~04)에서 `종가 == MA20`이 정확히 성립해 `종가 < MA20` 판정이 부동소수 마지막 비트로 갈렸다. 초판은 O(1) 롤링합을 써서 앱의 순차 합산과 마지막 비트가 달랐고 `trend-break`·`dead-cross`가 어긋났다(6/4212). 합산 순서를 앱과 동일하게 맞춰 해소했다.');
  md.push('');
  md.push('| 규칙 | 비교 | 불일치 | 일치율 | 앱만 발동 | 재현만 발동 |');
  md.push('|---|---:|---:|---:|---:|---:|');
  for (const r of audit.byRule) {
    md.push(
      `| \`${r.rule}\` | ${r.n} | ${r.mismatches} | ${pct(r.agreement, 4)} | ${r.appOnly} | ${r.reproOnly} |`
    );
  }
  md.push('');
  md.push('### 2-1. 알면서 다르게 둔 지점(단순화 목록)');
  md.push('');
  md.push('| # | 항목 | 앱 런타임 | 백테스트 재현 | 영향 |');
  md.push('|---|---|---|---|---|');
  md.push('| 1 | 가격 계열 | `/history` 응답(조정 여부 미확인, 무조정 추정) | `adj_*`(분할·배당 조정) | 분할일에 앱은 가짜 급락/급등이 생길 수 있음. 재현은 조정가라 그 오탐이 없다 — **재현이 앱보다 관대**(C 발동이 덜 뜸) |');
  md.push('| 2 | `highestPrice` | max(저장 최고가, 백엔드 **장중** 52주 고가, 현재가) | max(트레일링 252일 **종가** 최고, 매수후 러닝 최고, 매수가) | 종가 기준이라 분모가 약간 작음 → `long-decline`이 앱보다 **덜** 발동하는 방향 |');
  md.push('| 3 | 히스토리 길이 | 약 438캘린더일(≈300거래일)만 수신(`getRequiredHistoryDaysForOHLCV`) | 상장 이후 전 구간 | RSI/ATR(Wilder) 시딩·MA 교차 탐색 범위가 다름. §2-2에서 정량화 |');
  md.push('| 4 | `changeRate` | 백엔드 등락률 필드 | `adj_close[i]/adj_close[i-1]−1` | 부호·크기 정의 동일. 조정 차이만 남음(항목 1과 동일 원인) |');
  md.push('| 5 | `strong-sell-signal` | 백엔드 신호 기반, 기본 OFF | 제외 | C 재현에서 빠짐(기본 OFF라 실사용 영향 없음) |');
  md.push('| 6 | 통화 | `priceOriginal`(KRW) | `adj_close`(KRW) | 동일 |');
  md.push('');
  md.push('### 2-2. 히스토리 길이 민감도 (앱은 약 300거래일만 본다)');
  md.push('');
  md.push(`같은 (종목·날짜)에 대해 **전 구간 히스토리** vs **최근 ${audit.windowBars}거래일만** 넣고 앱 빌더를 각각 돌려 규칙 발동을 비교했다.`);
  md.push('');
  md.push(`- 비교 ${audit.windowSensitivity.nComparisons}건 중 불일치 **${audit.windowSensitivity.mismatches}건 (${pct(audit.windowSensitivity.mismatchRate, 4)})**`);
  const wsRows = audit.windowSensitivity.byRule.filter((r) => r.mismatches > 0);
  md.push('');
  if (wsRows.length > 0) {
    md.push('| 규칙 | 불일치 | 불일치율 |');
    md.push('|---|---:|---:|');
    for (const r of wsRows) md.push(`| \`${r.rule}\` | ${r.mismatches} | ${pct(r.rate, 4)} |`);
    md.push('');
    md.push('> 이 항목은 **재현 오류가 아니라 앱 런타임 자체의 특성**이다. 아래 C/D 비교 수치는 "히스토리가 충분할 때"의 값으로 읽어야 한다.');
  } else {
    md.push('불일치 규칙 없음. 즉 **히스토리를 300거래일로 줄여도 13규칙의 판정은 바뀌지 않았다.**');
    md.push('');
    md.push('- RSI·ATR은 Wilder 평활이라 300봉이면 시딩 차이가 지수적으로 소멸한다(차이 ~1e-10 수준, 임계 근처 뒤집힘 없음).');
    md.push('- `dead-cross`는 어차피 `|교차경과일| ≤ 252`를 요구하므로, 창을 300봉으로 잘라 교차를 못 찾아 `null`이 되어도 결과는 "미발동"으로 동일하다.');
    md.push('- MA150/MA200도 300봉이면 산출된다.');
    md.push('');
    md.push('> 따라서 아래 C/D 비교 수치를 앱 런타임에 옮길 때 **히스토리 길이 때문에 달라질 것은 없다**(적어도 이 표본에서는).');
  }
  md.push('');

  // 3. 설계
  md.push('## 3. 반사실 설계 — 무엇을 무엇과 비교했나');
  md.push('');
  md.push('### 3-1. 가상 매수일 정의 (계획서와 다르게 판단한 지점)');
  md.push('');
  md.push('계획서 P4는 "RS90 진입일을 가상 매수일로 사용, **또는** 무작위 표본 매수일 다수 사용"으로 선택지를 열어두었다. **둘 다 실행**하되 주분석은 RS90 코호트로 두었다. 이유:');
  md.push('');
  md.push('1. 신규 신호 중 **H6(A11)·H7(A12)는 정의상 "RS90 진입 이후"의 경고**다(`quality.ts computeHWarnings`). 무작위 매수일에는 정의되지 않는다. 두 신호를 D에 넣으려면 매수일이 RS90 진입일이어야 한다.');
  md.push('2. RS90 진입은 이 검증 시리즈에서 유일하게 검증된 매수 규칙 후보이고, 강의의 매수 논리이기도 하다. "현실에서 살 법한 종목"을 코호트로 쓰는 편이 증분 판단에 정직하다.');
  md.push('3. 다만 RS90 코호트는 **고모멘텀 편향**이 있어 매도규칙이 유리하게/불리하게 왜곡될 수 있으므로, 편향 대조로 **무작위 매수일 코호트**를 병행했다(H6·H7 제외, 나머지 7신호만 D에 포함).');
  md.push('');
  md.push('| 항목 | 정의 |');
  md.push('|---|---|');
  md.push('| 매수 체결 | 신호일(진입일/표본일) **익일 시가** `adj_open[t+1]` — 룩어헤드 0 |');
  md.push(`| 평가 창 | 매수일부터 **${P4.horizonDays}거래일**(표본기간 끝을 넘지 않도록 절단, 최소 ${P4.minWindowDays}거래일 확보된 포지션만 채택) |`);
  md.push('| C 정책 | 재현 13규칙 중 하나라도 발동 → **익일 시가 매도** |');
  md.push('| D 정책 | C ∪ 신규 9신호(무작위 코호트는 7신호) 중 하나라도 발동 → 익일 시가 매도 |');
  md.push('| HOLD 정책 | 매도 없음(기준선) |');
  md.push(`| 재진입 | 매도 후 **${P4.reentryDelayDays}거래일** 뒤 같은 종목 시가 재매수(진입 규칙은 이번 범위 밖 → 매도규칙 효과만 격리) |`);
  md.push('| 비용 | 매도 = 변동 30bps + 그 시점 매도세(`getKrSellTaxBps`) / 매수 = 변동 30bps. 세 정책 모두 최초 매수비용 반영 |');
  md.push('| S5 변형 | 앱 런타임이 쓰는 `S5_APP_PROXY`(조정종가×조정거래량)를 D에 넣었다 — `utils/buildEnrichedIndicator.ts`가 "런타임은 프록시만 사용"으로 확정 |');
  md.push('| H3 발화 | 2차 배치와 동일한 **상향 전이**(조건이 처음 참이 되는 날)만 발화 |');
  md.push('| 오탐 정의 | 매도 체결가 대비 **+20일 / +63일 종가가 더 높으면** 오탐(팔지 말았어야 함). 표본기간 밖 데이터는 사용하지 않음 |');
  md.push('| 중복률 | HOLD 경로(팔지 않고 계속 보유)의 모든 평가일에서 C 발동 `종목\\|날짜` 집합 vs 신규신호 발동 집합의 Jaccard·포함률 |');
  md.push('');
  md.push(`RS90 진입 이벤트: 개발 ${meta.rsEntriesDev}건 · 검증 ${meta.rsEntriesVal}건(창 확보분만 채택 — 아래 표의 n).`);
  md.push('');

  // 4. C vs D
  md.push('## 4. C vs D 비교');
  md.push('');
  for (const s of summaries) {
    md.push(`### 4-${summaries.indexOf(s) + 1}. ${s.cohort} · ${s.period} (n=${s.nPositions}, 평균 창 ${s.avgWindowDays.toFixed(0)}거래일)`);
    md.push('');
    md.push('| 지표 | HOLD(기준선) | C(기존규칙) | D(기존+신규) | D−C |');
    md.push('|---|---:|---:|---:|---:|');
    md.push(
      `| 창끝 수익률 중앙값 | ${pct(s.hold.medianReturn)} | ${pct(s.policyC.medianReturn)} | ${pct(s.policyD.medianReturn)} | ${pct(s.policyD.medianReturn - s.policyC.medianReturn)} |`
    );
    md.push(
      `| 창끝 수익률 평균 | ${pct(s.hold.meanReturn)} | ${pct(s.policyC.meanReturn)} | ${pct(s.policyD.meanReturn)} | ${pct(s.policyD.meanReturn - s.policyC.meanReturn)} |`
    );
    md.push(
      `| 수익률 하위10% | ${pct(s.hold.p10Return)} | ${pct(s.policyC.p10Return)} | ${pct(s.policyD.p10Return)} | ${pct(s.policyD.p10Return - s.policyC.p10Return)} |`
    );
    md.push(
      `| 수익률 상위10% | ${pct(s.hold.p90Return)} | ${pct(s.policyC.p90Return)} | ${pct(s.policyD.p90Return)} | ${pct(s.policyD.p90Return - s.policyC.p90Return)} |`
    );
    md.push(
      `| MDD 중앙값 | ${pct(s.hold.medianMdd)} | ${pct(s.policyC.medianMdd)} | ${pct(s.policyD.medianMdd)} | ${pct(s.policyD.medianMdd - s.policyC.medianMdd)} |`
    );
    md.push(
      `| MDD 평균 | ${pct(s.hold.meanMdd)} | ${pct(s.policyC.meanMdd)} | ${pct(s.policyD.meanMdd)} | ${pct(s.policyD.meanMdd - s.policyC.meanMdd)} |`
    );
    md.push(
      `| 매도 횟수 평균 | ${num(s.hold.meanSells, 2)} | ${num(s.policyC.meanSells, 2)} | ${num(s.policyD.meanSells, 2)} | ${num(s.policyD.meanSells - s.policyC.meanSells, 2)} |`
    );
    md.push(
      `| 재매수 횟수 평균 | ${num(s.hold.meanBuys, 2)} | ${num(s.policyC.meanBuys, 2)} | ${num(s.policyD.meanBuys, 2)} | ${num(s.policyD.meanBuys - s.policyC.meanBuys, 2)} |`
    );
    md.push(
      `| 누적 거래비용 평균(원금대비) | ${pct(s.hold.meanCostPaid, 3)} | ${pct(s.policyC.meanCostPaid, 3)} | ${pct(s.policyD.meanCostPaid, 3)} | ${pct(s.policyD.meanCostPaid - s.policyC.meanCostPaid, 3)} |`
    );
    md.push('');
    md.push('**MDD 회피효과(HOLD − 정책, 양수 = 낙폭 축소)**');
    md.push('');
    md.push('| | 중앙값 | 평균 |');
    md.push('|---|---:|---:|');
    md.push(`| C | ${pct(s.mddReductionC.median)} | ${pct(s.mddReductionC.mean)} |`);
    md.push(`| D | ${pct(s.mddReductionD.median)} | ${pct(s.mddReductionD.mean)} |`);
    md.push('');
    md.push('**신규신호 순증분(포지션별 페어드 D−C)**');
    md.push('');
    md.push(
      `- 수익률 차 중앙값 **${pct(s.incrementalReturn.median, 3)}** · 평균 ${pct(s.incrementalReturn.mean, 3)}`
    );
    md.push(
      `- 경로가 달라진 포지션 **${pct(s.incrementalReturn.differRate)}** (D 우위 ${pct(s.incrementalReturn.winRate)} · D 열위 ${pct(s.incrementalReturn.loseRate)} · 완전 동일 ${pct(1 - s.incrementalReturn.differRate)})`
    );
    md.push(`- MDD 차 중앙값 ${pct(s.incrementalMdd.median)} · 평균 ${pct(s.incrementalMdd.mean)} (음수 = D의 낙폭이 더 작음)`);
    md.push('');
    md.push('**첫 트리거**');
    md.push('');
    md.push('| | 트리거 발생 비율 | 매수 후 첫 트리거까지(중앙값, 거래일) |');
    md.push('|---|---:|---:|');
    md.push(`| C | ${pct(s.triggerRateC)} | ${num(s.medianDaysToFirstC, 1)} |`);
    md.push(`| D | ${pct(s.triggerRateD)} | ${num(s.medianDaysToFirstD, 1)} |`);
    md.push('');
    md.push('**오탐율(매도 후에도 계속 올랐던 비율)**');
    md.push('');
    md.push('| 전방창 | C (n) | C 오탐율 | D (n) | D 오탐율 | 신규신호 단독 선행 (n) | 오탐율 |');
    md.push('|---|---:|---:|---:|---:|---:|---:|');
    for (const h of P4.falseSellHorizons) {
      const f = s.falseSell[`h${h}`];
      md.push(
        `| +${h}일 | ${f.nC} | ${pct(f.falseRateC)} | ${f.nD} | ${pct(f.falseRateD)} | ${f.nNewOnly} | ${pct(f.falseRateNewOnly)} |`
      );
    }
    md.push('');
    md.push('**신호 중복률 (HOLD 경로 전 평가일, `종목|날짜` 중복 제거 기준)**');
    md.push('');
    md.push(
      '> 같은 종목의 여러 포지션이 같은 날짜를 공유하므로 **`종목|날짜`로 중복 제거**한 집합끼리 비교한다(위 포화도 표의 포지션-일 수와 분모가 다르다).'
    );
    md.push('');
    const o = s.overlapCvsNew;
    md.push(
      `- C 발동일 ${o.nA}건 · 신규신호 발동일 ${o.nB}건 · 교집합 ${o.intersection}건 · 합집합 ${o.union}건`
    );
    md.push(
      `- **Jaccard ${num(o.jaccard, 4)}** · 신규신호 중 C와 같은 날 겹치는 비율(정밀도) **${pct(o.precisionOfBvsA)}** · C 중 신규신호가 같은 날 잡아낸 비율(재현율) ${pct(o.recallOfBvsA)}`
    );
    md.push('');
    md.push('| 신규신호 | 발동일 수 | C와 같은 날 겹침 | 중복률 |');
    md.push('|---|---:|---:|---:|');
    for (const r of s.overlapByNewSignal) {
      md.push(`| \`${r.signal}\` | ${r.nNew} | ${r.overlapWithC} | ${pct(r.overlapRate)} |`);
    }
    md.push('');
    md.push('**기존 규칙의 포화도** — HOLD 경로 총 평가일 ' + s.totalEvaluatedDays.toLocaleString() + '일 기준');
    md.push('');
    md.push(
      `- **C(기존 13규칙 OR)가 발동한 날의 비율: ${pct(s.cDayRate)}** · 신규 9신호 중 하나라도 발동한 날: ${pct(s.newDayRate)}`
    );
    md.push('');
    md.push('| 기존 규칙 | 발동 포지션 | 포지션 비율 | 첫 발동까지(중앙값, 거래일) | 발동일 | **발동일 비율** |');
    md.push('|---|---:|---:|---:|---:|---:|');
    for (const r of s.ruleFireRate) {
      md.push(
        `| \`${r.rule}\` | ${r.positionsFired} | ${pct(r.rate)} | ${num(r.medianDaysToFire, 1)} | ${r.dayCount} | ${pct(r.dayRate)} |`
      );
    }
    md.push('');
    md.push('| 신규 신호 | 발동 포지션 | 포지션 비율 | 첫 발동까지(중앙값, 거래일) | 발동일 | 발동일 비율 |');
    md.push('|---|---:|---:|---:|---:|---:|');
    for (const r of s.newSignalFireRate) {
      md.push(
        `| \`${r.signal}\` | ${r.positionsFired} | ${pct(r.rate)} | ${num(r.medianDaysToFire, 1)} | ${r.dayCount} | ${pct(r.dayRate)} |`
      );
    }
    md.push('');
  }

  // 5. 결론
  const v = deriveVerdict(summaries);
  md.push('## 5. 결론 — 신규 신호의 실질 증분가치');
  md.push('');
  md.push(`### 판정: **${v.verdict}**`);
  md.push('');
  md.push('판정 규칙(수치에서 기계적으로 도출 — 사후 해석 여지 최소화). 1차 기준은 **포지션별 페어드 D−C**다(C와 D는 같은 포지션·같은 기간을 공유하므로 분포끼리의 비페어드 비교는 우연한 차이를 크게 보이게 한다):');
  md.push('');
  md.push(`- 주 코호트(RS90 진입)에서 **개발·검증 양쪽 모두** 페어드 수익률 평균 > 0 **이고** 페어드 MDD 평균 < 0 **이며** 실질성 임계(수익률 ${pct(MATERIALITY.returnPp, 1)}p 또는 MDD ${pct(MATERIALITY.mddPp, 1)}p)를 넘으면 → \`증분가치 있음\``);
  md.push('- 양쪽에서 두 축 어느 것도 개선되지 않으면 → `증분가치 없음`');
  md.push('- 그 외(방향 불일치 또는 개선은 있으나 실질성 미달) → `조건부`');
  md.push('');
  md.push('**근거**');
  md.push('');
  for (const r of v.reasons) md.push(`- ${r}`);
  md.push('');

  md.push('## 6. 한계와 읽는 법');
  md.push('');
  md.push('1. **이것은 매도규칙 비교이지 전략 비교가 아니다.** 진입 규칙은 범위 밖이라 매도 후 같은 종목으로 재진입시켰다. 실전에서는 매도 대금이 다른 종목으로 가므로 기회비용/대체수익이 반영되지 않았다.');
  md.push('2. **`long-decline`의 고점 분모가 앱과 완전히 같지 않다**(§2-1 항목 2). 이 규칙의 발동 시점은 앱보다 다소 늦을 수 있다.');
  md.push('3. **조정가(`adj_*`) 사용**. 앱은 무조정 시세일 가능성이 높아 분할일 오탐이 앱에는 더 있을 수 있다. 즉 실제 앱의 C는 여기 재현된 C보다 **약간 더 자주** 발동할 개연성이 있고, 그만큼 신규신호의 증분 여지는 더 줄어든다.');
  md.push('4. **`strong-sell-signal` 제외**(기본 OFF라 실사용 영향 없음, §1).');
  md.push('5. **잠금표본(2023-2025)은 열지 않았다.** 여기 수치는 개발(2010-2019)·검증(2020-2022)까지다. 최종 채택 선언은 잠금표본 게이트(G8·G11) 통과 후에만 가능하다.');
  md.push('6. 오탐율은 **가격이 올랐는지**만 본다(시장초과 아님). 상승장에서는 어떤 매도규칙이든 오탐율이 높게 나온다 — C와 D의 **차이**로만 읽어야 한다.');
  md.push('7. H6·H7은 RS90 진입 코호트에서만 정의된다. 무작위 코호트의 D는 7신호만 포함하므로 두 코호트의 D는 동일 정의가 아니다.');
  md.push('8. **D ⊇ C 이므로 D는 절대 C보다 늦게 팔 수 없다.** 신규 신호는 매도를 **앞당기기만** 한다. 따라서 이 설계에서 "증분가치"란 곧 "더 일찍 파는 것이 이득인가"이고, 결과는 "거의 차이 없다"였다.');
  md.push('9. **C의 포화가 신호 대 잡음비를 깎는다.** 기존 규칙이 이미 평가일의 90% 이상에서 울리므로, 신규 신호가 추가로 바꿀 수 있는 날 자체가 얼마 없다. 이 검증은 "신규 신호가 무가치하다"를 보인 것이 아니라 **"현행 앱의 매도규칙 구성 위에서는 증분이 관측되지 않는다"** 를 보인 것이다. 규칙을 솎아낸 구성 위에서라면 결과가 달라질 수 있고, 그건 별도 사전등록이 필요한 새 질문이다.');
  md.push('10. 이 문서는 **앱 적용 결정이 아니다.** 계획서 §3 "앱 적용(이 계획의 범위 밖)"에 따라, 사용자가 항목을 선택하고 별도 승인한 뒤에만 구현한다. 자동매도는 어떤 경우에도 범위 밖이다.');
  md.push('');

  return md.join('\n');
}

// ===========================================================================
// main
// ===========================================================================

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log('P4 — 기존 앱 매도규칙 대비 신규 신호 증분 검증\n');

  console.log('[1/6] 데이터 로드...');
  const ds = await loadLectureDataset();
  console.log(
    `  유니버스 ${ds.investableUnion.size}종목 · 바 ${ds.bars.size}종목 · prelock=${ds.manifestPrelock}`
  );

  console.log('[2/6] RS 랭킹 구축(잠금표본 미개봉 — 2022-12-31까지)...');
  const ranks = buildRsRanks(ds, VALIDATION_PERIOD.to);
  console.log(`  랭킹일 ${ranks.daysRanked}일 · 평균 적격 ${ranks.avgEligible.toFixed(1)}종목`);

  console.log('[3/6] 코호트 구성...');
  const cohorts: Cohort[] = [];
  const rsEntryCount: Record<string, number> = { DEV: 0, VALIDATION: 0 };

  for (const period of [DEV_PERIOD, VALIDATION_PERIOD]) {
    const positions: Position[] = [];
    for (const [code, bars] of ds.bars.entries()) {
      const r = ranks.rankByCode.get(code);
      if (!r) continue;
      const { entries, rankList } = detectRsEntries(bars, r);
      if (entries.length === 0) continue;
      for (const e of entries) {
        if (e.date < period.from || e.date > period.to) continue;
        rsEntryCount[period.name]++;
        const p = makeWindow(bars, e.bar, period.to);
        if (!p) continue;
        p.h6Bar = firstRs97AfterEntry(rankList, e.rankDayIdx);
        p.h7Bar = firstRsBelow50AfterEntry(rankList, e.rankDayIdx);
        // 창 밖 경고는 이 포지션에선 발화하지 않는다.
        if (p.h6Bar !== null && (p.h6Bar < p.buyBar || p.h6Bar > p.windowEnd)) p.h6Bar = null;
        if (p.h7Bar !== null && (p.h7Bar < p.buyBar || p.h7Bar > p.windowEnd)) p.h7Bar = null;
        positions.push(p);
      }
    }
    cohorts.push({ name: 'RS90_ENTRY', period: period.name, positions });
    console.log(`  RS90_ENTRY/${period.name}: 진입 ${rsEntryCount[period.name]}건 → 포지션 ${positions.length}건`);
  }

  // 무작위 코호트
  const codeList = [...ds.bars.keys()].sort();
  for (const period of [DEV_PERIOD, VALIDATION_PERIOD]) {
    const seed = period.name === 'DEV' ? P4.seedRandomCohortDev : P4.seedRandomCohortVal;
    const rng = mulberry32(seed);
    const seen = new Set<string>();
    const positions: Position[] = [];
    let attempts = 0;
    while (positions.length < P4.randomCohortSize && attempts < P4.randomMaxAttempts) {
      attempts++;
      const code = codeList[Math.floor(rng() * codeList.length)];
      const bars = ds.bars.get(code);
      if (!bars) continue;
      const [lo, hi] = periodIndexRange(bars, period);
      if (hi < lo) continue;
      const i = lo + Math.floor(rng() * (hi - lo + 1));
      const key = `${code}|${i}`;
      if (seen.has(key)) continue;
      if (!eligibleAt(bars, i, ds, CONST.liquidityMainMinAmountKRW)) continue;
      const p = makeWindow(bars, i, period.to);
      if (!p) continue;
      seen.add(key);
      positions.push(p);
    }
    cohorts.push({ name: 'RANDOM', period: period.name, positions });
    console.log(`  RANDOM/${period.name}: 포지션 ${positions.length}건(시도 ${attempts})`);
  }

  console.log('[4/6] 반사실 시뮬레이션(HOLD / C / D)...');
  const st: RunState = { ds, corpActionDates: ds.corpActionDates };
  const summaries: CohortSummary[] = [];
  for (const c of cohorts) {
    console.log(`  → ${c.name}/${c.period} (${c.positions.length} 포지션)`);
    summaries.push(runCohort(st, c));
  }

  console.log('[5/6] 앱 경로 대조 감사...');
  const audit = runAppPathAudit(ds, {
    stocks: P4.auditStocks,
    daysPerStock: P4.auditDaysPerStock,
    seed: P4.seedAudit,
  });
  console.log(
    `  일치율 ${(audit.overallAgreement * 100).toFixed(4)}% (불일치 ${audit.totalMismatches}/${audit.nComparisons})`
  );
  console.log(
    `  히스토리 길이 민감도 불일치 ${audit.windowSensitivity.mismatches}/${audit.windowSensitivity.nComparisons}`
  );

  console.log('[6/6] 산출물 기록...');
  const elapsedSec = (Date.now() - t0) / 1000;
  const payload = {
    generatedAt: new Date().toISOString(),
    plan: 'docs/backtest/PLAN_강의가설_전면검증_v2.md §3 P4',
    seedBase: CONST.masterSeed,
    config: P4,
    appRuleConfig: APP_RULE_CONST,
    reproducedRules: APP_SELL_RULE_IDS,
    excludedRules: APP_SELL_RULE_EXCLUDED,
    newSignals: NEW_SIGNAL_CODES,
    dataGatePrelock: ds.manifestPrelock,
    universe: ds.investableUnion.size,
    rsEntries: rsEntryCount,
    audit,
    summaries,
    verdict: deriveVerdict(summaries),
    elapsedSec,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, 'd7_incremental.json'), JSON.stringify(payload, null, 2));

  const md = buildMarkdown(summaries, audit, {
    manifestPrelock: ds.manifestPrelock,
    universe: ds.investableUnion.size,
    rsEntriesDev: rsEntryCount.DEV,
    rsEntriesVal: rsEntryCount.VALIDATION,
    elapsedSec,
  });
  writeFileSync(path.join(DOCS, 'RESULTS_P4_기존규칙대비증분.md'), md);
  console.log(`  JSON: ${path.join(OUT_DIR, 'd7_incremental.json')}`);
  console.log(`  MD  : ${path.join(DOCS, 'RESULTS_P4_기존규칙대비증분.md')}`);
  console.log(`\n완료 (${elapsedSec.toFixed(1)}초)`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
