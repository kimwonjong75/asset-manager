// scripts/backtest/lectureSignals/phase0Core.ts
// ---------------------------------------------------------------------------
// Phase 0 — 신규 알림 구성(C / C′-min / C′-mid) 선검증의 **순수 로직**.
//
// 드라이버(`runPhase0.ts`)는 데이터 로드·집계·문서 생성만 하고, 판정/카운팅/표본추출
// 로직은 전부 여기에 둔다(골든 테스트 `tests/lecturePhase0Parity.ts`가 이 모듈을 import).
// 기존 파일은 한 줄도 고치지 않고 import만 한다(appRules.ts / events.ts / portfolio.ts).
//
// 계획서: `docs/PLAN_앱적용_신호정비_260726.md` §2 Phase 0.
//   C       = 현행 앱 매도규칙 13종(appRules.APP_SELL_RULE_IDS)
//   C′-min  = 급성 6종 + climax-top + distribution-high            (8종)
//   C′-mid  = C′-min + weinstein-150-break + ma120-break + swing-low-break (11종)
//
// 알림 정의 2종(외부 검토 반영):
//   (1) 신규 전이(transition): (종목,규칙) 쌍이 어제 미충족 → 오늘 충족
//   (2) 상태 지속(state)     : 그날 충족 상태인 (종목,규칙) 쌍 수  ← P4의 91%가 이 계열
//
// 규칙: `any`·`console.*`·`Math.random` 금지. 외부 I/O 없음.
// ---------------------------------------------------------------------------

import {
  APP_SELL_RULE_IDS,
  appHighestPrice,
  evaluateAppSellRules,
  type AppIndicatorSeries,
  type AppSellRuleId,
} from './appRules';
import type { AcuteSignalCode, SecurityBars } from './configTypes';
import { KR_VARIABLE_COST_BPS } from './configTypes';
import { testSignalAt } from './events';
import { sellCostFraction } from './portfolio';

// ===========================================================================
// 구성 정의 (계획서 §2 Phase 0 표 — 사전 고정, 결과를 본 뒤 변경 금지)
// ===========================================================================

/** 검증표본 통과 급성 매도신호 6종. S5는 앱 런타임이 쓰는 프록시 변형. */
export const ACUTE_SIX: readonly AcuteSignalCode[] = [
  'S1_RUNUP_21D_100',
  'S2_RUNUP_5D_40',
  'S3_LIMIT_UP',
  'S4_GAP_BEAR_VOLUME',
  'S5_APP_PROXY',
  'S6_CRASH_5_VOLUME_2X',
];

/** 알림 단위 id = 앱 규칙 13종(0..12) + 급성 6종(13..18). 비트 인덱스 = 배열 인덱스. */
export const PHASE0_ALERT_IDS: readonly string[] = [...APP_SELL_RULE_IDS, ...ACUTE_SIX];

export type Phase0ConfigId = 'C' | 'CMIN' | 'CMID';
export const PHASE0_CONFIG_IDS: readonly Phase0ConfigId[] = ['C', 'CMIN', 'CMID'];

export const PHASE0_CONFIG_LABEL: Record<Phase0ConfigId, string> = {
  C: 'C(현행 13종)',
  CMIN: "C′-min(8종)",
  CMID: "C′-mid(11종)",
};

/** 예산제한 C(`C_CAPPED`) 표기 — 규칙 집합은 C와 동일하고 하루 실행 건수만 제한한다. */
export const CAPPED_CONFIG_LABEL = 'C_CAPPED(현행 13종·하루 3건)';

/** 구성별 ON 규칙 집합(계획서 표 그대로). */
export const CONFIG_RULE_SETS: Record<Phase0ConfigId, readonly string[]> = {
  C: [...APP_SELL_RULE_IDS],
  CMIN: [...ACUTE_SIX, 'climax-top', 'distribution-high'],
  CMID: [
    ...ACUTE_SIX,
    'climax-top',
    'distribution-high',
    'weinstein-150-break',
    'ma120-break',
    'swing-low-break',
  ],
};

/** 규칙 id → 비트 인덱스. 알 수 없는 id는 -1. */
export function alertBitIndex(id: string): number {
  return PHASE0_ALERT_IDS.indexOf(id);
}

/** 구성 → 19비트 마스크. */
export function configMask(cfg: Phase0ConfigId): number {
  let m = 0;
  for (const id of CONFIG_RULE_SETS[cfg]) {
    const b = alertBitIndex(id);
    if (b < 0) throw new Error(`알 수 없는 규칙 id: ${id}`);
    m |= 1 << b;
  }
  return m;
}

export const CONFIG_MASKS: Record<Phase0ConfigId, number> = {
  C: configMask('C'),
  CMIN: configMask('CMIN'),
  CMID: configMask('CMID'),
};

// ===========================================================================
// Phase 0-C: 절충안 구성 (C′-min + 꼬리 방어 규칙)
// ===========================================================================
//
// Phase 0-B에서 C′-min은 게이트 A·B′-1·B′-2를 통과했으나 B′-3(적대 조건: C_CAPPED 대비
// 열등 금지)에서 4셀 전부 탈락했다. 평균 수익률은 C′-min이 4~7%p 앞서고 하위10% 꼬리는
// C_CAPPED가 7~10%p 앞서는 **교환관계**가 실측됐다.
//
// 이 절은 그 교환관계를 깰 수 있는지 — C′-min에 꼬리 방어 규칙을 하나씩/조합으로 되살려
// **네 게이트를 전부 통과하는 구성이 존재하는지** — 를 탐색한다.
//
// 탐색 대상: `daily-crash`(급락일) · `swing-low-break`(스윙로우 이탈) · `stop-loss`(매수가 대비 손절)
// 제외    : `dead-cross` · `trend-break` · `long-decline` (포화 주범 — 이번 탐색 대상 아님)

/** 절충안 탐색에서 되살릴 수 있는 꼬리 방어 규칙 3종(사전 고정). */
export const TAIL_DEFENSE_RULES: readonly string[] = [
  'daily-crash',
  'swing-low-break',
  'stop-loss',
];

/** 절충안 탐색에서 **제외**한 포화 3종(사전 고정). */
export const SATURATION_EXCLUDED_RULES: readonly string[] = [
  'dead-cross',
  'trend-break',
  'long-decline',
];

export type Phase0CompromiseId =
  | 'CMIN_DC'
  | 'CMIN_SLB'
  | 'CMIN_STOP'
  | 'CMIN_DC_STOP'
  | 'CMIN_SLB_STOP'
  | 'CMIN_DC_SLB';

export const COMPROMISE_CONFIG_IDS: readonly Phase0CompromiseId[] = [
  'CMIN_DC',
  'CMIN_SLB',
  'CMIN_STOP',
  'CMIN_DC_STOP',
  'CMIN_SLB_STOP',
  'CMIN_DC_SLB',
];

/** 구성별로 C′-min 위에 **추가**되는 규칙(사전 고정 — 결과를 본 뒤 변경 금지). */
export const COMPROMISE_ADDED_RULES: Record<Phase0CompromiseId, readonly string[]> = {
  CMIN_DC: ['daily-crash'],
  CMIN_SLB: ['swing-low-break'],
  CMIN_STOP: ['stop-loss'],
  CMIN_DC_STOP: ['daily-crash', 'stop-loss'],
  CMIN_SLB_STOP: ['swing-low-break', 'stop-loss'],
  CMIN_DC_SLB: ['daily-crash', 'swing-low-break'],
};

export const COMPROMISE_CONFIG_LABEL: Record<Phase0CompromiseId, string> = {
  CMIN_DC: "C′-min+daily-crash",
  CMIN_SLB: "C′-min+swing-low-break",
  CMIN_STOP: "C′-min+stop-loss",
  CMIN_DC_STOP: "C′-min+daily-crash+stop-loss",
  CMIN_SLB_STOP: "C′-min+swing-low-break+stop-loss",
  CMIN_DC_SLB: "C′-min+daily-crash+swing-low-break",
};

function buildCompromiseRuleSets(): Record<Phase0CompromiseId, readonly string[]> {
  const out = {} as Record<Phase0CompromiseId, readonly string[]>;
  for (const id of COMPROMISE_CONFIG_IDS) {
    out[id] = [...CONFIG_RULE_SETS.CMIN, ...COMPROMISE_ADDED_RULES[id]];
  }
  return out;
}

export const COMPROMISE_RULE_SETS: Record<Phase0CompromiseId, readonly string[]> =
  buildCompromiseRuleSets();

export type Phase0AnyConfigId = Phase0ConfigId | Phase0CompromiseId;

/** 원 3구성 + 절충안 6구성 = 9구성. 순서 고정(문서·JSON 재현성). */
export const PHASE0_ALL_CONFIG_IDS: readonly Phase0AnyConfigId[] = [
  ...PHASE0_CONFIG_IDS,
  ...COMPROMISE_CONFIG_IDS,
];

export const ALL_CONFIG_RULE_SETS: Record<Phase0AnyConfigId, readonly string[]> = {
  ...CONFIG_RULE_SETS,
  ...COMPROMISE_RULE_SETS,
};

export const ALL_CONFIG_LABEL: Record<Phase0AnyConfigId, string> = {
  ...PHASE0_CONFIG_LABEL,
  ...COMPROMISE_CONFIG_LABEL,
};

/** 구성 id → 마스크(원 3구성 + 절충안 6구성). */
export function anyConfigMask(id: Phase0AnyConfigId): number {
  let m = 0;
  for (const rule of ALL_CONFIG_RULE_SETS[id]) {
    const b = alertBitIndex(rule);
    if (b < 0) throw new Error(`알 수 없는 규칙 id: ${rule}`);
    m |= 1 << b;
  }
  return m;
}

function buildAllMasks(): Record<Phase0AnyConfigId, number> {
  const out = {} as Record<Phase0AnyConfigId, number>;
  for (const id of PHASE0_ALL_CONFIG_IDS) out[id] = anyConfigMask(id);
  return out;
}

export const ALL_CONFIG_MASKS: Record<Phase0AnyConfigId, number> = buildAllMasks();

// ===========================================================================
// 비트 유틸
// ===========================================================================

/** 32비트 popcount(Hamming weight). */
export function popcount(x: number): number {
  let v = x >>> 0;
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (v * 0x01010101) >>> 24;
}

/** 오늘 새로 켜진 비트(어제 미충족 → 오늘 충족) 중 구성에 포함된 것. */
export function transitionBits(prevMask: number, curMask: number, cfgMask: number): number {
  return (curMask & ~prevMask & cfgMask) >>> 0;
}

/** 오늘 충족 상태인 비트 중 구성에 포함된 것. */
export function stateBits(curMask: number, cfgMask: number): number {
  return (curMask & cfgMask) >>> 0;
}

export interface SeriesAlertCounts {
  /** 일별 신규 전이 건수 */
  perDayTransition: number[];
  /** 일별 상태 지속 건수 */
  perDayState: number[];
  transitionTotal: number;
  stateTotal: number;
  /** 규칙 비트별 전이 누계(길이 = PHASE0_ALERT_IDS.length) */
  transitionByBit: number[];
}

/**
 * 마스크 시계열에 대한 두 카운트 산출. `prevMask`는 masks[0] 직전일의 마스크
 * (없으면 0 = 전부 미충족 → 첫날 충족 비트가 모두 신규 전이로 잡힘).
 */
export function countSeriesAlerts(
  masks: readonly number[] | Uint32Array,
  cfgMask: number,
  prevMask: number
): SeriesAlertCounts {
  const perDayTransition: number[] = [];
  const perDayState: number[] = [];
  const transitionByBit = new Array<number>(PHASE0_ALERT_IDS.length).fill(0);
  let transitionTotal = 0;
  let stateTotal = 0;
  let prev = prevMask >>> 0;
  for (let i = 0; i < masks.length; i++) {
    const cur = masks[i] >>> 0;
    const tb = transitionBits(prev, cur, cfgMask);
    const sb = stateBits(cur, cfgMask);
    const tn = popcount(tb);
    const sn = popcount(sb);
    perDayTransition.push(tn);
    perDayState.push(sn);
    transitionTotal += tn;
    stateTotal += sn;
    for (let b = 0; b < PHASE0_ALERT_IDS.length; b++) {
      if (tb & (1 << b)) transitionByBit[b]++;
    }
    prev = cur;
  }
  return { perDayTransition, perDayState, transitionTotal, stateTotal, transitionByBit };
}

// ===========================================================================
// 마스크 생성
// ===========================================================================

/** 앱 규칙 판정 결과 → 하위 13비트 마스크. */
export function appFlagsToMask(flags: Record<AppSellRuleId, boolean>): number {
  let m = 0;
  for (let b = 0; b < APP_SELL_RULE_IDS.length; b++) {
    if (flags[APP_SELL_RULE_IDS[b]]) m |= 1 << b;
  }
  return m;
}

/**
 * 급성 6종 마스크(비트 13..18)를 [fromIdx..toIdx] 구간에 대해 한 번만 계산한다.
 * 보유 상태와 무관하므로 종목당 1회 계산해 모든 보유(매수일이 다른)에서 재사용한다.
 * 반환 배열 길이 = bars.dates.length(구간 밖은 0).
 */
export function buildAcuteMask(
  bars: SecurityBars,
  corpActionDates: ReadonlySet<string>,
  fromIdx: number,
  toIdx: number
): Uint32Array {
  const n = bars.dates.length;
  const out = new Uint32Array(n);
  const lo = Math.max(0, fromIdx);
  const hi = Math.min(n - 1, toIdx);
  const base = APP_SELL_RULE_IDS.length;
  for (let i = lo; i <= hi; i++) {
    let m = 0;
    for (let k = 0; k < ACUTE_SIX.length; k++) {
      if (testSignalAt(ACUTE_SIX[k], bars, i, corpActionDates)) m |= 1 << (base + k);
    }
    out[i] = m;
  }
  return out;
}

// ===========================================================================
// 포트폴리오 표본 추출
// ===========================================================================

export interface PortfolioCandidate {
  code: string;
  /** 매수일 추출 구간(bar index, 양 끝 포함) */
  purchaseLo: number;
  purchaseHi: number;
}

export interface Holding {
  code: string;
  purchaseBar: number;
}

/**
 * 무작위 포트폴리오 표본. 세트 내 종목 중복 없음(부분 Fisher–Yates), 매수일은
 * 후보별 [purchaseLo, purchaseHi]에서 균등 추출. mulberry32 rng만 사용한다.
 * 같은 rng 시드 → 같은 표본(재현성).
 */
export function samplePortfolios(
  candidates: readonly PortfolioCandidate[],
  size: number,
  sets: number,
  rng: () => number
): Holding[][] {
  const out: Holding[][] = [];
  const n = candidates.length;
  if (n < size || size <= 0 || sets <= 0) return out;
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  for (let s = 0; s < sets; s++) {
    // 부분 Fisher–Yates: 앞 size개만 확정(배열은 세트 간 재사용 — 순열이 누적되지만
    // 각 스텝이 균등 추출이므로 편향 없음, 그리고 rng 순서로 완전 재현된다).
    for (let k = 0; k < size; k++) {
      const j = k + Math.floor(rng() * (n - k));
      const t = idx[k];
      idx[k] = idx[j];
      idx[j] = t;
    }
    const holdings: Holding[] = [];
    for (let k = 0; k < size; k++) {
      const c = candidates[idx[k]];
      const span = c.purchaseHi - c.purchaseLo + 1;
      const pb = c.purchaseLo + Math.floor(rng() * span);
      holdings.push({ code: c.code, purchaseBar: pb });
    }
    out.push(holdings);
  }
  return out;
}

// ===========================================================================
// 보유 1건의 마스크 시계열
// ===========================================================================

export interface HoldingScan {
  /** [fromIdx .. endIdx] 각 일의 19비트 마스크 */
  masks: Uint32Array;
  /** 실제 마지막 bar index(데이터 종료로 toIdx보다 이를 수 있음) */
  endIdx: number;
  /** fromIdx 직전일 마스크(전이 판정 기준). 없으면 0 */
  prevMask: number;
  fromIdx: number;
}

/**
 * 보유 1건(code·매수bar)에 대해 측정창 [fromIdx..toIdx]의 일별 마스크를 만든다.
 * 매수가 = adj_open[purchaseBar](P4와 동일 규약: 시가 체결), 최고가는 appHighestPrice.
 * 매도는 하지 않는다 — 이 함수는 **알림 빈도 측정** 전용이다(정책 시뮬레이션 아님).
 * 미래참조 없음.
 */
export function scanHoldingMasks(
  s: AppIndicatorSeries,
  acuteMask: Uint32Array,
  purchaseBar: number,
  fromIdx: number,
  toIdx: number
): HoldingScan | null {
  if (purchaseBar < 0 || purchaseBar >= s.n) return null;
  const buyPrice = s.open[purchaseBar];
  if (!(buyPrice > 0)) return null;
  const hi = Math.min(toIdx, s.n - 1);
  if (hi < fromIdx) return null;
  const masks = new Uint32Array(hi - fromIdx + 1);
  let runningMax = 0;
  let prevMask = 0;
  const start = Math.min(purchaseBar, fromIdx);
  for (let i = start; i <= hi; i++) {
    const c = s.close[i];
    if (i >= purchaseBar && c > runningMax) runningMax = c;
    const flags = evaluateAppSellRules(s, i, {
      purchasePrice: buyPrice,
      highestPrice: appHighestPrice(s, i, buyPrice, runningMax),
    });
    const m = (appFlagsToMask(flags) | acuteMask[i]) >>> 0;
    if (i >= fromIdx) masks[i - fromIdx] = m;
    else if (i === fromIdx - 1) prevMask = m;
  }
  return { masks, endIdx: hi, prevMask, fromIdx };
}

// ===========================================================================
// 손실 회피 성능 (P4 방법론 재사용)
// ===========================================================================

export interface Phase0Position {
  code: string;
  /** 신호일(RS90 진입일 또는 무작위 표본일) */
  signalBar: number;
  /** 매수 체결 bar = signalBar + 1 (익일 시가) */
  buyBar: number;
  /** 평가 창 끝(포함) */
  windowEnd: number;
}

export interface Phase0PolicyResult {
  terminalReturn: number;
  mdd: number;
  sells: number;
  buys: number;
  costPaid: number;
}

/** 매수 1회 변동비용(매도세 없음) — P4 buyCostFraction과 동일. */
export function buyCostFraction(): number {
  return (
    (KR_VARIABLE_COST_BPS.commissionBps +
      KR_VARIABLE_COST_BPS.spreadBps +
      KR_VARIABLE_COST_BPS.slippageBps +
      KR_VARIABLE_COST_BPS.marketImpactBps) /
    10_000
  );
}

/** 실행된 매도 1건(트리거 후 성과 계산용). */
export interface ExecutedSell {
  code: string;
  sellBar: number;
  sellPrice: number;
}

/**
 * 정책 시뮬레이션(P4 `simulatePolicy` 규약 동일 재현):
 *   시가 체결 · 매도 시 매도세+변동비용 · 매도 후 reentryDelay 거래일 뒤 같은 종목 재매수.
 * cfgMask === null 이면 HOLD(매도 없음).
 *
 * `sellLog`를 넘기면 **실제 실행된 매도**를 그대로 적재한다(수치 결과에는 영향 없음 —
 * 관측용 out-param). 1차 실행의 골든 수치는 이 인자와 무관하게 동일하다.
 */
export function simulateConfigPolicy(
  s: AppIndicatorSeries,
  bars: SecurityBars,
  acuteMask: Uint32Array,
  pos: Phase0Position,
  cfgMask: number | null,
  reentryDelayDays: number,
  sellLog?: ExecutedSell[]
): Phase0PolicyResult | null {
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
      pendingBuyBar = i + reentryDelayDays;
      if (sellLog) sellLog.push({ code: pos.code, sellBar: i, sellPrice: px });
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

    const c = s.close[i];
    equity = cash + shares * c;
    if (equity > peak) peak = equity;
    if (peak > 0) {
      const dd = 1 - equity / peak;
      if (dd > mdd) mdd = dd;
    }

    if (cfgMask === null || shares === 0) continue;
    if (c > runningMax) runningMax = c;
    const flags = evaluateAppSellRules(s, i, {
      purchasePrice: entryPrice,
      highestPrice: appHighestPrice(s, i, entryPrice, runningMax),
    });
    const m = (appFlagsToMask(flags) | acuteMask[i]) >>> 0;
    if ((m & cfgMask) !== 0 && i + 1 <= pos.windowEnd) sellAtOpenOf = i + 1;
  }
  return { terminalReturn: equity - 1, mdd, sells, buys, costPaid };
}

// ===========================================================================
// 예산제한 C (C_CAPPED) — Phase 0-B 게이트 B′-3용 적대적 비교 정책
// ===========================================================================
//
// 규칙 집합은 C(현행 13종) 그대로 두고 **하루 실행 건수만 상한**을 건다.
//   · 후보 = 그날 신규 전이된 (종목,규칙) 쌍 (어제 미충족 → 오늘 충족).
//   · 상한 초과 시 우선순위 상위 N건만 실행(= 매도 예약). 나머지는 **그날 소멸**(이월 없음).
//   · 우선순위: severity(critical > warning > info) → 동률이면 종목코드 오름차순
//               → 그래도 동률이면(같은 종목의 두 규칙) 비트 인덱스 오름차순. 완전 결정론.
//   · 상한이 무한대면 C와 **정확히 동일**해야 한다(골든 테스트가 이 항등식을 지킨다):
//     C는 "상태가 켜진 첫날" 매도하고, 전이도 같은 날 발생하며, 매도·현금 구간에서는
//     prevMask를 0으로 리셋하므로 재매수 직후 상태가 켜져 있으면 다시 전이로 잡힌다.
//
// 계획서: `docs/PLAN_앱적용_신호정비_260726.md` §Phase 0-B(B′-3).

export type AlertSeverity = 'critical' | 'warning' | 'info';

/**
 * 알림 단위 19종의 severity.
 * 앞 13종 = 앱 `constants/alertRules.ts`(2026-07-26 읽음)의 매도규칙 severity **그대로**.
 * 뒤 6종(급성) = 계획서 Phase 1-3의 "매도 검토 경고" 등급 = warning.
 * (C_CAPPED는 C 규칙 집합만 쓰므로 급성 6종 값은 이 정책에서 사용되지 않는다.)
 */
export const ALERT_SEVERITY: Record<string, AlertSeverity> = {
  'stop-loss': 'critical',
  'overheat-drop': 'critical',
  'dead-cross': 'warning',
  'trend-break': 'warning',
  'long-decline': 'warning',
  'profit-target': 'warning',
  'overheat-profit': 'critical',
  'daily-crash': 'critical',
  'climax-top': 'warning',
  'distribution-high': 'warning',
  'weinstein-150-break': 'warning',
  'ma120-break': 'warning',
  'swing-low-break': 'warning',
  S1_RUNUP_21D_100: 'warning',
  S2_RUNUP_5D_40: 'warning',
  S3_LIMIT_UP: 'warning',
  S4_GAP_BEAR_VOLUME: 'warning',
  S5_APP_PROXY: 'warning',
  S6_CRASH_5_VOLUME_2X: 'warning',
};

export const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/** 비트 인덱스 → severity 순위(작을수록 우선). 알 수 없는 비트는 info 취급. */
export function severityRankOfBit(b: number): number {
  const id = PHASE0_ALERT_IDS[b];
  const sev = id === undefined ? undefined : ALERT_SEVERITY[id];
  return SEVERITY_ORDER[sev ?? 'info'];
}

/** 그날 발동한 알림 후보 1건 = (보유 인덱스, 종목코드, 규칙 비트). */
export interface CapCandidate {
  /** 그룹 내 보유(포지션) 인덱스 */
  posIndex: number;
  code: string;
  /** PHASE0_ALERT_IDS의 비트 인덱스 */
  bit: number;
}

/**
 * 우선순위 정렬(비파괴). severity → 종목코드 → 비트 인덱스, 전부 오름차순.
 * 완전 결정론(동률 없음): 같은 (code, bit) 쌍은 하루에 두 번 생기지 않는다.
 */
export function prioritizeCandidates(cands: readonly CapCandidate[]): CapCandidate[] {
  return [...cands].sort((a, b) => {
    const sa = severityRankOfBit(a.bit);
    const sb = severityRankOfBit(b.bit);
    if (sa !== sb) return sa - sb;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.bit - b.bit;
  });
}

/** 하루 상한 적용. 상위 `budget`건만 실행, 나머지는 소멸(이월 없음). */
export function applyDailyCap(
  cands: readonly CapCandidate[],
  budget: number
): { executed: CapCandidate[]; dropped: CapCandidate[] } {
  const sorted = prioritizeCandidates(cands);
  const take = Math.max(0, Math.min(budget, sorted.length));
  return { executed: sorted.slice(0, take), dropped: sorted.slice(take) };
}

/** C_CAPPED 시뮬레이션에 들어가는 보유 1건. */
export interface CappedMember {
  code: string;
  s: AppIndicatorSeries;
  bars: SecurityBars;
  acute: Uint32Array;
  buyBar: number;
  windowEnd: number;
}

export interface CappedRunResult {
  /** members와 같은 순서의 포지션별 결과 */
  perPosition: Phase0PolicyResult[];
  /** 실제 실행된 매도(트리거 후 성과용) */
  sellLog: ExecutedSell[];
  /** 발동한 알림 후보 총계 */
  totalCandidates: number;
  /** 상한 안에서 실행된 알림 수 */
  executedCandidates: number;
  /** 상한 때문에 버려진 알림 수 */
  droppedCandidates: number;
  /** 캘린더 일수(= 하루 상한이 적용된 날 수) */
  calendarDays: number;
  /** 부실 시가(open ≤ 0)로 매도가 다음 봉으로 이월된 횟수 */
  deferredBadOpen: number;
}

/**
 * 포트폴리오 단위 C_CAPPED 시뮬레이션.
 *
 * 자본은 보유별로 독립(각 1.0)이고 **공유되는 것은 하루 알림 예산뿐**이다. 그래야
 * 포지션별 수익률이 HOLD/C/C′와 1:1 비교 가능하다(같은 포지션, 같은 창).
 *
 * 하루 처리 순서는 `simulateConfigPolicy`와 동일하다:
 *   ① 예약된 매도를 시가 체결 → ② 재매수 가능하면 시가 매수 → ③ 종가로 평가·MDD →
 *   ④ 보유 중이면 규칙 판정 → 전이 비트를 후보로 제출.
 * 하루의 모든 보유에서 후보를 모은 뒤 상한을 적용하고, 선택된 후보의 보유만 다음 봉 매도를 예약한다.
 *
 * `calendar`는 오름차순 날짜 배열이며 모든 member의 [buyBar..windowEnd] 날짜를 포함해야 한다.
 */
export function simulateCappedPortfolio(
  members: readonly CappedMember[],
  cfgMask: number,
  dailyBudget: number,
  reentryDelayDays: number,
  calendar: readonly string[]
): CappedRunResult {
  const bCost = buyCostFraction();
  const n = members.length;
  const cash = new Float64Array(n).fill(1);
  const shares = new Float64Array(n);
  const entryPrice = new Float64Array(n);
  const runningMax = new Float64Array(n);
  const pendingBuyBar = new Int32Array(n);
  const sellAtBar = new Int32Array(n).fill(-1);
  const prevMask = new Int32Array(n);
  const peak = new Float64Array(n);
  const mdd = new Float64Array(n);
  const equity = new Float64Array(n).fill(1);
  const sells = new Int32Array(n);
  const buys = new Int32Array(n);
  const costPaid = new Float64Array(n);
  for (let k = 0; k < n; k++) pendingBuyBar[k] = members[k].buyBar;

  const sellLog: ExecutedSell[] = [];
  let totalCandidates = 0;
  let executedCandidates = 0;
  let droppedCandidates = 0;
  let deferredBadOpen = 0;

  const barOfDay = new Int32Array(n);
  const cands: CapCandidate[] = [];

  for (let d = 0; d < calendar.length; d++) {
    const date = calendar[d];
    cands.length = 0;
    for (let k = 0; k < n; k++) {
      const m = members[k];
      const iRaw = m.bars.dateIndex.get(date);
      const i = iRaw === undefined ? -1 : iRaw;
      barOfDay[k] = i;
      if (i < m.buyBar || i > m.windowEnd) continue;

      // ① 예약 매도
      if (shares[k] > 0 && sellAtBar[k] === i) {
        const px = m.s.open[i];
        if (px > 0) {
          const sc = sellCostFraction(m.bars.dates[i]);
          const gross = shares[k] * px;
          cash[k] = gross * (1 - sc);
          costPaid[k] += gross * sc;
          shares[k] = 0;
          sells[k]++;
          sellAtBar[k] = -1;
          pendingBuyBar[k] = i + reentryDelayDays;
          sellLog.push({ code: m.code, sellBar: i, sellPrice: px });
        } else {
          // 부실 시가 — 다음 봉으로 이월(원본 sim은 null 반환이지만 여기서는 포지션 집합을
          // C/C′와 동일하게 유지해야 하므로 이월한다. 발생 횟수를 그대로 보고한다).
          deferredBadOpen++;
          sellAtBar[k] = i + 1;
        }
      }

      // ② 재매수
      if (shares[k] === 0 && i >= pendingBuyBar[k] && cash[k] > 0) {
        const px = m.s.open[i];
        if (px > 0) {
          const spend = cash[k] * (1 - bCost);
          costPaid[k] += cash[k] * bCost;
          shares[k] = spend / px;
          cash[k] = 0;
          entryPrice[k] = px;
          runningMax[k] = 0;
          buys[k]++;
        }
      }

      // ③ 평가
      const c = m.s.close[i];
      equity[k] = cash[k] + shares[k] * c;
      if (equity[k] > peak[k]) peak[k] = equity[k];
      if (peak[k] > 0) {
        const dd = 1 - equity[k] / peak[k];
        if (dd > mdd[k]) mdd[k] = dd;
      }

      // ④ 판정
      if (shares[k] === 0) {
        prevMask[k] = 0; // 현금 구간에는 알림이 없다 → 재매수 첫날 조건 충족은 신규 전이
        continue;
      }
      if (c > runningMax[k]) runningMax[k] = c;
      const flags = evaluateAppSellRules(m.s, i, {
        purchasePrice: entryPrice[k],
        highestPrice: appHighestPrice(m.s, i, entryPrice[k], runningMax[k]),
      });
      const cur = (appFlagsToMask(flags) | m.acute[i]) >>> 0;
      const tb = transitionBits(prevMask[k] >>> 0, cur, cfgMask);
      prevMask[k] = cur | 0;
      if (tb === 0) continue;
      if (sellAtBar[k] >= 0) continue; // 이미 매도 예약(시가 이월) → 예산 소모 없음
      if (i + 1 > m.windowEnd) continue; // 창 끝이라 매도 불가(원본 sim과 동일 조건)
      for (let b = 0; b < PHASE0_ALERT_IDS.length; b++) {
        if (tb & (1 << b)) cands.push({ posIndex: k, code: m.code, bit: b });
      }
    }

    if (cands.length === 0) continue;
    totalCandidates += cands.length;
    const { executed, dropped } = applyDailyCap(cands, dailyBudget);
    executedCandidates += executed.length;
    droppedCandidates += dropped.length;
    for (const cd of executed) {
      const k = cd.posIndex;
      if (sellAtBar[k] >= 0) continue;
      sellAtBar[k] = barOfDay[k] + 1;
    }
  }

  const perPosition: Phase0PolicyResult[] = [];
  for (let k = 0; k < n; k++) {
    perPosition.push({
      terminalReturn: equity[k] - 1,
      mdd: mdd[k],
      sells: sells[k],
      buys: buys[k],
      costPaid: costPaid[k],
    });
  }
  return {
    perPosition,
    sellLog,
    totalCandidates,
    executedCandidates,
    droppedCandidates,
    calendarDays: calendar.length,
    deferredBadOpen,
  };
}

/**
 * 코호트를 "동시보유 약 `targetHoldings`종목"짜리 합성 포트폴리오 G개로 쪼개는 계획.
 *
 * 왜 필요한가: 하루 3건 상한은 **60종목 포트폴리오**를 전제로 정해진 값이다(게이트 A와 동일 규모).
 * 코호트 전체(동시보유 수백 건)에 3건을 그대로 걸면 C_CAPPED가 사실상 HOLD가 되어
 * B′-3이 무력해진다 — C′-min에게 유리한 방향이므로 채택하지 않는다.
 *
 * 결정론: 종목코드 오름차순 정렬 후 라운드로빈(index % G). 난수 없음.
 * 같은 종목의 모든 포지션은 같은 그룹에 들어간다(종목당 지표 시계열을 1회만 만들기 위해서다).
 */
export function planCappedGroups(
  positions: readonly { code: string; buyBar: number; windowEnd: number }[],
  spanDays: number,
  targetHoldings: number
): { groupCount: number; avgConcurrency: number; groupOfCode: Map<string, number> } {
  let positionDays = 0;
  const codes = new Set<string>();
  for (const p of positions) {
    positionDays += p.windowEnd - p.buyBar + 1;
    codes.add(p.code);
  }
  const avgConcurrency = spanDays > 0 ? positionDays / spanDays : 0;
  const groupCount =
    targetHoldings > 0 ? Math.max(1, Math.round(avgConcurrency / targetHoldings)) : 1;
  const sorted = [...codes].sort();
  const groupOfCode = new Map<string, number>();
  for (let i = 0; i < sorted.length; i++) groupOfCode.set(sorted[i], i % groupCount);
  return { groupCount, avgConcurrency, groupOfCode };
}

/**
 * HOLD 경로(매도 없이 계속 보유)에서 구성별 **첫 발동 bar**를 구한다.
 * 오탐율·트리거 후 성과 표본 추출용(P4 scanHoldPath와 동일 취지).
 */
export function firstFireBarsOnHoldPath(
  s: AppIndicatorSeries,
  acuteMask: Uint32Array,
  pos: Phase0Position,
  cfgMasks: readonly number[]
): (number | null)[] {
  const out: (number | null)[] = cfgMasks.map(() => null);
  const buyPrice = s.open[pos.buyBar];
  if (!(buyPrice > 0)) return out;
  let runningMax = 0;
  for (let i = pos.buyBar; i <= pos.windowEnd; i++) {
    const c = s.close[i];
    if (c > runningMax) runningMax = c;
    const flags = evaluateAppSellRules(s, i, {
      purchasePrice: buyPrice,
      highestPrice: appHighestPrice(s, i, buyPrice, runningMax),
    });
    const m = (appFlagsToMask(flags) | acuteMask[i]) >>> 0;
    let remaining = false;
    for (let k = 0; k < cfgMasks.length; k++) {
      if (out[k] !== null) continue;
      if ((m & cfgMasks[k]) !== 0) out[k] = i;
      else remaining = true;
    }
    if (!remaining) break;
  }
  return out;
}

// ===========================================================================
// 요약 통계 (드라이버·테스트 공용)
// ===========================================================================

export interface DistSummary {
  n: number;
  mean: number;
  median: number;
  p90: number;
  max: number;
}

/** 정렬 후 선형보간 백분위(percentileSorted와 동일 규약을 쓰지 않고 자체 정의 — 골든 고정). */
export function percentileOf(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function summarizeDist(xs: readonly number[]): DistSummary {
  if (xs.length === 0) return { n: 0, mean: NaN, median: NaN, p90: NaN, max: NaN };
  const s = [...xs].sort((a, b) => a - b);
  let t = 0;
  for (const x of s) t += x;
  return {
    n: s.length,
    mean: t / s.length,
    median: percentileOf(s, 50),
    p90: percentileOf(s, 90),
    max: s[s.length - 1],
  };
}
