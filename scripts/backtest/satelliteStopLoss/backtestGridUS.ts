// scripts/backtest/satelliteStopLoss/backtestGridUS.ts
// 투더문(위성) 31종 중 미국 상장 6종만 매도규칙 그리드 백테스트 — 연구 전용(앱/백엔드 무접촉).
//
// backtestGrid.ts(31종 전체)와 완전히 같은 엔진·같은 산정 방식이며, 유니버스만
// lib/universe.ts의 track === 'us-equity' | 'us-etf' 6종(DIS·T·AMZN·GOOGL·MSFT·XLE)으로
// 좁혔다. 리포트는 별도 파일(backtest_grid_report_us.json)에 저장해 31종 전체 결과를
// 덮어쓰지 않는다.
//
// 그리드: 익절배수 4 × 마지막매도선 3 × 불타기 5 = 60조합 × 지평 4개 = 240런.
//
// 실행: npx --yes tsx scripts/backtest/satelliteStopLoss/backtestGridUS.ts

import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { SymbolSeries } from '../lib/fetchHistory';
import { buildUnionCalendar, alignToCalendar, firstValidIndex } from '../lib/calendar';
import { fxRateFor, type FxTable } from '../lib/fx';
import { computeReportMetrics, type ReportMetrics, type EquityPoint } from '../lib/metrics';
import { fetchAdjSeries } from '../coreStopLoss/lib/yahooData';
import { toPriceSeries, noSplice, type PriceSeries, type SplicedSeries } from '../coreStopLoss/lib/splice';
import {
  runSellRulePortfolio,
  computeLegSizing,
  type SellRuleLeg,
  type SellRuleLegStat,
} from '../coreStopLoss/lib/sellRuleEngine';
import { resolveUniverse } from './lib/resolve';
import { ALL_ENTRIES, type UniverseEntry } from './lib/universe';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const US_ENTRIES: UniverseEntry[] = ALL_ENTRIES.filter(
  e => e.track === 'us-equity' || e.track === 'us-etf'
);

const DATA_START = '1990-01-01';
const END = '2026-08-08';
const FX_SYMBOL = 'KRW=X';
const REPORT_PATH = path.join(__dirname, 'backtest_grid_report_us.json');

const HORIZONS = [1, 3, 5, 10] as const;
/** 총자산 대비 종목당 최대손실(사용자 명시 요구사항). */
const RISK_PER_TRADE = 0.01;
/** 전액 투자(예비현금 없음 — 제외 항목 없음). */
const INVESTED_BUDGET = 1.0;
const INITIAL_EQUITY = 100_000_000;
const MAX_PYRAMID_ADDS = 3;
const PYRAMID_COST_CAP_MULTIPLE = 2;

const PROFIT_TAKE_MULTIPLES: Array<number | null> = [null, 2, 3, 4];
const FINAL_EXIT_MAS = [10, 20, 50] as const;
const PYRAMID_INTERVALS_PCT: Array<number | null> = [null, 5, 10, 15, 20];

/** 레그 편입 요건: 지평 시작 전날까지 이 일수만큼 유효 데이터가 쌓여 있어야 한다(가장 긴 MA 기준). */
const MA_WARMUP_DAYS = Math.max(...FINAL_EXIT_MAS);

// ─── 표시 헬퍼 ────────────────────────────────────────────────
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
function f(v: number, d = 2): string {
  return isFinite(v) ? v.toFixed(d) : '—';
}

function shiftYears(dateStr: string, years: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function asSymbolSeries(p: PriceSeries): SymbolSeries {
  const nulls = p.values.map(() => null);
  return { symbol: p.symbol, dates: p.dates, open: nulls, high: nulls, low: nulls, close: p.values, ok: true };
}

/** JSON 전체를 순회하며 NaN/Infinity가 하나도 없는지 확인한다. */
function assertAllFinite(node: unknown, pathStr: string): void {
  if (typeof node === 'number') {
    if (!isFinite(node)) throw new Error(`비유한 값 발견: ${pathStr} = ${node}`);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => assertAllFinite(v, `${pathStr}[${i}]`));
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      assertAllFinite(v, `${pathStr}.${k}`);
    }
  }
}

interface LegDef {
  entry: UniverseEntry;
  symbol: string;
  spliced: SplicedSeries;
  currency: 'KRW' | 'USD';
  /** 공통 캘린더 기준 KRW 환산 시계열. */
  krwValues: (number | null)[];
  /** 유효값이 처음 나타나는 캘린더 인덱스(= 상장/데이터 시작). */
  firstIdx: number;
}

/**
 * 매도규칙을 전혀 적용하지 않은 기준선(균등비중 매수 후 보유, 리밸런싱 없음).
 * 그리드 결과가 "규칙 덕분"인지 "그냥 시장 덕분"인지 구분하려면 이 기준선이 반드시 필요하다.
 */
function buyHoldEquity(
  legs: SellRuleLeg[],
  calendar: string[],
  startIndex: number,
  endIndex: number,
  initialEquity: number
): EquityPoint[] {
  const qty = legs.map(l => {
    const p0 = l.krwValues[startIndex];
    if (typeof p0 !== 'number' || !isFinite(p0) || p0 <= 0) {
      throw new Error(`${l.symbol}: ${calendar[startIndex]} 기준선 진입가 결측`);
    }
    return (initialEquity * l.weight) / p0;
  });
  const out: EquityPoint[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    let sum = 0;
    for (let k = 0; k < legs.length; k++) {
      const p = legs[k].krwValues[i];
      if (typeof p !== 'number' || !isFinite(p) || p <= 0) {
        throw new Error(`${legs[k].symbol}: ${calendar[i]} 기준선 가격 결측`);
      }
      sum += qty[k] * p;
    }
    out.push({ date: calendar[i], value: sum });
  }
  return out;
}

interface LegWeightRow {
  symbol: string;
  name: string;
  originalWeightPct: number;
  rescaledWeightPct: number;
  stopLossPct: number;
}

interface ExcludedLegRow {
  symbol: string;
  name: string;
  firstDate: string;
  reason: string;
}

interface ComboResult {
  profitTakeMultiple: number | 'none';
  finalExitMA: number;
  pyramidIntervalPct: number | 'none';
  cagrPct: number;
  mddPct: number;
  calmarRatio: number;
  totalStopOuts: number;
  totalTrendExits: number;
  totalProfitTakes: number;
  totalPyramidAdds: number;
  totalPyramidSkipped: number;
  totalReentries: number;
  finalEquity: number;
  totalReturnPct: number;
  metrics: ReportMetrics;
  legStats: SellRuleLegStat[];
}

interface HorizonResult {
  years: number;
  startDate: string;
  endDate: string;
  tradingDays: number;
  legCount: number;
  equalWeightPct: number;
  stopLossPct: number;
  legWeights: LegWeightRow[];
  excludedLegs: ExcludedLegRow[];
  /** 매도규칙 없이 균등 매수 후 보유(리밸런싱 없음) — 비교 기준선. */
  buyHold: {
    cagrPct: number;
    mddPct: number;
    calmarRatio: number;
    finalEquity: number;
    totalReturnPct: number;
  };
  combos: ComboResult[];
}

function comboLabel(c: ComboResult): string {
  const pt = c.profitTakeMultiple === 'none' ? '익절X' : `익절x${c.profitTakeMultiple}`;
  const py = c.pyramidIntervalPct === 'none' ? '불타기X' : `불타기${c.pyramidIntervalPct}%`;
  return `${pt}/MA${c.finalExitMA}/${py}`;
}

async function main(): Promise<void> {
  console.log('='.repeat(112));
  console.log('투더문(위성) 미국주식 6종 매도규칙 그리드 백테스트 — 균등비중 + 총자산 1% 최대손실');
  console.log(
    `대상: ${US_ENTRIES.map(e => e.name).join(' · ')}`
  );
  console.log(
    `종료일 ${END} | 지평 ${HORIZONS.join('/')}년 | 조합 ${PROFIT_TAKE_MULTIPLES.length}×${FINAL_EXIT_MAS.length}×${PYRAMID_INTERVALS_PCT.length}=${PROFIT_TAKE_MULTIPLES.length * FINAL_EXIT_MAS.length * PYRAMID_INTERVALS_PCT.length}`
  );
  console.log(
    `투자예산 ${INVESTED_BUDGET * 100}%(예비현금 없음) | 허용손실 ${RISK_PER_TRADE * 100}%/종목 | 비중 균등`
  );
  console.log('='.repeat(112));

  if (US_ENTRIES.length === 0) throw new Error('미국 상장 종목이 유니버스에 없다');

  // ── 1) 데이터(티커 프로브 재사용) ─────────────────────────────
  console.log('\n[1/5] 데이터 로드(티커 프로브 + 전용 캐시 우선)...');
  const resolved = await resolveUniverse(US_ENTRIES, DATA_START, END);
  const failed = resolved.filter(r => !r.ok);
  if (failed.length > 0) {
    console.log('\n  ── 프로브 실패로 백테스트에서 제외되는 종목 ──');
    for (const r of failed) {
      console.log(
        `    ✗ ${pad(r.entry.name, 26)} 시도 ${r.triedSymbols.join(', ')} → ${r.failures.map(x => `${x.symbol}(${x.error})`).join(', ')}`
      );
    }
  }
  const okEntries = resolved.filter(r => r.ok && r.series !== null);
  if (okEntries.length === 0) throw new Error('사용 가능한 종목이 없다');

  const fxSeries = await fetchAdjSeries(FX_SYMBOL, DATA_START, END);
  if (!fxSeries.ok) throw new Error(`환율 데이터 로드 실패: ${FX_SYMBOL} (${fxSeries.error})`);
  const fxPrice = toPriceSeries(fxSeries);

  // ── 2) 시계열 정리(접합 없음) ────────────────────────────────
  console.log('\n[2/5] 시계열 정리(개별주 유니버스 — 프록시 접합 미사용)...');
  const rawLegs = okEntries.map(r => ({
    entry: r.entry,
    symbol: r.resolvedSymbol!,
    spliced: noSplice(toPriceSeries(r.series!)),
    currency: (r.entry.currency === 'USD' ? 'USD' : 'KRW') as 'USD' | 'KRW',
  }));

  // ── 3) 공통 캘린더 + KRW 환산 ────────────────────────────────
  console.log('\n[3/5] 공통 캘린더 정렬 + KRW 환산...');
  const calendar = buildUnionCalendar(
    [...rawLegs.map(l => asSymbolSeries(l.spliced)), asSymbolSeries(fxPrice)],
    DATA_START,
    END
  );
  const fxAligned = alignToCalendar(asSymbolSeries(fxPrice), calendar);
  const fx: FxTable = { usdKrw: fxAligned.close, jpyKrw: [] };

  const legDefs: LegDef[] = rawLegs.map(l => {
    const aligned = alignToCalendar(asSymbolSeries(l.spliced), calendar);
    const krwValues: (number | null)[] = aligned.close.map((v, i) => {
      if (typeof v !== 'number' || !isFinite(v) || v <= 0) return null;
      return l.currency === 'USD' ? v * fxRateFor('USD', fx, i) : v;
    });
    const firstIdx = firstValidIndex(krwValues);
    if (firstIdx < 0) throw new Error(`${l.symbol}: 캘린더 정렬 후 유효값 없음`);
    return { ...l, krwValues, firstIdx };
  });

  console.log(`  캘린더 ${calendar.length}일 (${calendar[0]} ~ ${calendar[calendar.length - 1]})`);
  console.log(`  레그 후보 ${legDefs.length}종 | MA 워밍업 요건 ${MA_WARMUP_DAYS}일(최장 마지막매도선 기준)`);

  // ── 4) 그리드 시뮬레이션 ─────────────────────────────────────
  console.log('\n[4/5] 그리드 시뮬레이션...');
  const endIndex = calendar.length - 1;
  const horizons: HorizonResult[] = [];

  for (const years of HORIZONS) {
    const wantStart = shiftYears(END, years);
    const startIndex = calendar.findIndex(d => d >= wantStart);
    if (startIndex < 1) throw new Error(`지평 ${years}년: 시작일 ${wantStart} 캘린더 확보 실패`);

    // 지평 시작 전날(startIndex-1)까지 MA 워밍업을 마친 레그만 편입한다.
    const eligible = legDefs.filter(l => l.firstIdx <= startIndex - MA_WARMUP_DAYS);
    const excluded: ExcludedLegRow[] = legDefs
      .filter(l => l.firstIdx > startIndex - MA_WARMUP_DAYS)
      .map(l => ({
        symbol: l.symbol,
        name: l.entry.name,
        firstDate: calendar[l.firstIdx],
        reason:
          l.firstIdx >= startIndex
            ? `상장(${calendar[l.firstIdx]})이 지평 시작(${calendar[startIndex]}) 이후 — 데이터 없음`
            : `상장(${calendar[l.firstIdx]}) 후 지평 시작까지 ${startIndex - l.firstIdx}일 < MA 워밍업 ${MA_WARMUP_DAYS}일`,
      }));
    if (eligible.length === 0) throw new Error(`지평 ${years}년: 편입 가능한 레그 0종`);

    // 균등비중 — 사용자 명시 지시(보유수량/평가액 등 일체 미반영).
    const equalPct = 100 / eligible.length;
    const sizing = computeLegSizing(
      eligible.map(() => equalPct),
      INVESTED_BUDGET,
      RISK_PER_TRADE
    );
    const weightSum = sizing.reduce((a, s) => a + s.rescaledWeight, 0);
    if (Math.abs(weightSum - INVESTED_BUDGET) > 1e-9) {
      throw new Error(`지평 ${years}년: 재정규화 비중 합 ${weightSum} ≠ ${INVESTED_BUDGET}`);
    }
    for (let k = 0; k < sizing.length; k++) {
      const s = sizing[k].stopLossPct;
      if (!(s > 0.01) || !(s < 0.9)) {
        throw new Error(
          `${eligible[k].symbol}: 손절폭 ${(s * 100).toFixed(2)}%가 상식 범위(1~90%) 밖 — 사이징 수식 점검 필요`
        );
      }
    }
    // 균등비중이므로 손절폭은 전 레그 동일해야 한다(사이징 수식 자체 점검).
    const stopSet = new Set(sizing.map(s => s.stopLossPct.toFixed(10)));
    if (stopSet.size !== 1) {
      throw new Error(`지평 ${years}년: 균등비중인데 손절폭이 갈렸다 (${[...stopSet].join(', ')})`);
    }

    const legs: SellRuleLeg[] = eligible.map((l, k) => ({
      symbol: l.symbol,
      label: l.entry.name,
      krwValues: l.krwValues,
      weight: sizing[k].rescaledWeight,
      stopLossPct: sizing[k].stopLossPct,
    }));
    const legWeights: LegWeightRow[] = legs.map((l, k) => ({
      symbol: l.symbol,
      name: l.label,
      originalWeightPct: sizing[k].originalWeightPct,
      rescaledWeightPct: sizing[k].rescaledWeight * 100,
      stopLossPct: sizing[k].stopLossPct * 100,
    }));

    console.log(
      `\n  ▶ ${years}년 (${calendar[startIndex]} ~ ${calendar[endIndex]}, ${endIndex - startIndex + 1}일)` +
        `  편입 ${legs.length}종 · 균등비중 ${f(100 / legs.length, 3)}% · 손절폭 ${f(sizing[0].stopLossPct * 100, 2)}%`
    );
    if (excluded.length > 0) {
      for (const e of excluded) {
        console.log(`      · 제외 ${pad(e.name, 26)}${pad(e.symbol, 12)}${e.reason}`);
      }
    }

    const bhEquity = buyHoldEquity(legs, calendar, startIndex, endIndex, INITIAL_EQUITY);
    const bhMetrics = computeReportMetrics(bhEquity, []);
    const bhFinal = bhEquity[bhEquity.length - 1].value;
    console.log(
      `      [기준선] 규칙없이 균등 매수후보유: CAGR ${f(bhMetrics.cagrPct, 2)}% · MDD ${f(bhMetrics.mddPct, 2)}% · Calmar ${f(bhMetrics.calmar, 2)} · 최종 ${f(bhFinal / 1e8, 3)}억`
    );

    const combos: ComboResult[] = [];
    for (const ptm of PROFIT_TAKE_MULTIPLES) {
      for (const maPeriod of FINAL_EXIT_MAS) {
        for (const pyPct of PYRAMID_INTERVALS_PCT) {
          const r = runSellRulePortfolio(legs, {
            calendar,
            startIndex,
            endIndex,
            profitTakeMultiple: ptm,
            finalExitMAPeriod: maPeriod,
            pyramidIntervalPct: pyPct === null ? null : pyPct / 100,
            maxPyramidAdds: MAX_PYRAMID_ADDS,
            pyramidCostCapMultiple: PYRAMID_COST_CAP_MULTIPLE,
            initialEquity: INITIAL_EQUITY,
            investedBudget: INVESTED_BUDGET,
          });
          const metrics = computeReportMetrics(r.equity, r.trades);
          const finalEquity = r.equity[r.equity.length - 1].value;
          if (!isFinite(finalEquity) || finalEquity <= 0) {
            throw new Error(`조합 ${ptm}/${maPeriod}/${pyPct}: 최종자산 비정상 (${finalEquity})`);
          }
          combos.push({
            profitTakeMultiple: ptm === null ? 'none' : ptm,
            finalExitMA: maPeriod,
            pyramidIntervalPct: pyPct === null ? 'none' : pyPct,
            cagrPct: metrics.cagrPct,
            mddPct: metrics.mddPct,
            calmarRatio: metrics.calmar,
            totalStopOuts: r.totalStopOuts,
            totalTrendExits: r.totalTrendExits,
            totalProfitTakes: r.totalProfitTakes,
            totalPyramidAdds: r.totalPyramidAdds,
            totalPyramidSkipped: r.totalPyramidSkipped,
            totalReentries: r.totalReentries,
            finalEquity,
            totalReturnPct: (finalEquity / INITIAL_EQUITY - 1) * 100,
            metrics,
            legStats: r.legStats,
          });
        }
      }
    }

    horizons.push({
      years,
      startDate: calendar[startIndex],
      endDate: calendar[endIndex],
      tradingDays: endIndex - startIndex + 1,
      legCount: legs.length,
      equalWeightPct: 100 / legs.length,
      stopLossPct: sizing[0].stopLossPct * 100,
      legWeights,
      excludedLegs: excluded,
      buyHold: {
        cagrPct: bhMetrics.cagrPct,
        mddPct: bhMetrics.mddPct,
        calmarRatio: bhMetrics.calmar,
        finalEquity: bhFinal,
        totalReturnPct: (bhFinal / INITIAL_EQUITY - 1) * 100,
      },
      combos,
    });
    console.log(`      ${combos.length}조합 완료`);
  }

  // ── 5) 리포트 ────────────────────────────────────────────────
  console.log('\n[5/5] 리포트...');

  // profitFactor는 손실거래 0이면 Infinity가 된다 — 직렬화 전에 페일클로즈.
  for (const h of horizons) {
    for (const c of h.combos) {
      if (!isFinite(c.metrics.profitFactor)) {
        throw new Error(
          `지평 ${h.years}년 ${comboLabel(c)}: profitFactor가 비유한(${c.metrics.profitFactor}) — 손실거래 0건 의심`
        );
      }
    }
  }

  const h1 = horizons.find(h => h.years === 1)!;
  console.log('\n' + '─'.repeat(112));
  console.log(`1년 지평 전체 60조합 (${h1.startDate} ~ ${h1.endDate}, ${h1.legCount}종 · 손절폭 ${f(h1.stopLossPct, 2)}%)`);
  console.log('─'.repeat(112));
  console.log(
    '  ' +
      pad('익절', 8) + pad('MA', 6) + pad('불타기', 9) +
      padL('CAGR%', 9) + padL('MDD%', 9) + padL('Calmar', 9) +
      padL('손절', 7) + padL('추세이탈', 10) + padL('익절체결', 10) +
      padL('불타기', 8) + padL('재진입', 8) + padL('최종(억)', 11)
  );
  for (const c of h1.combos) {
    console.log(
      '  ' +
        pad(c.profitTakeMultiple === 'none' ? '없음' : `x${c.profitTakeMultiple}`, 8) +
        pad(String(c.finalExitMA), 6) +
        pad(c.pyramidIntervalPct === 'none' ? '없음' : `${c.pyramidIntervalPct}%`, 9) +
        padL(f(c.cagrPct, 2), 9) + padL(f(c.mddPct, 2), 9) + padL(f(c.calmarRatio, 2), 9) +
        padL(String(c.totalStopOuts), 7) + padL(String(c.totalTrendExits), 10) +
        padL(String(c.totalProfitTakes), 10) + padL(String(c.totalPyramidAdds), 8) +
        padL(String(c.totalReentries), 8) + padL(f(c.finalEquity / 1e8, 3), 11)
    );
  }

  console.log('\n' + '─'.repeat(112));
  console.log('지평별 상·하위 3조합 (CAGR 기준 / Calmar 기준)');
  console.log('─'.repeat(112));
  for (const h of horizons) {
    const byCagr = [...h.combos].sort((a, b) => b.cagrPct - a.cagrPct);
    const byCalmar = [...h.combos].sort((a, b) => b.calmarRatio - a.calmarRatio);
    console.log(
      `\n  ▶ ${h.years}년 (${h.startDate} ~ ${h.endDate}) — ${h.legCount}종 · 균등 ${f(h.equalWeightPct, 3)}% · 손절폭 ${f(h.stopLossPct, 2)}%`
    );
    console.log(
      '    ' + pad('[기준선]', 10) + pad('규칙없이 매수후보유', 26) +
        padL(`CAGR ${f(h.buyHold.cagrPct, 2)}%`, 16) + padL(`MDD ${f(h.buyHold.mddPct, 2)}%`, 15) +
        padL(`Calmar ${f(h.buyHold.calmarRatio, 2)}`, 16)
    );
    const line = (tag: string, c: ComboResult): string =>
      '    ' + pad(tag, 10) + pad(comboLabel(c), 26) +
      padL(`CAGR ${f(c.cagrPct, 2)}%`, 16) + padL(`MDD ${f(c.mddPct, 2)}%`, 15) +
      padL(`Calmar ${f(c.calmarRatio, 2)}`, 16) + padL(`손절 ${c.totalStopOuts}`, 10) +
      padL(`이탈 ${c.totalTrendExits}`, 10);
    console.log('    [CAGR 상위]');
    byCagr.slice(0, 3).forEach((c, i) => console.log(line(`#${i + 1}`, c)));
    console.log('    [CAGR 하위]');
    byCagr.slice(-3).reverse().forEach((c, i) => console.log(line(`#${i + 1}`, c)));
    console.log('    [Calmar 상위]');
    byCalmar.slice(0, 3).forEach((c, i) => console.log(line(`#${i + 1}`, c)));
    console.log('    [Calmar 하위]');
    byCalmar.slice(-3).reverse().forEach((c, i) => console.log(line(`#${i + 1}`, c)));
  }

  console.log('\n' + '─'.repeat(112));
  console.log('이상징후 — 조합별 최장 유휴 레그(재진입 못 하고 현금으로 대기한 거래일)');
  console.log('─'.repeat(112));
  for (const h of horizons) {
    let worst: { combo: ComboResult; leg: SellRuleLegStat } | null = null;
    for (const c of h.combos) {
      for (const ls of c.legStats) {
        if (worst === null || ls.idleDays > worst.leg.idleDays) worst = { combo: c, leg: ls };
      }
    }
    if (worst) {
      const pct = (worst.leg.idleDays / h.tradingDays) * 100;
      console.log(
        `  ${pad(`${h.years}년`, 7)}${pad(comboLabel(worst.combo), 26)}${pad(worst.leg.label, 26)}` +
          `유휴 ${worst.leg.idleDays}일 / ${h.tradingDays}일 (${f(pct, 1)}%), 재진입 ${worst.leg.reentries}회`
      );
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    endDate: END,
    source: 'yahoo-v8',
    model: 'per-leg continuous sell-rule state machine (no periodic rebalancing)',
    universe: 'satellite(투더문) 31종 중 미국 상장 6종만 — 사용자 지정, 균등비중',
    config: {
      riskPercentPerTrade: RISK_PER_TRADE,
      investedBudget: INVESTED_BUDGET,
      initialEquity: INITIAL_EQUITY,
      horizons: HORIZONS,
      profitTakeMultiples: PROFIT_TAKE_MULTIPLES.map(v => (v === null ? 'none' : v)),
      finalExitMAs: FINAL_EXIT_MAS,
      pyramidIntervalsPct: PYRAMID_INTERVALS_PCT.map(v => (v === null ? 'none' : v)),
      maxPyramidAdds: MAX_PYRAMID_ADDS,
      pyramidCostCapMultiple: PYRAMID_COST_CAP_MULTIPLE,
      maWarmupDays: MA_WARMUP_DAYS,
      weighting: 'equal (100/N per leg, per-horizon N)',
      spliceUsed: false,
      universeSize: US_ENTRIES.length,
      resolvedCount: okEntries.length,
      probeFailures: failed.map(r => ({
        name: r.entry.name,
        triedSymbols: r.triedSymbols,
        failures: r.failures,
      })),
      resolvedSymbols: okEntries.map(r => ({
        name: r.entry.name,
        requested: r.entry.symbol,
        resolved: r.resolvedSymbol,
        firstDate: r.series!.dates[0],
      })),
    },
    horizons,
    caveats: [
      '대상은 투더문(위성) 31종 중 미국 상장 6종만(DIS·T·AMZN·GOOGL·MSFT·XLE) — 사용자 요청으로 범위를 좁혔다.',
      '전 종목 균등비중(사용자 명시 지시). 실제 보유수량/매수가/평가액은 일체 사용하지 않았다.',
      '균등비중이므로 손절폭은 전 종목 동일하다: 1%(허용손실) / (1/N) = N%. N은 지평별 편입 종목 수라 지평마다 손절폭이 달라질 수 있다(이번 6종은 전부 1990~2004년 이전 상장이라 전 지평에서 6종 모두 편입 — N=6 고정, 손절폭 6.00%로 일정할 것으로 예상되며 리포트 수치로 재확인할 것).',
      '지평 시작 시점에 MA 워밍업(최장 50일)을 못 마친 종목은 그 지평에서만 제외했다(horizons[].excludedLegs 참조).',
      '리밸런싱이 없다. 청산 대금은 그 레그 안에서만 유휴(0%)로 대기하고 같은 레그가 재진입할 때 전액 재투입된다(레그 간 재배분 없음).',
      '불타기 추가매수는 그 레그가 이미 보유한 현금으로만 자금을 댄다. 최초 진입에서 배분액을 전액 매수하므로 부분익절로 현금이 생긴 뒤에만 실제 체결될 수 있다(미체결은 totalPyramidSkipped).',
      '공통 캘린더가 한국·미국 거래일의 합집합이라 이동평균 기간은 "한 시장의 거래일"이 아니라 합집합 캘린더 일수 기준이다(결측일은 직전 종가 carry-forward). 이번 6종은 전부 미국 상장이라 실질적으로는 미국 거래일과 거의 일치한다.',
      '미국 종목은 일별 USD/KRW(Yahoo KRW=X)로 환산했다 — 환율 변동이 손익에 그대로 반영된다.',
      'Yahoo 수정종가(배당·분할 반영) 기준.',
      '모든 체결은 종가 기준이며 슬리피지·거래비용·세금은 반영하지 않았다.',
      '부분익절 매도도 ClosedTrade로 기록되므로 승률/손익비는 "청산 건"이 아니라 "매도 건" 기준이다.',
      '6종을 동시에 균등 보유하는 것은 실제 운용 이력이 아니라 가정이다(생존편향: 현재 보유 중인 종목만으로 과거를 재구성했다).',
      'horizons[].buyHold는 같은 레그 집합·같은 구간을 매도규칙 없이 균등 매수 후 보유한 기준선이다. 조합 성과는 반드시 이 기준선과 비교해서 읽어야 한다.',
    ],
  };

  assertAllFinite(report, 'report');
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n  머신리더블 리포트 저장: ${REPORT_PATH}`);
  console.log('='.repeat(112));
}

main().catch(e => {
  console.error('그리드 백테스트 중 예외:', e);
  process.exit(1);
});
