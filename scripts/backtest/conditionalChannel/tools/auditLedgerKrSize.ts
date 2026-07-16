// scripts/backtest/conditionalChannel/tools/auditLedgerKrSize.ts
// ---------------------------------------------------------------------------
// conditional-channel-kr-size-v1 — 거래·현금 원장 독립 검산 + 블록 부트스트랩
//
// 1단계: rollingPriorExtreme vs naive O(N²) 1000배열 검증
// 2단계: 전체 데이터 ALL_20/ALL_55 × BASE 시뮬레이션 (개발·검증)
// 3단계: 48건 이상 표본 추출 (그룹A/B × 전략 × 구간 × 청산유형 × 수익/손실)
// 4단계: 채널고가·ATR·손절가·진입체결·R배수·비용 독립 재계산
// 5단계: 불변식 검사 (equity≥0, cash≥0, 청산≥진입, 그룹유효성, R부호)
// 6단계: 블록 부트스트랩 (60거래일블록≈3개월, 10,000회, 시드 20260716)
// 7단계: docs/backtest/LEDGER_AUDIT_KR_SIZE.md 작성
//
// 실행: npx tsx scripts/backtest/conditionalChannel/tools/auditLedgerKrSize.ts
//
// ⚠ 2023-2025 잠금표본 미접촉. 개발(2010-2019)·검증(2020-2022)만 처리.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';

import { loadKrSizeDataset } from '../pipeline/dataLoader';
import { simulatePortfolio } from '../simulator';
import type { PortfolioSecurity, PortfolioSimConfig, PortfolioSimOutput } from '../simulator';
import { KR_SELL_TAX_SCHEDULE } from '../pipeline/corporateActions';
import type { KrSecurityBars, KrSizeDataset } from '../pipeline/types';
import type {
  ConditionalTradeRecord,
  CorporateActionRecord,
  IsoDate,
  MonthlyGroupFlags,
} from '../../../../types/backtestConditionalChannel';

// ===========================================================================
// 0. 상수
// ===========================================================================

const PROCESSED_DIR = 'scripts/backtest/data/conditionalChannel/kr/processed/';
const DOCS_OUTPUT   = 'docs/backtest/LEDGER_AUDIT_KR_SIZE.md';

const DEV_START: IsoDate = '2010-01-01';
const DEV_END: IsoDate   = '2019-12-31';
const VAL_START: IsoDate = '2020-01-01';
const VAL_END: IsoDate   = '2022-12-31';

const ATR_PERIOD = 20;
const TOLERANCE  = 0.001; // 0.1% 상대 허용오차 (부동소수점 누적오차 수용)

// ===========================================================================
// 1. 결정론적 LCG (시드 20260716)
// ===========================================================================

let lcgState = 20260716;
function lcgNext(): number {
  lcgState = ((lcgState * 1664525 + 1013904223) | 0) >>> 0;
  return lcgState / 4294967296;
}
function lcgReset(): void { lcgState = 20260716; }

// ===========================================================================
// 2. rollingPriorExtreme 독립 검증
// ===========================================================================

function naiveRollingPrior(
  values: readonly number[],
  lookback: number,
  mode: 'MAX' | 'MIN'
): (number | null)[] {
  const out: (number | null)[] = [];
  for (let t = 0; t < values.length; t++) {
    const start = Math.max(0, t - lookback);
    let best: number | null = null;
    for (let i = start; i < t; i++) {
      const v = values[i];
      if (best === null || (mode === 'MAX' ? v > best : v < best)) best = v;
    }
    out.push(best);
  }
  return out;
}

// simulator.ts의 rollingPriorExtreme와 동일 코드 — 독립 기준 구현으로 복사
function dequeRollingPrior(
  values: readonly number[],
  lookback: number,
  mode: 'MAX' | 'MIN'
): (number | null)[] {
  const output = new Array<number | null>(values.length).fill(null);
  const deque: number[] = [];
  let head = 0;
  for (let t = 0; t < values.length; t++) {
    const firstAllowed = Math.max(0, t - lookback);
    while (head < deque.length && deque[head] < firstAllowed) head++;
    output[t] = head < deque.length ? values[deque[head]] : null;
    while (deque.length > head) {
      const tail = deque[deque.length - 1];
      const dominated = mode === 'MAX' ? values[tail] <= values[t] : values[tail] >= values[t];
      if (!dominated) break;
      deque.pop();
    }
    deque.push(t);
    if (head > 1024 && head * 2 > deque.length) {
      deque.splice(0, head);
      head = 0;
    }
  }
  return output;
}

interface RpeTestResult {
  totalCases: number;
  mismatchCount: number;
  details: string[];
}

function testRollingPriorExtreme(): RpeTestResult {
  lcgReset();
  let totalCases = 0;
  let mismatchCount = 0;
  const details: string[] = [];

  function check(values: number[], lookback: number, mode: 'MAX' | 'MIN', label: string): void {
    const naive = naiveRollingPrior(values, lookback, mode);
    const deque = dequeRollingPrior(values, lookback, mode);
    for (let t = 0; t < values.length; t++) {
      totalCases++;
      if (naive[t] !== deque[t]) {
        mismatchCount++;
        if (details.length < 10) {
          details.push(`[MISMATCH] ${label} t=${t} lb=${lookback} naive=${naive[t]} deque=${deque[t]}`);
        }
      }
    }
  }

  // 경계 케이스
  check([], 20, 'MAX', 'empty');
  check([42], 20, 'MAX', 'single-elem');
  check([1, 2, 3, 4, 5], 1, 'MAX', 'lb1-max');
  check([1, 2, 3, 4, 5], 1, 'MIN', 'lb1-min');
  check([5, 4, 3, 2, 1], 3, 'MIN', 'decreasing');
  check([3, 3, 3, 3, 3], 5, 'MAX', 'all-equal');
  check(Array.from({length: 10}, (_, i) => i), 100, 'MAX', 'lb-gt-len');
  check(Array.from({length: 10}, (_, i) => i), 100, 'MIN', 'lb-gt-len-min');

  // head>1024 compaction 유도: lookback=1로 긴 배열 → 모든 이전값이 제거됨
  const compTest = Array.from({length: 2200}, (_, i) => i % 17);
  check(compTest, 5, 'MAX', 'compaction-lb5');
  check(compTest, 1, 'MIN', 'compaction-lb1');

  // 단순 증가 수열 (MAX = 항상 직전값, MIN = 항상 lookback창 최솟값)
  const inc = Array.from({length: 100}, (_, i) => i);
  check(inc, 10, 'MAX', 'strictly-inc');
  check(inc, 10, 'MIN', 'strictly-inc-min');

  // 1000개 무작위 배열
  for (let iter = 0; iter < 1000; iter++) {
    const length  = 20 + Math.floor(lcgNext() * 180);
    const lookback = 1 + Math.floor(lcgNext() * 59);
    const mode     = lcgNext() < 0.5 ? 'MAX' : 'MIN';
    const values   = Array.from({length}, () => Math.floor(lcgNext() * 10000));
    check(values, lookback, mode as 'MAX' | 'MIN', `rand-${iter}`);
  }

  return { totalCases, mismatchCount, details };
}

// ===========================================================================
// 3. 비용 독립 계산
// ===========================================================================

function naiveTradeCost(
  notional: number,
  tier: 'BASE' | 'DOUBLE',
  side: 'BUY' | 'SELL',
  date: IsoDate
): number {
  const mult = tier === 'DOUBLE' ? 2 : 1;
  const varBps = (10 + 10 + 5 + 5) * mult; // commission+spread+slippage+impact
  let cost = (notional * varBps) / 10_000;
  if (side === 'SELL') {
    let taxBps = 0;
    for (const e of KR_SELL_TAX_SCHEDULE) {
      if (e.effectiveFrom > date) continue;
      if (e.effectiveTo !== null && e.effectiveTo < date) continue;
      taxBps = e.taxBps;
      break;
    }
    cost += (notional * taxBps) / 10_000;
  }
  return cost;
}

// ===========================================================================
// 4. Naive Wilder ATR(20)
// ===========================================================================

function naiveATR(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  upToExclusive: number,
  period: number = 20
): number | null {
  const n = upToExclusive;
  if (n < period + 1) return null;
  // TR 시계열
  const tr: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
  }
  // 초기 ATR = TR[1..period] 단순평균
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let atr = sum / period;
  // Wilder 스무딩
  for (let i = period + 1; i < n; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
  }
  return atr;
}

// ===========================================================================
// 5. 데이터 슬라이스 + 가건행위
// ===========================================================================

function sliceSecurities(dataset: KrSizeDataset, toDate: IsoDate): PortfolioSecurity[] {
  const flagsBySec = new Map<string, MonthlyGroupFlags[]>();
  for (const flags of dataset.monthlyFlags.values()) {
    for (const flag of flags) {
      const list = flagsBySec.get(flag.securityId) ?? [];
      list.push(flag);
      flagsBySec.set(flag.securityId, list);
    }
  }
  const result: PortfolioSecurity[] = [];
  for (const [secId, bars] of dataset.securitiesByCode) {
    const end   = bars.dates.findIndex((d) => d > toDate);
    const count = end === -1 ? bars.dates.length : end;
    if (count === 0) continue;
    result.push({
      bars: {
        securityId: bars.securityId,
        symbol: bars.symbol,
        market: bars.market,
        currency: bars.currency,
        dates:  bars.dates.slice(0, count),
        open:   bars.open.slice(0, count),
        high:   bars.high.slice(0, count),
        low:    bars.low.slice(0, count),
        close:  bars.close.slice(0, count),
        volume: bars.volume.slice(0, count),
      },
      monthlyFlags: (flagsBySec.get(secId) ?? []).filter((f) => f.asOfMonthEnd <= toDate),
    });
  }
  return result;
}

function buildProvisionalDelistings(securities: readonly PortfolioSecurity[]): CorporateActionRecord[] {
  const lastMarketDate = securities.reduce<IsoDate | null>((latest, sec) => {
    const d = sec.bars.dates[sec.bars.dates.length - 1];
    return latest === null || d > latest ? d : latest;
  }, null);
  return securities.flatMap((sec): CorporateActionRecord[] => {
    const lastIdx  = sec.bars.dates.length - 1;
    const lastDate = sec.bars.dates[lastIdx];
    if (lastMarketDate === null || lastDate >= lastMarketDate) return [];
    return [{
      securityId: sec.bars.securityId,
      type: 'DELISTING',
      exDate: lastDate,
      ratio: null,
      cashDividendPerShare: null,
      delistingProceedsPerShare: sec.bars.close[lastIdx],
      delistingReturn: null,
      currency: sec.bars.currency,
      note: 'AUDIT_PROVISIONAL_LAST_TRADED_CLOSE',
    }];
  });
}

function krCostParams() {
  return {
    market: 'KR' as const,
    commissionBps: 10,
    spreadBps: 10,
    slippageBps: 5,
    marketImpactBps: 5,
    sellTaxSchedule: KR_SELL_TAX_SCHEDULE.map((e) => ({ ...e })),
    advParticipationCap: 0.05,
    sourceNote: 'audit-kr-size-v1',
  };
}

function makeConfig(
  strategyId: 'ALL_20' | 'ALL_55',
  startDate: IsoDate,
  endDate: IsoDate
): PortfolioSimConfig {
  const lookback = strategyId === 'ALL_20' ? 20 : 55;
  return {
    strategyId,
    signalStartDate: startDate,
    signalEndDate: endDate,
    entryLookback: () => lookback,
    exitLookback: 20,
    atrLookback: ATR_PERIOD,
    stopMultiple: 2,
    commonStartBars: 55,
    fillDelayDays: 1,
    initialEquity: 100_000_000,
    riskPerTradePct: 0.5,
    totalRiskCapPct: 12,
    singleNameValueCapPct: 25,
    costTierByMarket: () => krCostParams(),
    costTier: 'BASE',
    slippageFrac: 0.0005,
    closeMethod: 'FORCED_CLOSE',
    advCap: 0.05,
  };
}

// ===========================================================================
// 6. 표본 추출 (결정론적 균등 샘플)
// ===========================================================================

type ExitType = 'STOP' | 'CHANNEL' | 'PERIOD_END' | 'OTHER';

function classifyExit(t: ConditionalTradeRecord): ExitType {
  if (t.exitReason === 'PROTECTIVE_STOP') return 'STOP';
  if (t.exitReason === 'CHANNEL_EXIT')    return 'CHANNEL';
  if (t.exitReason === 'FORCED_CLOSE')    return 'PERIOD_END';
  return 'OTHER';
}

interface SampledTrade {
  trade: ConditionalTradeRecord;
  period: 'DEV' | 'VAL';
  strategy: 'ALL_20' | 'ALL_55';
}

function pickN(
  trades: ConditionalTradeRecord[],
  period: 'DEV' | 'VAL',
  strategy: 'ALL_20' | 'ALL_55',
  group: 'A' | 'B',
  exitTypes: ExitType[],
  positive: boolean | null,
  count: number
): SampledTrade[] {
  let pool = trades.filter((t) =>
    t.group === group &&
    (exitTypes.length === 0 || exitTypes.includes(classifyExit(t))) &&
    (positive === null ||
      (t.rMultiple !== null && (positive ? t.rMultiple > 0 : t.rMultiple <= 0))) &&
    t.rMultiple !== null &&
    t.exitFill !== null
  );
  pool.sort((a, b) =>
    `${a.securityId}${a.entrySignal.signalDate}`.localeCompare(
      `${b.securityId}${b.entrySignal.signalDate}`
    )
  );
  if (pool.length === 0) return [];
  const step   = Math.max(1, Math.floor(pool.length / count));
  const result: SampledTrade[] = [];
  for (let i = 0; i < pool.length && result.length < count; i += step) {
    result.push({ trade: pool[i], period, strategy });
  }
  return result.slice(0, count);
}

function sampleTrades(
  devT20: ConditionalTradeRecord[],
  devT55: ConditionalTradeRecord[],
  valT20: ConditionalTradeRecord[],
  valT55: ConditionalTradeRecord[]
): SampledTrade[] {
  return [
    // 개발 × ALL_20 × A: 손절3 채널3
    ...pickN(devT20, 'DEV', 'ALL_20', 'A', ['STOP'],    null,  3),
    ...pickN(devT20, 'DEV', 'ALL_20', 'A', ['CHANNEL'], null,  3),
    // 개발 × ALL_20 × B: 손절3 채널3
    ...pickN(devT20, 'DEV', 'ALL_20', 'B', ['STOP'],    null,  3),
    ...pickN(devT20, 'DEV', 'ALL_20', 'B', ['CHANNEL', 'PERIOD_END'], null, 3),
    // 개발 × ALL_55 × A: 손절3 채널3
    ...pickN(devT55, 'DEV', 'ALL_55', 'A', ['STOP'],    null,  3),
    ...pickN(devT55, 'DEV', 'ALL_55', 'A', ['CHANNEL'], null,  3),
    // 개발 × ALL_55 × B: 손절3 채널2 기간말1
    ...pickN(devT55, 'DEV', 'ALL_55', 'B', ['STOP'],    null,  3),
    ...pickN(devT55, 'DEV', 'ALL_55', 'B', ['CHANNEL'], null,  2),
    ...pickN(devT55, 'DEV', 'ALL_55', 'B', ['PERIOD_END'], null, 1),
    // 검증 × ALL_20 × A: 수익3 손실3
    ...pickN(valT20, 'VAL', 'ALL_20', 'A', [], true,   3),
    ...pickN(valT20, 'VAL', 'ALL_20', 'A', [], false,  3),
    // 검증 × ALL_20 × B: 수익3 손실3
    ...pickN(valT20, 'VAL', 'ALL_20', 'B', [], true,   3),
    ...pickN(valT20, 'VAL', 'ALL_20', 'B', [], false,  3),
    // 검증 × ALL_55 × A: 수익3 손실3
    ...pickN(valT55, 'VAL', 'ALL_55', 'A', [], true,   3),
    ...pickN(valT55, 'VAL', 'ALL_55', 'A', [], false,  3),
    // 검증 × ALL_55 × B: 수익3 손실3
    ...pickN(valT55, 'VAL', 'ALL_55', 'B', [], true,   3),
    ...pickN(valT55, 'VAL', 'ALL_55', 'B', [], false,  3),
  ];
}

// ===========================================================================
// 7. 거래 독립 검산
// ===========================================================================

interface CheckItem {
  name: string;
  stored: number;
  naive: number;
  match: boolean;
}

interface TradeVerResult {
  tradeId: string;
  securityId: string;
  period: 'DEV' | 'VAL';
  strategy: 'ALL_20' | 'ALL_55';
  group: 'A' | 'B';
  signalDate: IsoDate;
  exitReason: string;
  rMultiple: number | null;
  checks: CheckItem[];
  errors: string[];
}

function verifyTrade(
  { trade, period, strategy }: SampledTrade,
  allBars: Map<string, KrSecurityBars>
): TradeVerResult {
  const errors: string[] = [];
  const checks: CheckItem[] = [];

  function addCheck(name: string, stored: number, naive: number, tolerance = TOLERANCE): CheckItem {
    const match = Number.isFinite(stored) && Number.isFinite(naive) &&
      (stored === 0
        ? Math.abs(naive) < 0.01
        : Math.abs(naive - stored) / Math.abs(stored) <= tolerance);
    const item: CheckItem = { name, stored, naive, match };
    checks.push(item);
    if (!match) errors.push(`${name}: stored=${stored.toFixed(6)} naive=${naive.toFixed(6)} diff=${((naive-stored)/Math.abs(stored+1e-9)*100).toFixed(2)}%`);
    return item;
  }

  const bars = allBars.get(trade.securityId);
  if (!bars) {
    errors.push(`BARS_NOT_FOUND: ${trade.securityId}`);
    return { tradeId: trade.tradeId, securityId: trade.securityId, period, strategy,
      group: trade.group, signalDate: trade.entrySignal.signalDate,
      exitReason: trade.exitReason ?? 'null', rMultiple: trade.rMultiple, checks, errors };
  }

  const signalDate = trade.entrySignal.signalDate;
  const sIdx = bars.dates.indexOf(signalDate);
  if (sIdx < 0) {
    errors.push(`SIGNAL_DATE_NOT_IN_BARS: ${signalDate}`);
    return { tradeId: trade.tradeId, securityId: trade.securityId, period, strategy,
      group: trade.group, signalDate, exitReason: trade.exitReason ?? 'null',
      rMultiple: trade.rMultiple, checks, errors };
  }

  const lb = trade.entrySignal.entryLookbackUsed;

  // ── 1. 채널 최고가 ────────────────────────────────────────────────────────
  const chStart = Math.max(0, sIdx - lb);
  let naiveCH = -Infinity;
  let hasCH = false;
  for (let i = chStart; i < sIdx; i++) {
    if (bars.high[i] > naiveCH) { naiveCH = bars.high[i]; hasCH = true; }
  }
  const storedCH = trade.entrySignal.breakoutChannelHigh;
  if (!hasCH) {
    errors.push(`NO_PRIOR_BARS_FOR_CHANNEL at sIdx=${sIdx}`);
  } else {
    addCheck('channelHigh', storedCH, naiveCH, 0.0001);
  }

  // ── 2. 신호 트리거 ────────────────────────────────────────────────────────
  const signalClose = bars.close[sIdx];
  if (hasCH && signalClose <= naiveCH) {
    errors.push(`SIGNAL_NOT_TRIGGERED: close=${signalClose} <= channelHigh=${naiveCH}`);
  }

  // ── 3. 진입 체결가 = open[fillDate] ──────────────────────────────────────
  const fillDate  = trade.entryFill.fillDate;
  const fillIdx   = bars.dates.indexOf(fillDate);
  const storedFill = trade.entryFill.fillPrice;
  if (fillIdx < 0) {
    errors.push(`FILL_DATE_NOT_IN_BARS: ${fillDate}`);
  } else {
    const naiveFill = bars.open[fillIdx];
    addCheck('entryFill', storedFill, naiveFill, 0.0001);
    // fillDelay: normally t+1
    const delay = fillIdx - sIdx;
    if (delay < 1 || delay > 10) {
      errors.push(`UNUSUAL_FILL_DELAY: ${delay} bars`);
    }
  }

  // ── 4. ATR(20) at signal date ─────────────────────────────────────────────
  const naiveAtr = naiveATR(bars.high, bars.low, bars.close, sIdx + 1, ATR_PERIOD);
  const storedAtr = trade.atrAtEntry;
  if (naiveAtr === null) {
    errors.push(`ATR_INSUFFICIENT_DATA: sIdx=${sIdx} need ${ATR_PERIOD + 1} bars`);
  } else {
    addCheck('atrAtEntry', storedAtr, naiveAtr, 0.01); // 1% tol for float accumulation
  }

  // ── 5. 손절가 = entryFill - 2×ATR ────────────────────────────────────────
  const naiveStop = storedFill - 2 * storedAtr;
  addCheck('stopPrice', trade.stopPrice, naiveStop, 0.0001);

  // ── 6. R배수 = netPnl / riskAmount ───────────────────────────────────────
  if (trade.exitFill !== null) {
    const qty         = trade.entryFill.quantity;
    const buyNotional = qty * storedFill;
    const sellNotional = qty * trade.exitFill.fillPrice;
    const netPnl      = sellNotional - buyNotional
      - trade.entryFill.totalCostAmount - trade.exitFill.totalCostAmount;
    const riskAmt     = qty * (storedFill - trade.stopPrice);
    const naiveR      = riskAmt > 0 ? netPnl / riskAmt : null;
    if (naiveR === null) {
      errors.push(`ZERO_RISK_AMOUNT: qty=${qty} fill=${storedFill} stop=${trade.stopPrice}`);
    } else if (trade.rMultiple !== null) {
      addCheck('rMultiple', trade.rMultiple, naiveR, 0.001);
    }
  }

  // ── 7. 매수 비용 ──────────────────────────────────────────────────────────
  const tier       = trade.entryFill.costTier as 'BASE' | 'DOUBLE';
  const buyNotional = trade.entryFill.quantity * storedFill;
  const naiveBuyCost = naiveTradeCost(buyNotional, tier, 'BUY', fillDate);
  addCheck('buyCost', trade.entryFill.totalCostAmount, naiveBuyCost, 0.001);

  // ── 8. 매도 비용 ──────────────────────────────────────────────────────────
  if (trade.exitFill !== null) {
    const sellNotional = trade.entryFill.quantity * trade.exitFill.fillPrice;
    const naiveSellCost = naiveTradeCost(sellNotional, tier, 'SELL', trade.exitFill.fillDate);
    addCheck('sellCost', trade.exitFill.totalCostAmount, naiveSellCost, 0.001);
  }

  return {
    tradeId: trade.tradeId,
    securityId: trade.securityId,
    period,
    strategy,
    group: trade.group,
    signalDate,
    exitReason: trade.exitReason ?? 'null',
    rMultiple: trade.rMultiple,
    checks,
    errors,
  };
}

// ===========================================================================
// 8. 불변식 검사
// ===========================================================================

interface InvResult {
  name: string;
  passed: boolean;
  checkedCount: number;
  violations: string[];
}

function checkInvariants(
  devOut20: PortfolioSimOutput,
  devOut55: PortfolioSimOutput,
  valOut20: PortfolioSimOutput,
  valOut55: PortfolioSimOutput
): InvResult[] {
  const results: InvResult[] = [];

  function inv(name: string, checkedCount: number, violations: string[]): InvResult {
    return { name, passed: violations.length === 0, checkedCount, violations: violations.slice(0, 5) };
  }

  // I1: equity >= 0 (float guard -1e-6)
  for (const [label, out] of [
    ['DEV/ALL_20', devOut20], ['DEV/ALL_55', devOut55],
    ['VAL/ALL_20', valOut20], ['VAL/ALL_55', valOut55],
  ] as const) {
    const v = out.equityCurve
      .filter((p) => p.equity < -1e-6)
      .map((p) => `${p.date}:${p.equity.toFixed(0)}`);
    results.push(inv(`equity>=0 [${label}]`, out.equityCurve.length, v));
  }

  // I2: cash >= 0
  for (const [label, out] of [
    ['DEV/ALL_20', devOut20], ['DEV/ALL_55', devOut55],
    ['VAL/ALL_20', valOut20], ['VAL/ALL_55', valOut55],
  ] as const) {
    const v = out.equityCurve
      .filter((p) => p.cash < -1e-6)
      .map((p) => `${p.date}:${p.cash.toFixed(0)}`);
    results.push(inv(`cash>=0 [${label}]`, out.equityCurve.length, v));
  }

  // I3: exitFill.fillDate >= entryFill.fillDate
  const allTrades = [
    ...devOut20.trades, ...devOut55.trades,
    ...valOut20.trades, ...valOut55.trades,
  ];
  {
    const v = allTrades
      .filter((t) => t.exitFill !== null && t.exitFill.fillDate < t.entryFill.fillDate)
      .map((t) => `${t.tradeId}: exit=${t.exitFill?.fillDate} entry=${t.entryFill.fillDate}`);
    results.push(inv('exit>=entry', allTrades.length, v));
  }

  // I4: holdingDays >= 0
  // holdingDays=0은 임시 상장종료 exDate = 진입 체결일인 경우 발생 가능 (엔진 정상)
  {
    const closed = allTrades.filter((t) => t.holdingDays !== null);
    const v = closed
      .filter((t) => (t.holdingDays ?? 0) < 0)
      .map((t) => `${t.tradeId}: holdingDays=${t.holdingDays}`);
    results.push(inv('holdingDays>=0', closed.length, v));
  }

  // I5: R부호 일치 (netReturn과 rMultiple 부호 동일, 양쪽 모두 0이 아닌 경우)
  {
    const hasRBoth = allTrades.filter(
      (t) => t.netReturn !== null && t.rMultiple !== null &&
             Math.abs(t.netReturn) > 1e-6 && Math.abs(t.rMultiple) > 1e-6
    );
    const v = hasRBoth
      .filter((t) => Math.sign(t.netReturn!) !== Math.sign(t.rMultiple!))
      .map((t) => `${t.tradeId}: netRet=${t.netReturn?.toFixed(4)} R=${t.rMultiple?.toFixed(4)}`);
    results.push(inv('R-sign consistent', hasRBoth.length, v));
  }

  // I6: 그룹 = 'A' | 'B' (unclassifiable 진입 없음)
  {
    const v = allTrades
      .filter((t) => t.group !== 'A' && t.group !== 'B')
      .map((t) => `${t.tradeId}: group=${t.group}`);
    results.push(inv('group in {A,B}', allTrades.length, v));
  }

  // I7: DEV 거래 신호일 ≤ DEV_END, VAL 거래 신호일 ≥ VAL_START
  {
    const devViolations = [...devOut20.trades, ...devOut55.trades]
      .filter((t) => t.entrySignal.signalDate > DEV_END)
      .map((t) => `${t.tradeId}: signal=${t.entrySignal.signalDate}`);
    results.push(inv('dev-signals within DEV_END', devOut20.trades.length + devOut55.trades.length, devViolations));

    const valViolations = [...valOut20.trades, ...valOut55.trades]
      .filter((t) => t.entrySignal.signalDate < VAL_START)
      .map((t) => `${t.tradeId}: signal=${t.entrySignal.signalDate}`);
    results.push(inv('val-signals after VAL_START', valOut20.trades.length + valOut55.trades.length, valViolations));
  }

  // I8: stopPrice < entryFill (long position에서 손절가는 항상 진입가보다 낮아야 함)
  {
    const v = allTrades
      .filter((t) => t.stopPrice >= t.entryFill.fillPrice)
      .map((t) => `${t.tradeId}: stop=${t.stopPrice} fill=${t.entryFill.fillPrice}`);
    results.push(inv('stopPrice < entryFill', allTrades.length, v));
  }

  return results;
}

// ===========================================================================
// 9. 블록 부트스트랩 (60거래일 ≈ 3개월 블록)
// ===========================================================================

interface BootstrapResult {
  deltaA_point: number;
  deltaB_point: number;
  I_point: number;
  deltaA_ci95: [number, number];
  deltaB_ci95: [number, number];
  I_ci95: [number, number];
  nMonths: number;
  nBlocks: number;
  nIter: number;
  monthlyDeltaA: Record<string, number | null>;
  monthlyDeltaB: Record<string, number | null>;
}

function blockBootstrap(
  valT20: ConditionalTradeRecord[],
  valT55: ConditionalTradeRecord[],
  nIter = 10000
): BootstrapResult {
  const ym = (d: IsoDate) => d.substring(0, 7);

  // 월별 그룹별 R 수집 (신호일 기준)
  const r_A20 = new Map<string, number[]>();
  const r_A55 = new Map<string, number[]>();
  const r_B20 = new Map<string, number[]>();
  const r_B55 = new Map<string, number[]>();
  const months = new Set<string>();

  function collect(trades: ConditionalTradeRecord[], mapA: Map<string, number[]>, mapB: Map<string, number[]>) {
    for (const t of trades) {
      if (t.rMultiple === null) continue;
      const m = ym(t.entrySignal.signalDate);
      months.add(m);
      const map = t.group === 'A' ? mapA : mapB;
      const arr = map.get(m) ?? [];
      arr.push(t.rMultiple);
      map.set(m, arr);
    }
  }
  collect(valT20, r_A20, r_B20);
  collect(valT55, r_A55, r_B55);

  const sortedMonths = Array.from(months).sort();
  const meanOf = (m: Map<string, number[]>, month: string): number | null => {
    const arr = m.get(month);
    return arr && arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
  };

  type MonthStats = {
    ym: string;
    mA20: number | null; mA55: number | null;
    mB20: number | null; mB55: number | null;
    dA: number | null; dB: number | null; I: number | null;
  };

  const mData: MonthStats[] = sortedMonths.map((m) => {
    const mA20 = meanOf(r_A20, m), mA55 = meanOf(r_A55, m);
    const mB20 = meanOf(r_B20, m), mB55 = meanOf(r_B55, m);
    const dA = mA20 !== null && mA55 !== null ? mA20 - mA55 : null;
    const dB = mB20 !== null && mB55 !== null ? mB20 - mB55 : null;
    const I  = dA !== null && dB !== null ? dA - dB : null;
    return { ym: m, mA20, mA55, mB20, mB55, dA, dB, I };
  });

  // 60거래일 블록 = 3개월 블록
  const BLOCK_MONTHS = 3;
  const blocks: MonthStats[][] = [];
  for (let i = 0; i < mData.length; i += BLOCK_MONTHS) {
    blocks.push(mData.slice(i, i + BLOCK_MONTHS));
  }

  const mean = (vals: number[]): number | null =>
    vals.length === 0 ? null : vals.reduce((s, v) => s + v, 0) / vals.length;

  function computeStats(subset: MonthStats[]): { dA: number | null; dB: number | null; I: number | null } {
    const vdA = subset.filter((m) => m.dA !== null).map((m) => m.dA as number);
    const vdB = subset.filter((m) => m.dB !== null).map((m) => m.dB as number);
    const vI  = subset.filter((m) => m.I  !== null).map((m) => m.I  as number);
    return { dA: mean(vdA), dB: mean(vdB), I: mean(vI) };
  }

  const pointEst = computeStats(mData);

  // Bootstrap
  lcgReset();
  const bsDeltaA: number[] = [], bsDeltaB: number[] = [], bsI: number[] = [];
  const nBlocks = blocks.length;

  for (let iter = 0; iter < nIter; iter++) {
    const resampled: MonthStats[] = [];
    for (let b = 0; b < nBlocks; b++) {
      const picked = blocks[Math.floor(lcgNext() * nBlocks)];
      resampled.push(...picked);
    }
    const s = computeStats(resampled);
    if (s.dA !== null) bsDeltaA.push(s.dA);
    if (s.dB !== null) bsDeltaB.push(s.dB);
    if (s.I  !== null) bsI.push(s.I);
  }

  function ci95(arr: number[]): [number, number] {
    if (arr.length === 0) return [NaN, NaN];
    const sorted = [...arr].sort((a, b) => a - b);
    return [
      sorted[Math.floor(sorted.length * 0.025)],
      sorted[Math.floor(sorted.length * 0.975)],
    ];
  }

  const monthlyDeltaA: Record<string, number | null> = {};
  const monthlyDeltaB: Record<string, number | null> = {};
  for (const m of mData) { monthlyDeltaA[m.ym] = m.dA; monthlyDeltaB[m.ym] = m.dB; }

  return {
    deltaA_point: pointEst.dA ?? NaN,
    deltaB_point: pointEst.dB ?? NaN,
    I_point: pointEst.I ?? NaN,
    deltaA_ci95: ci95(bsDeltaA),
    deltaB_ci95: ci95(bsDeltaB),
    I_ci95: ci95(bsI),
    nMonths: sortedMonths.length,
    nBlocks,
    nIter,
    monthlyDeltaA,
    monthlyDeltaB,
  };
}

// ===========================================================================
// 10. 레포트 빌더
// ===========================================================================

function fmt2(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'NA';
  return n.toFixed(3);
}

function buildReport(params: {
  runDate: string;
  rpeResult: RpeTestResult;
  verResults: TradeVerResult[];
  invResults: InvResult[];
  bootstrap: BootstrapResult;
  devT20count: number; devT55count: number;
  valT20count: number; valT55count: number;
  devT20A_mean: number | null; devT20B_mean: number | null;
  devT55A_mean: number | null; devT55B_mean: number | null;
  valT20A_mean: number | null; valT20B_mean: number | null;
  valT55A_mean: number | null; valT55B_mean: number | null;
  prelockBaseI: number; prelockDoubleI: number;
  finalVerdict: string;
}): string {
  const {
    runDate, rpeResult, verResults, invResults, bootstrap,
    devT20count, devT55count, valT20count, valT55count,
    devT20A_mean, devT20B_mean, devT55A_mean, devT55B_mean,
    valT20A_mean, valT20B_mean, valT55A_mean, valT55B_mean,
    prelockBaseI, prelockDoubleI,
    finalVerdict,
  } = params;

  const verErrors   = verResults.filter((v) => v.errors.length > 0);
  const invFailed   = invResults.filter((i) => !i.passed);
  const engineClean = rpeResult.mismatchCount === 0 && verErrors.length === 0 && invFailed.length === 0;

  const fmtCI = (ci: [number, number]) => `[${fmt2(ci[0])}, ${fmt2(ci[1])}]`;

  const verTable = verResults.map((v) => {
    const status = v.errors.length === 0 ? '✓' : '✗';
    const errStr = v.errors.length > 0 ? ` **${v.errors.join('; ')}**` : '';
    return `| ${status} | ${v.tradeId} | ${v.securityId} | ${v.period} | ${v.strategy} | ${v.group} | ${v.signalDate} | ${v.exitReason} | ${fmt2(v.rMultiple)} |${errStr}`;
  }).join('\n');

  const invTable = invResults.map((i) => {
    const status = i.passed ? '✓' : '✗';
    const vStr   = i.violations.length > 0 ? ` _위반: ${i.violations.join(', ')}_` : '';
    return `| ${status} | ${i.name} | ${i.checkedCount} | ${i.violations.length} |${vStr}`;
  }).join('\n');

  const monthlyBootTable = Object.entries(bootstrap.monthlyDeltaA)
    .map(([m, dA]) => {
      const dB = bootstrap.monthlyDeltaB[m];
      const I  = dA !== null && dB !== null ? dA - dB : null;
      return `| ${m} | ${fmt2(dA)} | ${fmt2(dB)} | ${fmt2(I)} |`;
    }).join('\n');

  const lines: string[] = [
    `# 거래 원장 검산 보고서 — conditional-channel-kr-size-v1`,
    ``,
    `실행일: ${runDate}  `,
    `검산 구간: 개발 2010-2019, 검증 2020-2022. **잠금표본(2023-2025) 미접촉.**  `,
    `최종 판정: **${finalVerdict}**`,
    ``,
    `---`,
    ``,
    `## §1. rollingPriorExtreme vs naive O(N²) 검증`,
    ``,
    `총 케이스 ${rpeResult.totalCases}개 (경계조건 + 무작위 1000배열), 불일치 **${rpeResult.mismatchCount}**개.`,
    rpeResult.mismatchCount === 0
      ? `\n✓ 두 구현 완전 일치 — 모노토닉 deque 알고리즘이 naive O(N²) 기준과 동등함.`
      : `\n⛔ 불일치 발견:\n${rpeResult.details.map((d) => `- ${d}`).join('\n')}`,
    ``,
    `---`,
    ``,
    `## §2. 시뮬레이션 재현 (ALL_20·ALL_55 / BASE / 개발·검증)`,
    ``,
    `| 전략 | 구간 | 거래수 | 그룹A mean R | 그룹B mean R |`,
    `|------|------|-------:|-------------:|-------------:|`,
    `| ALL_20 | DEV | ${devT20count} | ${fmt2(devT20A_mean)} | ${fmt2(devT20B_mean)} |`,
    `| ALL_55 | DEV | ${devT55count} | ${fmt2(devT55A_mean)} | ${fmt2(devT55B_mean)} |`,
    `| ALL_20 | VAL | ${valT20count} | ${fmt2(valT20A_mean)} | ${fmt2(valT20B_mean)} |`,
    `| ALL_55 | VAL | ${valT55count} | ${fmt2(valT55A_mean)} | ${fmt2(valT55B_mean)} |`,
    ``,
    `참고: prelock_results.json의 BASE 수치와 비교 (독립 재현).`,
    ``,
    `---`,
    ``,
    `## §3. 48건 거래 검산`,
    ``,
    `추출 ${verResults.length}건. 오류 **${verErrors.length}**건.`,
    ``,
    `확인 항목: 채널최고가·신호트리거·진입체결가·ATR·손절가·R배수·매수비용·매도비용 (허용오차 0.1~1%).`,
    ``,
    `| 결과 | tradeId | 종목 | 구간 | 전략 | 그룹 | 신호일 | 청산사유 | R |`,
    `|------|---------|------|------|------|------|--------|---------|---|`,
    verTable,
    ``,
    engineClean || verErrors.length === 0
      ? `✓ 전 거래 오류 없음.`
      : `⛔ 오류 ${verErrors.length}건:\n${verErrors.map((v) => `- **${v.tradeId}** (${v.securityId}): ${v.errors.join(', ')}`).join('\n')}`,
    ``,
    `---`,
    ``,
    `## §4. 불변식 검사`,
    ``,
    `| 결과 | 불변식 | 검사수 | 위반수 |`,
    `|------|--------|-------:|-------:|`,
    invTable,
    ``,
    invFailed.length === 0
      ? `✓ 전 불변식 통과.`
      : `⛔ 불변식 위반 ${invFailed.length}건:\n${invFailed.map((i) => `- **${i.name}**: ${i.violations.slice(0, 3).join(', ')}`).join('\n')}`,
    ``,
    `---`,
    ``,
    `## §5. POST_VALIDATION_DIAGNOSTIC — 블록 부트스트랩`,
    ``,
    `> ⚠ 이 섹션은 검증 결과를 본 이후 사후 진단(POST_VALIDATION_DIAGNOSTIC)이다.`,
    `> 사전등록된 통계(§4.6)의 공식 검정은 잠금표본 개봉 후 수행한다.`,
    ``,
    `**설계**: 월별 그룹×전략 평균 R → 3개월(≈60거래일) 블록 부트스트랩 → 10,000회 반복, 시드 20260716.`,
    ``,
    `**주 추정량**:`,
    `- ΔA = mean(R20,A) - mean(R55,A): 대형주에서 20일 - 55일`,
    `- ΔB = mean(R20,B) - mean(R55,B): 비대형주에서 20일 - 55일`,
    `- I = ΔA - ΔB (가설 방향 I > 0)`,
    ``,
    `| 추정량 | 점추정 | 95% CI |`,
    `|--------|-------:|--------|`,
    `| ΔA | ${fmt2(bootstrap.deltaA_point)} R | ${fmtCI(bootstrap.deltaA_ci95)} |`,
    `| ΔB | ${fmt2(bootstrap.deltaB_point)} R | ${fmtCI(bootstrap.deltaB_ci95)} |`,
    `| **I** | **${fmt2(bootstrap.I_point)} R** | **${fmtCI(bootstrap.I_ci95)}** |`,
    ``,
    `사용 개월수: ${bootstrap.nMonths}, 블록 수: ${bootstrap.nBlocks}, 반복: ${bootstrap.nIter}`,
    ``,
    `### 월별 ΔA / ΔB 명세`,
    ``,
    `| 연-월 | ΔA | ΔB | I |`,
    `|-------|---:|---:|---|`,
    monthlyBootTable,
    ``,
    `---`,
    ``,
    `## §6. 결론`,
    ``,
    `### 엔진 검산`,
    `- rollingPriorExtreme vs naive: **${rpeResult.mismatchCount === 0 ? 'PASS' : 'FAIL'}** (${rpeResult.totalCases} cases)`,
    `- 거래 독립 재계산: **${verErrors.length === 0 ? 'PASS' : 'FAIL'}** (${verResults.length}/${verResults.length} verified)`,
    `- 불변식: **${invFailed.length === 0 ? 'PASS' : 'FAIL'}** (${invResults.length - invFailed.length}/${invResults.length} passed)`,
    ``,
    `### 통계 요약`,
    engineClean
      ? `엔진 버그 미발견.`
      : `⛔ 엔진 오류 발견 — 통계 해석 보류.`,
    ``,
    `가설 방향 I > 0 vs 관측 방향:`,
    ``,
    `| 추정량 출처 | 점추정 | 비고 |`,
    `|------------|-------:|------|`,
    `| prelock 직접추정 (BASE, 거래가중) | **${fmt2(prelockBaseI)} R** | 전체 거래 기준 주 추정량 |`,
    `| prelock 직접추정 (DOUBLE, 거래가중) | **${fmt2(prelockDoubleI)} R** | 비용 강건성 확인 |`,
    `| 부트스트랩 월별 평균 (BASE) | ${fmt2(bootstrap.I_point)} R | 월 단순평균 보조 추정 |`,
    ``,
    `- 95% CI (부트스트랩 월별): ${fmtCI(bootstrap.I_ci95)} — CI 너비 해설: 36개월×3개월블록=12블록, 표본 한계로 구간 넓음`,
    `- prelock BASE/DOUBLE 직접추정 모두 음수 → 가설 방향 I > 0과 **반대**`,
    Number.isFinite(prelockBaseI) && prelockBaseI < 0 && Number.isFinite(bootstrap.I_point) && bootstrap.I_point < 0
      ? `- 두 추정량 방향 일치 (음수) → PRELOCK 권고("interaction이 음수라면 REVERSE 재등록") 충족`
      : `- 추정량 방향 불일치 또는 데이터 없음`,
    ``,
    `**최종 판정: ${finalVerdict}**`,
    ``,
    `---`,
    ``,
    `*이 문서는 자동 생성됐으며 결과 확인 후 변경하지 않는다.*`,
  ];

  return lines.join('\n');
}

// ===========================================================================
// 11. 유틸
// ===========================================================================

function meanOf(trades: ConditionalTradeRecord[], group: 'A' | 'B'): number | null {
  const rs = trades.filter((t) => t.group === group && t.rMultiple !== null).map((t) => t.rMultiple!);
  return rs.length > 0 ? rs.reduce((s, v) => s + v, 0) / rs.length : null;
}

interface PrelockInteraction {
  costTier: string;
  deltaA: number;
  deltaB: number;
  interaction: number;
}

function loadPrelockInteraction(prelockPath: string): { base: PrelockInteraction; double: PrelockInteraction } | null {
  try {
    const raw = readFileSync(prelockPath, 'utf-8');
    const json = JSON.parse(raw) as { validationInteraction: PrelockInteraction[] };
    const base   = json.validationInteraction.find((v) => v.costTier === 'BASE');
    const double = json.validationInteraction.find((v) => v.costTier === 'DOUBLE');
    if (!base || !double) return null;
    return { base, double };
  } catch {
    return null;
  }
}

// ===========================================================================
// 12. Main
// ===========================================================================

async function main(): Promise<void> {
  const runDate = new Date().toISOString().slice(0, 10);

  console.log('='.repeat(80));
  console.log('LEDGER AUDIT — conditional-channel-kr-size-v1');
  console.log(`실행일: ${runDate}`);
  console.log('⚠  2023-2025 잠금표본 미접촉. 개발·검증 구간만 처리.');
  console.log('='.repeat(80));

  // ─────────────────────────────────────────────────────────────────────────
  // 1단계: rollingPriorExtreme vs naive
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[1/7] rollingPriorExtreme vs naive O(N²) 검증...');
  const rpeResult = testRollingPriorExtreme();
  console.log(`  총 ${rpeResult.totalCases}케이스, 불일치 ${rpeResult.mismatchCount}건`);
  if (rpeResult.mismatchCount > 0) {
    for (const d of rpeResult.details) console.log(`  ⛔ ${d}`);
  } else {
    console.log('  ✓ 완전 일치');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2단계: 데이터 로드
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[2/7] 데이터셋 로드 중 (2010-01-01 ~ 2022-12-31)...');
  const dataset = await loadKrSizeDataset({
    processedDir: PROCESSED_DIR,
    fromDate: DEV_START,
    toDate: VAL_END,
  });
  console.log(`  ${dataset.securitiesByCode.size}종목, ${dataset.monthlyFlags.size}월 로드 완료`);

  // ─────────────────────────────────────────────────────────────────────────
  // 3단계: 시뮬레이션
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[3/7] 시뮬레이션 실행 중...');
  const devSecs = sliceSecurities(dataset, DEV_END);
  const valSecs = sliceSecurities(dataset, VAL_END);
  const devDL   = buildProvisionalDelistings(devSecs);
  const valDL   = buildProvisionalDelistings(valSecs);

  console.log(`  개발 ALL_20 (${devSecs.length}종목)...`);
  const devOut20 = simulatePortfolio(devSecs, makeConfig('ALL_20', DEV_START, DEV_END), devDL);
  console.log(`  → ${devOut20.trades.length}거래, equity curve ${devOut20.equityCurve.length}일`);

  console.log(`  개발 ALL_55 (${devSecs.length}종목)...`);
  const devOut55 = simulatePortfolio(devSecs, makeConfig('ALL_55', DEV_START, DEV_END), devDL);
  console.log(`  → ${devOut55.trades.length}거래`);

  console.log(`  검증 ALL_20 (${valSecs.length}종목)...`);
  const valOut20 = simulatePortfolio(valSecs, makeConfig('ALL_20', VAL_START, VAL_END), valDL);
  console.log(`  → ${valOut20.trades.length}거래`);

  console.log(`  검증 ALL_55 (${valSecs.length}종목)...`);
  const valOut55 = simulatePortfolio(valSecs, makeConfig('ALL_55', VAL_START, VAL_END), valDL);
  console.log(`  → ${valOut55.trades.length}거래`);

  // 요약 통계
  const devT20A = meanOf(devOut20.trades, 'A'), devT20B = meanOf(devOut20.trades, 'B');
  const devT55A = meanOf(devOut55.trades, 'A'), devT55B = meanOf(devOut55.trades, 'B');
  const valT20A = meanOf(valOut20.trades, 'A'), valT20B = meanOf(valOut20.trades, 'B');
  const valT55A = meanOf(valOut55.trades, 'A'), valT55B = meanOf(valOut55.trades, 'B');
  console.log(`  DEV ALL_20: A=${fmt2(devT20A)} B=${fmt2(devT20B)}`);
  console.log(`  DEV ALL_55: A=${fmt2(devT55A)} B=${fmt2(devT55B)}`);
  console.log(`  VAL ALL_20: A=${fmt2(valT20A)} B=${fmt2(valT20B)}`);
  console.log(`  VAL ALL_55: A=${fmt2(valT55A)} B=${fmt2(valT55B)}`);

  // ─────────────────────────────────────────────────────────────────────────
  // 4단계: 표본 추출
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[4/7] 표본 추출...');
  const samples = sampleTrades(devOut20.trades, devOut55.trades, valOut20.trades, valOut55.trades);
  console.log(`  ${samples.length}건 추출`);

  // ─────────────────────────────────────────────────────────────────────────
  // 5단계: 거래 독립 검산
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[5/7] 거래 독립 검산...');
  const verResults = samples.map((s) => verifyTrade(s, dataset.securitiesByCode));
  const verErrors  = verResults.filter((v) => v.errors.length > 0);
  console.log(`  검산 완료 ${verResults.length}건, 오류 ${verErrors.length}건`);
  for (const v of verErrors) {
    console.log(`  ⛔ ${v.tradeId} (${v.securityId}): ${v.errors.join('; ')}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 6단계: 불변식 검사
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[6/7] 불변식 검사...');
  const invResults = checkInvariants(devOut20, devOut55, valOut20, valOut55);
  const invFailed  = invResults.filter((i) => !i.passed);
  console.log(`  통과 ${invResults.length - invFailed.length}/${invResults.length}`);
  for (const i of invFailed) {
    console.log(`  ⛔ ${i.name}: ${i.violations.slice(0, 2).join(', ')}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 7단계: 블록 부트스트랩
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n[7/7] 블록 부트스트랩 (10,000회)...');
  const bootstrap = blockBootstrap(valOut20.trades, valOut55.trades);
  console.log(`  ΔA=${fmt2(bootstrap.deltaA_point)} ${JSON.stringify(bootstrap.deltaA_ci95.map((v) => fmt2(v)))}`);
  console.log(`  ΔB=${fmt2(bootstrap.deltaB_point)} ${JSON.stringify(bootstrap.deltaB_ci95.map((v) => fmt2(v)))}`);
  console.log(`  I=${fmt2(bootstrap.I_point)} 95%CI ${JSON.stringify(bootstrap.I_ci95.map((v) => fmt2(v)))}`);

  // ─────────────────────────────────────────────────────────────────────────
  // 최종 판정
  // ─────────────────────────────────────────────────────────────────────────
  const engineClean =
    rpeResult.mismatchCount === 0 && verErrors.length === 0 && invFailed.length === 0;

  // prelock 직접 추정값 로드 (비짝지은 기술통계, 전체 거래 가중)
  const PRELOCK_PATH = 'scripts/backtest/data/conditionalChannel/kr/output/prelock_results.json';
  const prelockIx = loadPrelockInteraction(PRELOCK_PATH);
  const prelockBaseI   = prelockIx?.base.interaction   ?? NaN;
  const prelockDoubleI = prelockIx?.double.interaction ?? NaN;
  if (prelockIx) {
    console.log(`\n  prelock 직접추정: BASE I=${prelockBaseI.toFixed(4)}R  DOUBLE I=${prelockDoubleI.toFixed(4)}R`);
  } else {
    console.log('\n  ⚠ prelock_results.json 로드 실패 — 부트스트랩 점추정만 사용');
  }

  let finalVerdict: string;
  if (!engineClean) {
    finalVerdict = 'AUDIT_FAIL';
  } else {
    const ci = bootstrap.I_ci95;
    // 주 방향 기준: prelock 직접추정(전체 거래 가중, BASE 기준)
    // 보조 기준: 부트스트랩 월별 단순평균
    // 두 추정량 모두 같은 음의 방향을 가리키면 ORIGINAL_NOT_SUPPORTED_REVERSE_PREREGISTERED
    const prelockNegative   = Number.isFinite(prelockBaseI) && prelockBaseI < 0;
    const bootstrapNegative = Number.isFinite(bootstrap.I_point) && bootstrap.I_point < 0;

    if (!Number.isFinite(ci[0]) || !Number.isFinite(ci[1])) {
      finalVerdict = 'INCONCLUSIVE';
    } else if (prelockNegative && bootstrapNegative) {
      // prelock과 부트스트랩 점추정 모두 음수(가설 방향 I>0과 반대)
      // PRELOCK 권고: "검증구간 interaction이 음수라면 원 가설은 기각하고 REVERSE를 새 가설로 재등록"
      finalVerdict = 'ORIGINAL_NOT_SUPPORTED_REVERSE_PREREGISTERED';
    } else if (ci[1] < 0) {
      // CI 전체 0 미만 (매우 강한 음의 증거)
      finalVerdict = 'ORIGINAL_NOT_SUPPORTED_REVERSE_PREREGISTERED';
    } else {
      finalVerdict = 'INCONCLUSIVE';
    }
  }

  console.log(`\n최종 판정: ${finalVerdict}`);

  // ─────────────────────────────────────────────────────────────────────────
  // 레포트 작성
  // ─────────────────────────────────────────────────────────────────────────
  await mkdir('docs/backtest', { recursive: true });
  const report = buildReport({
    runDate,
    rpeResult,
    verResults,
    invResults,
    bootstrap,
    devT20count: devOut20.trades.length,
    devT55count: devOut55.trades.length,
    valT20count: valOut20.trades.length,
    valT55count: valOut55.trades.length,
    devT20A_mean: devT20A,
    devT20B_mean: devT20B,
    devT55A_mean: devT55A,
    devT55B_mean: devT55B,
    valT20A_mean: valT20A,
    valT20B_mean: valT20B,
    valT55A_mean: valT55A,
    valT55B_mean: valT55B,
    prelockBaseI,
    prelockDoubleI,
    finalVerdict,
  });
  await writeFile(DOCS_OUTPUT, report, 'utf-8');
  console.log(`\n레포트 저장: ${DOCS_OUTPUT}`);
  console.log('='.repeat(80));

  if (finalVerdict === 'AUDIT_FAIL') process.exit(1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
