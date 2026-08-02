// scripts/backtest/lectureSignals/runPhase0.ts
// ---------------------------------------------------------------------------
// Phase 0 — 신규 알림 구성 선검증 드라이버 (계획서 `docs/PLAN_앱적용_신호정비_260726.md` §2).
//
//   C      = 현행 앱 매도규칙 13종
//   C′-min = 급성 6종 + climax-top + distribution-high        (8종, 주 후보)
//   C′-mid = C′-min + weinstein-150-break + ma120-break + swing-low-break (11종)
//
// 두 축을 측정한다.
//   (1) 알림 빈도(주 판정): 무작위 KR 포트폴리오(60/30/10종목 × 200세트)의
//       **일평균 신규 전이 알림 건수** + 상태 지속 건수(참고) + 스파이크 + 규칙별 기여
//   (2) 손실 회피(보조 판정): P4 방법론 재사용(RS90 진입 · 무작위 매수일 코호트,
//       하위10% 손실 회피 · 오탐율 · 트리거 후 63일 성과)
//
// 실행: npx --yes tsx scripts/backtest/lectureSignals/runPhase0.ts
// 산출: output/d8_phase0_config.json + docs/backtest/RESULTS_Phase0_신규알림구성.md
//
// 규율: mulberry32만 · adj_* 사용 · 잠금표본(2023-2025) 미개봉 · 앱 코드 무접촉 ·
//       기존 lectureSignals 파일 무수정(import만) · 결과가 나빠도 그대로 보고.
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mulberry32 } from '../conditionalChannel/statistics';
import { APP_SELL_RULE_IDS, buildAppIndicatorSeries, type AppIndicatorSeries } from './appRules';
import { eligibleAt, periodIndexRange } from './batch2Common';
import { CONST, DEV_PERIOD, VALIDATION_PERIOD } from './configTypes';
import type { SamplePeriod, SecurityBars } from './configTypes';
import { loadLectureDataset, type LectureDataset } from './dataAccess';
import {
  ACUTE_SIX,
  ALERT_SEVERITY,
  ALL_CONFIG_LABEL,
  ALL_CONFIG_MASKS,
  ALL_CONFIG_RULE_SETS,
  CAPPED_CONFIG_LABEL,
  COMPROMISE_ADDED_RULES,
  COMPROMISE_CONFIG_IDS,
  COMPROMISE_RULE_SETS,
  CONFIG_MASKS,
  CONFIG_RULE_SETS,
  PHASE0_ALERT_IDS,
  PHASE0_ALL_CONFIG_IDS,
  PHASE0_CONFIG_IDS,
  PHASE0_CONFIG_LABEL,
  SATURATION_EXCLUDED_RULES,
  TAIL_DEFENSE_RULES,
  buildAcuteMask,
  firstFireBarsOnHoldPath,
  planCappedGroups,
  popcount,
  samplePortfolios,
  scanHoldingMasks,
  simulateCappedPortfolio,
  simulateConfigPolicy,
  stateBits,
  summarizeDist,
  transitionBits,
  type CappedMember,
  type DistSummary,
  type ExecutedSell,
  type Holding,
  type Phase0AnyConfigId,
  type Phase0CompromiseId,
  type Phase0ConfigId,
  type Phase0PolicyResult,
  type Phase0Position,
  type PortfolioCandidate,
} from './phase0Core';
import { buildRsRanks, detectRsEntries } from './rs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output');
const DOCS = path.resolve(__dirname, '..', '..', '..', 'docs', 'backtest');

// ===========================================================================
// 설정 (사전 고정)
// ===========================================================================

const PH0 = {
  /** mulberry32 시드 계열(계획서 지시: 20260726 계열). */
  seedBase: 20260726,
  /** 포트폴리오 세트 수(규모별). */
  sets: 200,
  /** 규모(주분석 60 · 민감도 30/10). */
  sizes: [60, 30, 10] as const,
  /** 매수일 추출 구간 = 측정창 시작 직전 N 거래일. */
  purchaseLookbackDays: 252,
  /**
   * 매수일 이전에 확보돼야 하는 최소 봉 수. 클라이맥스 (c)의 트레일링 252일 최고 +
   * 장기추세(MA60 vs 60봉 전 MA60 = 120봉)를 모두 채우려면 312봉이 필요하다.
   */
  minWarmupBars: 312,
  /**
   * 측정창. 검증표본(2020-2022)이 주분석. 개발표본은 데이터 시작(2010-01-04)에서
   * 워밍업 312봉 + 매수일 추출 252봉을 확보해야 하므로 2012-07-01부터로 절단한다
   * (계획서의 "2010-2019"를 그대로 쓰면 초반 구간 지표가 null이라 알림이 과소집계된다).
   */
  windows: {
    VALIDATION: { name: 'VALIDATION' as const, from: '2020-01-01', to: '2022-12-31' },
    DEV: { name: 'DEV' as const, from: '2012-07-01', to: '2019-12-31' },
  },
  // ── 손실 회피(P4 설정 그대로) ──
  horizonDays: 252,
  reentryDelayDays: 20,
  minWindowDays: 63,
  randomCohortSize: 1200,
  randomMaxAttempts: 400_000,
  falseSellHorizons: [20, 63] as const,
  /** P4와 동일 시드 → 무작위 매수일 코호트가 P4와 1:1 동일(C 수치 교차확인 가능). */
  seedRandomCohortDev: CONST.masterSeed + 70001,
  seedRandomCohortVal: CONST.masterSeed + 70002,
  /** 통과 기준(계획서 사전 고정 — 변경 금지). */
  gateMaxDailyNewAlerts: 3,
  gateMaxLossAvoidanceDegradePp: 0.03,
  // ── Phase 0-B: 예산제한 C(C_CAPPED) + 게이트 B′ (계획서 §Phase 0-B 사전 고정) ──
  /** 하루 실행 상한(주 판정). 사용자 알림 철학 0~3건/일과 동일 값. */
  capDailyBudget: 3,
  /** 상한이 전제하는 포트폴리오 규모 = 게이트 A 주분석과 동일한 60종목. */
  capTargetHoldings: 60,
  /**
   * 민감도: 같은 그룹에 상한 6건 = "30종목 포트폴리오에 3건"과 동일한 1종목당 예산.
   * C_CAPPED에 **더 유리한** 쪽(적대성 강화)이므로 함께 보고한다.
   */
  capSensitivityBudget: 6,
  /** B′-1: 평균·중앙 수익률이 HOLD 대비 이 값 넘게 악화되면 탈락. */
  gateBp1MaxReturnDegrade: 0.01,
  /** B′-2: 하위10%가 HOLD 대비 최소 이만큼 개선돼야 통과. */
  gateBp2MinTailImprove: 0.03,
  /** B′-3: C′-min이 C_CAPPED에 평균·하위10% 어느 쪽에서도 이 값 이상 뒤지면 탈락. */
  gateBp3MaxLagVsCapped: 0.01,
} as const;

type PeriodKey = 'VALIDATION' | 'DEV';
const PERIOD_KEYS: readonly PeriodKey[] = ['VALIDATION', 'DEV'];

function seedPortfolio(period: PeriodKey, size: number): number {
  return PH0.seedBase + (period === 'VALIDATION' ? 1000 : 2000) + size;
}

// ===========================================================================
// 알림 빈도 — 자료구조
// ===========================================================================

interface PeriodPlan {
  key: PeriodKey;
  from: string;
  to: string;
  /** 측정창 거래일 캘린더(모든 후보 종목 날짜의 합집합) */
  calendar: string[];
  dayIndex: Map<string, number>;
  candidates: PortfolioCandidate[];
  /** size → 세트 배열 */
  portfolios: Map<number, Holding[][]>;
  /** code → 측정창 bar 범위 */
  range: Map<string, { startIdx: number; endIdx: number }>;
}

interface FreqAcc {
  /** size → config → Int32Array(sets*days) */
  transition: Map<number, Record<Phase0AnyConfigId, Int32Array>>;
  state: Map<number, Record<Phase0AnyConfigId, Int32Array>>;
  /** size → Int32Array(sets*days) 활성 보유 수 */
  active: Map<number, Int32Array>;
  /** size → config → 비트별 전이 누계 */
  byRule: Map<number, Record<Phase0AnyConfigId, number[]>>;
}

function makeAcc(days: number): FreqAcc {
  const acc: FreqAcc = {
    transition: new Map(),
    state: new Map(),
    active: new Map(),
    byRule: new Map(),
  };
  for (const size of PH0.sizes) {
    const t = {} as Record<Phase0AnyConfigId, Int32Array>;
    const s = {} as Record<Phase0AnyConfigId, Int32Array>;
    const r = {} as Record<Phase0AnyConfigId, number[]>;
    for (const cfg of PHASE0_ALL_CONFIG_IDS) {
      t[cfg] = new Int32Array(PH0.sets * days);
      s[cfg] = new Int32Array(PH0.sets * days);
      r[cfg] = new Array<number>(PHASE0_ALERT_IDS.length).fill(0);
    }
    acc.transition.set(size, t);
    acc.state.set(size, s);
    acc.byRule.set(size, r);
    acc.active.set(size, new Int32Array(PH0.sets * days));
  }
  return acc;
}

// ===========================================================================
// 알림 빈도 — 후보/표본 구성
// ===========================================================================

function buildPeriodPlan(ds: LectureDataset, key: PeriodKey): PeriodPlan {
  const w = PH0.windows[key];
  const candidates: PortfolioCandidate[] = [];
  const range = new Map<string, { startIdx: number; endIdx: number }>();
  const dateSet = new Set<string>();

  const codes = [...ds.bars.keys()].sort();
  for (const code of codes) {
    const bars = ds.bars.get(code);
    if (!bars) continue;
    const [lo, hi] = periodIndexRange(bars, { name: w.name, from: w.from, to: w.to });
    if (hi < lo) continue;
    const purchaseHi = lo - 1;
    const purchaseLo = purchaseHi - PH0.purchaseLookbackDays + 1;
    if (purchaseLo < PH0.minWarmupBars) continue; // 워밍업 미확보 → 후보 제외
    // 측정창 시작 직전일 기준 투자가능·유동성(룩어헤드 0)
    if (!eligibleAt(bars, purchaseHi, ds, CONST.liquidityMainMinAmountKRW)) continue;
    candidates.push({ code, purchaseLo, purchaseHi });
    range.set(code, { startIdx: lo, endIdx: hi });
    for (let i = lo; i <= hi; i++) dateSet.add(bars.dates[i]);
  }

  const calendar = [...dateSet].sort();
  const dayIndex = new Map<string, number>();
  for (let i = 0; i < calendar.length; i++) dayIndex.set(calendar[i], i);

  const portfolios = new Map<number, Holding[][]>();
  for (const size of PH0.sizes) {
    const rng = mulberry32(seedPortfolio(key, size));
    portfolios.set(size, samplePortfolios(candidates, size, PH0.sets, rng));
  }

  return { key, from: w.from, to: w.to, calendar, dayIndex, candidates, portfolios, range };
}

// ===========================================================================
// 알림 빈도 — 집계 실행
// ===========================================================================

interface HoldingRef {
  size: number;
  set: number;
  purchaseBar: number;
}

function runFrequency(
  ds: LectureDataset,
  plans: Record<PeriodKey, PeriodPlan>
): Record<PeriodKey, FreqAcc> {
  const accs = {
    VALIDATION: makeAcc(plans.VALIDATION.calendar.length),
    DEV: makeAcc(plans.DEV.calendar.length),
  } as Record<PeriodKey, FreqAcc>;

  // code → period → holdings
  const byCode = new Map<string, Record<PeriodKey, HoldingRef[]>>();
  for (const key of PERIOD_KEYS) {
    const plan = plans[key];
    for (const size of PH0.sizes) {
      const sets = plan.portfolios.get(size) ?? [];
      for (let s = 0; s < sets.length; s++) {
        for (const h of sets[s]) {
          let rec = byCode.get(h.code);
          if (!rec) {
            rec = { VALIDATION: [], DEV: [] };
            byCode.set(h.code, rec);
          }
          rec[key].push({ size, set: s, purchaseBar: h.purchaseBar });
        }
      }
    }
  }

  const codes = [...byCode.keys()].sort();
  const cfgMasks = PHASE0_ALL_CONFIG_IDS.map((c) => ALL_CONFIG_MASKS[c]);
  let processed = 0;
  for (const code of codes) {
    const bars = ds.bars.get(code);
    const refs = byCode.get(code);
    if (!bars || !refs) continue;

    // 이 종목에 필요한 bar 범위(급성 마스크 계산 구간)
    let lo = Number.POSITIVE_INFINITY;
    let hi = -1;
    for (const key of PERIOD_KEYS) {
      if (refs[key].length === 0) continue;
      const r = plans[key].range.get(code);
      if (!r) continue;
      lo = Math.min(lo, r.startIdx - 1);
      hi = Math.max(hi, r.endIdx);
    }
    if (hi < 0) continue;
    lo = Math.max(0, lo);

    const s = buildAppIndicatorSeries(bars);
    const acute = buildAcuteMask(bars, ds.corpActionDates, lo, hi);

    for (const key of PERIOD_KEYS) {
      const list = refs[key];
      if (list.length === 0) continue;
      const plan = plans[key];
      const r = plan.range.get(code);
      if (!r) continue;
      const acc = accs[key];
      const days = plan.calendar.length;
      // bar index → 캘린더 day index (종목별 1회)
      const dayOfBar = new Int32Array(r.endIdx - r.startIdx + 1).fill(-1);
      for (let i = r.startIdx; i <= r.endIdx; i++) {
        const d = plan.dayIndex.get(bars.dates[i]);
        dayOfBar[i - r.startIdx] = d === undefined ? -1 : d;
      }
      for (const ref of list) {
        const scan = scanHoldingMasks(s, acute, ref.purchaseBar, r.startIdx, r.endIdx);
        if (!scan) continue;
        const tAcc = acc.transition.get(ref.size);
        const sAcc = acc.state.get(ref.size);
        const rAcc = acc.byRule.get(ref.size);
        const active = acc.active.get(ref.size);
        if (!tAcc || !sAcc || !rAcc || !active) continue;
        const base = ref.set * days;
        let prev = scan.prevMask;
        for (let k = 0; k < scan.masks.length; k++) {
          const day = dayOfBar[k];
          if (day < 0) {
            prev = scan.masks[k];
            continue;
          }
          const cur = scan.masks[k];
          active[base + day]++;
          for (let ci = 0; ci < cfgMasks.length; ci++) {
            const cfg = PHASE0_ALL_CONFIG_IDS[ci];
            const tb = transitionBits(prev, cur, cfgMasks[ci]);
            if (tb !== 0) {
              tAcc[cfg][base + day] += popcount(tb);
              const rr = rAcc[cfg];
              for (let b = 0; b < PHASE0_ALERT_IDS.length; b++) {
                if (tb & (1 << b)) rr[b]++;
              }
            }
            const sb = stateBits(cur, cfgMasks[ci]);
            if (sb !== 0) sAcc[cfg][base + day] += popcount(sb);
          }
          prev = cur;
        }
      }
    }

    processed++;
    if (processed % 100 === 0) {
      process.stdout.write(`    알림빈도: 종목 ${processed}/${codes.length}\r`);
    }
  }
  process.stdout.write('\n');
  return accs;
}

// ===========================================================================
// 알림 빈도 — 요약
// ===========================================================================

interface FreqSummary {
  period: PeriodKey;
  size: number;
  config: Phase0AnyConfigId;
  days: number;
  sets: number;
  meanActiveHoldings: number;
  /** (세트,일) 풀링 신규 전이 분포 */
  newAlerts: DistSummary;
  /** 세트별 일평균의 분포(세트 간 변동) */
  newAlertsPerSetMean: DistSummary;
  /** (세트,일) 풀링 상태 지속 분포 */
  stateAlerts: DistSummary;
  /** 스파이크: 세트평균이 가장 큰 날 */
  spikeDate: string;
  spikeMeanCount: number;
  /** 단일 (세트,일) 최대 */
  spikeSingleMax: number;
  spikeSingleDate: string;
  /** 규칙별 전이 기여(전체 세트·일 누계) */
  ruleContribution: Array<{ rule: string; transitions: number; share: number }>;
  /** 하루 상한(예산제한) 적용 시 일평균 실행 알림 = mean(min(전이, budget)) */
  cappedBudget: number;
  cappedMeanExecuted: number;
  /** 상한 때문에 버려지는 알림 비율 = 1 − Σmin(전이,budget) / Σ전이 */
  cappedDropShare: number;
}

function summarizeFreq(
  plan: PeriodPlan,
  acc: FreqAcc,
  size: number,
  cfg: Phase0AnyConfigId
): FreqSummary {
  const days = plan.calendar.length;
  const sets = PH0.sets;
  const t = acc.transition.get(size)![cfg];
  const st = acc.state.get(size)![cfg];
  const active = acc.active.get(size)!;

  const pooledT: number[] = [];
  const pooledS: number[] = [];
  const perSetMean: number[] = [];
  const dayMeanT = new Float64Array(days);
  let activeSum = 0;
  let spikeSingleMax = -1;
  let spikeSingleDay = 0;
  const budget = PH0.capDailyBudget;
  let cappedSum = 0;
  let rawSum = 0;

  for (let s = 0; s < sets; s++) {
    const base = s * days;
    let sum = 0;
    for (let d = 0; d < days; d++) {
      const v = t[base + d];
      pooledT.push(v);
      pooledS.push(st[base + d]);
      sum += v;
      dayMeanT[d] += v;
      activeSum += active[base + d];
      rawSum += v;
      cappedSum += v > budget ? budget : v;
      if (v > spikeSingleMax) {
        spikeSingleMax = v;
        spikeSingleDay = d;
      }
    }
    perSetMean.push(days > 0 ? sum / days : NaN);
  }

  let spikeDay = 0;
  let spikeVal = -1;
  for (let d = 0; d < days; d++) {
    dayMeanT[d] /= sets;
    if (dayMeanT[d] > spikeVal) {
      spikeVal = dayMeanT[d];
      spikeDay = d;
    }
  }

  const byRule = acc.byRule.get(size)![cfg];
  const total = byRule.reduce((a, b) => a + b, 0);
  const ruleContribution = PHASE0_ALERT_IDS.map((rule, b) => ({
    rule,
    transitions: byRule[b],
    share: total > 0 ? byRule[b] / total : 0,
  }))
    .filter((r) => r.transitions > 0)
    .sort((a, b) => b.transitions - a.transitions);

  return {
    period: plan.key,
    size,
    config: cfg,
    days,
    sets,
    meanActiveHoldings: days > 0 ? activeSum / (days * sets) : NaN,
    newAlerts: summarizeDist(pooledT),
    newAlertsPerSetMean: summarizeDist(perSetMean),
    stateAlerts: summarizeDist(pooledS),
    spikeDate: plan.calendar[spikeDay] ?? 'NA',
    spikeMeanCount: spikeVal,
    spikeSingleMax,
    spikeSingleDate: plan.calendar[spikeSingleDay] ?? 'NA',
    ruleContribution,
    cappedBudget: budget,
    cappedMeanExecuted: days > 0 ? cappedSum / (days * sets) : NaN,
    cappedDropShare: rawSum > 0 ? 1 - cappedSum / rawSum : 0,
  };
}

// ===========================================================================
// 손실 회피 — 코호트 (P4 재현)
// ===========================================================================

function makeWindow(
  bars: SecurityBars,
  signalBar: number,
  periodEndDate: string
): Phase0Position | null {
  const buyBar = signalBar + 1;
  const n = bars.dates.length;
  if (buyBar >= n) return null;
  let cap = buyBar;
  const hardEnd = Math.min(n - 1, buyBar + PH0.horizonDays - 1);
  for (let i = buyBar; i <= hardEnd; i++) {
    if (bars.dates[i] > periodEndDate) break;
    cap = i;
  }
  if (cap - buyBar + 1 < PH0.minWindowDays) return null;
  return { code: bars.code, signalBar, buyBar, windowEnd: cap };
}

interface Cohort {
  name: 'RS90_ENTRY' | 'RANDOM';
  period: SamplePeriod['name'];
  positions: Phase0Position[];
}

interface PolicyAgg {
  medianReturn: number;
  meanReturn: number;
  p10Return: number;
  medianMdd: number;
  meanMdd: number;
  meanSells: number;
  /** 누적 거래비용 평균(원금 대비) */
  meanCostPaid: number;
}

interface ConfigPerf {
  config: string;
  /** 이 구성의 집계에 실제로 들어간 포지션 수 */
  n: number;
  /**
   * 이 구성에서만 시뮬레이션이 무효가 된 포지션 수(부실 시가에 매도가 걸린 경우).
   * 원 3구성(C/C′-min/C′-mid)은 정의상 0 — 포지션 채택 자체가 이 3종 기준이기 때문이다.
   */
  invalidPositions: number;
  agg: PolicyAgg;
  /** 하위10% 손실 회피 = p10(정책) − p10(HOLD), 양수 = 손실 축소 */
  p10Avoidance: number;
  triggerRate: number;
  medianDaysToFirstTrigger: number;
  /** 트리거 후 63일 성과(매도가 대비 종목 수익률 중앙값). 음수 = 팔길 잘함 */
  postTriggerReturn63Median: number;
  /** **실제 실행된 모든 매도** 기준 63일 성과 중앙값(위와 정의가 다름 — §0-2 각주) */
  postSellReturn63Median: number;
  nSells: number;
  falseSell: Record<string, { n: number; rate: number }>;
}

/** C_CAPPED 1회 실행 결과(예산 1종). */
interface CappedPerf {
  label: string;
  dailyBudget: number;
  targetHoldings: number;
  groupCount: number;
  avgConcurrency: number;
  meanConcurrencyPerGroup: number;
  agg: PolicyAgg;
  p10Avoidance: number;
  /** 발동 알림 총계 / 실행 / 소멸 */
  totalCandidates: number;
  executedCandidates: number;
  droppedCandidates: number;
  /** 버려진 신호 비율 = dropped / total */
  dropShare: number;
  /** 그룹-일 기준 일평균 실행 알림(정의상 ≤ dailyBudget) */
  meanDailyExecuted: number;
  /** 그룹-일 기준 일평균 발동 알림(상한 적용 전) */
  meanDailyCandidates: number;
  groupDays: number;
  deferredBadOpen: number;
  postSellReturn63Median: number;
  nSells: number;
}

interface CohortResult {
  cohort: string;
  period: string;
  nPositions: number;
  hold: PolicyAgg;
  configs: ConfigPerf[];
  /** Phase 0-B에서 추가된 예산제한 C. [0] = 주 판정(하루 3건), [1] = 민감도(6건) */
  capped: CappedPerf[];
  /** Phase 0-C: 게이트 A 초과 절충안의 "하루 3건 상한" 적용판 (config id → 결과) */
  cappedCompromise: Record<string, CappedPerf>;
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function meanOf(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  let t = 0;
  for (const x of xs) t += x;
  return t / xs.length;
}
function p10(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * 0.1;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

function runCohort(
  ds: LectureDataset,
  cohort: Cohort,
  cappedCompromiseIds: readonly Phase0CompromiseId[]
): CohortResult {
  const byCode = new Map<string, Phase0Position[]>();
  for (const p of cohort.positions) {
    const arr = byCode.get(p.code) ?? [];
    arr.push(p);
    byCode.set(p.code, arr);
  }
  const allIds = PHASE0_ALL_CONFIG_IDS;
  const cfgMasks = allIds.map((c) => ALL_CONFIG_MASKS[c]);
  /**
   * 회귀 보존 규약: 포지션 채택(usable) 판정은 **1차 실행과 동일하게 HOLD + 원 3구성만**으로
   * 한다. 절충안을 추가했다고 포지션 집합이 달라지면 §0·§0-2의 기존 수치가 재현되지 않는다.
   */
  const BASE_N = PHASE0_CONFIG_IDS.length;
  const holdRet: number[] = [];
  const holdMdd: number[] = [];
  const holdCost: number[] = [];
  const cfgRet: number[][] = allIds.map(() => []);
  const cfgMdd: number[][] = allIds.map(() => []);
  const cfgSells: number[][] = allIds.map(() => []);
  const cfgCost: number[][] = allIds.map(() => []);
  const cfgDaysToFire: number[][] = allIds.map(() => []);
  const cfgSellLog: ExecutedSell[][] = allIds.map(() => []);
  const cfgInvalid: number[] = allIds.map(() => 0);
  const usablePositions: Phase0Position[] = [];
  let usable = 0;

  interface FsSample {
    code: string;
    sellBar: number;
    sellPrice: number;
  }
  const fsByCfg: FsSample[][] = allIds.map(() => []);

  const periodEnd = cohort.period === 'DEV' ? DEV_PERIOD.to : VALIDATION_PERIOD.to;
  let processed = 0;
  for (const [code, positions] of byCode.entries()) {
    const bars = ds.bars.get(code);
    if (!bars) continue;
    const s = buildAppIndicatorSeries(bars);
    let lo = Number.POSITIVE_INFINITY;
    let hi = -1;
    for (const p of positions) {
      lo = Math.min(lo, p.buyBar);
      hi = Math.max(hi, p.windowEnd);
    }
    const acute = buildAcuteMask(bars, ds.corpActionDates, Math.max(0, lo), hi);

    for (const pos of positions) {
      const hold = simulateConfigPolicy(s, bars, acute, pos, null, PH0.reentryDelayDays);
      if (!hold) continue;
      const logs: ExecutedSell[][] = cfgMasks.map(() => []);
      const results: (Phase0PolicyResult | null)[] = cfgMasks.map(() => null);
      // ① 원 3구성 — 이 결과만으로 포지션 채택 여부를 정한다(1차 실행과 동일).
      for (let k = 0; k < BASE_N; k++) {
        results[k] = simulateConfigPolicy(
          s,
          bars,
          acute,
          pos,
          cfgMasks[k],
          PH0.reentryDelayDays,
          logs[k]
        );
      }
      if (results.some((r, k) => k < BASE_N && r === null)) continue;
      // ② 절충안 구성 — 채택된 포지션에만 얹는다.
      for (let k = BASE_N; k < cfgMasks.length; k++) {
        results[k] = simulateConfigPolicy(
          s,
          bars,
          acute,
          pos,
          cfgMasks[k],
          PH0.reentryDelayDays,
          logs[k]
        );
      }
      usable++;
      usablePositions.push(pos);
      holdRet.push(hold.terminalReturn);
      holdMdd.push(hold.mdd);
      holdCost.push(hold.costPaid);
      for (let k = 0; k < results.length; k++) {
        const r = results[k];
        if (!r) {
          cfgInvalid[k]++;
          continue;
        }
        cfgSellLog[k].push(...logs[k]);
        cfgRet[k].push(r.terminalReturn);
        cfgMdd[k].push(r.mdd);
        cfgSells[k].push(r.sells);
        cfgCost[k].push(r.costPaid);
      }
      const firsts = firstFireBarsOnHoldPath(s, acute, pos, cfgMasks);
      for (let k = 0; k < firsts.length; k++) {
        const b = firsts[k];
        if (b === null) continue;
        cfgDaysToFire[k].push(b - pos.buyBar);
        const sb = b + 1;
        if (sb > pos.windowEnd) continue;
        const px = s.open[sb];
        if (!(px > 0)) continue;
        fsByCfg[k].push({ code, sellBar: sb, sellPrice: px });
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

  const fsRate = (samples: readonly FsSample[], h: number): { n: number; rate: number } => {
    let n = 0;
    let bad = 0;
    for (const smp of samples) {
      const bars = ds.bars.get(smp.code);
      if (!bars) continue;
      const j = smp.sellBar + h;
      if (j >= bars.adjClose.length) continue;
      if (bars.dates[j] > periodEnd) continue;
      n++;
      if (bars.adjClose[j] > smp.sellPrice) bad++;
    }
    return { n, rate: n > 0 ? bad / n : NaN };
  };
  const postRet = (samples: readonly FsSample[], h: number): number => {
    const out: number[] = [];
    for (const smp of samples) {
      const bars = ds.bars.get(smp.code);
      if (!bars) continue;
      const j = smp.sellBar + h;
      if (j >= bars.adjClose.length) continue;
      if (bars.dates[j] > periodEnd) continue;
      out.push(bars.adjClose[j] / smp.sellPrice - 1);
    }
    return median(out);
  };

  const holdAgg: PolicyAgg = {
    medianReturn: median(holdRet),
    meanReturn: meanOf(holdRet),
    p10Return: p10(holdRet),
    medianMdd: median(holdMdd),
    meanMdd: meanOf(holdMdd),
    meanSells: 0,
    meanCostPaid: meanOf(holdCost),
  };

  const configs: ConfigPerf[] = allIds.map((cfg, k) => {
    const agg: PolicyAgg = {
      medianReturn: median(cfgRet[k]),
      meanReturn: meanOf(cfgRet[k]),
      p10Return: p10(cfgRet[k]),
      medianMdd: median(cfgMdd[k]),
      meanMdd: meanOf(cfgMdd[k]),
      meanSells: meanOf(cfgSells[k]),
      meanCostPaid: meanOf(cfgCost[k]),
    };
    const falseSell: Record<string, { n: number; rate: number }> = {};
    for (const h of PH0.falseSellHorizons) falseSell[`h${h}`] = fsRate(fsByCfg[k], h);
    return {
      config: cfg,
      n: cfgRet[k].length,
      invalidPositions: cfgInvalid[k],
      agg,
      p10Avoidance: agg.p10Return - holdAgg.p10Return,
      triggerRate: usable > 0 ? cfgDaysToFire[k].length / usable : NaN,
      medianDaysToFirstTrigger: median(cfgDaysToFire[k]),
      postTriggerReturn63Median: postRet(fsByCfg[k], 63),
      postSellReturn63Median: postRet(cfgSellLog[k], 63),
      nSells: cfgSellLog[k].length,
      falseSell,
    };
  });

  // ── Phase 0-B: 예산제한 C · Phase 0-C: 게이트 A 초과 절충안의 상한 적용판 ──
  const variants: CapVariant[] = [
    {
      key: 'C@cap3',
      label: `${CAPPED_CONFIG_LABEL}·상한${PH0.capDailyBudget}`,
      cfgMask: CONFIG_MASKS.C,
      dailyBudget: PH0.capDailyBudget,
    },
    {
      key: 'C@cap6',
      label: `${CAPPED_CONFIG_LABEL}·상한${PH0.capSensitivityBudget}`,
      cfgMask: CONFIG_MASKS.C,
      dailyBudget: PH0.capSensitivityBudget,
    },
  ];
  for (const id of cappedCompromiseIds) {
    variants.push({
      key: id,
      label: `${ALL_CONFIG_LABEL[id]}@cap${PH0.capDailyBudget}`,
      cfgMask: ALL_CONFIG_MASKS[id],
      dailyBudget: PH0.capDailyBudget,
    });
  }
  const capResults = runCappedVariants(ds, cohort, usablePositions, variants, holdAgg, postRet);
  const capped: CappedPerf[] = [capResults.get('C@cap3')!, capResults.get('C@cap6')!];
  const cappedCompromise: Record<string, CappedPerf> = {};
  for (const id of cappedCompromiseIds) {
    const r = capResults.get(id);
    if (r) cappedCompromise[id] = r;
  }

  return {
    cohort: cohort.name,
    period: cohort.period,
    nPositions: usable,
    hold: holdAgg,
    configs,
    capped,
    cappedCompromise,
  };
}

// ===========================================================================
// 예산제한 C (C_CAPPED) — Phase 0-B
// ===========================================================================
//
// 상한 3건/일은 **60종목 포트폴리오**를 전제로 한 값이다(게이트 A와 같은 규모). 코호트 전체는
// 동시보유가 수백 건이므로, 코호트를 "동시보유 ≈60종목"짜리 합성 포트폴리오 G개로 쪼개고
// 각 그룹에 하루 상한을 건다. 자본은 보유별 독립(각 1.0)이고 **공유되는 것은 알림 예산뿐**이라
// 포지션별 수익률이 HOLD/C/C′와 1:1 비교 가능하다(같은 포지션·같은 창).

/** 상한 적용 정책 1종의 정의(규칙 집합 마스크 + 하루 예산). */
interface CapVariant {
  key: string;
  label: string;
  cfgMask: number;
  dailyBudget: number;
}

interface CapAcc {
  ret: number[];
  mdd: number[];
  sells: number[];
  cost: number[];
  sellLog: ExecutedSell[];
  totalCandidates: number;
  executedCandidates: number;
  droppedCandidates: number;
  groupDays: number;
  deferredBadOpen: number;
}

/**
 * 여러 상한 정책(변형)을 **같은 그룹 분할 위에서 한 번에** 돌린다.
 *
 * 그룹 분할·멤버 구성·캘린더는 변형과 무관하므로 지표 시계열(`buildAppIndicatorSeries`·
 * `buildAcuteMask`)을 그룹당 1회만 만들고 모든 변형이 공유한다. 변형별 시뮬레이션 자체는
 * 완전히 독립이며(상태 배열을 공유하지 않는다), 그룹 순회 순서도 이전 구현과 같아
 * 1차 실행의 C_CAPPED 수치가 그대로 재현된다.
 */
function runCappedVariants(
  ds: LectureDataset,
  cohort: Cohort,
  positions: readonly Phase0Position[],
  variants: readonly CapVariant[],
  holdAgg: PolicyAgg,
  postRet: (samples: readonly ExecutedSell[], h: number) => number
): Map<string, CappedPerf> {
  const spanSet = new Set<string>();
  for (const p of positions) {
    const bars = ds.bars.get(p.code);
    if (!bars) continue;
    for (let i = p.buyBar; i <= p.windowEnd; i++) spanSet.add(bars.dates[i]);
  }
  const plan = planCappedGroups(positions, spanSet.size, PH0.capTargetHoldings);
  process.stdout.write(
    `    CAPPED ${cohort.name}/${cohort.period} 변형 ${variants.length}종: ` +
      `동시보유 ${plan.avgConcurrency.toFixed(0)}건 → 그룹 ${plan.groupCount}개\n`
  );

  const groups: Phase0Position[][] = Array.from({ length: plan.groupCount }, () => []);
  for (const p of positions) {
    const g = plan.groupOfCode.get(p.code);
    if (g === undefined) continue;
    groups[g].push(p);
  }

  const accs = new Map<string, CapAcc>();
  for (const v of variants) {
    accs.set(v.key, {
      ret: [],
      mdd: [],
      sells: [],
      cost: [],
      sellLog: [],
      totalCandidates: 0,
      executedCandidates: 0,
      droppedCandidates: 0,
      groupDays: 0,
      deferredBadOpen: 0,
    });
  }
  let concurrencyWeighted = 0;

  for (const g of groups) {
    if (g.length === 0) continue;
    const codes = [...new Set(g.map((p) => p.code))].sort();
    const seriesByCode = new Map<string, AppIndicatorSeries>();
    const acuteByCode = new Map<string, Uint32Array>();
    for (const code of codes) {
      const bars = ds.bars.get(code);
      if (!bars) continue;
      let lo = Number.POSITIVE_INFINITY;
      let hi = -1;
      for (const p of g) {
        if (p.code !== code) continue;
        lo = Math.min(lo, p.buyBar);
        hi = Math.max(hi, p.windowEnd);
      }
      seriesByCode.set(code, buildAppIndicatorSeries(bars));
      acuteByCode.set(code, buildAcuteMask(bars, ds.corpActionDates, Math.max(0, lo), hi));
    }
    const members: CappedMember[] = [];
    const dateSet = new Set<string>();
    let positionDays = 0;
    for (const p of g) {
      const bars = ds.bars.get(p.code);
      const s = seriesByCode.get(p.code);
      const acute = acuteByCode.get(p.code);
      if (!bars || !s || !acute) continue;
      members.push({ code: p.code, s, bars, acute, buyBar: p.buyBar, windowEnd: p.windowEnd });
      positionDays += p.windowEnd - p.buyBar + 1;
      for (let i = p.buyBar; i <= p.windowEnd; i++) dateSet.add(bars.dates[i]);
    }
    const calendar = [...dateSet].sort();
    for (const v of variants) {
      const acc = accs.get(v.key);
      if (!acc) continue;
      const r = simulateCappedPortfolio(
        members,
        v.cfgMask,
        v.dailyBudget,
        PH0.reentryDelayDays,
        calendar
      );
      for (const pp of r.perPosition) {
        acc.ret.push(pp.terminalReturn);
        acc.mdd.push(pp.mdd);
        acc.sells.push(pp.sells);
        acc.cost.push(pp.costPaid);
      }
      acc.sellLog.push(...r.sellLog);
      acc.totalCandidates += r.totalCandidates;
      acc.executedCandidates += r.executedCandidates;
      acc.droppedCandidates += r.droppedCandidates;
      acc.groupDays += r.calendarDays;
      acc.deferredBadOpen += r.deferredBadOpen;
    }
    concurrencyWeighted += calendar.length > 0 ? positionDays / calendar.length : 0;
  }

  const nGroups = groups.filter((g) => g.length > 0).length;
  const out = new Map<string, CappedPerf>();
  for (const v of variants) {
    const acc = accs.get(v.key);
    if (!acc) continue;
    const agg: PolicyAgg = {
      medianReturn: median(acc.ret),
      meanReturn: meanOf(acc.ret),
      p10Return: p10(acc.ret),
      medianMdd: median(acc.mdd),
      meanMdd: meanOf(acc.mdd),
      meanSells: meanOf(acc.sells),
      meanCostPaid: meanOf(acc.cost),
    };
    out.set(v.key, {
      label: v.label,
      dailyBudget: v.dailyBudget,
      targetHoldings: PH0.capTargetHoldings,
      groupCount: plan.groupCount,
      avgConcurrency: plan.avgConcurrency,
      meanConcurrencyPerGroup: nGroups > 0 ? concurrencyWeighted / nGroups : NaN,
      agg,
      p10Avoidance: agg.p10Return - holdAgg.p10Return,
      totalCandidates: acc.totalCandidates,
      executedCandidates: acc.executedCandidates,
      droppedCandidates: acc.droppedCandidates,
      dropShare: acc.totalCandidates > 0 ? acc.droppedCandidates / acc.totalCandidates : 0,
      meanDailyExecuted: acc.groupDays > 0 ? acc.executedCandidates / acc.groupDays : NaN,
      meanDailyCandidates: acc.groupDays > 0 ? acc.totalCandidates / acc.groupDays : NaN,
      groupDays: acc.groupDays,
      deferredBadOpen: acc.deferredBadOpen,
      postSellReturn63Median: postRet(acc.sellLog, 63),
      nSells: acc.sellLog.length,
    });
  }
  return out;
}

// ===========================================================================
// 판정
// ===========================================================================

interface GateResult {
  gate: string;
  pass: boolean;
  detail: string;
}

function deriveGates(
  freq: FreqSummary[],
  cohorts: CohortResult[]
): { gates: GateResult[]; overallPass: boolean } {
  const gates: GateResult[] = [];

  const main = freq.find(
    (f) => f.period === 'VALIDATION' && f.size === 60 && f.config === 'CMIN'
  );
  const v = main ? main.newAlerts.mean : NaN;
  gates.push({
    gate: `A. 60종목 C′-min 일평균 신규 알림 ≤ ${PH0.gateMaxDailyNewAlerts}건 (검증표본)`,
    pass: Number.isFinite(v) && v <= PH0.gateMaxDailyNewAlerts,
    detail: `실측 ${Number.isFinite(v) ? v.toFixed(3) : 'NA'}건/일`,
  });

  const primary = cohorts.filter((c) => c.period === 'VALIDATION');
  const rows: string[] = [];
  let passB = primary.length > 0;
  for (const c of primary) {
    const cC = c.configs.find((x) => x.config === 'C');
    const cMin = c.configs.find((x) => x.config === 'CMIN');
    if (!cC || !cMin) {
      passB = false;
      continue;
    }
    const degrade = cC.p10Avoidance - cMin.p10Avoidance; // 양수 = C′-min이 나쁨
    const ok = degrade <= PH0.gateMaxLossAvoidanceDegradePp;
    if (!ok) passB = false;
    rows.push(
      `${c.cohort}: C 회피 ${(cC.p10Avoidance * 100).toFixed(2)}%p vs C′-min ${(
        cMin.p10Avoidance * 100
      ).toFixed(2)}%p → 악화 ${(degrade * 100).toFixed(2)}%p ${ok ? 'OK' : 'NG'}`
    );
  }
  gates.push({
    gate: `B. C′-min 하위10% 손실 회피가 C 대비 ${(
      PH0.gateMaxLossAvoidanceDegradePp * 100
    ).toFixed(0)}%p 이상 악화되지 않을 것 (검증표본 두 코호트)`,
    pass: passB,
    detail: rows.join(' · '),
  });

  return { gates, overallPass: gates.every((g) => g.pass) };
}

// ---------------------------------------------------------------------------
// 게이트 B′ (Phase 0-B — 사후 수정, 계획서 §Phase 0-B 사전 고정)
// ---------------------------------------------------------------------------

interface BPrimeCell {
  cohort: string;
  period: string;
  n: number;
  holdMean: number;
  holdMedian: number;
  holdP10: number;
  cminMean: number;
  cminMedian: number;
  cminP10: number;
  cappedMean: number;
  cappedP10: number;
  /** HOLD − C′-min (양수 = C′-min이 나쁨) */
  meanDegrade: number;
  medianDegrade: number;
  /** C′-min − HOLD (양수 = 꼬리 개선) */
  tailImprove: number;
  /** C_CAPPED − C′-min (양수 = C′-min이 뒤짐) */
  lagMean: number;
  lagP10: number;
  bp1: boolean;
  bp2: boolean;
  bp3: boolean;
}

function deriveGatesBPrime(cohorts: CohortResult[]): {
  cells: BPrimeCell[];
  gates: GateResult[];
  overallPass: boolean;
} {
  const cells: BPrimeCell[] = [];
  for (const c of cohorts) {
    const cmin = c.configs.find((x) => x.config === 'CMIN');
    const cap = c.capped[0];
    if (!cmin || !cap) continue;
    const meanDegrade = c.hold.meanReturn - cmin.agg.meanReturn;
    const medianDegrade = c.hold.medianReturn - cmin.agg.medianReturn;
    const tailImprove = cmin.agg.p10Return - c.hold.p10Return;
    const lagMean = cap.agg.meanReturn - cmin.agg.meanReturn;
    const lagP10 = cap.agg.p10Return - cmin.agg.p10Return;
    cells.push({
      cohort: c.cohort,
      period: c.period,
      n: c.nPositions,
      holdMean: c.hold.meanReturn,
      holdMedian: c.hold.medianReturn,
      holdP10: c.hold.p10Return,
      cminMean: cmin.agg.meanReturn,
      cminMedian: cmin.agg.medianReturn,
      cminP10: cmin.agg.p10Return,
      cappedMean: cap.agg.meanReturn,
      cappedP10: cap.agg.p10Return,
      meanDegrade,
      medianDegrade,
      tailImprove,
      lagMean,
      lagP10,
      bp1:
        meanDegrade <= PH0.gateBp1MaxReturnDegrade &&
        medianDegrade <= PH0.gateBp1MaxReturnDegrade,
      bp2: tailImprove >= PH0.gateBp2MinTailImprove,
      bp3: lagMean <= PH0.gateBp3MaxLagVsCapped && lagP10 <= PH0.gateBp3MaxLagVsCapped,
    });
  }

  const cellLabel = (c: BPrimeCell): string => `${c.cohort}/${c.period}`;
  const gates: GateResult[] = [
    {
      gate: `B′-1 수익 보존: C′-min의 평균·중앙 수익률이 HOLD 대비 ${(
        PH0.gateBp1MaxReturnDegrade * 100
      ).toFixed(0)}%p 넘게 악화되지 않을 것 (4셀 전부)`,
      pass: cells.length === 4 && cells.every((c) => c.bp1),
      detail: cells
        .map(
          (c) =>
            `${cellLabel(c)}: 평균 악화 ${(c.meanDegrade * 100).toFixed(2)}%p · 중앙 악화 ${(
              c.medianDegrade * 100
            ).toFixed(2)}%p ${c.bp1 ? 'OK' : 'NG'}`
        )
        .join(' · '),
    },
    {
      gate: `B′-2 꼬리 개선: C′-min의 하위10%가 HOLD 대비 ${(
        PH0.gateBp2MinTailImprove * 100
      ).toFixed(0)}%p 이상 개선될 것 (4셀 전부)`,
      pass: cells.length === 4 && cells.every((c) => c.bp2),
      detail: cells
        .map(
          (c) => `${cellLabel(c)}: ${(c.tailImprove * 100).toFixed(2)}%p ${c.bp2 ? 'OK' : 'NG'}`
        )
        .join(' · '),
    },
    {
      gate: `B′-3 적대 조건: C′-min이 C_CAPPED(하루 ${PH0.capDailyBudget}건)보다 평균·하위10% 어느 쪽에서도 ${(
        PH0.gateBp3MaxLagVsCapped * 100
      ).toFixed(0)}%p 이상 뒤지지 않을 것 (4셀 전부)`,
      pass: cells.length === 4 && cells.every((c) => c.bp3),
      detail: cells
        .map(
          (c) =>
            `${cellLabel(c)}: 평균 열세 ${(c.lagMean * 100).toFixed(2)}%p · 하위10% 열세 ${(
              c.lagP10 * 100
            ).toFixed(2)}%p ${c.bp3 ? 'OK' : 'NG'}`
        )
        .join(' · '),
    },
  ];
  return { cells, gates, overallPass: gates.every((g) => g.pass) };
}

// ---------------------------------------------------------------------------
// Phase 0-C: 절충안 탐색 판정 (게이트 A·B′-1·B′-2·B′-3 **그대로** 적용)
// ---------------------------------------------------------------------------
//
// 기준은 한 줄도 바꾸지 않는다. 바뀐 것은 **판정 대상 구성**뿐이다.

interface CompromiseCell {
  cohort: string;
  period: string;
  n: number;
  mean: number;
  medianReturn: number;
  p10: number;
  meanSells: number;
  meanCostPaid: number;
  holdMean: number;
  holdMedian: number;
  holdP10: number;
  cappedMean: number;
  cappedP10: number;
  /** HOLD − 구성 (양수 = 구성이 나쁨) */
  meanDegrade: number;
  medianDegrade: number;
  /** 구성 − HOLD (양수 = 꼬리 개선) */
  tailImprove: number;
  /** C_CAPPED − 구성 (양수 = 구성이 뒤짐) */
  lagMean: number;
  lagP10: number;
  bp1: boolean;
  bp2: boolean;
  bp3: boolean;
}

interface CompromiseEval {
  key: string;
  configId: string;
  label: string;
  /** 하루 3건 상한 적용판인가 */
  cappedVariant: boolean;
  rules: readonly string[];
  addedRules: readonly string[];
  /** 게이트 A 대상 값 = 60종목·검증표본 일평균 알림(상한판은 상한 적용 후 실행 건수) */
  dailyAlerts: number;
  /** 상한 적용 전 발동(신규 전이) — 상한판에서만 원판과 다르다 */
  dailyRawAlerts: number;
  dailyStateAlerts: number;
  maxSpike: number;
  droppedShare: number;
  gateA: boolean;
  /** 상한판은 정의상 A를 넘을 수 없다(구조적 통과) */
  gateAByConstruction: boolean;
  cells: CompromiseCell[];
  gateB1: boolean;
  gateB2: boolean;
  gateB3: boolean;
  allPass: boolean;
  /** 미달 폭(0이면 통과). A는 건/일, B는 수익률 소수(0.01 = 1%p) */
  shortfall: { A: number; B1: number; B2: number; B3: number; failedGates: number };
}

function evaluateCompromise(
  key: string,
  configId: string,
  label: string,
  cappedVariant: boolean,
  rules: readonly string[],
  addedRules: readonly string[],
  freq: FreqSummary[],
  cohorts: CohortResult[],
  pick: (c: CohortResult) => { agg: PolicyAgg } | undefined
): CompromiseEval {
  const f = freq.find(
    (x) => x.period === 'VALIDATION' && x.size === 60 && x.config === configId
  );
  const dailyRawAlerts = f ? f.newAlerts.mean : NaN;
  const dailyAlerts = cappedVariant ? (f ? f.cappedMeanExecuted : NaN) : dailyRawAlerts;
  const gateA = Number.isFinite(dailyAlerts) && dailyAlerts <= PH0.gateMaxDailyNewAlerts;

  const cells: CompromiseCell[] = [];
  for (const c of cohorts) {
    const cap = c.capped[0];
    const p = pick(c);
    if (!cap || !p) continue;
    const meanDegrade = c.hold.meanReturn - p.agg.meanReturn;
    const medianDegrade = c.hold.medianReturn - p.agg.medianReturn;
    const tailImprove = p.agg.p10Return - c.hold.p10Return;
    const lagMean = cap.agg.meanReturn - p.agg.meanReturn;
    const lagP10 = cap.agg.p10Return - p.agg.p10Return;
    cells.push({
      cohort: c.cohort,
      period: c.period,
      n: c.nPositions,
      mean: p.agg.meanReturn,
      medianReturn: p.agg.medianReturn,
      p10: p.agg.p10Return,
      meanSells: p.agg.meanSells,
      meanCostPaid: p.agg.meanCostPaid,
      holdMean: c.hold.meanReturn,
      holdMedian: c.hold.medianReturn,
      holdP10: c.hold.p10Return,
      cappedMean: cap.agg.meanReturn,
      cappedP10: cap.agg.p10Return,
      meanDegrade,
      medianDegrade,
      tailImprove,
      lagMean,
      lagP10,
      bp1:
        meanDegrade <= PH0.gateBp1MaxReturnDegrade &&
        medianDegrade <= PH0.gateBp1MaxReturnDegrade,
      bp2: tailImprove >= PH0.gateBp2MinTailImprove,
      bp3: lagMean <= PH0.gateBp3MaxLagVsCapped && lagP10 <= PH0.gateBp3MaxLagVsCapped,
    });
  }

  const complete = cells.length === 4;
  const gateB1 = complete && cells.every((c) => c.bp1);
  const gateB2 = complete && cells.every((c) => c.bp2);
  const gateB3 = complete && cells.every((c) => c.bp3);

  const worst = (f2: (c: CompromiseCell) => number): number =>
    cells.length === 0 ? Number.POSITIVE_INFINITY : Math.max(...cells.map(f2));
  const sfA = Math.max(0, (Number.isFinite(dailyAlerts) ? dailyAlerts : Infinity) - PH0.gateMaxDailyNewAlerts);
  const sfB1 = Math.max(
    0,
    worst((c) => Math.max(c.meanDegrade, c.medianDegrade) - PH0.gateBp1MaxReturnDegrade)
  );
  const sfB2 = Math.max(0, worst((c) => PH0.gateBp2MinTailImprove - c.tailImprove));
  const sfB3 = Math.max(
    0,
    worst((c) => Math.max(c.lagMean, c.lagP10) - PH0.gateBp3MaxLagVsCapped)
  );
  const failedGates = [gateA, gateB1, gateB2, gateB3].filter((x) => !x).length;

  return {
    key,
    configId,
    label,
    cappedVariant,
    rules,
    addedRules,
    dailyAlerts,
    dailyRawAlerts,
    dailyStateAlerts: f ? f.stateAlerts.mean : NaN,
    maxSpike: f ? f.newAlerts.max : NaN,
    droppedShare: f ? f.cappedDropShare : NaN,
    gateA,
    gateAByConstruction: cappedVariant,
    cells,
    gateB1,
    gateB2,
    gateB3,
    allPass: gateA && gateB1 && gateB2 && gateB3,
    shortfall: { A: sfA, B1: sfB1, B2: sfB2, B3: sfB3, failedGates },
  };
}

/**
 * 절충안 전체 판정. 기준선(C′-min)과 6개 절충안 + 게이트 A 초과분의 상한 적용판을 모두 판정한다.
 * 순위는 ①미통과 게이트 수 → ②B 계열 미달 폭 합계(수익률 %p) → ③A 미달 폭(건/일) 오름차순.
 */
function deriveCompromiseEvals(
  freq: FreqSummary[],
  cohorts: CohortResult[],
  cappedIds: readonly Phase0CompromiseId[]
): { evals: CompromiseEval[]; ranked: CompromiseEval[]; anyPass: CompromiseEval[] } {
  const evals: CompromiseEval[] = [];
  const plainIds: readonly Phase0AnyConfigId[] = ['CMIN', ...COMPROMISE_CONFIG_IDS];
  for (const id of plainIds) {
    evals.push(
      evaluateCompromise(
        id,
        id,
        ALL_CONFIG_LABEL[id],
        false,
        ALL_CONFIG_RULE_SETS[id],
        id === 'CMIN' ? [] : COMPROMISE_ADDED_RULES[id as Phase0CompromiseId],
        freq,
        cohorts,
        (c) => c.configs.find((x) => x.config === id)
      )
    );
  }
  for (const id of cappedIds) {
    evals.push(
      evaluateCompromise(
        `${id}@cap${PH0.capDailyBudget}`,
        id,
        `${ALL_CONFIG_LABEL[id]}@cap${PH0.capDailyBudget}`,
        true,
        ALL_CONFIG_RULE_SETS[id],
        COMPROMISE_ADDED_RULES[id],
        freq,
        cohorts,
        (c) => c.cappedCompromise[id]
      )
    );
  }
  const ranked = [...evals].sort((a, b) => {
    if (a.shortfall.failedGates !== b.shortfall.failedGates)
      return a.shortfall.failedGates - b.shortfall.failedGates;
    const sa = a.shortfall.B1 + a.shortfall.B2 + a.shortfall.B3;
    const sb = b.shortfall.B1 + b.shortfall.B2 + b.shortfall.B3;
    if (Math.abs(sa - sb) > 1e-12) return sa - sb;
    if (Math.abs(a.shortfall.A - b.shortfall.A) > 1e-12) return a.shortfall.A - b.shortfall.A;
    return a.key < b.key ? -1 : 1;
  });
  return { evals, ranked, anyPass: evals.filter((e) => e.allPass) };
}

// ===========================================================================
// 문서
// ===========================================================================

const n2 = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d) : 'NA');
const pc = (x: number, d = 2): string => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : 'NA');

/** §0·§4·§5의 기존 표는 **원 3구성만** 싣는다(절충안은 §0-3 전용 — 1차 문서 재현성 보존). */
const baseConfigsOf = (c: CohortResult): ConfigPerf[] =>
  c.configs.filter((x) => (PHASE0_CONFIG_IDS as readonly string[]).includes(x.config));

function freqTable(freq: FreqSummary[], period: PeriodKey): string {
  const lines: string[] = [];
  lines.push('| 구성 | 규모 | 일평균(신규) | 중앙값(신규) | p90(신규) | 최대(신규) | 세트별 일평균 p90 | 상태 지속 일평균 |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const cfg of PHASE0_CONFIG_IDS) {
    for (const size of PH0.sizes) {
      const f = freq.find((x) => x.period === period && x.size === size && x.config === cfg);
      if (!f) continue;
      lines.push(
        `| ${PHASE0_CONFIG_LABEL[cfg]} | ${size}종목 | **${n2(f.newAlerts.mean, 3)}** | ${n2(
          f.newAlerts.median,
          1
        )} | ${n2(f.newAlerts.p90, 1)} | ${n2(f.newAlerts.max, 0)} | ${n2(
          f.newAlertsPerSetMean.p90,
          3
        )} | ${n2(f.stateAlerts.mean, 2)} |`
      );
    }
  }
  return lines.join('\n');
}

function bPrimeSection(
  freq: FreqSummary[],
  cohorts: CohortResult[],
  bp: { cells: BPrimeCell[]; gates: GateResult[]; overallPass: boolean },
  originalOverallPass: boolean
): string {
  const L: string[] = [];
  const push = (s = ''): void => {
    L.push(s);
  };
  const yn = (b: boolean): string => (b ? '**통과**' : '**미통과**');

  push('## 0-2. 게이트 B 재설계 (사후 수정, 2026-07-26)');
  push();
  push(
    '> **⚠ 사후 수정 고지**: 이 절의 판정 기준(B′)은 위 §0의 1차 실행 결과를 **본 뒤** 만든 것이다. 결과를 보고 기준을 바꾸는 것은 연구자 자유도 남용 위험이 있다. 상쇄 장치로 ①원 게이트 B 판정을 §0에 **그대로 남겨 병기**하고 ②C′-min이 탈락 가능한 **적대적 조건(B′-3)**을 새로 추가했다. 기준은 실행 **전에** 계획서(`docs/PLAN_앱적용_신호정비_260726.md` §Phase 0-B)에 고정했다. 이 절은 신호 자체의 채택 검증이 아니라 **운영 구성 설계**이며, 급성 6종의 검증 등급(REVIEW_WARNING)은 이 절과 무관하게 이미 확정된 값이다.'
  );
  push();
  push('### 0-2-1. 개정 사유 — 원 게이트 B가 과잉매매를 보상한다');
  push();
  push(
    '원 게이트 B는 "하위10% 손실 회피"만 재고 그 회피의 **대가**를 차감하지 않는다. 무한정 매도하는 정책은 정의상 꼬리위험을 항상 줄이므로, 이 기준에서는 **더 자주 파는 쪽이 언제나 이긴다**. 1차 실행 실측이 이를 확인했다(검증표본·RANDOM): C는 하위10%를 25.35%p 개선하지만 252거래일 창에서 평균 **10.41회 매도**·누적 거래비용 **8.42%**를 치르고, 평균 수익률이 HOLD 대비 **8.51%p 악화**(+0.96% → −7.55%)됐다. 즉 C의 회피는 "잘 골라서 팔았다"가 아니라 "거의 항상 팔고 있었다"에 가깝다.'
  );
  push();
  push(
    '그래서 기준선을 C가 아니라 **HOLD(아무 알림도 실행하지 않는 방치 상태)**로 바꾼다. 사용자의 실제 대안은 "완벽히 실행되는 C"가 아니라 "알림 폭주로 실행되지 않는 C"에 가깝기 때문이다.'
  );
  push();
  push('### 0-2-2. 예산제한 C (`C_CAPPED`) — 적대적 비교 정책의 정의');
  push();
  push(
    '"규칙을 교체할 것 없이 개수만 제한하면 되는 것 아닌가"라는 반론을 정면으로 시험하기 위해, **현행 13종을 그대로 쓰되 하루 실행 건수만 제한**하는 정책을 새로 구현했다.'
  );
  push();
  push('| 항목 | 정의 |');
  push('|---|---|');
  push('| 규칙 집합 | C와 **완전히 동일한 현행 13종** (교체·삭제 없음) |');
  push(
    `| 후보 | 그날 **신규 전이**된 (종목,규칙) 쌍 — 게이트 A의 알림 정의 (1)과 같다 |`
  );
  push(`| 하루 상한 | ${PH0.capDailyBudget}건 (사용자 알림 철학 0~3건/일과 동일 값) |`);
  push(
    '| 우선순위 | `severity`(critical > warning > info) → 동률이면 **종목코드 오름차순** → 그래도 동률이면(같은 종목의 두 규칙) 비트 인덱스 오름차순. 난수 없음, 완전 결정론 |'
  );
  push('| 미실행 신호 | **그날 소멸**. 이월·대기열 없음(알림 폭주로 놓치는 상황의 근사) |');
  push(
    '| 체결·비용 | C와 동일(익일 시가 매도 · 매도세+변동 30bps · 20거래일 뒤 재매수) |'
  );
  push();
  push(
    `**severity 원본**: 앱 \`constants/alertRules.ts\`(2026-07-26 읽음)의 매도규칙 severity 값 그대로다. critical 4종(\`stop-loss\` · \`overheat-drop\` · \`overheat-profit\` · \`daily-crash\`), warning 9종(나머지), info 0종. 즉 **손절·급락 계열이 예산을 먼저 가져간다** — C_CAPPED에 유리한(꼬리 방어에 강한) 배치이며, 이것이 적대 조건의 취지다.`
  );
  push();
  push(
    `**포트폴리오 규모 정규화(계획과 다르게 판단한 지점 ①)**: 하루 3건이라는 상한은 **60종목 포트폴리오**를 전제로 정해진 값이다(게이트 A 주분석과 같은 규모). 그런데 손실회피 축의 코호트는 동시보유가 수백 건이어서, 코호트 전체에 3건을 그대로 걸면 C_CAPPED가 사실상 HOLD가 되어 **B′-3이 무력해진다**(= C′-min에게 유리한 방향). 그래서 코호트를 "동시보유 ≈${PH0.capTargetHoldings}종목"짜리 합성 포트폴리오 G개로 쪼개고 각 그룹에 하루 ${PH0.capDailyBudget}건을 건다. 그룹 배정은 **종목코드 오름차순 라운드로빈**(난수 없음). 자본은 보유별로 독립(각 1.0)이고 **공유되는 것은 알림 예산뿐**이라, 포지션별 수익률이 HOLD/C/C′와 1:1 비교 가능하다(같은 포지션·같은 창·같은 표본).`
  );
  push();
  push('| 코호트 | 표본 | 포지션 | 코호트 평균 동시보유 | 그룹 수 G | 그룹당 평균 동시보유 |');
  push('|---|---|---:|---:|---:|---:|');
  for (const c of cohorts) {
    const cap = c.capped[0];
    if (!cap) continue;
    push(
      `| ${c.cohort} | ${c.period} | ${c.nPositions} | ${n2(cap.avgConcurrency, 1)} | ${
        cap.groupCount
      } | ${n2(cap.meanConcurrencyPerGroup, 1)} |`
    );
  }
  push();
  push(
    '**항등식 가드**: 상한을 무한대로 풀면 C_CAPPED는 C와 **정확히 같은 정책**이 된다(C는 상태가 켜진 첫날 매도하고, 전이도 같은 날 일어나며, 현금 구간에서는 전이 기준 마스크를 0으로 리셋하므로 재매수 직후 조건 충족도 신규 전이로 잡힌다). 이 항등식은 골든 테스트가 절대값으로 고정한다 — C_CAPPED가 C를 왜곡 재현하는 것이 아님을 보증한다.'
  );
  push();
  push('### 0-2-3. 알림 소화율 — 현행 규칙은 예산 안에서 얼마나 손실되는가');
  push();
  push('**(a) 빈도 축** (매도 없음 · 60종목 × 200세트 · 검증표본 — 게이트 A와 동일 설계)');
  push();
  push('| 구성 | 규모 | 일평균 발동(신규 전이) | 하루 3건 상한 시 일평균 실행 | **버려지는 비율** |');
  push('|---|---:|---:|---:|---:|');
  for (const cfg of PHASE0_CONFIG_IDS) {
    for (const size of PH0.sizes) {
      const f = freq.find((x) => x.period === 'VALIDATION' && x.size === size && x.config === cfg);
      if (!f) continue;
      push(
        `| ${PHASE0_CONFIG_LABEL[cfg]} | ${size}종목 | ${n2(f.newAlerts.mean, 3)} | ${n2(
          f.cappedMeanExecuted,
          3
        )} | **${pc(f.cappedDropShare, 1)}** |`
      );
    }
  }
  push();
  const fC60 = freq.find((x) => x.period === 'VALIDATION' && x.size === 60 && x.config === 'C');
  const fMin60 = freq.find(
    (x) => x.period === 'VALIDATION' && x.size === 60 && x.config === 'CMIN'
  );
  if (fC60 && fMin60) {
    push(
      `> 60종목 기준 현행 C는 하루 평균 ${n2(fC60.newAlerts.mean, 2)}건을 띄우지만 예산 3건 안에서 실제로 소화되는 것은 ${n2(
        fC60.cappedMeanExecuted,
        2
      )}건이고, **${pc(fC60.cappedDropShare, 1)}가 그날 버려진다**. C′-min은 발동 자체가 ${n2(
        fMin60.newAlerts.mean,
        2
      )}건/일이라 상한에 거의 닿지 않는다(버려지는 비율 ${pc(fMin60.cappedDropShare, 1)}).`
    );
  }
  push();
  push('**(b) 정책 축** (실제 매도·재매수를 시뮬레이션한 C_CAPPED 내부 집계)');
  push();
  push(
    '| 코호트 | 표본 | 발동 알림 | 실행 | 소멸 | **버려진 비율** | 그룹-일 평균 발동 | 그룹-일 평균 실행 |'
  );
  push('|---|---|---:|---:|---:|---:|---:|---:|');
  for (const c of cohorts) {
    const cap = c.capped[0];
    if (!cap) continue;
    push(
      `| ${c.cohort} | ${c.period} | ${cap.totalCandidates} | ${cap.executedCandidates} | ${
        cap.droppedCandidates
      } | **${pc(cap.dropShare, 1)}** | ${n2(cap.meanDailyCandidates, 2)} | ${n2(
        cap.meanDailyExecuted,
        3
      )} |`
    );
  }
  push();
  push(
    `> "그룹-일 평균 실행"은 정의상 상한 ${PH0.capDailyBudget}건을 넘을 수 없다 — 위 표의 모든 값이 ${PH0.capDailyBudget} 이하인지가 구현 검증이다. 값이 상한보다 훨씬 작은 이유는 알림이 없는 날이 많기 때문이다(평균은 무발동일을 포함한다).`
  );
  const badOpen = cohorts.reduce((a, c) => a + (c.capped[0]?.deferredBadOpen ?? 0), 0);
  push();
  push(
    `> 시가가 0인 봉에 매도가 걸려 다음 봉으로 이월된 횟수: **${badOpen}건**(전체 코호트 합계). 원본 per-position 시뮬레이션은 이 경우 포지션을 무효화하지만, C_CAPPED는 C/C′와 **동일한 포지션 집합**을 유지해야 비교가 성립하므로 이월로 처리했다.`
  );
  push();
  push('### 0-2-4. 정책 5종 비교 (같은 포지션·같은 창)');
  push();
  for (const c of cohorts) {
    const get = (id: string): ConfigPerf | undefined => c.configs.find((x) => x.config === id);
    const cC = get('C');
    const cMin = get('CMIN');
    const cMid = get('CMID');
    const cap = c.capped[0];
    if (!cC || !cMin || !cMid || !cap) continue;
    push(`**${c.cohort} · ${c.period}** (n=${c.nPositions})`);
    push();
    push('| 지표 | HOLD | C | **C_CAPPED** | **C′-min** | C′-mid |');
    push('|---|---:|---:|---:|---:|---:|');
    push(
      `| 수익률 **평균** | ${pc(c.hold.meanReturn)} | ${pc(cC.agg.meanReturn)} | ${pc(
        cap.agg.meanReturn
      )} | ${pc(cMin.agg.meanReturn)} | ${pc(cMid.agg.meanReturn)} |`
    );
    push(
      `| 수익률 중앙값 | ${pc(c.hold.medianReturn)} | ${pc(cC.agg.medianReturn)} | ${pc(
        cap.agg.medianReturn
      )} | ${pc(cMin.agg.medianReturn)} | ${pc(cMid.agg.medianReturn)} |`
    );
    push(
      `| 수익률 **하위10%** | ${pc(c.hold.p10Return)} | ${pc(cC.agg.p10Return)} | ${pc(
        cap.agg.p10Return
      )} | ${pc(cMin.agg.p10Return)} | ${pc(cMid.agg.p10Return)} |`
    );
    push(
      `| 하위10% 회피(vs HOLD) | — | ${pc(cC.p10Avoidance)}p | ${pc(cap.p10Avoidance)}p | ${pc(
        cMin.p10Avoidance
      )}p | ${pc(cMid.p10Avoidance)}p |`
    );
    push(
      `| MDD 중앙값 | ${pc(c.hold.medianMdd)} | ${pc(cC.agg.medianMdd)} | ${pc(
        cap.agg.medianMdd
      )} | ${pc(cMin.agg.medianMdd)} | ${pc(cMid.agg.medianMdd)} |`
    );
    push(
      `| 매도 횟수 평균 | 0.00 | ${n2(cC.agg.meanSells)} | ${n2(cap.agg.meanSells)} | ${n2(
        cMin.agg.meanSells
      )} | ${n2(cMid.agg.meanSells)} |`
    );
    push(
      `| 누적 거래비용(원금 대비) | ${pc(c.hold.meanCostPaid, 3)} | ${pc(
        cC.agg.meanCostPaid,
        3
      )} | ${pc(cap.agg.meanCostPaid, 3)} | ${pc(cMin.agg.meanCostPaid, 3)} | ${pc(
        cMid.agg.meanCostPaid,
        3
      )} |`
    );
    push(
      `| 실행 매도 후 63일 성과(중앙값) | — | ${pc(cC.postSellReturn63Median)} | ${pc(
        cap.postSellReturn63Median
      )} | ${pc(cMin.postSellReturn63Median)} | ${pc(cMid.postSellReturn63Median)} |`
    );
    push(
      `| (참고) HOLD경로 첫 트리거 후 63일 | — | ${pc(cC.postTriggerReturn63Median)} | — | ${pc(
        cMin.postTriggerReturn63Median
      )} | ${pc(cMid.postTriggerReturn63Median)} |`
    );
    push();
  }
  push(
    '- "실행 매도 후 63일 성과"는 **그 정책이 실제로 체결한 모든 매도**의 체결가 대비 63거래일 뒤 종가 수익률 중앙값이다. 음수면 팔고 나서 더 떨어졌다는 뜻(= 매도가 옳았음).'
  );
  push(
    '- 마지막 행("HOLD경로 첫 트리거")은 §5의 기존 정의(매도 없이 계속 보유했을 때의 **첫** 발동 시점 기준)이며 위 행과 표본이 다르다. C_CAPPED는 HOLD 경로 트리거 개념이 없어 "—"다.'
  );
  push();
  push('### 0-2-5. 게이트 B′ 판정');
  push();
  push(`**종합: ${bp.overallPass ? '통과' : '미통과'}**`);
  push();
  push('| 코드 | 기준 | 결과 | 실측 |');
  push('|---|---|---|---|');
  for (const g of bp.gates) {
    const [code, ...rest] = g.gate.split(' ');
    push(`| ${code} | ${rest.join(' ')} | ${yn(g.pass)} | ${g.detail} |`);
  }
  push();
  push('셀별 상세(4셀 = 2코호트 × 2표본):');
  push();
  push(
    '| 코호트/표본 | HOLD 평균 | C′-min 평균 | 평균 악화 | HOLD 중앙 | C′-min 중앙 | 중앙 악화 | B′-1 |'
  );
  push('|---|---:|---:|---:|---:|---:|---:|:--:|');
  for (const c of bp.cells) {
    push(
      `| ${c.cohort}/${c.period} | ${pc(c.holdMean)} | ${pc(c.cminMean)} | ${pc(
        c.meanDegrade
      )}p | ${pc(c.holdMedian)} | ${pc(c.cminMedian)} | ${pc(c.medianDegrade)}p | ${
        c.bp1 ? 'O' : 'X'
      } |`
    );
  }
  push();
  push('| 코호트/표본 | HOLD 하위10% | C′-min 하위10% | 개선폭 | 기준 | B′-2 |');
  push('|---|---:|---:|---:|---:|:--:|');
  for (const c of bp.cells) {
    push(
      `| ${c.cohort}/${c.period} | ${pc(c.holdP10)} | ${pc(c.cminP10)} | **${pc(
        c.tailImprove
      )}p** | ≥ ${pc(PH0.gateBp2MinTailImprove, 0)}p | ${c.bp2 ? 'O' : 'X'} |`
    );
  }
  push();
  push(
    '**B′-3 정면 비교 — C′-min vs C_CAPPED** (이 절에서 가장 중요한 표. "열등하지 않다"의 조작적 정의 = **평균·하위10% 어느 쪽에서도 1%p 이상 뒤지지 않을 것**. 부호 규약: 양수 = C′-min이 뒤짐)'
  );
  push();
  push(
    '| 코호트/표본 | C_CAPPED 평균 | C′-min 평균 | 평균 열세 | C_CAPPED 하위10% | C′-min 하위10% | 하위10% 열세 | B′-3 |'
  );
  push('|---|---:|---:|---:|---:|---:|---:|:--:|');
  for (const c of bp.cells) {
    push(
      `| ${c.cohort}/${c.period} | ${pc(c.cappedMean)} | ${pc(c.cminMean)} | ${pc(
        c.lagMean
      )}p | ${pc(c.cappedP10)} | ${pc(c.cminP10)} | **${pc(c.lagP10)}p** | ${c.bp3 ? 'O' : 'X'} |`
    );
  }
  push();
  push();
  push('이 표를 읽는 법(판정에 새 기준을 더하지 않는 사실 진술):');
  push();
  push(
    '- 두 지표가 **정반대**로 갈린다. C′-min은 평균 수익률에서 C_CAPPED를 4셀 전부 앞서고(3.80~7.49%p), 하위10%에서는 4셀 전부 뒤진다(7.04~10.25%p). B′-3은 **양쪽 모두**에서 열등하지 않을 것을 요구하므로 4셀 전부 미통과다.'
  );
  push(
    '- 즉 "규칙을 교체하지 말고 개수만 제한하면 되는 것 아닌가"라는 반론은 **꼬리위험 측면에서는 유효하다**. 현행 13종을 하루 3건으로 잘라도 하위10%는 C′-min보다 7~10%p 낫다. 대신 그 대가로 평균 수익률을 4~7%p 더 잃고 매도 횟수가 2~3배(3.2~4.0회 → 7.4~8.7회), 거래비용이 2배 이상(2.7~3.9% → 6.2~7.6%) 든다.'
  );
  push(
    '- 셀별 방향이 4/4로 일치하므로 이 결과는 표본 하나의 우연이 아니다(개발·검증 양 표본, 두 코호트 모두 같은 방향).'
  );
  push(
    '- 위 B′-1 표의 "중앙 악화"가 음수인 것은 **C′-min이 HOLD보다 좋다**는 뜻이다(부호 규약: 양수 = C′-min이 나쁨).'
  );
  push();
  push('### 0-2-6. 민감도 — 예산을 두 배로 풀면 (C_CAPPED에 더 유리한 조건)');
  push();
  push(
    `그룹당 상한을 ${PH0.capDailyBudget}건 → ${PH0.capSensitivityBudget}건으로 올린 경우다. 그룹당 동시보유가 약 ${PH0.capTargetHoldings}종목이므로, 이는 **"${PH0.capTargetHoldings / 2}종목 포트폴리오에 하루 ${PH0.capDailyBudget}건"과 같은 1종목당 예산**이다. 상한이 느슨할수록 C_CAPPED는 C에 가까워진다(꼬리는 좋아지고 평균은 나빠진다).`
  );
  push();
  push(
    '| 코호트/표본 | 예산 | 평균 | 하위10% | 매도 평균 | 버려진 비율 | vs C′-min 평균 열세 | vs C′-min 하위10% 열세 |'
  );
  push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const c of cohorts) {
    const cmin = c.configs.find((x) => x.config === 'CMIN');
    if (!cmin) continue;
    for (const cap of c.capped) {
      push(
        `| ${c.cohort}/${c.period} | ${cap.dailyBudget}건 | ${pc(cap.agg.meanReturn)} | ${pc(
          cap.agg.p10Return
        )} | ${n2(cap.agg.meanSells)} | ${pc(cap.dropShare, 1)} | ${pc(
          cap.agg.meanReturn - cmin.agg.meanReturn
        )}p | ${pc(cap.agg.p10Return - cmin.agg.p10Return)}p |`
      );
    }
  }
  push();
  push('### 0-2-7. 종합 판정 (원 기준 · 신 기준 병기)');
  push();
  push('| 기준 | 판정 |');
  push('|---|---|');
  push(`| **원 게이트 A+B** (§0, 1차 실행 · 기준선 = C) | ${yn(originalOverallPass)} |`);
  push(`| **게이트 B′-1** 수익 보존 (기준선 = HOLD) | ${yn(bp.gates[0]?.pass ?? false)} |`);
  push(`| **게이트 B′-2** 꼬리 개선 (기준선 = HOLD) | ${yn(bp.gates[1]?.pass ?? false)} |`);
  push(`| **게이트 B′-3** 적대 조건 (vs C_CAPPED) | ${yn(bp.gates[2]?.pass ?? false)} |`);
  push(`| **게이트 B′ 종합** | ${yn(bp.overallPass)} |`);
  push();
  push(
    '> 이 문서는 사전 고정된 기준으로 판정만 한다. 구성 조정·채택 결정은 하지 않는다(계획서 §2·§4: 조정과 승인은 사용자 몫).'
  );
  push();
  push('### 0-2-8. 이 절의 한계 (지적당하기 전에 명시)');
  push();
  push(
    '1. **사후 수정이다.** B′는 1차 결과를 본 뒤 만든 기준이다. B′-3(적대 조건)과 개발표본 포함이 상쇄 장치이지만, 이것이 사전등록과 동등한 증거력을 갖지는 않는다. 이 절의 결론은 **운영 구성 선택**에만 쓰고, 신호의 검증 등급을 바꾸는 근거로 쓰면 안 된다.'
  );
  push(
    `2. **그룹 수 G는 연구자가 고른 값이다.** 목표 동시보유 ${PH0.capTargetHoldings}종목은 게이트 A 주분석 규모와 맞춘 값이지만, 이 값에 따라 C_CAPPED의 1종목당 예산이 달라지고 B′-3의 결과가 흔들릴 수 있다. 그래서 §0-2-6에 예산 2배 민감도를 함께 실었다. 반대로 예산을 코호트 전체(동시보유 수백 건)에 3건으로 걸면 C_CAPPED는 HOLD에 수렴하고 B′-3은 무력해진다 — 그 방향은 C′-min에게 유리하므로 채택하지 않았다.`
  );
  push(
    '3. **C_CAPPED는 "완벽히 규율 있는 사용자"를 가정한다.** 매일 상위 3건을 빠짐없이 실행한다는 뜻이며, 실제 사용자는 그보다 덜 실행할 것이다. 이 가정도 C_CAPPED에 유리한 방향이다.'
  );
  push(
    '4. 발동 후보를 **신규 전이**로 세는 것은 알림 축(게이트 A)의 정의와 맞춘 것이다. C는 상태 기준으로 매도하지만, 상한 없는 C_CAPPED가 C와 항등이 되는 것을 골든 테스트로 확인했으므로 이 차이가 결과를 왜곡하지 않는다.'
  );
  push(
    '5. **잠금표본(2023-2025)은 이 절에서도 열지 않았다.** 개발표본(2012-2019 측정창)을 판정에 포함한 것은 검증표본 결과를 보고 만든 기준에 대한 유사 표본외 확인 역할이다.'
  );
  push();
  push('### 0-2-9. 계획과 다르게 판단한 지점 (전부)');
  push();
  push(
    `1. **포트폴리오 규모 정규화**(§0-2-2). 계획서는 "하루 최대 3건"만 지정했다. 코호트 전체(동시보유 113~453건)에 3건을 그대로 걸면 C_CAPPED가 HOLD로 수렴해 적대 조건이 무력해지므로, 동시보유 ≈${PH0.capTargetHoldings}종목짜리 그룹으로 쪼개 각 그룹에 상한을 걸었다. **C′-min에게 불리한(= 더 적대적인) 방향**을 택했다.`
  );
  push(
    `2. **B′-3 "열등하지 않다"의 조작적 정의를 ${(PH0.gateBp3MaxLagVsCapped * 100).toFixed(
      0
    )}%p로 고정**했다(계획서 권장안 그대로). 평균 수익률과 하위10% 각각에서 C_CAPPED에 ${(
      PH0.gateBp3MaxLagVsCapped * 100
    ).toFixed(0)}%p 이상 뒤지면 탈락이며, **양쪽 모두** 충족해야 통과다.`
  );
  push(
    '3. **발동 후보 = 신규 전이**(상태 아님). 알림 축(게이트 A)의 정의와 맞추기 위해서다. 상한 없는 C_CAPPED가 C와 항등이 되는 것을 골든 테스트로 고정해 왜곡이 없음을 보증했다.'
  );
  push(
    `4. **부실 시가(open ≤ 0) 처리**. 원본 per-position 시뮬레이션은 포지션을 무효화하지만, C_CAPPED는 C/C′와 같은 포지션 집합을 유지해야 비교가 성립하므로 매도를 다음 봉으로 이월했다(발생 ${badOpen}건, §0-2-3에 공개).`
  );
  push(
    `5. **민감도를 "30종목 그룹" 대신 "같은 그룹에 예산 ${PH0.capSensitivityBudget}건"으로 구현**했다. 그룹당 동시보유가 약 ${PH0.capTargetHoldings}종목이므로 1종목당 예산이 "30종목에 3건"과 정확히 같고, 지표 시계열을 다시 만들지 않아도 된다.`
  );
  push(
    '6. **"실행 매도 후 63일 성과" 지표를 신설**해 5종 비교표에 넣었다. 기존 §5의 "트리거 후 63일"은 HOLD 경로의 **첫** 발동만 보는 정의라 C_CAPPED에 대응물이 없다. 두 정의를 같은 표에 병기하고 라벨로 구분했다.'
  );
  push(
    '7. 개발표본 측정창은 1차와 동일하게 2012-07-01~2019-12-31이다(사유는 §3 주석). 시드·표본 추출은 1차와 완전히 같아 C/C′-min/C′-mid/HOLD 수치가 1차 실행과 **한 자리도 달라지지 않았다** — 이 문서의 §0 표가 그 증거다.'
  );
  push();
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// §0-3 절충안 탐색
// ---------------------------------------------------------------------------

function compromiseSection(
  freq: FreqSummary[],
  cohorts: CohortResult[],
  comp: { evals: CompromiseEval[]; ranked: CompromiseEval[]; anyPass: CompromiseEval[] },
  cappedIds: readonly Phase0CompromiseId[]
): string {
  const L: string[] = [];
  const push = (s = ''): void => {
    L.push(s);
  };
  const ox = (b: boolean): string => (b ? 'O' : 'X');
  const val60 = (cfg: string): FreqSummary | undefined =>
    freq.find((x) => x.period === 'VALIDATION' && x.size === 60 && x.config === cfg);

  // 규칙별 일평균 발동(신규 전이) — 규칙 단위 값은 구성과 무관하다(같은 (종목,규칙) 전이를 센다).
  const fC = val60('C');
  const fMin = val60('CMIN');
  const perRuleDaily = new Map<string, number>();
  if (fC) {
    const denom = fC.days * fC.sets;
    for (const r of fC.ruleContribution) perRuleDaily.set(r.rule, r.transitions / denom);
  }
  const ruleDaily = (id: string): number => perRuleDaily.get(id) ?? NaN;

  push('## 0-3. 절충안 탐색 — 꼬리 방어 규칙을 되살리면 네 게이트를 전부 통과할 수 있는가');
  push();
  push(
    '> **이 절의 위치**: §0-2에서 C′-min은 게이트 A·B′-1·B′-2를 통과했지만 **B′-3(적대 조건)에서 4셀 전부 탈락**했다. 평균 수익률은 C′-min이 앞서고 하위10% 꼬리는 C_CAPPED가 앞서는 교환관계가 실측됐다. 이 절은 **그 교환관계를 깰 수 있는 구성이 있는지** 탐색한다. **판정 기준(게이트 A·B′-1·B′-2·B′-3)은 §0-2에서 한 글자도 바꾸지 않았다.** 바뀐 것은 판정 대상 구성뿐이다. 시드·포트폴리오 표본·코호트는 1차·0-B와 완전히 동일하다.'
  );
  push();
  push(
    '> **탐색이라는 점을 숨기지 않는다.** 여러 구성을 만들어 같은 게이트에 통과시키는 것은 다중비교다. 여기서 통과하는 구성이 나와도 그것은 **운영 구성 후보**일 뿐이며, 잠금표본(2023-2025)으로 확인하기 전에는 잠정이다. 통과 구성이 없으면 없다고 그대로 보고한다.'
  );
  push();

  // ── 0-3-1. 구성 정의 ──
  push('### 0-3-1. 탐색한 구성 (사전 고정)');
  push();
  push(
    `되살릴 후보는 꼬리 방어 성격의 3종 — \`${TAIL_DEFENSE_RULES.join('` · `')}\` — 이다. 포화 주범 3종(\`${SATURATION_EXCLUDED_RULES.join('` · `')}\`)은 이번 탐색 대상에서 **제외**했다.`
  );
  push();
  push('| 코드 | 구성 | 규칙 수 | C′-min에 추가된 규칙 |');
  push('|---|---|---:|---|');
  push(
    `| \`CMIN\` | ${ALL_CONFIG_LABEL.CMIN} (기준) | ${ALL_CONFIG_RULE_SETS.CMIN.length} | — |`
  );
  for (const id of COMPROMISE_CONFIG_IDS) {
    push(
      `| \`${id}\` | ${ALL_CONFIG_LABEL[id]} | ${ALL_CONFIG_RULE_SETS[id].length} | ${COMPROMISE_ADDED_RULES[
        id
      ]
        .map((r) => `\`${r}\``)
        .join(' + ')} |`
    );
  }
  push();
  push(
    `상한 적용판(\`@cap${PH0.capDailyBudget}\`)은 **게이트 A(≤${PH0.gateMaxDailyNewAlerts}건/일)를 초과한 구성 전부**에 대해 산출했다(실측으로 결정 — 아래 0-3-2). 상한 로직은 §0-2-2의 \`applyDailyCap\`·우선순위(severity → 종목코드 → 비트 인덱스)를 **그대로 재사용**했다. 이번 실행에서 상한판이 만들어진 구성: ${
      cappedIds.length > 0 ? cappedIds.map((i) => `\`${i}\``).join(' · ') : '없음'
    }.`
  );
  push();

  // ── 0-3-2. 알림 빈도 ──
  push('### 0-3-2. 구성별 알림 빈도 (60종목 · 검증표본 · 게이트 A 대상)');
  push();
  push(
    '| 구성 | 일평균 신규 전이 | 상한3 적용 시 일평균 실행 | 버려지는 비율 | 상태 지속 일평균 | 최대 스파이크(단일 세트·일) | 게이트 A |'
  );
  push('|---|---:|---:|---:|---:|---:|:--:|');
  for (const cfg of ['CMIN', ...COMPROMISE_CONFIG_IDS]) {
    const f = val60(cfg);
    if (!f) continue;
    const ok = f.newAlerts.mean <= PH0.gateMaxDailyNewAlerts;
    push(
      `| ${ALL_CONFIG_LABEL[cfg as Phase0AnyConfigId]} | **${n2(f.newAlerts.mean, 3)}** | ${n2(
        f.cappedMeanExecuted,
        3
      )} | ${pc(f.cappedDropShare, 1)} | ${n2(f.stateAlerts.mean, 2)} | ${f.newAlerts.max} | ${ox(
        ok
      )} |`
    );
  }
  push(
    `| (참고) ${ALL_CONFIG_LABEL.C} | ${n2(fC?.newAlerts.mean ?? NaN, 3)} | ${n2(
      fC?.cappedMeanExecuted ?? NaN,
      3
    )} | ${pc(fC?.cappedDropShare ?? NaN, 1)} | ${n2(fC?.stateAlerts.mean ?? NaN, 2)} | ${
      fC?.newAlerts.max ?? 0
    } | ${ox((fC?.newAlerts.mean ?? Infinity) <= PH0.gateMaxDailyNewAlerts)} |`
  );
  push();
  push('**규칙별 기여** (60종목·검증표본. (종목,규칙) 전이 카운트이므로 구성과 무관한 값이다 — 어떤 구성에 넣어도 같은 건수를 더한다)');
  push();
  push('| 규칙 | 전이 건수 | 일평균 건/일 | C′-min(8종) 대비 |');
  push('|---|---:|---:|---:|');
  const minDaily = fMin ? fMin.newAlerts.mean : NaN;
  push(
    `| **C′-min 8종 합계** | ${fMin ? fMin.ruleContribution.reduce((a, b) => a + b.transitions, 0) : 0} | **${n2(
      minDaily,
      3
    )}** | — |`
  );
  for (const rule of TAIL_DEFENSE_RULES) {
    const d = ruleDaily(rule);
    const cnt = fC?.ruleContribution.find((r) => r.rule === rule)?.transitions ?? 0;
    push(`| \`${rule}\` | ${cnt} | ${n2(d, 3)} | +${n2((d / minDaily) * 100, 1)}% |`);
  }
  for (const rule of SATURATION_EXCLUDED_RULES) {
    const d = ruleDaily(rule);
    const cnt = fC?.ruleContribution.find((r) => r.rule === rule)?.transitions ?? 0;
    push(`| (제외) \`${rule}\` | ${cnt} | ${n2(d, 3)} | +${n2((d / minDaily) * 100, 1)}% |`);
  }
  push();
  push(
    '> 신규 전이는 (종목,규칙) 단위로 세므로 **구성의 일평균 = 포함된 규칙들의 일평균 합**이다. 위 표의 값으로 어떤 조합의 알림량이든 미리 계산할 수 있고, 0-3-2 첫 표의 실측치가 그 합과 일치한다(독립 집계로 교차확인).'
  );
  push();

  // ── 0-3-3. 4게이트 판정 매트릭스 ──
  push('### 0-3-3. 4게이트 판정 매트릭스');
  push();
  push(
    `기준은 §0-2와 동일하다. **A**: 60종목 일평균 신규 알림 ≤ ${PH0.gateMaxDailyNewAlerts}건(검증표본) · **B′-1**: 평균·중앙 수익률이 HOLD 대비 ${(
      PH0.gateBp1MaxReturnDegrade * 100
    ).toFixed(0)}%p 넘게 악화되지 않을 것(4셀) · **B′-2**: 하위10%가 HOLD 대비 ${(
      PH0.gateBp2MinTailImprove * 100
    ).toFixed(0)}%p 이상 개선(4셀) · **B′-3**: C_CAPPED 대비 평균·하위10% 어느 쪽에서도 ${(
      PH0.gateBp3MaxLagVsCapped * 100
    ).toFixed(0)}%p 이상 열세 아닐 것(4셀).`
  );
  push();
  push('| 구성 | A | B′-1 | B′-2 | B′-3 | **전부 통과** | A 미달(건/일) | B′-1 미달 | B′-2 미달 | B′-3 미달 |');
  push('|---|:--:|:--:|:--:|:--:|:--:|---:|---:|---:|---:|');
  for (const e of comp.evals) {
    const sf = e.shortfall;
    push(
      `| ${e.label}${e.cappedVariant ? ' †' : ''} | ${ox(e.gateA)} | ${ox(e.gateB1)} | ${ox(
        e.gateB2
      )} | ${ox(e.gateB3)} | ${e.allPass ? '**O**' : 'X'} | ${
        sf.A > 0 ? `+${n2(sf.A, 3)}` : '—'
      } | ${sf.B1 > 0 ? `${pc(sf.B1)}p` : '—'} | ${sf.B2 > 0 ? `${pc(sf.B2)}p` : '—'} | ${
        sf.B3 > 0 ? `${pc(sf.B3)}p` : '—'
      } |`
    );
  }
  push();
  push(
    `† 상한 적용판은 하루 실행 건수가 정의상 ${PH0.gateMaxDailyNewAlerts}건을 넘을 수 없으므로 게이트 A는 **구조적 통과**다(실력으로 통과한 것이 아니다). "미달" 열은 기준을 얼마나 벗어났는지이며 0이면 "—"다.`
  );
  push();
  const passList = comp.anyPass;
  if (passList.length > 0) {
    push(`**전부 통과 구성: 있음 — ${passList.map((e) => e.label).join(' · ')}**`);
  } else {
    push('**전부 통과 구성: 없음.**');
  }
  push();
  push('가장 근접한 순서(①미통과 게이트 수 → ②B 계열 미달 폭 합계 → ③A 미달 폭):');
  push();
  push('| 순위 | 구성 | 미통과 게이트 수 | 미통과 게이트 | B 미달 합계 |');
  push('|---:|---|---:|---|---:|');
  comp.ranked.forEach((e, i) => {
    const failed = [
      e.gateA ? null : 'A',
      e.gateB1 ? null : "B′-1",
      e.gateB2 ? null : "B′-2",
      e.gateB3 ? null : "B′-3",
    ].filter((x): x is string => x !== null);
    push(
      `| ${i + 1} | ${e.label} | ${e.shortfall.failedGates} | ${
        failed.length > 0 ? failed.join(' · ') : '없음'
      } | ${pc(e.shortfall.B1 + e.shortfall.B2 + e.shortfall.B3)}p |`
    );
  });
  push();

  // ── 0-3-4. 정책 비교표 ──
  push('### 0-3-4. 정책 비교표 (같은 포지션·같은 창 — HOLD·C_CAPPED와 1:1 비교)');
  push();
  for (const c of cohorts) {
    const cap = c.capped[0];
    if (!cap) continue;
    push(`**${c.cohort} · ${c.period}** (n=${c.nPositions})`);
    push();
    push(
      '| 정책 | 평균 | 중앙값 | **하위10%** | 하위10% 회피(vs HOLD) | 매도 평균 | 누적 거래비용 | vs C_CAPPED 평균 열세 | vs C_CAPPED 하위10% 열세 |'
    );
    push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
    push(
      `| HOLD | ${pc(c.hold.meanReturn)} | ${pc(c.hold.medianReturn)} | ${pc(
        c.hold.p10Return
      )} | — | 0.00 | ${pc(c.hold.meanCostPaid, 3)} | ${pc(
        cap.agg.meanReturn - c.hold.meanReturn
      )}p | ${pc(cap.agg.p10Return - c.hold.p10Return)}p |`
    );
    push(
      `| **C_CAPPED**(상한${cap.dailyBudget}) | ${pc(cap.agg.meanReturn)} | ${pc(
        cap.agg.medianReturn
      )} | ${pc(cap.agg.p10Return)} | ${pc(cap.p10Avoidance)}p | ${n2(
        cap.agg.meanSells
      )} | ${pc(cap.agg.meanCostPaid, 3)} | — | — |`
    );
    for (const e of comp.evals) {
      const cell = e.cells.find((x) => x.cohort === c.cohort && x.period === c.period);
      if (!cell) continue;
      push(
        `| ${e.label} | ${pc(cell.mean)} | ${pc(cell.medianReturn)} | ${pc(cell.p10)} | ${pc(
          cell.p10 - cell.holdP10
        )}p | ${n2(cell.meanSells)} | ${pc(cell.meanCostPaid, 3)} | ${pc(cell.lagMean)}p | ${pc(
          cell.lagP10
        )}p |`
      );
    }
    push();
  }
  push('- 부호 규약: "열세" 열은 양수면 그 구성이 C_CAPPED보다 **뒤진다**는 뜻이다(B′-3의 판정 방향과 같다).');
  const invalidRows = cohorts.flatMap((c) =>
    c.configs
      .filter((x) => x.invalidPositions > 0)
      .map((x) => `${c.cohort}/${c.period} ${x.config} ${x.invalidPositions}건`)
  );
  push(
    `- **포지션 집합 동일성**: 포지션 채택 여부는 1차 실행과 똑같이 HOLD + 원 3구성(C·C′-min·C′-mid)만으로 정했다. 절충안을 추가했다고 표본이 달라지지 않는다. 절충안에서만 부실 시가에 매도가 걸려 무효가 된 포지션: ${
      invalidRows.length > 0 ? invalidRows.join(' · ') : '**0건**'
    }.`
  );
  push();

  // ── 0-3-5. 코디네이터 예측 검증 ──
  push('### 0-3-5. 사전 예측 3건의 실측 검증');
  push();
  push(
    '이 절을 지시한 코디네이터가 실행 **전에** 세 가지를 예측했다. 맞았는지 틀렸는지 실측으로 판정한다(틀렸으면 틀렸다고 그대로 적는다).'
  );
  push();

  // 예측 1
  const stopDaily = ruleDaily('stop-loss');
  const dcDaily = ruleDaily('daily-crash');
  const slbDaily = ruleDaily('swing-low-break');
  const stopCnt = fC?.ruleContribution.find((r) => r.rule === 'stop-loss')?.transitions ?? 0;
  const stopRank =
    (fC?.ruleContribution.findIndex((r) => r.rule === 'stop-loss') ?? -1) + 1;
  const eStop = comp.evals.find((e) => e.key === 'CMIN_STOP');
  const p1Hit = stopDaily < dcDaily && stopDaily < slbDaily && (eStop?.gateA ?? false);
  push(
    `**예측 ①** "stop-loss는 신규 전이 기준으로는 알림이 적을 것이다" (근거: P4의 발동률 57%는 *상태 지속* 지표였고, stop-loss는 임계 통과 후 상태가 지속되므로 신규 전이는 드물 것) → **${
      p1Hit ? '맞음' : '틀림'
    }**`
  );
  push();
  push('| 값 | 실측 |');
  push('|---|---:|');
  push(`| \`stop-loss\` 신규 전이 총계(60종목·검증·200세트) | **${stopCnt}건** |`);
  push(`| \`stop-loss\` 신규 전이 일평균 | **${n2(stopDaily, 4)}건/일** |`);
  push(`| C 13종 중 전이 기여 순위 | ${stopRank}위 / ${fC?.ruleContribution.length ?? 0}종 |`);
  push(
    `| 비교: \`daily-crash\` / \`swing-low-break\` | ${n2(dcDaily, 3)} / ${n2(
      slbDaily,
      3
    )}건/일 |`
  );
  push(
    `| C′-min+stop-loss 일평균 | ${n2(eStop?.dailyAlerts ?? NaN, 3)}건/일 (게이트 A ${ox(
      eStop?.gateA ?? false
    )}) |`
  );
  push();
  push(
    `> 상태 지속 축과의 대비: 같은 규칙이 P4에서는 보유 평가일의 57%에서 "발동 중"으로 잡혔지만, 신규 전이로 세면 하루 ${n2(
      stopDaily,
      3
    )}건이다. 예측이 지적한 "상태 vs 전이" 구분이 실측으로 확인된다 — 다만 그 자체가 stop-loss의 유용성을 말해주지는 않는다(0-3-3의 B 게이트가 그 축이다).`
  );
  push();

  // 예측 2
  const eDc = comp.evals.find((e) => e.key === 'CMIN_DC');
  const eSlb = comp.evals.find((e) => e.key === 'CMIN_SLB');
  const soloOver =
    dcDaily > PH0.gateMaxDailyNewAlerts && slbDaily > PH0.gateMaxDailyNewAlerts;
  const comboOver = !(eDc?.gateA ?? true) && !(eSlb?.gateA ?? true);
  push(
    `**예측 ②** "daily-crash와 swing-low-break는 각각 단독으로도 예산(${PH0.gateMaxDailyNewAlerts}건/일)을 초과할 것이다 — 기여도 역산 시 각각 ~2.2, ~2.3건/일" → **${
      soloOver ? '맞음' : '틀림'
    }**(규칙 단독 기준) / **${comboOver ? '맞음' : '틀림'}**(C′-min에 얹은 구성 기준)`
  );
  push();
  push('| 읽기 | daily-crash | swing-low-break | 기준 |');
  push('|---|---:|---:|---|');
  push(
    `| (a) 규칙 **단독** 일평균 | ${n2(dcDaily, 3)}건/일 | ${n2(slbDaily, 3)}건/일 | ${
      PH0.gateMaxDailyNewAlerts
    }건/일 초과? → ${dcDaily > PH0.gateMaxDailyNewAlerts ? 'YES' : 'NO'} / ${
      slbDaily > PH0.gateMaxDailyNewAlerts ? 'YES' : 'NO'
    } |`
  );
  push(
    `| (b) **C′-min에 얹은** 구성 일평균 | ${n2(eDc?.dailyAlerts ?? NaN, 3)}건/일 | ${n2(
      eSlb?.dailyAlerts ?? NaN,
      3
    )}건/일 | 게이트 A ${ox(eDc?.gateA ?? false)} / ${ox(eSlb?.gateA ?? false)} |`
  );
  push();
  push(
    `> 코디네이터가 역산한 값(~2.2 · ~2.3건/일)은 실측 ${n2(dcDaily, 3)} · ${n2(
      slbDaily,
      3
    )}건/일과 사실상 일치한다. 다만 그 값은 **3건/일 자체를 넘지는 않는다** — 예산을 넘기는 것은 C′-min(${n2(
      minDaily,
      3
    )}건/일)에 얹었을 때다. 두 읽기의 판정이 갈리므로 위에 둘 다 적었다.`
  );
  push();

  // 예측 3
  const tailOf = (key: string): number[] => {
    const e = comp.evals.find((x) => x.key === key);
    return e ? e.cells.map((c) => c.tailImprove) : [];
  };
  const tStop = tailOf('CMIN_STOP');
  const tDc = tailOf('CMIN_DC');
  const tSlb = tailOf('CMIN_SLB');
  const winCells =
    tStop.length === 4 && tDc.length === 4 && tSlb.length === 4
      ? tStop.filter((v, i) => v > tDc[i] && v > tSlb[i]).length
      : 0;
  const p3Hit = winCells === 4;
  push(
    `**예측 ③** "stop-loss가 꼬리 방어에 가장 직접적일 것이다" (근거: daily-crash는 급락일이 있어야 발동하므로 "하루 −5% 없이 슬금슬금 −50%"를 놓치지만, stop-loss는 매수가 대비이므로 기계적으로 포착) → **${
      p3Hit ? '맞음' : '틀림'
    }** (4셀 중 ${winCells}셀에서 stop-loss 단독 추가가 두 대안보다 꼬리를 더 개선)`
  );
  push();
  push('| 코호트/표본 | C′-min | +daily-crash | +swing-low-break | +stop-loss | 최고 |');
  push('|---|---:|---:|---:|---:|---|');
  const eMin = comp.evals.find((e) => e.key === 'CMIN');
  for (let i = 0; i < (eMin?.cells.length ?? 0); i++) {
    const base = eMin!.cells[i];
    const row: Array<[string, number]> = [
      ['+daily-crash', tDc[i] ?? NaN],
      ['+swing-low-break', tSlb[i] ?? NaN],
      ['+stop-loss', tStop[i] ?? NaN],
    ];
    const best = row.reduce((a, b) => (b[1] > a[1] ? b : a));
    push(
      `| ${base.cohort}/${base.period} | ${pc(base.tailImprove)}p | ${pc(
        tDc[i] ?? NaN
      )}p | ${pc(tSlb[i] ?? NaN)}p | ${pc(tStop[i] ?? NaN)}p | ${best[0]} |`
    );
  }
  push();
  push('> 값은 전부 "하위10%가 HOLD 대비 몇 %p 개선됐는가"다(클수록 꼬리 방어가 강하다).');
  push();

  // ── 0-3-6. 결론 ──
  push('### 0-3-6. 이 절의 결론');
  push();
  if (passList.length > 0) {
    push(
      `**네 게이트를 전부 통과하는 구성이 존재한다: ${passList
        .map((e) => `\`${e.key}\`(${e.label})`)
        .join(' · ')}.** 이것이 권고 후보다. 다만 ①이 절은 여러 구성을 같은 게이트에 시험한 **탐색**이며(다중비교) ②기준 자체가 §0-2에서 사후 수정된 것이고 ③잠금표본(2023-2025)은 열지 않았다. 따라서 채택은 잠정이며, 적용 전에 잠금표본 확인을 권한다.`
    );
  } else {
    push(
      '**네 게이트를 전부 통과하는 구성은 없다.** 꼬리 방어 규칙 3종(daily-crash · swing-low-break · stop-loss)을 하나씩·조합으로 되살려도, 그리고 하루 3건 상한을 걸어도, §0-2에서 드러난 교환관계는 깨지지 않았다. 위 순위표의 1위가 가장 근접한 구성이며 미달 폭은 그 행에 있다.'
    );
  }
  push();
  push('한계(지적당하기 전에 명시):');
  push();
  push(
    `1. **다중비교다.** 이 절은 ${comp.evals.length}개 구성을 같은 게이트에 시험했다. 통과 구성이 나왔다면 그것은 우연일 확률이 단일 사전등록 검증보다 높다. 통과 구성이 없다면 이 한계는 결론을 약화시키지 않는다(더 많이 시험하고도 못 찾았다는 뜻이므로).`
  );
  push(
    '2. **기준이 사후 수정된 것이다.** B′ 계열은 §0-2에서 1차 결과를 본 뒤 만든 기준이다. 이 절은 그 기준을 **바꾸지 않고 그대로 적용**했지만, 기준 자체의 사후성은 남아 있다.'
  );
  push(
    '3. **잠금표본(2023-2025)은 이 절에서도 열지 않았다.** 개발·검증 표본까지의 잠정 결과다.'
  );
  push(
    `4. **상한 적용판의 게이트 A는 구조적 통과다.** 하루 ${PH0.capDailyBudget}건을 넘을 수 없게 만든 정책이므로 A는 자동으로 만족한다. 상한판이 의미를 갖는 곳은 B 계열뿐이다.`
  );
  push(
    '5. §0-2-8의 한계(그룹 수 G의 연구자 선택 · C_CAPPED의 완벽 실행 가정 · 무작위 포트폴리오와 실보유의 차이)는 이 절에도 그대로 적용된다.'
  );
  push();
  push('계획과 다르게 판단한 지점:');
  push();
  push(
    '1. **포지션 채택(usable) 판정을 원 3구성 + HOLD로 고정**했다. 절충안까지 판정에 넣으면 부실 시가에 매도가 걸린 포지션이 추가로 빠져 §0·§0-2의 기존 수치가 재현되지 않는다. 회귀 가능성을 우선했고, 절충안에서만 무효가 된 포지션 수를 0-3-4에 공개한다.'
  );
  push(
    `2. **상한 적용판을 만들 구성을 실측으로 결정**했다(사전에 목록을 정하지 않음). 기준은 지시 그대로 "게이트 A 초과"이며, 이번 실행에서는 ${cappedIds.length}개 구성이 해당됐다.`
  );
  push(
    '3. **예측 ②의 판정을 두 갈래로 나눠 적었다.** 지시문의 "각각 단독으로도 예산을 초과"는 (a) 규칙 단독 발동률과 (b) C′-min에 얹은 구성의 발동률 두 가지로 읽힌다. 실측에서 두 읽기의 판정이 갈리므로 한쪽만 고르지 않고 둘 다 실었다.'
  );
  push(
    '4. **순위 기준을 명시적으로 정의**했다(①미통과 게이트 수 → ②B 계열 미달 폭 합계 → ③A 미달 폭). 지시문은 "가장 근접한 구성 순위"만 요구했고 그 조작적 정의는 없었다. 건/일과 %p는 단위가 달라 하나로 합산하지 않고 사전순위로 처리했다.'
  );
  push();
  return L.join('\n');
}

function buildMarkdown(
  freq: FreqSummary[],
  cohorts: CohortResult[],
  gates: GateResult[],
  overallPass: boolean,
  bp: { cells: BPrimeCell[]; gates: GateResult[]; overallPass: boolean },
  comp: { evals: CompromiseEval[]; ranked: CompromiseEval[]; anyPass: CompromiseEval[] },
  cappedIds: readonly Phase0CompromiseId[],
  meta: {
    universe: number;
    manifestPrelock: string;
    candidatesVal: number;
    candidatesDev: number;
    daysVal: number;
    daysDev: number;
    elapsedSec: number;
  }
): string {
  const L: string[] = [];
  const push = (s = ''): void => {
    L.push(s);
  };

  push('# Phase 0 — 신규 알림 구성 선검증 (C / C′-min / C′-mid)');
  push();
  push('- 작성일: 2026-07-26');
  push('- 사전등록: `docs/PLAN_앱적용_신호정비_260726.md` §2 **Phase 0**(신규 구성 선검증, 하드 게이트)');
  push(
    '- **사후 수정**: 같은 계획서 **Phase 0-B**(게이트 B 재설계, 2026-07-26 사용자 승인) — 기준선을 C → HOLD로 바꾸고 적대 조건 `C_CAPPED`를 추가한 재판정을 **§0-2**에 실었다. §0의 원 판정은 그대로 병기한다.'
  );
  push(
    `- **절충안 탐색(§0-3)**: B′-3 탈락 이후, C′-min에 꼬리 방어 규칙(\`${TAIL_DEFENSE_RULES.join(
      '` · `'
    )}\`)을 되살린 ${COMPROMISE_CONFIG_IDS.length}개 구성 + 게이트 A 초과분의 상한 적용판을 **같은 네 게이트**로 판정했다. 결론: 전부 통과 구성 ${
      comp.anyPass.length > 0 ? `**있음** (${comp.anyPass.map((e) => e.label).join(' · ')})` : '**없음**'
    }.`
  );
  push('- 산출 JSON: `scripts/backtest/lectureSignals/output/d8_phase0_config.json`');
  push('- 실행 코드: `scripts/backtest/lectureSignals/phase0Core.ts`(순수 로직) · `runPhase0.ts`(드라이버)');
  push('- 골든 테스트: `tests/lecturePhase0Parity.ts` (package.json 미등록 — `npx --yes tsx tests/lecturePhase0Parity.ts`)');
  push('- **앱 코드는 한 줄도 수정하지 않았다.** 기존 백테스트 파일도 수정 없이 import만 했다.');
  push(
    `- 데이터 게이트(prelock): \`${meta.manifestPrelock}\` · 투자가능 유니버스 ${meta.universe}종목 · **잠금표본(2023-2025) 미개봉**`
  );
  push(`- 실행 시간: ${n2(meta.elapsedSec, 1)}초`);
  push();
  push('---');
  push();

  // 0. 결론
  push('## 0. 판정 (1차 기준 — 원 게이트 A·B)');
  push();
  push(`**종합: ${overallPass ? '통과' : '미통과'}**`);
  push();
  push(
    `> **이 절은 1차(원) 기준 판정이며 사후에 수정되지 않았다.** 2026-07-26 사용자 승인으로 게이트 B를 재설계했고, 그 결과는 **§0-2**에 별도로 싣는다(게이트 B′ 종합 ${
      bp.overallPass ? '통과' : '미통과'
    }). 두 판정을 반드시 함께 읽어라.`
  );
  push();
  push('| 통과 기준(계획서 사전 고정) | 결과 | 실측 |');
  push('|---|---|---|');
  for (const g of gates) {
    push(`| ${g.gate} | ${g.pass ? '**통과**' : '**미통과**'} | ${g.detail} |`);
  }
  push();
  push(
    '> 미통과 항목이 있어도 이 문서는 **구성 조정을 하지 않는다**(계획서 §2: 조정은 코디네이터·사용자 몫). 결과만 그대로 싣는다.'
  );
  push();
  push('(참고) 개발표본 기준 같은 비교:');
  push();
  for (const c of cohorts.filter((x) => x.period === 'DEV')) {
    const cC = c.configs.find((x) => x.config === 'C');
    const cMin = c.configs.find((x) => x.config === 'CMIN');
    const cMid = c.configs.find((x) => x.config === 'CMID');
    if (!cC || !cMin || !cMid) continue;
    push(
      `- ${c.cohort}: C 회피 ${pc(cC.p10Avoidance)}p · C′-min ${pc(cMin.p10Avoidance)}p(악화 ${pc(
        cC.p10Avoidance - cMin.p10Avoidance
      )}p) · C′-mid ${pc(cMid.p10Avoidance)}p(악화 ${pc(cC.p10Avoidance - cMid.p10Avoidance)}p)`
    );
  }
  push();

  // 0-1. 판정의 해석
  push('### 0-1. 두 기준이 서로 반대 방향을 가리킨다 — 읽는 법');
  push();
  push(
    '기준 A(알림 예산)와 기준 B(손실 회피)는 **같은 원인에서 반대 결론**이 나온다. C는 보유손익 의존 규칙(`stop-loss`·`trend-break`·`long-decline`) 때문에 거의 매일 발동하고(P4 §4의 91% 포화), 그래서 (a) 알림이 하루 13건 넘게 쏟아지고 (b) 동시에 **손실을 아주 빨리 끊는다**. C′-min은 그 규칙들을 빼서 (a)는 해결하지만 (b)도 같이 잃는다.'
  );
  push();
  push('아래는 판정 기준에 포함되지 않았지만 이 상충을 이해하는 데 필요한 실측치다(검증표본).');
  push();
  push('| 코호트 | 지표 | HOLD | C | C′-min | C′-mid |');
  push('|---|---|---:|---:|---:|---:|');
  for (const c of cohorts.filter((x) => x.period === 'VALIDATION')) {
    const get = (id: string): ConfigPerf | undefined => c.configs.find((x) => x.config === id);
    const cC = get('C');
    const cMin = get('CMIN');
    const cMid = get('CMID');
    if (!cC || !cMin || !cMid) continue;
    push(
      `| ${c.cohort} | 수익률 **평균** | ${pc(c.hold.meanReturn)} | ${pc(
        cC.agg.meanReturn
      )} | ${pc(cMin.agg.meanReturn)} | ${pc(cMid.agg.meanReturn)} |`
    );
    push(
      `| ${c.cohort} | 수익률 중앙값 | ${pc(c.hold.medianReturn)} | ${pc(
        cC.agg.medianReturn
      )} | ${pc(cMin.agg.medianReturn)} | ${pc(cMid.agg.medianReturn)} |`
    );
    push(
      `| ${c.cohort} | 수익률 **하위10%** | ${pc(c.hold.p10Return)} | ${pc(
        cC.agg.p10Return
      )} | ${pc(cMin.agg.p10Return)} | ${pc(cMid.agg.p10Return)} |`
    );
    push(
      `| ${c.cohort} | 매도 횟수 평균 | 0.00 | ${n2(cC.agg.meanSells)} | ${n2(
        cMin.agg.meanSells
      )} | ${n2(cMid.agg.meanSells)} |`
    );
    push(
      `| ${c.cohort} | 누적 거래비용(원금 대비) | ${pc(c.hold.meanCostPaid, 3)} | ${pc(
        cC.agg.meanCostPaid,
        3
      )} | ${pc(cMin.agg.meanCostPaid, 3)} | ${pc(cMid.agg.meanCostPaid, 3)} |`
    );
    push(
      `| ${c.cohort} | 트리거 후 63일 성과(중앙값) | — | ${pc(
        cC.postTriggerReturn63Median
      )} | ${pc(cMin.postTriggerReturn63Median)} | ${pc(cMid.postTriggerReturn63Median)} |`
    );
  }
  push();
  push('읽는 순서:');
  push();
  push(
    '1. **기준 B 미통과는 사실이다.** C′-min은 C가 만들던 하위10% 손실 회피의 4분의 1~3분의 1만 남긴다. "손실 회피 성능을 잃지 않는다"는 계획서의 전제는 **기각됐다**.'
  );
  push(
    '2. 다만 그 손실 회피는 공짜가 아니었다. C는 252거래일 창에서 평균 10회 넘게 매도·재매수하며(위 표의 거래비용 행) 상방까지 잘라낸다 — 수익률 **평균**이 C′-min보다 약 8%p 낮다. 즉 C의 25%p 회피는 "잘 골라서 팔았다"가 아니라 **"거의 항상 팔고 있었다"**에 가깝다.'
  );
  push(
    '3. **트리거 한 건의 품질은 세 구성이 거의 같다**(트리거 후 63일 성과 중앙값이 −8%대로 나란함). 차이는 신호의 정확도가 아니라 **발동 횟수**에서 나온다. 손실 회피를 원하면 신호를 더 자주 울려야 하고, 알림 예산을 지키려면 덜 울려야 한다 — 이 표는 그 교환비를 보여줄 뿐 어느 쪽이 옳은지는 말하지 않는다.'
  );
  push(
    '4. 이 문서는 사전 고정된 두 기준으로만 판정한다. 기준을 바꾸거나 구성을 조정하는 판단은 하지 않는다.'
  );
  push();

  // 0-2. 게이트 B 재설계(사후 수정)
  push(bPrimeSection(freq, cohorts, bp, overallPass));

  // 0-3. 절충안 탐색
  push(compromiseSection(freq, cohorts, comp, cappedIds));

  // 1. 구성 정의
  push('## 1. 구성 정의 (계획서 §2 표 그대로 — 사전 고정)');
  push();
  push('| 구성 | 규칙 수 | ON 목록 |');
  push('|---|---:|---|');
  for (const cfg of PHASE0_CONFIG_IDS) {
    push(
      `| ${PHASE0_CONFIG_LABEL[cfg]} | ${CONFIG_RULE_SETS[cfg].length} | ${CONFIG_RULE_SETS[cfg]
        .map((r) => `\`${r}\``)
        .join(' · ')} |`
    );
  }
  push();
  push(
    '- 급성 6종 판정은 `events.ts`의 `testSignalAt`(1차 배치 검증 코드) 그대로, `climax-top`·`distribution-high`·`weinstein-150-break`·`ma120-break`·`swing-low-break`는 P4의 앱 규칙 재현(`appRules.ts`) 그대로 재사용한다. **새로 구현한 판정 로직은 없다.**'
  );
  push(
    '- S5는 앱 런타임이 실제로 쓰는 프록시 변형(`S5_APP_PROXY` = 조정종가×조정거래량)을 사용한다.'
  );
  push();

  // 2. 알림 정의
  push('## 2. 알림 정의 2종 — 무엇을 세는가');
  push();
  push('| 정의 | 계산 | 의미 |');
  push('|---|---|---|');
  push(
    '| **(1) 신규 전이** | (종목,규칙) 쌍이 **어제 미충족 → 오늘 충족**으로 바뀐 건수 | 사용자가 체감하는 "오늘 새로 뜬 경고". **주 판정 지표** |'
  );
  push(
    '| (2) 상태 지속 | 그날 충족 상태인 (종목,규칙) 쌍 수 | 조건이 계속 참인 동안 매일 세는 값. 참고용 |'
  );
  push();
  push(
    '> **P4의 "91%"는 (2) 계열이다.** P4 §4의 "발동일 비율"은 그날 조건이 참인 포지션-일의 비율이었고, 하루에 몇 건이 새로 뜨는지를 센 값이 아니다. 이 문서의 주 지표 (1)과 직접 비교하면 안 된다.'
  );
  push();

  // 3. 측정 설계
  push('## 3. 측정 설계 — 무작위 포트폴리오');
  push();
  push('| 항목 | 정의 |');
  push('|---|---|');
  push(
    `| 유니버스 | 투자가능 KR(PIT 월말 유니버스) ∩ 측정창 시작 직전일 기준 20일 평균 거래대금 ≥ ${(
      CONST.liquidityMainMinAmountKRW / 100_000_000
    ).toFixed(0)}억원 |`
  );
  push(`| 포트폴리오 | ${PH0.sizes.join('/')}종목 × 각 ${PH0.sets}세트(종목 중복 없음) |`);
  push(
    `| 매수일 | 종목별로 측정창 시작 직전 ${PH0.purchaseLookbackDays}거래일에서 균등 무작위 추출(체결가 = 그날 시가). 측정창 시작 시점에 이미 보유 중인 상태를 만든다 |`
  );
  push(
    `| 워밍업 | 매수일 이전 ${PH0.minWarmupBars}봉 이상 확보된 종목만 후보(클라이맥스 252일 신고가 + MA60 장기추세 120봉 요건) |`
  );
  push('| 매도 | **없음** — 이 축은 알림 빈도 측정이지 정책 시뮬레이션이 아니다(포트폴리오 고정) |');
  push(`| 시드 | mulberry32, ${PH0.seedBase} 계열(기간·규모별 고정) |`);
  push(
    `| 측정창 | 검증표본 ${PH0.windows.VALIDATION.from}~${PH0.windows.VALIDATION.to}(${meta.daysVal}거래일, 주분석) · 개발표본 ${PH0.windows.DEV.from}~${PH0.windows.DEV.to}(${meta.daysDev}거래일, 참고) |`
  );
  push(
    `| 후보 종목 수 | 검증 ${meta.candidatesVal}종목 · 개발 ${meta.candidatesDev}종목 |`
  );
  push();
  push(
    `> **후보 풀이 좁다는 점**: 투자가능 유니버스 ${meta.universe}종목 중 검증표본 측정창의 후보는 ${meta.candidatesVal}종목뿐이다. 거래대금 ${(
      CONST.liquidityMainMinAmountKRW / 100_000_000
    ).toFixed(0)}억원 기준(1차 배치 주분석과 동일)과 워밍업 요건을 함께 걸었기 때문이며, 결과적으로 **유동성 상위 종목에 편중**된다. 실제 개인 포트폴리오가 이보다 소형·저유동 종목을 담고 있다면 급성 신호(거래량 배수 기반)의 발동은 더 잦을 수 있다.`
  );
  push();
  push(
    `> **계획과 다르게 판단한 지점**: 개발표본 측정창을 계획서의 "2010-2019"가 아니라 **${PH0.windows.DEV.from}~${PH0.windows.DEV.to}** 로 잡았다. 원자료가 2010-01-04에 시작하는데 워밍업 ${PH0.minWarmupBars}봉 + 매수일 추출 ${PH0.purchaseLookbackDays}봉을 확보해야 지표가 null이 아니게 되고, 그러지 않으면 초반 2년의 알림이 기계적으로 과소집계된다. 검증표본(주분석)은 계획서 그대로다.`
  );
  push();

  // 4. 결과 — 빈도
  push('## 4. 알림 빈도 (주 판정)');
  push();
  push('### 4-1. 검증표본 2020-2022 (주분석)');
  push();
  push(freqTable(freq, 'VALIDATION'));
  push();
  push(
    '- "일평균(신규)"이 통과 기준의 대상이다. "중앙값/ p90 / 최대"는 (세트,일) 전체를 풀링한 하루 건수 분포다.'
  );
  push('- "상태 지속 일평균"은 참고 지표 (2)다 — 같은 포트폴리오에서 그날 조건이 참인 (종목,규칙) 쌍 수.');
  push();
  for (const size of PH0.sizes) {
    const f = freq.find((x) => x.period === 'VALIDATION' && x.size === size && x.config === 'CMIN');
    if (!f) continue;
    push(
      `- ${size}종목 평균 활성 보유 ${n2(f.meanActiveHoldings, 1)}건/일(상장폐지·거래정지로 데이터가 끊긴 보유는 그날 제외).`
    );
  }
  push();
  push('### 4-2. 스파이크 (급락장 몰림)');
  push();
  push('| 구성 | 규모 | 세트평균 최대일 | 그날 평균 건수 | 단일 세트 최대 | 그날 |');
  push('|---|---:|---|---:|---:|---|');
  for (const cfg of PHASE0_CONFIG_IDS) {
    for (const size of PH0.sizes) {
      const f = freq.find((x) => x.period === 'VALIDATION' && x.size === size && x.config === cfg);
      if (!f) continue;
      push(
        `| ${PHASE0_CONFIG_LABEL[cfg]} | ${size}종목 | ${f.spikeDate} | ${n2(
          f.spikeMeanCount,
          2
        )} | ${f.spikeSingleMax} | ${f.spikeSingleDate} |`
      );
    }
  }
  push();
  push('### 4-3. 규칙별 알림 기여 (60종목, 검증표본, 신규 전이 누계)');
  push();
  for (const cfg of PHASE0_CONFIG_IDS) {
    const f = freq.find((x) => x.period === 'VALIDATION' && x.size === 60 && x.config === cfg);
    if (!f) continue;
    push(`**${PHASE0_CONFIG_LABEL[cfg]}**`);
    push();
    push('| 규칙 | 전이 건수 | 비중 |');
    push('|---|---:|---:|');
    for (const r of f.ruleContribution) {
      push(`| \`${r.rule}\` | ${r.transitions} | ${pc(r.share)} |`);
    }
    push();
  }
  push('### 4-4. 개발표본 (참고)');
  push();
  push(freqTable(freq, 'DEV'));
  push();

  // 5. 손실 회피
  push('## 5. 손실 회피 성능 (보조 판정)');
  push();
  push('P4와 동일 설계: 매수 익일 시가 체결 · 252거래일 창 · 발동 시 익일 시가 매도 · 20거래일 뒤 같은 종목 재매수 · 비용(매도세+변동 30bps) 반영. 무작위 매수일 코호트는 **P4와 동일 시드**라 포지션 집합이 1:1 같다.');
  push();
  push(
    '> **재현 교차확인**: 이 문서의 C는 P4의 C와 같은 정의·같은 코호트이므로 수치가 P4와 일치해야 한다. RANDOM/VALIDATION에서 P4 보고값 → 이 문서: HOLD 하위10% −50.16% → −50.18% · C 하위10% −24.81% → −24.84% · C 중앙값 −10.08% → −10.04% · C MDD 중앙값 16.48% → 16.47% · 매도 10.42회 → 10.41회. 모두 0.05%p 이내로 일치한다. 미세한 차이와 포지션 수 2건 감소(1190 → 1188)는 같은 원인이다 — C′ 구성에서 시가가 0인 바에 매도가 걸려 시뮬레이션이 무효가 된 포지션을 **네 정책 모두에서** 일괄 제외했다(정책 간 비교 가능성 유지).'
  );
  push();
  for (const c of cohorts) {
    push(`### 5-${cohorts.indexOf(c) + 1}. ${c.cohort} · ${c.period} (n=${c.nPositions})`);
    push();
    push('| 정책 | 수익률 중앙값 | 수익률 평균 | **하위10%** | 하위10% 손실회피(vs HOLD) | MDD 중앙값 | 매도 평균 | 누적 거래비용 |');
    push('|---|---:|---:|---:|---:|---:|---:|---:|');
    push(
      `| HOLD | ${pc(c.hold.medianReturn)} | ${pc(c.hold.meanReturn)} | ${pc(
        c.hold.p10Return
      )} | — | ${pc(c.hold.medianMdd)} | 0.00 | ${pc(c.hold.meanCostPaid, 3)} |`
    );
    for (const cf of baseConfigsOf(c)) {
      push(
        `| ${PHASE0_CONFIG_LABEL[cf.config as Phase0ConfigId]} | ${pc(
          cf.agg.medianReturn
        )} | ${pc(cf.agg.meanReturn)} | ${pc(cf.agg.p10Return)} | **${pc(
          cf.p10Avoidance
        )}** | ${pc(cf.agg.medianMdd)} | ${n2(cf.agg.meanSells)} | ${pc(
          cf.agg.meanCostPaid,
          3
        )} |`
      );
    }
    for (const cap of c.capped) {
      push(
        `| ${CAPPED_CONFIG_LABEL}·상한${cap.dailyBudget} | ${pc(cap.agg.medianReturn)} | ${pc(
          cap.agg.meanReturn
        )} | ${pc(cap.agg.p10Return)} | **${pc(cap.p10Avoidance)}** | ${pc(
          cap.agg.medianMdd
        )} | ${n2(cap.agg.meanSells)} | ${pc(cap.agg.meanCostPaid, 3)} |`
      );
    }
    push();
    push('| 구성 | 트리거 발생률 | 첫 트리거까지(중앙값, 거래일) | 트리거 후 63일 성과(중앙값) | 오탐율 +20일 | 오탐율 +63일 |');
    push('|---|---:|---:|---:|---:|---:|');
    for (const cf of baseConfigsOf(c)) {
      push(
        `| ${PHASE0_CONFIG_LABEL[cf.config as Phase0ConfigId]} | ${pc(cf.triggerRate)} | ${n2(
          cf.medianDaysToFirstTrigger,
          1
        )} | ${pc(cf.postTriggerReturn63Median)} | ${pc(cf.falseSell.h20?.rate ?? NaN)} (n=${
          cf.falseSell.h20?.n ?? 0
        }) | ${pc(cf.falseSell.h63?.rate ?? NaN)} (n=${cf.falseSell.h63?.n ?? 0}) |`
      );
    }
    push();
  }
  push(
    '- "트리거 후 63일 성과"는 **매도 체결가 대비 63거래일 뒤 종가**의 수익률 중앙값이다. 음수면 팔고 나서 더 떨어졌다는 뜻(= 매도가 옳았음).'
  );
  push('- "오탐율"은 매도 후 그 시점 가격이 매도가보다 높은 비율이다(시장초과 아님).');
  push();

  // 6. 해석 주의
  push('## 6. 해석 주의');
  push();
  push(
    '1. **무작위 포트폴리오는 실보유와 다르다.** 사용자의 실제 60종목은 손실 종목에 편중돼 있고(60종목 손실), 손실 편중 포트폴리오에서는 `stop-loss`·`trend-break`·`long-decline` 계열이 훨씬 자주 켜진다. 즉 **C의 실측 알림 수는 여기 값보다 많을 개연성이 높다.** 반대로 C′-min은 보유손익에 의존하는 규칙이 하나도 없어(급성 6종·climax·distribution 전부 보유가 무관) 이 편중의 영향을 거의 받지 않는다.'
  );
  push(
    '2. 실보유 스냅샷은 Drive 개인 데이터라 리서치 트리에서 쓰지 않았다(계획서 §2 명시).'
  );
  push(
    '3. 알림 정의 (1)은 "어제 미충족 → 오늘 충족"이다. 앱의 실제 팝업 억제(중복 알림 쿨다운 등)는 이 축과 별개이며 여기서 모델링하지 않았다 — 즉 여기 수치는 앱 알림 수의 **상한**에 가깝다.'
  );
  push(
    '4. 매도를 시뮬레이션하지 않으므로(§3) 실제로는 매도된 종목이 계속 보유된 것처럼 세어진다. 이 역시 알림 수를 **과대**하게 만드는 방향이다.'
  );
  push(
    '5. 조정가(`adj_*`) 기준이다. 앱 런타임은 무조정 시세일 가능성이 있어 분할 경계일 오발화가 앱에 더 있을 수 있다(P4 §2-1과 동일 한계).'
  );
  push(
    '6. **잠금표본(2023-2025)은 열지 않았다.** 이 결과는 개발·검증 표본까지의 잠정 판정이다.'
  );
  push(
    '7. 손실 회피 비교는 "같은 포지션에 어떤 매도 구성을 얹느냐"의 비교다. 진입 규칙·기회비용은 범위 밖이다(P4 §6-1과 동일).'
  );
  push(
    '8. 알림 빈도의 후보 풀은 거래대금 하한 때문에 **유동성 상위 종목에 편중**돼 있다(§3 주석). 저유동 종목 비중이 큰 실보유에서는 거래량 배수 기반 급성 신호가 더 자주 발동할 수 있다.'
  );
  push(
    '9. 손실 회피 축에서 C가 재진입을 20거래일 뒤로 강제받는 설계는 P4에서 물려받은 것이다. 매도 빈도가 훨씬 낮은 C′ 구성에는 이 제약이 거의 걸리지 않으므로, 두 구성은 "같은 재진입 규칙" 아래 있지만 실효 제약의 강도는 다르다.'
  );
  push();

  return L.join('\n');
}

// ===========================================================================
// main
// ===========================================================================

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log('Phase 0 — 신규 알림 구성 선검증 (C / C′-min / C′-mid)\n');

  console.log('[1/5] 데이터 로드...');
  const ds = await loadLectureDataset();
  console.log(
    `  유니버스 ${ds.investableUnion.size}종목 · 바 ${ds.bars.size}종목 · prelock=${ds.manifestPrelock}`
  );

  console.log('[2/5] 포트폴리오 표본 구성...');
  const plans = {
    VALIDATION: buildPeriodPlan(ds, 'VALIDATION'),
    DEV: buildPeriodPlan(ds, 'DEV'),
  } as Record<PeriodKey, PeriodPlan>;
  for (const k of PERIOD_KEYS) {
    console.log(
      `  ${k}: 후보 ${plans[k].candidates.length}종목 · 거래일 ${plans[k].calendar.length}일 · 세트 ${PH0.sets} × [${PH0.sizes.join(', ')}]종목`
    );
  }

  console.log('[3/5] 알림 빈도 집계...');
  const accs = runFrequency(ds, plans);
  const freq: FreqSummary[] = [];
  for (const k of PERIOD_KEYS) {
    for (const size of PH0.sizes) {
      for (const cfg of PHASE0_ALL_CONFIG_IDS) {
        freq.push(summarizeFreq(plans[k], accs[k], size, cfg));
      }
    }
  }
  for (const cfg of PHASE0_ALL_CONFIG_IDS) {
    const f = freq.find((x) => x.period === 'VALIDATION' && x.size === 60 && x.config === cfg);
    if (f) {
      console.log(
        `  [검증·60종목] ${ALL_CONFIG_LABEL[cfg]}: 신규 ${f.newAlerts.mean.toFixed(
          3
        )}건/일 (중앙 ${f.newAlerts.median.toFixed(1)} · p90 ${f.newAlerts.p90.toFixed(
          1
        )} · 최대 ${f.newAlerts.max}) · 상태 ${f.stateAlerts.mean.toFixed(2)}건/일`
      );
    }
  }

  // Phase 0-C: 게이트 A(≤3건/일)를 초과한 절충안은 "하루 3건 상한" 적용판도 함께 산출한다.
  const cappedCompromiseIds: Phase0CompromiseId[] = COMPROMISE_CONFIG_IDS.filter((id) => {
    const f = freq.find((x) => x.period === 'VALIDATION' && x.size === 60 && x.config === id);
    return !!f && f.newAlerts.mean > PH0.gateMaxDailyNewAlerts;
  });
  console.log(
    `  게이트 A 초과 절충안(상한${PH0.capDailyBudget} 적용판 산출 대상): ${
      cappedCompromiseIds.length > 0 ? cappedCompromiseIds.join(', ') : '없음'
    }`
  );

  console.log('[4/5] 손실 회피 코호트...');
  const ranks = buildRsRanks(ds, VALIDATION_PERIOD.to);
  console.log(`  RS 랭킹일 ${ranks.daysRanked}일 · 평균 적격 ${ranks.avgEligible.toFixed(1)}종목`);
  const cohortDefs: Cohort[] = [];
  for (const period of [DEV_PERIOD, VALIDATION_PERIOD]) {
    const positions: Phase0Position[] = [];
    for (const [code, bars] of ds.bars.entries()) {
      const r = ranks.rankByCode.get(code);
      if (!r) continue;
      const { entries } = detectRsEntries(bars, r);
      if (entries.length === 0) continue;
      for (const e of entries) {
        if (e.date < period.from || e.date > period.to) continue;
        const p = makeWindow(bars, e.bar, period.to);
        if (p) positions.push(p);
      }
    }
    cohortDefs.push({ name: 'RS90_ENTRY', period: period.name, positions });
    console.log(`  RS90_ENTRY/${period.name}: 포지션 ${positions.length}건`);
  }
  const codeList = [...ds.bars.keys()].sort();
  for (const period of [DEV_PERIOD, VALIDATION_PERIOD]) {
    const seed = period.name === 'DEV' ? PH0.seedRandomCohortDev : PH0.seedRandomCohortVal;
    const rng = mulberry32(seed);
    const seen = new Set<string>();
    const positions: Phase0Position[] = [];
    let attempts = 0;
    while (positions.length < PH0.randomCohortSize && attempts < PH0.randomMaxAttempts) {
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
    cohortDefs.push({ name: 'RANDOM', period: period.name, positions });
    console.log(`  RANDOM/${period.name}: 포지션 ${positions.length}건(시도 ${attempts})`);
  }

  const cohorts: CohortResult[] = [];
  for (const c of cohortDefs) {
    console.log(`  → ${c.name}/${c.period} (${c.positions.length} 포지션)`);
    cohorts.push(runCohort(ds, c, cappedCompromiseIds));
  }

  console.log('[5/5] 판정 · 산출물 기록...');
  const { gates, overallPass } = deriveGates(freq, cohorts);
  for (const g of gates) console.log(`  ${g.pass ? 'PASS' : 'FAIL'} — ${g.gate} :: ${g.detail}`);
  const bp = deriveGatesBPrime(cohorts);
  console.log('  --- 게이트 B′ (Phase 0-B, 사후 수정) ---');
  for (const g of bp.gates) console.log(`  ${g.pass ? 'PASS' : 'FAIL'} — ${g.gate}\n      ${g.detail}`);

  const comp = deriveCompromiseEvals(freq, cohorts, cappedCompromiseIds);
  console.log('  --- Phase 0-C 절충안 탐색 (같은 4게이트) ---');
  for (const e of comp.evals) {
    console.log(
      `  ${e.allPass ? 'PASS' : 'FAIL'} — ${e.label}: A=${e.gateA ? 'O' : 'X'}(${e.dailyAlerts.toFixed(
        3
      )}건/일) B1=${e.gateB1 ? 'O' : 'X'} B2=${e.gateB2 ? 'O' : 'X'} B3=${e.gateB3 ? 'O' : 'X'}`
    );
  }
  console.log(
    `  → 전부 통과 구성: ${
      comp.anyPass.length > 0 ? comp.anyPass.map((e) => e.label).join(', ') : '없음'
    } · 최근접 = ${comp.ranked[0]?.label ?? 'NA'}`
  );

  const elapsedSec = (Date.now() - t0) / 1000;
  const payload = {
    generatedAt: new Date().toISOString(),
    plan: 'docs/PLAN_앱적용_신호정비_260726.md §2 Phase 0',
    config: PH0,
    configRuleSets: CONFIG_RULE_SETS,
    alertIds: PHASE0_ALERT_IDS,
    appRuleIds: APP_SELL_RULE_IDS,
    acuteSix: ACUTE_SIX,
    dataGatePrelock: ds.manifestPrelock,
    universe: ds.investableUnion.size,
    candidates: {
      VALIDATION: plans.VALIDATION.candidates.length,
      DEV: plans.DEV.candidates.length,
    },
    tradingDays: {
      VALIDATION: plans.VALIDATION.calendar.length,
      DEV: plans.DEV.calendar.length,
    },
    alertSeverity: ALERT_SEVERITY,
    frequency: freq,
    lossAvoidance: cohorts,
    /** 1차 실행의 원 게이트 A·B — 사후 수정 없이 그대로 보존한다. */
    gates,
    overallPass,
    /** Phase 0-B 사후 수정: 기준선 HOLD + 적대 조건 C_CAPPED. */
    gatesBPrime: {
      note:
        '사후 수정(2026-07-26 사용자 승인). 기준선 = HOLD. B′-3은 C′-min이 탈락 가능한 적대 조건. ' +
        '조작적 정의: B′-1 평균·중앙 수익률 HOLD 대비 악화 ≤ 1%p / B′-2 하위10% HOLD 대비 개선 ≥ 3%p / ' +
        'B′-3 C_CAPPED 대비 평균·하위10% 어느 쪽에서도 열세 ≤ 1%p.',
      cells: bp.cells,
      gates: bp.gates,
      overallPass: bp.overallPass,
    },
    /**
     * Phase 0-C 절충안 탐색. 게이트 정의는 gatesBPrime과 **완전히 동일**하고 판정 대상만 다르다.
     */
    compromiseConfigs: {
      note:
        'C′-min에 꼬리 방어 규칙(daily-crash · swing-low-break · stop-loss)을 되살린 구성 탐색. ' +
        '게이트 A·B′-1·B′-2·B′-3의 정의는 §0-2와 한 글자도 다르지 않다(판정 대상만 다름). ' +
        '포화 3종(dead-cross · trend-break · long-decline)은 탐색 대상에서 제외. ' +
        '게이트 A를 초과한 구성은 하루 3건 상한 적용판(@cap3)도 함께 판정. ' +
        '순위 = ①미통과 게이트 수 → ②B 계열 미달 폭 합계 → ③A 미달 폭.',
      tailDefenseRules: TAIL_DEFENSE_RULES,
      excludedRules: SATURATION_EXCLUDED_RULES,
      ruleSets: COMPROMISE_RULE_SETS,
      addedRules: COMPROMISE_ADDED_RULES,
      cappedVariantIds: cappedCompromiseIds,
      evals: comp.evals,
      ranking: comp.ranked.map((e) => e.key),
      anyPass: comp.anyPass.map((e) => e.key),
      overallAnyPass: comp.anyPass.length > 0,
    },
    elapsedSec,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, 'd8_phase0_config.json'), JSON.stringify(payload, null, 2));

  const md = buildMarkdown(freq, cohorts, gates, overallPass, bp, comp, cappedCompromiseIds, {
    universe: ds.investableUnion.size,
    manifestPrelock: ds.manifestPrelock,
    candidatesVal: plans.VALIDATION.candidates.length,
    candidatesDev: plans.DEV.candidates.length,
    daysVal: plans.VALIDATION.calendar.length,
    daysDev: plans.DEV.calendar.length,
    elapsedSec,
  });
  writeFileSync(path.join(DOCS, 'RESULTS_Phase0_신규알림구성.md'), md);
  console.log(`  JSON: ${path.join(OUT_DIR, 'd8_phase0_config.json')}`);
  console.log(`  MD  : ${path.join(DOCS, 'RESULTS_Phase0_신규알림구성.md')}`);
  console.log(
    `\n완료 (${elapsedSec.toFixed(1)}초) — 원 게이트 종합 ${
      overallPass ? '통과' : '미통과'
    } · 게이트 B′ 종합 ${bp.overallPass ? '통과' : '미통과'} · 절충안 전부통과 ${
      comp.anyPass.length > 0 ? comp.anyPass.map((e) => e.key).join(',') : '없음'
    }`
  );
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
