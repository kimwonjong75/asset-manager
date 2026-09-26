// tests/manualIntegrity.ts
// ---------------------------------------------------------------------------
// "터틀 사용설명서"(docs/터틀_사용설명서.md) 골든 테스트 — 문서와 코드가 어긋나면 여기서 잡는다
// (RULES.md §13 통합 검문소에 등록 — npm test 자동 발견 대상 `*Integrity.ts`).
//
// ① 모든 {{키}}가 DEFAULT_TURTLE_HOLDINGS_SETTINGS 필드명으로 해석되는지(미해석 키 0건)
// ② 앵커(<a id="...">) 12개가 정확히 이 골든 목록과 같은지 + 코드가 쓰는 "? 설명"(ManualHelpLink)
//    anchor 문자열이 전부 그 12개 안에 있는지
// ③ 문서의 모든 [대괄호] 화면 라벨이 components/·App.tsx 소스 어딘가에 실제로 존재하는지
//    (가변부 와일드카드 — 아래 WILDCARD RULES 참고). 예외는 1건뿐(EXCEPTIONS 참고) — 문서 맨 위
//    표기 규약 설명 문장 자체("`[대괄호]`로 쓴 말은…")는 화면 라벨이 아니라 이 표기법을 설명하는
//    메타 문구라서 제외한다. 나머지 33개는 전수 조사 결과 전부 실제 소스 문자열과 매치됐다.
// ④ 치환기 골든 — 기본값이 아닌 값으로 바꿨을 때 문장 속 숫자·라벨이 실제로 바뀌는지
//
// 이 테스트가 실패하면(예: md에 새 {{키}}를 오타로 적었거나, 코드의 버튼 문구를 바꿔놓고 문서를 안
// 고쳤거나) **문서 또는 코드 둘 중 하나를 고쳐야 통과한다** — 문서가 코드에서 저절로 벗어나지 못하게
// 붙잡아 두는 것이 이 파일의 존재 이유다.
//
// 수동 실행: npx tsx tests/manualIntegrity.ts. 통과 시 exit 0, 실패 시 exit 1.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { renderManualTemplate, extractAnchors, extractBracketLabels, stripForDisplay } from '../utils/manualTemplate';
import { DEFAULT_TURTLE_HOLDINGS_SETTINGS } from '../types/turtleHoldings';
import { MANUAL_TOC } from '../constants/manualToc';

let pass = 0;
const fails: string[] = [];
function check(cond: boolean, msg: string): void {
  if (cond) pass++;
  else fails.push(`✗ ${msg}`);
}

const ROOT = process.cwd();
const MD_PATH = path.join(ROOT, 'docs', '터틀_사용설명서.md');
const md = readFileSync(MD_PATH, 'utf8');

// ── ① {{키}} 전부 해석됨(기본 설정 기준) ────────────────────────────────────
// 문서 맨 위 안내 문장의 `{{설정키}}`는 표기 규약 자체를 설명하는 예시 문구라 실제 설정 필드명이
// 아니다(한글이라 `renderManualTemplate`의 `{{[a-zA-Z]+}}` 정규식과 애초에 매치되지 않는다) — 그래서
// "치환 후 {{ 잔존" 검사는 나이브한 부분 문자열 검사 대신 같은 정규식으로 한다(가짜 실패 방지).
const LEFTOVER_PLACEHOLDER_RE = /\{\{[a-zA-Z]+\}\}/;
const resolvedDefault = renderManualTemplate(md, DEFAULT_TURTLE_HOLDINGS_SETTINGS);
check(resolvedDefault.unresolvedKeys.length === 0, `미해석 {{키}} 있음: ${resolvedDefault.unresolvedKeys.join(', ')}`);
check(!LEFTOVER_PLACEHOLDER_RE.test(resolvedDefault.text), '치환 후에도 {{영문키}} 가 남아있음(정규식이 못 잡은 자리표시자 존재)');

// ── ② 앵커 12개 골든 + "? 설명"(ManualHelpLink) anchor 코드 스캔 ───────────
const EXPECTED_ANCHORS = [
  'summary', 'routine', 'today', 'sell', 'rebuy', 'stopcheck',
  'cleanup', 'newstock', 'settings', 'kakao', 'faq', 'limits',
];
const actualAnchors = extractAnchors(md);
check(actualAnchors.length === 12, `앵커 개수 = ${actualAnchors.length} (기대 12): ${actualAnchors.join(',')}`);
check(
  JSON.stringify([...actualAnchors].sort()) === JSON.stringify([...EXPECTED_ANCHORS].sort()),
  `앵커 목록 불일치: ${actualAnchors.join(',')}`,
);
// MANUAL_TOC(화면 목차)도 같은 12개를 가리켜야 한다 — 문서에서 앵커를 추가/삭제하면 목차도 고치라는 신호.
check(
  JSON.stringify([...MANUAL_TOC.map(t => t.id)].sort()) === JSON.stringify([...EXPECTED_ANCHORS].sort()),
  `constants/manualToc.ts MANUAL_TOC 의 id 목록이 문서 앵커와 다름: ${MANUAL_TOC.map(t => t.id).join(',')}`,
);

function walk(dir: string, acc: string[]): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.tsx?$/.test(name)) acc.push(full);
  }
  return acc;
}
const componentFiles = [...walk(path.join(ROOT, 'components'), []), path.join(ROOT, 'App.tsx')].filter(f => existsSync(f));
check(componentFiles.length > 30, `스캔 대상(components/·App.tsx) 파일 수가 비정상적으로 적음: ${componentFiles.length}`);

const fileContents = new Map<string, string>();
for (const f of componentFiles) fileContents.set(f, readFileSync(f, 'utf8'));
const corpus = [...fileContents.values()].join('\n');

// "? 설명" 링크(ManualHelpLink)가 코드에서 쓰는 anchor 문자열을 정적 스캔 — 전부 문서 앵커 안에 있어야
// 한다(오타·리네임으로 링크가 죽은 앵커를 가리키면 여기서 잡힌다).
const HELP_LINK_RE = /<ManualHelpLink\s+anchor="([a-zA-Z]+)"/g;
const usedHelpAnchors = new Set<string>();
for (const content of fileContents.values()) {
  let m: RegExpExecArray | null;
  HELP_LINK_RE.lastIndex = 0;
  while ((m = HELP_LINK_RE.exec(content)) !== null) usedHelpAnchors.add(m[1]);
}
check(usedHelpAnchors.size >= 6, `ManualHelpLink 사용처가 예상보다 적음(${usedHelpAnchors.size}) — 6곳(today/sell/rebuy/cleanup/settings/kakao) 배선을 확인`);
for (const anchor of usedHelpAnchors) {
  check(actualAnchors.includes(anchor), `ManualHelpLink anchor="${anchor}" 가 문서에 없는 앵커를 가리킴`);
}
// 브리프가 지정한 6개 지점 배선 확인(각각 최소 1곳 이상 이 anchor를 쓰는지).
for (const anchor of ['today', 'sell', 'rebuy', 'cleanup', 'settings', 'kakao']) {
  check(usedHelpAnchors.has(anchor), `ManualHelpLink anchor="${anchor}" 를 쓰는 곳이 없음(요구된 6개 배선 지점 중 하나 누락)`);
}

// ── ③ [대괄호] 화면 라벨이 실제 소스에 존재 ─────────────────────────────────
// 가변부 와일드카드 규칙(둘 다 공백/괄호로 이미 구분되는 진짜 변수 자리에만 적용):
//   · 공백 바로 뒤에 오는 단독 'N'(예: "확인 필요 N종목", "다르게 N번 보류") → 숫자 리터럴 또는
//     JSX 표현식({...})과 매치. `½N(원조)` 처럼 공백 없이 붙는 'N'은 대상이 아니다(안 그러면 그
//     "half-N" 표기 자체가 와일드카드로 뭉개진다).
//   · 말줄임표 '…'(예: "지금 관리자산(…)으로 기준 정하기") → 괄호 안 임의 내용(포맷된 금액 등)과 매치.
// '대괄호' — 문서 맨 위 "`[대괄호]`로 쓴 말은 앱 화면의 버튼·라벨 이름입니다" 문장 자체가 표기 규약을
// 설명하는 메타 문구라 화면 라벨이 아니다(코드에 '대괄호'라는 문자열이 실제로 있어도 그건 이 규약을
// 설명하는 주석일 뿐, 검증 의도와 무관한 우연한 매치다 — 그래서 명시적으로 뺀다).
const EXCEPTIONS: ReadonlySet<string> = new Set(['대괄호']);

function buildLabelMatcher(label: string): RegExp {
  const tokens = label.split(/((?<=\s)N|…)/u);
  const pattern = tokens
    .map(tok => {
      if (tok === 'N') return '(?:\\d+|\\{[^}]*\\})';
      if (tok === '…') return '[\\s\\S]*?';
      return tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(pattern);
}

const bracketLabels = extractBracketLabels(md);
check(bracketLabels.length >= 20, `[대괄호] 문구 추출 개수가 예상보다 적음(${bracketLabels.length}) — 정규식이 문서 구조 변경으로 깨졌을 수 있음`);
for (const label of bracketLabels) {
  if (EXCEPTIONS.has(label)) continue;
  const matcher = buildLabelMatcher(label);
  check(matcher.test(corpus), `[${label}] 이(가) components/·App.tsx 소스 어디에도 없음(정규식: ${matcher.source})`);
}

// ── ④ 치환기 골든 — 값을 바꾸면 문장 속 숫자·라벨이 실제로 바뀌는지 ─────────
const golden = renderManualTemplate(md, {
  ...DEFAULT_TURTLE_HOLDINGS_SETTINGS,
  entryLookback: 77,
  exitLookback: 33,
  minOrderKRW: 123_456,
  drawdownScalingEnabled: true,
  pyramidSpacing: 'custom',
}).text;

check(golden.includes('33일 최저가'), '치환기 골든: exitLookback=33 → "33일 최저가" 문장이 안 보임');
check(golden.includes('77일 최고가'), '치환기 골든: entryLookback=77 → "77일 최고가" 문장이 안 보임');
check(golden.includes('123,456원'), '치환기 골든: minOrderKRW=123456 → 천단위 구분("123,456원")이 안 보임');
// pyramidSpacing/drawdownScalingEnabled 는 표 안의 값이라, 다른 후보 라벨이 같은 줄에 정적 텍스트로도
// 나오므로(예: "[½N(원조)]") 셀 경계(| ... |)까지 포함해 "이 자리에 정확히 이 값이 들어갔는지"를 본다.
check(golden.includes('| 계좌 축소(드로다운 감쇄) | 켜짐 |'), '치환기 골든: drawdownScalingEnabled=true → "켜짐" 셀 값이 안 보임');
check(golden.includes('| 불타기 간격 | 직접 입력 |'), "치환기 골든: pyramidSpacing='custom' → \"직접 입력\" 셀 값이 안 보임");
check(!LEFTOVER_PLACEHOLDER_RE.test(golden), '치환기 골든: 비기본값 설정으로도 {{영문키}} 가 남아있음');

// ── Advisor 보정(2026-09-27): 화면 표시 정리 — 앵커 줄·관리자 메모(HTML 주석)가 사용자에게 글자로 보이면 안 된다 ──
const shownForUser = stripForDisplay(md);
check(!/<a id=/.test(shownForUser), 'stripForDisplay: 앵커 태그(<a id>)가 화면에 글자로 남음');
check(!/<!--/.test(shownForUser), 'stripForDisplay: 관리자 메모(HTML 주석)가 화면에 남음');
check(extractAnchors(md).length === 12, 'stripForDisplay는 표시용일 뿐 — 원본 앵커 12개는 그대로여야 함');
check(!/\*\*\[[^\]\n]+\]\*\*[가-힣]/.test(md), '설명서: **[라벨]** 바로 뒤 한글은 굵게가 깨져 별표가 보임 — 대괄호 칩만 쓰세요');
check(!/\*\*"[^"\n]+"\*\*[가-힣]/.test(md), '설명서: **"문구"** 바로 뒤 한글은 굵게가 깨져 별표가 보임');

if (fails.length > 0) {
  console.error(`manualIntegrity: ${fails.length}건 실패 / ${pass}건 통과`);
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log(`manualIntegrity: ${pass}건 통과`);

