// scripts/backtest/sectorRotation/gate0Audit.ts
// Gate 0 데이터 감사 — 섹터/테마 로테이션 백테스트를 시작하기 전에
// 모든 트랙의 모든 종목이 (1) 수정(총수익) 데이터인지 (2) 구간/유동성/구멍이
// 백테스트에 쓸 만한지 검사한다. 연구 전용(앱/백엔드 무접촉, Yahoo v8 직접 조회).
//
// 실행: npx --yes tsx scripts/backtest/sectorRotation/gate0Audit.ts

import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchMany, type AdjSeries } from './lib/yahooData';
import { TRACKS, ALL_ENTRIES, type UniverseEntry } from './lib/universe';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const START = '1990-01-01';
const END = '2026-07-13';
const REPORT_PATH = path.join(__dirname, 'gate0_report.json');

interface AuditRow {
  symbol: string;
  label: string;
  track: string;
  currency: 'USD' | 'KRW' | 'JPY';
  probe: boolean;
  note?: string;
  ok: boolean;
  error?: string;
  firstDate: string | null;
  lastDate: string | null;
  n: number;
  adjRatioFirst: number | null; // adjClose[0]/rawClose[0]
  adjustmentStatus: string; // 'adjusted(배당반영)' | 'flat(무배당/지수/최근상장)' | 'unknown'
  maxGapDays: number | null;
  recentAvgTurnover: number | null; // 최근 60행 평균 일 거래대금(현지 통화)
  illiquid: boolean;
  maxDropAdjPct: number | null; // 수정 시계열 최대 1일 낙폭(%)
  maxDropRawPct: number | null; // 미조정 시계열 최대 1일 낙폭(%)
  status: string; // 'OK' | 'FAIL(<reason>)'
}

// 유동성 하한(현지 통화). 이보다 낮으면 체결 비현실 → 플래그.
const ILLIQUID_THRESHOLD: Record<'USD' | 'KRW' | 'JPY', number> = {
  USD: 1_000_000, // 100만 달러/일
  KRW: 500_000_000, // 5억 원/일
  JPY: 100_000_000, // 1억 엔/일
};

function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Math.round(ms / 86400000);
}

function maxGap(dates: string[]): number | null {
  if (dates.length < 2) return null;
  let max = 0;
  for (let i = 1; i < dates.length; i++) {
    const g = daysBetween(dates[i - 1], dates[i]);
    if (g > max) max = g;
  }
  return max;
}

function recentTurnover(s: AdjSeries): number | null {
  const rows: number[] = [];
  for (let i = s.dates.length - 1; i >= 0 && rows.length < 60; i--) {
    const p = s.adjClose[i];
    const v = s.volume[i];
    if (typeof p === 'number' && typeof v === 'number' && isFinite(p) && isFinite(v)) {
      rows.push(p * v);
    }
  }
  if (rows.length === 0) return null;
  return rows.reduce((a, b) => a + b, 0) / rows.length;
}

// 최대 1일 낙폭(%). 인접 유효값끼리 비교, 가장 큰 하락을 음수 %로 반환.
function maxDropPct(vals: (number | null)[]): number | null {
  let prev: number | null = null;
  let worst = 0;
  let seen = false;
  for (const v of vals) {
    if (typeof v === 'number' && isFinite(v) && v > 0) {
      if (prev !== null) {
        seen = true;
        const chg = (v - prev) / prev;
        if (chg < worst) worst = chg;
      }
      prev = v;
    }
  }
  return seen ? worst * 100 : null;
}

function classifyAdjustment(ratio: number | null): string {
  if (ratio === null) return 'unknown';
  if (ratio < 0.98) return 'adjusted(배당반영)';
  return 'flat(무배당/지수/최근상장)';
}

function buildRow(entry: UniverseEntry, s: AdjSeries): AuditRow {
  const base = {
    symbol: entry.symbol,
    label: entry.label,
    track: entry.track,
    currency: entry.currency,
    probe: entry.probe ?? false,
    note: entry.note,
  };

  if (!s.ok || s.dates.length === 0) {
    const reason = s.error ?? 'no-data';
    return {
      ...base,
      ok: false,
      error: s.error,
      firstDate: null,
      lastDate: null,
      n: 0,
      adjRatioFirst: null,
      adjustmentStatus: 'unknown',
      maxGapDays: null,
      recentAvgTurnover: null,
      illiquid: false,
      maxDropAdjPct: null,
      maxDropRawPct: null,
      status: `FAIL(${reason})`,
    };
  }

  const n = s.dates.length;
  const firstDate = s.dates[0];
  const lastDate = s.dates[n - 1];
  const firstAdj = s.adjClose[0];
  const firstRaw = s.rawClose[0];
  const ratio =
    typeof firstAdj === 'number' && typeof firstRaw === 'number' && firstRaw !== 0
      ? firstAdj / firstRaw
      : null;

  const turnover = recentTurnover(s);
  const illiquid = turnover !== null && turnover < ILLIQUID_THRESHOLD[entry.currency];

  const hasAdj = s.adjClose.some(v => typeof v === 'number' && isFinite(v));
  const status = hasAdj ? 'OK' : 'FAIL(adjClose-missing)';

  return {
    ...base,
    ok: status === 'OK',
    error: s.error,
    firstDate,
    lastDate,
    n,
    adjRatioFirst: ratio,
    adjustmentStatus: classifyAdjustment(ratio),
    maxGapDays: maxGap(s.dates),
    recentAvgTurnover: turnover,
    illiquid,
    maxDropAdjPct: maxDropPct(s.adjClose),
    maxDropRawPct: maxDropPct(s.rawClose),
    status,
  };
}

// ─── 표시 헬퍼 ───────────────────────────────────────────────
function fmtNum(v: number | null, digits = 2): string {
  if (v === null || !isFinite(v)) return '—';
  return v.toFixed(digits);
}

function fmtTurnover(v: number | null, ccy: string): string {
  if (v === null || !isFinite(v)) return '—';
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}억${ccy}`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}만${ccy}`;
  return `${v.toFixed(0)}${ccy}`;
}

function ccyShort(ccy: string): string {
  return ccy === 'USD' ? '$' : ccy === 'KRW' ? '원' : '엔';
}

// 한글/전각 대략 2폭 계산해 컬럼 정렬(근사).
function pad(s: string, w: number): string {
  let width = 0;
  for (const ch of s) width += ch.charCodeAt(0) > 0x2e7f ? 2 : 1;
  const gap = w - width;
  return gap > 0 ? s + ' '.repeat(gap) : s + ' ';
}

async function main(): Promise<void> {
  console.log('='.repeat(80));
  console.log('Gate 0 데이터 감사 — 섹터/테마 로테이션 백테스트');
  console.log(`요청 구간: ${START} ~ ${END}  |  소스: Yahoo v8(수정종가) 직접 조회`);
  console.log('='.repeat(80));

  console.log('\n[1/2] 데이터 다운로드(전용 캐시 우선)...');
  const symbols = ALL_ENTRIES.map(e => e.symbol);
  const seriesMap = await fetchMany(symbols, START, END);

  const rows: AuditRow[] = ALL_ENTRIES.map(e => {
    const s = seriesMap.get(e.symbol);
    return buildRow(
      e,
      s ?? {
        symbol: e.symbol,
        source: 'yahoo-v8',
        dates: [],
        adjOpen: [],
        adjHigh: [],
        adjLow: [],
        adjClose: [],
        volume: [],
        rawClose: [],
        ok: false,
        error: 'missing-from-map',
      }
    );
  });

  // ─── 콘솔 리포트 ───────────────────────────────────────────
  console.log('\n[2/2] 감사 리포트');
  console.log('─'.repeat(80));
  console.log('범례: ✓=OK ✗=FAIL | 조정=수정/미조정 첫값 비율(<0.98=배당반영, 확인됨=총수익)');
  console.log('      낙폭= 최대 1일 하락%(수정/미조정) | 유동성=최근60일 평균 일거래대금(현지통화)');
  console.log('      ※ 시장별 휴일이 달라 소규모 갭은 정상. 유동성 낮음(!)은 체결 비현실 경고.');
  console.log('─'.repeat(80));

  const rowByTrack = new Map<string, AuditRow[]>();
  for (const r of rows) {
    const arr = rowByTrack.get(r.track) ?? [];
    arr.push(r);
    rowByTrack.set(r.track, arr);
  }

  const cautions: string[] = [];

  for (const t of TRACKS) {
    const trackRows = rowByTrack.get(t.track) ?? [];
    console.log(`\n▶ ${t.label}  [${t.track}]`);
    console.log(
      '  ' +
        pad('종목', 12) +
        pad('구분', 15) +
        pad('첫날짜', 12) +
        pad('끝날짜', 12) +
        pad('일수', 7) +
        pad('조정', 22) +
        pad('낙폭(수/미)', 16) +
        pad('유동성', 13) +
        '상태'
    );

    let okCount = 0;
    let latestFirst: string | null = null;
    let earliestLast: string | null = null;

    for (const r of trackRows) {
      const mark = r.ok ? '✓' : '✗';
      if (r.ok) okCount++;
      const liqStr =
        fmtTurnover(r.recentAvgTurnover, ccyShort(r.currency)) + (r.illiquid ? '(!)' : '');
      const dropStr = `${fmtNum(r.maxDropAdjPct, 1)}/${fmtNum(r.maxDropRawPct, 1)}`;
      console.log(
        '  ' +
          pad(`${mark} ${r.symbol}`, 12) +
          pad(r.label + (r.probe ? '·프로브' : ''), 15) +
          pad(r.firstDate ?? '—', 12) +
          pad(r.lastDate ?? '—', 12) +
          pad(String(r.n), 7) +
          pad(r.adjustmentStatus, 22) +
          pad(dropStr, 16) +
          pad(liqStr, 13) +
          r.status
      );

      if (r.ok && r.firstDate && r.lastDate) {
        if (latestFirst === null || r.firstDate > latestFirst) latestFirst = r.firstDate;
        if (earliestLast === null || r.lastDate < earliestLast) earliestLast = r.lastDate;
      }
      if (!r.ok) cautions.push(`${r.track}/${r.symbol}: ${r.status}`);
      else if (r.illiquid)
        cautions.push(
          `${r.track}/${r.symbol}(${r.label}): 유동성 낮음 ${fmtTurnover(r.recentAvgTurnover, ccyShort(r.currency))} → 체결 비현실 주의`
        );
    }

    const common =
      latestFirst && earliestLast ? `${latestFirst} ~ ${earliestLast}` : '없음(OK 종목 부족)';
    console.log(`  └ 소계: ${okCount}/${trackRows.length} OK | 공통 백테스트 구간(근사): ${common}`);
    if (latestFirst) {
      cautions.push(`${t.track} 공통 시작가능일: ${latestFirst} (가장 늦게 상장한 종목 기준)`);
    }
  }

  // ─── 전체 요약 ─────────────────────────────────────────────
  const totalOk = rows.filter(r => r.ok).length;
  const totalFail = rows.filter(r => !r.ok);
  const allAdjusted = rows.filter(r => r.ok && r.adjustmentStatus === 'adjusted(배당반영)').length;
  const flat = rows.filter(r => r.ok && r.adjustmentStatus.startsWith('flat')).length;

  console.log('\n' + '='.repeat(80));
  console.log('전체 요약');
  console.log('='.repeat(80));
  console.log(`  종목: ${rows.length}개  |  OK ${totalOk}  |  FAIL ${totalFail.length}`);
  console.log(
    `  조정 확인: 배당반영(adjusted) ${allAdjusted}개 · 평탄(flat=무배당/지수/최근상장) ${flat}개`
  );
  console.log('  → 모든 성공 종목은 수정(총수익) 시계열임(미조정 대체 없음).');

  console.log('\n  주의사항:');
  if (cautions.length === 0) {
    console.log('    (특이사항 없음)');
  } else {
    for (const c of cautions) console.log(`    - ${c}`);
  }

  // ─── JSON 리포트 ───────────────────────────────────────────
  const report = {
    generatedAt: new Date().toISOString(),
    requestedStart: START,
    requestedEnd: END,
    source: 'yahoo-v8',
    summary: {
      total: rows.length,
      ok: totalOk,
      fail: totalFail.length,
      adjusted: allAdjusted,
      flat,
      failed: totalFail.map(r => ({ symbol: r.symbol, track: r.track, status: r.status })),
    },
    rows,
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n  머신리더블 리포트 저장: ${REPORT_PATH}`);
  console.log('='.repeat(80));
}

main().catch(e => {
  console.error('감사 중 예외:', e);
  process.exit(1);
});
