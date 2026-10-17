// scripts/backtest/core6SignalRotationV3/data/buildData.ts
// 실행: npx --yes tsx scripts/backtest/core6SignalRotationV3/data/buildData.ts
// 선행: npx --yes tsx scripts/backtest/core6SignalRotationV3/data/fetchBackendFill.ts  (output/backend_fill/ 에 백엔드 원본 저장)
// 로컬 원자료(core6SignalRotation/data/raw, gitignore)와 백엔드 원본(output/backend_fill)을 재수집 없이 읽어
//   output/DATA_MANIFEST.json, panel_P.json, panel_P5.json, DATA_GATE_RESULTS.json, DATA_GATE_REPORT.md 를 만든다.
// Amendment 2: A2-1 TR 시세 = 백엔드 /history 조정 OHLC(Yahoo 행이 있는 날 = 엄격 달력, 백엔드 값 없으면 이월) · A2-2 DG2 = 백엔드 vs Yahoo 이벤트 원장 TR + 알려진 오류 3건 구간 설명.
// (Amendment 1 의 이벤트 원장 TR 은 교차 확인용 Yahoo 계열로만 남는다.)
// 전략 성과(MDD·CAGR 등)는 계산하지 않는다 — 데이터 정합과 사전등록 게이트만.

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AssetCode, Panel } from '../types';
import { ASSET_CODES } from '../types';
import { applyEventLedger, backendImplied, computeLedgerEvents, parseBackendHistory, withYahooFactors } from './amendment';
import type { BackendSeries } from './amendment';
import { KNOWN_LEDGER_ERRORS, buildBackendParsed, explainDg2, ohlcCoefficientConsistency, ratioPoints } from './amendment2';
import { dg1Series, dg2Compare, dg3Series, dg4Report, proxyFidelity } from './gates';
import type { GateStatus } from './gates';
import { PANEL_END, PANEL_START, buildPanelWithMeta, buildSessionCalendar, computeSyntheticDays, slicePanel, validatePanelShape } from './panel';
import type { PanelInput } from './panel';
import { renderGateReport } from './report';
import type { Amendment2AssetBlock, Amendment2Block, DataGateResults, Dg2Block, Dg2Row } from './report';
import { adjCloseSeries, parseYahooAdjusted, rawCloseSeries } from './yahoo';
import type { YahooParsed } from './yahoo';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const rawDir = path.resolve(here, '..', '..', 'core6SignalRotation', 'data', 'raw');
const outDir = path.resolve(here, '..', 'output');
const backendDir = path.join(outDir, 'backend_fill');

const PA_START = '2023-08-22';

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

interface RawFile {
  file: string;
  bytes: Buffer;
  json: { sourceUrl?: string; fetchedAtUtc?: string; requestedPeriod?: unknown; response?: unknown; rows?: Array<{ TIME: string; DATA_VALUE: string }> };
}

function loadRaw(file: string): RawFile {
  const bytes = readFileSync(path.join(rawDir, file));
  return { file, bytes, json: JSON.parse(bytes.toString('utf-8')) as RawFile['json'] };
}

function yahooFile(symbol: string): string {
  return `yahoo_${symbol.replace(/[^A-Za-z0-9_.=-]/g, '_')}.json`;
}

function rel(p: string): string {
  return path.relative(repoRoot, p).split(path.sep).join('/');
}

function worstOf(statuses: GateStatus[]): GateStatus {
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('UNAVAILABLE')) return 'UNAVAILABLE';
  if (statuses.includes('PARTIAL')) return 'PARTIAL';
  if (statuses.every(s => s === 'REPORT')) return 'REPORT';
  return 'PASS';
}

// --------------------------------------------------------------------------- 1. 원자료 적재 + 매니페스트
const krSymbols: Record<AssetCode, string> = {
  '069500': '069500.KS',
  '379800': '379800.KS',
  '283580': '283580.KS',
  '385560': '385560.KS',
  '464470': '464470.KS',
  '411060': '411060.KS',
};

const rawFiles: RawFile[] = [];
const yahoo = {} as Record<AssetCode, YahooParsed>;
for (const code of ASSET_CODES) {
  const f = loadRaw(yahooFile(krSymbols[code]));
  rawFiles.push(f);
  yahoo[code] = parseYahooAdjusted(f.json.response);
}
const tltRaw = loadRaw(yahooFile('TLT'));
const fxRaw = loadRaw(yahooFile('KRW=X'));
const cdRaw = loadRaw('ecos_cd91.json');
rawFiles.push(tltRaw, fxRaw, cdRaw);
const tlt = parseYahooAdjusted(tltRaw.json.response);
const fx = parseYahooAdjusted(fxRaw.json.response);

interface V1Checksums {
  files: Array<{ file: string; sha256: string; bytes: number }>;
}
const v1ChecksumPath = path.join(rawDir, 'checksums.json');
const v1Checksums: V1Checksums | null = existsSync(v1ChecksumPath) ? (JSON.parse(readFileSync(v1ChecksumPath, 'utf-8')) as V1Checksums) : null;

function manifestEntry(f: RawFile) {
  const hash = sha256(f.bytes);
  const v1 = v1Checksums?.files.find(x => x.file === f.file) ?? null;
  let rows = 0;
  let validRows: number | null = null;
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  if (f.file.startsWith('yahoo_')) {
    const parsed = parseYahooAdjusted(f.json.response);
    rows = parsed.rows.length;
    validRows = parsed.rows.filter(r => r.valid).length;
    const dates = parsed.rows.map(r => r.date).sort();
    firstDate = dates[0] ?? null;
    lastDate = dates[dates.length - 1] ?? null;
  } else if (f.json.rows) {
    rows = f.json.rows.length;
    const dates = f.json.rows.map(r => `${r.TIME.slice(0, 4)}-${r.TIME.slice(4, 6)}-${r.TIME.slice(6, 8)}`).sort();
    firstDate = dates[0] ?? null;
    lastDate = dates[dates.length - 1] ?? null;
  }
  return {
    file: rel(path.join(rawDir, f.file)),
    sha256: hash,
    bytes: f.bytes.length,
    rows,
    validRows,
    firstDate,
    lastDate,
    fetchedAtUtc: f.json.fetchedAtUtc ?? null,
    sourceUrl: f.json.sourceUrl ?? null,
    matchesV1Checksums: v1 ? v1.sha256 === hash : null,
  };
}

// --------------------------------------------------------------------------- 2. 백엔드 원본 적재 (output/backend_fill)
interface FetchManifestEntry {
  symbol: string;
  file: string;
  sha256: string;
  bytes: number;
  fetchedAtUtc: string;
  startDate: string;
  endDate: string;
  requestUrl: string;
}
const fetchEntries = new Map<string, FetchManifestEntry>();
if (existsSync(backendDir)) {
  for (const name of readdirSync(backendDir).filter(n => /^fetch_manifest_.*\.json$/.test(n)).sort()) {
    for (const e of JSON.parse(readFileSync(path.join(backendDir, name), 'utf-8')) as FetchManifestEntry[]) fetchEntries.set(e.symbol, e);
  }
}

const backend = {} as Record<AssetCode, BackendSeries>;
const backendFiles: Amendment2Block['backendFiles'] = [];
for (const code of ASSET_CODES) {
  const file = path.join(backendDir, `${code}.json`);
  if (!existsSync(file)) throw new Error(`백엔드 원본이 없다: ${rel(file)} — 먼저 fetchBackendFill.ts 를 실행하라`);
  const bytes = readFileSync(file);
  backend[code] = parseBackendHistory(bytes.toString('utf-8'), code);
  const fe = fetchEntries.get(code);
  const hash = sha256(bytes);
  if (fe && fe.sha256 !== hash) throw new Error(`${code} 백엔드 파일 해시가 조회 기록과 다르다`);
  backendFiles.push({ symbol: code, file: rel(file), sha256: hash, bytes: bytes.length, fetchedAtUtc: fe?.fetchedAtUtc ?? null });
}

// --------------------------------------------------------------------------- 3. 이벤트 원장 TR(교차 확인용) + A2-1 백엔드 기준 TR
const ledger = {} as Record<AssetCode, YahooParsed>;
const final = {} as Record<AssetCode, YahooParsed>;
const amendmentAssets = {} as Record<AssetCode, Amendment2AssetBlock>;
const haltReasons: string[] = [];

for (const code of ASSET_CODES) {
  const events = computeLedgerEvents(yahoo[code], backend[code]);
  ledger[code] = applyEventLedger(yahoo[code], events);
  const built = buildBackendParsed(yahoo[code], backend[code], PANEL_START, PANEL_END);
  final[code] = built.parsed;
  const implied = backendImplied(ledger[code], events, backend[code], PANEL_START, PANEL_END);
  const points = ratioPoints(backend[code], ledger[code], PANEL_START, PANEL_END);
  const errors = KNOWN_LEDGER_ERRORS.filter(e => e.asset === code);
  const explanation = explainDg2(code, points, errors, events, implied);
  amendmentAssets[code] = {
    carriedDates: built.carriedDates,
    backendOnlyDates: built.backendOnlyDates,
    impossible: built.impossible,
    barsInRange: built.barsInRange,
    integerValuedBars: built.integerValuedBars,
    ohlcConsistency: ohlcCoefficientConsistency(backend[code], ledger[code], PANEL_START, PANEL_END),
    events: events.filter(e => e.exDate >= PANEL_START && e.exDate <= PANEL_END),
    implied,
    explanation,
  };
}

// --------------------------------------------------------------------------- 4. 패널 (엄격 달력)
const input: PanelInput = { kr: final, tlt, fx };
const buildP = buildPanelWithMeta(input, { includeSynthetic464470: true, calendarRule: 'yahoo-rows' });
const buildP5 = buildPanelWithMeta(input, { includeSynthetic464470: false, calendarRule: 'yahoo-rows' });
const panelP: Panel = buildP.panel;
const panelP5: Panel = buildP5.panel;
const majorityCalendar = buildSessionCalendar(final, PANEL_START, PANEL_END, 'majority-valid');
const panelPA = slicePanel(panelP, PA_START, PANEL_END);

const shapeProblems = [...validatePanelShape(panelP), ...validatePanelShape(panelP5), ...validatePanelShape(panelPA)];
const sameDates = panelP.dates.length === panelP5.dates.length && panelP.dates.every((d, i) => d === panelP5.dates[i]);

mkdirSync(outDir, { recursive: true });
const panelPText = JSON.stringify(panelP);
const panelP5Text = JSON.stringify(panelP5);
writeFileSync(path.join(outDir, 'panel_P.json'), panelPText);
writeFileSync(path.join(outDir, 'panel_P5.json'), panelP5Text);

// --------------------------------------------------------------------------- 5. DG1 / DG3 / DG4
const dg1 = ASSET_CODES.map(code =>
  dg1Series({ asset: code, parsed: final[code], from: PANEL_START, to: PANEL_END, primarySessions: panelP.dates, strictSessions: panelP.dates })
);
// DG3 는 분배 이벤트를 가진 Yahoo 계열(이벤트 원장 TR)로 본다: 백엔드 값은 원 단위로 반올림돼 있어 1e-6 계수 검사가 성립하지 않는다.
const dg3 = ASSET_CODES.map(code => dg3Series(code, ledger[code], PANEL_START, PANEL_END));
const dg3YahooReference = ASSET_CODES.map(code => dg3Series(code, withYahooFactors(ledger[code]), PANEL_START, PANEL_END));
const dg3Supplementary = [dg3Series('TLT(보조)', tlt, PANEL_START, PANEL_END)];
const dg4 = dg4Report(panelP, buildP.calendar.dropped, panelP.dates, final);

// --------------------------------------------------------------------------- 6. §10 프록시 충실도
const synth = computeSyntheticDays(panelP.dates, adjCloseSeries(tlt), rawCloseSeries(fx));
const actual464 = panelP.assets['464470'];
const actualClose = panelP.dates.map((_, i) => (actual464.source[i] === 'actual' ? actual464.close[i] : null));
const proxyClose = synth.map(d => (d ? d.price : null));
const fidelity = proxyFidelity(panelP.dates, actualClose, proxyClose, PA_START, PANEL_END);

// --------------------------------------------------------------------------- 7. DG2 (백엔드 조정 종가 vs Yahoo 이벤트 원장 TR 종가) + 알려진 오류 구간 설명
function runDg2(): Dg2Block {
  const rows: Dg2Row[] = [];
  for (const code of ASSET_CODES) {
    const app = { dates: backend[code].dates, close: backend[code].close };
    rows.push({ ...dg2Compare(code, app, ledger[code], PANEL_START, PANEL_END, 'adjusted'), reference: 'new-tr', explanation: amendmentAssets[code].explanation });
    rows.push({ ...dg2Compare(code, app, withYahooFactors(ledger[code]), PANEL_START, PANEL_END, 'adjusted'), reference: 'yahoo-adjclose' });
  }
  const head = rows.filter(r => r.reference === 'new-tr');
  const rawStatus = head.length < ASSET_CODES.length ? 'UNAVAILABLE' : worstOf(head.map(r => r.status));
  const failing = head.filter(r => r.status !== 'PASS');
  const onlyFail = failing.every(r => r.status === 'FAIL');
  const allExplained = failing.every(r => r.explanation?.explained === true);
  const explainedPass = rawStatus !== 'PASS' && failing.length > 0 && onlyFail && allExplained;
  const status: GateStatus = rawStatus === 'PASS' || explainedPass ? 'PASS' : rawStatus;
  const bad = failing.map(r => `${r.asset} ${r.matchRate === null ? '-' : (r.matchRate * 100).toFixed(1)}%`);
  let note: string;
  if (rawStatus === 'PASS') note = '6종 모두 기준을 그대로 통과했다.';
  else if (explainedPass) note = `기준 미달 종목(${bad.join(', ')})의 어긋남이 알려진 분배 오류 3건으로 구간 단위 전부 설명되어 **사유 확인 통과**로 기록한다(정정 2 A2-2).`;
  else note = `기준 미달 종목: ${bad.join(', ')}. 알려진 오류로 설명되지 않는 불일치가 남아 있다.`;
  return { status, rawStatus, explainedPass, note, rows };
}

function main(): void {
  const dg2 = runDg2();

  const dg1Status = worstOf(dg1.map(d => d.status));
  const dg3Status = worstOf(dg3.map(d => d.status));
  const blockers: string[] = [];
  const interpretationDependentItems: string[] = [];
  for (const d of dg1) for (const c of d.checks) if (c.status === 'FAIL') blockers.push(`DG1 ${d.asset} — ${c.name}: ${c.detail}`);
  for (const d of dg3) for (const c of d.checks) if (c.status === 'FAIL') blockers.push(`DG3 ${d.asset} — ${c.name}: ${c.detail}`);
  if (dg2.status !== 'PASS') {
    const bad = dg2.rows.filter(r => r.reference === 'new-tr' && r.status !== 'PASS').map(r => `${r.asset} 일치율 ${r.matchRate === null ? '-' : (r.matchRate * 100).toFixed(1)}%`);
    blockers.push(`DG2 — 백엔드 vs Yahoo(이벤트 원장 TR) 종가 대조 ${dg2.status}: ${bad.join(', ')}`);
  }
  for (const code of ASSET_CODES) {
    const ex = amendmentAssets[code].explanation;
    const raw = dg2.rows.find(r => r.asset === code && r.reference === 'new-tr');
    if (raw && raw.status !== 'PASS' && !ex.explained) {
      haltReasons.push(`DG2 설명 실패 — ${code}: 알려진 오류로 설명되지 않는 어긋난 날 ${ex.unexplainedDates.length}일${ex.unexplainedDates.length ? ` (${ex.unexplainedDates.slice(0, 5).join(', ')}${ex.unexplainedDates.length > 5 ? ' …' : ''})` : ''}, 단계 불일치 ${ex.steps.filter(s => s.date !== null && !s.ok).length}건, 무관한 원장·백엔드 불일치 ${ex.extraDisagreements.length}건`);
    }
    if (amendmentAssets[code].impossible.length > 0) haltReasons.push(`백엔드 불가능 OHLC — ${code}: ${amendmentAssets[code].impossible.length}건`);
  }
  if (!fidelity.pass) interpretationDependentItems.push('§10 실패 → 사전등록에 따라 P5가 주 분석 (중단 사유 아님)');
  if (haltReasons.length > 0) interpretationDependentItems.push('정정 2 §2 중단 조건에 걸린 항목이 있다(보고서 맨 위 HALTED 참조).');

  const amendment: Amendment2Block = {
    id: 'AMENDMENT_2',
    document: 'docs/backtest/PREREG_코어6종_신호로테이션_V3_AMENDMENT_2.md',
    backendFiles,
    assets: amendmentAssets,
    halted: haltReasons.length > 0,
    haltReasons,
  };

  const results: DataGateResults = {
    schema: 'core6-v3-data-gates-v3',
    preregistration: 'docs/backtest/PREREG_코어6종_신호로테이션_V3.md',
    calendar: {
      ruleUsed: buildP.calendar.rule,
      start: PANEL_START,
      end: PANEL_END,
      sessions: panelP.dates.length,
      firstDate: panelP.dates[0],
      lastDate: panelP.dates[panelP.dates.length - 1],
      majorityRuleSessions: majorityCalendar.dates.length,
      droppedFromCalendar: buildP.calendar.dropped,
    },
    panels: {
      P: {
        sessions: panelP.dates.length,
        sha256: sha256(panelPText),
        syntheticSessions: actual464.source.filter(s => s === 'synthetic').length,
        syntheticFreshSessions: buildP.synthetic?.syntheticFreshSessions ?? 0,
        syntheticNonFreshSessions: actual464.source.filter((s, i) => s === 'synthetic' && !actual464.fresh[i]).length,
      },
      P5: { sessions: panelP5.dates.length, sha256: sha256(panelP5Text) },
      PA: { start: PA_START, end: PANEL_END, sessions: panelPA.dates.length },
      sameDatesPandP5: sameDates,
      shapeProblems,
    },
    synthetic: buildP.synthetic,
    dg1,
    dg2,
    dg3,
    dg3Supplementary,
    dg4,
    dg5: { status: 'UNAVAILABLE', note: '사용자 제공 KRX CSV 없음 → "단일 공급자 의존" 한계로 기록(사전등록 §9 DG5).' },
    proxyFidelity: fidelity,
    amendment,
    dg3YahooReference,
    summary: {
      dg1: dg1Status,
      dg2: dg2.status,
      dg2Explained: dg2.explainedPass,
      dg3: dg3Status,
      dg4: dg4.status,
      dg5: 'UNAVAILABLE',
      section10: fidelity.status,
      primaryAnalysis: fidelity.pass ? 'P' : 'P5',
      interpretationDependentItems,
      blockers,
    },
  };

  const prePath = (name: string): string | null => {
    const p = path.join(outDir, 'pre_amendment2', name);
    return existsSync(p) ? sha256(readFileSync(p)) : null;
  };
  const manifest = {
    schema: 'core6-v3-data-manifest-v3',
    generatedAtUtc: new Date().toISOString(),
    note: 'Yahoo 원자료는 재수집하지 않고 core6SignalRotation/data/raw 의 기존 파일을 그대로 읽었다(gitignore). 백엔드 원본은 output/backend_fill/ (Amendment 1 때 조회, Amendment 2 에서 재사용). 정정 1 시점 산출물은 output/pre_amendment2/. 해시로 동일성을 증명한다.',
    rawFiles: rawFiles.map(manifestEntry),
    backendBasis: {
      description: 'A2-1: 6종 TR 조정 OHLC 는 백엔드 /history 응답 값을 그대로 쓴다(배당조정 단위, 계수 곱하지 않음). 세션 달력은 Yahoo 행이 있는 모든 날(엄격). 백엔드에 값이 없는 날은 이월(fresh=false).',
      files: backendFiles,
      requestUrl: [...fetchEntries.values()][0]?.requestUrl ?? null,
      fetchRange: { startDate: [...fetchEntries.values()][0]?.startDate ?? null, endDate: [...fetchEntries.values()][0]?.endDate ?? null },
      carriedDates: Object.fromEntries(ASSET_CODES.map(c => [c, amendmentAssets[c].carriedDates])),
      backendOnlyDates: Object.fromEntries(ASSET_CODES.map(c => [c, amendmentAssets[c].backendOnlyDates])),
    },
    adjustment: {
      method: 'backend-adjusted-ohlc',
      crossCheck: '교차 확인용 Yahoo TR 은 이벤트 원장(분배락일 직전 원시 종가 기준 1 - 분배금/종가 누적곱, amendment.ts computeLedgerEvents)으로 만든다.',
    },
    panels: {
      panel_P: { file: 'output/panel_P.json', sha256: results.panels.P.sha256, sessions: panelP.dates.length, firstDate: panelP.dates[0], lastDate: panelP.dates[panelP.dates.length - 1], preAmendment2Sha256: prePath('panel_P.json') },
      panel_P5: { file: 'output/panel_P5.json', sha256: results.panels.P5.sha256, sessions: panelP5.dates.length, preAmendment2Sha256: prePath('panel_P5.json') },
    },
    calendarRule: buildP.calendar.rule,
    halted: amendment.halted,
    haltReasons,
  };

  writeFileSync(path.join(outDir, 'DATA_MANIFEST.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(path.join(outDir, 'DATA_GATE_RESULTS.json'), JSON.stringify(results, null, 2));
  writeFileSync(path.join(outDir, 'DATA_GATE_REPORT.md'), renderGateReport(results));

  console.log(`sessions=${panelP.dates.length} (${panelP.dates[0]}..${panelP.dates[panelP.dates.length - 1]}), majority-rule=${majorityCalendar.dates.length}, dropped=${buildP.calendar.dropped.length}`);
  console.log(`DG1=${dg1Status} DG2=${dg2.status}(raw ${dg2.rawStatus}, explained=${dg2.explainedPass}) DG3=${dg3Status} DG4=${dg4.status} §10=${fidelity.status} primary=${results.summary.primaryAnalysis}`);
  console.log(`P sha256=${results.panels.P.sha256}\nP5 sha256=${results.panels.P5.sha256}`);
  console.log(`halted=${amendment.halted}`);
  if (haltReasons.length) console.log(`haltReasons:\n - ${haltReasons.join('\n - ')}`);
  if (blockers.length) console.log(`blockers:\n - ${blockers.join('\n - ')}`);
}

main();
