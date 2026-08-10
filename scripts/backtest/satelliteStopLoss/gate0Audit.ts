// scripts/backtest/satelliteStopLoss/gate0Audit.ts
// Gate 0 데이터 감사 — 투더문(위성) 31종 손절 백테스트 착수 전 데이터 점검.
//   (a) 올바른 티커/거래소 접미사 확정(.KS/.KQ 순차 프로브)
//   (b) 데이터 확보 가능 여부(실패 종목은 사유와 함께 **명시적으로 목록화**)
//   (c) 최초 상장일(Yahoo 최초 거래일 근사)
//   (d) 10/5/3/1년 지평 각각을 몇 % 실제데이터로 커버하는지
// 연구 전용(앱/백엔드 무접촉, Yahoo v8 직접 조회).
//
// 실행: npx --yes tsx scripts/backtest/satelliteStopLoss/gate0Audit.ts

import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AdjSeries } from '../coreStopLoss/lib/yahooData';
import { resolveUniverse, type ResolvedEntry } from './lib/resolve';
import { ALL_ENTRIES, TRACK_ORDER, TRACK_LABELS, type Track } from './lib/universe';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const START = '1990-01-01';
const END = '2026-08-08';
const HORIZONS = [10, 5, 3, 1] as const;
const REPORT_PATH = path.join(__dirname, 'gate0_report.json');

/** 유동성 하한(현지 통화). 이보다 낮으면 체결 비현실 → 플래그. */
const ILLIQUID_THRESHOLD: Record<'USD' | 'KRW', number> = {
  USD: 1_000_000, // 100만 달러/일
  KRW: 500_000_000, // 5억 원/일
};

interface HorizonCoverage {
  years: number;
  /** 지평 시작일(END 에서 years 년 전). */
  horizonStart: string;
  /** 그 지평에서 실제 데이터가 시작되는 날(= max(상장일, horizonStart)). */
  effectiveStart: string | null;
  /** 실데이터 커버율(%) — 지평 전체 달력일수 대비. */
  coveragePct: number;
  /** 지평 시작 시점에 이미 상장해 있었는가(100% 커버). */
  fullyCovered: boolean;
}

interface AuditRow {
  name: string;
  requestedSymbol: string;
  resolvedSymbol: string | null;
  triedSymbols: string[];
  track: Track;
  currency: 'USD' | 'KRW';
  confidence: 'confirmed' | 'probe';
  note?: string;
  ok: boolean;
  failureReasons: Array<{ symbol: string; error: string }>;
  firstDate: string | null;
  lastDate: string | null;
  n: number;
  historyYears: number | null;
  adjRatioFirst: number | null;
  adjustmentStatus: string;
  maxGapDays: number | null;
  recentAvgTurnover: number | null;
  illiquid: boolean;
  maxDropAdjPct: number | null;
  maxDropRawPct: number | null;
  horizons: HorizonCoverage[];
  status: string;
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Math.round(ms / 86400000);
}

function shiftYears(dateStr: string, years: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
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

/** 최대 1일 낙폭(%). 인접 유효값끼리 비교, 가장 큰 하락을 음수 %로 반환. */
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

function buildCoverage(firstDate: string): HorizonCoverage[] {
  return HORIZONS.map(years => {
    const horizonStart = shiftYears(END, years);
    const total = daysBetween(horizonStart, END);
    const effectiveStart = firstDate > horizonStart ? firstDate : horizonStart;
    const covered = Math.max(0, daysBetween(effectiveStart, END));
    const pct = total > 0 ? (covered / total) * 100 : 0;
    return {
      years,
      horizonStart,
      effectiveStart: covered > 0 ? effectiveStart : null,
      coveragePct: pct,
      fullyCovered: firstDate <= horizonStart,
    };
  });
}

function buildRow(r: ResolvedEntry): AuditRow {
  const base = {
    name: r.entry.name,
    requestedSymbol: r.entry.symbol,
    resolvedSymbol: r.resolvedSymbol,
    triedSymbols: r.triedSymbols,
    track: r.entry.track,
    currency: r.entry.currency,
    confidence: r.entry.confidence,
    note: r.entry.note,
    failureReasons: r.failures,
  };

  const s = r.series;
  if (!r.ok || s === null || s.dates.length === 0) {
    const reason = r.failures.map(f => `${f.symbol}:${f.error}`).join(' / ') || 'no-data';
    return {
      ...base,
      ok: false,
      firstDate: null,
      lastDate: null,
      n: 0,
      historyYears: null,
      adjRatioFirst: null,
      adjustmentStatus: 'unknown',
      maxGapDays: null,
      recentAvgTurnover: null,
      illiquid: false,
      maxDropAdjPct: null,
      maxDropRawPct: null,
      horizons: HORIZONS.map(years => ({
        years,
        horizonStart: shiftYears(END, years),
        effectiveStart: null,
        coveragePct: 0,
        fullyCovered: false,
      })),
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
  const illiquid = turnover !== null && turnover < ILLIQUID_THRESHOLD[r.entry.currency];
  const hasAdj = s.adjClose.some(v => typeof v === 'number' && isFinite(v));

  return {
    ...base,
    ok: hasAdj,
    firstDate,
    lastDate,
    n,
    historyYears: daysBetween(firstDate, lastDate) / 365.25,
    adjRatioFirst: ratio,
    adjustmentStatus: classifyAdjustment(ratio),
    maxGapDays: maxGap(s.dates),
    recentAvgTurnover: turnover,
    illiquid,
    maxDropAdjPct: maxDropPct(s.adjClose),
    maxDropRawPct: maxDropPct(s.rawClose),
    horizons: buildCoverage(firstDate),
    status: hasAdj ? 'OK' : 'FAIL(adjClose-missing)',
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
  return ccy === 'USD' ? '$' : '원';
}

/** 한글/전각을 2폭으로 세어 컬럼 정렬(근사). */
function pad(s: string, w: number): string {
  let width = 0;
  for (const ch of s) width += ch.charCodeAt(0) > 0x2e7f ? 2 : 1;
  const gap = w - width;
  return gap > 0 ? s + ' '.repeat(gap) : s + ' ';
}
function padL(s: string, w: number): string {
  let width = 0;
  for (const ch of s) width += ch.charCodeAt(0) > 0x2e7f ? 2 : 1;
  const gap = w - width;
  return gap > 0 ? ' '.repeat(gap) + s : s;
}

async function main(): Promise<void> {
  console.log('='.repeat(112));
  console.log('Gate 0 데이터 감사 — 투더문(위성) 31종 · 총자산 1% 최대손실 백테스트');
  console.log(`요청 구간: ${START} ~ ${END}  |  소스: Yahoo v8(수정종가) 직접 조회`);
  console.log(`대상 ${ALL_ENTRIES.length}종 · 전 종목 균등비중 전제(보유수량/매수가 등 일체 미사용)`);
  console.log('='.repeat(112));

  console.log('\n[1/3] 티커 프로브 + 데이터 다운로드(.KS→.KQ 순차, 전용 캐시 우선)...');
  const resolved = await resolveUniverse(ALL_ENTRIES, START, END);
  const rows: AuditRow[] = resolved.map(buildRow);

  // ─── 트랙별 상세 ───────────────────────────────────────────
  console.log('\n[2/3] 종목별 감사');
  console.log('─'.repeat(112));
  console.log('범례: ✓=OK ✗=FAIL | 조정=수정/미조정 첫값 비율(<0.98=배당반영) | 낙폭=최대 1일 하락%(수정/미조정)');
  console.log('      유동성=최근60일 평균 일거래대금(현지통화), (!)=체결 비현실 경고');
  console.log('─'.repeat(112));

  const byTrack = new Map<Track, AuditRow[]>();
  for (const r of rows) {
    const arr = byTrack.get(r.track) ?? [];
    arr.push(r);
    byTrack.set(r.track, arr);
  }

  const cautions: string[] = [];

  for (const t of TRACK_ORDER) {
    const trackRows = byTrack.get(t) ?? [];
    if (trackRows.length === 0) continue;
    console.log(`\n▶ ${TRACK_LABELS[t]}  [${t}]  ${trackRows.length}종`);
    console.log(
      '  ' +
        pad('종목명', 26) +
        pad('확정티커', 12) +
        pad('첫거래일', 12) +
        pad('끝날짜', 12) +
        padL('일수', 7) +
        padL('이력(년)', 10) +
        '  ' +
        pad('조정', 22) +
        pad('낙폭(수/미)', 15) +
        pad('유동성', 13) +
        '상태'
    );
    for (const r of trackRows) {
      const mark = r.ok ? '✓' : '✗';
      const liqStr = fmtTurnover(r.recentAvgTurnover, ccyShort(r.currency)) + (r.illiquid ? '(!)' : '');
      const dropStr = `${fmtNum(r.maxDropAdjPct, 1)}/${fmtNum(r.maxDropRawPct, 1)}`;
      console.log(
        '  ' +
          pad(`${mark} ${r.name}`, 26) +
          pad(r.resolvedSymbol ?? r.requestedSymbol, 12) +
          pad(r.firstDate ?? '—', 12) +
          pad(r.lastDate ?? '—', 12) +
          padL(String(r.n), 7) +
          padL(fmtNum(r.historyYears, 1), 10) +
          '  ' +
          pad(r.adjustmentStatus, 22) +
          pad(dropStr, 15) +
          pad(liqStr, 13) +
          r.status
      );
      if (!r.ok) cautions.push(`${r.name}(${r.requestedSymbol}): ${r.status}`);
      else if (r.illiquid) {
        cautions.push(
          `${r.name}(${r.resolvedSymbol}): 유동성 낮음 ${fmtTurnover(r.recentAvgTurnover, ccyShort(r.currency))} → 체결 비현실 주의`
        );
      }
      if (r.ok && r.resolvedSymbol !== r.requestedSymbol) {
        cautions.push(`${r.name}: 1순위 ${r.requestedSymbol} 실패 → ${r.resolvedSymbol} 채택(거래소 접미사 교정)`);
      }
    }
  }

  // ─── 지평 커버리지 ─────────────────────────────────────────
  console.log('\n[3/3] 지평별 실데이터 커버리지');
  console.log('─'.repeat(112));
  const okRows = rows.filter(r => r.ok && r.firstDate);
  console.log(
    '  ' + pad('종목명', 26) + pad('확정티커', 12) + pad('상장일', 12) +
      HORIZONS.map(y => padL(`${y}년`, 12)).join('')
  );
  const sortedOk = [...okRows].sort((a, b) => (a.firstDate! < b.firstDate! ? 1 : -1));
  for (const r of sortedOk) {
    console.log(
      '  ' +
        pad(r.name, 26) +
        pad(r.resolvedSymbol ?? '—', 12) +
        pad(r.firstDate!, 12) +
        r.horizons
          .map(h => padL(h.fullyCovered ? '100%' : `${h.coveragePct.toFixed(0)}%`, 12))
          .join('')
    );
  }

  console.log('\n  ── 지평별 요약 (그 지평 전체를 실데이터로 100% 커버하는 종목 수) ──');
  const horizonSummary = HORIZONS.map(years => {
    const hs = shiftYears(END, years);
    const full = okRows.filter(r => r.firstDate! <= hs);
    const partial = okRows.filter(r => r.firstDate! > hs);
    console.log(
      `    ${padL(`${years}년`, 5)} (${hs} ~ ${END}): 완전커버 ${full.length}종 / 부분 ${partial.length}종 / 전체 성공 ${okRows.length}종` +
        (partial.length > 0 ? `  ← 부분: ${partial.map(p => p.name).join(', ')}` : '')
    );
    return {
      years,
      horizonStart: hs,
      fullyCoveredCount: full.length,
      fullyCoveredSymbols: full.map(r => r.resolvedSymbol!),
      partialSymbols: partial.map(r => ({ name: r.name, symbol: r.resolvedSymbol!, firstDate: r.firstDate! })),
    };
  });

  // ─── 전체 요약 ─────────────────────────────────────────────
  const failed = rows.filter(r => !r.ok);
  console.log('\n' + '='.repeat(112));
  console.log('전체 요약');
  console.log('='.repeat(112));
  console.log(`  종목: ${rows.length}개  |  프로브 성공 ${okRows.length}  |  실패 ${failed.length}`);
  if (failed.length > 0) {
    console.log('\n  ── 프로브 실패 종목(명시적 목록) ──');
    for (const r of failed) {
      console.log(
        `    ✗ ${pad(r.name, 26)} 시도: ${r.triedSymbols.join(', ')} → ${r.failureReasons.map(f => `${f.symbol}(${f.error})`).join(', ')}`
      );
    }
  }

  const relabeled = rows.filter(r => r.ok && r.resolvedSymbol !== r.requestedSymbol);
  if (relabeled.length > 0) {
    console.log('\n  ── 거래소 접미사 교정된 종목 ──');
    for (const r of relabeled) {
      console.log(`    ${pad(r.name, 26)} ${r.requestedSymbol} → ${r.resolvedSymbol}`);
    }
  }

  console.log('\n  주의사항:');
  if (cautions.length === 0) console.log('    (특이사항 없음)');
  else for (const c of cautions) console.log(`    - ${c}`);

  const report = {
    generatedAt: new Date().toISOString(),
    requestedStart: START,
    requestedEnd: END,
    source: 'yahoo-v8',
    universeSize: ALL_ENTRIES.length,
    summary: {
      total: rows.length,
      ok: okRows.length,
      fail: failed.length,
      failedEntries: failed.map(r => ({
        name: r.name,
        triedSymbols: r.triedSymbols,
        failureReasons: r.failureReasons,
      })),
      relabeled: relabeled.map(r => ({
        name: r.name,
        requested: r.requestedSymbol,
        resolved: r.resolvedSymbol,
      })),
      horizonSummary,
    },
    rows,
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n  머신리더블 리포트 저장: ${REPORT_PATH}`);
  console.log('='.repeat(112));
}

main().catch(e => {
  console.error('감사 중 예외:', e);
  process.exit(1);
});
