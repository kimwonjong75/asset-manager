// tests/settingsTabsParity.ts
// 설정 하위 탭 정의·저장값 해석 골든 테스트(utils/settingsTabs).
// 실행: npx tsx tests/settingsTabsParity.ts (npm test가 자동 발견)

import { SETTINGS_TABS, DEFAULT_SETTINGS_TAB, resolveSettingsTab } from '../utils/settingsTabs';

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  if (Object.is(actual, expected)) { pass++; } else { fail++; console.error(`  ✗ ${name}\n      기대=${String(expected)} 실제=${String(actual)}`); }
}

// 탭 순서·개수 고정 (섹션 배치는 SettingsPage가 이 id를 기준으로 함)
check('탭 개수', SETTINGS_TABS.length, 4);
check('탭 순서', SETTINGS_TABS.map(t => t.id).join(','), 'alerts,turtle,display,data');
check('라벨', SETTINGS_TABS.map(t => t.label).join('|'), '알림|터틀 규칙|화면·분류|AI·백업');
check('id 중복 없음', new Set(SETTINGS_TABS.map(t => t.id)).size, 4);
check('기본 탭', DEFAULT_SETTINGS_TAB, 'alerts');

// 저장값 해석
check('유효값 alerts', resolveSettingsTab('alerts'), 'alerts');
check('유효값 turtle', resolveSettingsTab('turtle'), 'turtle');
check('유효값 display', resolveSettingsTab('display'), 'display');
check('유효값 data', resolveSettingsTab('data'), 'data');
check('null → 기본', resolveSettingsTab(null), 'alerts');
check('undefined → 기본', resolveSettingsTab(undefined), 'alerts');
check('옛/모르는 값 → 기본', resolveSettingsTab('backup'), 'alerts');
check('빈 문자열 → 기본', resolveSettingsTab(''), 'alerts');
check('대소문자 다름 → 기본', resolveSettingsTab('Turtle'), 'alerts');
check('숫자 → 기본', resolveSettingsTab(1), 'alerts');

console.log(`settingsTabsParity: ${pass} 통과 / ${fail} 실패`);
if (fail > 0) process.exit(1);
