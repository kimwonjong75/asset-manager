// tests/turtleVerificationNotesParity.ts
// ---------------------------------------------------------------------------
// "터틀 규칙" 설정 섹션 전용 순수 모듈(utils/turtleVerificationNotes.ts) 골든 테스트
// (계획서 PLAN_터틀중심_앱재정비_260925 §4.7·§6 P3).
//
// 실행: npx tsx tests/turtleVerificationNotesParity.ts

import {
  exitMethodBadge, pyramidSpacingBadge, turtleFieldBadge, describeExitLookbackWarning,
  resolveExitVerificationKey, resolvePyramidVerificationKey, resolveCapVerificationKey,
  resolveTotalRiskVerificationKey, resolveDrawdownVerificationKey, resolveCoreExclVerificationKey,
  getTurtleVerificationNote, collectTurtleVerificationNotes, TURTLE_VERIFICATION_NOTES,
} from '../utils/turtleVerificationNotes';
import { shouldPromptDrawdownReferenceRefresh } from '../utils/turtleHoldingsView';
import { DEFAULT_TURTLE_HOLDINGS_SETTINGS } from '../types/turtleHoldings';

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  if (Object.is(actual, expected)) pass++;
  else { fail++; console.error(`  ✗ ${name}\n      기대=${String(expected)} 실제=${String(actual)}`); }
}

// ════════════════════════════════════════════════════════════════════════════
// 1. 원조/조정 배지
// ════════════════════════════════════════════════════════════════════════════
{
  check('청산 donchian 20일 = 원조', exitMethodBadge('donchian', 20), '원조');
  check('청산 donchian 10일 = 조정', exitMethodBadge('donchian', 10), '조정');
  check('청산 donchian 55일 = 조정', exitMethodBadge('donchian', 55), '조정');
  check('청산 ma = 조정', exitMethodBadge('ma', 20), '조정');
  check('청산 atrTrail = 조정', exitMethodBadge('atrTrail', 20), '조정');

  check('불타기 halfN = 원조', pyramidSpacingBadge('halfN'), '원조');
  check('불타기 2R = 조정', pyramidSpacingBadge('2R'), '조정');
  check('불타기 custom = 조정', pyramidSpacingBadge('custom'), '조정');

  check('entryLookback 55 = 원조', turtleFieldBadge('entryLookback', 55), '원조');
  check('entryLookback 100 = 조정', turtleFieldBadge('entryLookback', 100), '조정');
  check('stopMultipleN 2 = 원조', turtleFieldBadge('stopMultipleN', 2), '원조');
  check('stopMultipleN 3 = 조정', turtleFieldBadge('stopMultipleN', 3), '조정');
  check('riskPerUnitPct 1 = 원조', turtleFieldBadge('riskPerUnitPct', 1), '원조');
  check('maxUnitsPerPosition 4 = 원조', turtleFieldBadge('maxUnitsPerPosition', 4), '원조');
  check('maxTotalRiskPct 24 = 원조', turtleFieldBadge('maxTotalRiskPct', 24), '원조');
  check('maxTotalRiskPct 12 = 조정', turtleFieldBadge('maxTotalRiskPct', 12), '조정');
  check('drawdownScalingEnabled true = 원조', turtleFieldBadge('drawdownScalingEnabled', true), '원조');
  check('drawdownScalingEnabled false = 조정', turtleFieldBadge('drawdownScalingEnabled', false), '조정');

  // 원조 자체가 없어 항상 조정인 필드 — 값이 무엇이든(우연히 같아 보이는 값 포함) 조정.
  check('positionCapPct 10(기본값과 우연히 같아도) = 조정', turtleFieldBadge('positionCapPct', 10), '조정');
  check('minOrderKRW = 조정', turtleFieldBadge('minOrderKRW', 50_000), '조정');
  check('pyramidSizeMultiplier = 조정', turtleFieldBadge('pyramidSizeMultiplier', 1), '조정');
  check('maPeriod = 조정', turtleFieldBadge('maPeriod', 50), '조정');
  check('atrTrailMultiple = 조정', turtleFieldBadge('atrTrailMultiple', 3), '조정');
  check('pyramidCustomN = 조정', turtleFieldBadge('pyramidCustomN', 1), '조정');
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 청산 일수 경고
// ════════════════════════════════════════════════════════════════════════════
{
  check('9일 → 경고(저장 차단 문구)', describeExitLookbackWarning(9)?.includes('저장할 수 없습니다'), true);
  check('0일 → 경고(저장 차단 문구)', describeExitLookbackWarning(0)?.includes('저장할 수 없습니다'), true);
  check('15일 → 주의(검증되지 않음)', describeExitLookbackWarning(15)?.includes('검증되지 않았습니다'), true);
  check('19일 → 주의(검증되지 않음)', describeExitLookbackWarning(19)?.includes('검증되지 않았습니다'), true);
  check('20일 → 경고 없음', describeExitLookbackWarning(20), null);
  check('55일 → 경고 없음', describeExitLookbackWarning(55), null);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 검증 키 판정 + 문구 존재성(모든 키가 표에 실제 문구를 갖는지)
// ════════════════════════════════════════════════════════════════════════════
{
  check('exit key: donchian 20', resolveExitVerificationKey('donchian', 20), 'exit-donchian-20');
  check('exit key: donchian 10', resolveExitVerificationKey('donchian', 10), 'exit-donchian-10');
  check('exit key: donchian 9(≤10 취급)', resolveExitVerificationKey('donchian', 9), 'exit-donchian-10');
  check('exit key: donchian 55', resolveExitVerificationKey('donchian', 55), 'exit-donchian-55');
  check('exit key: donchian 60(≥55 취급)', resolveExitVerificationKey('donchian', 60), 'exit-donchian-55');
  check('exit key: donchian 35(중간값 → 20일 근거로 폴백)', resolveExitVerificationKey('donchian', 35), 'exit-donchian-20');
  check('exit key: ma', resolveExitVerificationKey('ma', 50), 'exit-ma-50');
  check('exit key: atrTrail', resolveExitVerificationKey('atrTrail', 20), 'exit-atr-trail');

  check('pyramid key: 2R', resolvePyramidVerificationKey('2R'), 'pyramid-2r');
  check('pyramid key: halfN', resolvePyramidVerificationKey('halfN'), 'pyramid-half-n');
  check('pyramid key: custom', resolvePyramidVerificationKey('custom'), 'pyramid-custom');

  check('cap key: 5', resolveCapVerificationKey(5), 'cap-5');
  check('cap key: 10', resolveCapVerificationKey(10), 'cap-10');
  check('cap key: 15', resolveCapVerificationKey(15), 'cap-15');
  check('cap key: 7(중간값 → 10 근거로 폴백)', resolveCapVerificationKey(7), 'cap-10');

  check('totalRisk key: 12', resolveTotalRiskVerificationKey(12), 'total-risk-12');
  check('totalRisk key: 24', resolveTotalRiskVerificationKey(24), 'total-risk-24');
  check('totalRisk key: 18(중간값 → 24 근거로 폴백)', resolveTotalRiskVerificationKey(18), 'total-risk-24');

  check('drawdown key: on', resolveDrawdownVerificationKey(true), 'drawdown-on');
  check('drawdown key: off', resolveDrawdownVerificationKey(false), 'drawdown-off');

  check('coreExcl key: 제외 있음', resolveCoreExclVerificationKey([9]), 'core-excl-on');
  check('coreExcl key: 제외 없음', resolveCoreExclVerificationKey([]), 'core-excl-off');

  for (const key of Object.keys(TURTLE_VERIFICATION_NOTES) as (keyof typeof TURTLE_VERIFICATION_NOTES)[]) {
    check(`문구 존재: ${key}`, typeof getTurtleVerificationNote(key) === 'string' && getTurtleVerificationNote(key).length > 0, true);
  }

  const notes = collectTurtleVerificationNotes(DEFAULT_TURTLE_HOLDINGS_SETTINGS);
  check('collect: 기본값 청산 문구 = donchian 20일 문구', notes.exit, TURTLE_VERIFICATION_NOTES['exit-donchian-20']);
  check('collect: 기본값 불타기 문구 = 2R 문구', notes.pyramid, TURTLE_VERIFICATION_NOTES['pyramid-2r']);
  check('collect: 기본값 한도 문구 = 10% 문구', notes.cap, TURTLE_VERIFICATION_NOTES['cap-10']);
  check('collect: 기본값 전체위험 문구 = 24% 문구', notes.totalRisk, TURTLE_VERIFICATION_NOTES['total-risk-24']);
  check('collect: 기본값 계좌축소 문구 = off 문구(2026-09-26 사용자 결정: 기본 꺼짐)', notes.drawdown, TURTLE_VERIFICATION_NOTES['drawdown-off']);
  check('collect: 기본값 코어제외 문구 = off 문구(기본 빈 배열)', notes.coreExcl, TURTLE_VERIFICATION_NOTES['core-excl-off']);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 계좌 축소 기준자산 갱신 안내(shouldPromptDrawdownReferenceRefresh)
// ════════════════════════════════════════════════════════════════════════════
{
  check('기준 미설정 → 안내 없음', shouldPromptDrawdownReferenceRefresh(undefined, new Date('2026-06-01')), false);
  check('기준 설정 직후, 1월 아님, 365일 미만 → 안내 없음',
    shouldPromptDrawdownReferenceRefresh('2026-06-01', new Date('2026-08-01')), false);
  check('기준 설정 후 1월 진입 → 안내',
    shouldPromptDrawdownReferenceRefresh('2026-06-01', new Date('2027-01-15')), true);
  check('기준 설정 후 365일 경과(1월 아님) → 안내',
    shouldPromptDrawdownReferenceRefresh('2025-06-01', new Date('2026-07-01')), true);
  check('기준 설정 후 364일(1월 아님) → 안내 없음',
    shouldPromptDrawdownReferenceRefresh('2026-06-01', new Date('2027-05-30')), false);
  check('잘못된 날짜 문자열 → 안내 없음(fail-closed)',
    shouldPromptDrawdownReferenceRefresh('not-a-date', new Date('2027-01-15')), false);
}

console.log(`\nturtleVerificationNotesParity: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
