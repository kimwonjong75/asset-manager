// tests/conditionalChannelBacktest.ts
// ---------------------------------------------------------------------------
// 조건부 돌파 채널 검증(PROMPT_3 §15) 골든/단위 테스트 — 순수 로직·결정론 검증.
// 모든 데이터는 이 파일에서 손으로 만든 작은 합성 OHLCV(외부 데이터 불필요).
// 수동 실행: npm run test:conditional-channel (tsx). 통과 시 exit 0.
//
// 커버(§15):
//   · 현재 바 제외 Donchian 고/저   · 종목별 거래일 인덱스(합집합 달력 아님)
//   · <55바 공통 시작 전 무신호      · 종가확인→익일 시가 체결
//   · 갭/장중 손절 처리              · 분할 전후 손익 연속성(스케일 불변)
//   · 상장폐지 대가 반영 + 불명 제외 · 월말정보 익월 적용·진입 그룹 동결
//   · A=large∨leader / B 완전 분할   · 동률·다중신호·정수주 결정성
//   · 비용 0/기본/2배 매수·매도      · 열린 포지션 종료 3방식
//   · 고정 입력·시드 해시 재현        · 수작업 ΔA/ΔB/I 대조
// ---------------------------------------------------------------------------

import {
  monthKeyOf,
  nextMonthKey,
  computeMonthlyGroupFlags,
  resolveFrozenGroup,
  resolveFrozenClassification,
  checkFullPartition,
  type MonthlyClassificationInput,
} from '../scripts/backtest/conditionalChannel/classifier';
import {
  entryChannelHigh,
  exitChannelLow,
  isEntrySignal,
  isChannelExitSignal,
  atrSeries,
  firstAtrReadyIndex,
  commonStartIndex,
  naturalStartIndex,
  resolveFillIndex,
  computeStopPrice,
  stopFill,
  resolveSellTaxBps,
  costTierMultiplier,
  tradeCost,
  positionSize,
  proRataRiskAllocation,
  medianDailyValue,
  advParticipationOk,
  resolveDelisting,
  closeOpenPosition,
  simulateSecurity,
  simulatePortfolio,
  type SecurityBars,
  type SecuritySimConfig,
  type PortfolioSimConfig,
  type RiskCandidate,
} from '../scripts/backtest/conditionalChannel/simulator';
import {
  mulberry32,
  mean,
  pairedDiff,
  deltaEstimate,
  interaction,
  percentileSorted,
  blockBootstrapInteraction,
  holmAdjust,
  constrainedLabelPermutation,
  labelKey,
  seededShuffle,
  type LabelUnit,
} from '../scripts/backtest/conditionalChannel/statistics';
import { formatReport } from '../scripts/backtest/conditionalChannel/report';
import type {
  CorporateActionRecord,
  CostModelParams,
  MonthlyGroupFlags,
  PointInTimeMarketCap,
  PointInTimeSectorClassification,
  StatisticalPlan,
} from '../types/backtestConditionalChannel';

let pass = 0;
const fails: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function checkClose(name: string, actual: number, expected: number, eps = 1e-6): void {
  if (Math.abs(actual - expected) <= eps) pass++;
  else fails.push(`✗ ${name}: got ${actual}, expected ${expected}`);
}
function checkTrue(name: string, cond: boolean): void {
  if (cond) pass++;
  else fails.push(`✗ ${name}: expected true`);
}

// ── 공통 헬퍼 ───────────────────────────────────────────────────────────────
function makeBars(
  id: string,
  open: number[],
  high: number[],
  low: number[],
  close: number[],
  volume?: number[]
): SecurityBars {
  const dates = open.map((_, i) => `2020-01-${String(i + 1).padStart(2, '0')}`);
  return {
    securityId: id,
    symbol: id,
    market: 'US',
    currency: 'USD',
    dates,
    open,
    high,
    low,
    close,
    volume: volume ?? open.map(() => 1e12),
  };
}

// 명시적 날짜(월 경계 포함) 종목 바 — makeBars는 2020-01만 생성하므로 월 동결 테스트용.
function makeBarsDates(
  id: string,
  dates: string[],
  open: number[],
  high: number[],
  low: number[],
  close: number[],
  volume?: number[]
): SecurityBars {
  return {
    securityId: id,
    symbol: id,
    market: 'US',
    currency: 'USD',
    dates,
    open,
    high,
    low,
    close,
    volume: volume ?? open.map(() => 1e12),
  };
}

// 월별 그룹 플래그 조립(테스트용). unclassifiable=true면 large/leader/marketCap을 제외 규약대로 채운다.
function mkFlag(
  securityId: string,
  effectiveMonth: string,
  group: 'A' | 'B',
  opts: {
    large?: boolean;
    leader?: boolean;
    unclassifiable?: boolean;
    marketCap?: number | null;
    market?: 'US' | 'KR';
  } = {}
): MonthlyGroupFlags {
  const unclassifiable = opts.unclassifiable ?? false;
  return {
    securityId,
    market: opts.market ?? 'US',
    asOfMonthEnd: `${effectiveMonth}-01`, // 감사 메타데이터일 뿐(해석에 미사용)
    effectiveMonth,
    investable: true,
    marketCap: unclassifiable ? null : opts.marketCap ?? 1000,
    marketCapPercentile: unclassifiable ? null : 90,
    large: unclassifiable ? false : opts.large ?? group === 'A',
    sectorCode: null,
    sectorRankByMarketCap: null,
    sectorInvestableCount: null,
    leader: unclassifiable ? false : opts.leader ?? false,
    group,
    unclassifiable,
    tieBreakNote: null,
  };
}

const COST_NOTAX: CostModelParams = {
  market: 'US',
  commissionBps: 10,
  spreadBps: 5,
  slippageBps: 3,
  marketImpactBps: 2,
  sellTaxSchedule: [],
  advParticipationCap: 0.05,
  sourceNote: 'test',
};
const COST_TAX: CostModelParams = {
  ...COST_NOTAX,
  sellTaxSchedule: [{ effectiveFrom: '2020-01-01', effectiveTo: null, taxBps: 23, source: 'test' }],
};

const baseSimConfig: SecuritySimConfig = {
  strategyId: 'ADAPTIVE',
  group: 'A',
  entryLookback: 3,
  exitLookback: 3,
  atrLookback: 3,
  stopMultiple: 2,
  startIndex: 4,
  fillDelayDays: 1,
  equity: 1_000_000,
  riskPerTradePct: 0.5,
  singleNameValueCapPct: 0,
  costParams: COST_NOTAX,
  costTier: 'ZERO',
  slippageFrac: 0,
  closeMethod: 'FORCED_CLOSE',
};

// ════════════════════════════════════════════════════════════════════════════
// 1. Donchian 현재 바 제외(§9-2) + 종목별 인덱스 룩백(§9-1)
// ════════════════════════════════════════════════════════════════════════════
{
  const bars = makeBars(
    'X',
    [10, 10, 10, 10, 10],
    [10, 11, 12, 13, 20],
    [9, 9, 9, 9, 9],
    [10, 10, 10, 10, 18]
  );
  // t=4, lookback=3 → max(high[1,2,3]) = 13, 현재 바 high(20)은 제외
  check('진입채널 현재바 제외 = 13', entryChannelHigh(bars, 4, 3), 13);
  checkTrue('close(18) > 채널(13) → 신호', isEntrySignal(bars, 4, 3));
  // 정확히 3개 선행 바만 사용(인덱스 기반, 합집합 달력 아님)
  check('진입채널 lookback=2 → max(high[2,3])=13', entryChannelHigh(bars, 4, 2), 13);
  // 청산 저가 채널: t=4 lookback=3 → min(low[1,2,3]) = 9
  check('청산채널 현재바 제외 = 9', exitChannelLow(bars, 4, 3), 9);
}

// 정확히 55개 선행 바 검증(증가 수열: 채널 = high[t-1])
{
  const n = 60;
  const high = Array.from({ length: n }, (_, i) => 100 + i);
  const bars = makeBarsLong('L55', high);
  // t=55, lookback=55 → max(high[0..54]) = high[54] = 154 (증가수열이므로 직전 최댓값)
  check('55바 채널 = high[54] = 154', entryChannelHigh(bars, 55, 55), 154);
  // 현재 바 high[55]=155는 제외되어야 함
  checkTrue('현재바 high[55] 제외 확인', entryChannelHigh(bars, 55, 55) !== 155);
}

function makeBarsLong(id: string, high: number[]): SecurityBars {
  const low = high.map((h) => h - 2);
  const close = high.map((h) => h - 1);
  const open = high.map((h) => h - 1);
  return makeBars(id, open, high, low, close);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 공통/자연 시작 게이팅(§9-3) — <55바는 공통 시작 전 무신호
// ════════════════════════════════════════════════════════════════════════════
{
  const n = 30;
  const high = Array.from({ length: n }, (_, i) => 100 + i);
  const bars = makeBarsLong('S30', high);
  // ATR(20) 준비 인덱스 = 20, commonStartBars=55 → commonStart = max(55,20)=55 >= n(30)
  check('firstAtrReadyIndex(20) = 20', firstAtrReadyIndex(bars, 20), 20);
  check('commonStartIndex(55) = 55', commonStartIndex(bars, 20, 55), 55);
  check('naturalStartIndex(20) = 20', naturalStartIndex(bars, 20, 20), 20);
  // 30바 종목: 공통 시작(55) 도달 불가 → 신호 없음 → 거래 0
  const out = simulateSecurity(bars, {
    ...baseSimConfig,
    entryLookback: 55,
    atrLookback: 20,
    startIndex: commonStartIndex(bars, 20, 55),
  });
  check('<55바 종목 거래 0', out.trades.length, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 종가 확인 → 익일 실제 거래일 시가 체결(§9-4) + FORCED_CLOSE
// ════════════════════════════════════════════════════════════════════════════
{
  const bars = makeBars(
    'RISE',
    [15, 15, 15, 15, 15, 25, 19, 22, 24],
    [16, 16, 16, 16, 16, 30, 22, 24, 26],
    [14, 14, 14, 14, 14, 25, 17, 19, 21],
    [15, 15, 15, 15, 15, 28, 21, 23, 25]
  );
  const out = simulateSecurity(bars, baseSimConfig);
  check('상승 시나리오 거래 1건', out.trades.length, 1);
  const tr = out.trades[0];
  check('신호일 = d6(t=5)', tr.entrySignal.signalDate, '2020-01-06');
  check('체결일 = 익일 d7(t=6)', tr.entryFill.fillDate, '2020-01-07');
  check('체결가 = open[6] = 19', tr.entryFill.fillPrice, 19);
  // TR[5]=max(30−25,|30−15|,|25−15|)=15 → ATR(3) idx5 = (2×2+15)/3 = 19/3
  checkClose('진입 ATR(3) = 19/3', tr.atrAtEntry, 19 / 3);
  checkClose('손절가 = 19 − 2×(19/3) = 19/3', tr.stopPrice, 19 / 3);
  check('청산 사유 FORCED_CLOSE', tr.exitReason, 'FORCED_CLOSE');
  check('강제청산가 = 마지막 종가 25', tr.exitFill.fillPrice, 25);
  check('보유일 = 8−6 = 2', tr.holdingDays, 2);
  // 손절폭 dist = 19 − 19/3 = 38/3 ≈ 12.667, shares = floor(5000/(38/3)) = floor(394.7) = 394
  check('수량 394(정수 내림)', tr.entryFill.quantity, 394);
  // netReturn = (25−19)/19 = 6/19 (수량·비용무관), rMultiple = 6/(38/3) = 9/19
  checkClose('netReturn = 6/19', tr.netReturn as number, 6 / 19);
  checkClose('rMultiple = 9/19', tr.rMultiple as number, 9 / 19);

  // ── 분할 전후 연속성(§9-9): 모든 OHLC ×0.5(분할조정 스케일) → 수익률·R 불변 ──
  const scaled = makeBars(
    'RISE_SPLIT',
    bars.open.map((v) => v * 0.5),
    bars.high.map((v) => v * 0.5),
    bars.low.map((v) => v * 0.5),
    bars.close.map((v) => v * 0.5)
  );
  const outScaled = simulateSecurity(scaled, baseSimConfig);
  check('분할 스케일 후에도 거래 1건', outScaled.trades.length, 1);
  checkClose(
    '분할 전후 netReturn 연속(불변)',
    outScaled.trades[0].netReturn as number,
    tr.netReturn as number
  );
  checkClose('분할 전후 rMultiple 연속(불변)', outScaled.trades[0].rMultiple as number, 9 / 19);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 갭/장중 손절 처리(§9-8)
// ════════════════════════════════════════════════════════════════════════════
{
  // 시가가 손절가보다 불리(≤) → 시가 체결(갭)
  const gap = stopFill(90, 85, 95, 0.001);
  check('갭하락 손절 hit', gap.hit, true);
  check('갭하락 체결 = 시가 90', gap.price, 90);
  check('갭하락 경로 GAP_OPEN', gap.path, 'GAP_OPEN');
  // 시가는 위, 장중 저가만 손절가 통과 → 손절가+슬리피지
  const intraday = stopFill(100, 94, 95, 0.001);
  check('장중 손절 hit', intraday.hit, true);
  checkClose('장중 체결 = 95 + 95×0.001', intraday.price, 95 + 95 * 0.001);
  check('장중 경로 INTRADAY_STOP', intraday.path, 'INTRADAY_STOP');
  // 미발동
  check('손절 미발동', stopFill(100, 96, 95, 0.001).hit, false);
  checkClose('손절가 수식 = entry − k×ATR', computeStopPrice(100, 5, 2), 90);

  // 통합 시뮬레이션에서 갭 손절 경로
  const bars = makeBars(
    'STOP',
    [15, 15, 15, 15, 15, 25, 29, 14],
    [16, 16, 16, 16, 16, 30, 32, 20],
    [14, 14, 14, 14, 14, 25, 27, 10],
    [15, 15, 15, 15, 15, 28, 31, 12]
  );
  const out = simulateSecurity(bars, baseSimConfig);
  check('손절 시나리오 거래 1건', out.trades.length, 1);
  check('청산 사유 PROTECTIVE_STOP', out.trades[0].exitReason, 'PROTECTIVE_STOP');
  // 진입 ATR(3): TR[5]=max(30-25,15,10)=15 → atr[5]=(2+2+15... 실제 (2*2+15)/3
  // fill open[6]=29, atr[5]=6.3333, stop=29−12.6667=16.3333, h=7 open=14≤stop → 갭체결 14
  checkClose('손절 갭 체결가 = open 14', out.trades[0].exitFill.fillPrice, 14);
  check('손절 exitStopHitPrice = 14', out.trades[0].exitStopHitPrice, 14);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 채널 청산(§9-6) — 종가 하향 돌파 → 익일 시가 체결
// ════════════════════════════════════════════════════════════════════════════
{
  const bars = makeBars(
    'CHEXIT',
    [15, 15, 15, 25, 29, 27, 24, 24],
    [16, 16, 16, 30, 32, 28, 28, 28],
    [14, 14, 14, 25, 27, 20, 20, 20],
    [15, 15, 15, 28, 31, 22, 22, 22]
  );
  const cfg: SecuritySimConfig = {
    ...baseSimConfig,
    entryLookback: 2,
    exitLookback: 2,
    atrLookback: 2,
    startIndex: 3,
  };
  checkTrue('t=5 청산 신호(close 22 < min(low[3,4])=25)', isChannelExitSignal(bars, 5, 2));
  const out = simulateSecurity(bars, cfg);
  check('채널청산 거래 1건', out.trades.length, 1);
  check('청산 사유 CHANNEL_EXIT', out.trades[0].exitReason, 'CHANNEL_EXIT');
  check('청산 체결일 = 익일 d7(t=6)', out.trades[0].exitFill.fillDate, '2020-01-07');
  check('청산 체결가 = open[6] = 24', out.trades[0].exitFill.fillPrice, 24);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 상장폐지·합병 대가 반영 + 불명 제외(§9-10)
// ════════════════════════════════════════════════════════════════════════════
{
  check('proceeds 확인 → resolvable', resolveDelisting(mkDelist(50, null)).resolvable, true);
  check('return 확인 → resolvable', resolveDelisting(mkDelist(null, -1)).resolvable, true);
  check('둘다 불명 → not resolvable', resolveDelisting(mkDelist(null, null)).resolvable, false);

  const bars = makeBars(
    'DLST',
    [15, 15, 15, 15, 15, 25, 19, 22, 24],
    [16, 16, 16, 16, 16, 30, 22, 24, 26],
    [14, 14, 14, 14, 14, 25, 17, 19, 21],
    [15, 15, 15, 15, 15, 28, 21, 23, 25]
  );
  // 진입 fill d7(index6), d8(index7)에 상장폐지 대가 30
  const known: CorporateActionRecord = {
    securityId: 'DLST',
    type: 'DELISTING',
    exDate: '2020-01-08',
    ratio: null,
    cashDividendPerShare: null,
    delistingProceedsPerShare: 30,
    delistingReturn: null,
    currency: 'USD',
    note: null,
  };
  const out = simulateSecurity(bars, baseSimConfig, [known]);
  check('상장폐지(대가) 거래 1건', out.trades.length, 1);
  check('청산 사유 DELISTING', out.trades[0].exitReason, 'DELISTING');
  check('상장폐지 체결가 = 대가 30', out.trades[0].exitFill.fillPrice, 30);
  check('상장폐지 체결일 = d8', out.trades[0].exitFill.fillDate, '2020-01-08');

  // 불명 대가 → 거래 제외 + ExclusionRecord(0/최종종가 임의대체 금지)
  const unknown: CorporateActionRecord = { ...known, delistingProceedsPerShare: null };
  const outX = simulateSecurity(bars, baseSimConfig, [unknown]);
  check('불명 상장폐지 → 거래 0(제외)', outX.trades.length, 0);
  checkTrue('불명 상장폐지 → ExclusionRecord 존재', outX.exclusions.length >= 1);
}

function mkDelist(proceeds: number | null, ret: number | null): CorporateActionRecord {
  return {
    securityId: 'D',
    type: 'DELISTING',
    exDate: '2020-01-01',
    ratio: null,
    cashDividendPerShare: null,
    delistingProceedsPerShare: proceeds,
    delistingReturn: ret,
    currency: 'USD',
    note: null,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 7. 월말 정보 익월 적용 + 진입 그룹 동결(§6-5)
// ════════════════════════════════════════════════════════════════════════════
{
  check('monthKeyOf', monthKeyOf('2020-03-31'), '2020-03');
  check('nextMonthKey 일반', nextMonthKey('2020-03'), '2020-04');
  check('nextMonthKey 연말', nextMonthKey('2020-12'), '2021-01');

  const flags = computeMonthlyGroupFlags(buildUniverse10('2020-03-31'));
  check('effectiveMonth = 익월 2020-04', flags[0].effectiveMonth, '2020-04');
  // 진입일이 적용월(2020-04)이면 그룹 조회 성공, 다른 월이면 null(그 월 플래그 없음)
  check('4월 진입 → S01 그룹 A(동결)', resolveFrozenGroup(flags, 'S01', '2020-04-15'), 'A');
  check('5월 진입 → 4월 플래그로는 조회 불가(null)', resolveFrozenGroup(flags, 'S01', '2020-05-15'), null);
}

// ════════════════════════════════════════════════════════════════════════════
// 8. A=large∨leader / B=¬large∧¬leader 완전 분할(§6) + 동률 결정성(§6-1)
// ════════════════════════════════════════════════════════════════════════════
{
  const flags = computeMonthlyGroupFlags(buildUniverse10('2020-03-31'));
  check('완전 분할(위반 0건)', checkFullPartition(flags, buildUniverse10('2020-03-31').investableSecurityIds), []);
  const byId = new Map(flags.map((f) => [f.securityId, f]));
  // large: 상위 20% = S01,S02 (N=10, rank≤2)
  check('S01 large', byId.get('S01')!.large, true);
  check('S02 large', byId.get('S02')!.large, true);
  check('S03 large=false', byId.get('S03')!.large, false);
  // leader: TECH 업종(5종목) 시총 1위 = S03
  check('S03 leader', byId.get('S03')!.leader, true);
  check('S05 leader=false(업종2위)', byId.get('S05')!.leader, false);
  // 그룹: A=S01,S02,S03 / 나머지 B
  check('S01 그룹 A', byId.get('S01')!.group, 'A');
  check('S03 그룹 A(leader)', byId.get('S03')!.group, 'A');
  check('S04 그룹 B', byId.get('S04')!.group, 'B');
  // 업종 규모: TECH=5, FIN=3
  check('TECH 투자가능 5종목', byId.get('S03')!.sectorInvestableCount, 5);
  check('FIN <5 → 대장주 없음(S04 leader=false)', byId.get('S04')!.leader, false);

  // 동률 tie-break: S02·S03 시총 동일(900)이면 securityId ASC로 S02가 상위 rank
  const tie = computeMonthlyGroupFlags(buildUniverseTie());
  const tieById = new Map(tie.map((f) => [f.securityId, f]));
  check('동률: S02 large(rank2)', tieById.get('S02')!.large, true);
  check('동률: S03 large=false(rank3, securityId 큼)', tieById.get('S03')!.large, false);
  check('동률: S02·S03 시총 동일 900', tieById.get('S02')!.marketCap, tieById.get('S03')!.marketCap);
}

// ════════════════════════════════════════════════════════════════════════════
// 9. 정수 주식 반올림 + 같은 날 다중 신호 비례 배분(§10)
// ════════════════════════════════════════════════════════════════════════════
{
  // 정수 내림: equity 1e6×0.5% = 5000, dist=3 → floor(1666.67)=1666
  const sz = positionSize({
    equity: 1_000_000,
    riskPerTradePct: 0.5,
    singleNameValueCapPct: 0,
    entryPrice: 100,
    stopPrice: 97,
  });
  check('정수 주식 내림 = 1666', sz.shares, 1666);
  checkClose('riskAmount = 1666×3', sz.riskAmount, 1666 * 3);
  // 단일 종목 25% 한도
  const capped = positionSize({
    equity: 1_000_000,
    riskPerTradePct: 5,
    singleNameValueCapPct: 25,
    entryPrice: 100,
    stopPrice: 97,
  });
  check('25% 한도 → floor(250000/100)=2500', capped.shares, 2500);
  check('capped 플래그', capped.capped, true);

  // 비례 배분: desiredRisk 60·40, 가용 50 → factor 0.5 → 30·20
  const cands: RiskCandidate[] = [
    { securityId: 'S2', desiredRisk: 40, stopDistancePerShare: 2, price: 100 },
    { securityId: 'S1', desiredRisk: 60, stopDistancePerShare: 3, price: 100 },
  ];
  const alloc = proRataRiskAllocation(cands, 50);
  checkClose('비례배분 S1 = 30', alloc.get('S1') as number, 30);
  checkClose('비례배분 S2 = 20', alloc.get('S2') as number, 20);
  // 가용 충분하면 원하는 만큼
  const alloc2 = proRataRiskAllocation(cands, 200);
  checkClose('가용충분 S1 = 60', alloc2.get('S1') as number, 60);
  checkClose('가용충분 S2 = 40', alloc2.get('S2') as number, 40);
}

// ════════════════════════════════════════════════════════════════════════════
// 10. 비용 0/기본/2배 + 매수·매도 양방향 + 매도세(§11)
// ════════════════════════════════════════════════════════════════════════════
{
  check('티어 배수 ZERO', costTierMultiplier('ZERO'), 0);
  check('티어 배수 BASE', costTierMultiplier('BASE'), 1);
  check('티어 배수 DOUBLE', costTierMultiplier('DOUBLE'), 2);
  // 변동비용 합 = 20bps. notional 100000.
  checkClose('BASE 매수 = 200', tradeCost(100000, COST_NOTAX, 'BASE', 'BUY', '2020-06-01'), 200);
  checkClose('ZERO 매수 = 0', tradeCost(100000, COST_NOTAX, 'ZERO', 'BUY', '2020-06-01'), 0);
  checkClose('DOUBLE 매수 = 400', tradeCost(100000, COST_NOTAX, 'DOUBLE', 'BUY', '2020-06-01'), 400);
  // 매도 + 세금 23bps: BASE = 200 + 230 = 430
  checkClose('BASE 매도(세금포함) = 430', tradeCost(100000, COST_TAX, 'BASE', 'SELL', '2020-06-01'), 430);
  // ZERO 티어에서도 세금은 살아있음(설계 선택): 변동 0 + 세금 230 = 230
  checkClose('ZERO 매도 = 세금만 230', tradeCost(100000, COST_TAX, 'ZERO', 'SELL', '2020-06-01'), 230);
  checkClose('DOUBLE 매도 = 400 + 230 = 630', tradeCost(100000, COST_TAX, 'DOUBLE', 'SELL', '2020-06-01'), 630);
  // 매수는 세금 없음
  checkClose('BASE 매수(세금 무관) = 200', tradeCost(100000, COST_TAX, 'BASE', 'BUY', '2020-06-01'), 200);
  // 시점별 세율 해석
  check('세율 시행 후 = 23', resolveSellTaxBps(COST_TAX.sellTaxSchedule, '2020-06-01'), 23);
  check('세율 시행 전 = 0', resolveSellTaxBps(COST_TAX.sellTaxSchedule, '2019-06-01'), 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 11. 열린 포지션 종료 3방식(§9-10)
// ════════════════════════════════════════════════════════════════════════════
{
  const pos = { securityId: 'P', entryFillPrice: 100, shares: 10, stopDistancePerShare: 3, buyCost: 20 };
  // FORCED_CLOSE: sellCost = 1200×43bps = 5.16, netPnl = 1200−1000−5.16−20 = 174.84
  const forced = closeOpenPosition('FORCED_CLOSE', pos, 120, COST_TAX, 'BASE', '2020-06-01');
  checkClose('FORCED sellCost = 5.16', forced.sellCost, 5.16);
  checkClose('FORCED netReturn = 174.84/1000', forced.netReturn as number, 174.84 / 1000);
  checkClose('FORCED rMultiple = 174.84/30', forced.rMultiple as number, 174.84 / 30);
  // MARK_TO_MARKET: 매도비용 0, netPnl = 1200−1000−0−20 = 180
  const mtm = closeOpenPosition('MARK_TO_MARKET', pos, 120, COST_TAX, 'BASE', '2020-06-01');
  check('MTM 매도비용 0', mtm.sellCost, 0);
  checkClose('MTM netReturn = 0.18', mtm.netReturn as number, 0.18);
  checkClose('MTM rMultiple = 6', mtm.rMultiple as number, 6);
  // EXCLUDE_OPEN: 제외
  const excl = closeOpenPosition('EXCLUDE_OPEN', pos, 120, COST_TAX, 'BASE', '2020-06-01');
  check('EXCLUDE_OPEN excluded', excl.excluded, true);
  check('EXCLUDE_OPEN netReturn null', excl.netReturn, null);
}

// ════════════════════════════════════════════════════════════════════════════
// 12. ADV 수용 규모 술어(§11)
// ════════════════════════════════════════════════════════════════════════════
{
  const bars = makeBars(
    'ADV',
    [10, 10, 10, 10],
    [10, 10, 10, 10],
    [10, 10, 10, 10],
    [10, 10, 10, 10],
    [100, 200, 300, 999]
  );
  // t=3, lookback=3 → close×volume = [1000,2000,3000] 중앙값 2000
  check('60일 중앙 거래대금(현재바 제외) = 2000', medianDailyValue(bars, 3, 3), 2000);
  check('주문 ≤ 5%×2000=100 → 체결가능', advParticipationOk(100, 2000, 0.05), true);
  check('주문 > 100 → 미체결', advParticipationOk(101, 2000, 0.05), false);
  check('중앙값 없음 → 보수적 false', advParticipationOk(1, null, 0.05), false);
}

// ════════════════════════════════════════════════════════════════════════════
// 13. 통계 — 시드 PRNG 결정성 + 수작업 ΔA/ΔB/I(§7·§12)
// ════════════════════════════════════════════════════════════════════════════
{
  // mulberry32 결정성
  const r1 = mulberry32(20260715);
  const r2 = mulberry32(20260715);
  const seq1 = [r1(), r1(), r1(), r1(), r1()];
  const seq2 = [r2(), r2(), r2(), r2(), r2()];
  check('mulberry32 동일 시드 → 동일 수열', seq1, seq2);
  checkTrue('mulberry32 [0,1) 범위', seq1.every((x) => x >= 0 && x < 1));

  // percentile 선형보간
  checkClose('percentile 50 of [1,2,3,4] = 2.5', percentileSorted([1, 2, 3, 4], 50), 2.5);
  check('percentile 0 = 최소', percentileSorted([1, 2, 3, 4], 0), 1);
  check('percentile 100 = 최대', percentileSorted([1, 2, 3, 4], 100), 4);

  // 수작업 ΔA/ΔB/I
  const r20A = [0.02, 0.01, -0.01];
  const r55A = [0.0, 0.02, -0.02];
  check('pairedDiff A = [0.02,-0.01,0.01]', pairedDiff(r20A, r55A).map((x) => Math.round(x * 1000) / 1000), [0.02, -0.01, 0.01]);
  checkClose('ΔA = 0.02/3', deltaEstimate(r20A, r55A), 0.02 / 3);
  const r20B = [0.01, -0.01];
  const r55B = [0.03, 0.0];
  checkClose('ΔB = -0.015', deltaEstimate(r20B, r55B), -0.015);
  const dA = deltaEstimate(r20A, r55A);
  const dB = deltaEstimate(r20B, r55B);
  checkClose('I = ΔA − ΔB', interaction(dA, dB), 0.02 / 3 - -0.015);
  checkClose('mean 헬퍼', mean([1, 2, 3, 4]), 2.5);

  // Holm 보정: [0.01,0.04,0.03] → [0.03,0.06,0.06]
  const holm = holmAdjust([0.01, 0.04, 0.03]);
  checkClose('Holm[0] = 0.03', holm[0], 0.03);
  checkClose('Holm[1] = 0.06', holm[1], 0.06);
  checkClose('Holm[2] = 0.06', holm[2], 0.06);
}

// ════════════════════════════════════════════════════════════════════════════
// 14. 블록 부트스트랩 재현성 + 라벨 순열 비중 보존(§12)
// ════════════════════════════════════════════════════════════════════════════
{
  const plan: StatisticalPlan = {
    blockBootstrapBlockDays: 3,
    bootstrapIterations: 300,
    bootstrapSeed: 20260715,
    confidenceLevel: 0.95,
    permutationCount: 100,
    permutationSeed: 20260715,
    multipleComparison: 'HOLM',
  };
  const dA = [0.01, 0.02, -0.01, 0.03, 0.0, 0.01, -0.02, 0.02, 0.01, -0.01];
  const dB = [0.0, -0.01, 0.01, -0.02, 0.01, 0.0, 0.02, -0.01, 0.0, 0.01];
  const r1 = blockBootstrapInteraction(dA, dB, plan, 'US', 'hash123', 'PREREGISTERED_REPLICATION');
  const r2 = blockBootstrapInteraction(dA, dB, plan, 'US', 'hash123', 'PREREGISTERED_REPLICATION');
  check('부트스트랩 바이트 재현(동일 시드·입력)', JSON.stringify(r1), JSON.stringify(r2));
  checkClose('I 점추정 = mean(dA)-mean(dB)', r1.interactionI.pointEstimate, mean(dA) - mean(dB));
  check('부트스트랩 반복수 = 300', r1.interactionI.bootstrapIterations, 300);

  // 라벨 순열: 층별 A 개수 보존 + 복합 키(stratum::securityId) — Bug3.
  // ⚠ a1이 US:2020-04(A)와 US:2020-03(B)에 동시에 등장 — 예전엔 securityId만 키로 써서
  //    뒤 층이 앞 층을 덮어써 월 차원이 소실됐다. 이제 두 층 라벨이 독립적으로 살아남아야 한다.
  const units: LabelUnit[] = [
    { securityId: 'a1', stratum: 'US:2020-04', isA: true },
    { securityId: 'a2', stratum: 'US:2020-04', isA: true },
    { securityId: 'a3', stratum: 'US:2020-04', isA: true },
    { securityId: 'b1', stratum: 'US:2020-04', isA: false },
    { securityId: 'b2', stratum: 'US:2020-04', isA: false },
    { securityId: 'k1', stratum: 'KR:2020-04', isA: true },
    { securityId: 'k2', stratum: 'KR:2020-04', isA: false },
    // 교차 층: 같은 securityId 'a1'이 다른 월(US:2020-03)에 B로 존재(deterministic 단일멤버 층).
    { securityId: 'a1', stratum: 'US:2020-03', isA: false },
    { securityId: 'z1', stratum: 'US:2020-03', isA: true },
  ];
  const rng = mulberry32(plan.permutationSeed);
  const permuted = constrainedLabelPermutation(units, rng);
  const usA = ['a1', 'a2', 'a3', 'b1', 'b2'].filter((id) => permuted.get(labelKey('US:2020-04', id))).length;
  const krA = ['k1', 'k2'].filter((id) => permuted.get(labelKey('KR:2020-04', id))).length;
  const us0304A = ['a1', 'z1'].filter((id) => permuted.get(labelKey('US:2020-03', id))).length;
  check('US:2020-04 층 A 개수 보존 = 3', usA, 3);
  check('KR:2020-04 층 A 개수 보존 = 1', krA, 1);
  check('US:2020-03 층 A 개수 보존 = 1', us0304A, 1);
  // 교차 층 독립 보존: 두 층의 a1 키가 모두 존재(예전 버그는 한쪽만 남김).
  checkTrue('교차 층 a1: US:2020-04 키 존재', permuted.has(labelKey('US:2020-04', 'a1')));
  checkTrue('교차 층 a1: US:2020-03 키 존재', permuted.has(labelKey('US:2020-03', 'a1')));
  // 단일멤버 층은 결정론적: US:2020-03의 a1은 B(false), z1은 A(true).
  check('US:2020-03::a1 = false(B 보존)', permuted.get(labelKey('US:2020-03', 'a1')), false);
  check('US:2020-03::z1 = true(A 보존)', permuted.get(labelKey('US:2020-03', 'z1')), true);
  // 결정성: 같은 시드 → 같은 순열
  const permuted2 = constrainedLabelPermutation(units, mulberry32(plan.permutationSeed));
  check('라벨 순열 결정성', mapToObj(permuted), mapToObj(permuted2));
  // seededShuffle 결정성
  check(
    'seededShuffle 결정성',
    seededShuffle([1, 2, 3, 4, 5], mulberry32(7)),
    seededShuffle([1, 2, 3, 4, 5], mulberry32(7))
  );
}

function mapToObj(m: ReadonlyMap<string, boolean>): Record<string, boolean> {
  const o: Record<string, boolean> = {};
  for (const [k, v] of m) o[k] = v;
  return o;
}

// ════════════════════════════════════════════════════════════════════════════
// 15. 포트폴리오 드라이버 스모크 + 결정성(§10)
// ════════════════════════════════════════════════════════════════════════════
{
  const b1 = makeBars(
    'AAA',
    [15, 15, 15, 15, 15, 25, 19, 22, 24],
    [16, 16, 16, 16, 16, 30, 22, 24, 26],
    [14, 14, 14, 14, 14, 25, 17, 19, 21],
    [15, 15, 15, 15, 15, 28, 21, 23, 25]
  );
  const b2 = makeBars(
    'BBB',
    [15, 15, 15, 15, 15, 25, 19, 22, 24],
    [16, 16, 16, 16, 16, 30, 22, 24, 26],
    [14, 14, 14, 14, 14, 25, 17, 19, 21],
    [15, 15, 15, 15, 15, 28, 21, 23, 25]
  );
  const pCfg: PortfolioSimConfig = {
    strategyId: 'ADAPTIVE',
    entryLookback: (g) => (g === 'A' ? 3 : 3),
    exitLookback: 3,
    atrLookback: 3,
    stopMultiple: 2,
    commonStartBars: 4,
    fillDelayDays: 1,
    initialEquity: 1_000_000,
    riskPerTradePct: 0.5,
    totalRiskCapPct: 12,
    singleNameValueCapPct: 25,
    costTierByMarket: () => COST_NOTAX,
    costTier: 'BASE',
    slippageFrac: 0,
    closeMethod: 'FORCED_CLOSE',
    advCap: 0.05,
  };
  const secs = [
    { bars: b1, monthlyFlags: [mkFlag('AAA', '2020-01', 'A')] },
    { bars: b2, monthlyFlags: [mkFlag('BBB', '2020-01', 'B')] },
  ];
  const r1 = simulatePortfolio(secs, pCfg);
  const r2 = simulatePortfolio(secs, pCfg);
  checkTrue('포트폴리오 거래 발생', r1.trades.length >= 1);
  checkTrue('포트폴리오 자산곡선 비어있지 않음', r1.equityCurve.length > 0);
  check('포트폴리오 결정성(동일 입력 → 동일 결과)', r1.finalEquity, r2.finalEquity);
  check('포트폴리오 거래 로그 결정성', JSON.stringify(r1.trades), JSON.stringify(r2.trades));
}

// ════════════════════════════════════════════════════════════════════════════
// 15b. 【Bug1 골든】 pending-order 결제 — 날짜별 현금/자산 정확값(§9-4·§10)
//   신호일 → 체결일 → 보유일 → 청산신호일 → 청산체결일 전 구간에서 현금/자산이
//   "실제 체결일에만" 변하는지 손계산 절대값으로 검증. 이 버그가 재유입되면 즉시 실패.
// ════════════════════════════════════════════════════════════════════════════
{
  // 단일 종목 포트폴리오. 비용 ZERO·세금 없음 → 현금 산술이 정수로 정확.
  //  idx:      0   1   2   3   4   5    6    7    8    9    10   (dates 2020-01-01..-11)
  //  ATR·손절폭을 정수로 설계(TR5=14→ATR(3)=6→손절폭=12)해 사이징 부동소수 오차를 배제.
  const golden = makeBars(
    'AAA',
    [15, 15, 15, 15, 15, 25, 19, 22, 20, 12, 12],
    [16, 16, 16, 16, 16, 29, 22, 24, 22, 14, 13],
    [14, 14, 14, 14, 14, 25, 17, 19, 15, 9, 9],
    [15, 15, 15, 15, 15, 28, 21, 23, 16, 10, 10]
  );
  const gCfg: PortfolioSimConfig = {
    strategyId: 'ADAPTIVE',
    entryLookback: () => 3,
    exitLookback: 3,
    atrLookback: 3,
    stopMultiple: 2,
    commonStartBars: 4,
    fillDelayDays: 1,
    initialEquity: 1_000_000,
    riskPerTradePct: 0.5,
    totalRiskCapPct: 12,
    singleNameValueCapPct: 25,
    costTierByMarket: () => COST_NOTAX,
    costTier: 'ZERO',
    slippageFrac: 0,
    closeMethod: 'FORCED_CLOSE',
    advCap: 0.05,
  };
  const gOut = simulatePortfolio([{ bars: golden, monthlyFlags: [mkFlag('AAA', '2020-01', 'A')] }], gCfg);
  // 손계산: 신호 t=5(close28>채널 max(high[2,3,4])=16), TR5=max(29−25,|29−15|,|25−15|)=14,
  //   ATR(3)@5=(2+2+14)/3=6, fill=open[6]=19, stop=19−2×6=7, 손절폭=12,
  //   shares=floor(5000/12)=416, notional=416×19=7904.
  //   청산신호 t=8(close16<min(low[5,6,7])=17), 청산 fill=open[9]=12, 청산notional=416×12=4992.
  const eq = new Map<string, { equity: number; cash: number }>();
  for (const p of gOut.equityCurve) eq.set(p.date, { equity: p.equity, cash: p.cash });

  // 신호일(2020-01-06): 현금·자산 모두 불변(진입은 아직 미결제). ← 예전 버그면 여기서 현금 감소.
  check('신호일 현금 = 1,000,000(불변)', eq.get('2020-01-06')!.cash, 1_000_000);
  check('신호일 자산 = 1,000,000(불변)', eq.get('2020-01-06')!.equity, 1_000_000);
  // 체결일(2020-01-07): 현금 −7904, 자산 = 현금 + 416×close[6](21) = 992096+8736.
  check('체결일 현금 = 992,096', eq.get('2020-01-07')!.cash, 992_096);
  check('체결일 자산 = 1,000,832', eq.get('2020-01-07')!.equity, 1_000_832);
  // 보유일(2020-01-08): 현금 불변, 자산 = 992096 + 416×23 = 1,001,664.
  check('보유일 현금 = 992,096(불변)', eq.get('2020-01-08')!.cash, 992_096);
  check('보유일 자산 = 1,001,664', eq.get('2020-01-08')!.equity, 1_001_664);
  // 청산신호일(2020-01-09): 현금 불변(청산 미결제), 자산 = 992096 + 416×16 = 998,752.
  //   ← 예전 버그면 여기서 청산대금이 현금에 즉시 반영됨.
  check('청산신호일 현금 = 992,096(불변)', eq.get('2020-01-09')!.cash, 992_096);
  check('청산신호일 자산 = 998,752', eq.get('2020-01-09')!.equity, 998_752);
  // 청산체결일(2020-01-10): 현금 +4992 = 997,088, 보유 0 → 자산 = 현금.
  check('청산체결일 현금 = 997,088', eq.get('2020-01-10')!.cash, 997_088);
  check('청산체결일 자산 = 997,088', eq.get('2020-01-10')!.equity, 997_088);
  check('최종 자산 = 997,088', gOut.finalEquity, 997_088);
  // 거래 1건: 진입 19 → 청산 12, 사유 CHANNEL_EXIT, 그룹 A(월별 플래그 동결).
  check('골든 거래 1건', gOut.trades.length, 1);
  check('골든 진입가 19', gOut.trades[0].entryFill.fillPrice, 19);
  check('골든 청산가 12', gOut.trades[0].exitFill!.fillPrice, 12);
  check('골든 수량 416', gOut.trades[0].entryFill.quantity, 416);
  check('골든 청산사유 CHANNEL_EXIT', gOut.trades[0].exitReason, 'CHANNEL_EXIT');
  check('골든 그룹 A(동결)', gOut.trades[0].group, 'A');
}

// ════════════════════════════════════════════════════════════════════════════
// 15c. 【Bug2】 시총 결측 종목은 그룹 B로 흡수되지 않고 제외(unclassifiable)
// ════════════════════════════════════════════════════════════════════════════
{
  const ids = ['A1', 'A2', 'A3', 'A4', 'A5', 'MISS'];
  const capOf: Record<string, number> = { A1: 1000, A2: 800, A3: 600, A4: 400, A5: 200 };
  // MISS는 시가총액 레코드가 없음 → 해석 불가 → unclassifiable.
  const marketCaps: PointInTimeMarketCap[] = Object.entries(capOf).map(([id, cap]) => ({
    securityId: id,
    effectiveDate: '2020-03-31',
    sharesOutstanding: cap,
    closePrice: 1,
    marketCap: cap,
    currency: 'USD',
    isPointInTime: true,
  }));
  const sectors: PointInTimeSectorClassification[] = ids.map((id) => ({
    securityId: id,
    schemeName: 'GICS',
    schemeVersion: '2018',
    sectorCode: 'ALL',
    sectorName: 'ALL',
    effectiveStart: '2000-01-01',
    effectiveEnd: null,
    isPointInTime: true,
  }));
  const input: MonthlyClassificationInput = {
    market: 'US',
    asOfMonthEnd: '2020-03-31',
    investableSecurityIds: ids,
    marketCaps,
    sectors,
    largeCapPercentile: 80,
    leaderMinIndustrySize: 5,
  };
  const flags = computeMonthlyGroupFlags(input);
  const byId = new Map(flags.map((f) => [f.securityId, f]));

  check('MISS unclassifiable', byId.get('MISS')!.unclassifiable, true);
  check('MISS marketCap null', byId.get('MISS')!.marketCap, null);
  check('MISS large=false(제외)', byId.get('MISS')!.large, false);
  check('MISS leader=false(제외)', byId.get('MISS')!.leader, false);
  // 분류가능 종목은 unclassifiable=false. A1=large+leader(rank1·업종5명 1위) → A.
  check('A1 unclassifiable=false', byId.get('A1')!.unclassifiable, false);
  check('A1 그룹 A', byId.get('A1')!.group, 'A');
  // "B로 흡수 금지": 분류가능 B는 A2..A5 = 4개, MISS는 그중에 없음.
  const classifiableB = flags.filter((f) => !f.unclassifiable && f.group === 'B').map((f) => f.securityId);
  check('분류가능 B = [A2,A3,A4,A5](MISS 미포함)', classifiableB.sort(), ['A2', 'A3', 'A4', 'A5']);
  // 완전 분할 검증은 unclassifiable을 제외하고도 통과해야 함(B 오염 없음).
  check('완전 분할 통과(unclassifiable 제외)', checkFullPartition(flags, ids), []);
  // 동결 해석: MISS는 진입월에도 group=null(제외), resolveFrozenGroup도 null.
  const cls = resolveFrozenClassification(flags, 'MISS', '2020-04-15');
  check('MISS 동결 hasFlag=true', cls.hasFlag, true);
  check('MISS 동결 unclassifiable=true', cls.unclassifiable, true);
  check('MISS 동결 group=null', cls.group, null);
  check('MISS resolveFrozenGroup=null(제외)', resolveFrozenGroup(flags, 'MISS', '2020-04-15'), null);
  // A1은 정상 분류 → 진입월 A.
  check('A1 resolveFrozenGroup=A', resolveFrozenGroup(flags, 'A1', '2020-04-15'), 'A');
}

// ════════════════════════════════════════════════════════════════════════════
// 15d. 【Bug2】 시뮬레이터가 진입 시점 월별 플래그로 그룹을 해석·동결(정적 group 아님)
// ════════════════════════════════════════════════════════════════════════════
{
  // 월 경계 종목: 2020-01 진입, 2020-02까지 보유. 월별 플래그가 1월=A, 2월=B로 다름.
  const dates = [
    '2020-01-27', '2020-01-28', '2020-01-29', '2020-01-30', '2020-01-31',
    '2020-02-03', '2020-02-04', '2020-02-05', '2020-02-06', '2020-02-07',
  ];
  //  idx:   0   1   2   3   4   5   6   7   8   9
  const span = makeBarsDates(
    'SPAN',
    dates,
    [10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
    [10, 10, 20, 12, 12, 12, 12, 12, 12, 12],
    [9, 9, 9, 9, 9, 9, 9, 9, 9, 9],
    [10, 10, 18, 11, 11, 11, 11, 11, 11, 11]
  );
  // 월별 플래그: 1월 A(large), 2월 B. 진입은 1월(t=2, 2020-01-29) → 그룹 A로 동결돼야 함.
  const spanFlags: MonthlyGroupFlags[] = [
    mkFlag('SPAN', '2020-01', 'A'),
    mkFlag('SPAN', '2020-02', 'B'),
  ];
  // 그룹 민감 전략(A→2, B→5). 정적/2월 플래그를 잘못 쓰면 그룹·룩백이 달라짐.
  const cfg: PortfolioSimConfig = {
    strategyId: 'ADAPTIVE',
    entryLookback: (g) => (g === 'A' ? 2 : 5),
    exitLookback: 3,
    atrLookback: 2,
    stopMultiple: 2,
    commonStartBars: 2,
    fillDelayDays: 1,
    initialEquity: 1_000_000,
    riskPerTradePct: 0.5,
    totalRiskCapPct: 12,
    singleNameValueCapPct: 25,
    costTierByMarket: () => COST_NOTAX,
    costTier: 'ZERO',
    slippageFrac: 0,
    closeMethod: 'FORCED_CLOSE',
    advCap: 0.05,
  };
  const out = simulatePortfolio([{ bars: span, monthlyFlags: spanFlags }], cfg);
  check('월경계 거래 1건', out.trades.length, 1);
  // 진입 1월 → 그룹 A 동결(2월 플래그가 B여도 유지).
  check('진입 그룹 A(1월 플래그로 동결)', out.trades[0].group, 'A');
  check('진입 신호 그룹 A', out.trades[0].entrySignal.group, 'A');
  // 그룹 A의 진입 룩백 2가 쓰였음(B였다면 5).
  check('진입 룩백 = 2(그룹 A)', out.trades[0].entrySignal.entryLookbackUsed, 2);
  check('진입일 = 2020-01-30(t=2 신호의 익일)', out.trades[0].entryFill.fillDate, '2020-01-30');
  // 대조: 2월 진입이었다면 그룹 B였을 것(월별 해석이 실제로 다름을 확인).
  check('대조: 2월 동결 그룹 B', resolveFrozenClassification(spanFlags, 'SPAN', '2020-02-05').group, 'B');
}

// ════════════════════════════════════════════════════════════════════════════
// 15e. 【휴장일 평가 버그】 그 날 바 없는 종목은 진입가가 아니라 마지막 유효 종가로 평가
//   GAP 종목은 2020-01-05를 건너뛴다(자기 배열엔 그 날짜가 없음). FULL 종목은 매일 거래하며
//   포트폴리오 합집합 달력에 01-05를 밀어넣는 역할만 한다(신호는 절대 내지 않음).
//   GAP은 01-04에 체결해 보유 중 01-05를 맞는다 — 이 날 진입가(20)로 근사하면 자산이
//   허위로 변하고, 마지막 종가(01-04 종가=21)로 carry-forward하면 자산이 그대로다.
// ════════════════════════════════════════════════════════════════════════════
{
  const gapBars = makeBarsDates(
    'GAP',
    ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-04', '2020-01-06'],
    [10, 10, 10, 20, 21],
    [11, 11, 12, 22, 23],
    [9, 9, 9, 19, 20],
    [10, 10, 15, 21, 25]
  );
  const fullBars = makeBarsDates(
    'FULL',
    ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-04', '2020-01-05', '2020-01-06'],
    [10, 10, 10, 10, 10, 10],
    [11, 11, 11, 11, 11, 11],
    [9, 9, 9, 9, 9, 9],
    [10, 10, 10, 10, 10, 10] // close(10)<=high lookback max(11) 항상 → 무신호(대조군 전용)
  );
  const gapCfg: PortfolioSimConfig = {
    strategyId: 'ALL_20', // 그룹 무관(A/B 룩백 동일) — 이 테스트의 관심사가 아님
    entryLookback: () => 2,
    exitLookback: 50, // 이 짧은 구간에서 채널청산 미발동
    atrLookback: 2,
    stopMultiple: 100, // 손절 미발동(오직 휴장일 평가만 검증)
    commonStartBars: 2,
    fillDelayDays: 1,
    initialEquity: 1_000_000,
    riskPerTradePct: 0.5,
    totalRiskCapPct: 12,
    singleNameValueCapPct: 25,
    costTierByMarket: () => COST_NOTAX,
    costTier: 'ZERO',
    slippageFrac: 0,
    closeMethod: 'FORCED_CLOSE',
    advCap: 0.05,
  };
  const gapOut = simulatePortfolio(
    [
      { bars: gapBars, monthlyFlags: [mkFlag('GAP', '2020-01', 'A')] },
      { bars: fullBars, monthlyFlags: [mkFlag('FULL', '2020-01', 'A')] },
    ],
    gapCfg
  );
  // 손계산: 신호 t=2(close15>max(high[0],high[1])=11), TR1=max(11-9,|11-10|,|9-10|)=2,
  //   TR2=max(12-9,|12-10|,|9-10|)=3, ATR(2)@2=(2+3)/2=2.5, 손절폭=2.5×100=250,
  //   위험5000/250=20주. fill=open[3]=20(01-04), notional=20×20=400.
  const geq = new Map<string, number>();
  for (const p of gapOut.equityCurve) geq.set(p.date, p.equity);
  check('체결일(01-04) 자산 = 1,000,020(현금999,600+20×종가21)', geq.get('2020-01-04'), 1_000_020);
  // 01-05: GAP 배열엔 없는 날짜. 마지막 유효 종가(01-04 종가=21)로 carry-forward돼야
  // 자산이 전일과 같아야 한다. 진입가(20)로 근사했다면 1,000,000으로 떨어졌을 것(구버그).
  check('휴장일(01-05) 자산 = 1,000,020(마지막 종가 carry-forward, 진입가 아님)', geq.get('2020-01-05'), 1_000_020);
  checkTrue('휴장일 자산이 진입가 근사값(1,000,000)이 아님(구버그 회귀 방지)', geq.get('2020-01-05') !== 1_000_000);
  check('재개일(01-06) 자산 = 1,000,100(종가25로 정상 재평가)', geq.get('2020-01-06'), 1_000_100);
}

// ════════════════════════════════════════════════════════════════════════════
// 16. 보고서 포매터 — 합성 결과로 §17 구조 확인(실 REPORT 미생성)
// ════════════════════════════════════════════════════════════════════════════
{
  const md = formatReport({
    header: {
      verdict: 'INCONCLUSIVE',
      oneSentenceAnswer: '데이터 게이트 FAIL로 판단 불가.',
      evidenceGrade: 'EXPLORATORY',
      dataAsOf: null,
      configHash: 'abc123',
      interaction: [],
      adoptionGates: [],
      keyLimitationsAndNextActions: 'point-in-time 데이터 확보 필요.',
      dataGate: {
        hypothesisId: 'conditional-channel-v1',
        auditedAt: '2026-07-15T00:00:00.000Z',
        manifest: { hypothesisId: 'x', generatedAt: '2026-07-15T00:00:00.000Z', sources: [], rawDataDir: 'd', recreateInstructions: 'r' },
        conditions: [],
        metConditionIds: ['RETROACTIVE_TICKER_LIST'],
        verdict: 'FAIL',
        requiredExternalInputs: [],
        auditScopeNote: 'scope',
      },
    },
    body: {
      dataLineageAndQa: '계보',
      universeDefinition: '종목군',
      executionRules: '실행규칙',
      performance: [],
      costComparison: [],
      robustness: [],
      concentration: '집중도',
      exclusions: [],
      reproduction: '재현',
    },
  });
  checkTrue('보고서: 판정 헤더 포함', md.includes('## 판정: INCONCLUSIVE'));
  checkTrue('보고서: 한 문장 답 포함', md.includes('한 문장 답'));
  checkTrue('보고서: 증거 등급 포함', md.includes('증거 등급'));
  checkTrue('보고서: 채택 게이트 포함', md.includes('채택 게이트'));
  checkTrue('보고서: Phase 0 게이트 FAIL 명시', md.includes('DATA_GAP'));
  checkTrue('보고서: 게이트 FAIL 상태', md.includes('**FAIL**'));
}

// ── 분류기 테스트용 합성 종목군 ──────────────────────────────────────────────
function buildUniverse10(asOfMonthEnd: string): MonthlyClassificationInput {
  const ids = ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10'];
  const caps = [1000, 900, 800, 700, 600, 500, 400, 300, 200, 100];
  const marketCaps: PointInTimeMarketCap[] = ids.map((id, i) => ({
    securityId: id,
    effectiveDate: asOfMonthEnd,
    sharesOutstanding: caps[i],
    closePrice: 1,
    marketCap: caps[i],
    currency: 'USD',
    isPointInTime: true,
  }));
  const sectorOf: Record<string, string> = {
    S01: 'MEGA', S02: 'MEGA',
    S03: 'TECH', S05: 'TECH', S07: 'TECH', S09: 'TECH', S10: 'TECH',
    S04: 'FIN', S06: 'FIN', S08: 'FIN',
  };
  const sectors: PointInTimeSectorClassification[] = ids.map((id) => ({
    securityId: id,
    schemeName: 'GICS',
    schemeVersion: '2018',
    sectorCode: sectorOf[id],
    sectorName: sectorOf[id],
    effectiveStart: '2000-01-01',
    effectiveEnd: null,
    isPointInTime: true,
  }));
  return {
    market: 'US',
    asOfMonthEnd,
    investableSecurityIds: ids,
    marketCaps,
    sectors,
    largeCapPercentile: 80,
    leaderMinIndustrySize: 5,
  };
}

function buildUniverseTie(): MonthlyClassificationInput {
  const ids = ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10'];
  // S02·S03 시총 동일(900) — 경계(rank2/3)에서 tie-break 검증
  const caps = [1000, 900, 900, 700, 600, 500, 400, 300, 200, 100];
  const marketCaps: PointInTimeMarketCap[] = ids.map((id, i) => ({
    securityId: id,
    effectiveDate: '2020-03-31',
    sharesOutstanding: caps[i],
    closePrice: 1,
    marketCap: caps[i],
    currency: 'USD',
    isPointInTime: true,
  }));
  const sectors: PointInTimeSectorClassification[] = ids.map((id) => ({
    securityId: id,
    schemeName: 'GICS',
    schemeVersion: '2018',
    sectorCode: 'ALL',
    sectorName: 'ALL',
    effectiveStart: '2000-01-01',
    effectiveEnd: null,
    isPointInTime: true,
  }));
  return {
    market: 'US',
    asOfMonthEnd: '2020-03-31',
    investableSecurityIds: ids,
    marketCaps,
    sectors,
    largeCapPercentile: 80,
    leaderMinIndustrySize: 5,
  };
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ conditionalChannel 백테스트 테스트 실패 (${fails.length})`);
  fails.forEach((f) => console.error('  ' + f));
  console.error(`\n통과 ${pass} / 실패 ${fails.length}`);
  process.exit(1);
} else {
  console.log(`✅ conditionalChannel 백테스트 테스트 전체 통과 (${pass} 단언)`);
}
