// tests/maColorsParity.ts
// ---------------------------------------------------------------------------
// MA 식별 색 회귀 가드 (Stage C P4, RULES.md §8 색 규약).
//
// 고정 대상 (명시적 골든값 — 경로 대조 아님):
//   1. DEFAULT_MA_CONFIGS 6슬롯의 id/period/color 골든 hex
//   2. 어떤 MA 색도 상태 색(캔들 up/down · up · down · warning · danger · ok)과 같지 않다 (대소문자 무시)
//   3. MA 색끼리 중복 없음 + getDefaultMAColor(기간 조회, 없는 기간은 MA_EXTRA_COLOR)
//   4. SignalReplayChart 는 로컬 hex MA 목록을 두지 않고 utils/maCalculations 기본 색을 import 한다 (정적 검사)
//   5. PortfolioContext.mergeChartMAConfigs 는 저장본의 color 를 무시한다 (정적 검사 — .tsx+React 라 직접 import 불가)
//      → 기본 색을 바꿔도 사용자 저장값을 덮어쓰는 일이 없다는 전제를 고정.
//
// 수동 실행: npx tsx tests/maColorsParity.ts. 통과 시 exit 0.

import { readFileSync } from 'node:fs';
import { DEFAULT_MA_CONFIGS, MA_EXTRA_COLOR, getDefaultMAColor } from '../utils/maCalculations';
import { CANDLE_UP_COLOR, CANDLE_DOWN_COLOR } from '../utils/chartFormat';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

// 1. 골든값
check('DEFAULT_MA_CONFIGS 슬롯/기간/색', DEFAULT_MA_CONFIGS.map(c => [c.id, c.period, c.color]), [
  ['ma1', 5, '#E5E7EB'],
  ['ma2', 10, '#A78BFA'],
  ['ma3', 20, '#FACC15'],
  ['ma4', 60, '#2DD4BF'],
  ['ma5', 120, '#A3E635'],
  ['ma6', 200, '#E879F9'],
]);
check('기본 enabled (20·60만 켜짐 — 변경 없음)', DEFAULT_MA_CONFIGS.map(c => c.enabled), [false, false, true, true, false, false]);
check('MA_EXTRA_COLOR 골든', MA_EXTRA_COLOR, '#94A3B8');

// 2. 상태 색 금지
check('CANDLE_UP 골든(전제)', CANDLE_UP_COLOR, '#F23645');
check('CANDLE_DOWN 골든(전제)', CANDLE_DOWN_COLOR, '#2962FF');
const STATE_COLORS: Record<string, string> = {
  CANDLE_UP: CANDLE_UP_COLOR, CANDLE_DOWN: CANDLE_DOWN_COLOR,
  up: '#F87171', down: '#60A5FA', warning: '#F59E0B', danger: '#F472B6', ok: '#34D399',
};
const allMaColors = [...DEFAULT_MA_CONFIGS.map(c => c.color), MA_EXTRA_COLOR];
for (const color of allMaColors) {
  for (const [name, state] of Object.entries(STATE_COLORS)) {
    check(`${color} ≠ ${name}(${state})`, color.toLowerCase() === state.toLowerCase(), false);
  }
}
// (구) 빨강·파랑 MA 색이 되돌아오지 않게
for (const legacy of ['#EF4444', '#3B82F6', '#F59E0B', '#10B981', '#EC4899', '#8B5CF6']) {
  check(`구 MA 색 ${legacy} 미사용`, allMaColors.some(c => c.toLowerCase() === legacy.toLowerCase()), false);
}

// 3. 중복 없음 + 조회
check('MA 색 중복 없음', new Set(allMaColors.map(c => c.toLowerCase())).size, allMaColors.length);
check('getDefaultMAColor(5)', getDefaultMAColor(5), '#E5E7EB');
check('getDefaultMAColor(20)', getDefaultMAColor(20), '#FACC15');
check('getDefaultMAColor(60)', getDefaultMAColor(60), '#2DD4BF');
check('getDefaultMAColor(120)', getDefaultMAColor(120), '#A3E635');
check('getDefaultMAColor(150) → extra', getDefaultMAColor(150), '#94A3B8');
check('getDefaultMAColor(200)', getDefaultMAColor(200), '#E879F9');

// 4. SignalReplayChart 정적 검사
const chartSrc = readFileSync('components/replay/SignalReplayChart.tsx', 'utf8');
check('SignalReplayChart: maCalculations 에서 기본 색 import',
  /import\s*\{[^}]*getDefaultMAColor[^}]*\}\s*from\s*'\.\.\/\.\.\/utils\/maCalculations'/.test(chartSrc), true);
const maLinesBlock = chartSrc.match(/const MA_LINES[\s\S]*?\];?\)?\.map\([\s\S]*?\);/)?.[0] ?? '';
check('SignalReplayChart: MA_LINES 블록 발견', maLinesBlock.length > 0, true);
check('SignalReplayChart: MA_LINES 에 hex 리터럴 없음', /#[0-9a-fA-F]{6}\b/.test(maLinesBlock), false);
check('SignalReplayChart: MA_LINES 색은 getDefaultMAColor 로', maLinesBlock.includes('getDefaultMAColor('), true);

// 5. mergeChartMAConfigs 정적 검사 — 저장본에서 period/enabled 만 취한다
const ctxSrc = readFileSync('contexts/PortfolioContext.tsx', 'utf8');
const mergeBody = ctxSrc.match(/const mergeChartMAConfigs[\s\S]*?\n {2}\}\);/)?.[0] ?? '';
check('mergeChartMAConfigs 발견', mergeBody.length > 0, true);
check('mergeChartMAConfigs: DEFAULT_MA_CONFIGS 기반 map', mergeBody.includes('DEFAULT_MA_CONFIGS.map('), true);
check('mergeChartMAConfigs: 저장본 color 참조 없음', /saved\??\.color/.test(mergeBody), false);
check('mergeChartMAConfigs: 저장본 전체 스프레드 없음', /\.\.\.saved\b/.test(mergeBody), false);
check('mergeChartMAConfigs: period/enabled 만 저장본에서', [/saved\.period/.test(mergeBody), /saved\.enabled/.test(mergeBody)], [true, true]);
const legacyBody = ctxSrc.match(/const migrateLegacyMAConfigs[\s\S]*?\n {2}\}\);/)?.[0] ?? '';
check('migrateLegacyMAConfigs: 저장본 color 참조 없음', legacyBody.length > 0 && !/saved\??\.color|\.\.\.saved\b/.test(legacyBody), true);

if (fails.length) {
  console.error(fails.join('\n'));
  console.error(`\nmaColorsParity: ${pass} passed, ${fails.length} failed`);
  process.exit(1);
}
console.log(`maColorsParity: ${pass} passed`);
