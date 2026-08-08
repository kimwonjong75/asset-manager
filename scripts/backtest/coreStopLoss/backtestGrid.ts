// scripts/backtest/coreStopLoss/backtestGrid.ts
// 매도규칙 그리드 백테스트 — 연구 전용(앱/백엔드 무접촉).
//
// backtest.ts(정기 리밸런싱 + 공통 손절폭)의 **대체 모델**이다. 두 가지가 다르다:
//   1) 손절폭이 레그별로 다르다. 사용자의 원래 목표비중 14종을 96%로 비례 재정규화하고
//      stopLossPct_i = 1%(허용손실) / rescaledWeight_i 로 도출한다.
//      (공통 손절폭을 쓰면 비중 = 1%/손절폭 이 모든 레그에서 같아져 균등비중으로 퇴화한다 —
//       바로 그 결함을 고치는 것이 이 스크립트의 목적이다.)
//   2) 정기 리밸런싱이 없다. 레그마다 독립적인 연속 상태기계(손절/익절/불타기/추세이탈/재진입).
//
// 그리드: 익절배수 4 × 마지막매도선 3 × 불타기 5 = 60조합 × 지평 4개 = 240런.
//
// 실행: npx --yes tsx scripts/backtest/coreStopLoss/backtestGrid.ts

import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { SymbolSeries } from '../lib/fetchHistory';
import { buildUnionCalendar, alignToCalendar } from '../lib/calendar';
import { fxRateFor, type FxTable } from '../lib/fx';
import { computeReportMetrics, type ReportMetrics } from '../lib/metrics';
import { fetchMany, type AdjSeries } from './lib/yahooData';
import { ALL_ENTRIES, type UniverseEntry } from './lib/universe';
import {
  toPriceSeries,
  noSplice,
  spliceWithProxy,
  type PriceSeries,
  type SplicedSeries,
} from './lib/splice';
import {
  runSellRulePortfolio,
  computeLegSizing,
  type SellRuleLeg,
  type SellRuleLegStat,
} from './lib/sellRuleEngine';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_START = '1990-01-01';
const END = '2026-08-08';
const FX_SYMBOL = 'KRW=X';
const REPORT_PATH = path.join(__dirname, 'backtest_grid_report.json');

const HORIZONS = [1, 3, 5, 10] as const;
const RISK_PER_TRADE = 0.01;
const INVESTED_BUDGET = 0.96;
const INITIAL_EQUITY = 100_000_000;
const MAX_PYRAMID_ADDS = 3;
const PYRAMID_COST_CAP_MULTIPLE = 2;

const PROFIT_TAKE_MULTIPLES: Array<number | null> = [null, 2, 3, 4];
const FINAL_EXIT_MAS = [10, 20, 50] as const;
const PYRAMID_INTERVALS_PCT: Array<number | null> = [null, 5, 10, 15, 20];

/** 사용자의 원래 목표비중(%) — universe.ts의 비프록시 14종과 심볼로 매칭한다. */
const ORIGINAL_WEIGHT_PCT: Record<string, number> = {
  '069500.KS': 5.0,
  '474800.KS': 2.5,
  '379810.KS': 2.5,
  EIS: 2.5,
  '283580.KS': 4.0,
  '372330.KS': 2.0,
  ECH: 2.5,
  EWZ: 2.0,
  EIDO: 2.0,
  '385560.KS': 4.0,
  '464470.KS': 4.5,
  '411060.KS': 6.0,
  SLV: 3.0,
  '160580.KS': 1.5,
};

/** 상장이 늦어 프록시 접합이 필요한 레그: 실제심볼 → 프록시심볼. */
const SPLICE_MAP: Record<string, string> = {
  '474800.KS': 'XLE',
  '379810.KS': 'QQQ',
  '283580.KS': 'ASHR',
  '372330.KS': 'KWEB',
  '385560.KS': 'TLT',
  '464470.KS': 'TLT',
  '411060.KS': 'GLD',
};

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
  spliced: SplicedSeries;
  currency: 'KRW' | 'USD';
}

interface LegWeightRow {
  symbol: string;
  label: string;
  originalWeightPct: number;
  rescaledWeightPct: number;
  stopLossPct: number;
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
  combos: ComboResult[];
}

function comboLabel(c: ComboResult): string {
  const pt = c.profitTakeMultiple === 'none' ? '익절X' : `익절x${c.profitTakeMultiple}`;
  const py = c.pyramidIntervalPct === 'none' ? '불타기X' : `불타기${c.pyramidIntervalPct}%`;
  return `${pt}/MA${c.finalExitMA}/${py}`;
}

async function main(): Promise<void> {
  console.log('='.repeat(104));
  console.log('매도규칙 그리드 백테스트 — 레그별 차등 손절폭 + 익절배수 × 마지막매도선 × 불타기');
  console.log(
    `종료일 ${END} | 지평 ${HORIZONS.join('/')}년 | 조합 ${PROFIT_TAKE_MULTIPLES.length}×${FINAL_EXIT_MAS.length}×${PYRAMID_INTERVALS_PCT.length}=${PROFIT_TAKE_MULTIPLES.length * FINAL_EXIT_MAS.length * PYRAMID_INTERVALS_PCT.length}`
  );
  console.log(
    `투자예산 ${INVESTED_BUDGET * 100}% (예비현금 ${((1 - INVESTED_BUDGET) * 100).toFixed(0)}%, 0%) | 허용손실 ${RISK_PER_TRADE * 100}%/레그`
  );
  console.log('='.repeat(104));

  // ── 1) 데이터 ────────────────────────────────────────────────
  console.log('\n[1/5] 데이터 로드(전용 캐시 우선)...');
  const symbols = [...ALL_ENTRIES.map(e => e.symbol), FX_SYMBOL];
  const seriesMap = await fetchMany(symbols, DATA_START, END);
  const get = (sym: string): AdjSeries => {
    const s = seriesMap.get(sym);
    if (!s || !s.ok) throw new Error(`데이터 로드 실패: ${sym} (${s?.error ?? 'missing'})`);
    return s;
  };
  const priceOf = new Map<string, PriceSeries>();
  for (const sym of symbols) priceOf.set(sym, toPriceSeries(get(sym)));

  // ── 2) 접합 ──────────────────────────────────────────────────
  console.log('\n[2/5] 프록시 접합(수익률 체인)...');
  const realEntries = ALL_ENTRIES.filter(e => e.track !== 'proxy-extension');
  if (realEntries.length !== Object.keys(ORIGINAL_WEIGHT_PCT).length) {
    throw new Error(
      `레그 수 불일치: universe ${realEntries.length}종 vs 비중표 ${Object.keys(ORIGINAL_WEIGHT_PCT).length}종`
    );
  }
  const legDefs: LegDef[] = realEntries.map(entry => {
    const real = priceOf.get(entry.symbol)!;
    const proxySym = SPLICE_MAP[entry.symbol];
    if (proxySym) {
      const spliced = spliceWithProxy(real, priceOf.get(proxySym)!);
      console.log(
        `  ${pad(entry.symbol, 12)}← ${pad(proxySym, 6)} 실제 ${spliced.realFirstDate}부터 (합성 ${spliced.proxyRowCount}일 + 실제 ${spliced.realRowCount}일, 시작 ${spliced.dates[0]})`
      );
      return { entry, spliced, currency: 'KRW' };
    }
    const spliced = noSplice(real);
    console.log(
      `  ${pad(entry.symbol, 12)}  접합없음  ${spliced.dates[0]}~ (${spliced.realRowCount}일, ${entry.currency})`
    );
    return { entry, spliced, currency: entry.currency === 'USD' ? 'USD' : 'KRW' };
  });

  // ── 3) 공통 캘린더 + KRW 환산 + 레그별 사이징 ────────────────
  console.log('\n[3/5] 공통 캘린더 정렬 + KRW 환산 + 레그별 비중/손절폭 산출...');
  const fxPrice = priceOf.get(FX_SYMBOL)!;
  const calendar = buildUnionCalendar(
    [...legDefs.map(l => asSymbolSeries(l.spliced)), asSymbolSeries(fxPrice)],
    DATA_START,
    END
  );
  const fxAligned = alignToCalendar(asSymbolSeries(fxPrice), calendar);
  const fx: FxTable = { usdKrw: fxAligned.close, jpyKrw: [] };

  const originalPcts = legDefs.map(l => {
    const w = ORIGINAL_WEIGHT_PCT[l.entry.symbol];
    if (typeof w !== 'number') throw new Error(`비중표에 없는 심볼: ${l.entry.symbol}`);
    return w;
  });
  const sizing = computeLegSizing(originalPcts, INVESTED_BUDGET, RISK_PER_TRADE);

  // 사이징 정합성: 재정규화 비중 합 = 투자예산, 손절폭이 상식 범위(1%~90%)인지.
  const weightSum = sizing.reduce((a, s) => a + s.rescaledWeight, 0);
  if (Math.abs(weightSum - INVESTED_BUDGET) > 1e-12) {
    throw new Error(`재정규화 비중 합 ${weightSum} ≠ ${INVESTED_BUDGET}`);
  }
  for (let k = 0; k < sizing.length; k++) {
    const s = sizing[k].stopLossPct;
    if (!(s > 0.01) || !(s < 0.9)) {
      throw new Error(
        `${legDefs[k].entry.symbol}: 손절폭 ${(s * 100).toFixed(2)}%가 상식 범위(1~90%) 밖 — 사이징 수식 점검 필요`
      );
    }
  }

  const legs: SellRuleLeg[] = legDefs.map((l, k) => {
    const aligned = alignToCalendar(asSymbolSeries(l.spliced), calendar);
    const krwValues: (number | null)[] = aligned.close.map((v, i) => {
      if (typeof v !== 'number' || !isFinite(v) || v <= 0) return null;
      return l.currency === 'USD' ? v * fxRateFor('USD', fx, i) : v;
    });
    return {
      symbol: l.entry.symbol,
      label: l.entry.label,
      krwValues,
      weight: sizing[k].rescaledWeight,
      stopLossPct: sizing[k].stopLossPct,
    };
  });

  const legWeights: LegWeightRow[] = legs.map((l, k) => ({
    symbol: l.symbol,
    label: l.label,
    originalWeightPct: sizing[k].originalWeightPct,
    rescaledWeightPct: sizing[k].rescaledWeight * 100,
    stopLossPct: sizing[k].stopLossPct * 100,
  }));

  console.log(
    `  캘린더 ${calendar.length}일 (${calendar[0]} ~ ${calendar[calendar.length - 1]})`
  );
  console.log('\n  ── 레그별 비중/손절폭 (핵심 정합성 산출물) ──');
  console.log(
    '  ' + pad('종목', 12) + pad('구분', 26) + padL('원비중%', 10) + padL('재정규화%', 12) + padL('손절폭%', 11)
  );
  for (const r of legWeights) {
    console.log(
      '  ' +
        pad(r.symbol, 12) +
        pad(r.label, 26) +
        padL(f(r.originalWeightPct, 2), 10) +
        padL(f(r.rescaledWeightPct, 4), 12) +
        padL(f(r.stopLossPct, 2), 11)
    );
  }
  console.log(
    '  ' +
      pad('합계', 38) +
      padL(f(legWeights.reduce((a, r) => a + r.originalWeightPct, 0), 2), 10) +
      padL(f(legWeights.reduce((a, r) => a + r.rescaledWeightPct, 0), 4), 12)
  );

  // ── 4) 그리드 시뮬레이션 ─────────────────────────────────────
  console.log('\n[4/5] 그리드 시뮬레이션...');
  const endIndex = calendar.length - 1;
  const horizons: HorizonResult[] = [];

  for (const years of HORIZONS) {
    const wantStart = shiftYears(END, years);
    const startIndex = calendar.findIndex(d => d >= wantStart);
    if (startIndex < 1) throw new Error(`지평 ${years}년: 시작일 ${wantStart} 캘린더 확보 실패`);
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
      combos,
    });
    console.log(
      `  ▶ ${years}년: ${calendar[startIndex]} ~ ${calendar[endIndex]} (${endIndex - startIndex + 1}일), ${combos.length}조합 완료`
    );
  }

  // ── 5) 리포트 ────────────────────────────────────────────────
  console.log('\n[5/5] 리포트...');

  // profitFactor는 Infinity가 될 수 있으므로(손실거래 0) 직렬화 전에 방어한다.
  for (const h of horizons) {
    for (const c of h.combos) {
      if (!isFinite(c.metrics.profitFactor)) {
        throw new Error(
          `지평 ${h.years}년 ${comboLabel(c)}: profitFactor가 비유한(${c.metrics.profitFactor}) — 손실거래 0건 의심`
        );
      }
    }
  }

  // 1년 지평 전체 60조합 표
  const h1 = horizons.find(h => h.years === 1)!;
  console.log('\n' + '─'.repeat(104));
  console.log(`1년 지평 전체 60조합 (${h1.startDate} ~ ${h1.endDate})`);
  console.log('─'.repeat(104));
  console.log(
    '  ' +
      pad('익절', 8) +
      pad('MA', 6) +
      pad('불타기', 9) +
      padL('CAGR%', 9) +
      padL('MDD%', 9) +
      padL('Calmar', 9) +
      padL('손절', 7) +
      padL('추세이탈', 10) +
      padL('익절체결', 10) +
      padL('불타기', 8) +
      padL('재진입', 8) +
      padL('최종(억)', 11)
  );
  for (const c of h1.combos) {
    console.log(
      '  ' +
        pad(c.profitTakeMultiple === 'none' ? '없음' : `x${c.profitTakeMultiple}`, 8) +
        pad(String(c.finalExitMA), 6) +
        pad(c.pyramidIntervalPct === 'none' ? '없음' : `${c.pyramidIntervalPct}%`, 9) +
        padL(f(c.cagrPct, 2), 9) +
        padL(f(c.mddPct, 2), 9) +
        padL(f(c.calmarRatio, 2), 9) +
        padL(String(c.totalStopOuts), 7) +
        padL(String(c.totalTrendExits), 10) +
        padL(String(c.totalProfitTakes), 10) +
        padL(String(c.totalPyramidAdds), 8) +
        padL(String(c.totalReentries), 8) +
        padL(f(c.finalEquity / 1e8, 3), 11)
    );
  }

  // 지평별 베스트/워스트
  console.log('\n' + '─'.repeat(104));
  console.log('지평별 상·하위 3조합 (CAGR 기준 / Calmar 기준)');
  console.log('─'.repeat(104));
  for (const h of horizons) {
    const byCagr = [...h.combos].sort((a, b) => b.cagrPct - a.cagrPct);
    const byCalmar = [...h.combos].sort((a, b) => b.calmarRatio - a.calmarRatio);
    console.log(`\n  ▶ ${h.years}년 (${h.startDate} ~ ${h.endDate})`);
    const line = (tag: string, c: ComboResult): string =>
      '    ' +
      pad(tag, 10) +
      pad(comboLabel(c), 26) +
      padL(`CAGR ${f(c.cagrPct, 2)}%`, 16) +
      padL(`MDD ${f(c.mddPct, 2)}%`, 15) +
      padL(`Calmar ${f(c.calmarRatio, 2)}`, 16) +
      padL(`손절 ${c.totalStopOuts}`, 10) +
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

  // 이상징후 점검: 장기 유휴 레그
  console.log('\n' + '─'.repeat(104));
  console.log('이상징후 — 조합별 최장 유휴 레그(재진입 못 하고 현금으로 대기한 거래일)');
  console.log('─'.repeat(104));
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
      spliceMap: SPLICE_MAP,
      legCount: legs.length,
    },
    legWeights,
    horizons,
    caveats: [
      '손절폭은 레그별로 다르다: 1%(허용손실) / 재정규화비중. 비중이 큰 레그일수록 손절이 타이트하다.',
      '리밸런싱이 없다. 청산 대금은 그 레그 안에서만 유휴(0%)로 대기하고 같은 레그가 재진입할 때 전액 재투입된다(레그 간 재배분 없음).',
      '불타기 추가매수는 "그 레그가 이미 보유한 현금"으로만 자금을 댄다. 최초 진입에서 배분액을 전액 매수하므로 그 사이클의 레그 현금은 0이며, 부분익절로 현금이 생긴 뒤에만 실제 체결될 수 있다. 체결되지 못한 트리거는 totalPyramidSkipped로 집계된다.',
      '385560.KS(한국 국고채30년)의 프록시는 TLT(미국채30년)로 듀레이션·통화·금리사이클이 달라 불완전 대체다.',
      '프록시 합성 구간은 프록시의 USD 수익률을 그대로 사용하므로 원/달러 환율 변동 효과가 반영되지 않는다.',
      '372330.KS(항셍테크)의 프록시 KWEB은 구성이 유사할 뿐 동일 지수가 아니다.',
      '모든 체결은 종가 기준이며 슬리피지·거래비용·세금은 반영하지 않았다.',
      '부분익절 매도도 ClosedTrade로 기록되므로 승률/손익비는 "청산 건" 기준이 아니라 "매도 건" 기준이다.',
    ],
  };

  assertAllFinite(report, 'report');
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n  머신리더블 리포트 저장: ${REPORT_PATH}`);
  console.log('='.repeat(104));
}

main().catch(e => {
  console.error('그리드 백테스트 중 예외:', e);
  process.exit(1);
});
