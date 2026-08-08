// scripts/backtest/coreStopLoss/backtest.ts
// 코어(정적배분) + 종목별 1% 최대손실 손절 백테스트 — 연구 전용(앱/백엔드 무접촉).
//
// 지평 1/3/5/10년 × 손절폭 3/5/7/10% = 16개 조합을 돌려 CAGR/MDD/Calmar 등을 비교한다.
// 데이터: Yahoo v8 수정종가(Gate 0 감사 통과분) + 상장 늦은 7종은 미국상장 프록시로 접합.
//
// 실행: npx --yes tsx scripts/backtest/coreStopLoss/backtest.ts

import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { SymbolSeries } from '../lib/fetchHistory';
import { buildUnionCalendar, alignToCalendar } from '../lib/calendar';
import { fxRateFor, type FxTable } from '../lib/fx';
import { semiAnnualRebalanceIndices } from '../lib/rebalanceDates';
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
import { runPortfolio, computeTargetWeights, type EngineLeg } from './lib/portfolioEngine';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_START = '1990-01-01';
const END = '2026-08-08';
const FX_SYMBOL = 'KRW=X';
const REPORT_PATH = path.join(__dirname, 'backtest_report.json');

const HORIZONS = [1, 3, 5, 10] as const;
const STOP_PCTS = [0.03, 0.05, 0.07, 0.1] as const;
const RISK_PER_TRADE = 0.01; // 종목별 1% 최대손실
const INVESTED_BUDGET = 0.96; // GRVT 채권펀드 4% 제외분은 현금
const INITIAL_EQUITY = 100_000_000; // 1억 원

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

// ─── 표시 헬퍼 (gate0Audit.ts 스타일) ──────────────────────────
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
  return {
    symbol: p.symbol,
    dates: p.dates,
    open: nulls,
    high: nulls,
    low: nulls,
    close: p.values,
    ok: true,
  };
}

interface LegDef {
  entry: UniverseEntry;
  spliced: SplicedSeries;
  /** 시계열 값의 통화. 접합 레그·KRX 레그는 KRW, 미국상장 프록시 전용 레그는 USD. */
  currency: 'KRW' | 'USD';
}

interface ComboSpliceCoverage {
  symbol: string;
  label: string;
  proxySymbol: string | null;
  realFirstDate: string;
  realDays: number;
  proxyDays: number;
  realPct: number;
}

interface ComboResult {
  horizonYears: number;
  stopLossPercent: number;
  startDate: string;
  endDate: string;
  tradingDays: number;
  targetWeightPerLeg: number;
  weightSumMin: number;
  weightSumMax: number;
  rebalanceCount: number;
  finalEquity: number;
  totalReturnPct: number;
  metrics: ReportMetrics;
  legStats: Array<{ symbol: string; label: string; stopOutCount: number; realizedLossKRW: number }>;
}

async function main(): Promise<void> {
  console.log('='.repeat(96));
  console.log('코어(정적배분) + 종목별 1% 최대손실 손절 백테스트');
  console.log(`종료일 ${END} | 지평 ${HORIZONS.join('/')}년 | 손절폭 ${STOP_PCTS.map(s => `${(s * 100).toFixed(0)}%`).join('/')}`);
  console.log(`투자예산 ${INVESTED_BUDGET * 100}% (GRVT 채권펀드 제외분 ${(100 - INVESTED_BUDGET * 100).toFixed(0)}% 현금) | 리밸런싱 반기(1월·7월)`);
  console.log('='.repeat(96));

  // ── 1) 데이터 ────────────────────────────────────────────────
  console.log('\n[1/4] 데이터 로드(전용 캐시 우선)...');
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
  console.log('\n[2/4] 프록시 접합(수익률 체인)...');
  const realEntries = ALL_ENTRIES.filter(e => e.track !== 'proxy-extension');
  const legDefs: LegDef[] = realEntries.map(entry => {
    const real = priceOf.get(entry.symbol)!;
    const proxySym = SPLICE_MAP[entry.symbol];
    if (proxySym) {
      const proxy = priceOf.get(proxySym)!;
      const spliced = spliceWithProxy(real, proxy);
      console.log(
        `  ${pad(entry.symbol, 12)}← ${pad(proxySym, 6)} 실제 ${spliced.realFirstDate}부터 ` +
          `(합성 ${spliced.proxyRowCount}일 + 실제 ${spliced.realRowCount}일, 시작 ${spliced.dates[0]})`
      );
      return { entry, spliced, currency: 'KRW' };
    }
    const spliced = noSplice(real);
    console.log(
      `  ${pad(entry.symbol, 12)}  접합없음  ${spliced.dates[0]}~ (${spliced.realRowCount}일, ${entry.currency})`
    );
    return { entry, spliced, currency: entry.currency === 'USD' ? 'USD' : 'KRW' };
  });

  console.log(`  → 레그 ${legDefs.length}종 (프록시 접합 ${Object.keys(SPLICE_MAP).length}종)`);

  // ── 3) 공통 캘린더 + KRW 환산 ────────────────────────────────
  console.log('\n[3/4] 공통 캘린더 정렬 + KRW 환산...');
  const fxPrice = priceOf.get(FX_SYMBOL)!;
  const calendar = buildUnionCalendar(
    [...legDefs.map(l => asSymbolSeries(l.spliced)), asSymbolSeries(fxPrice)],
    DATA_START,
    END
  );
  const fxAligned = alignToCalendar(asSymbolSeries(fxPrice), calendar);
  const fx: FxTable = { usdKrw: fxAligned.close, jpyKrw: [] };

  const legs: EngineLeg[] = legDefs.map(l => {
    const aligned = alignToCalendar(asSymbolSeries(l.spliced), calendar);
    const krwValues: (number | null)[] = aligned.close.map((v, i) => {
      if (typeof v !== 'number' || !isFinite(v) || v <= 0) return null;
      return l.currency === 'USD' ? v * fxRateFor('USD', fx, i) : v;
    });
    return {
      symbol: l.entry.symbol,
      label: l.entry.label,
      krwValues,
      realFirstDate: l.spliced.realFirstDate,
      proxySymbol: l.spliced.proxySymbol,
    };
  });

  const rebalanceIndices = semiAnnualRebalanceIndices(calendar);
  console.log(
    `  캘린더 ${calendar.length}일 (${calendar[0]} ~ ${calendar[calendar.length - 1]}), ` +
      `반기 리밸런싱 후보 ${rebalanceIndices.length}회`
  );

  // ── 4) 시뮬레이션 ────────────────────────────────────────────
  console.log('\n[4/4] 시뮬레이션...');
  const endIndex = calendar.length - 1;
  const results: ComboResult[] = [];
  const coverageByHorizon: Record<string, ComboSpliceCoverage[]> = {};

  for (const horizon of HORIZONS) {
    const wantStart = shiftYears(END, horizon);
    const startIndex = calendar.findIndex(d => d >= wantStart);
    if (startIndex < 0) throw new Error(`지평 ${horizon}년: 시작일 ${wantStart} 캘린더에 없음`);
    const window = calendar.slice(startIndex, endIndex + 1);

    // 접합 커버리지(해당 지평 안에서 실제상품 vs 프록시 일수)
    const coverage: ComboSpliceCoverage[] = legs
      .filter(l => l.proxySymbol !== null)
      .map(l => {
        const realDays = window.filter(d => d >= l.realFirstDate).length;
        return {
          symbol: l.symbol,
          label: legDefs.find(x => x.entry.symbol === l.symbol)!.entry.label,
          proxySymbol: l.proxySymbol,
          realFirstDate: l.realFirstDate,
          realDays,
          proxyDays: window.length - realDays,
          realPct: (realDays / window.length) * 100,
        };
      });
    coverageByHorizon[`${horizon}y`] = coverage;

    for (const stopPct of STOP_PCTS) {
      const r = runPortfolio(legs, {
        calendar,
        startIndex,
        endIndex,
        stopLossPercent: stopPct,
        riskPercentPerTrade: RISK_PER_TRADE,
        investedBudget: INVESTED_BUDGET,
        rebalanceIndices,
        initialEquity: INITIAL_EQUITY,
      });

      const metrics = computeReportMetrics(r.equity, r.trades);
      const finalEquity = r.equity[r.equity.length - 1].value;
      const weightSums = r.rebalances.map(x => x.weightSum);
      const { weights } = computeTargetWeights(
        legs.length,
        stopPct,
        RISK_PER_TRADE,
        INVESTED_BUDGET
      );

      // 무결성 검사: NaN/Infinity 금지
      for (const [k, v] of Object.entries(metrics)) {
        if (typeof v === 'number' && !isFinite(v)) {
          throw new Error(`지평 ${horizon}년/손절 ${stopPct}: 지표 ${k}가 유한값이 아님 (${v})`);
        }
      }
      if (!isFinite(finalEquity) || finalEquity <= 0) {
        throw new Error(`지평 ${horizon}년/손절 ${stopPct}: 최종 자산 비정상 (${finalEquity})`);
      }
      // 무결성 검사: 레버리지 누수 금지 (비중 합 ≈ 96%)
      for (const ws of weightSums) {
        if (Math.abs(ws - INVESTED_BUDGET) > 1e-9) {
          throw new Error(
            `지평 ${horizon}년/손절 ${stopPct}: 리밸런싱 비중 합 ${ws} ≠ ${INVESTED_BUDGET}`
          );
        }
      }

      results.push({
        horizonYears: horizon,
        stopLossPercent: stopPct,
        startDate: calendar[startIndex],
        endDate: calendar[endIndex],
        tradingDays: window.length,
        targetWeightPerLeg: weights[0],
        weightSumMin: Math.min(...weightSums),
        weightSumMax: Math.max(...weightSums),
        rebalanceCount: r.rebalances.length,
        finalEquity,
        totalReturnPct: (finalEquity / INITIAL_EQUITY - 1) * 100,
        metrics,
        legStats: r.legStats,
      });
    }
  }

  // ── 콘솔 리포트 ──────────────────────────────────────────────
  console.log('\n' + '='.repeat(96));
  console.log('결과 — 지평별 × 손절폭별');
  console.log('='.repeat(96));

  for (const horizon of HORIZONS) {
    const rows = results.filter(r => r.horizonYears === horizon);
    const head = rows[0];
    console.log(
      `\n▶ ${horizon}년 지평  (${head.startDate} ~ ${head.endDate}, 거래일 ${head.tradingDays}일, ` +
        `리밸런싱 ${head.rebalanceCount}회, 레그당 목표비중 ${f(head.targetWeightPerLeg * 100, 2)}%)`
    );
    console.log(
      '  ' +
        pad('손절폭', 9) +
        padL('총수익%', 11) +
        padL('CAGR%', 9) +
        padL('MDD%', 9) +
        padL('Calmar', 9) +
        padL('손절건수', 10) +
        padL('최대연속손절', 14) +
        padL('최악3년%', 11) +
        padL('최종자산(억)', 14)
    );
    for (const r of rows) {
      const m = r.metrics;
      console.log(
        '  ' +
          pad(`${(r.stopLossPercent * 100).toFixed(0)}%`, 9) +
          padL(f(r.totalReturnPct, 1), 11) +
          padL(f(m.cagrPct, 2), 9) +
          padL(f(m.mddPct, 2), 9) +
          padL(f(m.calmar, 2), 9) +
          padL(String(m.tradeCount), 10) +
          padL(String(m.maxConsecutiveLosses), 14) +
          padL(f(m.worst3yRollingPct, 1), 11) +
          padL(f(r.finalEquity / 1e8, 3), 14)
      );
    }
  }

  // 손절폭 민감도(지평 가로) 서브테이블
  console.log('\n' + '─'.repeat(96));
  console.log('손절폭 민감도 요약 (CAGR% / MDD% / Calmar)');
  console.log('─'.repeat(96));
  console.log('  ' + pad('손절폭', 9) + HORIZONS.map(h => padL(`${h}년`, 26)).join(''));
  for (const stopPct of STOP_PCTS) {
    let line = '  ' + pad(`${(stopPct * 100).toFixed(0)}%`, 9);
    for (const h of HORIZONS) {
      const r = results.find(x => x.horizonYears === h && x.stopLossPercent === stopPct)!;
      line += padL(
        `${f(r.metrics.cagrPct, 1)} / ${f(r.metrics.mddPct, 1)} / ${f(r.metrics.calmar, 2)}`,
        26
      );
    }
    console.log(line);
  }

  // 접합 커버리지
  console.log('\n' + '─'.repeat(96));
  console.log('프록시 접합 커버리지 (지평 구간 내 실제상품 데이터 비율)');
  console.log('─'.repeat(96));
  for (const horizon of HORIZONS) {
    const cov = coverageByHorizon[`${horizon}y`];
    console.log(`\n  ▶ ${horizon}년 지평`);
    for (const c of cov) {
      const tag =
        c.realPct >= 99.999
          ? '100% 실제상품'
          : `${f(c.realPct, 0)}% 실제상품 / ${f(100 - c.realPct, 0)}% ${c.proxySymbol}프록시`;
      console.log(
        '    ' + pad(c.symbol, 12) + pad(c.label, 26) + pad(`실제개시 ${c.realFirstDate}`, 22) + tag
      );
    }
  }

  // 레그별 손절 횟수(대표: 10년 지평)
  console.log('\n' + '─'.repeat(96));
  console.log('레그별 손절 발생 횟수 (10년 지평)');
  console.log('─'.repeat(96));
  console.log(
    '  ' +
      pad('종목', 12) +
      pad('구분', 26) +
      STOP_PCTS.map(s => padL(`${(s * 100).toFixed(0)}%`, 8)).join('')
  );
  const tenYear = results.filter(r => r.horizonYears === 10);
  for (let k = 0; k < legs.length; k++) {
    let line = '  ' + pad(legs[k].symbol, 12) + pad(legs[k].label, 26);
    for (const stopPct of STOP_PCTS) {
      const r = tenYear.find(x => x.stopLossPercent === stopPct)!;
      line += padL(String(r.legStats[k].stopOutCount), 8);
    }
    console.log(line);
  }

  // 무결성(레버리지 누수) 점검 출력 — 모든 리밸런싱 시점의 투자비중 합.
  console.log('\n' + '─'.repeat(96));
  console.log('무결성 점검 — 리밸런싱 시점 투자비중 합 (목표 96%, 나머지 현금)');
  console.log('─'.repeat(96));
  for (const r of results) {
    console.log(
      '  ' +
        pad(`${r.horizonYears}년/손절${(r.stopLossPercent * 100).toFixed(0)}%`, 16) +
        pad(`리밸런싱 ${r.rebalanceCount}회`, 16) +
        `비중합 min ${(r.weightSumMin * 100).toFixed(6)}% / max ${(r.weightSumMax * 100).toFixed(6)}%` +
        `  (레그당 ${(r.targetWeightPerLeg * 100).toFixed(4)}% × ${legs.length})`
    );
  }

  // ── JSON 리포트 ──────────────────────────────────────────────
  const report = {
    generatedAt: new Date().toISOString(),
    endDate: END,
    source: 'yahoo-v8',
    config: {
      riskPercentPerTrade: RISK_PER_TRADE,
      investedBudget: INVESTED_BUDGET,
      initialEquity: INITIAL_EQUITY,
      horizons: HORIZONS,
      stopLossPercents: STOP_PCTS,
      rebalance: 'semi-annual(Jan/Jul first trading day)',
      spliceMap: SPLICE_MAP,
      legCount: legs.length,
    },
    legs: legs.map(l => ({
      symbol: l.symbol,
      label: l.label,
      realFirstDate: l.realFirstDate,
      proxySymbol: l.proxySymbol,
      currency: legDefs.find(x => x.entry.symbol === l.symbol)!.currency,
    })),
    spliceCoverageByHorizon: coverageByHorizon,
    results,
    caveats: [
      '385560.KS(한국 국고채30년)의 프록시는 TLT(미국채30년)로, 듀레이션·통화·금리사이클이 달라 불완전 대체다. 한국 30년물 장기 지수 대체품을 찾지 못해 그대로 사용했다.',
      '프록시 합성 구간은 프록시의 USD 수익률을 그대로 사용하므로 원/달러 환율 변동 효과가 반영되지 않는다(레벨 불일치를 피하기 위한 의도적 선택).',
      '372330.KS(항셍테크)의 프록시 KWEB은 중국 인터넷 ETF로 구성이 유사할 뿐 동일 지수가 아니다.',
      '손절 체결은 종가 기준이며 슬리피지·거래비용·세금은 반영하지 않았다.',
      '모든 레그의 손절폭이 동일하므로 비례 축소 후 목표비중은 손절폭과 무관하게 균등(96%/레그수)이 된다. 손절폭 차이는 오직 손절 발생 빈도로만 결과에 영향을 준다.',
    ],
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n  머신리더블 리포트 저장: ${REPORT_PATH}`);
  console.log('='.repeat(96));
}

main().catch(e => {
  console.error('백테스트 중 예외:', e);
  process.exit(1);
});
