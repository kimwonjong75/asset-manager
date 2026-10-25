// tests/core6V3ReportsIndexParity.ts
// 코어 6종 V3 — 결과 목록·비교 화면(indexPage) 골든. 오프라인·fixtures 3개.
// 실행: npx tsx tests/core6V3ReportsIndexParity.ts

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildIndexHtml, escapeHtml, fmtPct, fmtPp, safeJson, selectRows, sortRows,
  type CompareRow, type ReportRecord,
} from '../scripts/backtest/core6SignalRotationV3/reports/indexPage';

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  if (Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else { fail++; console.error(`  FAIL ${name}\n      기대=${JSON.stringify(expected)} 실제=${JSON.stringify(actual)}`); }
}
function ok(name: string, cond: boolean): void { check(name, cond, true); }

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'backtest', 'core6SignalRotationV3', 'reports', 'fixtures');
const load = (id: string): ReportRecord => JSON.parse(readFileSync(path.join(FIX, `${id}.json`), 'utf8')) as ReportRecord;
const recs = [load('eq-sixth'), load('stock-heavy'), load('xss')];

console.log('core6 V3 결과 목록·비교 화면 테스트\n');

// ── 포맷터 골든 ─────────────────────────────────────────────────────────
check('fmtPct', fmtPct(0.1234), '12.3%');
check('fmtPct 음수', fmtPct(-0.25), '-25.0%');
check('fmtPct null', fmtPct(null), '–');
check('fmtPp 양수', fmtPp(0.021), '+2.1%p');
check('fmtPp 음수', fmtPp(-0.0149), '-1.5%p');
check('fmtPp null', fmtPp(null), '–');

// ── 이스케이프 ──────────────────────────────────────────────────────────
check('escapeHtml', escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
{
  const j = safeJson({ s: '</script><b>& ' });
  ok('safeJson: < 없음', !j.includes('<') && !j.includes('>') && !j.includes('&') && !j.includes(' '));
  check('safeJson 왕복', (JSON.parse(j) as { s: string }).s, '</script><b>& ');
}

// ── 정렬 골든 (손계산 가능한 합성 행) ───────────────────────────────────
const mk = (id: string, label: string, mdd: number | null, calmar: number | null): CompareRow =>
  ({ id, label, mdd, cagr: mdd === null ? null : 0.05, calmar, mddReductionVsBH: null, cagrDiffVsBH: null });
const syn = [mk('a', '가', -0.2, 0.5), mk('b', '나', -0.1, 0.9), mk('c', '다', null, null), mk('d', '라', -0.3, 0.5), mk('e', '마', -0.1, 0.9)];
check('calmar desc (동률은 label, null 마지막)', sortRows(syn, 'calmar', 'desc').map(r => r.id), ['b', 'e', 'a', 'd', 'c']);
check('calmar asc (null 여전히 마지막)', sortRows(syn, 'calmar', 'asc').map(r => r.id), ['a', 'd', 'b', 'e', 'c']);
check('mdd desc = 얕은 순', sortRows(syn, 'mdd', 'desc').map(r => r.id), ['b', 'e', 'a', 'd', 'c']);
check('label asc', sortRows(syn, 'label', 'asc').map(r => r.id), ['a', 'b', 'c', 'd', 'e']);
check('원본 불변', syn.map(r => r.id), ['a', 'b', 'c', 'd', 'e']);

// ── 선택 행 골든(fixture 값 직접 대조) ──────────────────────────────────
{
  const rows = selectRows(recs, 'MA50', 'val', 'ROTATE');
  check('selectRows 개수', rows.length, 3);
  const src = recs[0].rows.find(r => r.rule === 'MA50' && r.period === 'val' && r.mode === 'ROTATE');
  ok('fixture 행 존재', src !== undefined);
  check('selectRows mdd', rows[0].mdd, src ? src.mdd : NaN);
  check('golden eq-sixth MA50/val/ROTATE calmar', Math.round(rows[0].calmar! * 1e4) / 1e4, 1.6008);
  check('golden stock-heavy mdd', Math.round(rows[1].mdd! * 1e4) / 1e4, -0.14);
  const none = selectRows(recs, 'MA50', 'val', 'ROTATE').map(r => r.id);
  check('id 순서 보존', none, ['eq-sixth', 'stock-heavy', 'xss']);
  const miss = selectRows([{ ...recs[0], rows: [] }], 'MA50', 'val', 'ROTATE');
  check('행 없음 -> null', [miss[0].mdd, miss[0].calmar], [null, null]);
}
{
  // 기본 화면 정렬(Calmar 내림차순) 명시 골든: 표 본문 행 순서
  const sorted = sortRows(selectRows(recs, 'MA50', 'val', 'ROTATE'), 'calmar', 'desc').map(r => r.id);
  check('기본 정렬 골든', sorted, GOLDEN_ORDER());
}
function GOLDEN_ORDER(): string[] { return ['eq-sixth', 'stock-heavy', 'xss']; }

// ── HTML 구조 ───────────────────────────────────────────────────────────
const html = buildIndexHtml(recs);
ok('doctype', html.startsWith('<!doctype html>'));
ok('lang=ko', html.includes('<html lang="ko">'));
ok('경고 배너', html.includes('사후 탐색용 · 채택 판정 불가 · 투자 조언 아님'));
ok('viewport', html.includes('name="viewport"'));
ok('다크 모드 CSS', html.includes('prefers-color-scheme:dark'));
for (const sec of ['id="sets"', 'id="compare"', 'id="scatter-sec"', 'id="limits"', 'id="cmp"', 'id="scatter"', 'id="records-data"']) ok(`섹션 ${sec}`, html.includes(sec));
for (const id of ['eq-sixth', 'stock-heavy', 'xss']) ok(`상세 링크 ${id}`, html.includes(`href="./${id}.html"`));
ok('기본 선택 MA50', html.includes('<option value="MA50" selected>'));
ok('기본 구간 val', html.includes('<option value="val" selected>'));
ok('기본 모드 ROTATE', html.includes('<option value="ROTATE" selected>'));
ok('B&H 기준점 마커', html.includes('class="bh"'));
ok('외부 리소스 없음', !/(src|href)="https?:/.test(html) && !html.includes('@import'));
ok('Calmar 정렬 표시', html.includes('data-key="calmar" aria-sort="descending"'));
{
  // 서버측 본문 행 순서 == 골든
  const body = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
  const order = [...body.matchAll(/href="\.\/([^"]+)\.html"/g)].map(m => m[1]);
  check('서버 렌더 표 순서', order, GOLDEN_ORDER());
}

// ── 이스케이프(주입 라벨) ───────────────────────────────────────────────
{
  const evil = '<script>alert(1)</script> & "q"';
  ok('원문 스크립트 태그 없음', !html.includes('<script>alert(1)'));
  ok('escape된 라벨 존재', html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;'));
  const data = html.slice(html.indexOf('id="records-data">') + 18, html.indexOf('</script>', html.indexOf('id="records-data">')));
  ok('내장 JSON에 < 없음', !data.includes('<'));
  const back = JSON.parse(data) as ReportRecord[];
  check('내장 JSON 왕복 라벨', back[2].label, evil);
  check('내장 JSON 개수', back.length, 3);
  const scriptTags = (html.match(/<script/g) ?? []).length;
  check('script 태그는 정확히 2개(데이터+코드)', scriptTags, 2);
}

// ── 빈 목록 ─────────────────────────────────────────────────────────────
{
  const e = buildIndexHtml([]);
  ok('빈: 배너 유지', e.includes('사후 탐색용 · 채택 판정 불가 · 투자 조언 아님'));
  ok('빈: 안내 문구', e.includes('저장된 결과가 없습니다'));
  ok('빈: 한계 섹션 유지', e.includes('id="limits"'));
  ok('빈: 표/산점도 없음', !e.includes('id="cmp"') && !e.includes('<svg'));
  ok('빈: JSON []', e.includes('id="records-data">[]</script>'));
}

console.log(`\n통과 ${pass} / 실패 ${fail}`);
if (fail > 0) process.exit(1);
