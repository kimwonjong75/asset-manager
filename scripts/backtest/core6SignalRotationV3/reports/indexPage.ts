// scripts/backtest/core6SignalRotationV3/reports/indexPage.ts
// 코어 6종 V3 — 결과 목록·비교 화면(단일 HTML) 생성. 순수 함수 buildIndexHtml + CLI.
// 실행: npx tsx scripts/backtest/core6SignalRotationV3/reports/indexPage.ts
//   reports/out/records/*.json -> reports/out/index.html (상세 링크 ./<id>.html)
// 외부 라이브러리·네트워크 없음. 레코드는 <script type="application/json">으로 내장.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// record.ts(별도 작업)의 ReportRecord와 구조가 동일한 계약 타입. 구조적 타이핑으로 호환된다.
export type RuleName = 'D10/55' | 'D20/55' | 'D55/55' | 'MA20' | 'MA50' | 'ATR3/55';
export type PeriodName = 'dev' | 'val' | 'full';
export type ModeName = 'BH' | 'CASH' | 'ROTATE';
export type AssetCode = '069500' | '379800' | '283580' | '385560' | '464470' | '411060';

export interface ReportRow {
  rule: RuleName;
  period: PeriodName;
  mode: ModeName;
  cagr: number; mdd: number; calmar: number; vol: number; finalEquity: number;
  turnover: number | null; sells: number | null; reentries: number | null;
  mddReductionVsBH: number | null; cagrDiffVsBH: number | null;
}

export interface ReportRecord {
  schemaVersion: 1;
  id: string; label: string; createdAt: string;
  panel: 'P' | 'P5';
  weights: Record<AssetCode, number>;
  assetNames: Record<string, string>;
  caps: Record<string, number>;
  config: { costOneWay: number; capMultiplier: number; capAbsolute: number; initialCapital: number; cashRule: string };
  periods: { dev: { start: string; end: string }; val: { start: string; end: string }; full: { start: string; end: string } };
  rows: ReportRow[];
  warnings: string[];
}

export type SortKey = 'label' | 'mdd' | 'cagr' | 'calmar' | 'mddReductionVsBH' | 'cagrDiffVsBH';
export type SortDir = 'asc' | 'desc';

export interface CompareRow {
  id: string; label: string;
  mdd: number | null; cagr: number | null; calmar: number | null;
  mddReductionVsBH: number | null; cagrDiffVsBH: number | null;
}

export const RULES: RuleName[] = ['D10/55', 'D20/55', 'D55/55', 'MA20', 'MA50', 'ATR3/55'];
export const PERIOD_LABEL: Record<PeriodName, string> = { dev: '개발(dev)', val: '시험(val)', full: '전체(full)' };
export const MODE_LABEL: Record<ModeName, string> = { BH: 'B&H', CASH: '현금 대피', ROTATE: '로테이션' };
export const DEFAULT_RULE: RuleName = 'MA50';
export const DEFAULT_PERIOD: PeriodName = 'val';
export const DEFAULT_MODE: ModeName = 'ROTATE';
export const DEFAULT_SORT: { key: SortKey; dir: SortDir } = { key: 'calmar', dir: 'desc' };

const ASSET_ORDER: AssetCode[] = ['069500', '379800', '283580', '385560', '464470', '411060'];
const ASSET_COLORS = ['#4e79a7', '#59a14f', '#e15759', '#76b7b2', '#b07aa1', '#edc948'];

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** JSON을 <script> 안에 안전하게 싣기 위한 직렬화(< > & 및 줄구분자 이스케이프). */
export function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function fmtPct(v: number | null, digits = 1): string {
  return v === null || !Number.isFinite(v) ? '–' : `${(v * 100).toFixed(digits)}%`;
}
export function fmtPp(v: number | null, digits = 1): string {
  if (v === null || !Number.isFinite(v)) return '–';
  const s = (v * 100).toFixed(digits);
  return `${v > 0 ? '+' : ''}${s}%p`;
}
export function fmtNum(v: number | null, digits = 2): string {
  return v === null || !Number.isFinite(v) ? '–' : v.toFixed(digits);
}

/** 선택된 규칙·구간·모드의 세트별 비교 행. 해당 행이 없으면 지표는 null. */
export function selectRows(records: ReportRecord[], rule: RuleName, period: PeriodName, mode: ModeName): CompareRow[] {
  return records.map(r => {
    const row = r.rows.find(x => x.rule === rule && x.period === period && x.mode === mode);
    return {
      id: r.id, label: r.label,
      mdd: row ? row.mdd : null, cagr: row ? row.cagr : null, calmar: row ? row.calmar : null,
      mddReductionVsBH: row ? row.mddReductionVsBH : null, cagrDiffVsBH: row ? row.cagrDiffVsBH : null,
    };
  });
}

/** 정렬. null은 방향과 무관하게 항상 마지막. 동률은 label(ko) -> id 순. mdd는 값 그대로(0에 가까울수록 큼). */
export function sortRows(rows: CompareRow[], key: SortKey, dir: SortDir): CompareRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'label') {
      const c = a.label.localeCompare(b.label, 'ko');
      return c !== 0 ? sign * c : a.id.localeCompare(b.id);
    }
    const av = a[key], bv = b[key];
    if (av === null && bv === null) return a.id.localeCompare(b.id);
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av !== bv) return sign * (av < bv ? -1 : 1);
    const c = a.label.localeCompare(b.label, 'ko');
    return c !== 0 ? c : a.id.localeCompare(b.id);
  });
}

function weightBar(r: ReportRecord): string {
  const segs = ASSET_ORDER.map((code, i) => {
    const w = r.weights[code] ?? 0;
    if (!(w > 0)) return '';
    const name = r.assetNames[code] ?? code;
    return `<span class="seg" style="width:${(w * 100).toFixed(2)}%;background:${ASSET_COLORS[i]}" title="${escapeHtml(`${name} ${fmtPct(w)}`)}"></span>`;
  }).join('');
  return `<div class="wbar" role="img" aria-label="비중 막대">${segs}</div>`;
}

function weightLegend(r: ReportRecord): string {
  return ASSET_ORDER.map((code, i) => {
    const w = r.weights[code] ?? 0;
    const name = r.assetNames[code] ?? code;
    return `<li><i style="background:${ASSET_COLORS[i]}"></i>${escapeHtml(name)} <b>${fmtPct(w)}</b></li>`;
  }).join('');
}

function cardsHtml(records: ReportRecord[]): string {
  if (records.length === 0) return '<p class="empty">저장된 결과가 없습니다. 먼저 백테스트 결과 레코드를 생성하세요.</p>';
  const items = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)).map(r => `
    <article class="card">
      <h3>${escapeHtml(r.label)}</h3>
      <p class="meta">패널 ${escapeHtml(r.panel)} · 생성 ${escapeHtml(r.createdAt.slice(0, 10))}</p>
      ${weightBar(r)}
      <ul class="legend">${weightLegend(r)}</ul>
      <a class="btn" href="./${encodeURIComponent(r.id)}.html">상세 보기</a>
    </article>`).join('');
  return `<div class="cards">${items}</div>`;
}

function tableBodyHtml(rows: CompareRow[]): string {
  return rows.map(r => `<tr><th scope="row"><a href="./${encodeURIComponent(r.id)}.html">${escapeHtml(r.label)}</a></th>`
    + `<td class="n">${fmtPct(r.mdd)}</td><td class="n">${fmtPct(r.cagr)}</td><td class="n">${fmtNum(r.calmar)}</td>`
    + `<td class="n">${fmtPct(r.mddReductionVsBH)}</td><td class="n">${fmtPp(r.cagrDiffVsBH)}</td></tr>`).join('');
}

const COLS: Array<{ key: SortKey; title: string }> = [
  { key: 'label', title: '비중 세트' }, { key: 'mdd', title: 'MDD' }, { key: 'cagr', title: 'CAGR' },
  { key: 'calmar', title: 'Calmar' }, { key: 'mddReductionVsBH', title: 'B&H 대비 MDD 축소' }, { key: 'cagrDiffVsBH', title: 'B&H 대비 CAGR 차이' },
];

function compareHtml(records: ReportRecord[]): string {
  if (records.length === 0) return '<p class="empty">비교할 결과가 없습니다.</p>';
  const rows = sortRows(selectRows(records, DEFAULT_RULE, DEFAULT_PERIOD, DEFAULT_MODE), DEFAULT_SORT.key, DEFAULT_SORT.dir);
  const opt = <T extends string>(vals: T[], labels: Record<string, string> | null, sel: T): string =>
    vals.map(v => `<option value="${escapeHtml(v)}"${v === sel ? ' selected' : ''}>${escapeHtml(labels ? labels[v] : v)}</option>`).join('');
  const head = COLS.map(c => {
    const active = c.key === DEFAULT_SORT.key;
    return `<th scope="col" class="sortable" data-key="${c.key}" aria-sort="${active ? (DEFAULT_SORT.dir === 'asc' ? 'ascending' : 'descending') : 'none'}" tabindex="0">${escapeHtml(c.title)}<span class="arrow">${active ? (DEFAULT_SORT.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span></th>`;
  }).join('');
  return `
    <div class="controls">
      <label>규칙 <select id="sel-rule">${opt(RULES, null, DEFAULT_RULE)}</select></label>
      <label>구간 <select id="sel-period">${opt<PeriodName>(['dev', 'val', 'full'], PERIOD_LABEL, DEFAULT_PERIOD)}</select></label>
      <label>모드 <select id="sel-mode">${opt<ModeName>(['BH', 'CASH', 'ROTATE'], MODE_LABEL, DEFAULT_MODE)}</select></label>
    </div>
    <p class="meta" id="sel-desc">${escapeHtml(DEFAULT_RULE)} · ${escapeHtml(PERIOD_LABEL[DEFAULT_PERIOD])} · ${escapeHtml(MODE_LABEL[DEFAULT_MODE])} (JS가 꺼져 있으면 이 기본 선택만 표시됩니다)</p>
    <div class="tablewrap"><table id="cmp"><thead><tr>${head}</tr></thead><tbody>${tableBodyHtml(rows)}</tbody></table></div>`;
}

// ── 산점도(서버측 폴백 렌더) ─────────────────────────────────────────────
const SW = 560, SH = 340, PADL = 52, PADR = 16, PADT = 14, PADB = 40;

function niceMax(v: number): number {
  if (!(v > 0)) return 0.1;
  const step = v > 0.5 ? 0.1 : 0.05;
  return Math.ceil(v / step) * step;
}

interface Pt { id: string; label: string; x: number; y: number; bx: number | null; by: number | null }

function scatterPoints(records: ReportRecord[], rule: RuleName, period: PeriodName, mode: ModeName): Pt[] {
  const out: Pt[] = [];
  for (const r of records) {
    const row = r.rows.find(x => x.rule === rule && x.period === period && x.mode === mode);
    if (!row) continue;
    const bh = r.rows.find(x => x.period === period && x.mode === 'BH' && x.rule === rule) ?? r.rows.find(x => x.period === period && x.mode === 'BH');
    out.push({ id: r.id, label: r.label, x: -row.mdd, y: row.cagr, bx: bh ? -bh.mdd : null, by: bh ? bh.cagr : null });
  }
  return out;
}

function scatterSvg(records: ReportRecord[]): string {
  const pts = scatterPoints(records, DEFAULT_RULE, DEFAULT_PERIOD, DEFAULT_MODE);
  const xs = pts.flatMap(p => [p.x, p.bx ?? 0]);
  const ys = pts.flatMap(p => [p.y, p.by ?? 0]);
  const xMax = niceMax(Math.max(0, ...xs)), yMax = niceMax(Math.max(0, ...ys));
  const yMin = Math.min(0, ...ys);
  const px = (v: number): number => PADL + (v / xMax) * (SW - PADL - PADR);
  const py = (v: number): number => PADT + (1 - (v - yMin) / (yMax - yMin)) * (SH - PADT - PADB);
  const grid: string[] = [];
  for (let i = 0; i <= 4; i++) {
    const xv = (xMax * i) / 4, yv = yMin + ((yMax - yMin) * i) / 4;
    grid.push(`<line class="grid" x1="${px(xv).toFixed(1)}" y1="${PADT}" x2="${px(xv).toFixed(1)}" y2="${SH - PADB}"/><text class="tick" x="${px(xv).toFixed(1)}" y="${SH - PADB + 16}" text-anchor="middle">${(xv * 100).toFixed(0)}%</text>`);
    grid.push(`<line class="grid" x1="${PADL}" y1="${py(yv).toFixed(1)}" x2="${SW - PADR}" y2="${py(yv).toFixed(1)}"/><text class="tick" x="${PADL - 6}" y="${(py(yv) + 4).toFixed(1)}" text-anchor="end">${(yv * 100).toFixed(0)}%</text>`);
  }
  const marks = pts.map(p => {
    const line = p.bx !== null && p.by !== null ? `<line class="link" x1="${px(p.bx).toFixed(1)}" y1="${py(p.by).toFixed(1)}" x2="${px(p.x).toFixed(1)}" y2="${py(p.y).toFixed(1)}"/>` : '';
    const bh = p.bx !== null && p.by !== null ? `<circle class="bh" cx="${px(p.bx).toFixed(1)}" cy="${py(p.by).toFixed(1)}" r="5"><title>${escapeHtml(p.label)} B&amp;H</title></circle>` : '';
    return `${line}${bh}<circle class="pt" cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="6"><title>${escapeHtml(`${p.label}: MDD ${fmtPct(-p.x)} / CAGR ${fmtPct(p.y)}`)}</title></circle><text class="plab" x="${(px(p.x) + 9).toFixed(1)}" y="${(py(p.y) + 4).toFixed(1)}">${escapeHtml(p.label)}</text>`;
  }).join('');
  return `<svg id="scatter" viewBox="0 0 ${SW} ${SH}" role="img" aria-label="MDD 대 CAGR 산점도">${grid.join('')}`
    + `<text class="axis" x="${(PADL + SW - PADR) / 2}" y="${SH - 6}" text-anchor="middle">최대낙폭 크기 (왼쪽일수록 안전)</text>`
    + `<text class="axis" transform="translate(12 ${(PADT + SH - PADB) / 2}) rotate(-90)" text-anchor="middle">CAGR</text>${marks}</svg>`;
}

const CSS = `
:root{--bg:#f7f7f5;--fg:#1c1c1e;--mut:#5f6368;--card:#fff;--bd:#d9d9d4;--acc:#1f5fbf;--warn-bg:#fff3cd;--warn-fg:#664d03;--warn-bd:#e6c867;--pt:#1f5fbf;--bh:#8a8a85}
@media (prefers-color-scheme:dark){:root{--bg:#161618;--fg:#ececec;--mut:#a0a3a8;--card:#202023;--bd:#3a3a3e;--acc:#7fb0ff;--warn-bg:#3a3012;--warn-fg:#f2dc99;--warn-bd:#6b5a1f;--pt:#7fb0ff;--bh:#9a9a95}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI","Malgun Gothic",sans-serif}
.banner{position:sticky;top:0;z-index:5;background:var(--warn-bg);color:var(--warn-fg);border-bottom:1px solid var(--warn-bd);padding:8px 16px;text-align:center;font-weight:700}
main{max-width:1000px;margin:0 auto;padding:16px}
h1{font-size:1.4rem;margin:.6em 0 .2em}h2{font-size:1.15rem;margin:1.8em 0 .6em;border-bottom:1px solid var(--bd);padding-bottom:.3em}
h3{margin:0 0 .2em;font-size:1.02rem;word-break:break-word}
.meta{color:var(--mut);margin:.2em 0;font-size:.88rem}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:12px}
.wbar{display:flex;height:14px;border-radius:7px;overflow:hidden;background:var(--bd);margin:8px 0}.seg{display:block;height:100%}
.legend{list-style:none;margin:0 0 10px;padding:0;font-size:.8rem;color:var(--mut)}
.legend li{display:flex;align-items:center;gap:6px}.legend i{display:inline-block;width:9px;height:9px;border-radius:2px}.legend b{margin-left:auto;color:var(--fg)}
.btn{display:inline-block;padding:6px 12px;border:1px solid var(--acc);border-radius:6px;color:var(--acc);text-decoration:none;font-size:.9rem}
.controls{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:6px}
select{font:inherit;padding:4px 8px;background:var(--card);color:var(--fg);border:1px solid var(--bd);border-radius:6px}
.tablewrap{overflow-x:auto;border:1px solid var(--bd);border-radius:10px;background:var(--card)}
table{border-collapse:collapse;width:100%;min-width:560px}
th,td{padding:8px 10px;border-bottom:1px solid var(--bd);text-align:left}
thead th{cursor:pointer;white-space:nowrap;font-size:.85rem;user-select:none}
tbody th{font-weight:600}tbody tr:last-child>*{border-bottom:0}
td.n{text-align:right;font-variant-numeric:tabular-nums}thead th:not(:first-child){text-align:right}
a{color:var(--acc)}
#scatter{width:100%;height:auto;max-width:640px;background:var(--card);border:1px solid var(--bd);border-radius:10px}
.grid{stroke:var(--bd);stroke-width:1}.tick,.axis,.plab{fill:var(--mut);font-size:11px}.plab{fill:var(--fg)}
.pt{fill:var(--pt)}.bh{fill:none;stroke:var(--bh);stroke-width:2}.link{stroke:var(--bh);stroke-width:1;stroke-dasharray:3 3}
.key{font-size:.85rem;color:var(--mut)}
.limits li{margin:.35em 0}.empty{color:var(--mut);padding:16px;border:1px dashed var(--bd);border-radius:10px}
@media (max-width:520px){main{padding:12px 16px}.banner{font-size:.85rem}}
`;

// 클라이언트 JS: 내장 JSON을 읽어 비교 표·산점도를 재렌더한다. (이 문자열 안에 백틱·달러-중괄호 금지)
const CLIENT_JS = `
(function(){
var el=document.getElementById('records-data');if(!el)return;
var recs;try{recs=JSON.parse(el.textContent||'[]');}catch(e){return;}
var PL={dev:'개발(dev)',val:'시험(val)',full:'전체(full)'},ML={BH:'B&H',CASH:'현금 대피',ROTATE:'로테이션'};
var sel={rule:document.getElementById('sel-rule'),period:document.getElementById('sel-period'),mode:document.getElementById('sel-mode')};
if(!sel.rule||!sel.period||!sel.mode)return;
var state={key:'${DEFAULT_SORT.key}',dir:'${DEFAULT_SORT.dir}'};
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function pct(v,d){return v==null||!isFinite(v)?'–':(v*100).toFixed(d==null?1:d)+'%';}
function pp(v){if(v==null||!isFinite(v))return '–';return (v>0?'+':'')+(v*100).toFixed(1)+'%p';}
function num(v){return v==null||!isFinite(v)?'–':v.toFixed(2);}
function find(r,rule,period,mode){for(var i=0;i<r.rows.length;i++){var x=r.rows[i];if(x.rule===rule&&x.period===period&&x.mode===mode)return x;}return null;}
function rows(){var rule=sel.rule.value,period=sel.period.value,mode=sel.mode.value;
 return recs.map(function(r){var x=find(r,rule,period,mode);return {id:r.id,label:r.label,mdd:x?x.mdd:null,cagr:x?x.cagr:null,calmar:x?x.calmar:null,mddReductionVsBH:x?x.mddReductionVsBH:null,cagrDiffVsBH:x?x.cagrDiffVsBH:null};});}
function sorted(list){var s=state.dir==='asc'?1:-1,k=state.key;
 return list.slice().sort(function(a,b){
  if(k==='label'){var c=a.label.localeCompare(b.label,'ko');return c!==0?s*c:a.id.localeCompare(b.id);}
  var av=a[k],bv=b[k];if(av==null&&bv==null)return a.id.localeCompare(b.id);if(av==null)return 1;if(bv==null)return -1;
  if(av!==bv)return s*(av<bv?-1:1);var c2=a.label.localeCompare(b.label,'ko');return c2!==0?c2:a.id.localeCompare(b.id);});}
function renderTable(){var list=sorted(rows()),h='';
 list.forEach(function(r){h+='<tr><th scope="row"><a href="./'+encodeURIComponent(r.id)+'.html">'+esc(r.label)+'</a></th><td class="n">'+pct(r.mdd)+'</td><td class="n">'+pct(r.cagr)+'</td><td class="n">'+num(r.calmar)+'</td><td class="n">'+pct(r.mddReductionVsBH)+'</td><td class="n">'+pp(r.cagrDiffVsBH)+'</td></tr>';});
 document.querySelector('#cmp tbody').innerHTML=h;
 var ths=document.querySelectorAll('#cmp thead th');
 for(var i=0;i<ths.length;i++){var on=ths[i].getAttribute('data-key')===state.key;ths[i].setAttribute('aria-sort',on?(state.dir==='asc'?'ascending':'descending'):'none');ths[i].querySelector('.arrow').textContent=on?(state.dir==='asc'?' ▲':' ▼'):'';}
 document.getElementById('sel-desc').textContent=sel.rule.value+' · '+PL[sel.period.value]+' · '+ML[sel.mode.value];}
function renderScatter(){var rule=sel.rule.value,period=sel.period.value,mode=sel.mode.value,pts=[];
 recs.forEach(function(r){var x=find(r,rule,period,mode);if(!x)return;var b=find(r,rule,period,'BH');if(!b){for(var i=0;i<r.rows.length;i++){if(r.rows[i].period===period&&r.rows[i].mode==='BH'){b=r.rows[i];break;}}}
  pts.push({label:r.label,x:-x.mdd,y:x.cagr,bx:b?-b.mdd:null,by:b?b.cagr:null});});
 var W=${SW},H=${SH},L=${PADL},R=${PADR},T=${PADT},B=${PADB};
 var xs=[0],ys=[0];pts.forEach(function(p){xs.push(p.x);ys.push(p.y);if(p.bx!=null){xs.push(p.bx);ys.push(p.by);}});
 function nice(v){if(!(v>0))return 0.1;var st=v>0.5?0.1:0.05;return Math.ceil(v/st)*st;}
 var xMax=nice(Math.max.apply(null,xs)),yMax=nice(Math.max.apply(null,ys)),yMin=Math.min.apply(null,ys);
 function px(v){return L+(v/xMax)*(W-L-R);}function py(v){return T+(1-(v-yMin)/(yMax-yMin))*(H-T-B);}
 var s='';for(var i=0;i<=4;i++){var xv=xMax*i/4,yv=yMin+(yMax-yMin)*i/4;
  s+='<line class="grid" x1="'+px(xv).toFixed(1)+'" y1="'+T+'" x2="'+px(xv).toFixed(1)+'" y2="'+(H-B)+'"/><text class="tick" x="'+px(xv).toFixed(1)+'" y="'+(H-B+16)+'" text-anchor="middle">'+(xv*100).toFixed(0)+'%</text>';
  s+='<line class="grid" x1="'+L+'" y1="'+py(yv).toFixed(1)+'" x2="'+(W-R)+'" y2="'+py(yv).toFixed(1)+'"/><text class="tick" x="'+(L-6)+'" y="'+(py(yv)+4).toFixed(1)+'" text-anchor="end">'+(yv*100).toFixed(0)+'%</text>';}
 s+='<text class="axis" x="'+((L+W-R)/2)+'" y="'+(H-6)+'" text-anchor="middle">최대낙폭 크기 (왼쪽일수록 안전)</text><text class="axis" transform="translate(12 '+((T+H-B)/2)+') rotate(-90)" text-anchor="middle">CAGR</text>';
 pts.forEach(function(p){if(p.bx!=null){s+='<line class="link" x1="'+px(p.bx).toFixed(1)+'" y1="'+py(p.by).toFixed(1)+'" x2="'+px(p.x).toFixed(1)+'" y2="'+py(p.y).toFixed(1)+'"/><circle class="bh" cx="'+px(p.bx).toFixed(1)+'" cy="'+py(p.by).toFixed(1)+'" r="5"><title>'+esc(p.label)+' B&amp;H</title></circle>';}
  s+='<circle class="pt" cx="'+px(p.x).toFixed(1)+'" cy="'+py(p.y).toFixed(1)+'" r="6"><title>'+esc(p.label+': MDD '+pct(-p.x)+' / CAGR '+pct(p.y))+'</title></circle><text class="plab" x="'+(px(p.x)+9).toFixed(1)+'" y="'+(py(p.y)+4).toFixed(1)+'">'+esc(p.label)+'</text>';});
 document.getElementById('scatter').innerHTML=s;}
function all(){renderTable();renderScatter();}
['rule','period','mode'].forEach(function(k){sel[k].addEventListener('change',all);});
var ths=document.querySelectorAll('#cmp thead th');
function setSort(k){if(state.key===k){state.dir=state.dir==='asc'?'desc':'asc';}else{state.key=k;state.dir=k==='label'?'asc':'desc';}renderTable();}
for(var i=0;i<ths.length;i++){(function(th){th.addEventListener('click',function(){setSort(th.getAttribute('data-key'));});th.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();setSort(th.getAttribute('data-key'));}});})(ths[i]);}
all();
})();
`;

export function buildIndexHtml(records: ReportRecord[]): string {
  const limits = [
    '관측 기간이 짧다(2021-12~2026-09, 약 4.8년). 표본 수가 적어 우연의 영향이 크다.',
    '세전 수치이며 세금·환율·슬리피지 일부는 반영되지 않았다. 거래비용은 레코드의 편도 가정만 적용했다.',
    '개발(dev) 구간에서 규칙과 비중을 고른 뒤 시험(val)을 본 사후 탐색이다. 여러 조합을 비교했으므로 선택 편향이 있다.',
    '과거 성과는 미래를 보장하지 않는다. 이 화면은 투자 조언이 아니며 채택 여부를 판정하지 않는다.',
  ];
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>코어 6종 V3 결과 비교</title>
<style>${CSS}</style>
</head>
<body>
<div class="banner" role="note">사후 탐색용 · 채택 판정 불가 · 투자 조언 아님</div>
<main>
<h1>코어 6종 신호 로테이션 V3 — 결과 목록·비교</h1>
<p class="meta">저장된 결과 ${records.length}건</p>
<section id="sets"><h2>① 비중 세트</h2>${cardsHtml(records)}</section>
<section id="compare"><h2>② 비교 표</h2>${compareHtml(records)}</section>
<section id="scatter-sec"><h2>③ MDD-CAGR 산점도</h2>
${records.length === 0 ? '<p class="empty">표시할 점이 없습니다.</p>' : `${scatterSvg(records)}
<p class="key">채워진 점 = 선택한 규칙·모드, 속 빈 원 = 같은 세트의 B&amp;H 기준점(점선으로 연결). 왼쪽 위일수록 낙폭은 작고 수익은 큼.</p>`}
</section>
<section id="limits"><h2>④ 한계</h2><ul class="limits">${limits.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul></section>
</main>
<script type="application/json" id="records-data">${safeJson(records)}</script>
<script>${CLIENT_JS}</script>
</body>
</html>
`;
}

// ── CLI ────────────────────────────────────────────────────────────────
export function loadRecords(dir: string): ReportRecord[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.json')).sort()
    .map(f => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as ReportRecord);
}

function main(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const recDir = path.join(here, 'out', 'records');
  const outFile = path.join(here, 'out', 'index.html');
  const records = loadRecords(recDir);
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, buildIndexHtml(records), 'utf8');
  process.stdout.write(`index.html 생성: ${outFile} (레코드 ${records.length}건)\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
