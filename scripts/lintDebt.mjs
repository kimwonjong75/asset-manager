#!/usr/bin/env node
// scripts/lintDebt.mjs
// ---------------------------------------------------------------------------
// `eslint-suppressions.json` 기준선에 쌓인 **미해결 위반**을 규칙별·파일별로 보여준다.
//
// 왜 필요한가: 일괄 억제(bulk suppressions)의 유일한 위험은 기준선이 **조용히 영구화**되는 것이다.
//   억제는 "괜찮다"가 아니라 "아직 안 고쳤다"는 뜻이므로, 숫자가 보이지 않으면 줄지 않는다.
//   이 스크립트는 그 숫자를 눈에 보이게 만든다.
//
//   npm run lint:debt              규칙별 요약 + 위험도 순 정렬
//   npm run lint:debt -- --files   파일별 상위 목록까지
//
// 항목을 실제로 고친 뒤에는 `npm run lint:prune` 으로 기준선에서 제거한다.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'eslint-suppressions.json');

if (!existsSync(FILE)) {
  console.log('eslint-suppressions.json 이 없습니다 — 억제된 위반이 없다는 뜻입니다. ✅');
  process.exit(0);
}

/**
 * 규칙별 우선순위 메모. "왜 이게 중요한가"를 숫자 옆에 붙여 두면
 * 다음에 무엇부터 손댈지 매번 다시 조사하지 않아도 된다.
 */
const NOTES = {
  'react-hooks/exhaustive-deps':
    '⚠ 최우선 — "여기 고쳤는데 저기가 안 바뀜"의 직접 원인. 특히 저장 경로(useAssetActions)',
  'react-hooks/set-state-in-effect':
    'effect 안에서 setState — 불필요한 재렌더·무한루프 위험. 건수 많으니 파일 단위로',
  'react-hooks/refs': 'ref 를 렌더 중 읽기/쓰기 — React Compiler 규칙',
  'react-hooks/immutability': '선언 전 접근 등 불변성 위반',
  'react-hooks/preserve-manual-memoization': '수동 메모가 컴파일러 최적화를 막음(성능)',
  'react-hooks/static-components': '컴포넌트를 렌더 중 정의 — 매 렌더 재마운트',
  '@typescript-eslint/no-explicit-any': 'CLAUDE.md 금지 항목. 3단계 strict 와 함께 처리 권장',
  '@typescript-eslint/no-unused-vars': '기계적 정리 — 위험 낮음, 건수 줄이기 좋음',
  'no-restricted-imports': 'components→services 직접 호출. hooks 로 추출 필요(구조 작업)',
  'no-console': 'createLogger 로 교체 (utils/logger.ts 자신은 예외)',
};

/** 위에 적힌 순서대로 위험도 정렬 — 목록에 없는 규칙은 뒤로 */
const ORDER = Object.keys(NOTES);
const rank = r => { const i = ORDER.indexOf(r); return i === -1 ? ORDER.length : i; };

const data = JSON.parse(readFileSync(FILE, 'utf8'));
const byRule = new Map();
const byFile = new Map();
let total = 0;

for (const [file, rules] of Object.entries(data)) {
  let fileTotal = 0;
  for (const [rule, info] of Object.entries(rules)) {
    const n = info.count ?? 0;
    byRule.set(rule, (byRule.get(rule) ?? 0) + n);
    fileTotal += n;
    total += n;
  }
  byFile.set(file, fileTotal);
}

console.log(`\n미해결 lint 빚: 총 ${total}건 / ${byFile.size}개 파일`);
console.log('(기준선에 있어 검문소는 통과합니다. 새 위반만 실패합니다.)\n');

const rules = [...byRule.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1]);
const width = Math.max(...rules.map(([r]) => r.length));
for (const [rule, n] of rules) {
  console.log(`${String(n).padStart(4)}  ${rule.padEnd(width)}  ${NOTES[rule] ?? ''}`);
}

if (process.argv.includes('--files')) {
  console.log('\n건수 상위 파일');
  [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
    .forEach(([f, n]) => console.log(`${String(n).padStart(4)}  ${f}`));
}

console.log('\n고친 뒤에는 npm run lint:prune 으로 기준선에서 제거하세요.\n');
