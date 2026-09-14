// tests/directionToneParity.ts
// ---------------------------------------------------------------------------
// 방향 색 헬퍼(utils/directionTone) 회귀 테스트 — 순수 함수만 검증(React/DOM 없음).
//
// 고정 대상 (명시적 골든값 — 경로 대조 아님):
//   · 색 규약: 양수=up(빨강) / 음수=down(파랑) / 0·-0·NaN·null·undefined·±Infinity=flat
//   · 허용오차: 기본 1e-9 이하 잡음은 flat, eps 인자로 조절
//   · 반환 클래스 문자열은 tailwind 가 스캔하는 전체 리터럴 그대로
//   · 매수=up, 매도=down (한국 증권사 관례)
//
// 수동 실행: npm run test:directiontone. 통과 시 exit 0.

import {
  getDirection,
  directionTextClass,
  directionTextClassOf,
  directionSoftClass,
  tradeSideTextClass,
  DIRECTION_EPSILON,
} from '../utils/directionTone';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

// 1. getDirection 기본 골든값
check('양수 1.5 → up', getDirection(1.5), 'up');
check('음수 -2.25 → down', getDirection(-2.25), 'down');
check('0 → flat', getDirection(0), 'flat');
check('-0 → flat', getDirection(-0), 'flat');
check('NaN → flat', getDirection(NaN), 'flat');
check('null → flat', getDirection(null), 'flat');
check('undefined → flat', getDirection(undefined), 'flat');
check('+Infinity → flat', getDirection(Infinity), 'flat');
check('-Infinity → flat', getDirection(-Infinity), 'flat');
check('큰 양수 1e12 → up', getDirection(1e12), 'up');
check('큰 음수 -1e12 → down', getDirection(-1e12), 'down');

// 2. 허용오차
check('DIRECTION_EPSILON 고정값', DIRECTION_EPSILON, 1e-9);
check('1e-10 (eps 이하) → flat', getDirection(1e-10), 'flat');
check('-1e-10 (eps 이하) → flat', getDirection(-1e-10), 'flat');
check('정확히 eps(1e-9) → flat (경계 포함)', getDirection(1e-9), 'flat');
check('정확히 -eps → flat (경계 포함)', getDirection(-1e-9), 'flat');
check('2e-9 → up', getDirection(2e-9), 'up');
check('-2e-9 → down', getDirection(-2e-9), 'down');
check('0.1 + 0.2 - 0.3 부동소수 잡음(5.55e-17) → flat', getDirection(0.1 + 0.2 - 0.3), 'flat');
check('eps=0.005: 0.004 → flat', getDirection(0.004, 0.005), 'flat');
check('eps=0.005: -0.004 → flat', getDirection(-0.004, 0.005), 'flat');
check('eps=0.005: 0.006 → up', getDirection(0.006, 0.005), 'up');
check('eps=0: 1e-300 → up', getDirection(1e-300, 0), 'up');
check('eps=0: 0 → flat', getDirection(0, 0), 'flat');

// 3. 글자색 클래스 (tailwind 리터럴)
check('text +3 → text-up', directionTextClass(3), 'text-up');
check('text -3 → text-down', directionTextClass(-3), 'text-down');
check('text 0 → text-gray-400', directionTextClass(0), 'text-gray-400');
check('text NaN → text-gray-400', directionTextClass(NaN), 'text-gray-400');
check('text null → text-gray-400', directionTextClass(null), 'text-gray-400');
check('text undefined → text-gray-400', directionTextClass(undefined), 'text-gray-400');
check('textOf up', directionTextClassOf('up'), 'text-up');
check('textOf down', directionTextClassOf('down'), 'text-down');
check('textOf flat', directionTextClassOf('flat'), 'text-gray-400');

// 4. 옅은 배경 클래스
check('soft +1', directionSoftClass(1), 'bg-up-soft text-up');
check('soft -1', directionSoftClass(-1), 'bg-down-soft text-down');
check('soft 0', directionSoftClass(0), 'bg-gray-700/60 text-gray-300');
check('soft -0', directionSoftClass(-0), 'bg-gray-700/60 text-gray-300');

// 5. 매수/매도 행동색
check('buy → text-up (빨강)', tradeSideTextClass('buy'), 'text-up');
check('sell → text-down (파랑)', tradeSideTextClass('sell'), 'text-down');

// 6. 실사용 값: 고가대비 하락률은 항상 ≤ 0 → down 또는 flat
check('dropFromHigh -12.4 → down', directionTextClass(-12.4), 'text-down');
check('dropFromHigh 0 (신고가) → flat', directionTextClass(0), 'text-gray-400');

console.log(`\n[directionToneParity] ${pass} passed, ${fails.length} failed`);
if (fails.length > 0) {
  fails.forEach(f => console.error(f));
  process.exit(1);
}
