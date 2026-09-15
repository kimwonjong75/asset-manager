// tests/dialogPolicyIntegrity.ts
// ---------------------------------------------------------------------------
// 알림 정책 가드 (Stage C, 2026-09-15 사용자 승인 — RULES.md §7 사용자 알림).
//   브라우저 기본 대화상자(window.alert / window.confirm / 전역 alert()·confirm())를 앱 소스에서 금지한다.
//   대체: 파괴적 확인 → useConfirm().confirm(..., { tone: 'danger' }), 정보 안내 → notify(),
//   폼 검증 → 입력칸 근처 인라인 오류 문구. 플로팅 토스트는 만들지 않는다.
//
// 스캔 대상: components/, hooks/, contexts/ 의 .ts/.tsx + App.tsx (utils/services 는 렌더가 없어 대상 밖).
//
// 판정 방식 (오탐 방지 설계)
//   1) 주석 제거 후 검사 — 블록 주석 전체, 줄 주석은 `//` 앞이 줄 시작/공백/구두점일 때만
//      (https:// 같은 문자열 안의 `//` 는 앞 글자가 ':' 라 보존). 정책 설명 주석이 걸리지 않는다.
//   2) `window.alert(` / `window.confirm(` / `globalThis.alert|confirm(` → 항상 위반.
//   3) 전역 `alert(` → 앞 글자가 `.`·식별자 문자가 아닐 때만 위반(`foo.alert(`·`showAlert(` 는 통과).
//   4) 전역 `confirm(` → 같은 규칙(`onConfirm(`·`x.confirm(` 통과) + **그 파일이 useConfirm 에서
//      `confirm` 을 구조분해로 받았으면 통과**(`const { confirm, ... } = useConfirm()`). 받지 않았는데
//      bare `confirm(` 을 부르면 그건 브라우저 전역 confirm 이므로 위반.
//   아래 ⓪ 자체 검증 픽스처로 정규식이 의도대로 동작하는지 먼저 고정한다(경로 A-vs-B 비교 아님).
// 수동 실행: npx tsx tests/dialogPolicyIntegrity.ts. 통과 시 exit 0, 실패 시 exit 1.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

let pass = 0;
const fails: string[] = [];
function check(cond: boolean, msg: string): void {
  if (cond) pass++;
  else fails.push(`✗ ${msg}`);
}

function stripComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  return noBlock.replace(/(^|[\s;{}(),])\/\/.*$/gm, '$1');
}

const HARD_PATTERN = /\b(?:window|globalThis)\.(?:alert|confirm)\s*\(/;
const BARE_ALERT = /(?<![.\w$])alert\s*\(/;
const BARE_CONFIRM = /(?<![.\w$])confirm\s*\(/;
const USE_CONFIRM_BINDING = /\{[^}]*(?<![\w$])confirm(?![\w$])[^}]*\}\s*=\s*useConfirm\s*\(/;

interface Violation { line: number; text: string; kind: string }

function findViolations(src: string): Violation[] {
  const code = stripComments(src);
  const hasConfirmBinding = USE_CONFIRM_BINDING.test(code);
  const out: Violation[] = [];
  code.split('\n').forEach((lineText, idx) => {
    if (HARD_PATTERN.test(lineText)) out.push({ line: idx + 1, text: lineText.trim(), kind: 'window.alert/confirm' });
    else if (BARE_ALERT.test(lineText)) out.push({ line: idx + 1, text: lineText.trim(), kind: 'alert()' });
    else if (BARE_CONFIRM.test(lineText) && !hasConfirmBinding) out.push({ line: idx + 1, text: lineText.trim(), kind: 'confirm() (useConfirm 바인딩 없음)' });
  });
  return out;
}

// ⓪ 자체 검증 픽스처 — 정규식 자체가 틀리면 아래 전수 스캔의 "0건"은 의미가 없다
const FIX_USE_CONFIRM = "import { useConfirm } from '../hooks/useConfirm';\nconst { confirm, confirmRequest } = useConfirm();\nif (await confirm('삭제?')) {}";
check(findViolations("alert('x');").length === 1, '픽스처: bare alert( 검출');
check(findViolations("window.alert('x');").length === 1, '픽스처: window.alert( 검출');
check(findViolations("if (window.confirm('x')) {}").length === 1, '픽스처: window.confirm( 검출');
check(findViolations("globalThis.confirm('x');").length === 1, '픽스처: globalThis.confirm( 검출');
check(findViolations("if (!confirm('x')) return;").length === 1, '픽스처: useConfirm 없는 bare confirm( 검출');
check(findViolations(FIX_USE_CONFIRM).length === 0, '픽스처: useConfirm 구조분해 confirm( 허용');
check(findViolations("const { notify, confirm } = useConfirm();\nvoid confirm('x').then(ok => ok);").length === 0, '픽스처: 구조분해 순서 무관 허용');
check(findViolations("onConfirm(); handleConfirm(); rule.alert(); showAlert(1); x.confirm(2);").length === 0, '픽스처: 접두·멤버 호출 비검출');
check(findViolations("// window.alert 은 쓰지 않는다\n/* confirm('x') */\nconst u = 'https://a.b/c';").length === 0, '픽스처: 주석·URL 비검출');
check(findViolations("const alertRules = x; const isAlert = alertLevel(1);").length === 0, '픽스처: alert 로 시작하는 식별자 비검출');
check(findViolations("const { confirmRequest } = useConfirm();\nconfirm('x');").length === 1, '픽스처: confirmRequest 만 받은 파일의 bare confirm( 검출');

// ① 전수 스캔
const ROOT = process.cwd();
function walk(dir: string, acc: string[]): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(tsx?|jsx?)$/.test(name)) acc.push(full);
  }
  return acc;
}
const targets = [
  ...walk(path.join(ROOT, 'components'), []),
  ...walk(path.join(ROOT, 'hooks'), []),
  ...walk(path.join(ROOT, 'contexts'), []),
  path.join(ROOT, 'App.tsx'),
].filter(f => existsSync(f));

check(targets.length > 50, `스캔 대상 파일 수가 비정상적으로 적음: ${targets.length}`);

const violations: string[] = [];
for (const file of targets) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  for (const v of findViolations(readFileSync(file, 'utf8'))) {
    violations.push(`${rel}:${v.line} [${v.kind}] ${v.text}`);
  }
}
check(violations.length === 0, `브라우저 대화상자 사용 ${violations.length}건:\n  ${violations.join('\n  ')}`);

if (fails.length > 0) {
  console.error(`dialogPolicyIntegrity: ${fails.length}건 실패 / ${pass}건 통과`);
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log(`dialogPolicyIntegrity: ${pass}건 통과 (스캔 ${targets.length}개 파일)`);
