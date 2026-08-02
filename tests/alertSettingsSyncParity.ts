// tests/alertSettingsSyncParity.ts
// ---------------------------------------------------------------------------
// 알림 규칙 설정(AlertSettings)의 **기기 간 동기화** 회귀 테스트.
//
// 배경: 규칙 설정은 localStorage 전용이라 PC를 바꾸면 초기화됐다. 이제 Drive 페이로드의
//   `alertSettings` 키로 함께 저장/복원된다. 경로가 3개(로컬 로드/Drive 로드/백업 복원)라
//   병합 규칙이 어긋나면 "다른 PC에서 규칙이 기본값으로 되돌아가는" 증상이 재발한다.
//
// 검증 대상(순수 계층만 — React/DOM 없음):
//   1. mergeAlertSettings — 커스터마이징 보존 · 신규 규칙 추가 · filterConfig backfill · 오염 방어
//   2. parsePortfolioPayload — alertSettings 라운드트립(있으면 보존 / 없으면 undefined)
//   3. 상수 오염 방지 — 병합 결과를 변형해도 DEFAULT_ALERT_SETTINGS가 그대로일 것
//
// 수동 실행: npm run test:alertsync. 통과 시 exit 0.

import { DEFAULT_ALERT_SETTINGS } from '../constants/alertRules';
import { mergeAlertSettings } from '../utils/mergeAlertSettings';
import { parsePortfolioPayload } from '../utils/parsePortfolioPayload';
import type { AlertRule } from '../types/alertRules';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function checkTrue(name: string, cond: boolean): void {
  if (cond) pass++; else fails.push(`✗ ${name}: expected true`);
}

const DEFAULT_RULE_COUNT = DEFAULT_ALERT_SETTINGS.rules.length;
const findRule = (rules: AlertRule[], id: string) => rules.find(r => r.id === id);

// ════════════════════════════════════════════════════════════════════════════
// 1. 저장본 없음/오염 → 기본값
// ════════════════════════════════════════════════════════════════════════════
{
  check('undefined → 기본 규칙 수', mergeAlertSettings(undefined).rules.length, DEFAULT_RULE_COUNT);
  check('null → 기본 규칙 수', mergeAlertSettings(null).rules.length, DEFAULT_RULE_COUNT);
  check('배열 → 기본 규칙 수', mergeAlertSettings([1, 2, 3]).rules.length, DEFAULT_RULE_COUNT);
  check('문자열 → 기본 규칙 수', mergeAlertSettings('nope').rules.length, DEFAULT_RULE_COUNT);
  check('기본 enableAutoPopup', mergeAlertSettings(undefined).enableAutoPopup, DEFAULT_ALERT_SETTINGS.enableAutoPopup);

  // rules가 배열이 아니면 기본 규칙으로 폴백하되 enableAutoPopup은 저장본 존중
  const broken = mergeAlertSettings({ rules: 'not-an-array', enableAutoPopup: false });
  check('rules 오염 → 기본 규칙 수', broken.rules.length, DEFAULT_RULE_COUNT);
  check('rules 오염이어도 enableAutoPopup 보존', broken.enableAutoPopup, false);

  // id 없는 항목은 제거 (뒤이어 기본 규칙이 전부 backfill됨)
  const dirty = mergeAlertSettings({ rules: [{ name: 'no-id' }, null, 42] });
  check('id 없는 규칙 제거 후 기본값 backfill', dirty.rules.length, DEFAULT_RULE_COUNT);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 사용자 커스터마이징 보존 + 신규 규칙 추가
// ════════════════════════════════════════════════════════════════════════════
{
  // 저장본에 규칙 1개만 있고, 그 규칙은 꺼져 있으며 임계값이 바뀐 상태
  const climaxDefault = findRule(DEFAULT_ALERT_SETTINGS.rules, 'climax-top');
  checkTrue('픽스처 전제: climax-top 기본 규칙 존재', !!climaxDefault);

  const stored = {
    enableAutoPopup: false,
    rules: [
      {
        ...climaxDefault,
        enabled: false,
        filterConfig: { climaxFlagsRequired: 3 }, // 나머지 climax 필드는 저장본에 없음
      },
    ],
  };
  const merged = mergeAlertSettings(stored);

  check('enableAutoPopup 저장본 우선', merged.enableAutoPopup, false);
  check('신규 규칙 자동 추가 → 전체 개수', merged.rules.length, DEFAULT_RULE_COUNT);
  check('저장본 규칙이 맨 앞 유지', merged.rules[0].id, 'climax-top');

  const climax = findRule(merged.rules, 'climax-top')!;
  check('사용자 enabled=false 보존', climax.enabled, false);
  check('사용자 임계값 보존', climax.filterConfig.climaxFlagsRequired, 3);
  // 저장본에 없던 필드는 기본값에서 backfill (구 저장본이 신규 필드를 잃지 않음)
  check('신규 필드 backfill (slopeMultiplier)', climax.filterConfig.climaxSlopeMultiplier, climaxDefault!.filterConfig.climaxSlopeMultiplier);
  check('신규 필드 backfill (atrMultiple)', climax.filterConfig.climaxAtrMultiple, climaxDefault!.filterConfig.climaxAtrMultiple);

  // 저장본에 없던 규칙은 기본값 그대로 들어옴
  const distDefault = findRule(DEFAULT_ALERT_SETTINGS.rules, 'distribution-high')!;
  const dist = findRule(merged.rules, 'distribution-high')!;
  check('미저장 규칙은 기본 enabled 유지', dist.enabled, distDefault.enabled);
  check('미저장 규칙은 기본 임계값 유지', dist.filterConfig.distributionThreshold, distDefault.filterConfig.distributionThreshold);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 멱등성 — 한 번 병합한 결과를 다시 병합해도 동일 (저장→로드 반복 안정)
// ════════════════════════════════════════════════════════════════════════════
{
  const once = mergeAlertSettings({
    enableAutoPopup: true,
    rules: [{ ...findRule(DEFAULT_ALERT_SETTINGS.rules, 'climax-top')!, enabled: false }],
  });
  const twice = mergeAlertSettings(JSON.parse(JSON.stringify(once)));
  check('멱등: 규칙 수 동일', twice.rules.length, once.rules.length);
  check('멱등: 전체 동일', twice, once);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 알 수 없는(삭제된) 규칙 id는 저장본 그대로 통과 — 임의 삭제 금지
// ════════════════════════════════════════════════════════════════════════════
{
  const merged = mergeAlertSettings({
    rules: [{ id: 'legacy-custom-rule', name: '옛 규칙', enabled: true, filters: [], filterConfig: { lossThreshold: 7 } }],
  });
  const legacy = findRule(merged.rules, 'legacy-custom-rule');
  checkTrue('미지의 규칙 보존', !!legacy);
  check('미지의 규칙 filterConfig 보존', legacy!.filterConfig.lossThreshold, 7);
  check('미지의 규칙 + 기본 전체', merged.rules.length, DEFAULT_RULE_COUNT + 1);
}

// ════════════════════════════════════════════════════════════════════════════
// 4b. 잘린/손상된 규칙 방어 — `matchesRule`의 `rule.filters.every(...)`가 터지지 않을 것
//     (Drive 페이로드·백업 파일은 외부 편집/절단 가능 → 브리핑 계산 전체가 죽는 사고 방지)
// ════════════════════════════════════════════════════════════════════════════
{
  const climaxDefault = findRule(DEFAULT_ALERT_SETTINGS.rules, 'climax-top')!;

  // (a) 알려진 id인데 filters/action/severity가 통째로 빠진 저장본 → 기본값에서 backfill
  const partial = mergeAlertSettings({ rules: [{ id: 'climax-top', enabled: false, filterConfig: { climaxFlagsRequired: 3 } }] });
  const repaired = findRule(partial.rules, 'climax-top')!;
  check('잘린 규칙: filters 기본값 backfill', repaired.filters, climaxDefault.filters);
  check('잘린 규칙: action backfill', repaired.action, climaxDefault.action);
  check('잘린 규칙: severity backfill', repaired.severity, climaxDefault.severity);
  check('잘린 규칙: name backfill', repaired.name, climaxDefault.name);
  check('잘린 규칙: 사용자 enabled는 보존', repaired.enabled, false);
  check('잘린 규칙: 사용자 임계값은 보존', repaired.filterConfig.climaxFlagsRequired, 3);

  // (b) filters가 null/문자열 등 비배열 → 기본값으로 교체 (every 호출 안전)
  const nulled = mergeAlertSettings({ rules: [{ ...climaxDefault, filters: null }] });
  check('filters=null → 기본 filters로 교체', findRule(nulled.rules, 'climax-top')!.filters, climaxDefault.filters);
  checkTrue('모든 규칙의 filters가 배열', mergeAlertSettings({ rules: [{ id: 'climax-top', filters: 'x' }] }).rules.every(r => Array.isArray(r.filters)));

  // (c) filterConfig가 비객체여도 기본값 config는 살아있어야 함
  const badCfg = mergeAlertSettings({ rules: [{ ...climaxDefault, filterConfig: null }] });
  check('filterConfig=null → 기본 config backfill', badCfg.rules[0].filterConfig.climaxFlagsRequired, climaxDefault.filterConfig.climaxFlagsRequired);

  // (d) 기본값에 없는 규칙 + filters 비배열 → **제외**
  //     ([]로 보정하면 filters.every가 항상 true라 모든 종목에 오발화)
  const unknownBroken = mergeAlertSettings({ rules: [{ id: 'ghost-rule', enabled: true, filterConfig: {} }] });
  check('미지의 규칙 + filters 없음 → 제외', findRule(unknownBroken.rules, 'ghost-rule'), undefined);
  check('제외 후 기본 규칙만 남음', unknownBroken.rules.length, DEFAULT_RULE_COUNT);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. DEFAULT_ALERT_SETTINGS 오염 방지 — 병합 결과 변형이 상수에 새지 않을 것
// ════════════════════════════════════════════════════════════════════════════
{
  const before = JSON.stringify(DEFAULT_ALERT_SETTINGS);
  const merged = mergeAlertSettings(undefined);
  merged.rules[0].enabled = !merged.rules[0].enabled;
  merged.rules[0].filterConfig.lossThreshold = 999;
  merged.rules.push({ id: 'x', name: 'x', description: '', severity: 'info', action: 'buy', enabled: true, filters: [], filterConfig: {} });
  check('DEFAULT_ALERT_SETTINGS 불변', JSON.stringify(DEFAULT_ALERT_SETTINGS), before);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. Drive/백업 페이로드 라운드트립 — parsePortfolioPayload가 alertSettings를 유실하지 않을 것
// ════════════════════════════════════════════════════════════════════════════
{
  const payload = {
    assets: [],
    alertSettings: {
      enableAutoPopup: false,
      rules: [{ id: 'climax-top', name: '과열', enabled: false, filters: [], filterConfig: { climaxFlagsRequired: 3 } }],
    },
  };
  const p = parsePortfolioPayload(JSON.stringify(payload));
  check('페이로드 alertSettings 보존: enableAutoPopup', p.alertSettings?.enableAutoPopup, false);
  check('페이로드 alertSettings 보존: 규칙 수', p.alertSettings?.rules.length, 1);
  check('페이로드 alertSettings 보존: 임계값', p.alertSettings?.rules[0].filterConfig.climaxFlagsRequired, 3);

  // 파싱본을 병합하면 나머지 기본 규칙이 채워진다 (다른 PC에서의 실제 복원 경로)
  const restored = mergeAlertSettings(p.alertSettings);
  check('복원 후 전체 규칙 수', restored.rules.length, DEFAULT_RULE_COUNT);
  check('복원 후 사용자 설정 보존', findRule(restored.rules, 'climax-top')!.enabled, false);
  check('복원 후 자동팝업 설정 보존', restored.enableAutoPopup, false);

  // 구 페이로드(필드 없음)는 undefined — 훅이 "로컬 설정 유지"로 분기하는 신호
  check('구 페이로드: alertSettings undefined', parsePortfolioPayload('{}').alertSettings, undefined);
  check('오염 페이로드(배열): undefined', parsePortfolioPayload('{"alertSettings":[1,2]}').alertSettings, undefined);
  check('오염 페이로드(문자열): undefined', parsePortfolioPayload('{"alertSettings":"x"}').alertSettings, undefined);
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ alertSettingsSync parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ alertSettingsSync parity 전체 통과 (${pass} 단언)`);
