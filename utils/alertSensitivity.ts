// utils/alertSensitivity.ts
// ② 민감도 프리셋 (순수 함수) — 매수/매도를 분리해 둔감/기본/예민 3단계로 filterConfig 임계값을 일괄 조정.
// ---------------------------------------------------------------------------
// 설계:
//   · 프리셋 값은 각 규칙의 **공장 기본값(DEFAULT_ALERT_RULES)** × 단계 계수로 산출 → 절대적·멱등.
//     (현재값 기준이면 같은 단계를 두 번 누를 때마다 계속 변해 예측 불가 → 공장값 기준으로 고정.)
//   · '기본' 단계는 공장 기본값을 그대로 복사(라운딩 없이) → "기본 프리셋 적용 = 공장 filterConfig" 항상 성립.
//   · 비파괴: 조정 대상은 **임계값/카운트/윈도우/감지유지일** 숫자 키뿐. enabled·필터 목록·MA 기간(구조)·
//     클라이맥스 게이트 토글(양봉/수개월상승)·maxLookbackTradingDays는 **현재값 그대로 보존**(프리셋이 안 건드림).
//   · 한쪽 action을 바꿔도 다른 action 규칙은 불변(매도↔매수 독립).
// 발화 변경은 의도된 것 → tests/alertSensitivityParity.ts가 산출 filterConfig를 골든 절대값으로 고정.

import type { AlertRule } from '../types/alertRules';
import type { AlertRuleFilterConfig } from '../types/alertRules';
import type {
  SensitivityLevel, SensitivityAction, SensitivityActionPlan,
} from '../types/alertSensitivity';
import { SENSITIVITY_ORDER } from '../types/alertSensitivity';
import { DEFAULT_ALERT_RULES } from '../constants/alertRules';

/** 조정 가능한 숫자 키 = AlertRuleFilterConfig의 숫자형 임계값 중 "민감도"에 해당하는 것만. */
type AdjustableKey = Extract<keyof AlertRuleFilterConfig,
  | 'lossThreshold' | 'dropFromHighThreshold' | 'profitTargetThreshold' | 'dailyCrashThreshold'
  | 'climaxFlagsRequired' | 'climaxSlopeMultiplier' | 'climaxAtrMultiple'
  | 'distributionVolumeRatio' | 'distributionThreshold' | 'distributionWindow' | 'withinDays'>;

interface AdjustSpec {
  /** sensitive/insensitive 단계에서 공장 기본값에 곱할 계수(방향 내장: 예민이 더 자주 발화하도록). */
  sensitive: number;
  insensitive: number;
  round: 'int' | 'tenth';
  /** UI input min/max와 일치 — 산출값을 항상 유효 범위로 클램프. */
  min: number;
  max: number;
}

/**
 * 단계별 계수표. 대부분은 "값이 작을수록 더 자주 발화"(임계값↓) → sensitive<1, insensitive>1.
 * distributionWindow/withinDays는 "값이 클수록 더 자주 발화"(윈도우·감지유지 확대) → sensitive>1, insensitive<1.
 * 구조형 키(maShortPeriod/maLongPeriod/maCrossPeriod)·게이트 토글·maxLookbackTradingDays는 표에 없음 → 미조정.
 */
const ADJUST_TABLE: Record<AdjustableKey, AdjustSpec> = {
  // ── 값이 작을수록 예민 ──
  lossThreshold:           { sensitive: 0.6, insensitive: 1.6, round: 'int',   min: 1, max: 50 },
  dropFromHighThreshold:   { sensitive: 0.6, insensitive: 1.6, round: 'int',   min: 1, max: 90 },
  profitTargetThreshold:   { sensitive: 0.6, insensitive: 1.6, round: 'int',   min: 1, max: 200 },
  dailyCrashThreshold:     { sensitive: 0.6, insensitive: 1.6, round: 'int',   min: 1, max: 50 },
  climaxFlagsRequired:     { sensitive: 0.5, insensitive: 1.5, round: 'int',   min: 1, max: 3 },
  climaxSlopeMultiplier:   { sensitive: 0.6, insensitive: 1.6, round: 'tenth', min: 1, max: 10 },
  climaxAtrMultiple:       { sensitive: 0.6, insensitive: 1.6, round: 'tenth', min: 1, max: 5 },
  distributionVolumeRatio: { sensitive: 0.8, insensitive: 1.4, round: 'tenth', min: 1, max: 3 },
  distributionThreshold:   { sensitive: 0.6, insensitive: 1.6, round: 'int',   min: 1, max: 15 },
  // ── 값이 클수록 예민 ──
  distributionWindow:      { sensitive: 1.4, insensitive: 0.7, round: 'int',   min: 5, max: 30 },
  withinDays:              { sensitive: 1.6, insensitive: 0.6, round: 'int',   min: 1, max: 30 },
};

const ADJUSTABLE_KEYS = Object.keys(ADJUST_TABLE) as AdjustableKey[];

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** 공장 기본값(base)을 단계로 변환. 'default'는 base 그대로(멱등·골든 정합). */
function adjustValue(base: number, level: SensitivityLevel, spec: AdjustSpec): number {
  if (level === 'default') return base;
  const factor = level === 'sensitive' ? spec.sensitive : spec.insensitive;
  const raw = base * factor;
  const rounded = spec.round === 'tenth' ? Math.round(raw * 10) / 10 : Math.round(raw);
  return clamp(rounded, spec.min, spec.max);
}

/** id별 공장 기본 filterConfig 조회(프리셋 base). */
const DEFAULT_CONFIG_BY_ID: Map<string, AlertRuleFilterConfig> = new Map(
  DEFAULT_ALERT_RULES.map(r => [r.id, r.filterConfig]),
);

/**
 * 한 action(sell|buy) 규칙들의 조정 가능 임계값을 단계에 맞춰 일괄 변경한 새 규칙 배열을 반환.
 * - 다른 action 규칙은 참조 동일(불변).
 * - 각 규칙은 새 객체로 복제하되 enabled·filters·name 등은 보존, filterConfig의 조정 키만 갱신.
 * - base는 공장 기본값(공장에 없는 규칙이면 현재값을 base로 폴백 — 멱등성은 공장 규칙에만 보장).
 */
export function applySensitivityPreset(
  rules: AlertRule[],
  action: SensitivityAction,
  level: SensitivityLevel,
): AlertRule[] {
  return rules.map(rule => {
    if (rule.action !== action) return rule;
    const factoryConfig = DEFAULT_CONFIG_BY_ID.get(rule.id);
    const nextConfig: AlertRuleFilterConfig = { ...rule.filterConfig };
    for (const key of ADJUSTABLE_KEYS) {
      // 규칙이 실제로 그 임계값을 쓰는 경우에만 조정(없던 키를 새로 만들지 않음).
      if (rule.filterConfig[key] === undefined) continue;
      const base = factoryConfig?.[key] ?? rule.filterConfig[key]!;
      nextConfig[key] = adjustValue(base, level, ADJUST_TABLE[key]);
    }
    return { ...rule, filterConfig: nextConfig };
  });
}

/** 한 action 규칙들의 조정 가능 키 값만 추출한 안정 스냅샷(단계 감지용 비교 키). */
function transformableSnapshot(rules: AlertRule[], action: SensitivityAction): string {
  const entries: Array<[string, Array<[string, number]>]> = [];
  for (const rule of rules) {
    if (rule.action !== action) continue;
    const keyVals: Array<[string, number]> = [];
    for (const key of ADJUSTABLE_KEYS) {
      const v = rule.filterConfig[key];
      if (v !== undefined) keyVals.push([key, v]);
    }
    if (keyVals.length > 0) entries.push([rule.id, keyVals]);
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify(entries);
}

/**
 * 현재 규칙들이 어느 단계 프리셋과 일치하는지 감지. 어떤 단계와도 안 맞으면 null('사용자 지정').
 * 공장 기본값 기준 프리셋 산출물과 조정 키 스냅샷이 정확히 같아야 그 단계로 판정.
 */
export function detectSensitivityLevel(
  rules: AlertRule[],
  action: SensitivityAction,
): SensitivityLevel | null {
  const current = transformableSnapshot(rules, action);
  for (const level of SENSITIVITY_ORDER) {
    const candidate = transformableSnapshot(
      applySensitivityPreset(DEFAULT_ALERT_RULES, action, level),
      action,
    );
    if (candidate === current) return level;
  }
  return null;
}

// ── '지금 할 행동' 초보자 포맷 (결론→이유→행동→무효→데이터 신뢰도) ──
// 매수/매도 × 둔감/기본/예민 = 9개 조합. 순수 데이터 반환(렌더는 컴포넌트).

const DATA_TRUST_SELL =
  '과열·매물 경고는 OHLC(고가·저가·시가) 데이터가 필요합니다. 데이터를 못 받는 종목은 해당 경고가 제한적으로만 작동합니다.';
const DATA_TRUST_BUY =
  '매수 규칙은 주로 RSI·이동평균 구조를 보므로 OHLC 의존도가 낮습니다. 다만 신호는 예측이 아닌 참고 후보입니다.';

const SELL_PLANS: Record<SensitivityLevel, SensitivityActionPlan> = {
  sensitive: {
    conclusion: '매도 경고를 예민하게 — 작은 위험에도 빨리 알립니다.',
    reason: '손실률·고점대비 하락·당일 급락·과열(클라이맥스)·매물(디스트리뷰션) 임계값을 모두 낮추고, 이벤트 감지 유지 기간을 늘렸습니다.',
    action: '경고가 더 자주, 더 일찍 뜹니다. 분할매도·비중조절의 참고로만 사용하세요(전량매도 신호 아님).',
    invalidation: '경고가 너무 잦아 피로하면 ‘기본’ 또는 ‘둔감’으로 낮추세요.',
    dataTrust: DATA_TRUST_SELL,
  },
  default: {
    conclusion: '기본 민감도 — 앱 표준의 균형 잡힌 경고입니다.',
    reason: '모든 매도 규칙의 임계값을 앱 공장 기본값으로 되돌립니다(켜짐/꺼짐과 고급 옵션은 그대로 유지).',
    action: '과도하지도 둔하지도 않은 표준 경고를 받습니다.',
    invalidation: '더 빨리 받고 싶으면 ‘예민’, 큰 신호만 보고 싶으면 ‘둔감’으로 바꾸세요.',
    dataTrust: DATA_TRUST_SELL,
  },
  insensitive: {
    conclusion: '둔감하게 — 확실한 큰 위험만 경고합니다.',
    reason: '손실률·하락폭·과열/매물 임계값을 높이고 감지 유지 기간을 줄여 강한 신호만 남겼습니다.',
    action: '경고 빈도가 줄고, 작은 흔들림은 무시합니다. 확신도 높은 신호 위주로만 뜹니다.',
    invalidation: '중요한 하락을 놓치는 느낌이면 ‘기본’으로 올리세요.',
    dataTrust: DATA_TRUST_SELL,
  },
};

const BUY_PLANS: Record<SensitivityLevel, SensitivityActionPlan> = {
  sensitive: {
    conclusion: '매수 기회를 예민하게 — 더 많은 후보를 포착합니다.',
    reason: '눌림목·반등·추세전환 등 이벤트 신호의 감지 유지 기간을 늘려, 며칠 지난 신호도 더 오래 표시합니다.',
    action: '매수 후보가 더 많이 뜹니다. 추격매수는 금물 — 분할·계획 매수의 참고로만 보세요.',
    invalidation: '후보가 너무 많아 산만하면 ‘기본’ 또는 ‘둔감’으로 낮추세요.',
    dataTrust: DATA_TRUST_BUY,
  },
  default: {
    conclusion: '기본 민감도 — 앱 표준의 매수 기회 감지입니다.',
    reason: '매수 규칙의 감지 유지 기간을 공장 기본값으로 되돌립니다(켜짐/꺼짐과 이동평균 설정은 그대로 유지).',
    action: '표준 기준으로 매수 후보를 받습니다.',
    invalidation: '더 많이 보려면 ‘예민’, 확실한 신호만 보려면 ‘둔감’으로 바꾸세요.',
    dataTrust: DATA_TRUST_BUY,
  },
  insensitive: {
    conclusion: '둔감하게 — 갓 발생한 신선한 매수 신호만 봅니다.',
    reason: '이벤트 감지 유지 기간을 줄여, 발생 직후의 신호만 후보로 남깁니다.',
    action: '매수 후보 수가 줄고, 타이밍이 명확한 신호 위주로 뜹니다.',
    invalidation: '기회를 놓치는 느낌이면 ‘기본’으로 올리세요.',
    dataTrust: DATA_TRUST_BUY,
  },
};

/** (action, level)에 대한 초보자용 '지금 할 행동' 설명. 순수 — 동일 입력 동일 출력. */
export function describeSensitivityPlan(
  action: SensitivityAction,
  level: SensitivityLevel,
): SensitivityActionPlan {
  return (action === 'sell' ? SELL_PLANS : BUY_PLANS)[level];
}
