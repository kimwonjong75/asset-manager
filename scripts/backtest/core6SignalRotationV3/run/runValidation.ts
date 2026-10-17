// scripts/backtest/core6SignalRotationV3/run/runValidation.ts
// 코어 6종 신호 로테이션 V3 — 검증구간(2024-07-01~) 실행기. **구현만 있고 아직 실행하지 않는다.**
// 선택 잠금 파일이 없거나 해시가 하나라도 다르면 throw 한다(V2 §7.2-6/7, V3 §17-7).
//
// 분리된 두 함수:
//   validationEventPass()   — 사건 수 전용(매도·재진입·불타기 체결·매도 자산 수·유효일). 성과 지표를 계산·반환하지 않는다.
//   validationPerformance() — 성과 실행. 사건 패스가 최소사건을 충족하지 않으면 throw(§18: 임계값을 낮추지 않는다).
// 미구현(후속): §15-5 검증 시작일 오프셋 민감도, §15-6 leave-one-out, 부트스트랩 CI, 세후 — 잠금 후 별도 단계에서 추가.

import { runSim, simMetrics } from './devRun';
import type { SimSetup } from './devRun';
import { LOCK_PATH, computeHashes, readLock, verifyLockHashes } from './selectionLock';
import type { SelectionLock } from './selectionLock';
import {
  COST_ADVERSE,
  COST_BASE,
  THRESHOLDS,
  VAL_START_DATE,
  cashRateArray,
  firstIndexOnOrAfter,
  includedAssets,
  isMainModule,
  loadCd91,
  loadOrComputeSignalCache,
  loadPanel,
  panelWeights,
  argValue,
} from './common';
import type { CdRow, Metrics, PanelName, Thresholds } from './common';
import { mddRelativeReduction } from '../stats/metrics';
import type { Panel, SignalRuleId } from '../types';
import type { SelectedRule } from './devRun';
import type { SignalCache } from './common';

export interface ValidationEvents {
  rule: SignalRuleId;
  days: number;
  sells: number;
  reentries: number;
  sellAssets: number;
  pyramid: { interval: string; campaigns: number; fills: number } | null;
  ok: boolean;
  pyramidOk: boolean;
  reasons: string[];
}

export interface ValidationContext {
  setup: SimSetup;
  startIndex: number;
  endIndex: number;
  codes: ReturnType<typeof includedAssets>;
}

export function buildValidationContext(panel: Panel, cache: SignalCache, rule: SignalRuleId, cd91: readonly CdRow[], valStart: string = VAL_START_DATE): ValidationContext {
  const startIndex = firstIndexOnOrAfter(panel.dates, valStart);
  if (startIndex < 0) throw new Error('검증구간 세션이 없습니다.');
  return {
    setup: { panel, signals: cache[rule], weights: panelWeights(panel), cashRates: cashRateArray(panel.dates, cd91) },
    startIndex,
    endIndex: panel.dates.length - 1,
    codes: includedAssets(panel),
  };
}

/** 사건 수 전용 패스. 성과(CAGR·MDD·Calmar 등)는 계산·반환하지 않는다. */
export function validationEventPass(
  panel: Panel,
  cache: SignalCache,
  selected: readonly SelectedRule[],
  cd91: readonly CdRow[],
  t: Thresholds = THRESHOLDS,
  valStart: string = VAL_START_DATE,
): ValidationEvents[] {
  return selected.map(sel => {
    const ctx = buildValidationContext(panel, cache, sel.rule, cd91, valStart);
    const rot = runSim(ctx.setup, 'ROTATE', ctx.startIndex, ctx.endIndex, COST_BASE);
    const days = ctx.endIndex - ctx.startIndex + 1;
    const sells = rot.sellEventCount;
    const reentries = rot.campaigns.filter(c => c.completed).length;
    const sellAssets = rot.assetsWithSells.length;
    const reasons: string[] = [];
    if (days < t.valDays) reasons.push(`유효일 ${days} < ${t.valDays}`);
    if (sells < t.valSells) reasons.push(`매도 ${sells} < ${t.valSells}`);
    if (reentries < t.valReentries) reasons.push(`재진입 ${reentries} < ${t.valReentries}`);
    if (sellAssets < t.valSellAssets) reasons.push(`매도 자산 ${sellAssets} < ${t.valSellAssets}`);
    let pyramid: ValidationEvents['pyramid'] = null;
    let pyramidOk = false;
    if (sel.pyramidInterval) {
      const py = runSim(ctx.setup, 'ROTATE_PYRAMID', ctx.startIndex, ctx.endIndex, COST_BASE, sel.pyramidInterval as '0.5N' | '4N' | '10pct');
      const campaigns = py.campaigns.filter(c => c.completed).length;
      const fills = py.campaigns.reduce((s, c) => s + c.pyramidFills, 0);
      pyramid = { interval: sel.pyramidInterval, campaigns, fills };
      pyramidOk = reasons.length === 0 && campaigns >= t.valPyramidCampaigns && fills >= t.valPyramidFills;
    }
    return { rule: sel.rule, days, sells, reentries, sellAssets, pyramid, ok: reasons.length === 0, pyramidOk, reasons };
  });
}

export interface ValidationRuleResult {
  rule: SignalRuleId;
  bh: Metrics;
  cash: Metrics;
  rotate: Metrics & { turnover: number };
  pyramid: (Metrics & { turnover: number }) | null;
  mddReduction: number | null;
  cagrDiff: number;
  calmarImproved: boolean;
  adverse: { bh: Metrics; rotate: Metrics; mddReduction: number | null; cagrDiff: number };
  capSensitivity: { cap: number; mddReduction: number | null; cagrDiff: number }[];
  criteria: {
    mdd20: boolean;
    cagrFloor: boolean;
    minEvents: boolean;
    adverseHolds: boolean;
    capStable: boolean;
    calmar: boolean;
  };
  pending: string[];
}

/** 성과 실행. 사건 패스가 최소사건을 충족하지 못하면 throw(성과를 계산하지 않는다). */
export function validationPerformance(
  panel: Panel,
  cache: SignalCache,
  events: ValidationEvents,
  sel: SelectedRule,
  cd91: readonly CdRow[],
  valStart: string = VAL_START_DATE,
): ValidationRuleResult {
  if (!events.ok) throw new Error(`검증 최소사건 미달(${events.rule}): ${events.reasons.join('; ')} — 성과를 계산하지 않는다(§18).`);
  const ctx = buildValidationContext(panel, cache, events.rule, cd91, valStart);
  const { startIndex, endIndex, setup } = ctx;
  const bh = runSim(setup, 'BH', startIndex, endIndex, COST_BASE);
  const cash = runSim(setup, 'CASH', startIndex, endIndex, COST_BASE);
  const rot = runSim(setup, 'ROTATE', startIndex, endIndex, COST_BASE);
  const mBh = simMetrics(bh);
  const mRot = simMetrics(rot);
  const bhA = simMetrics(runSim(setup, 'BH', startIndex, endIndex, COST_ADVERSE));
  const rotA = simMetrics(runSim(setup, 'ROTATE', startIndex, endIndex, COST_ADVERSE));
  const capSensitivity = [1.25, 2.0].map(cap => {
    const b = simMetrics(runSim(setup, 'BH', startIndex, endIndex, COST_BASE, undefined, cap));
    const r = simMetrics(runSim(setup, 'ROTATE', startIndex, endIndex, COST_BASE, undefined, cap));
    return { cap, mddReduction: mddRelativeReduction(b.mdd, r.mdd), cagrDiff: r.cagr - b.cagr };
  });
  let pyramid: ValidationRuleResult['pyramid'] = null;
  if (sel.pyramidInterval && events.pyramidOk) {
    const py = runSim(setup, 'ROTATE_PYRAMID', startIndex, endIndex, COST_BASE, sel.pyramidInterval as '0.5N' | '4N' | '10pct');
    pyramid = { ...simMetrics(py), turnover: py.turnover };
  }
  const red = mddRelativeReduction(mBh.mdd, mRot.mdd);
  const redA = mddRelativeReduction(bhA.mdd, rotA.mdd);
  const cagrDiff = mRot.cagr - mBh.cagr;
  const mdd20 = red !== null && red >= 0.2;
  const cagrFloor = cagrDiff >= -0.02;
  const base = mdd20 && cagrFloor;
  const capStable = capSensitivity.every(c => !(base && !((c.mddReduction ?? -1) >= 0.2 && c.cagrDiff >= -0.02)));
  return {
    rule: events.rule,
    bh: mBh,
    cash: simMetrics(cash),
    rotate: { ...mRot, turnover: rot.turnover },
    pyramid,
    mddReduction: red,
    cagrDiff,
    calmarImproved: mRot.calmar > mBh.calmar,
    adverse: { bh: bhA, rotate: rotA, mddReduction: redA, cagrDiff: rotA.cagr - bhA.cagr },
    capSensitivity,
    criteria: {
      mdd20,
      cagrFloor,
      minEvents: events.ok,
      adverseHolds: redA !== null && redA > 0 && rotA.cagr - bhA.cagr >= -0.02,
      capStable,
      calmar: mRot.calmar > mBh.calmar,
    },
    pending: ['§15-5 검증 시작일 민감도', '§15-6 leave-one-out', '부트스트랩 CI', '세후 민감도'],
  };
}

export interface ValidationOptions {
  lockPath?: string;
  /** 테스트용: 파일 대신 주입. */
  panel?: Panel;
  panelSha256?: string;
  cd91?: readonly CdRow[];
}

export interface ValidationRunResult {
  lock: SelectionLock;
  events: ValidationEvents[];
  /** 최소사건 미달 규칙은 null(성과 미계산). */
  performance: (ValidationRuleResult | null)[];
}

/** 선택 잠금이 없거나 해시 불일치면 throw. 통과 시 사건 패스 → 최소사건 충족 규칙만 성과 실행. */
export function runValidation(panelName: PanelName, opts: ValidationOptions = {}): ValidationRunResult {
  const lock = readLock(opts.lockPath ?? LOCK_PATH);
  if (lock.panel !== panelName) throw new Error(`선택 잠금 패널(${lock.panel}) ≠ 요청 패널(${panelName})`);
  const loaded = opts.panel ? { panel: opts.panel, sha256: opts.panelSha256 ?? '' } : loadPanel(panelName);
  verifyLockHashes(lock, computeHashes(loaded.panel, loaded.sha256));
  const cd91 = opts.cd91 ?? loadCd91();
  const cache = loadOrComputeSignalCache(panelName, loaded.panel, loaded.sha256);
  const events = validationEventPass(loaded.panel, cache, lock.selected, cd91);
  const performance = events.map((e, i) => (e.ok ? validationPerformance(loaded.panel, cache, e, lock.selected[i], cd91) : null));
  return { lock, events, performance };
}

if (isMainModule(import.meta.url)) {
  const panelArg = argValue(process.argv, '--panel');
  if (panelArg !== 'P' && panelArg !== 'P5') throw new Error('사용법: runValidation.ts --panel P|P5  (선택 잠금 커밋 후에만)');
  process.stdout.write(`${JSON.stringify(runValidation(panelArg), null, 2)}\n`);
}
