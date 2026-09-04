// tests/displayPrefsParity.ts
// utils/displayPrefs.ts 골든 테스트 — "글자 크게" 표시 설정(P6)의 순수 파싱/변환 함수.
//   · parseFontScale: fail-closed(모르는 값·null·빈 문자열 → 'normal')
//   · fontScalePx / fontScaleToCssValue: 15px/17px 고정값
//   · toggleFontScale / isLargeFontScale: Toggle checked ↔ FontScale 왕복
// 수동 실행: npm run test:displayprefs (tsx). scripts/verify.mjs가 *Parity.ts로 자동 발견.

import {
  FONT_SCALE_PX,
  fontScalePx,
  fontScaleToCssValue,
  isLargeFontScale,
  parseFontScale,
  toggleFontScale,
} from '../utils/displayPrefs';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fails.push(`${name}: expected ${e}, got ${a}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// parseFontScale — fail-closed
// ════════════════════════════════════════════════════════════════════════════
check('null → normal', parseFontScale(null), 'normal');
check('undefined → normal', parseFontScale(undefined), 'normal');
check("빈 문자열 → normal", parseFontScale(''), 'normal');
check("'large' → large", parseFontScale('large'), 'large');
check("'normal' → normal", parseFontScale('normal'), 'normal');
check('손상된 값(오타) → normal(fail-closed)', parseFontScale('LARGE'), 'normal');
check('임의 문자열 → normal(fail-closed)', parseFontScale('xlarge'), 'normal');

// ════════════════════════════════════════════════════════════════════════════
// fontScalePx / fontScaleToCssValue — 고정 px 값
// ════════════════════════════════════════════════════════════════════════════
check('normal = 15px', fontScalePx('normal'), 15);
check('large = 17px', fontScalePx('large'), 17);
check('FONT_SCALE_PX 상수와 fontScalePx 일치(normal)', fontScalePx('normal'), FONT_SCALE_PX.normal);
check('FONT_SCALE_PX 상수와 fontScalePx 일치(large)', fontScalePx('large'), FONT_SCALE_PX.large);
check('CSS 문자열 normal', fontScaleToCssValue('normal'), '15px');
check('CSS 문자열 large', fontScaleToCssValue('large'), '17px');

// ════════════════════════════════════════════════════════════════════════════
// toggleFontScale / isLargeFontScale — Toggle checked 왕복
// ════════════════════════════════════════════════════════════════════════════
check('checked=true → large', toggleFontScale(true), 'large');
check('checked=false → normal', toggleFontScale(false), 'normal');
check('isLargeFontScale(large) = true', isLargeFontScale('large'), true);
check('isLargeFontScale(normal) = false', isLargeFontScale('normal'), false);
// 왕복: toggle 결과를 다시 isLarge에 넣으면 원래 checked 값과 같아야 한다
check('왕복(true)', isLargeFontScale(toggleFontScale(true)), true);
check('왕복(false)', isLargeFontScale(toggleFontScale(false)), false);

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ displayPrefs parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ displayPrefs parity 전체 통과 (${pass} 단언)`);
