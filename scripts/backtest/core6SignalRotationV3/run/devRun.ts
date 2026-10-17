// scripts/backtest/core6SignalRotationV3/run/devRun.ts
// 코어 6종 신호 로테이션 V3 — 개발구간 실행기.
// 실행: npx tsx scripts/backtest/core6SignalRotationV3/run/devRun.ts --panel P|P5
// 사전등록: V3 §7·§11·§13·§17-5/6, V2 §7.2·§11.
//
// 구조적 가드: runDevelopment() 는 입력 패널을 가장 먼저 truncatePanel(개발 종료일)로 **물리적으로 자른다**.
// 이후 신호·현금금리·시뮬레이터는 잘린 패널만 받으므로 검증구간(2024-07-01~) 데이터는 어떤 경로로도 닿지 않는다.
// 개발 종료일 인자는 DEV_END_DATE 이하만 허용한다. 검증 실행은 runValidation.ts(선택 잠금 필요)에서만 가능하다.

import { existsSync, writeFileSync } from 'fs';
import path from 'path';
import { simulate } from '../portfolio/simulate';
import type { SimConfig, SimResult } from '../portfolio/simulate';
import { maxDrawdown, mddRelativeReduction } from '../stats/metrics';
import { SIGNAL_RULES } from '../types';
import type { AssetCode, Panel, SignalRuleId, SignalSeries } from '../types';
import {
  CAP_ABSOLUTE,
  CAP_MULTIPLIER,
  COST_ADVERSE,
  COST_BASE,
  DEV_END_DATE,
  INITIAL_CAPITAL,
  MIN_OFFSET_DAYS,
  MIN_ORDER_KRW,
  OFFSETS,
  OUTPUT_DIR,
  PYRAMID_INTERVALS,
  THRESHOLDS,
  argValue,
  calmarDelta,
  cashRateArray,
  computeSignalCache,
  includedAssets,
  isMainModule,
  loadCd91,
  loadPanel,
  median,
  metricsFromEquity,
  panelWeights,
  ruleStartIndex,
  truncatePanel,
} from './common';
import type { CdRow, Metrics, PanelName, PyramidInterval, SignalCache, Thresholds } from './common';

// ── 시뮬레이션 헬퍼(검증/탐색기도 공유) ────────────────────────────────────
export type SimMode = SimConfig['mode'];

export interface SimSetup {
  panel: Panel;
  signals: Partial<Record<AssetCode, SignalSeries>>;
  weights: Record<AssetCode, number>;
  cashRates: number[];
}

export function runSim(
  setup: SimSetup,
  mode: SimMode,
  startIndex: number,
  endIndex: number,
  cost: number,
  interval?: PyramidInterval,
  capMultiplier: number = CAP_MULTIPLIER,
): SimResult {
  const config: SimConfig = {
    mode,
    weights: setup.weights,
    capMultiplier,
    capAbsolute: CAP_ABSOLUTE,
    costOneWay: cost,
    initialCapital: INITIAL_CAPITAL,
    minOrderKRW: MIN_ORDER_KRW,
    startIndex,
    endIndex,
    annualCashRate: setup.cashRates,
    pyramid: interval ? { interval } : undefined,
  };
  return simulate(setup.panel, setup.signals, config);
}

export function simMetrics(res: SimResult): Metrics {
  return metricsFromEquity(res.equity, res.dates, INITIAL_CAPITAL, res.dates[0]);
}

// ── 결과 타입 ───────────────────────────────────────────────────────────────
export interface OffsetResult {
  offset: number;
  startIndex: number;
  startDate: string;
  days: number;
  bh: Metrics;
  cash: Metrics;
  rotate: Metrics & { turnover: number; sells: number; reentries: number; sellAssets: number };
  bhAdverse: Metrics;
  rotateAdverse: Metrics;
  cagrDiff: number;
  mddReduction: number | null;
  calmarImprovement: number;
  mddReductionAdverse: number | null;
}

export interface QuarterContribution {
  quarter: string;
  excessPnl: number;
}

export interface RuleDevSummary {
  rule: SignalRuleId;
  baseStartIndex: number | null;
  baseStartDate: string | null;
  offsets: OffsetResult[];
  excludedOffsets: { offset: number; days: number; reason: string }[];
  sample: { days: number; sells: number; reentries: number; sellAssets: number; ok: boolean; reasons: string[] };
  cagrOkOffsets: number;
  eligible: boolean;
  ineligibleReasons: string[];
  medianMddReduction: number;
  medianCalmarImprovement: number;
  adverseRetention: number;
  medianTurnover: number;
  quarters: QuarterContribution[];
  maxQuarter: { quarter: string; share: number } | null;
  rankUnstable: boolean;
}

export interface PostReentryStats {
  horizon: number;
  campaigns: number;
  observable: number;
  censored: number;
  medianMdd: number;
  lossProbability: number;
  deploymentRate: number;
}

export interface PyramidCandidate {
  rule: SignalRuleId;
  interval: PyramidInterval;
  offsetsRun: number;
  medianMddImprovementVsC: number;
  medianCagrDiffVsC: number;
  medianTurnover: number;
  campaigns: number;
  fills: number;
  minEventsOk: boolean;
  post21: PostReentryStats;
  post63: PostReentryStats;
}

export interface PyramidBaseline {
  rule: SignalRuleId;
  post21: PostReentryStats;
  post63: PostReentryStats;
}

export interface SelectedRule {
  rule: SignalRuleId;
  pyramidInterval: PyramidInterval | null;
  pyramidNote: string;
}

export interface DevResult {
  panel: PanelName;
  devEndDate: string;
  sessions: number;
  status: 'SELECTED' | '판단 보류';
  holdReason: string | null;
  ranking: SignalRuleId[];
  selected: SelectedRule[];
  rules: RuleDevSummary[];
  pyramid: { baselines: PyramidBaseline[]; candidates: PyramidCandidate[] };
  rankUnstableRules: SignalRuleId[];
  notes: string[];
}

export interface DevOptions {
  devEndDate?: string;
  thresholds?: Thresholds;
  offsets?: readonly number[];
  minOffsetDays?: number;
  cd91?: readonly CdRow[];
}

// ── 순수 선정 로직(손계산 골든 대상) ────────────────────────────────────────
export interface RankInput {
  rule: SignalRuleId;
  eligible: boolean;
  medianMddReduction: number;
  medianCalmarImprovement: number;
  adverseRetention: number;
  medianTurnover: number;
}

const EPS = 1e-12;
function cmp(a: number, b: number, descending: boolean): number {
  if (Math.abs(a - b) <= EPS) return 0;
  return descending ? (a > b ? -1 : 1) : a < b ? -1 : 1;
}

/**
 * V2 §7.2 3~4: 적격 후보를 MDD 상대축소율 중앙값 내림차순 → Calmar 개선 중앙값 내림차순 →
 * 불리 비용 MDD 개선 유지 비율 내림차순 → 낮은 회전율 → 규칙 ID 오름차순.
 */
export function rankCandidates(inputs: readonly RankInput[]): SignalRuleId[] {
  return inputs
    .filter(r => r.eligible)
    .slice()
    .sort(
      (a, b) =>
        cmp(a.medianMddReduction, b.medianMddReduction, true) ||
        cmp(a.medianCalmarImprovement, b.medianCalmarImprovement, true) ||
        cmp(a.adverseRetention, b.adverseRetention, true) ||
        cmp(a.medianTurnover, b.medianTurnover, false) ||
        (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0),
    )
    .map(r => r.rule);
}

export interface EligibilityInput {
  days: number;
  sells: number;
  reentries: number;
  sellAssets: number;
  cagrOkOffsets: number;
}

/** 적격: 개발 최소표본(§13) + 4개 오프셋 중 3개 이상에서 CAGR 차이 ≥ −2%p. */
export function eligibility(x: EligibilityInput, t: Thresholds): { sampleOk: boolean; eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (x.days < t.devDays) reasons.push(`유효일 ${x.days} < ${t.devDays}`);
  if (x.sells < t.devSells) reasons.push(`매도 ${x.sells} < ${t.devSells}`);
  if (x.reentries < t.devReentries) reasons.push(`재진입 ${x.reentries} < ${t.devReentries}`);
  if (x.sellAssets < t.devSellAssets) reasons.push(`매도 자산 ${x.sellAssets} < ${t.devSellAssets}`);
  const sampleOk = reasons.length === 0;
  if (x.cagrOkOffsets < 3) reasons.push(`CAGR 차이 ≥ −2%p 오프셋 ${x.cagrOkOffsets} < 3`);
  return { sampleOk, eligible: reasons.length === 0, reasons };
}

/** 분기별 초과손익 기여 → 단일 분기 최대 비중(양의 초과손익 합 대비). 양의 합이 0이면 null. */
export function quarterShare(quarters: readonly QuarterContribution[]): { quarter: string; share: number } | null {
  let positive = 0;
  for (const q of quarters) if (q.excessPnl > 0) positive += q.excessPnl;
  if (positive <= 0) return null;
  let best = quarters[0];
  for (const q of quarters) if (q.excessPnl > best.excessPnl) best = q;
  return { quarter: best.quarter, share: best.excessPnl / positive };
}

function quarterOf(date: string): string {
  return `${date.slice(0, 4)}Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
}

function quarterlyExcess(rotate: SimResult, bh: SimResult): QuarterContribution[] {
  const out: QuarterContribution[] = [];
  let prevR = INITIAL_CAPITAL;
  let prevB = INITIAL_CAPITAL;
  let curQ = quarterOf(rotate.dates[0]);
  let lastR = prevR;
  let lastB = prevB;
  for (let k = 0; k < rotate.dates.length; k++) {
    const q = quarterOf(rotate.dates[k]);
    if (q !== curQ) {
      out.push({ quarter: curQ, excessPnl: lastR - prevR - (lastB - prevB) });
      prevR = lastR;
      prevB = lastB;
      curQ = q;
    }
    lastR = rotate.equity[k];
    lastB = bh.equity[k];
  }
  out.push({ quarter: curQ, excessPnl: lastR - prevR - (lastB - prevB) });
  return out;
}

/** 재진입(첫 매수 체결) 후 h 거래일: 포트폴리오 자산곡선 기준 MDD·손실확률(곡선[k+h] < 곡선[k])·평균 투입률(1−현금비중). */
export function postReentryStats(res: SimResult, startIndex: number, horizon: number): PostReentryStats {
  const completed = res.campaigns.filter(c => c.completed && c.reentryIndex !== null);
  const mdds: number[] = [];
  let losses = 0;
  const deploy: number[] = [];
  for (const c of completed) {
    const k = (c.reentryIndex as number) - startIndex;
    if (k < 0 || k + horizon > res.equity.length - 1) continue;
    const win = res.equity.slice(k, k + horizon + 1);
    mdds.push(maxDrawdown(win));
    if (res.equity[k + horizon] < res.equity[k]) losses++;
    let s = 0;
    for (let j = k; j <= k + horizon; j++) s += 1 - res.cashWeight[j];
    deploy.push(s / (horizon + 1));
  }
  const obs = mdds.length;
  return {
    horizon,
    campaigns: completed.length,
    observable: obs,
    censored: completed.length - obs,
    medianMdd: median(mdds),
    lossProbability: obs > 0 ? losses / obs : NaN,
    deploymentRate: deploy.length > 0 ? deploy.reduce((a, b) => a + b, 0) / deploy.length : NaN,
  };
}

function relReduction(mddBase: number, mddStrategy: number): number | null {
  return mddRelativeReduction(mddBase, mddStrategy);
}

function numOrNeg(v: number | null): number {
  return v === null ? NaN : v;
}

// ── 본체 ────────────────────────────────────────────────────────────────────
export function runDevelopment(fullPanel: Panel, panelName: PanelName, opts: DevOptions = {}): DevResult {
  const devEndDate = opts.devEndDate ?? DEV_END_DATE;
  if (devEndDate > DEV_END_DATE) throw new Error(`개발 가드: devEndDate ${devEndDate} > ${DEV_END_DATE} (검증구간 접근 금지)`);
  const t = opts.thresholds ?? THRESHOLDS;
  const offsets = opts.offsets ?? OFFSETS;
  const minOffsetDays = opts.minOffsetDays ?? MIN_OFFSET_DAYS;

  // 가드: 이 줄 이후 fullPanel 은 다시 참조하지 않는다.
  const panel = truncatePanel(fullPanel, devEndDate);
  const n = panel.dates.length;
  if (n === 0) throw new Error('runDevelopment: 개발구간 세션이 없습니다.');
  const endIndex = n - 1;
  const cache: SignalCache = computeSignalCache(panel);
  const codes = includedAssets(panel);
  const weights = panelWeights(panel);
  const cashRates = cashRateArray(panel.dates, opts.cd91 ?? loadCd91());
  const setupFor = (rule: SignalRuleId): SimSetup => ({ panel, signals: cache[rule], weights, cashRates });

  const rules: RuleDevSummary[] = [];
  const offsetRuns = new Map<string, { bh: SimResult; rotate: SimResult }>();

  for (const rule of SIGNAL_RULES) {
    const base = ruleStartIndex(cache, rule, codes, n);
    const offsetResults: OffsetResult[] = [];
    const excluded: { offset: number; days: number; reason: string }[] = [];
    let sample = { days: 0, sells: 0, reentries: 0, sellAssets: 0 };
    let quarters: QuarterContribution[] = [];
    if (base !== null) {
      for (const offset of offsets) {
        const startIndex = base + offset;
        const days = endIndex - startIndex + 1;
        if (days < minOffsetDays) {
          excluded.push({ offset, days, reason: `유효일 ${Math.max(days, 0)} < ${minOffsetDays}` });
          continue;
        }
        const setup = setupFor(rule);
        const bh = runSim(setup, 'BH', startIndex, endIndex, COST_BASE);
        const cash = runSim(setup, 'CASH', startIndex, endIndex, COST_BASE);
        const rot = runSim(setup, 'ROTATE', startIndex, endIndex, COST_BASE);
        const bhA = runSim(setup, 'BH', startIndex, endIndex, COST_ADVERSE);
        const rotA = runSim(setup, 'ROTATE', startIndex, endIndex, COST_ADVERSE);
        offsetRuns.set(`${rule}|${offset}`, { bh, rotate: rot });
        const mBh = simMetrics(bh);
        const mRot = simMetrics(rot);
        const mBhA = simMetrics(bhA);
        const mRotA = simMetrics(rotA);
        const completed = rot.campaigns.filter(c => c.completed).length;
        offsetResults.push({
          offset,
          startIndex,
          startDate: panel.dates[startIndex],
          days,
          bh: mBh,
          cash: simMetrics(cash),
          rotate: { ...mRot, turnover: rot.turnover, sells: rot.sellEventCount, reentries: completed, sellAssets: rot.assetsWithSells.length },
          bhAdverse: mBhA,
          rotateAdverse: mRotA,
          cagrDiff: mRot.cagr - mBh.cagr,
          mddReduction: relReduction(mBh.mdd, mRot.mdd),
          calmarImprovement: calmarDelta(mRot.calmar, mBh.calmar),
          mddReductionAdverse: relReduction(mBhA.mdd, mRotA.mdd),
        });
        if (offset === 0) {
          sample = { days, sells: rot.sellEventCount, reentries: completed, sellAssets: rot.assetsWithSells.length };
          quarters = quarterlyExcess(rot, bh);
        }
      }
    }
    const cagrOk = offsetResults.filter(o => o.cagrDiff >= -0.02).length;
    const el = eligibility({ ...sample, cagrOkOffsets: cagrOk }, t);
    const reasons = base === null ? ['시작 인덱스 없음(유효 신호 없음)'] : el.reasons.slice();
    if (offsetResults.length === 0 && base !== null) reasons.push('유효 오프셋 없음');
    const mddRed = offsetResults.map(o => numOrNeg(o.mddReduction)).filter(v => !Number.isNaN(v));
    const adverseKept = offsetResults.filter(o => o.mddReductionAdverse !== null && o.mddReductionAdverse > 0).length;
    const share = quarters.length > 0 ? quarterShare(quarters) : null;
    rules.push({
      rule,
      baseStartIndex: base,
      baseStartDate: base === null ? null : panel.dates[base],
      offsets: offsetResults,
      excludedOffsets: excluded,
      sample: { ...sample, ok: el.sampleOk && base !== null, reasons: el.sampleOk ? [] : el.reasons.filter(r => !r.startsWith('CAGR')) },
      cagrOkOffsets: cagrOk,
      eligible: base !== null && offsetResults.length > 0 && el.eligible,
      ineligibleReasons: base !== null && offsetResults.length > 0 && el.eligible ? [] : reasons,
      medianMddReduction: median(mddRed),
      medianCalmarImprovement: median(offsetResults.map(o => o.calmarImprovement)),
      adverseRetention: offsetResults.length > 0 ? adverseKept / offsetResults.length : 0,
      medianTurnover: median(offsetResults.map(o => o.rotate.turnover)),
      quarters,
      maxQuarter: share,
      rankUnstable: share !== null && share.share > 0.6,
    });
  }

  const ranking = rankCandidates(rules);
  const notes: string[] = [];
  const rankUnstableRules = rules.filter(r => r.rankUnstable).map(r => r.rule);
  if (rankUnstableRules.length > 0) notes.push(`개발 순위 불안정(단일 분기 초과성과 > 양의 초과손익의 60%): ${rankUnstableRules.join(', ')}`);

  const result: DevResult = {
    panel: panelName,
    devEndDate,
    sessions: n,
    status: 'SELECTED',
    holdReason: null,
    ranking,
    selected: [],
    rules,
    pyramid: { baselines: [], candidates: [] },
    rankUnstableRules,
    notes,
  };

  if (ranking.length < 2) {
    result.status = '판단 보류';
    result.holdReason = `적격 후보 ${ranking.length}개 < 2 — 불타기·검증을 진행하지 않는다(V2 §7.2-5).`;
    return result;
  }

  // 상위 2개 × 불타기 3개 간격
  const top2 = ranking.slice(0, 2);
  const selected: SelectedRule[] = [];
  for (const rule of top2) {
    const summary = rules.find(r => r.rule === rule) as RuleDevSummary;
    const baseRotate = offsetRuns.get(`${rule}|0`);
    if (!baseRotate) throw new Error(`내부 오류: ${rule} offset 0 실행 결과 없음`);
    const base0 = summary.offsets.find(o => o.offset === 0) as OffsetResult;
    result.pyramid.baselines.push({
      rule,
      post21: postReentryStats(baseRotate.rotate, base0.startIndex, 21),
      post63: postReentryStats(baseRotate.rotate, base0.startIndex, 63),
    });
    const cands: PyramidCandidate[] = [];
    for (const interval of PYRAMID_INTERVALS) {
      const redVsC: number[] = [];
      const cagrVsC: number[] = [];
      const turn: number[] = [];
      let off0: SimResult | null = null;
      for (const o of summary.offsets) {
        const res = runSim(setupFor(rule), 'ROTATE_PYRAMID', o.startIndex, endIndex, COST_BASE, interval);
        const m = simMetrics(res);
        const r = relReduction(o.rotate.mdd, m.mdd);
        if (r !== null) redVsC.push(r);
        cagrVsC.push(m.cagr - o.rotate.cagr);
        turn.push(res.turnover);
        if (o.offset === 0) off0 = res;
      }
      if (!off0) throw new Error(`내부 오류: ${rule}/${interval} offset 0 불타기 결과 없음`);
      const campaigns = off0.campaigns.filter(c => c.completed).length;
      const fills = off0.campaigns.reduce((s, c) => s + c.pyramidFills, 0);
      cands.push({
        rule,
        interval,
        offsetsRun: summary.offsets.length,
        medianMddImprovementVsC: median(redVsC),
        medianCagrDiffVsC: median(cagrVsC),
        medianTurnover: median(turn),
        campaigns,
        fills,
        minEventsOk: campaigns >= t.pyramidCampaigns && fills >= t.pyramidFills,
        post21: postReentryStats(off0, base0.startIndex, 21),
        post63: postReentryStats(off0, base0.startIndex, 63),
      });
    }
    result.pyramid.candidates.push(...cands);
    // V2 §11: MDD 개선 중앙값(내림) → 63일 손실확률(오름) → 낮은 회전율 → 간격 정의 순서
    const ok = cands.filter(c => c.minEventsOk);
    ok.sort(
      (a, b) =>
        cmp(a.medianMddImprovementVsC, b.medianMddImprovementVsC, true) ||
        cmp(nanLast(a.post63.lossProbability), nanLast(b.post63.lossProbability), false) ||
        cmp(a.medianTurnover, b.medianTurnover, false) ||
        PYRAMID_INTERVALS.indexOf(a.interval) - PYRAMID_INTERVALS.indexOf(b.interval),
    );
    if (ok.length === 0) {
      selected.push({ rule, pyramidInterval: null, pyramidNote: '개발 최소사건(재진입 캠페인·추가매수) 미달 — 불타기는 검증하지 않는다.' });
    } else {
      selected.push({ rule, pyramidInterval: ok[0].interval, pyramidNote: `간격 ${ok[0].interval} 봉인` });
    }
  }
  result.selected = selected;
  return result;
}

function nanLast(v: number): number {
  return Number.isNaN(v) ? Infinity : v;
}

/** P 의 상위 2개가 P5 상위 3개 안에 모두 들어야 안정. 아니면 '프록시 민감'. */
export function proxySensitive(mainTop2: readonly SignalRuleId[], controlRanking: readonly SignalRuleId[]): boolean {
  const top3 = controlRanking.slice(0, 3);
  return !mainTop2.every(r => top3.includes(r));
}

// ── 리포트 ─────────────────────────────────────────────────────────────────
function pct(v: number | null, d = 2): string {
  return v === null || Number.isNaN(v) ? 'n/a' : `${(v * 100).toFixed(d)}%`;
}

export function formatDevReport(r: DevResult, control: DevResult | null): string {
  const L: string[] = [];
  L.push(`=== V3 개발구간 결과 (패널 ${r.panel}, ~${r.devEndDate}, 세션 ${r.sessions}) ===`);
  for (const s of r.rules) {
    L.push(`\n[${s.rule}] 시작 ${s.baseStartDate ?? '-'}  적격=${s.eligible}${s.eligible ? '' : ` (${s.ineligibleReasons.join('; ')})`}`);
    L.push(
      `  표본(offset0): 유효일 ${s.sample.days} 매도 ${s.sample.sells} 재진입 ${s.sample.reentries} 매도자산 ${s.sample.sellAssets}` +
        `  MDD축소 중앙값 ${pct(s.medianMddReduction)}  Calmar개선 중앙값 ${s.medianCalmarImprovement.toFixed(3)}  불리비용 유지 ${pct(s.adverseRetention, 0)}  회전율 중앙값 ${s.medianTurnover.toFixed(2)}`,
    );
    for (const o of s.offsets) {
      L.push(
        `  off${String(o.offset).padStart(2)} ${o.startDate} ${o.days}일 | BH CAGR ${pct(o.bh.cagr)} MDD ${pct(o.bh.mdd)} | ROT CAGR ${pct(o.rotate.cagr)} MDD ${pct(o.rotate.mdd)} | 차이 ${pct(o.cagrDiff)} MDD축소 ${pct(o.mddReduction)} | CASH CAGR ${pct(o.cash.cagr)} MDD ${pct(o.cash.mdd)}`,
      );
    }
    for (const e of s.excludedOffsets) L.push(`  off${e.offset} 제외: ${e.reason}`);
    if (s.maxQuarter) L.push(`  분기 기여 최대 ${s.maxQuarter.quarter} ${pct(s.maxQuarter.share, 0)}${s.rankUnstable ? '  ** 개발 순위 불안정 **' : ''}`);
  }
  L.push(`\n순위(적격): ${r.ranking.join(' > ') || '(없음)'}`);
  if (r.status === '판단 보류') L.push(`상태: 판단 보류 — ${r.holdReason}`);
  else {
    for (const c of r.pyramid.candidates) {
      L.push(
        `  불타기 ${c.rule}/${c.interval}: MDD개선(vs C) ${pct(c.medianMddImprovementVsC)} CAGR차(vs C) ${pct(c.medianCagrDiffVsC)} 캠페인 ${c.campaigns} 추가매수 ${c.fills} 최소사건=${c.minEventsOk}` +
          ` | 21일 MDD ${pct(c.post21.medianMdd)} 손실 ${pct(c.post21.lossProbability, 0)} 투입 ${pct(c.post21.deploymentRate, 0)} 검열 ${c.post21.censored}` +
          ` | 63일 MDD ${pct(c.post63.medianMdd)} 손실 ${pct(c.post63.lossProbability, 0)} 투입 ${pct(c.post63.deploymentRate, 0)} 검열 ${c.post63.censored}`,
      );
    }
    for (const s of r.selected) L.push(`선정: ${s.rule}  불타기=${s.pyramidInterval ?? '없음'} (${s.pyramidNote})`);
  }
  for (const note of r.notes) L.push(`주의: ${note}`);
  if (control) {
    const flag = r.status === 'SELECTED' ? proxySensitive(r.selected.map(s => s.rule), control.ranking) : null;
    L.push(`프록시 민감 점검(P5 순위 ${control.ranking.join(' > ') || '(없음)'}): ${flag === null ? 'n/a' : flag ? '프록시 민감' : '안정'}`);
  }
  return L.join('\n');
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  const panelArg = argValue(process.argv, '--panel');
  if (panelArg !== 'P' && panelArg !== 'P5') throw new Error('사용법: devRun.ts --panel P|P5');
  const main = loadPanel(panelArg);
  const result = runDevelopment(main.panel, panelArg);
  let control: DevResult | null = null;
  if (panelArg === 'P') {
    const p5Path = path.join(OUTPUT_DIR, 'panel_P5.json');
    if (existsSync(p5Path)) control = runDevelopment(loadPanel('P5').panel, 'P5');
  }
  const out = path.join(OUTPUT_DIR, `DEV_RESULT_${panelArg}.json`);
  writeFileSync(out, JSON.stringify(result, null, 2));
  if (control) writeFileSync(path.join(OUTPUT_DIR, 'DEV_RESULT_P5.json'), JSON.stringify(control, null, 2));
  process.stdout.write(`${formatDevReport(result, control)}\n\n저장: ${out}\n`);
}
