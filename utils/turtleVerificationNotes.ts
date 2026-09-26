// utils/turtleVerificationNotes.ts
// ---------------------------------------------------------------------------
// P3(2026-09-26) — 설정 '터틀 규칙' 섹션 전용 순수 모듈(계획서 §4.7·§6 P3).
//
// 두 가지를 담당한다:
//   1. 원조/조정 배지 — §3.1 표의 "원조 그대로 / 조정" 열을 그대로 코드화한다.
//   2. 검증 안내 문구 — 값을 바꿨을 때 보여줄 과거 검증 성적 한 줄. 전부 명시적 절대값 상수 표이며,
//      출처는 `docs/backtest/REPORT_보유종목_터틀사이클_260925.md`(1차, 10일 청산)와
//      `docs/backtest/REPORT_2차_포트폴리오_터틀_260925.md`(2차, 나머지 전부 — Advisor 강건성 점검 절 +
//      "불타기 방식 비교(루카스 2R vs 터틀 ½N)" 후속 절)이다. 숫자를 고칠 때는 반드시 그 문서를
//      다시 확인할 것 — 이 파일이 숫자의 원본이 아니라 인용처다.
//
// 순수 함수만 — side effect·console·any 금지. 이 화면 전용이라 다른 모듈이 import할 이유는 없다.

import { TurtleHoldingsSettings, HoldingsExitMethod, PyramidSpacingMode } from '../types/turtleHoldings';

// ── 1. 원조/조정 배지 ────────────────────────────────────────────────────────

export type TurtleFieldBadge = '원조' | '조정';

/** §3.1 표의 "원조" 참조값 — DEFAULT_TURTLE_HOLDINGS_SETTINGS와 다르다(기본값 자체가 조정을 포함하므로). */
const ORIGINAL_REFERENCE = {
  entryLookback: 55,
  exitLookback: 20, // exitMethod==='donchian' 일 때만 의미 있음
  stopMultipleN: 2,
  riskPerUnitPct: 1,
  maxUnitsPerPosition: 4,
  pyramidSpacing: 'halfN' as PyramidSpacingMode,
  maxTotalRiskPct: 24,
  drawdownScalingEnabled: true,
} as const;

/** 원조에 없어 항상 "조정"인 필드(포지션 한도는 §3.1 "필수 조정" 명시, 나머지는 원조가 값 자체를 안 가짐). */
const ALWAYS_ADJUSTED_FIELDS: ReadonlySet<string> = new Set([
  'positionCapPct', 'minOrderKRW', 'pyramidSizeMultiplier', 'maPeriod', 'atrTrailMultiple', 'pyramidCustomN',
]);

/** 청산 방식 배지 — 도치안 20일만 원조, 그 외(도치안 비20일 포함)는 조정. */
export function exitMethodBadge(exitMethod: HoldingsExitMethod, exitLookback: number): TurtleFieldBadge {
  if (exitMethod !== 'donchian') return '조정';
  return exitLookback === ORIGINAL_REFERENCE.exitLookback ? '원조' : '조정';
}

/** 불타기 간격 배지 — ½N(halfN)이 원조, 강의식 2R·직접입력은 조정. */
export function pyramidSpacingBadge(mode: PyramidSpacingMode): TurtleFieldBadge {
  return mode === ORIGINAL_REFERENCE.pyramidSpacing ? '원조' : '조정';
}

/** 나머지 단순 숫자·불리언 필드 배지(원조 참조값과 단순 비교). */
export function turtleFieldBadge(
  field: keyof typeof ORIGINAL_REFERENCE | 'positionCapPct' | 'minOrderKRW' | 'pyramidSizeMultiplier' | 'maPeriod' | 'atrTrailMultiple' | 'pyramidCustomN',
  value: number | boolean,
): TurtleFieldBadge {
  if (ALWAYS_ADJUSTED_FIELDS.has(field)) return '조정';
  const ref = (ORIGINAL_REFERENCE as Record<string, unknown>)[field];
  return ref === value ? '원조' : '조정';
}

// ── 2. 청산 일수 경고(§3.1 "청산 10일 미만/너무 짧은 값 경고") ──────────────────

/**
 * 도치안 청산 일수 경고 — 10일 미만은 `resolveHoldingsSettings`가 저장 자체를 10일로 잘라내므로
 * ("저장 차단") 이 문구는 사용자가 그보다 짧게 **입력하려는 시도**에 즉시 보여줄 경고다.
 * 10~19일은 저장은 허용하되 "아직 검증되지 않음" 주의만 준다(1차 검증은 10일까지만 확인).
 */
export function describeExitLookbackWarning(days: number): string | null {
  if (days < 10) {
    return '10일 미만은 저장할 수 없습니다 — 1차 검증에서 10일 청산이 20일·55일보다 매매·수익·방어 전부 열세였습니다.';
  }
  if (days < 20) {
    return '10~19일은 아직 이 종목군으로 따로 검증되지 않았습니다.';
  }
  return null;
}

// ── 3. 검증 안내 문구(값 변경 시 한 줄 — §4.7) ───────────────────────────────

export type TurtleVerificationKey =
  | 'exit-donchian-10'
  | 'exit-donchian-20'
  | 'exit-donchian-55'
  | 'exit-ma-50'
  | 'exit-atr-trail'
  | 'pyramid-2r'
  | 'pyramid-half-n'
  | 'pyramid-custom'
  | 'cap-5'
  | 'cap-10'
  | 'cap-15'
  | 'total-risk-12'
  | 'total-risk-24'
  | 'drawdown-on'
  | 'drawdown-off'
  | 'core-excl-on'
  | 'core-excl-off';

/**
 * 검증 안내 문구 골든 표. 값은 전부 근거 문서의 절대 수치를 그대로 인용한다(요약·반올림 없음 —
 * 1차/2차 검증의 '최종가치비율'·'최대 하락폭(MDD)'·'Calmar' 원문 표기를 그대로 옮긴다).
 */
export const TURTLE_VERIFICATION_NOTES: Record<TurtleVerificationKey, string> = {
  'exit-donchian-10':
    '검증: 10일 최저는 매매가 20일 대비 약 2배 늘고, 수익·방어 양쪽 다 열세였습니다' +
    '(1차 검증, 최종가치비율 0.816 vs 20일 0.906, 최대 하락폭 34.6% vs 28.0%).',
  'exit-donchian-20':
    '검증: 원조 기본값(2차 검증 기준 최종가치비율 0.713, 최대 하락폭 20.2%).',
  'exit-donchian-55':
    '검증: 매매가 줄고 최종가치가 다소 개선되지만(0.869 vs 20일 0.713), 방어는 20일보다 약간 열세합니다' +
    '(최대 하락폭 26.9% vs 20.2%, 2차 검증).',
  'exit-ma-50':
    '검증: 최대 하락폭 약 19%, 20일 최저 대비 수익·방어 우세(2차 검증, 최종가치비율 0.850 vs 0.713).',
  'exit-atr-trail':
    '검증: 매매 빈도가 가장 많고 최종가치가 가장 낮았습니다(2차 검증, 최종가치비율 0.618) — ' +
    '최대 하락폭 자체는 17.8%로 가장 낮지만, 그만큼 자주 팔고 다시 사서 수익이 깎였습니다.',
  'pyramid-2r':
    '검증: 강의식 2R 기본값 — ½N보다 최대 하락폭이 작습니다(약 15% vs 20%, 2차 검증 후속 "불타기 방식 비교"). ' +
    '대신 수익은 약 1.6%p 낮아집니다.',
  'pyramid-half-n':
    '검증: 2R보다 하락폭이 큽니다(약 20% vs 15%, 2차 검증 후속 "불타기 방식 비교").',
  'pyramid-custom':
    '이 간격은 별도로 검증되지 않았습니다(2R·½N만 2차 검증 후속에서 비교했습니다).',
  'cap-5':
    '검증: 최대 하락폭이 크게 줄지만(약 12.4%) 현금이 많이 남아 수익도 줄어듭니다' +
    '(2차 검증, 평균 현금 비율 약 23~51%).',
  'cap-10':
    '검증: 기본값. 최대 하락폭 약 20.2%, 최종가치비율 0.713(2차 검증).',
  'cap-15':
    '검증: 수익이 소폭 늘지만(최종가치비율 0.724) 방어는 다소 약해집니다(최대 하락폭 23.5%, 2차 검증).',
  'total-risk-12':
    '검증: 24%와 12% 사이에 실질적인 수치 차이가 없었습니다 — 종목 한도가 이미 실질 상한 역할을 합니다(2차 검증).',
  'total-risk-24':
    '검증: 원조 값(한 방향 12유닛). 12%로 낮춰도 결과 차이가 없었습니다(2차 검증).',
  'drawdown-on':
    '검증: 이번 표본에서 뚜렷한 이득이 없었습니다(2차 검증, 최종가치비율 0.695·최대 하락폭 20.3% — ' +
    '꺼짐(0.713·20.2%)과 거의 같거나 더 나쁩니다). 꺼짐을 권장합니다.',
  'drawdown-off':
    '검증: 기본값(꺼짐). 켜도 이번 표본에서는 이득이 뚜렷하지 않았습니다(2차 검증).',
  'core-excl-on':
    '검증: 코어 자산(금·은·채권·지수 ETF) 제외 시 방어·위험조정수익이 개선됩니다' +
    '(2차 검증, 최대 하락폭 18.3% vs 전 종목 20.2%, Calmar 0.77 vs 0.60).',
  'core-excl-off':
    '검증: 전 종목 적용은 코어 제외보다 위험조정수익이 다소 낮습니다(Calmar 0.60 vs 0.77, 2차 검증) — ' +
    '필요하면 자산군별 제외로 바꿀 수 있습니다.',
};

export function getTurtleVerificationNote(key: TurtleVerificationKey): string {
  return TURTLE_VERIFICATION_NOTES[key];
}

/** 현재 청산 설정에 맞는 검증 키 — donchian은 일수별로 갈린다(10/20/55 외 값은 가장 가까운 근거만 표기). */
export function resolveExitVerificationKey(exitMethod: HoldingsExitMethod, exitLookback: number): TurtleVerificationKey {
  if (exitMethod === 'ma') return 'exit-ma-50';
  if (exitMethod === 'atrTrail') return 'exit-atr-trail';
  if (exitLookback <= 10) return 'exit-donchian-10';
  if (exitLookback >= 55) return 'exit-donchian-55';
  return 'exit-donchian-20';
}

export function resolvePyramidVerificationKey(mode: PyramidSpacingMode): TurtleVerificationKey {
  if (mode === '2R') return 'pyramid-2r';
  if (mode === 'halfN') return 'pyramid-half-n';
  return 'pyramid-custom';
}

export function resolveCapVerificationKey(positionCapPct: number): TurtleVerificationKey {
  if (positionCapPct <= 5) return 'cap-5';
  if (positionCapPct >= 15) return 'cap-15';
  return 'cap-10';
}

export function resolveTotalRiskVerificationKey(maxTotalRiskPct: number): TurtleVerificationKey {
  return maxTotalRiskPct <= 12 ? 'total-risk-12' : 'total-risk-24';
}

export function resolveDrawdownVerificationKey(enabled: boolean): TurtleVerificationKey {
  return enabled ? 'drawdown-on' : 'drawdown-off';
}

export function resolveCoreExclVerificationKey(excludedCategoryIds: readonly number[]): TurtleVerificationKey {
  return excludedCategoryIds.length > 0 ? 'core-excl-on' : 'core-excl-off';
}

/** 화면이 각 필드마다 반복 호출하기보다, 현재 설정 전체에서 한 번에 뽑아 쓰기 위한 편의 함수. */
export function collectTurtleVerificationNotes(settings: Pick<
  TurtleHoldingsSettings,
  'exitMethod' | 'exitLookback' | 'pyramidSpacing' | 'positionCapPct' | 'maxTotalRiskPct' | 'drawdownScalingEnabled' | 'excludedCategoryIds'
>): Record<'exit' | 'pyramid' | 'cap' | 'totalRisk' | 'drawdown' | 'coreExcl', string> {
  return {
    exit: getTurtleVerificationNote(resolveExitVerificationKey(settings.exitMethod, settings.exitLookback)),
    pyramid: getTurtleVerificationNote(resolvePyramidVerificationKey(settings.pyramidSpacing)),
    cap: getTurtleVerificationNote(resolveCapVerificationKey(settings.positionCapPct)),
    totalRisk: getTurtleVerificationNote(resolveTotalRiskVerificationKey(settings.maxTotalRiskPct)),
    drawdown: getTurtleVerificationNote(resolveDrawdownVerificationKey(settings.drawdownScalingEnabled)),
    coreExcl: getTurtleVerificationNote(resolveCoreExclVerificationKey(settings.excludedCategoryIds)),
  };
}
