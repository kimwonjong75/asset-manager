// eslint.config.js — ESLint 10 flat config
// ---------------------------------------------------------------------------
// 목적: "여기 고쳤는데 저기가 안 바뀐다"의 최대 원인인 **React 훅 의존성 문제**를 자동 검출하고,
//       CLAUDE.md의 코드 규칙(any 금지 / console 금지 / 컴포넌트→서비스 직접 호출 금지)을
//       문서가 아니라 **도구로** 강제한다.
//
// 기존 위반 처리 — **일괄 억제(bulk suppressions)**
//   기존 위반은 `eslint-suppressions.json`에 기준선으로 박아 두고, **새 위반만 실패**시킨다.
//   · 억제 목록 갱신(의도적으로 기준선을 다시 뜰 때):  npx eslint --suppress-all
//   · 고친 항목 정리:                                   npm run lint:prune
//   억제는 "괜찮다"는 뜻이 아니라 "아직 안 고쳤다"는 뜻이다. 숫자가 줄어야 정상이다.
//
// 타입 정보 기반 검사(recommendedTypeChecked)는 아직 켜지 않았다 — 훨씬 강력하지만 느리고
//   초기 위반이 많다. 훅·기본 규칙이 안정된 뒤 별도 단계로 검토한다.
// ---------------------------------------------------------------------------

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/** 앱 소스 — 규칙을 가장 엄격하게 적용하는 범위 */
const APP_SOURCE = [
  'App.tsx',
  'index.tsx',
  'initialData.ts',
  'components/**/*.{ts,tsx}',
  'hooks/**/*.{ts,tsx}',
  'utils/**/*.{ts,tsx}',
  'services/**/*.{ts,tsx}',
  'contexts/**/*.{ts,tsx}',
  'types/**/*.{ts,tsx}',
  'constants/**/*.{ts,tsx}',
  'config/**/*.{ts,tsx}',
];

/** className 문자열(Literal)·템플릿 리터럴 조각(TemplateElement)에 같은 정규식을 건다 — cn() 인자도 Literal 이다 */
const classBan = (pattern, message) => [
  { selector: `Literal[value=/${pattern}/]`, message },
  { selector: `TemplateElement[value.raw=/${pattern}/]`, message },
];

/**
 * 앱 소스 전체 no-restricted-syntax (RULES.md §8, §13 ESLint).
 *  · text-[Npx]: 절대 px 폰트는 useFontScale(루트 rem 15/17px)에 반응하지 않는다 (Stage B)
 *  · text-gray-600: #3A3A3A 글자는 다크 배경에서 ~1.5:1 → 사실상 안 보인다 (Stage B)
 *  · success/positive/negative 색 클래스: tailwind.config.ts 에서 삭제된 폐기 별칭 — 쓰면 클래스가
 *    조용히 사라진다(JIT 는 모르는 클래스를 에러 없이 무시) (Stage C 게이트)
 */
const BASE_SYNTAX_BANS = [
  ...classBan(String.raw`\btext-\[\d+px\]`,
    '절대 px 폰트(text-[Npx]) 금지 — text-xs/sm/base 등 rem 크기를 쓰세요 (RULES.md §8 레이아웃 및 반응형 제약사항).'),
  ...classBan(String.raw`\btext-gray-600\b`,
    'text-gray-600 글자 금지(대비 ~1.5:1) — 흐린 글자는 text-gray-500 을 쓰세요. gray-600 은 테두리·배경 전용 (RULES.md §8).'),
  ...classBan(String.raw`\b(text|bg|border|ring|fill|stroke)-(success|positive|negative)\b`,
    '폐기된 색 별칭(success/positive/negative) — 방향은 up/down, 성공 상태는 ok, 위험은 warning, 오류·삭제는 danger (RULES.md §8 색 규약).'),
];

// 이모지·픽토그램·기하 글리프 — 🐢(U+1F422, 터틀 후보 표식)만 허용.
// esquery 정규식은 u 플래그 없이 UTF-16 코드 유닛으로 매칭하므로 서로게이트 쌍으로 적는다:
//   U+1F300–1F3FF = D83C DF00–DFFF / U+1F400–1F7FF = D83D DC00–DFFF (DC22 🐢 제외) / U+1F800–1FAFF = D83E DC00–DEFF
//   BMP: U+2600–27BF(✅ 2705·❌ 274C 포함) · U+2B50 ⭐ · U+25A0–25FF(■▲▼◆ 등 기하 도형)
// 캔버스 마커 글리프(◆)처럼 꼭 필요한 글자는 utils/chartFormat.ts 의 이름 붙인 상수로 둔다(규칙 범위 밖).
const EMOJI_PATTERN =
  String.raw`\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDC21\uDC23-\uDFFF]|\uD83E[\uDC00-\uDEFF]|[\u2600-\u27BF\u2B50\u25A0-\u25FF]`;
const EMOJI_MESSAGE =
  '이모지·기호 글리프 금지(🐢만 허용) — lucide-react 아이콘 + 문구를 쓰세요. 캔버스 텍스트 글리프는 utils/chartFormat.ts 상수로 (RULES.md §8 색 규약).';

/**
 * components/ + App.tsx 전용 — 원시 방향색 텍스트, 원시 경고·정보 색(Stage D2), 이모지.
 *  · amber/orange/yellow/sky: 위험·확인은 warning 토큰, 안내는 info 토큰. 단계 사다리(디스트리뷰션 3/4/5 등)·
 *    식별 색은 constants/stateColorLadders.ts 에만 둔다(이 규칙 범위 밖). hover:·/opacity 변형도 같은 정규식에 걸린다.
 *    tests/visualSystemIntegrity.ts (f) 와 이중 가드.
 */
const COMPONENT_SYNTAX_BANS = [
  ...classBan(String.raw`\btext-(red|green|emerald|rose)-\d{2,3}\b`,
    '원시 방향색 글자(text-red/green/emerald/rose-N) 금지 — text-up / text-down / text-ok / text-danger / text-warning 을 쓰세요 (RULES.md §8 색 규약).'),
  ...classBan(String.raw`\b(text|bg|border|ring|fill|stroke|from|via|to|outline|accent|decoration|divide)-(amber|orange|yellow|sky)-\d{2,3}\b`,
    '원시 경고·정보 색(amber/orange/yellow/sky-N) 금지 — 위험·확인은 text-warning·bg-warning-soft·border-warning/30·bg-warning-strong, 안내는 text-info·bg-info-soft·bg-info-strong, 단계 사다리·식별 색은 constants/stateColorLadders.ts 에서 import 하세요 (RULES.md §8 색 규약).'),
  ...classBan(EMOJI_PATTERN, EMOJI_MESSAGE),
  { selector: `JSXText[value=/${EMOJI_PATTERN}/]`, message: EMOJI_MESSAGE },
];

/** 오프라인 진단·연구 스크립트 — console 출력이 곧 결과물이라 규칙을 완화한다 */
const TOOLING = ['tests/**/*.{ts,tsx,js,mjs}', 'scripts/**/*.{ts,tsx,js,mjs}'];

export default tseslint.config(
  // ── 검사 제외 ──────────────────────────────────────────────────────────────
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.wrangler/**',
      'DB/**', // 로컬 전용 지식 인제스트 데이터 (gitignore)
      'public/**',
      'scripts/backtest/**/cache/**',
      'scripts/backtest/**/output/**',
      'scripts/notify/gas/dist/**', // esbuild 산출물(gitignore) — 소스는 scripts/notify/gas/entry.ts
      'eslint-suppressions.json',
    ],
  },

  // ── 모든 JS/TS 공통 기본 ───────────────────────────────────────────────────
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
  },

  // ── 앱 소스 ────────────────────────────────────────────────────────────────
  {
    files: APP_SOURCE,
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      // 이 프로젝트의 원래 문제: 훅 의존성 누락. 기본 warn을 error로 승격해
      // 새로 생기는 것은 반드시 막고, 기존 것은 억제 기준선으로 관리한다.
      'react-hooks/exhaustive-deps': 'error',

      // CLAUDE.md — any 엄격 금지 (타입은 types/ 에 정의)
      '@typescript-eslint/no-explicit-any': 'error',

      // CLAUDE.md — 로깅은 createLogger('module') 사용, 직접 console 금지
      'no-console': 'error',

      // CLAUDE.md — components/ 는 UI 렌더링만. API 호출은 hooks/ 에서.
      // (문서에만 있던 규칙이라 실제로는 10곳이 직접 연결돼 있었다)
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/services/*', '**/services'],
          message:
            'components/ 에서 services/ 를 직접 부르지 마세요 (CLAUDE.md: UI는 렌더링만). ' +
            'hooks/ 에 데이터 훅을 만들어 그 훅을 사용하세요.',
        }],
      }],

      // RULES.md §7 사용자 알림 — 브라우저 alert/confirm/prompt 금지 (Stage C 게이트, 2026-09-15).
      // 대체: useConfirm().confirm / notify + ConfirmDialog. tests/dialogPolicyIntegrity.ts 와 이중 가드.
      'no-alert': 'error',

      // RULES.md §8 — 가독성·색 규약 회귀 차단 (Stage B/C). 선택자 정의는 파일 상단 BASE_SYNTAX_BANS.
      'no-restricted-syntax': ['error', ...BASE_SYNTAX_BANS],
    },
  },
  {
    // components/ + App.tsx 전용 추가 금지(색 규약·이모지). flat config 에서 같은 규칙을 다시 선언하면
    // 앞 설정을 **대체**하므로 BASE_SYNTAX_BANS 를 반드시 함께 펼친다.
    files: ['components/**/*.{ts,tsx}', 'App.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...BASE_SYNTAX_BANS, ...COMPONENT_SYNTAX_BANS],
    },
  },
  {
    // no-restricted-imports 는 components/ 에만 적용 — hooks·utils 는 services 를 부르는 게 정상
    files: [
      'hooks/**/*.{ts,tsx}', 'utils/**/*.{ts,tsx}', 'services/**/*.{ts,tsx}',
      'contexts/**/*.{ts,tsx}', 'types/**/*.{ts,tsx}', 'constants/**/*.{ts,tsx}',
      'config/**/*.{ts,tsx}', 'App.tsx', 'index.tsx', 'initialData.ts',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },

  {
    // logger 자체는 console 을 쓸 수밖에 없다 — 여기가 바로 createLogger 의 구현부다.
    // (다른 곳의 console 금지는 "이 파일을 거쳐 쓰라"는 뜻이므로 여기만 예외)
    files: ['utils/logger.ts'],
    rules: { 'no-console': 'off' },
  },

  // ── 테스트·연구 스크립트 ───────────────────────────────────────────────────
  {
    files: TOOLING,
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off', // 진단 출력이 결과물
      '@typescript-eslint/no-explicit-any': 'off', // fixture 캐스팅 다수
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_', varsIgnorePattern: '^_',
      }],
    },
  },

  // ── 설정 파일 ──────────────────────────────────────────────────────────────
  {
    files: ['*.config.{js,ts,mjs}', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
);
