// scripts/backtest/core6SignalRotationV3/reports/render.ts
// 결과 레코드 → 단일 HTML(외부 리소스 없음, 인라인 CSS/SVG, 라이트·다크, 모바일 폭). 사후 탐색용.

import { ASSET_CODES, SIGNAL_RULES } from '../types';
import type { ReportMode, ReportPeriod, ReportRecord, ReportRow } from './record';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 소수 → 퍼센트 문자열(기본 2자리). NaN/Infinity/null → 'n/a'. 음수는 ASCII '-'. */
export function fmtPct(v: number | null | undefined, d = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  return `${(v * 100).toFixed(d)}%`;
}
/** 부호 있는 퍼센트포인트 차이: '+2.90%p' / '-1.20%p'. */
export function fmtPp(v: number | null | undefined, d = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  const x = v * 100;
  return `${x >= 0 ? '+' : ''}${x.toFixed(d)}%p`;
}
/** 부호 있는 퍼센트: '+41.80%'. */
export function fmtSignedPct(v: number | null | undefined, d = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  const x = v * 100;
  return `${x >= 0 ? '+' : ''}${x.toFixed(d)}%`;
}
export function fmtNum(v: number | null | undefined, d = 2): string {
  if (v === null || v === undefined) return '-';
  if (Number.isNaN(v)) return 'n/a';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞';
  return v.toFixed(d);
}
export function fmtWon(v: number): string {
  if (!Number.isFinite(v)) return 'n/a';
  return `${Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;
}

const PERIOD_LABEL: Record<ReportPeriod, string> = { dev: '개발 구간', val: '시험 구간', full: '전체 구간' };

function findRow(rows: readonly ReportRow[], rule: string, period: ReportPeriod, mode: ReportMode): ReportRow | undefined {
  return rows.find(r => r.rule === rule && r.period === period && r.mode === mode);
}

function tone(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return 'na';
  return v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero';
}

const CSS = `
:root{--bg:#f7f8fa;--fg:#1c2230;--muted:#5d6678;--card:#fff;--line:#dde1e8;--pos:#0b7a43;--posbg:#e3f4ea;--neg:#b3261e;--negbg:#fbe7e5;--warn:#7a4b00;--warnbg:#fff1d6;--warnline:#e3a93a;--bar:#3b6fd4;--bar2:#9aa5b8}
@media (prefers-color-scheme:dark){:root{--bg:#12151c;--fg:#e6e9ef;--muted:#9aa3b5;--card:#1b202a;--line:#2e3543;--pos:#5fd593;--posbg:#173325;--neg:#ff8a80;--negbg:#3a1d1b;--warn:#ffd88a;--warnbg:#3a2c0f;--warnline:#8a6416;--bar:#6e9bff;--bar2:#5d6678}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI","Malgun Gothic",sans-serif}
main{max-width:980px;margin:0 auto;padding:16px}h1{font-size:1.4rem;margin:.2em 0}h2{font-size:1.1rem;margin:1.6em 0 .5em}h3{font-size:1rem;margin:1.2em 0 .4em}
.sub{color:var(--muted);font-size:.85rem}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:10px 0}
.banner{background:var(--warnbg);color:var(--warn);border:1px solid var(--warnline);border-radius:10px;padding:10px 14px;font-weight:600;margin:12px 0}
.wrow{display:grid;grid-template-columns:minmax(120px,260px) 1fr 70px;gap:8px;align-items:center;margin:4px 0;font-size:.88rem}
.wbar{background:var(--line);border-radius:5px;height:14px;overflow:hidden}.wbar i{display:block;height:100%;background:var(--bar)}
.wcap{color:var(--muted);font-size:.78rem}
.tw{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.84rem;font-variant-numeric:tabular-nums}
th,td{border-bottom:1px solid var(--line);padding:5px 8px;text-align:right;white-space:nowrap}th:first-child,td:first-child,th:nth-child(2),td:nth-child(2){text-align:left}
thead th{color:var(--muted);font-weight:600}.pos{color:var(--pos);background:var(--posbg)}.neg{color:var(--neg);background:var(--negbg)}.na,.zero{color:var(--muted)}
ul{padding-left:1.2em;margin:.3em 0}li{margin:.2em 0}code{font-size:.85em;word-break:break-all}
svg text{fill:var(--fg);font-size:11px}.b1{fill:var(--bar2)}.b2{fill:var(--bar)}
@media (max-width:560px){main{padding:12px}.wrow{grid-template-columns:1fr 70px}.wrow .wbar{grid-column:1/-1;order:3}}
`;

function weightBars(rec: ReportRecord): string {
  return ASSET_CODES.map(c => {
    const w = rec.weights[c];
    const cap = rec.caps[c];
    const name = rec.assetNames[c] ?? c;
    const style = ` style="width:${Math.max(0, Math.min(100, w * 100)).toFixed(2)}%"`;
    return (
      `<div class="wrow"><div>${escapeHtml(name)} <span class="wcap">${escapeHtml(c)}${cap !== undefined ? ` · 상한 ${fmtPct(cap, 1)}` : ' · 제외'}</span></div>` +
      `<div class="wbar"><i${style}></i></div><div>${fmtPct(w, 2)}</div></div>`
    );
  }).join('\n');
}

function summaryTable(rec: ReportRecord): string {
  const head =
    '<thead><tr><th>규칙</th><th>방식</th><th>B&amp;H MDD</th><th>MDD</th><th>B&amp;H 대비 MDD 축소</th><th>B&amp;H CAGR</th><th>CAGR</th><th>CAGR 차이</th></tr></thead>';
  const body: string[] = [];
  for (const rule of SIGNAL_RULES) {
    const bh = findRow(rec.rows, rule, 'val', 'BH');
    for (const mode of ['CASH', 'ROTATE'] as ReportMode[]) {
      const r = findRow(rec.rows, rule, 'val', mode);
      if (!r || !bh) continue;
      body.push(
        `<tr><td>${escapeHtml(rule)}</td><td>${mode}</td><td>${fmtPct(bh.mdd)}</td><td>${fmtPct(r.mdd)}</td>` +
          `<td class="${tone(r.mddReductionVsBH)}">${fmtSignedPct(r.mddReductionVsBH, 1)}</td>` +
          `<td>${fmtPct(bh.cagr)}</td><td>${fmtPct(r.cagr)}</td><td class="${tone(r.cagrDiffVsBH)}">${fmtPp(r.cagrDiffVsBH)}</td></tr>`,
      );
    }
  }
  if (body.length === 0) return '<p class="sub">시험 구간 데이터가 없습니다.</p>';
  return `<div class="tw"><table>${head}<tbody>${body.join('')}</tbody></table></div>`;
}

/** 시험 구간 ROTATE vs B&H: MDD(절대값)와 CAGR 가로 막대. */
function chart(rec: ReportRecord): string {
  const pairs: { rule: string; bh: ReportRow; ro: ReportRow }[] = [];
  for (const rule of SIGNAL_RULES) {
    const bh = findRow(rec.rows, rule, 'val', 'BH');
    const ro = findRow(rec.rows, rule, 'val', 'ROTATE');
    if (bh && ro) pairs.push({ rule, bh, ro });
  }
  if (pairs.length === 0) return '';
  const maxV = Math.max(0.01, ...pairs.flatMap(p => [Math.abs(p.bh.mdd), Math.abs(p.ro.mdd), Math.abs(p.bh.cagr), Math.abs(p.ro.cagr)]));
  const W = 560;
  const x0 = 70;
  const scale = (W - x0 - 100) / maxV;
  const rowH = 14;
  let y = 16;
  const parts: string[] = [];
  const block = (title: string, pick: (r: ReportRow) => number): void => {
    parts.push(`<text x="0" y="${y}" font-weight="bold">${escapeHtml(title)}</text>`);
    y += 6;
    for (const p of pairs) {
      const items: [ReportRow, string, string][] = [
        [p.bh, 'b1', 'B&amp;H'],
        [p.ro, 'b2', 'ROT'],
      ];
      for (const [r, cls, lab] of items) {
        const v = Math.abs(pick(r));
        parts.push(
          `<text x="0" y="${y + 11}">${lab === 'ROT' ? '' : escapeHtml(p.rule)}</text>` +
            `<rect class="${cls}" x="${x0}" y="${y}" width="${(v * scale).toFixed(1)}" height="${rowH - 3}"/>` +
            `<text x="${(x0 + v * scale + 4).toFixed(1)}" y="${y + 10}">${lab} ${fmtPct(pick(r), 1)}</text>`,
        );
        y += rowH;
      }
      y += 3;
    }
    y += 10;
  };
  block('시험 구간 MDD (막대 길이 = 낙폭 크기)', r => r.mdd);
  block('시험 구간 CAGR', r => r.cagr);
  return `<svg viewBox="0 0 ${W} ${y}" width="100%" role="img" aria-label="시험 구간 MDD와 CAGR 막대 비교">${parts.join('')}</svg>`;
}

function detailTable(rec: ReportRecord, period: ReportPeriod): string {
  const rows = rec.rows.filter(r => r.period === period);
  if (rows.length === 0) return '<p class="sub">이 구간에는 데이터가 없습니다.</p>';
  const head =
    '<thead><tr><th>규칙</th><th>방식</th><th>CAGR</th><th>MDD</th><th>Calmar</th><th>변동성</th><th>최종자산</th><th>MDD 축소</th><th>CAGR 차이</th>' +
    (period !== 'dev' ? '<th>회전율</th><th>매도</th><th>재진입</th>' : '') +
    '</tr></thead>';
  const body = rows.map(r => {
    const extra = period !== 'dev' ? `<td>${fmtNum(r.turnover)}</td><td>${r.sells ?? '-'}</td><td>${r.reentries ?? '-'}</td>` : '';
    return (
      `<tr><td>${escapeHtml(r.rule)}</td><td>${escapeHtml(r.mode)}</td><td>${fmtPct(r.cagr)}</td><td>${fmtPct(r.mdd)}</td><td>${fmtNum(r.calmar)}</td>` +
      `<td>${fmtPct(r.vol)}</td><td>${fmtWon(r.finalEquity)}</td><td class="${tone(r.mddReductionVsBH)}">${fmtSignedPct(r.mddReductionVsBH, 1)}</td>` +
      `<td class="${tone(r.cagrDiffVsBH)}">${fmtPp(r.cagrDiffVsBH)}</td>${extra}</tr>`
    );
  });
  return `<div class="tw"><table>${head}<tbody>${body.join('')}</tbody></table></div>`;
}

export interface RenderInfo {
  /** 레코드 JSON 의 sha256 등 호출자가 계산한 해시. */
  recordHash: string;
  generatedAt: string;
  panelSha256?: string;
}

export function renderReport(rec: ReportRecord, info: RenderInfo): string {
  const per = rec.periods;
  const wlist = ASSET_CODES.filter(c => rec.weights[c] > 0)
    .map(c => `${escapeHtml(c)} ${fmtPct(rec.weights[c], 1)}`)
    .join(' / ');
  const warnings = rec.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('');
  const detail = (['val', 'dev', 'full'] as ReportPeriod[])
    .map(p => `<h3>${PERIOD_LABEL[p]} <span class="sub">${escapeHtml(per[p].start)} ~ ${escapeHtml(per[p].end)}</span></h3>${detailTable(rec, p)}`)
    .join('');
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(rec.label)} - 코어6 V3 비중 결과</title><style>${CSS}</style></head>
<body><main>
<section id="title"><h1>${escapeHtml(rec.label)} <span class="sub">(${escapeHtml(rec.id)} · 패널 ${escapeHtml(rec.panel)})</span></h1>
<div class="sub">${wlist}</div></section>
<div class="banner" id="warning" role="alert">사후 탐색용 · 채택 판정 불가</div>
<section id="weights" class="card"><h2 style="margin-top:0">비중</h2>${weightBars(rec)}</section>
<section id="summary"><h2>요약 — 시험 구간(${escapeHtml(per.val.start)} ~ ${escapeHtml(per.val.end)}) 기준 B&amp;H 대비</h2>
<p class="sub">초록 = B&amp;H보다 MDD가 줄었거나 CAGR이 높음, 빨강 = 반대. 색은 부호만 표시하며 합격·불합격 판정이 아닙니다.</p>
<div class="card">${summaryTable(rec)}</div><div class="card">${chart(rec)}</div></section>
<section id="detail"><h2>상세 — 규칙 × 구간 × 방식</h2><div class="card">${detail}</div></section>
<section id="limits"><h2>설정 · 한계</h2><div class="card"><ul>
<li>편도 거래비용 ${fmtPct(rec.config.costOneWay)}, 세전(세금 미반영), 초기자본 ${fmtWon(rec.config.initialCapital)}.</li>
<li>자산별 상한 = min(${rec.config.capMultiplier}×비중, ${fmtPct(rec.config.capAbsolute, 0)}). ${escapeHtml(rec.config.cashRule)}.</li>
<li>시험 구간은 약 2년으로 짧고 한 번의 시장 환경입니다. 우연과 구분하기 어렵습니다.</li>
<li>464470 상장 전 구간은 합성 가격이 포함될 수 있습니다(패널 P). 패널 P5는 해당 자산을 제외합니다.</li>
<li>비중을 결과를 본 뒤 고르면 과최적화입니다. 사전등록 §15 판정과 선택 잠금은 이 문서로 바뀌지 않습니다.</li>
</ul><ul>${warnings}</ul></div></section>
<section id="meta"><h2>생성 정보</h2><div class="card sub">
생성 ${escapeHtml(info.generatedAt)} · 레코드 생성 ${escapeHtml(rec.createdAt)}<br>
레코드 sha256 <code>${escapeHtml(info.recordHash)}</code>${info.panelSha256 ? `<br>패널 sha256 <code>${escapeHtml(info.panelSha256)}</code>` : ''}
</div></section>
</main></body></html>
`;
}
