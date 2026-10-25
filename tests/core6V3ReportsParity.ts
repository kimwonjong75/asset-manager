// tests/core6V3ReportsParity.ts
// 코어 6종 V3 — 비중별 결과 리포트(reports/record.ts, render.ts) 오프라인 골든. 합성 레코드만 사용(실제 패널을 읽지 않는다).

import { strict as assert } from 'assert';
import { ASSET_CODES } from '../scripts/backtest/core6SignalRotationV3/types';
import type { AssetCode, Panel } from '../scripts/backtest/core6SignalRotationV3/types';
import { buildRecord, computeCaps, isSafeId, REPORT_WARNING } from '../scripts/backtest/core6SignalRotationV3/reports/record';
import type { ReportRecord, ReportRow } from '../scripts/backtest/core6SignalRotationV3/reports/record';
import { escapeHtml, fmtNum, fmtPct, fmtPp, fmtSignedPct, fmtWon, renderReport } from '../scripts/backtest/core6SignalRotationV3/reports/render';
import { parseWeightsArg } from '../scripts/backtest/core6SignalRotationV3/reports/build';

let checks = 0;
function eq<T>(actual: T, expected: T, label: string): void {
  checks += 1;
  assert.deepStrictEqual(actual, expected, label);
}
function ok(cond: boolean, label: string): void {
  checks += 1;
  assert.ok(cond, label);
}

// ── 숫자 포맷 골든 ──
eq(fmtPct(0.2654), '26.54%', 'fmtPct');
eq(fmtPct(-0.12124405), '-12.12%', 'fmtPct 음수');
eq(fmtPct(0.35, 0), '35%', 'fmtPct 0자리');
eq(fmtPct(NaN), 'n/a', 'fmtPct NaN');
eq(fmtPct(null), 'n/a', 'fmtPct null');
eq(fmtPp(0.0291), '+2.91%p', 'fmtPp +');
eq(fmtPp(-0.0252), '-2.52%p', 'fmtPp -');
eq(fmtSignedPct(0.4185, 1), '+41.9%', 'fmtSignedPct');
eq(fmtNum(2.1889), '2.19', 'fmtNum');
eq(fmtNum(null), '-', 'fmtNum null');
eq(fmtNum(Infinity), '∞', 'fmtNum inf');
eq(fmtWon(169741160.18), '169,741,160원', 'fmtWon');
eq(escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;', 'escapeHtml');

// ── id / 상한 / 인자 ──
eq(isSafeId('W0'), true, 'id W0');
eq(isSafeId('custom-20261023-1530'), true, 'id custom');
eq(isSafeId('../x'), false, 'id traversal');
eq(isSafeId('a b'), false, 'id 공백');
const w0: Record<AssetCode, number> = { '069500': 0.17, '379800': 0.17, '283580': 0.16, '385560': 0.125, '464470': 0.125, '411060': 0.25 };
const caps = computeCaps(w0);
eq(Math.round(caps['069500'] * 1e6) / 1e6, 0.255, '상한 1.5w');
eq(caps['411060'], 0.35, '상한 35% 캡');
eq(computeCaps({ ...w0, '464470': 0, '411060': 0.375 })['464470'], undefined, '0 비중 제외');
eq(parseWeightsArg('0.17,0.17,0.16,0.125,0.125,0.25')['411060'], 0.25, 'parseWeights');
assert.throws(() => parseWeightsArg('0.5,0.5'), /--weights/);
checks += 1;

// ── 합 검증 throw (합성 최소 패널) ──
const emptyBars = (code: AssetCode): Panel['assets'][AssetCode] => ({ code, open: [], high: [], low: [], close: [], fresh: [], source: [] });
const panelStub = { dates: [], assets: Object.fromEntries(ASSET_CODES.map(c => [c, { ...emptyBars(c), source: ['actual'] }])) } as unknown as Panel;
assert.throws(
  () =>
    buildRecord({
      panelName: 'P',
      panel: panelStub,
      cache: {} as never,
      cd91: [],
      weights: { ...w0, '411060': 0.3 },
      id: 'bad',
      label: 'bad',
    }),
  /비중 합/,
);
checks += 1;
assert.throws(
  () => buildRecord({ panelName: 'P', panel: panelStub, cache: {} as never, cd91: [], weights: w0, id: '../evil', label: 'x' }),
  /id 오류/,
);
checks += 1;

// ── 합성 레코드 렌더 ──
const mkRow = (rule: ReportRow['rule'], period: ReportRow['period'], mode: ReportRow['mode'], over: Partial<ReportRow> = {}): ReportRow => ({
  rule,
  period,
  mode,
  cagr: 0.2654,
  mdd: -0.1212,
  calmar: 2.19,
  vol: 0.144,
  finalEquity: 169741160,
  turnover: null,
  sells: null,
  reentries: null,
  mddReductionVsBH: mode === 'BH' ? null : 0.4185,
  cagrDiffVsBH: mode === 'BH' ? null : 0.0291,
  ...over,
});
const rows: ReportRow[] = [];
for (const period of ['dev', 'val', 'full'] as const) {
  for (const mode of ['BH', 'CASH', 'ROTATE'] as const) rows.push(mkRow('MA50', period, mode));
}
rows.push(mkRow('D55/55', 'val', 'BH'), mkRow('D55/55', 'val', 'ROTATE', { mddReductionVsBH: -0.1, cagrDiffVsBH: -0.02 }));
const rec: ReportRecord = {
  schemaVersion: 1,
  id: 'T1',
  label: '<b>테스트&</b>',
  createdAt: '2026-10-23T00:00:00.000Z',
  panel: 'P',
  weights: w0,
  assetNames: { '069500': 'KODEX 200', '379800': '<script>alert(1)</script>' },
  caps,
  config: { costOneWay: 0.001, capMultiplier: 1.5, capAbsolute: 0.35, initialCapital: 100000000, cashRule: 'CD91 - 0.25%p' },
  periods: {
    dev: { start: '2022-01-17', end: '2024-06-28' },
    val: { start: '2024-07-01', end: '2026-09-30' },
    full: { start: '2022-01-17', end: '2026-09-30' },
  },
  rows,
  warnings: [REPORT_WARNING],
};
const html = renderReport(rec, { recordHash: 'abc123', generatedAt: '2026-10-23T01:00:00.000Z', panelSha256: 'def456' });
for (const id of ['id="title"', 'id="warning"', 'id="weights"', 'id="summary"', 'id="detail"', 'id="limits"', 'id="meta"']) ok(html.includes(id), `섹션 ${id}`);
ok(html.includes('사후 탐색용 · 채택 판정 불가'), '경고 배너');
ok(html.includes('사후 탐색용 — 채택 판정 불가'), '레코드 경고 문구');
ok(!html.includes('<script>alert'), 'script 이스케이프');
ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'script 이스케이프 결과');
ok(html.includes('&lt;b&gt;테스트&amp;&lt;/b&gt;'), '라벨 이스케이프');
ok(html.includes('+41.9%') && html.includes('+2.91%p'), '요약 수치 골든');
ok(html.includes('class="neg">-10.0%') && html.includes('-2.00%p'), '음수 색 neg');
ok(html.includes('-12.12%') && html.includes('26.54%'), '상세 수치 골든');
ok(html.includes('169,741,160원'), '원화 포맷');
ok(html.includes('abc123') && html.includes('def456'), '생성 정보 해시');
ok(html.includes('prefers-color-scheme:dark') && html.includes('name="viewport"'), '다크·모바일');
ok(!/<script/i.test(html) && !/https?:\/\//i.test(html), '외부 리소스·스크립트 없음');
ok(html.includes('<svg'), '인라인 SVG');
eq(html.startsWith('<!doctype html>'), true, 'doctype');

process.stdout.write(`core6V3ReportsParity: ${checks} checks passed\n`);
