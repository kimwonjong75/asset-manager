// scripts/backtest/guruSignals.ts
// 구루 시그널 백테스트 — 운영 코드가 실제 과거 사례를 재현하는지 검증
//
// 시나리오:
//   A) SLV (은 ETF) 2026-01 — 1월 26~29일 구간에 climax-top 점등, 1/30 이후 와인스타인 매도 룰 연쇄
//   B) ^GSPC (S&P500) 2007-11 — 시장 디스트리뷰션 5+회 점등
//
// 운영 코드(buildEnrichedIndicator + matchesRule + countDistributionDays)를 직접 호출하므로
// 알고리즘 drift 없음. 백테스트가 통과하면 운영 룰도 동일하게 작동한다.
//
// 실행:
//   npm run backtest:guru

import { CLOUD_RUN_BASE_URL } from '../../constants/api';
import { buildEnrichedIndicator, CLIMAX_C_VOL_SURGE_RATIO } from '../../utils/buildEnrichedIndicator';
import { matchesRule } from '../../utils/alertChecker';
import { countDistributionDays, buildDistributionMeta } from '../../utils/marketDistribution';
import { DEFAULT_ALERT_RULES } from '../../constants/alertRules';
import {
  classifyDistributionTierPure,
  type PersistedTierState,
} from '../../utils/distributionTierState';
import type { EnrichedAsset } from '../../types/ui';
import type { Asset } from '../../types';
import { Currency } from '../../types';

// ─────────────────────────────────────────────────────────────────────────────
// fetch helper (노드 환경 — fetch는 Node 18+ 내장)
// ─────────────────────────────────────────────────────────────────────────────

interface HistoryEntry {
  data?: Record<string, number>;
  open?: Record<string, number>;
  high?: Record<string, number>;
  low?: Record<string, number>;
  volume?: Record<string, number>;
  error?: string;
}

async function fetchHistory(
  ticker: string,
  startDate: string,
  endDate: string
): Promise<HistoryEntry | null> {
  const res = await fetch(`${CLOUD_RUN_BASE_URL}/history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers: [ticker], start_date: startDate, end_date: endDate }),
  });
  if (!res.ok) {
    console.error(`HTTP ${res.status} for ${ticker}`);
    return null;
  }
  const text = await res.text();
  const json = JSON.parse(text.replace(/\bNaN\b/g, 'null'));
  return json[ticker] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 시계열 유틸
// ─────────────────────────────────────────────────────────────────────────────

function alignSeries(sortedDates: string[], series?: Record<string, number>): (number | null)[] {
  if (!series) return sortedDates.map(() => null);
  return sortedDates.map(d => {
    const v = series[d];
    return typeof v === 'number' && isFinite(v) ? v : null;
  });
}

function sliceUntil<T>(sortedDates: string[], series: T[], cutoff: string): T[] {
  // sortedDates와 series가 같은 길이/순서. cutoff 이하 인덱스까지 슬라이스.
  const cutoffIdx = sortedDates.findIndex(d => d > cutoff);
  return cutoffIdx === -1 ? series.slice() : series.slice(0, cutoffIdx);
}

function findCutoffEndIdx(sortedDates: string[], cutoff: string): number {
  const i = sortedDates.findIndex(d => d > cutoff);
  return i === -1 ? sortedDates.length - 1 : i - 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// EnrichedAsset mock — smartFilterLogic이 참조하는 필드만 채움
// ─────────────────────────────────────────────────────────────────────────────

function mockEnrichedAsset(opts: {
  ticker: string;
  closeToday: number;
  closeYesterday: number | null;
}): EnrichedAsset {
  const change = opts.closeYesterday != null && opts.closeYesterday > 0
    ? ((opts.closeToday - opts.closeYesterday) / opts.closeYesterday) * 100
    : 0;

  // smartFilterLogic이 참조하는 필드만 의미있게 채움. 나머지는 0/undefined.
  const base = {
    id: opts.ticker,
    ticker: opts.ticker,
    name: opts.ticker,
    categoryId: 1,
    exchange: 'TEST',
    quantity: 1,
    purchasePrice: opts.closeToday,
    purchaseCurrency: Currency.USD,
    purchaseDate: '2020-01-01',
    purchaseExchangeRate: 1,
    highestPrice: opts.closeToday,
    priceOriginal: opts.closeToday,
    priceSettlement: opts.closeToday,
    settlementCurrency: Currency.USD,
    changeRate: change,
  } as unknown as Asset;

  // smartFilterLogic이 참조하는 metric 필드만 의미있게 채우고 나머지는 0으로 stub.
  // 백테스트 전용 mock — 타입 시스템 우회를 위해 unknown 경유 캐스트
  const metrics = {
    purchasePrice: opts.closeToday,
    currentPrice: opts.closeToday,
    currentPriceKRW: opts.closeToday,
    purchasePriceKRW: opts.closeToday,
    purchaseValue: opts.closeToday,
    currentValue: opts.closeToday,
    purchaseValueKRW: opts.closeToday,
    currentValueKRW: opts.closeToday,
    returnPercentage: 0,
    allocation: 0,
    dropFromHigh: 0,
    profitLoss: 0,
    profitLossKRW: 0,
    diffFromHigh: 0,
    yesterdayChange: change,
    diffFromYesterday: opts.closeToday - (opts.closeYesterday ?? opts.closeToday),
  };

  return { ...base, metrics } as unknown as EnrichedAsset;
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 실행 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

interface DailyResult {
  date: string;
  close: number;
  changePct: number;
  triggeredRules: string[];
}

function runScenarioOnTicker(opts: {
  ticker: string;
  history: HistoryEntry;
  cutoffStart: string;
  cutoffEnd: string;
  rulesToCheck: string[];
}): DailyResult[] {
  const { ticker, history, cutoffStart, cutoffEnd, rulesToCheck } = opts;
  if (!history.data) return [];

  const allDates = Object.keys(history.data).sort();
  const allCloses = allDates.map(d => history.data![d]);
  const allOpens = alignSeries(allDates, history.open);
  const allHighs = alignSeries(allDates, history.high);
  const allLows = alignSeries(allDates, history.low);
  const allVolumes = alignSeries(allDates, history.volume);

  // cutoff 윈도우의 각 거래일에 대해 enrichment + 룰 매칭
  const cutoffDates = allDates.filter(d => d >= cutoffStart && d <= cutoffEnd);
  const results: DailyResult[] = [];

  const rules = DEFAULT_ALERT_RULES.filter(r => rulesToCheck.includes(r.id));

  for (const cutoff of cutoffDates) {
    const endIdx = findCutoffEndIdx(allDates, cutoff);
    if (endIdx < 60) continue; // 워밍업 부족

    const dates = allDates.slice(0, endIdx + 1);
    const closes = allCloses.slice(0, endIdx + 1);
    const opens = allOpens.slice(0, endIdx + 1);
    const highs = allHighs.slice(0, endIdx + 1);
    const lows = allLows.slice(0, endIdx + 1);
    const volumes = allVolumes.slice(0, endIdx + 1);

    const enriched = buildEnrichedIndicator({ sortedDates: dates, closes, opens, highs, lows, volumes });
    const closeToday = closes[closes.length - 1];
    const closeYesterday = closes.length >= 2 ? closes[closes.length - 2] : null;
    const asset = mockEnrichedAsset({ ticker, closeToday, closeYesterday });

    const triggered: string[] = [];
    for (const rule of rules) {
      if (matchesRule(asset, rule, enriched)) triggered.push(rule.id);
    }

    const changePct = closeYesterday != null && closeYesterday > 0
      ? ((closeToday - closeYesterday) / closeYesterday) * 100
      : 0;

    results.push({ date: cutoff, close: closeToday, changePct, triggeredRules: triggered });
  }

  return results;
}

function printResultTable(title: string, results: DailyResult[], rulesToCheck: string[]) {
  console.log(`\n━━━ ${title} ━━━`);
  if (results.length === 0) {
    console.log('  (데이터 없음)');
    return;
  }
  const header = ['date', 'close', 'chg%', ...rulesToCheck.map(id => id.padEnd(20))];
  console.log(header.join(' | '));
  console.log('-'.repeat(header.join(' | ').length));
  for (const r of results) {
    const cells = [
      r.date,
      r.close.toFixed(2).padStart(8),
      (r.changePct >= 0 ? '+' : '') + r.changePct.toFixed(2) + '%',
      ...rulesToCheck.map(id => (r.triggeredRules.includes(id) ? '✓'.padEnd(20) : ' '.padEnd(20))),
    ];
    console.log(cells.join(' | '));
  }
  const hitCounts = rulesToCheck.map(id => ({
    id,
    count: results.filter(r => r.triggeredRules.includes(id)).length,
  }));
  console.log('\n  히트 합계:');
  for (const { id, count } of hitCounts) {
    console.log(`    ${id.padEnd(25)} ${count}회`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 A: SLV 2026-01 (은 폭락 케이스)
// ─────────────────────────────────────────────────────────────────────────────

async function scenarioA_SLV() {
  console.log('\n========================================================');
  console.log('  시나리오 A: SLV 2026-01 (구루 매도 시그널 재현)');
  console.log('========================================================');
  console.log('  기대: 1/26~1/29 climax-top 점등, 1/30 이후 와인스타인 매도 룰 연쇄');

  // SLV는 ETF — 자체 거래량 있음, 프록시 불필요
  // MA200/52주 워밍업 위해 fetch는 1.5년 이상 (2024-06부터)
  const ticker = 'SLV';
  const history = await fetchHistory(ticker, '2024-06-01', '2026-02-15');
  if (!history?.data) {
    console.log(`  ⚠ ${ticker} 데이터 fetch 실패 — 스킵`);
    return;
  }
  const dates = Object.keys(history.data).sort();
  console.log(`  fetched: ${dates.length}일치 (${dates[0]} ~ ${dates[dates.length - 1]})`);

  // 1/24 ~ 2/06 cutoff (폭락 전후 충분히)
  const results = runScenarioOnTicker({
    ticker,
    history,
    cutoffStart: '2026-01-24',
    cutoffEnd: '2026-02-06',
    rulesToCheck: ['climax-top', 'distribution-high', 'weinstein-150-break', 'ma120-break', 'swing-low-break'],
  });
  printResultTable('SLV daily — sell rule triggers', results,
    ['climax-top', 'distribution-high', 'weinstein-150-break', 'ma120-break', 'swing-low-break']);
}

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 B: ^GSPC 2007-11 (시장 디스트리뷰션 — 오닐 원의도)
// ─────────────────────────────────────────────────────────────────────────────

async function scenarioB_GSPC2007() {
  console.log('\n========================================================');
  console.log('  시나리오 B: ^GSPC 2007-11 (시장 지수 디스트리뷰션)');
  console.log('========================================================');
  console.log('  기대: 11월 중순 디스트리뷰션 5+회 누적 — 시장 탈출 신호');

  const ticker = '^GSPC';
  const history = await fetchHistory(ticker, '2007-06-01', '2007-12-31');
  if (!history?.data) {
    console.log(`  ⚠ ${ticker} 데이터 fetch 실패 — 스킵`);
    return;
  }
  const dates = Object.keys(history.data).sort();
  console.log(`  fetched: ${dates.length}일치 (${dates[0]} ~ ${dates[dates.length - 1]})`);

  const allCloses = dates.map(d => history.data![d]);
  const allOpens = alignSeries(dates, history.open);
  const allHighs = alignSeries(dates, history.high);
  const allLows = alignSeries(dates, history.low);
  const allVolumes = alignSeries(dates, history.volume);

  // 11월 매 거래일마다 직전 13일 디스트리뷰션 카운트
  const novDates = dates.filter(d => d >= '2007-11-01' && d <= '2007-11-30');
  console.log(`\n━━━ ^GSPC 2007-11 daily — 디스트리뷰션 카운트 (13일 윈도우) ━━━`);
  console.log('date       | close   | chg%   | dist | severity');
  console.log('-'.repeat(56));
  let maxCount = 0;
  for (const cutoff of novDates) {
    const endIdx = findCutoffEndIdx(dates, cutoff);
    if (endIdx < 50) continue;

    const closes = allCloses.slice(0, endIdx + 1);
    const opens = allOpens.slice(0, endIdx + 1);
    const highs = allHighs.slice(0, endIdx + 1);
    const lows = allLows.slice(0, endIdx + 1);
    const volumes = allVolumes.slice(0, endIdx + 1);

    const meta = buildDistributionMeta(opens, highs, lows, closes, volumes, {
      metaLength: 30,
      volumeAvgPeriod: 50,
    });
    const count = countDistributionDays(meta, 13, 1.5);
    const close = closes[closes.length - 1];
    const prev = closes.length >= 2 ? closes[closes.length - 2] : null;
    const chg = prev != null && prev > 0 ? ((close - prev) / prev) * 100 : 0;
    const severity =
      count >= 5 ? '🔴 exit' :
      count === 4 ? '🟠 warning' :
      count === 3 ? '🟡 attention' : 'safe';
    console.log(
      `${cutoff} | ${close.toFixed(2).padStart(7)} | ${(chg >= 0 ? '+' : '') + chg.toFixed(2).padStart(5)}% | ${String(count).padStart(4)} | ${severity}`
    );
    if (count > maxCount) maxCount = count;
  }
  console.log(`\n  최대 디스트리뷰션: ${maxCount}회 (5+ = 시장 탈출 신호)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// P4.5 진단: 진단/출력 전용 — 임계값/게이팅/알고리즘 로직 수정 없음
// ─────────────────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return '  --  ';
  if (typeof v !== 'number' || !isFinite(v)) return '  --  ';
  return v.toFixed(digits);
}

function fmtBool(v: boolean | null | undefined): string {
  if (v === true) return 'T';
  if (v === false) return 'F';
  return '-';
}

/**
 * 진단 A: SLV 2026-01-20 ~ 2026-02-05 — climax/distribution/swing/MA-break 내부 조건
 * 진단 전용 — 룰 매칭 로직을 흉내내되 게이팅/임계값은 DEFAULT 규칙 그대로 사용
 */
async function diagnoseSLV2026Jan() {
  console.log('\n========================================================');
  console.log('  P4.5 진단 A: SLV 2026-01-20 ~ 2026-02-05 내부 조건 추적');
  console.log('========================================================');

  const ticker = 'SLV';
  const history = await fetchHistory(ticker, '2024-06-01', '2026-02-15');
  if (!history?.data) {
    console.log(`  ⚠ ${ticker} fetch 실패`);
    return;
  }
  const dates = Object.keys(history.data).sort();
  const closes = dates.map(d => history.data![d]);
  const opens = alignSeries(dates, history.open);
  const highs = alignSeries(dates, history.high);
  const lows = alignSeries(dates, history.low);
  const volumes = alignSeries(dates, history.volume);

  // 룰 기본값 그대로 사용 (사용자 토글/임계 변경 없음)
  const climaxRule = DEFAULT_ALERT_RULES.find(r => r.id === 'climax-top')!;
  const distRule = DEFAULT_ALERT_RULES.find(r => r.id === 'distribution-high')!;
  const cfgC = climaxRule.filterConfig;
  const cfgD = distRule.filterConfig;
  const slopeMul = cfgC.climaxSlopeMultiplier ?? 3;
  const atrMul = cfgC.climaxAtrMultiple ?? 2.5;
  const flagsRequired = cfgC.climaxFlagsRequired ?? 2;
  const requireBullish = cfgC.climaxRequireBullishCandle ?? true;
  const requireLongUp = cfgC.climaxRequireLongTrendUp ?? true;
  const distWindow = cfgD.distributionWindow ?? 13;
  const distVolRatio = cfgD.distributionVolumeRatio ?? 1.5;
  const distThreshold = cfgD.distributionThreshold ?? 5;

  console.log(`  기본 규칙 임계: climaxFlagsRequired=${flagsRequired}, slopeMul=${slopeMul}, atrMul=${atrMul}, requireBullish=${requireBullish}, requireLongUp=${requireLongUp}`);
  console.log(`  기본 규칙 임계: distWindow=${distWindow}d, volRatio>=${distVolRatio}x, threshold=${distThreshold}일`);

  const targetDates = dates.filter(d => d >= '2026-01-20' && d <= '2026-02-05');

  // ── 표 1: 클라이맥스 진단 — (c) breakdown 포함 ──
  console.log(`\n  ━━━ 표 1: climax-top 내부 조건 — (c) = 52wHi AND (vMax || volRat>=${CLIMAX_C_VOL_SURGE_RATIO}) ━━━`);
  const h1 = ['date', 'close', 'longUp', 'bull', 'slopeR', 'rngATR', 'fA', 'fB', '52wHi', 'vMax', 'volRat', 'fC', 'cnt', 'matched'];
  console.log('  ' + h1.map(s => s.padEnd(7)).join('|'));
  console.log('  ' + '-'.repeat(h1.length * 8));

  for (const cutoff of targetDates) {
    const endIdx = dates.indexOf(cutoff);
    if (endIdx < 60) continue;

    const sd = dates.slice(0, endIdx + 1);
    const c = closes.slice(0, endIdx + 1);
    const o = opens.slice(0, endIdx + 1);
    const h = highs.slice(0, endIdx + 1);
    const l = lows.slice(0, endIdx + 1);
    const v = volumes.slice(0, endIdx + 1);
    const enriched = buildEnrichedIndicator({ sortedDates: sd, closes: c, opens: o, highs: h, lows: l, volumes: v });

    // 게이팅 적용된 플래그 카운트 (smartFilterLogic.CLIMAX_TOP과 동일 로직)
    const flagA = typeof enriched.slopeRatio === 'number' && enriched.slopeRatio >= slopeMul;
    const flagB_raw = typeof enriched.dayRangeOverAtr === 'number' && enriched.dayRangeOverAtr >= atrMul;
    const flagB = flagB_raw && (!requireBullish || enriched.isBullishCandle !== false);
    const todayMeta = enriched.distributionDayMeta?.[enriched.distributionDayMeta.length - 1];
    const volRatio = todayMeta?.volRatio ?? null;
    const flagC = enriched.priceIsAt52wHigh && (
      enriched.volumeIsAt52wMax || (typeof volRatio === 'number' && volRatio >= CLIMAX_C_VOL_SURGE_RATIO)
    );
    let flagCount = 0;
    if (flagA) flagCount++;
    if (flagB) flagCount++;
    if (flagC) flagCount++;

    let matched = false;
    if (requireLongUp && enriched.longTrendUp === false) {
      matched = false;
    } else if (flagCount >= flagsRequired) {
      matched = true;
    }

    const row = [
      cutoff,
      fmt(c[c.length - 1], 2),
      fmtBool(enriched.longTrendUp),
      fmtBool(enriched.isBullishCandle),
      fmt(enriched.slopeRatio, 2),
      fmt(enriched.dayRangeOverAtr, 2),
      flagA ? 'T' : 'F',
      flagB ? 'T' : 'F',
      fmtBool(enriched.priceIsAt52wHigh),
      fmtBool(enriched.volumeIsAt52wMax),
      fmt(volRatio, 2),
      flagC ? 'T' : 'F',
      String(flagCount),
      matched ? '✓' : '',
    ];
    console.log('  ' + row.map(s => String(s).padEnd(7)).join('|'));
  }

  // ── 표 2: 디스트리뷰션 일별 (당일 메타 조건) ──
  console.log('\n  ━━━ 표 2: distribution-high 당일 메타 조건 ━━━');
  const h2 = ['date', 'close', 'chg%', 'isBear', 'lowHalf', 'chgRatio', 'priceOK', 'volRatio', 'volOK', 'counted'];
  console.log('  ' + h2.map(s => s.padEnd(10)).join('| '));
  console.log('  ' + '-'.repeat(h2.length * 12));

  for (const cutoff of targetDates) {
    const endIdx = dates.indexOf(cutoff);
    if (endIdx < 60) continue;
    const sd = dates.slice(0, endIdx + 1);
    const c = closes.slice(0, endIdx + 1);
    const o = opens.slice(0, endIdx + 1);
    const h = highs.slice(0, endIdx + 1);
    const l = lows.slice(0, endIdx + 1);
    const v = volumes.slice(0, endIdx + 1);
    const enriched = buildEnrichedIndicator({ sortedDates: sd, closes: c, opens: o, highs: h, lows: l, volumes: v });

    const meta = enriched.distributionDayMeta;
    const today = meta[meta.length - 1] ?? null;
    const isBear = today?.isBearish ?? null;
    const lowHalf = today?.isLowerHalfClose ?? null;
    const chgRatio = today?.changeRatio ?? 0;
    const volRatio = today?.volRatio ?? null;
    const priceCondPassed = isBear === true || lowHalf === true || chgRatio < 0.002;
    const volCondPassed = typeof volRatio === 'number' && volRatio >= distVolRatio;
    const counted = priceCondPassed && volCondPassed;

    const close = c[c.length - 1];
    const prev = c.length >= 2 ? c[c.length - 2] : null;
    const chgPct = prev != null && prev > 0 ? ((close - prev) / prev) * 100 : 0;

    const row = [
      cutoff,
      fmt(close, 2),
      (chgPct >= 0 ? '+' : '') + chgPct.toFixed(2) + '%',
      fmtBool(isBear),
      fmtBool(lowHalf),
      (chgRatio >= 0 ? '+' : '') + (chgRatio * 100).toFixed(2) + '%',
      priceCondPassed ? '✓' : ' ',
      fmt(volRatio, 2),
      volCondPassed ? '✓' : ' ',
      counted ? '✓' : ' ',
    ];
    console.log('  ' + row.map(s => String(s).padEnd(10)).join('| '));
  }

  // ── 표 3: 디스트리뷰션 윈도우 카운트 + swing low + MA-break ──
  console.log('\n  ━━━ 표 3: distribution 윈도우(13d) / swing-low / MA-break ━━━');
  const h3 = ['date', 'close', 'distCnt', 'distHi?', 'swLow', 'swBrk?', 'MA120', 'MA150', 'brkMA120d', 'brkMA150d'];
  console.log('  ' + h3.map(s => s.padEnd(10)).join('| '));
  console.log('  ' + '-'.repeat(h3.length * 12));

  for (const cutoff of targetDates) {
    const endIdx = dates.indexOf(cutoff);
    if (endIdx < 60) continue;
    const sd = dates.slice(0, endIdx + 1);
    const c = closes.slice(0, endIdx + 1);
    const o = opens.slice(0, endIdx + 1);
    const h = highs.slice(0, endIdx + 1);
    const l = lows.slice(0, endIdx + 1);
    const v = volumes.slice(0, endIdx + 1);
    const enriched = buildEnrichedIndicator({ sortedDates: sd, closes: c, opens: o, highs: h, lows: l, volumes: v });

    const close = c[c.length - 1];
    const distCount = countDistributionDays(enriched.distributionDayMeta, distWindow, distVolRatio);
    const distHighMatched = distCount >= distThreshold;
    const swLow = enriched.recentSwingLow;
    const swBrk = typeof swLow === 'number' && swLow > 0 && close < swLow;
    const ma120 = enriched.ma[120];
    const ma150 = enriched.ma[150];
    const brkMA120d = enriched.priceBreakBelowMaDays[120];
    const brkMA150d = enriched.priceBreakBelowMaDays[150];

    const row = [
      cutoff,
      fmt(close, 2),
      String(distCount),
      distHighMatched ? '✓' : ' ',
      fmt(swLow, 2),
      swBrk ? '✓' : ' ',
      fmt(ma120, 2),
      fmt(ma150, 2),
      brkMA120d === null ? '-' : String(brkMA120d),
      brkMA150d === null ? '-' : String(brkMA150d),
    ];
    console.log('  ' + row.map(s => String(s).padEnd(10)).join('| '));
  }
}

/**
 * 진단 B: ^GSPC 2007-09 ~ 2007-11 거래량 결측/0/volRatio + 가격조건/거래량조건 진단
 */
async function diagnoseGSPC2007Volume() {
  console.log('\n========================================================');
  console.log('  P4.5 진단 B: ^GSPC 2007-09 ~ 2007-11 거래량 데이터 추적');
  console.log('========================================================');

  const ticker = '^GSPC';
  const history = await fetchHistory(ticker, '2007-04-01', '2007-12-31');
  if (!history?.data) {
    console.log(`  ⚠ ${ticker} fetch 실패`);
    return;
  }
  const dates = Object.keys(history.data).sort();
  const closes = dates.map(d => history.data![d]);
  const opens = alignSeries(dates, history.open);
  const highs = alignSeries(dates, history.high);
  const lows = alignSeries(dates, history.low);
  const volumes = alignSeries(dates, history.volume);

  const targetDates = dates.filter(d => d >= '2007-09-01' && d <= '2007-11-30');

  const distRule = DEFAULT_ALERT_RULES.find(r => r.id === 'distribution-high')!;
  const distVolRatio = distRule.filterConfig.distributionVolumeRatio ?? 1.5;

  console.log(`  fetched: ${dates.length}일치 / 타겟: ${targetDates.length}일 (${targetDates[0]} ~ ${targetDates[targetDates.length - 1]})`);
  console.log(`  기본 규칙: volRatio>=${distVolRatio}x`);

  const h = ['date', 'close', 'volume', 'missing', 'zero', 'volRatio', 'priceOK', 'volOK', 'counted'];
  console.log('\n  ' + h.map(s => s.padEnd(12)).join('| '));
  console.log('  ' + '-'.repeat(h.length * 14));

  let missingCount = 0;
  let zeroCount = 0;
  let countedCount = 0;
  let priceOkCount = 0;
  let volOkCount = 0;

  for (const cutoff of targetDates) {
    const endIdx = dates.indexOf(cutoff);
    if (endIdx < 50) continue;

    const sd = dates.slice(0, endIdx + 1);
    const c = closes.slice(0, endIdx + 1);
    const o = opens.slice(0, endIdx + 1);
    const hi = highs.slice(0, endIdx + 1);
    const lo = lows.slice(0, endIdx + 1);
    const vo = volumes.slice(0, endIdx + 1);
    // 한 줄 메타만 필요 → metaLength=1
    const meta = buildDistributionMeta(o, hi, lo, c, vo, { metaLength: 1, volumeAvgPeriod: 50 });
    const today = meta[meta.length - 1] ?? null;

    const rawVolume = history.volume?.[cutoff];
    const volumeIsMissing = rawVolume === undefined || rawVolume === null;
    const volumeIsZero = typeof rawVolume === 'number' && rawVolume === 0;

    const isBear = today?.isBearish ?? null;
    const lowHalf = today?.isLowerHalfClose ?? null;
    const chgRatio = today?.changeRatio ?? 0;
    const volRatio = today?.volRatio ?? null;
    const priceCondPassed = isBear === true || lowHalf === true || chgRatio < 0.002;
    const volCondPassed = typeof volRatio === 'number' && volRatio >= distVolRatio;
    const counted = priceCondPassed && volCondPassed;

    if (volumeIsMissing) missingCount++;
    if (volumeIsZero) zeroCount++;
    if (priceCondPassed) priceOkCount++;
    if (volCondPassed) volOkCount++;
    if (counted) countedCount++;

    const row = [
      cutoff,
      fmt(c[c.length - 1], 2),
      volumeIsMissing ? '   --   ' : (rawVolume as number).toLocaleString(),
      volumeIsMissing ? '✓' : ' ',
      volumeIsZero ? '✓' : ' ',
      fmt(volRatio, 2),
      priceCondPassed ? '✓' : ' ',
      volCondPassed ? '✓' : ' ',
      counted ? '✓' : ' ',
    ];
    console.log('  ' + row.map(s => String(s).padEnd(12)).join('| '));
  }

  console.log(`\n  합계: missing=${missingCount}일, zero=${zeroCount}일, priceCondPassed=${priceOkCount}일, volCondPassed=${volOkCount}일, counted=${countedCount}일`);
}

/**
 * 진단 C: 오버피팅 점검 — 평범한 추세/박스권/약세 종목에서 climax-top이 과도하게 안 점등되는지
 *
 * 종목 구성:
 *   SPY  — 광범위 ETF (S&P500), 우상향 추세
 *   AAPL — 대형 강세 주식
 *   KO   — 방어주, 평탄/박스권 경향
 *   VZ   — 통신주, 약세 경향
 *
 * 기준: 최근 6개월(약 125거래일) 중 climax-top 점등 ≤ 2회면 정상, 3~4회 marginal, 5+회 과다
 */
async function diagnoseClimaxOverfitting() {
  console.log('\n========================================================');
  console.log('  P4.5 진단 C: 오버피팅 점검 — 평시 종목에서 climax-top 점등 빈도');
  console.log('========================================================');

  const climaxRule = DEFAULT_ALERT_RULES.find(r => r.id === 'climax-top')!;
  const cfgC = climaxRule.filterConfig;
  const slopeMul = cfgC.climaxSlopeMultiplier ?? 2.5;
  const atrMul = cfgC.climaxAtrMultiple ?? 2.5;
  const flagsRequired = cfgC.climaxFlagsRequired ?? 2;
  const requireBullish = cfgC.climaxRequireBullishCandle ?? true;
  const requireLongUp = cfgC.climaxRequireLongTrendUp ?? true;
  console.log(`  현재 임계: slopeMul=${slopeMul}, atrMul=${atrMul}, flagsRequired=${flagsRequired}, bullishGate=${requireBullish}, longUpGate=${requireLongUp}, volSurgeRatio=${CLIMAX_C_VOL_SURGE_RATIO}`);

  const tickers = [
    { ticker: 'SPY', label: '광범위 ETF (정상)' },
    { ticker: 'AAPL', label: '대형 강세주' },
    { ticker: 'KO', label: '방어주 (평탄)' },
    { ticker: 'VZ', label: '통신주 (약세)' },
  ];

  // 최근 6개월: 2025-12-01 ~ 2026-05-31 (오늘 2026-06-03 기준)
  const cutoffStart = '2025-12-01';
  const cutoffEnd = '2026-05-31';
  // 워밍업 1.5년 → fetch는 2024-06-01부터
  const fetchStart = '2024-06-01';
  const fetchEnd = '2026-06-03';

  console.log(`  점검 구간: ${cutoffStart} ~ ${cutoffEnd}\n`);

  const results: { ticker: string; label: string; totalDays: number; hits: number; hitDates: string[]; rate: number }[] = [];

  for (const { ticker, label } of tickers) {
    const history = await fetchHistory(ticker, fetchStart, fetchEnd);
    if (!history?.data) {
      console.log(`  ⚠ ${ticker} fetch 실패`);
      continue;
    }
    const dates = Object.keys(history.data).sort();
    const closes = dates.map(d => history.data![d]);
    const opens = alignSeries(dates, history.open);
    const highs = alignSeries(dates, history.high);
    const lows = alignSeries(dates, history.low);
    const volumes = alignSeries(dates, history.volume);

    const cutoffDates = dates.filter(d => d >= cutoffStart && d <= cutoffEnd);
    let hits = 0;
    const hitDates: string[] = [];

    for (const cutoff of cutoffDates) {
      const endIdx = dates.indexOf(cutoff);
      if (endIdx < 60) continue;
      const sd = dates.slice(0, endIdx + 1);
      const c = closes.slice(0, endIdx + 1);
      const o = opens.slice(0, endIdx + 1);
      const hi = highs.slice(0, endIdx + 1);
      const lo = lows.slice(0, endIdx + 1);
      const v = volumes.slice(0, endIdx + 1);
      const enriched = buildEnrichedIndicator({ sortedDates: sd, closes: c, opens: o, highs: hi, lows: lo, volumes: v });

      if (requireLongUp && enriched.longTrendUp === false) continue;
      let cnt = 0;
      if (typeof enriched.slopeRatio === 'number' && enriched.slopeRatio >= slopeMul) cnt++;
      if (typeof enriched.dayRangeOverAtr === 'number' && enriched.dayRangeOverAtr >= atrMul) {
        if (!requireBullish || enriched.isBullishCandle !== false) cnt++;
      }
      if (enriched.priceIsAt52wHigh) {
        const todayMeta = enriched.distributionDayMeta?.[enriched.distributionDayMeta.length - 1];
        const volRatio = todayMeta?.volRatio ?? null;
        if (enriched.volumeIsAt52wMax || (typeof volRatio === 'number' && volRatio >= CLIMAX_C_VOL_SURGE_RATIO)) cnt++;
      }
      if (cnt >= flagsRequired) {
        hits++;
        hitDates.push(cutoff);
      }
    }

    const rate = cutoffDates.length > 0 ? (hits / cutoffDates.length) * 100 : 0;
    results.push({ ticker, label, totalDays: cutoffDates.length, hits, hitDates, rate });
  }

  // 표 출력
  console.log('  ━━━ 오버피팅 점검 결과 ━━━');
  console.log('  ticker | label                | days | hits | rate    | judgment');
  console.log('  ' + '-'.repeat(76));
  for (const r of results) {
    const judgment =
      r.hits === 0 ? '✓ 정상 (0회)' :
      r.hits <= 2 ? '✓ 정상' :
      r.hits <= 4 ? '⚠ marginal' :
      '✗ 과다 (5+)';
    console.log(
      `  ${r.ticker.padEnd(6)} | ${r.label.padEnd(20)} | ${String(r.totalDays).padStart(4)} | ${String(r.hits).padStart(4)} | ${r.rate.toFixed(1).padStart(5)}% | ${judgment}`
    );
  }
  console.log();
  for (const r of results) {
    if (r.hits > 0) {
      console.log(`  ${r.ticker} 점등일: ${r.hitDates.join(', ')}`);
    }
  }
}

/**
 * 진단 D (P4.5 D1): SLV 2026-01-20 ~ 2026-02-05 일자별 distribution tier 분류 시뮬레이션
 * 가상 state(빈 시작)로 일자별로 classifyDistributionTierPure 호출 →
 * 신규/지속 이벤트가 어떻게 나타나는지 검증
 */
async function diagnoseSLVDistTier() {
  console.log('\n========================================================');
  console.log('  P4.5 진단 D: SLV 2026-01-20 ~ 2026-02-05 distribution tier 분류');
  console.log('========================================================');

  const ticker = 'SLV';
  const history = await fetchHistory(ticker, '2024-06-01', '2026-02-15');
  if (!history?.data) {
    console.log(`  ⚠ ${ticker} fetch 실패`);
    return;
  }
  const dates = Object.keys(history.data).sort();
  const closes = dates.map(d => history.data![d]);
  const opens = alignSeries(dates, history.open);
  const highs = alignSeries(dates, history.high);
  const lows = alignSeries(dates, history.low);
  const volumes = alignSeries(dates, history.volume);

  const distRule = DEFAULT_ALERT_RULES.find(r => r.id === 'distribution-high')!;
  const cfg = distRule.filterConfig;
  const distWindow = cfg.distributionWindow ?? 13;
  const distVolRatio = cfg.distributionVolumeRatio ?? 1.5;

  const targetDates = dates.filter(d => d >= '2026-01-20' && d <= '2026-02-05');
  const assetId = 'SLV-test';

  let state: PersistedTierState = {}; // 빈 state로 시작
  console.log('  ━━━ 일자별 단계 분류 (빈 state로 시작) ━━━');
  console.log('  date       | count | currentTier | event       | shown_in_popup     | state.tier | state.firstDate');
  console.log('  ' + '-'.repeat(105));

  for (const cutoff of targetDates) {
    const endIdx = dates.indexOf(cutoff);
    if (endIdx < 60) continue;
    const sd = dates.slice(0, endIdx + 1);
    const c = closes.slice(0, endIdx + 1);
    const o = opens.slice(0, endIdx + 1);
    const h = highs.slice(0, endIdx + 1);
    const l = lows.slice(0, endIdx + 1);
    const v = volumes.slice(0, endIdx + 1);
    const enriched = buildEnrichedIndicator({ sortedDates: sd, closes: c, opens: o, highs: h, lows: l, volumes: v });
    const count = countDistributionDays(enriched.distributionDayMeta, distWindow, distVolRatio);

    const { classification, nextState } = classifyDistributionTierPure(state, assetId, count, cutoff);
    state = nextState;

    const currentTierLabel = count < 3 ? '-' : (count >= 5 ? '5+' : String(count));
    const event = classification
      ? `${classification.status === 'new' ? '✨ NEW' : '   ongoing'}`
      : '(미표시)';
    const shown = classification
      ? `tier ${classification.tier} ${classification.status === 'new' ? '(컬러 뱃지)' : '(회색 뱃지)'}`
      : '(룰 미매칭)';
    const stateTier = state[assetId]?.tier ?? '-';
    const stateDate = state[assetId]?.firstReachedDate ?? '-';

    console.log(
      `  ${cutoff} | ${String(count).padStart(5)} | ${currentTierLabel.padStart(11)} | ${event.padEnd(11)} | ${shown.padEnd(18)} | ${String(stateTier).padStart(10)} | ${stateDate}`
    );
  }

  // 두 번째 시나리오: 1/19에 이미 3회 도달했다고 가정 (firstDate=2026-01-19)
  console.log('\n  ━━━ 동일 일자, 시작 state = {tier:3, firstReached:2026-01-19} (이미 3 도달 후 다음날 시작) ━━━');
  state = { [assetId]: { tier: 3, firstReachedDate: '2026-01-19' } };
  console.log('  date       | count | currentTier | event       | shown_in_popup     | state.tier | state.firstDate');
  console.log('  ' + '-'.repeat(105));

  for (const cutoff of targetDates) {
    const endIdx = dates.indexOf(cutoff);
    if (endIdx < 60) continue;
    const sd = dates.slice(0, endIdx + 1);
    const c = closes.slice(0, endIdx + 1);
    const o = opens.slice(0, endIdx + 1);
    const h = highs.slice(0, endIdx + 1);
    const l = lows.slice(0, endIdx + 1);
    const v = volumes.slice(0, endIdx + 1);
    const enriched = buildEnrichedIndicator({ sortedDates: sd, closes: c, opens: o, highs: h, lows: l, volumes: v });
    const count = countDistributionDays(enriched.distributionDayMeta, distWindow, distVolRatio);

    const { classification, nextState } = classifyDistributionTierPure(state, assetId, count, cutoff);
    state = nextState;

    const currentTierLabel = count < 3 ? '-' : (count >= 5 ? '5+' : String(count));
    const event = classification
      ? `${classification.status === 'new' ? '✨ NEW' : '   ongoing'}`
      : '(미표시)';
    const shown = classification
      ? `tier ${classification.tier} ${classification.status === 'new' ? '(컬러 뱃지)' : '(회색 뱃지)'}`
      : '(룰 미매칭)';
    const stateTier = state[assetId]?.tier ?? '-';
    const stateDate = state[assetId]?.firstReachedDate ?? '-';

    console.log(
      `  ${cutoff} | ${String(count).padStart(5)} | ${currentTierLabel.padStart(11)} | ${event.padEnd(11)} | ${shown.padEnd(18)} | ${String(stateTier).padStart(10)} | ${stateDate}`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  await scenarioA_SLV();
  await scenarioB_GSPC2007();
  await diagnoseSLV2026Jan();
  await diagnoseGSPC2007Volume();
  await diagnoseClimaxOverfitting();
  await diagnoseSLVDistTier();
  console.log('\n========================================================');
  console.log('  백테스트 완료');
  console.log('========================================================\n');
}

main().catch(err => {
  console.error('백테스트 실패:', err);
  process.exit(1);
});
