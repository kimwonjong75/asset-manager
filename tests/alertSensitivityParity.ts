// tests/alertSensitivityParity.ts
// ---------------------------------------------------------------------------
// ② 민감도 프리셋 골든 테스트 — "프리셋 적용 = 특정 filterConfig 산출"을 절대값으로 고정.
//   · 기본 프리셋 = 공장 기본값 완전 동일(비파괴 항등).
//   · 예민/둔감 = 골든 절대값 핀(임계값 변경은 의도된 발화 변경 → 회귀로 박제).
//   · 비파괴: action 격리 / enabled·MA구조·게이트토글·maxLookback 보존 / 멱등 / 클램프.
//   · detectSensitivityLevel 라운드트립 + 사용자 지정 null.
// 수동 실행: npm run test:sensitivity (tsx). 통과 시 exit 0.

import {
  applySensitivityPreset, detectSensitivityLevel, describeSensitivityPlan,
} from '../utils/alertSensitivity';
import { DEFAULT_ALERT_RULES } from '../constants/alertRules';
import { SENSITIVITY_ORDER } from '../types/alertSensitivity';
import type { AlertRule, AlertRuleFilterConfig } from '../types/alertRules';
import type { SensitivityAction } from '../types/alertSensitivity';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

const ruleOf = (rules: AlertRule[], id: string): AlertRule =>
  rules.find(r => r.id === id) as AlertRule;
const cfgOf = (rules: AlertRule[], id: string): AlertRuleFilterConfig => ruleOf(rules, id).filterConfig;
const onlyAction = (rules: AlertRule[], action: SensitivityAction): AlertRule[] =>
  rules.filter(r => r.action === action);

const sellDefault = applySensitivityPreset(DEFAULT_ALERT_RULES, 'sell', 'default');
const buyDefault = applySensitivityPreset(DEFAULT_ALERT_RULES, 'buy', 'default');
const sellSens = applySensitivityPreset(DEFAULT_ALERT_RULES, 'sell', 'sensitive');
const sellInsens = applySensitivityPreset(DEFAULT_ALERT_RULES, 'sell', 'insensitive');
const buySens = applySensitivityPreset(DEFAULT_ALERT_RULES, 'buy', 'sensitive');
const buyInsens = applySensitivityPreset(DEFAULT_ALERT_RULES, 'buy', 'insensitive');

// ════════════════════════════════════════════════════════════════════════════
// 1. 기본 프리셋 = 공장 기본값 완전 동일 (비파괴 항등)
// ════════════════════════════════════════════════════════════════════════════
check('기본(sell) 프리셋 = 공장 전체 동일', JSON.stringify(sellDefault), JSON.stringify(DEFAULT_ALERT_RULES));
check('기본(buy) 프리셋 = 공장 전체 동일', JSON.stringify(buyDefault), JSON.stringify(DEFAULT_ALERT_RULES));

// ════════════════════════════════════════════════════════════════════════════
// 2. 골든 절대값 핀 — 예민/둔감
// ════════════════════════════════════════════════════════════════════════════
// 매도
check('stop-loss 예민 loss', cfgOf(sellSens, 'stop-loss').lossThreshold, 3);
check('stop-loss 둔감 loss', cfgOf(sellInsens, 'stop-loss').lossThreshold, 8);
check('long-decline 예민 drop', cfgOf(sellSens, 'long-decline').dropFromHighThreshold, 12);
check('long-decline 둔감 drop', cfgOf(sellInsens, 'long-decline').dropFromHighThreshold, 32);
check('profit-target 예민', cfgOf(sellSens, 'profit-target').profitTargetThreshold, 12);
check('profit-target 둔감', cfgOf(sellInsens, 'profit-target').profitTargetThreshold, 32);
check('overheat-profit 예민 [목표,유지]', [cfgOf(sellSens, 'overheat-profit').profitTargetThreshold, cfgOf(sellSens, 'overheat-profit').withinDays], [9, 5]);
check('overheat-profit 둔감 [목표,유지]', [cfgOf(sellInsens, 'overheat-profit').profitTargetThreshold, cfgOf(sellInsens, 'overheat-profit').withinDays], [24, 2]);
check('daily-crash 예민', cfgOf(sellSens, 'daily-crash').dailyCrashThreshold, 3);
check('daily-crash 둔감', cfgOf(sellInsens, 'daily-crash').dailyCrashThreshold, 8);
check('climax 예민 [플래그,기울기,ATR]', [cfgOf(sellSens, 'climax-top').climaxFlagsRequired, cfgOf(sellSens, 'climax-top').climaxSlopeMultiplier, cfgOf(sellSens, 'climax-top').climaxAtrMultiple], [1, 1.5, 1.5]);
check('climax 둔감 [플래그,기울기,ATR]', [cfgOf(sellInsens, 'climax-top').climaxFlagsRequired, cfgOf(sellInsens, 'climax-top').climaxSlopeMultiplier, cfgOf(sellInsens, 'climax-top').climaxAtrMultiple], [3, 4, 4]);
check('distribution 예민 [윈도,거래량,누적]', [cfgOf(sellSens, 'distribution-high').distributionWindow, cfgOf(sellSens, 'distribution-high').distributionVolumeRatio, cfgOf(sellSens, 'distribution-high').distributionThreshold], [18, 1.2, 3]);
check('distribution 둔감 [윈도,거래량,누적]', [cfgOf(sellInsens, 'distribution-high').distributionWindow, cfgOf(sellInsens, 'distribution-high').distributionVolumeRatio, cfgOf(sellInsens, 'distribution-high').distributionThreshold], [9, 2.1, 8]);
check('weinstein-150 예민 withinDays', cfgOf(sellSens, 'weinstein-150-break').withinDays, 8);
check('weinstein-150 둔감 withinDays', cfgOf(sellInsens, 'weinstein-150-break').withinDays, 3);
check('ma120-break 예민 withinDays', cfgOf(sellSens, 'ma120-break').withinDays, 8);
// 매수 (조정 가능 키 = withinDays)
check('buy bottom-bounce 예민', cfgOf(buySens, 'bottom-bounce').withinDays, 5);
check('buy bottom-bounce 둔감', cfgOf(buyInsens, 'bottom-bounce').withinDays, 2);
check('buy crash-bounce 예민', cfgOf(buySens, 'crash-bounce').withinDays, 5);
check('buy trend-reversal 예민', cfgOf(buySens, 'trend-reversal-buy').withinDays, 8);
check('buy trend-reversal 둔감', cfgOf(buyInsens, 'trend-reversal-buy').withinDays, 3);

// ════════════════════════════════════════════════════════════════════════════
// 3. 비파괴: action 격리 — 한쪽을 바꿔도 다른 쪽은 공장 그대로
// ════════════════════════════════════════════════════════════════════════════
check('예민(sell) → 매수 규칙 불변', JSON.stringify(onlyAction(sellSens, 'buy')), JSON.stringify(onlyAction(DEFAULT_ALERT_RULES, 'buy')));
check('예민(buy) → 매도 규칙 불변', JSON.stringify(onlyAction(buySens, 'sell')), JSON.stringify(onlyAction(DEFAULT_ALERT_RULES, 'sell')));

// ════════════════════════════════════════════════════════════════════════════
// 4. 비파괴: enabled · MA구조 · 게이트 토글 · maxLookback 보존 + 절대값(공장 기준)
// ════════════════════════════════════════════════════════════════════════════
const custom: AlertRule[] = DEFAULT_ALERT_RULES.map(r => {
  if (r.id === 'climax-top') return { ...r, enabled: false, filterConfig: { ...r.filterConfig, climaxRequireBullishCandle: false } };
  if (r.id === 'stop-loss') return { ...r, filterConfig: { ...r.filterConfig, lossThreshold: 99 } };
  if (r.id === 'dead-cross') return { ...r, filterConfig: { ...r.filterConfig, maShortPeriod: 10, maxLookbackTradingDays: 66 } };
  return r;
});
const customOut = applySensitivityPreset(custom, 'sell', 'sensitive');
check('보존: enabled(off) 유지', ruleOf(customOut, 'climax-top').enabled, false);
check('보존: 게이트 토글(양봉) 유지', cfgOf(customOut, 'climax-top').climaxRequireBullishCandle, false);
check('보존: MA 기간(구조) 유지', cfgOf(customOut, 'dead-cross').maShortPeriod, 10);
check('보존: maxLookback 유지', cfgOf(customOut, 'dead-cross').maxLookbackTradingDays, 66);
check('절대값: 커스텀 loss 99 → 예민은 공장(5) 기준 3', cfgOf(customOut, 'stop-loss').lossThreshold, 3);
// 게이트 토글이 켜져 있어도 프리셋이 끄지 않음(공장은 true)
check('보존: 공장 게이트 토글(수개월상승) 유지', cfgOf(sellSens, 'climax-top').climaxRequireLongTrendUp, true);

// ════════════════════════════════════════════════════════════════════════════
// 5. 멱등성 — 같은 단계를 두 번 적용해도 한 번과 동일
// ════════════════════════════════════════════════════════════════════════════
check('멱등: 예민(sell) 두 번 = 한 번', JSON.stringify(applySensitivityPreset(sellSens, 'sell', 'sensitive')), JSON.stringify(sellSens));
check('멱등: 둔감(buy) 두 번 = 한 번', JSON.stringify(applySensitivityPreset(buyInsens, 'buy', 'insensitive')), JSON.stringify(buyInsens));

// ════════════════════════════════════════════════════════════════════════════
// 6. 클램프 — 산출값이 UI 유효 범위(table min/max) 안
// ════════════════════════════════════════════════════════════════════════════
check('클램프: climaxFlagsRequired ∈ [1,3] (예민=1)', cfgOf(sellSens, 'climax-top').climaxFlagsRequired, 1);
check('클램프: climaxFlagsRequired ∈ [1,3] (둔감=3)', cfgOf(sellInsens, 'climax-top').climaxFlagsRequired, 3);
check('클램프: distributionVolumeRatio ≥ 1 (예민=1.2)', cfgOf(sellSens, 'distribution-high').distributionVolumeRatio! >= 1, true);
check('클램프: distributionVolumeRatio ≤ 3 (둔감=2.1)', cfgOf(sellInsens, 'distribution-high').distributionVolumeRatio! <= 3, true);

// ════════════════════════════════════════════════════════════════════════════
// 7. detectSensitivityLevel — 라운드트립 + 공장=default + 사용자 지정=null
// ════════════════════════════════════════════════════════════════════════════
check('detect 공장 = default(sell)', detectSensitivityLevel(DEFAULT_ALERT_RULES, 'sell'), 'default');
check('detect 공장 = default(buy)', detectSensitivityLevel(DEFAULT_ALERT_RULES, 'buy'), 'default');
for (const level of SENSITIVITY_ORDER) {
  check(`detect 라운드트립 sell/${level}`, detectSensitivityLevel(applySensitivityPreset(DEFAULT_ALERT_RULES, 'sell', level), 'sell'), level);
  check(`detect 라운드트립 buy/${level}`, detectSensitivityLevel(applySensitivityPreset(DEFAULT_ALERT_RULES, 'buy', level), 'buy'), level);
}
const customLoss4: AlertRule[] = DEFAULT_ALERT_RULES.map(r =>
  r.id === 'stop-loss' ? { ...r, filterConfig: { ...r.filterConfig, lossThreshold: 4 } } : r);
check('detect 사용자 지정(loss=4) = null', detectSensitivityLevel(customLoss4, 'sell'), null);
// 직교: 매수 프리셋을 바꿔도 매도 감지에 영향 없음
check('detect sell은 buy 프리셋과 무관', detectSensitivityLevel(applySensitivityPreset(DEFAULT_ALERT_RULES, 'buy', 'sensitive'), 'sell'), 'default');

// ════════════════════════════════════════════════════════════════════════════
// 8. describeSensitivityPlan — 9조합 필드 채움 + 매도/매수 구분
// ════════════════════════════════════════════════════════════════════════════
let planMiss = 0;
for (const action of ['sell', 'buy'] as SensitivityAction[]) {
  for (const level of SENSITIVITY_ORDER) {
    const p = describeSensitivityPlan(action, level);
    const allFilled = [p.conclusion, p.reason, p.action, p.invalidation, p.dataTrust].every(s => typeof s === 'string' && s.length > 0);
    if (!allFilled) { planMiss++; fails.push(`✗ plan[${action}/${level}] 필드 비어있음`); }
  }
}
check('plan 9조합 전부 필드 채움', planMiss, 0);
check('plan dataTrust 매도≠매수', describeSensitivityPlan('sell', 'default').dataTrust === describeSensitivityPlan('buy', 'default').dataTrust, false);

// ════════════════════════════════════════════════════════════════════════════
// 9. 조정 불가 규칙(임계값 없음/MA만) — filterConfig 불변
// ════════════════════════════════════════════════════════════════════════════
check('overheat-drop(빈 config) 불변', JSON.stringify(cfgOf(sellSens, 'overheat-drop')), JSON.stringify({}));
check('swing-low-break(빈 config) 불변', JSON.stringify(cfgOf(sellSens, 'swing-low-break')), JSON.stringify({}));
check('trend-break(MA만) 불변', JSON.stringify(cfgOf(sellSens, 'trend-break')), JSON.stringify({ maShortPeriod: 20 }));
check('weinstein maCrossPeriod(구조) 불변', cfgOf(sellSens, 'weinstein-150-break').maCrossPeriod, 150);

console.log(`\nalert sensitivity: ${pass} passed, ${fails.length} failed`);
if (fails.length > 0) {
  for (const f of fails) console.log(f);
  process.exitCode = 1;
} else {
  console.log('✓ 기본=공장 항등 + 골든 절대값(예민/둔감) + action격리/enabled·MA·게이트·lookback 보존 + 멱등 + 클램프 + detect 라운드트립 + plan 9조합');
}
