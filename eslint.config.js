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
