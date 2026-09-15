// tests/visualSystemIntegrity.ts
// ---------------------------------------------------------------------------
// 시각 체계 가드 (Stage C 게이트, 2026-09-15 — RULES.md §8 색 규약·레이아웃, §13).
//   Stage B/C 에서 정리한 색 토큰·이모지·그림자·모달 백드롭 규약이 조용히 되돌아가지 않게 고정한다.
//   ESLint(no-restricted-syntax)와 겹치는 항목도 있지만, 여기서는 **소스 전수 + tailwind.config.ts 값**을
//   명시 기대값으로 검사한다(린트 설정이 느슨해져도 이 테스트는 따로 실패한다).
//
// 스캔 대상: components/**/*.tsx + App.tsx (주석 제거 후 검사)
//   (a) 이모지·픽토그램·기하 글리프 0건 — 🐢(U+1F422)만 허용
//   (b) shadow-(sm|md|lg|xl|2xl) 는 오버레이 허용 목록 파일에서만 — 카드에는 그림자 금지
//   (c) 폐기 색 별칭 클래스(text-/bg-/border-/ring-/fill-/stroke- × success/positive/negative) 0건
//   (d) tailwind.config.ts 에 success/positive/negative 색 키 없음 + 상태 토큰 6종 정확한 hex
//   (e) 수제 모달 백드롭(inset-0 + bg-black) 은 승인된 파일에서만
// 각 허용 목록은 "현재 실제로 쓰는 파일"과 **정확히 일치**해야 한다 — 쓰지 않게 된 항목이 목록에 남아
//   조용히 허용 범위를 넓히지 않도록 양방향으로 검사한다.
// 수동 실행: npx tsx tests/visualSystemIntegrity.ts. 통과 시 exit 0, 실패 시 exit 1.

import { readdirSync, readFileSync, statSync } from 'node:fs';
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

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.tsx') ? [full] : [];
  });
}

const rel = (f: string) => f.split(path.sep).join('/');
const FILES = [...walk('components').map(rel), 'App.tsx'].sort();
const SOURCES = new Map(FILES.map(f => [f, stripComments(readFileSync(f, 'utf8'))]));

// ── 판정 정규식 (ESLint 규칙과 같은 범위) ─────────────────────────────────────
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2705}\u{274C}\u{25A0}-\u{25FF}]/gu;
const TURTLE = '\u{1F422}';
const SHADOW_RE = /(?<![\w-])shadow-(?:sm|md|lg|xl|2xl)\b/;
const ALIAS_RE = /\b(?:text|bg|border|ring|fill|stroke)-(?:success|positive|negative)\b/;
const BACKDROP_RE = /\binset-0\b/;
const BLACK_RE = /\bbg-black\b/;

function emojiHits(code: string): string[] {
  return (code.match(EMOJI_RE) ?? []).filter(c => c !== TURTLE);
}

// ⓪ 자체 검증 픽스처 — 정규식이 틀리면 아래 전수 스캔의 "0건"은 의미가 없다
check(emojiHits("<span>🔴 위험</span>").length === 1, '픽스처: 🔴 검출');
check(emojiHits("label: '✅ 완료'").length === 1, '픽스처: ✅ 검출');
check(emojiHits("'■ 긴급'").length === 1, '픽스처: ■(기하 도형) 검출');
check(emojiHits("'⭐'").length === 1, '픽스처: ⭐ 검출');
check(emojiHits("<span>🐢</span>").length === 0, '픽스처: 🐢 허용');
check(emojiHits("'↕ > ≥ ₩ · —'").length === 0, '픽스처: 화살표·부등호·통화·가운뎃점은 비검출');
check(stripComments("// 🔴 주석\nconst a = 1;").includes('🔴') === false, '픽스처: 줄 주석 제거');
check(SHADOW_RE.test('rounded shadow-xl') && !SHADOW_RE.test('shadow-none') && !SHADOW_RE.test('drop-shadow-md'), '픽스처: shadow 정규식');
check(ALIAS_RE.test('hover:text-positive') && ALIAS_RE.test('bg-negative-soft') && ALIAS_RE.test('border-success/40'), '픽스처: 별칭 클래스 검출(변형·soft·opacity)');
check(!ALIAS_RE.test("tone: 'positive'") && !ALIAS_RE.test('isPositive'), '픽스처: 톤 어휘(positive)는 클래스가 아니므로 비검출');

check(FILES.length > 100, `스캔 대상 파일 수 합리적(${FILES.length})`);

// (a) 이모지 ────────────────────────────────────────────────────────────────
for (const [file, code] of SOURCES) {
  const hits = emojiHits(code);
  check(hits.length === 0, `(a) ${file}: 이모지/글리프 금지(🐢만 허용) — 발견 ${hits.join(' ')}`);
}

// (b) 그림자 — 오버레이 허용 목록 (파일 → 사유). 현재 실제 사용처와 정확히 일치해야 한다.
const SHADOW_ALLOWLIST: Record<string, string> = {
  'components/common/Modal.tsx': '공용 모달 패널(shadow-xl)',
  'components/common/ConfirmDialog.tsx': '확인 대화상자 패널 — 모달 위 z-dialog',
  'components/common/ActionMenu.tsx': '포털 드롭다운·바텀시트',
  'components/common/AlertPopup.tsx': '화면 고정 브리핑 팝업(z-popup)',
  'components/common/Tooltip.tsx': '포털 툴팁(z-tooltip)',
  'components/common/MemoTooltip.tsx': '포털 메모 툴팁(z-tooltip)',
  'components/PortfolioAssistant.tsx': 'AI 어시스턴트 모달 패널',
  'components/trade-plan/TradePlanPlanner.tsx': '매매 계획 모달 패널 + 종목 검색 자동완성 드롭다운',
  'components/AddNewAssetModal.tsx': '모달 안 종목 검색 자동완성 드롭다운(absolute 부유)',
  'components/WatchlistAddModal.tsx': '모달 안 종목 검색 자동완성 드롭다운(absolute 부유)',
  'components/layouts/SignalReplayView.tsx': '종목 검색 자동완성 목록(absolute 부유)',
  'components/replay/SignalReplayChart.tsx': '차트 hover 툴팁(absolute 부유)',
  'components/portfolio-table/ColumnSettingsDropdown.tsx': '컬럼 설정 드롭다운(absolute 부유)',
  'components/PortfolioTable.tsx': '일괄 변경 드롭다운 메뉴(absolute 부유)',
  'components/WatchlistPage.tsx': '헤더 설정 팝오버(absolute 부유)',
  'App.tsx': '상단 새 버전/오류 배너(z-banner) + 맨 위로 FAB(z-fab)',
};
const shadowUsers = FILES.filter(f => SHADOW_RE.test(SOURCES.get(f)!));
for (const f of shadowUsers) {
  check(f in SHADOW_ALLOWLIST, `(b) ${f}: 오버레이가 아닌 곳의 그림자 금지(카드 그림자 금지, RULES.md §8 카드 표면)`);
}
for (const f of Object.keys(SHADOW_ALLOWLIST)) {
  check(shadowUsers.includes(f), `(b) 허용 목록 정리 필요 — ${f} 는 더 이상 shadow-* 를 쓰지 않음`);
}

// (c) 폐기 별칭 클래스 ──────────────────────────────────────────────────────
for (const [file, code] of SOURCES) {
  const m = code.match(ALIAS_RE);
  check(!m, `(c) ${file}: 폐기 색 별칭 클래스 ${m?.[0]} — up/down/ok/warning/danger 로 이관`);
}

// (d) tailwind.config.ts 색 토큰 ────────────────────────────────────────────
const tw = stripComments(readFileSync('tailwind.config.ts', 'utf8'));
for (const alias of ['success', 'positive', 'negative']) {
  check(!new RegExp(`^\\s*['"]?${alias}['"]?\\s*:`, 'm').test(tw), `(d) tailwind.config.ts: 폐기 색 키 '${alias}' 가 남아 있음`);
}
const TOKEN_HEX: Record<string, string> = {
  up: '#F87171',
  down: '#60A5FA',
  ok: '#34D399',
  danger: '#F472B6',
  info: '#38BDF8',
  warning: '#F59E0B',
};
for (const [token, hex] of Object.entries(TOKEN_HEX)) {
  // 객체형(`up: { DEFAULT: '#…'`) 또는 문자열형(`up: '#…'`) 둘 다 허용
  const re = new RegExp(`^\\s*${token}\\s*:\\s*(?:\\{\\s*DEFAULT\\s*:\\s*)?'([^']+)'`, 'm');
  const got = tw.match(re)?.[1];
  check(got?.toUpperCase() === hex, `(d) tailwind 토큰 ${token} = ${hex} (실제 ${got ?? '없음'})`);
}

// (e) 수제 모달 백드롭 ──────────────────────────────────────────────────────
const BACKDROP_ALLOWLIST: Record<string, string> = {
  'components/common/Modal.tsx': '공용 모달 — 새 모달은 전부 여기로',
  'components/common/ConfirmDialog.tsx': '모달 위에 뜨는 확인 대화상자(z-dialog, Esc capture)',
  'components/common/ChartViewerModal.tsx': '전체화면 차트 뷰어(bg-black/80, 여백 최소)',
  'components/common/ActionMenu.tsx': '모바일 바텀시트 딤(z-menu)',
  'components/PortfolioAssistant.tsx': 'AI 어시스턴트 — 고정 높이 채팅 레이아웃(Modal 이관 보류)',
  'components/trade-plan/TradePlanPlanner.tsx': '매매 계획 세우기 — 95dvh 전용 레이아웃(Modal 이관 보류)',
};
const backdropUsers = FILES.filter(f =>
  SOURCES.get(f)!.split('\n').some(line => BACKDROP_RE.test(line) && BLACK_RE.test(line)),
);
for (const f of backdropUsers) {
  check(f in BACKDROP_ALLOWLIST, `(e) ${f}: 수제 모달 백드롭 금지 — components/common/Modal 을 쓰세요 (RULES.md §8 모달 반응형 패턴)`);
}
for (const f of Object.keys(BACKDROP_ALLOWLIST)) {
  check(backdropUsers.includes(f), `(e) 허용 목록 정리 필요 — ${f} 에 inset-0 + bg-black 백드롭이 없음`);
}

// ── 결과 ────────────────────────────────────────────────────────────────────
if (fails.length > 0) {
  console.error(fails.join('\n'));
  console.error(`\nvisualSystemIntegrity: ${pass} 통과 / ${fails.length} 실패`);
  process.exit(1);
}
console.log(`visualSystemIntegrity: ${pass} 단언 통과 (파일 ${FILES.length}, 그림자 허용 ${shadowUsers.length}, 백드롭 허용 ${backdropUsers.length})`);
