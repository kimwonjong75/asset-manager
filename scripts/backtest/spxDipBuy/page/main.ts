// scripts/backtest/spxDipBuy/page/main.ts
// 결과 페이지(브라우저) — 모든 변수를 조정해 같은 엔진(../engine)을 즉시 다시 돌린다.
// 데이터는 build.ts 가 window.__SPX_DATA__ 로 심어 준다. 규칙: any·console 금지.
import { HELP } from './help';
import {
  prepare, runSweep, runStrategy, defaultStrategies, DEFAULT_TRANCHES, firstIdxOnOrAfter,
  summarize, type StrategyParams, type Tranche, type Prepared, type SweepResult, type Summary, type Reentry,
} from '../engine';

interface PageData {
  fetchedAt: string;
  dates: string[];
  px: number[];
  tr: (number | null)[];
  irx: number[];
  grid: GridFile | null;
}
interface GridMetrics { n: number; cagr: number; mdd: number; mddWorst: number; beatA: number; excess: number; calmar: number }
interface GridRowT { id: string; family: string; dev: GridMetrics; hold: GridMetrics; holdTr: GridMetrics }
interface GridFile { baseline: { dev: GridMetrics; hold: GridMetrics; holdTr: GridMetrics }; rows: GridRowT[]; devRange: string; holdRange: string }

declare global {
  interface Window { __SPX_DATA__: PageData }
}

const D = window.__SPX_DATA__;
const COLORS = ['#6b7280', '#0ea5e9', '#f59e0b', '#a855f7', '#ef4444', '#10b981', '#ec4899', '#14b8a6'];

// ── 상태 ────────────────────────────────────────────────────────────────────
interface UiState {
  mode: 'multi' | 'single'; singleStart: string; singleEnd: string;
  firstYear: number; lastYear: number; stepMonths: number; horizon: number; allowIncomplete: boolean;
  basis: 'price' | 'tr'; cashMode: 'none' | 'fixed' | 'irx'; cashFixed: number; costBps: number;
  dcaMonths: number;
  tranches: Tranche[]; deadline: number; rearm: boolean;
  maN: number; band: number; confirm: number; reentry: Reentry; reentryBand: number; reentryScope: 'all' | 'sold'; requireArm: boolean;
  upfrontG: number; upfrontH: number;
  enabled: boolean[]; // 전략별 표시
  metric: 'cagr' | 'final' | 'mdd' | 'excess';
  detailStart: string;
  detailStrat: number;
}

const STORE_KEY = 'spxDipBuy.v1';
const defaults = (): UiState => ({
  mode: 'multi', singleStart: '2020-01-01', singleEnd: '',
  firstYear: 1965, lastYear: 2014, stepMonths: 12, horizon: 10, allowIncomplete: false,
  basis: 'price', cashMode: 'none', cashFixed: 3, costBps: 0,
  dcaMonths: 12,
  tranches: DEFAULT_TRANCHES.map(t => ({ ...t })), deadline: 0, rearm: false,
  maN: 50, band: 0, confirm: 1, reentry: 'ma', reentryBand: 0, reentryScope: 'sold', requireArm: true,
  upfrontG: 70, upfrontH: 50,
  enabled: [true, true, true, true, true, true, false, false],
  metric: 'cagr', detailStart: '', detailStrat: 4,
});

let ui: UiState = defaults();
try {
  const saved = localStorage.getItem(STORE_KEY);
  if (saved) ui = { ...defaults(), ...(JSON.parse(saved) as Partial<UiState>) };
} catch { /* 저장소 사용 불가 — 기본값 */ }
const save = (): void => { try { localStorage.setItem(STORE_KEY, JSON.stringify(ui)); } catch { /* 무시 */ } };

// ── 데이터 준비 ──────────────────────────────────────────────────────────────
const prepCache = new Map<string, Prepared>();
function getPrepared(): Prepared {
  const key = `${ui.basis}|${ui.cashMode}|${ui.cashFixed}`;
  let p = prepCache.get(key);
  if (!p) {
    const perf = D.px.map((v, i) => (ui.basis === 'price' ? v : (D.tr[i] ?? NaN)));
    const cashRate = D.dates.map((_, i) => (ui.cashMode === 'none' ? 0 : ui.cashMode === 'fixed' ? ui.cashFixed : D.irx[i]));
    p = prepare({ dates: D.dates, px: D.px, perf, cashRate });
    prepCache.set(key, p);
  }
  return p;
}

function buildStrategies(): StrategyParams[] {
  const base = defaultStrategies(ui.maN);
  const trs = (): Tranche[] => ui.tranches.map(t => ({ ...t }));
  const ma = (sell: boolean, gate: boolean, requireArm: boolean): StrategyParams['ma'] => ({
    n: ui.maN, sellEnabled: sell, band: ui.band, confirmDays: ui.confirm, requireArm,
    reentry: sell ? ui.reentry : 'none', reentryBand: ui.reentryBand, reentryScope: ui.reentryScope, buyGate: gate,
  });
  const [A, B, C, Dd, E, F] = base;
  const common = { deadlineMonths: ui.deadline, rearmOnNewHigh: ui.rearm };
  B.dcaMonths = ui.dcaMonths; B.label = `B ${ui.dcaMonths}개월 분할`;
  C.tranches = trs(); Object.assign(C, common); C.ma = ma(false, false, true);
  Dd.ma = ma(true, false, false); Dd.ma.reentry = ui.reentry === 'dip' || ui.reentry === 'none' ? 'ma' : ui.reentry; Dd.ma.reentryScope = 'all'; Dd.label = `D ${ui.maN}일선만`;
  E.tranches = trs(); Object.assign(E, common); E.ma = ma(true, false, ui.requireArm); E.label = `E 하락분할+${ui.maN}일선 매도`;
  F.tranches = trs(); Object.assign(F, common); F.ma = ma(false, true, true); F.label = `F 하락분할+${ui.maN}일선 확인`;
  const G: StrategyParams = { ...C, label: `G C+즉시${ui.upfrontG}%`, tranches: trs(), upfrontPct: ui.upfrontG, ma: ma(false, false, true) };
  const H: StrategyParams = { ...E, label: `H E+즉시${ui.upfrontH}%`, tranches: trs(), upfrontPct: ui.upfrontH, ma: ma(true, false, ui.requireArm) };
  return [A, B, C, Dd, E, F, G, H];
}

// ── 포맷 ────────────────────────────────────────────────────────────────────
const pct = (v: number, d = 2): string => (isFinite(v) ? `${(v * 100).toFixed(d)}%` : '–');
const num = (v: number, d = 1): string => (isFinite(v) ? v.toFixed(d) : '–');
const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

// ── 컨트롤 ──────────────────────────────────────────────────────────────────
/** ⓘ 도움말 아이콘: 마우스를 올리면 툴팁, 누르면 설명 상자(#hpop)가 열린다. */
export function hlp(key: string): string {
  const t = HELP[key];
  return t ? `<span class="hlp" data-h="${key}" title="${esc(t)}" tabindex="0" role="button" aria-label="설명 보기">ⓘ</span>` : '';
}
function numInput(id: string, label: string, val: number, step = 1, hint = ''): string {
  return `<label class="f"><span>${label}${hlp(id)}</span><input type="number" id="${id}" value="${val}" step="${step}">${hint ? `<small>${hint}</small>` : ''}</label>`;
}
function selInput(id: string, label: string, val: string, opts: [string, string][], hint = ''): string {
  return `<label class="f"><span>${label}${hlp(id)}</span><select id="${id}">${opts.map(([v, t]) => `<option value="${v}"${v === val ? ' selected' : ''}>${t}</option>`).join('')}</select>${hint ? `<small>${hint}</small>` : ''}</label>`;
}

function renderControls(): void {
  const strats = buildStrategies();
  const tr = ui.tranches.map((t, i) => `<div class="tr"><input type="number" data-tr="dd" data-i="${i}" value="${t.dd}" step="1"><span>% 이하 →</span><input type="number" data-tr="pct" data-i="${i}" value="${t.pct}" step="5"><span>% 매수</span><button data-trdel="${i}" title="삭제">✕</button></div>`).join('');
  const totalPct = ui.tranches.reduce((a, t) => a + t.pct, 0);
  $('controls').innerHTML = `
  <details open><summary>기간·시작일${hlp('g_period')}</summary>
    ${selInput('mode', '보기 방식', ui.mode, [['multi', '여러 시작 시점 비교 (시작일을 옮겨 가며 반복)'], ['single', '특정 기간 보기 (시작일~종료일, 1번)']])}
    ${ui.mode === 'single'
      ? `<label class="f"><span>시작일${hlp('singleStart')}</span><input type="date" id="singleStart" value="${ui.singleStart}"></label>
    <label class="f"><span>종료일${hlp('singleEnd')}</span><input type="date" id="singleEnd" value="${ui.singleEnd}"><small>비워 두면 데이터 끝(${D.dates[D.dates.length - 1]})까지</small></label>`
      : `${numInput('firstYear', '시작 범위 (부터, 연)', ui.firstYear)}
    ${numInput('lastYear', '시작 범위 (까지, 연)', ui.lastYear)}
    ${selInput('stepMonths', '시작 간격', String(ui.stepMonths), [['12', '매년 초'], ['6', '6개월'], ['3', '3개월'], ['1', '매월']], '월 단위는 사례가 많이 겹쳐 독립 표본이 아님')}
    ${numInput('horizon', '보유 기간 (년)', ui.horizon, 1)}
    <label class="f chk"><input type="checkbox" id="allowIncomplete" ${ui.allowIncomplete ? 'checked' : ''}> 아직 끝나지 않은 사례 포함(데이터 끝까지)${hlp('allowIncomplete')}</label>`}
  </details>
  <details open><summary>성과 기준·비용${hlp('g_basis')}</summary>
    ${selInput('basis', '성과 계산', ui.basis, [['price', '가격지수 (^GSPC, 1950~)'], ['tr', '총수익지수 (배당 재투자, 1988~)']], '신호(전고점·이평선)는 항상 가격지수. 총수익은 시작일 1988 이후만 계산됨')}
    ${selInput('cashMode', '대기현금 이자', ui.cashMode, [['none', '없음 (0%)'], ['fixed', '고정 연이율'], ['irx', '실제 3개월 T-bill (^IRX)']])}
    ${numInput('cashFixed', '고정 연이율 (%)', ui.cashFixed, 0.5)}
    ${numInput('costBps', '거래비용 (편도, bp)', ui.costBps, 1, '10bp = 0.1%')}
  </details>
  <details open><summary>하락 분할매수 구간 (C·E·F·G·H)${hlp('g_dip')}</summary>
    <div class="trs">${tr}</div>
    <div class="row"><button id="addTr">구간 추가</button><button id="resetTr">기본값 복원</button><span class="muted">합계 ${totalPct}% (원금 대비)</span>${hlp('tranches')}</div>
    ${numInput('deadline', '기한 투입 (개월, 0=끄기)', ui.deadline, 1, '시작 후 N개월 시점에 남은 현금 전액 투입')}
    <label class="f chk"><input type="checkbox" id="rearm" ${ui.rearm ? 'checked' : ''}> 신고가 갱신 시 구간 재무장 (명세 기본: 끔)${hlp('rearm')}</label>
  </details>
  <details open><summary>이평선 규칙 (D·E·F)${hlp('g_ma')}</summary>
    ${numInput('maN', '이동평균 (일)', ui.maN, 5)}
    ${numInput('band', '이탈 폭 (%)', ui.band, 0.5, '종가 < MA×(1−폭) 이어야 이탈')}
    ${numInput('confirm', '연속 이탈 확인 (일)', ui.confirm, 1)}
    ${selInput('reentry', '매도 후 재진입 (D·E)', ui.reentry, [['ma', 'MA 위로 회복 시 전액 재매수'], ['dip', '신고가 후 하락 구간 재무장'], ['none', '재진입 없음']])}
    ${numInput('reentryBand', '재진입 폭 (%)', ui.reentryBand, 0.5)}
    ${selInput('reentryScope', '재진입 매수 범위 (E)', ui.reentryScope, [['sold', '팔아서 생긴 금액만 (대기 현금은 하락 때 사용)'], ['all', '보유 현금 전부']])}
    <label class="f chk"><input type="checkbox" id="requireArm" ${ui.requireArm ? 'checked' : ''}> E: 매수 후 MA 위로 한 번 회복한 뒤부터 매도 규칙 작동${hlp('requireArm')}</label>
  </details>
  <details open><summary>전략 구성${hlp('g_strat')}</summary>
    ${numInput('dcaMonths', 'B 분할 개월 수', ui.dcaMonths, 1)}
    ${numInput('upfrontG', 'G: 즉시 투자 비중 % (나머지 하락분할)', ui.upfrontG, 10)}
    ${numInput('upfrontH', 'H: 즉시 투자 비중 % (E 규칙)', ui.upfrontH, 10)}
    <div class="chips">${strats.map((s, i) => `<label class="chip" style="--c:${COLORS[i]}"><input type="checkbox" data-en="${i}" ${ui.enabled[i] ? 'checked' : ''}>${esc(s.label)}${hlp(`s${i}`)}</label>`).join('')}</div>
  </details>
  <div class="row"><button id="resetAll">전체 기본값으로</button></div>`;
}

function readNum(id: string, fallback: number): number {
  const v = parseFloat(($(id) as HTMLInputElement).value);
  return isFinite(v) ? v : fallback;
}

function bindControls(): void {
  const root = $('controls');
  root.addEventListener('change', e => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const id = t.id;
    if (t.dataset.tr) {
      const i = +(t.dataset.i ?? 0);
      const v = parseFloat(t.value);
      if (isFinite(v)) { const row = ui.tranches[i]; if (t.dataset.tr === 'dd') row.dd = v; else row.pct = v; }
    } else if (t.dataset.en !== undefined) {
      ui.enabled[+t.dataset.en] = (t as HTMLInputElement).checked;
    } else if (id) {
      switch (id) {
        case 'mode': ui.mode = t.value as UiState['mode']; if (ui.mode === 'single') ui.detailStart = ui.singleStart; break;
        case 'singleStart': ui.singleStart = t.value; ui.detailStart = t.value; break;
        case 'singleEnd': ui.singleEnd = t.value; break;
        case 'firstYear': ui.firstYear = readNum(id, ui.firstYear); break;
        case 'lastYear': ui.lastYear = readNum(id, ui.lastYear); break;
        case 'stepMonths': ui.stepMonths = +t.value; break;
        case 'horizon': ui.horizon = Math.max(1, readNum(id, ui.horizon)); break;
        case 'allowIncomplete': ui.allowIncomplete = (t as HTMLInputElement).checked; break;
        case 'basis': ui.basis = t.value as UiState['basis']; break;
        case 'cashMode': ui.cashMode = t.value as UiState['cashMode']; break;
        case 'cashFixed': ui.cashFixed = readNum(id, ui.cashFixed); break;
        case 'costBps': ui.costBps = Math.max(0, readNum(id, ui.costBps)); break;
        case 'deadline': ui.deadline = Math.max(0, readNum(id, ui.deadline)); break;
        case 'rearm': ui.rearm = (t as HTMLInputElement).checked; break;
        case 'maN': ui.maN = Math.max(2, Math.round(readNum(id, ui.maN))); break;
        case 'band': ui.band = Math.max(0, readNum(id, ui.band)); break;
        case 'confirm': ui.confirm = Math.max(1, Math.round(readNum(id, ui.confirm))); break;
        case 'reentry': ui.reentry = t.value as Reentry; break;
        case 'reentryBand': ui.reentryBand = Math.max(0, readNum(id, ui.reentryBand)); break;
        case 'reentryScope': ui.reentryScope = t.value as UiState['reentryScope']; break;
        case 'requireArm': ui.requireArm = (t as HTMLInputElement).checked; break;
        case 'dcaMonths': ui.dcaMonths = Math.max(1, Math.round(readNum(id, ui.dcaMonths))); break;
        case 'upfrontG': ui.upfrontG = Math.min(100, Math.max(0, readNum(id, ui.upfrontG))); break;
        case 'upfrontH': ui.upfrontH = Math.min(100, Math.max(0, readNum(id, ui.upfrontH))); break;
        default: return;
      }
    } else return;
    save();
    refresh(['maN', 'dcaMonths', 'upfrontG', 'upfrontH', 'mode'].includes(id) || !!t.dataset.tr);
  });
  root.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (t.id === 'addTr') { const last = ui.tranches[ui.tranches.length - 1]; ui.tranches.push({ dd: (last?.dd ?? -10) - 5, pct: 10 }); }
    else if (t.id === 'resetTr') ui.tranches = DEFAULT_TRANCHES.map(x => ({ ...x }));
    else if (t.id === 'resetAll') { ui = defaults(); }
    else if (t.dataset.trdel !== undefined) ui.tranches.splice(+t.dataset.trdel, 1);
    else return;
    save();
    refresh(true);
  });
}

// ── 계산 + 렌더 ─────────────────────────────────────────────────────────────
let lastSweep: SweepResult | null = null;
let lastStrats: StrategyParams[] = [];
let lastIdx: number[] = [];

function compute(): void {
  const p = getPrepared();
  lastStrats = buildStrategies();
  lastIdx = lastStrats.map((_, i) => i).filter(i => ui.enabled[i]);
  if (!lastIdx.includes(0)) lastIdx.unshift(0); // 기준(A)은 항상 계산
  const strategies = lastIdx.map(i => lastStrats[i]);
  if (ui.mode === 'single') {
    const dates = D.dates;
    const si = firstIdxOnOrAfter(p, ui.singleStart || dates[0]);
    let ei = ui.singleEnd ? firstIdxOnOrAfter(p, ui.singleEnd) : -1;
    if (ei < 0) ei = dates.length - 1;
    else if (dates[ei] > ui.singleEnd) ei -= 1;
    const common = { costBps: ui.costBps, principal: 100 };
    const runs = strategies.map(st => {
      const rr = si >= 0 ? runStrategy(p, st, common, si, ei, false) : null;
      return rr ? [rr] : [];
    });
    const ok = runs[0].length === 1;
    lastSweep = {
      starts: ok ? [{ startIdx: si, endIdx: ei, complete: true }] : [],
      runs: ok ? runs : strategies.map(() => []),
      summaries: runs.map((rr, k) => summarize(rr, k === 0 ? null : runs[0])),
    };
    return;
  }
  lastSweep = runSweep(
    p, strategies, { costBps: ui.costBps, principal: 100 },
    { stepMonths: ui.stepMonths, firstDate: `${ui.firstYear}-01-01`, lastDate: `${ui.lastYear}-12-31`, horizonYears: ui.horizon, allowIncomplete: ui.allowIncomplete },
    0
  );
}

function bestIdx(vals: number[], high: boolean): number {
  let bi = -1;
  vals.forEach((v, i) => { if (isFinite(v) && (bi < 0 || (high ? v > vals[bi] : v < vals[bi]))) bi = i; });
  return bi;
}

function renderSingleSummary(): void {
  if (!lastSweep) return;
  const sw = lastSweep;
  if (sw.starts.length === 0) {
    $('warn').innerHTML = '';
    $('summary').innerHTML = `<div class="empty"><b>이 기간은 계산할 수 없습니다.</b><ul><li>시작일은 종료일보다 앞이어야 하고, 둘 다 데이터 범위(${D.dates[0]} ~ ${D.dates[D.dates.length - 1]}) 안이어야 합니다.</li>${ui.basis === 'tr' ? '<li>성과 기준이 총수익지수라 1988년 이전 시작은 계산할 수 없습니다.</li>' : ''}</ul></div>`;
    return;
  }
  const p = getPrepared();
  const c = sw.starts[0];
  const runs = sw.runs.map(x => x[0]);
  const base = runs[0];
  type R = (typeof runs)[number];
  const rows: { h?: string; name: string; render: (x: R) => string; pick?: (x: R) => number; high?: boolean }[] = [
    { h: 'r_finalMedian', name: '최종 계좌가치 (원금 100)', render: x => num(x.finalValue), pick: x => x.finalValue, high: true },
    { h: 'r_cagrMedian', name: '연복리(CAGR)', render: x => pct(x.cagr), pick: x => x.cagr, high: true },
    { h: 'r_mddMedian', name: '계좌 최대낙폭(MDD)', render: x => pct(x.mdd, 1), pick: x => x.mdd, high: true },
    { h: 'r_excess', name: 'A 대비 최종가치 차이', render: x => (x === base ? '기준' : num(x.finalValue - base.finalValue)) },
    { h: 'r_firstBuy', name: '첫 매수까지 (일)', render: x => (x.daysToFirstBuy === null ? '–' : num(x.daysToFirstBuy, 0)) },
    { h: 'r_fullDays', name: '원금 전액 투입까지 (일)', render: x => (x.daysToFullInvest === null ? '–' : num(x.daysToFullInvest, 0)) },
    { h: 'r_endCash', name: '종료 시 현금 비중', render: x => `${num(x.endCashPct)}%` },
    { h: 'r_avgInvested', name: '기간 평균 투자비중', render: x => `${num(x.avgInvestedPct)}%` },
    { name: '매수 / 매도 횟수', render: x => `${x.buys} / ${x.sells}` },
  ];
  const head = lastIdx.map(i => `<th style="--c:${COLORS[i]}"><i></i>${esc(lastStrats[i].label)}${hlp(`s${i}`)}</th>`).join('');
  const body = rows.map(row => {
    const best = row.pick ? bestIdx(runs.map(row.pick), row.high ?? true) : -1;
    return `<tr><th>${row.name}${hlp(row.h ?? '')}</th>${runs.map((x, k) => `<td class="${k === best ? 'best' : ''}">${row.render(x)}</td>`).join('')}</tr>`;
  }).join('');
  $('summary').innerHTML = `<table><thead><tr><th>${p.s.dates[c.startIdx]} → ${p.s.dates[c.endIdx]} (${num(base.years, 1)}년)</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
  $('warn').innerHTML = `<div class="warnline">⚠ 이 기간 하나의 결과입니다. 방법이 좋아서인지 그 시기의 운인지는 구분할 수 없습니다. 같은 기간 S&amp;P500 자체의 최대낙폭은 ${pct(base.marketMdd, 1)}입니다.</div>`;
}

function renderSummary(): void {
  if (!lastSweep) return;
  if (ui.mode === 'single') { renderSingleSummary(); return; }
  const sw = lastSweep;
  if (sw.starts.length === 0) {
    const lastYearData = +D.dates[D.dates.length - 1].slice(0, 4);
    const maxStart = lastYearData - Math.ceil(ui.horizon);
    const need = ui.basis === 'tr' ? 1988 : 1950;
    $('warn').innerHTML = '';
    $('summary').innerHTML = `<div class="empty"><b>조건에 맞는 사례가 없어서 표가 비어 있습니다.</b>
      <ul>
        <li>보유 기간이 <b>${ui.horizon}년</b>이면 시작은 <b>${maxStart}년까지만</b> 가능합니다(데이터가 ${D.dates[D.dates.length - 1]}에서 끝나서, 시작 후 ${ui.horizon}년을 못 채우는 해는 빠집니다). 지금 시작 범위는 ${ui.firstYear}~${ui.lastYear}년입니다.</li>
        <li>최근에 시작한 경우를 보고 싶다면 ① <b>보유 기간을 줄이거나</b>(예: ${Math.max(1, lastYearData - ui.firstYear)}년 이하) ② <b>"아직 끝나지 않은 사례 포함"</b>을 체크하세요(오늘까지의 결과로 계산).</li>
        ${ui.firstYear < need ? `<li>성과 기준이 ${ui.basis === 'tr' ? '총수익지수라 1988년' : '가격지수라 1950년'} 이전은 계산할 수 없습니다.</li>` : ''}
      </ul></div>`;
    return;
  }
  const sums: Summary[] = sw.summaries;
  const rows: { h?: string; name: string; render: (s: Summary) => string; pick?: (s: Summary) => number; high?: boolean }[] = [
    { h: 'r_finalMedian', name: '최종 계좌가치 중앙값 (원금 100)', render: s => num(s.finalMedian), pick: s => s.finalMedian, high: true },
    { h: 'r_finalMean', name: '최종 계좌가치 평균', render: s => num(s.finalMean), pick: s => s.finalMean, high: true },
    { h: 'r_finalWorst', name: '최종 계좌가치 최악', render: s => num(s.finalWorst), pick: s => s.finalWorst, high: true },
    { h: 'r_cagrMedian', name: '연복리(CAGR) 중앙값', render: s => pct(s.cagrMedian), pick: s => s.cagrMedian, high: true },
    { h: 'r_cagrBand', name: 'CAGR 하위 10% / 상위 10%', render: s => `${pct(s.cagrP10, 1)} / ${pct(s.cagrP90, 1)}` },
    { h: 'r_cagrWorst', name: 'CAGR 최악', render: s => pct(s.cagrWorst), pick: s => s.cagrWorst, high: true },
    { h: 'r_mddMedian', name: '계좌 MDD 중앙값', render: s => pct(s.mddMedian, 1), pick: s => s.mddMedian, high: true },
    { h: 'r_mddWorst', name: '계좌 MDD 최악', render: s => pct(s.mddWorst, 1), pick: s => s.mddWorst, high: true },
    { h: 'r_loss', name: '손실로 종료한 비율', render: s => pct(s.lossRate, 0), pick: s => s.lossRate, high: false },
    { h: 'r_beat', name: 'A(일시매수)를 이긴 비율', render: s => (isFinite(s.beatBaseRate) ? pct(s.beatBaseRate, 0) : '기준') },
    { h: 'r_excess', name: 'A 대비 최종가치 차이 중앙값', render: s => (isFinite(s.excessMedian) ? num(s.excessMedian) : '기준') },
    { h: 'r_firstBuy', name: '첫 매수까지 (일, 중앙값)', render: s => num(s.firstBuyDaysMedian, 0) },
    { h: 'r_fullDays', name: '원금 전액 투입까지 (일, 중앙값)', render: s => (s.fullInvestDaysMedian === null ? '–' : num(s.fullInvestDaysMedian, 0)) },
    { h: 'r_fullRate', name: '전액 투입에 도달한 사례 비율', render: s => pct(s.fullInvestRate, 0) },
    { h: 'r_endCash', name: '종료 시 현금 비중 (중앙값)', render: s => `${num(s.endCashPctMedian)}%` },
    { h: 'r_avgInvested', name: '기간 평균 투자비중 (중앙값)', render: s => `${num(s.avgInvestedMedian)}%` },
  ];
  const head = lastIdx.map(i => `<th style="--c:${COLORS[i]}"><i></i>${esc(lastStrats[i].label)}${hlp(`s${i}`)}</th>`).join('');
  const body = rows.map(r => {
    let best = -1;
    if (r.pick) best = bestIdx(sums.map(r.pick), r.high ?? true);
    return `<tr><th>${r.name}${hlp(r.h ?? '')}</th>${sums.map((s, k) => `<td class="${k === best ? 'best' : ''}">${r.render(s)}</td>`).join('')}</tr>`;
  }).join('');
  $('summary').innerHTML = `<table><thead><tr><th>사례 ${sw.starts.length}개 · ${ui.horizon}년 보유</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
  const warn: string[] = [];
  if (ui.basis === 'tr' && ui.firstYear < 1988) warn.push('총수익지수는 1988년부터라 그 이전 시작일은 계산에서 빠졌습니다.');
  if (sw.starts.length < 8) warn.push('사례가 8개 미만이라 중앙값·승률이 매우 불안정합니다.');
  if (ui.stepMonths < 12) warn.push('시작 간격이 1년 미만이면 사례가 서로 크게 겹쳐 승률을 독립 표본처럼 읽으면 안 됩니다.');
  const cut = sw.starts.filter(c => !c.complete);
  if (cut.length > 0) {
    const p0 = getPrepared();
    const lastOk = sw.starts.filter(c => c.complete).map(c => p0.s.dates[c.startIdx].slice(0, 4)).pop();
    warn.push(`전체 ${sw.starts.length}개 사례 중 ${cut.length}개는 보유 기간 ${ui.horizon}년을 다 채우지 못했습니다(데이터 끝까지로 잘림${lastOk ? `, ${ui.horizon}년을 채운 마지막 시작은 ${lastOk}년` : ''}). 기간이 서로 달라 표의 중앙값·승률이 왜곡됩니다. 같은 기간으로 비교하려면 "아직 끝나지 않은 사례 포함"을 끄세요.`);
  }
  $('warn').innerHTML = warn.map(w => `<div class="warnline">⚠ ${w}</div>`).join('');
}

// ── 차트 ────────────────────────────────────────────────────────────────────
interface Line { color: string; label: string; pts: [number, number | null][] ; dash?: string }

function drawChart(el: HTMLElement, lines: Line[], opt: { yFmt: (v: number) => string; xFmt: (v: number) => string; tipFmt?: (v: number) => string; xTip?: (v: number) => string; zero?: boolean; onClick?: (x: number) => void; vline?: number | null; logY?: boolean }): void {
  const W = Math.max(480, el.clientWidth || 900);
  const H = 300;
  const m = { l: 56, r: 12, t: 10, b: 24 };
  const all = lines.flatMap(l => l.pts.filter(p => p[1] !== null) as [number, number][]);
  if (all.length === 0) { el.innerHTML = '<div class="muted">표시할 데이터가 없습니다.</div>'; return; }
  const xs = all.map(p => p[0]);
  const ysRaw = all.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ysRaw), y1 = Math.max(...ysRaw);
  if (opt.zero) { y0 = Math.min(y0, 0); y1 = Math.max(y1, 0); }
  if (y1 === y0) { y1 += 1; y0 -= 1; }
  const pad = (y1 - y0) * 0.05; y0 -= pad; y1 += pad;
  const sx = (x: number): number => m.l + ((x - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const sy = (y: number): number => H - m.b - ((y - y0) / (y1 - y0)) * (H - m.t - m.b);
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" class="chart">`;
  for (let k = 0; k <= 4; k++) {
    const yv = y0 + ((y1 - y0) * k) / 4;
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(yv)}" y2="${sy(yv)}" class="grid"/><text x="${m.l - 6}" y="${sy(yv) + 4}" class="ax" text-anchor="end">${opt.yFmt(yv)}</text>`;
  }
  for (let k = 0; k <= 6; k++) {
    const xv = x0 + ((x1 - x0) * k) / 6;
    svg += `<text x="${sx(xv)}" y="${H - 6}" class="ax" text-anchor="middle">${opt.xFmt(xv)}</text>`;
  }
  if (opt.zero) svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(0)}" y2="${sy(0)}" class="zero"/>`;
  for (const l of lines) {
    let d = '';
    let pen = false;
    for (const [x, y] of l.pts) {
      if (y === null) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
      pen = true;
    }
    svg += `<path d="${d}" fill="none" stroke="${l.color}" stroke-width="1.6" ${l.dash ? `stroke-dasharray="${l.dash}"` : ''}/>`;
  }
  if (opt.vline != null) svg += `<line x1="${sx(opt.vline)}" x2="${sx(opt.vline)}" y1="${m.t}" y2="${H - m.b}" class="vline"/>`;
  svg += `<rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" id="hit"/></svg>`;
  el.innerHTML = svg;
  el.style.position = 'relative';
  // 마우스 오버: 십자선 + 날짜·값 툴팁(선마다 가장 가까운 점)
  {
    const svgEl = el.querySelector('svg') as SVGSVGElement;
    const hitEl = el.querySelector('#hit') as SVGRectElement;
    const tip = document.createElement('div');
    tip.className = 'ctip';
    tip.hidden = true;
    el.appendChild(tip);
    const cross = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    cross.setAttribute('class', 'cross');
    cross.setAttribute('y1', String(m.t));
    cross.setAttribute('y2', String(H - m.b));
    cross.style.display = 'none';
    svgEl.insertBefore(cross, hitEl);
    const nearest = (pts: [number, number | null][], x: number): [number, number | null] | null => {
      let lo = 0, hi = pts.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid][0] < x) lo = mid + 1; else hi = mid; }
      let best = pts[lo];
      if (!best) return null;
      if (lo > 0 && Math.abs(pts[lo - 1][0] - x) < Math.abs(best[0] - x)) best = pts[lo - 1];
      return best;
    };
    hitEl.addEventListener('mousemove', e => {
      const r = svgEl.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const xv = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
      const rows: string[] = [];
      let snapX: number | null = null;
      for (const l of lines) {
        const p = nearest(l.pts, xv);
        if (!p || p[1] === null) continue;
        if (snapX === null) snapX = p[0];
        rows.push(`<div><i style="background:${l.color}"></i>${esc(l.label)} <b>${(opt.tipFmt ?? opt.yFmt)(p[1])}</b></div>`);
      }
      if (snapX === null) { tip.hidden = true; return; }
      const cx = sx(snapX);
      cross.setAttribute('x1', String(cx));
      cross.setAttribute('x2', String(cx));
      cross.style.display = '';
      tip.innerHTML = `<div class="td">${(opt.xTip ?? opt.xFmt)(snapX)}</div>${rows.join('')}`;
      tip.hidden = false;
      const scale = r.width / W;
      const tw = tip.offsetWidth;
      let left = cx * scale + 12;
      if (left + tw > r.width) left = cx * scale - tw - 12;
      tip.style.left = `${Math.max(0, left)}px`;
      tip.style.top = `${m.t * scale + 4}px`;
    });
    hitEl.addEventListener('mouseleave', () => { tip.hidden = true; cross.style.display = 'none'; });
  }
  if (opt.onClick) {
    const hit = el.querySelector('#hit') as SVGRectElement;
    hit.addEventListener('click', e => {
      const r = (el.querySelector('svg') as SVGSVGElement).getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      opt.onClick?.(x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0));
    });
  }
}

const dayNum = (d: string): number => Math.floor(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000);
const dayStr = (n: number): string => new Date(n * 86400000).toISOString().slice(0, 10);

function renderMain(): void {
  if (!lastSweep) return;
  const sw = lastSweep;
  const p = getPrepared();
  const metric = ui.metric;
  const lines: Line[] = lastIdx.map((si, k) => ({
    color: COLORS[si], label: lastStrats[si].label,
    pts: sw.runs[k].map((r, j): [number, number | null] => {
      const x = p.epochDays[r.startIdx];
      const base = sw.runs[0][j];
      const y = metric === 'cagr' ? r.cagr * 100 : metric === 'final' ? r.finalValue : metric === 'mdd' ? r.mdd * 100 : (base ? r.finalValue - base.finalValue : null);
      return [x, y];
    }),
  }));
  const yFmt = (v: number): string => (metric === 'cagr' || metric === 'mdd' ? `${v.toFixed(0)}%` : v.toFixed(0));
  const sel = ui.detailStart ? dayNum(ui.detailStart) : null;
  drawChart($('chartMain'), lines, { yFmt, tipFmt: v => (metric === 'cagr' || metric === 'mdd' ? `${v.toFixed(2)}%` : v.toFixed(1)), xTip: v => dayStr(Math.round(v)) + ' 시작', xFmt: v => dayStr(Math.round(v)).slice(0, 7), zero: metric !== 'final', vline: sel, onClick: x => {
    // 가장 가까운 시작일 선택
    let best = sw.starts[0], bd = Infinity;
    for (const c of sw.starts) { const dd = Math.abs(p.epochDays[c.startIdx] - x); if (dd < bd) { bd = dd; best = c; } }
    ui.detailStart = p.s.dates[best.startIdx]; save(); renderDetail(); renderMain();
  } });
  $('legend').innerHTML = lastIdx.map(si => `<span class="lg" style="--c:${COLORS[si]}"><i></i>${esc(lastStrats[si].label)}</span>`).join('');
  document.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach(b => { b.classList.toggle('on', b.dataset.metric === metric); b.title = HELP[`m_${b.dataset.metric}`] ?? ''; });
  $('metricHelp').textContent = HELP[`m_${metric}`] ?? '';
}

function renderDetail(): void {
  if (!lastSweep) return;
  const sw = lastSweep;
  const p = getPrepared();
  if (sw.starts.length === 0) {
    $('chartDetail').innerHTML = '';
    $('events').innerHTML = '<div class="muted">사례가 없어서 표시할 내용이 없습니다. 위 요약의 안내를 확인하세요.</div>';
    return;
  }
  let cs = sw.starts.find(c => p.s.dates[c.startIdx] === ui.detailStart);
  if (!cs) { cs = sw.starts[Math.floor(sw.starts.length / 2)]; ui.detailStart = p.s.dates[cs.startIdx]; }
  const si0 = cs.startIdx, ei = cs.endIdx;
  const sel = $('detailSel') as HTMLSelectElement;
  sel.innerHTML = sw.starts.map(c => `<option value="${p.s.dates[c.startIdx]}" ${c === cs ? 'selected' : ''}>${p.s.dates[c.startIdx]} → ${p.s.dates[c.endIdx]}${c.complete ? '' : ' (진행중)'}</option>`).join('');
  const stSel = $('detailStrat') as HTMLSelectElement;
  stSel.innerHTML = lastIdx.map(i => `<option value="${i}" ${i === ui.detailStrat ? 'selected' : ''}>${esc(lastStrats[i].label)}</option>`).join('');
  if (!lastIdx.includes(ui.detailStrat)) ui.detailStrat = lastIdx[Math.min(2, lastIdx.length - 1)];

  const lines: Line[] = [];
  const common = { costBps: ui.costBps, principal: 100 };
  let focusEvents: ReturnType<typeof runStrategy> = null;
  for (const si of lastIdx) {
    const r = runStrategy(p, lastStrats[si], common, si0, ei, true);
    if (!r || !r.curve) continue;
    const curve = r.curve;
    lines.push({ color: COLORS[si], label: lastStrats[si].label, pts: curve.map((v, k): [number, number | null] => [p.epochDays[si0 + k], v]) });
    if (si === ui.detailStrat) focusEvents = r;
  }
  // 시장(S&P perf) 점선
  const base = p.s.perf[si0];
  lines.push({ color: '#9ca3af', label: 'S&P500 (참고)', dash: '3 3', pts: p.s.perf.slice(si0, ei + 1).map((v, k): [number, number | null] => [p.epochDays[si0 + k], (v / base) * 100]) });
  drawChart($('chartDetail'), lines, { yFmt: v => v.toFixed(0), tipFmt: v => v.toFixed(1), xTip: v => dayStr(Math.round(v)), xFmt: v => dayStr(Math.round(v)).slice(0, 7) });
  const fe = focusEvents as ReturnType<typeof runStrategy>;
  if (fe && fe.events) {
    const ev = fe.events;
    const rows = ev.slice(0, 60).map(e => {
      const idx = e.idx;
      const ddNow = (p.s.px[idx] / p.runHigh[idx] - 1) * 100;
      return `<tr><td>${p.s.dates[idx]}</td><td class="${e.kind}">${e.kind === 'buy' ? '매수' : '매도'}</td><td>${num(e.amount)}</td><td>${num(ddNow)}%</td><td>${e.note}</td></tr>`;
    }).join('');
    $('events').innerHTML = `<div class="muted"><b>${p.s.dates[si0]} → ${p.s.dates[ei]}</b> · ${esc(lastStrats[ui.detailStrat].label)} — 최종 ${num(fe.finalValue)} · CAGR ${pct(fe.cagr)} · MDD ${pct(fe.mdd, 1)} (같은 기간 지수 MDD ${pct(fe.marketMdd, 1)}) · 매수 ${fe.buys}회/매도 ${fe.sells}회${ev.length > 60 ? ' · 거래 60건까지만 표시' : ''}</div>
      <table class="ev"><thead><tr><th>체결일</th><th>구분</th><th>금액(원금 100)</th><th>당시 지수 전고점 대비</th><th>비고</th></tr></thead><tbody>${rows || '<tr><td colspan="5">거래 없음</td></tr>'}</tbody></table>`;
  }
}

function renderGrid(): void {
  const g = D.grid;
  if (!g) { $('grid').innerHTML = '<div class="muted">grid.json 없음 — grid.ts 를 먼저 실행하세요.</div>'; return; }
  const fam = ($('gridFam') as HTMLSelectElement).value;
  const rows = g.rows.filter(r => fam === 'all' || r.family === fam).slice().sort((a, b) => b.dev.calmar - a.dev.calmar).slice(0, 15);
  const cell = (m: GridMetrics): string => `<td>${pct(m.cagr, 2)}</td><td>${pct(m.mdd, 1)}</td><td>${num(m.calmar, 2)}</td><td>${pct(m.beatA, 0)}</td>`;
  const bRow = (name: string): string => `<tr class="base"><th>${name}</th>${cell(g.baseline.dev)}${cell(g.baseline.hold)}${cell(g.baseline.holdTr)}</tr>`;
  $('grid').innerHTML = `<table><thead>
    <tr><th rowspan="2">조합 (개발구간 Calmar 순 상위 15)</th><th colspan="4">개발 ${g.devRange} 시작 (가격)</th><th colspan="4">검증 ${g.holdRange} 시작 (가격)</th><th colspan="4">검증 ${g.holdRange} (총수익)</th></tr>
    <tr>${['CAGR', 'MDD', 'Calmar', 'A승률'].map(h => `<th>${h}${h === 'Calmar' ? hlp('calmar') : ''}</th>`).join('').repeat(3)}</tr></thead><tbody>
    ${bRow('A 일시매수 (기준)')}
    ${rows.map(r => `<tr><th>${esc(r.id)}</th>${cell(r.dev)}${cell(r.hold)}${cell(r.holdTr)}</tr>`).join('')}
    </tbody></table>`;
}

function applyMode(): void {
  const secs = document.querySelectorAll<HTMLElement>('main section');
  const single = ui.mode === 'single';
  if (secs[2]) secs[2].hidden = single; // 시작 시점별 결과
  if (secs[4]) secs[4].hidden = single; // 파라미터 격자
  $('detailSel').hidden = single;
  document.querySelectorAll<HTMLElement>('[data-h="detailSel"]').forEach(e => { e.hidden = single; });
}

function refresh(rerenderControls: boolean): void {
  compute();
  applyMode();
  if (rerenderControls) renderControls();
  renderSummary();
  renderMain();
  renderDetail();
}

/** ⓘ 아이콘 공통 처리: 클릭·Enter 로 설명 상자를 열고, 다른 곳을 누르면 닫는다. 정적 아이콘에는 툴팁(title)을 채운다. */
function initHelp(): void {
  const pop = $('hpop');
  let current: HTMLElement | null = null;
  const close = (): void => { pop.hidden = true; current = null; };
  const open = (el: HTMLElement): void => {
    const text = HELP[el.dataset.h ?? ''];
    if (!text) return;
    pop.textContent = text;
    pop.hidden = false;
    const r = el.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), window.innerWidth - pw - 8);
    const below = r.bottom + 8 + pop.offsetHeight < window.innerHeight;
    pop.style.left = `${left}px`;
    pop.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - 8 - pop.offsetHeight)}px`;
    current = el;
  };
  document.querySelectorAll<HTMLElement>('.hlp').forEach(el => { if (!el.title) el.title = HELP[el.dataset.h ?? ''] ?? ''; });
  document.addEventListener('click', e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.hlp');
    if (el) {
      e.preventDefault(); // summary/label 안의 아이콘이 접기·체크를 건드리지 않게
      e.stopPropagation();
      if (current === el) close(); else open(el);
    } else if (!(e.target as HTMLElement).closest('#hpop')) close();
  }, true);
  document.addEventListener('keydown', e => {
    const el = (e.target as HTMLElement).closest?.('.hlp') as HTMLElement | null;
    if (e.key === 'Escape') close();
    else if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (current === el) close(); else open(el); }
  });
  window.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);
}

function init(): void {
  $('dataInfo').textContent = `S&P500 가격지수 ${D.dates[0]} ~ ${D.dates[D.dates.length - 1]} (${D.dates.length.toLocaleString()}거래일) · 총수익지수 1988~ · 데이터 수집 ${D.fetchedAt.slice(0, 10)}`;
  renderControls();
  bindControls();
  initHelp();
  document.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach(b => b.addEventListener('click', () => { ui.metric = b.dataset.metric as UiState['metric']; save(); renderMain(); }));
  $('detailSel').addEventListener('change', e => { ui.detailStart = (e.target as HTMLSelectElement).value; save(); renderDetail(); renderMain(); });
  $('detailStrat').addEventListener('change', e => { ui.detailStrat = +(e.target as HTMLSelectElement).value; save(); renderDetail(); });
  $('gridFam').addEventListener('change', renderGrid);
  window.addEventListener('resize', () => { renderMain(); renderDetail(); });
  compute();
  applyMode();
  renderSummary();
  renderMain();
  renderDetail();
  renderGrid();
  void firstIdxOnOrAfter;
}
init();
