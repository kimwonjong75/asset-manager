// tests/portfolioTurtleParity.ts
// portfolio-turtle-v1 골든·불변식 테스트. 오프라인·합성 데이터 전용(실사용자 데이터 없음)·빠름(<3초).
// 실행: npx tsx tests/portfolioTurtleParity.ts

import { classifyScope, isIndexTrackingName } from '../scripts/backtest/portfolioTurtle/classification';
import {
  riskFormulaQty, roundQty, sizeFixedUnitCapDiv, sizeFixedUnitNoCap, sizeUnitWithRoom, SizingContext,
} from '../scripts/backtest/portfolioTurtle/sizing';
import {
  checkEntrySignal, checkExitSignal, initTrailState, isWarmedUp, TrailState, updateTrailState,
} from '../scripts/backtest/portfolioTurtle/exitRules';
import {
  median, percentile, periodBucketOfStart, recoveryDays, incrementalContributions, maxContributorConcentration,
} from '../scripts/backtest/portfolioTurtle/metrics';
import { buildSecurityIndicators, PortfolioSecurity, fxAt } from '../scripts/backtest/portfolioTurtle/data';
import { buildInitialHoldings, simulatePortfolio, PortfolioRunResult, CompletedTradeRecord } from '../scripts/backtest/portfolioTurtle/engine';
import type { StartRunEntry } from '../scripts/backtest/portfolioTurtle/metrics';
import { checkCreateGuard, checkFillGuard } from '../scripts/backtest/freshTurtleLifecycle/engine';
import type { SymbolSeries } from '../scripts/backtest/lib/fetchHistory';
import type { FxTable } from '../scripts/backtest/lib/fx';

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  if (Object.is(actual, expected)) pass++;
  else { fail++; console.error(`  ✗ ${name}\n      기대=${String(expected)} 실제=${String(actual)}`); }
}
function checkClose(name: string, actual: number, expected: number, tol = 1e-6): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) pass++;
  else { fail++; console.error(`  ✗ ${name}\n      기대=${expected} 실제=${actual} (tol ${tol})`); }
}
function checkTrue(name: string, v: boolean): void { check(name, v, true); }
function checkThrows(name: string, fn: () => void): void {
  try { fn(); fail++; console.error(`  ✗ ${name}\n      기대=throw 실제=정상반환`); }
  catch { pass++; }
}

console.log('portfolio-turtle-v1 골든·불변식 테스트\n');

// ── 합성 데이터 헬퍼 ─────────────────────────────────────────────────────
function iso(i: number): string {
  return new Date(Date.parse('2024-01-01T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10);
}

interface Bar { o: number; h: number; l: number; c: number }
function mkSeries(ticker: string, bars: Bar[]): SymbolSeries {
  return {
    symbol: ticker, dates: bars.map((_, i) => iso(i)),
    open: bars.map(b => b.o), high: bars.map(b => b.h), low: bars.map(b => b.l), close: bars.map(b => b.c),
    ok: true,
  };
}

function buildTestSec(params: {
  ticker: string; bars: Bar[]; currency?: 'KRW' | 'USD' | 'JPY'; isCrypto?: boolean; isKrEtf?: boolean;
  weightPct?: number; scopeClass?: 'SATELLITE_TURTLE' | 'CORE_EXCL_BH';
}): PortfolioSecurity {
  const raw = mkSeries(params.ticker, params.bars);
  return buildSecurityIndicators({
    ticker: params.ticker, name: params.ticker, assetClass: '한국주식',
    currency: params.currency ?? 'KRW', isCryptoTicker: params.isCrypto ?? false, isKrEtf: params.isKrEtf ?? false,
    weightPct: params.weightPct ?? 1, scopeClass: params.scopeClass ?? 'SATELLITE_TURTLE',
    raw, calendar: raw.dates,
  });
}

const EMPTY_FX: FxTable = { usdKrw: [], jpyKrw: [] };

// ════════════════════════════════════════════════════════════════════════════
console.log('1. classification — S-CORE-EXCL 적용범위 분류');
// ════════════════════════════════════════════════════════════════════════════
{
  check('실물자산 → CORE_EXCL_BH', classifyScope({ ticker: 'GLD', name: 'GLD', assetClass: '실물자산', isKrEtf: false }), 'CORE_EXCL_BH');
  check('한국채권 → CORE_EXCL_BH', classifyScope({ ticker: '148070', name: '국고채30년', assetClass: '한국채권', isKrEtf: true }), 'CORE_EXCL_BH');
  check('미국채권 → CORE_EXCL_BH', classifyScope({ ticker: 'TLT', name: 'iShares 20+ Year Treasury', assetClass: '미국채권', isKrEtf: false }), 'CORE_EXCL_BH');
  check('개별주(한국주식) → SATELLITE_TURTLE', classifyScope({ ticker: '005380', name: '현대차', assetClass: '한국주식', isKrEtf: false }), 'SATELLITE_TURTLE');
  check('KODEX 200(지수추종 ETF) → CORE_EXCL_BH', classifyScope({ ticker: '069500', name: 'KODEX 200', assetClass: '한국주식', isKrEtf: true }), 'CORE_EXCL_BH');
  check('TIGER 반도체(비지수 ETF) → SATELLITE_TURTLE', classifyScope({ ticker: '091230', name: 'TIGER 반도체', assetClass: '한국주식', isKrEtf: true }), 'SATELLITE_TURTLE');
  check('SPY(지수 ETF 티커) → CORE_EXCL_BH', classifyScope({ ticker: 'SPY', name: 'SPDR S&P 500', assetClass: '미국주식', isKrEtf: false }), 'CORE_EXCL_BH');
  check('개별주(미국주식) → SATELLITE_TURTLE', classifyScope({ ticker: 'AAPL', name: 'Apple Inc', assetClass: '미국주식', isKrEtf: false }), 'SATELLITE_TURTLE');
  checkTrue('이름에 코스피 포함 → 지수추종', isIndexTrackingName('KODEX 코스피'));
  checkTrue('이름에 200 포함 → 지수추종', isIndexTrackingName('TIGER 200'));
  checkTrue('반도체는 지수추종 아님', !isIndexTrackingName('TIGER 반도체'));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('2. sizing — B/G/A/C 사이징 공식');
// ════════════════════════════════════════════════════════════════════════════
{
  // riskFormulaQty: equity 1억, risk 1% → riskAmount 100만, N=100 → qty=10000
  checkClose('riskFormulaQty 기본', riskFormulaQty({ equityKRW: 100_000_000, riskPerUnitPct: 1, positionCapPct: null, maxUnits: 1 }, 100, 1), 10000, 1e-9);
  check('riskFormulaQty N<=0 → 0', riskFormulaQty({ equityKRW: 100_000_000, riskPerUnitPct: 1, positionCapPct: null, maxUnits: 1 }, 0, 1), 0);
  check('riskFormulaQty equity<=0 → 0', riskFormulaQty({ equityKRW: 0, riskPerUnitPct: 1, positionCapPct: null, maxUnits: 1 }, 100, 1), 0);

  // sizeUnitWithRoom — 상한 없음(C 방식과 동일 공식): 그대로 리스크공식
  const ctxNoCap: SizingContext = { equityKRW: 100_000_000, riskPerUnitPct: 1, positionCapPct: null, maxUnits: 1 };
  const rNoCap = sizeUnitWithRoom(ctxNoCap, 100, 100_000, 1, 0);
  checkClose('상한 없음 → 리스크공식 그대로', rNoCap.qty, 10000, 1e-9);
  checkTrue('상한 없음 → cappedByPosition=false', !rNoCap.cappedByPosition);

  // sizeUnitWithRoom — 상한 10%, 리스크공식이 상한보다 훨씬 큰 경우(B 전형적 사례)
  const ctxCap: SizingContext = { equityKRW: 100_000_000, riskPerUnitPct: 1, positionCapPct: 10, maxUnits: 1 };
  // capKRW=10,000,000, room(existing=0)=10,000,000, price=100,000 → qtyCap=100
  // riskAmount=1,000,000, N=100 → qtyRisk=10,000(≫100) → 상한 구속
  const rCap = sizeUnitWithRoom(ctxCap, 100, 100_000, 1, 0);
  checkClose('상한 구속 시 qty=상한÷가격', rCap.qty, 100, 1e-9);
  checkTrue('상한 구속 시 cappedByPosition=true', rCap.cappedByPosition);

  // sizeUnitWithRoom — 기존 포지션이 있어 room이 줄어드는 경우(A의 2번째 유닛)
  const rRoom = sizeUnitWithRoom(ctxCap, 100, 100_000, 1, 6_000_000); // room=4,000,000 → qtyCap=40
  checkClose('기존 포지션 반영 시 room 감소', rRoom.qty, 40, 1e-9);

  // sizeFixedUnitCapDiv(G) — 유닛=min(리스크공식, 상한÷maxUnits). maxUnits=4 → perUnitCap=2,500,000 → qtyCap=25
  const ctxG: SizingContext = { equityKRW: 100_000_000, riskPerUnitPct: 1, positionCapPct: 10, maxUnits: 4 };
  const rG = sizeFixedUnitCapDiv(ctxG, 100, 100_000, 1);
  checkClose('G: 유닛=상한÷4÷가격(상한 구속)', rG.qty, 25, 1e-9);
  checkTrue('G: cappedByPosition=true', rG.cappedByPosition);
  // N이 아주 커서 리스크공식이 상한÷4보다 작은 경우 — 리스크공식이 이김
  const rG2 = sizeFixedUnitCapDiv(ctxG, 100_000, 100_000, 1); // riskAmount=1,000,000, N=100,000 → qtyRisk=10; qtyCap=25
  checkClose('G: 리스크공식이 더 작으면 그대로', rG2.qty, 10, 1e-9);
  checkTrue('G: 리스크공식 승리 시 cappedByPosition=false', !rG2.cappedByPosition);

  // sizeFixedUnitNoCap(C) — 리스크공식 그대로, 상한 무시
  const ctxC: SizingContext = { equityKRW: 100_000_000, riskPerUnitPct: 1, positionCapPct: null, maxUnits: 4 };
  const rC = sizeFixedUnitNoCap(ctxC, 100, 1);
  checkClose('C: 리스크공식 그대로(상한 없음)', rC.qty, 10000, 1e-9);
  checkTrue('C: cappedByPosition=false', !rC.cappedByPosition);

  // roundQty
  check('roundQty 비코인 내림', roundQty(12.9, false), 12);
  checkClose('roundQty 코인 1e-8 내림', roundQty(0.123456789, true), 0.12345678, 1e-12);
  check('roundQty 0 이하 → 0', roundQty(0, false), 0);
  check('roundQty 음수 → 0', roundQty(-5, false), 0);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('3. exitRules — W1~W4 청산 판정·재진입·워밍업');
// ════════════════════════════════════════════════════════════════════════════
{
  // 최소한의 합성 지표로 채운 가짜 PortfolioSecurity — 순수 로직만 검증(파이프라인 우회)
  function fakeSec(overrides: Partial<PortfolioSecurity>): PortfolioSecurity {
    const n = 10;
    const base: PortfolioSecurity = {
      ticker: 'X', name: 'X', assetClass: '한국주식', currency: 'KRW', isCryptoTicker: false, isKrEtf: false,
      weightPct: 1, scopeClass: 'SATELLITE_TURTLE', excludedRows: [],
      ownDates: Array.from({ length: n }, (_, i) => iso(i)),
      ownOpen: new Array(n).fill(100), ownHigh: new Array(n).fill(100), ownLow: new Array(n).fill(100), ownClose: new Array(n).fill(100),
      atr: new Array(n).fill(null), highChannel55: new Array(n).fill(null), lowChannel20: new Array(n).fill(null),
      lowChannel55: new Array(n).fill(null), sma50: new Array(n).fill(null),
      ownIdxOfCal: Array.from({ length: n }, (_, i) => i), calIdxOfOwn: Array.from({ length: n }, (_, i) => i),
      closeForValuation: new Array(n).fill(100),
    };
    return { ...base, ...overrides };
  }

  // W1/W2 도치안 — 경계값(<=)
  const secDon = fakeSec({ lowChannel20: [null, 100, 100, 100, 100, 100, 100, 100, 100, 100], ownClose: [100, 100, 99, 101, 100, 100, 100, 100, 100, 100] });
  checkTrue('W1: 종가==채널 → 청산(경계 포함)', checkExitSignal({ method: 'donchian', lookback: 20, currentBarExcluded: true }, secDon, 1, null));
  checkTrue('W1: 종가<채널 → 청산', checkExitSignal({ method: 'donchian', lookback: 20, currentBarExcluded: true }, secDon, 2, null));
  checkTrue('W1: 종가>채널 → 청산 아님', !checkExitSignal({ method: 'donchian', lookback: 20, currentBarExcluded: true }, secDon, 3, null));
  checkThrows('도치안 지원하지 않는 lookback → throw', () => checkExitSignal({ method: 'donchian', lookback: 30, currentBarExcluded: true }, secDon, 3, null));

  // W3 ATR 트레일링 — 래칫(하향 금지)
  const secTrail = fakeSec({
    ownHigh: [110, 120, 130, 115, 100, 100, 100, 100, 100, 100],
    ownClose: [108, 118, 125, 112, 95, 100, 100, 100, 100, 100],
    atr: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
  });
  let trail: TrailState = initTrailState(secTrail, 0, 3); // runningHigh=110, trail=110-15=95
  checkClose('트레일 초기화: runningHigh', trail.runningHigh, 110, 1e-9);
  checkClose('트레일 초기화: trailStop=110-3*5', trail.trailStop, 95, 1e-9);
  trail = updateTrailState(trail, secTrail, 1, 3); // high=120 → runningHigh=120, trail=105
  checkClose('트레일 갱신(상향): runningHigh=120', trail.runningHigh, 120, 1e-9);
  checkClose('트레일 갱신(상향): trailStop=120-15=105', trail.trailStop, 105, 1e-9);
  trail = updateTrailState(trail, secTrail, 2, 3); // high=130 → runningHigh=130, trail=115
  trail = updateTrailState(trail, secTrail, 3, 3); // high=115(하락) → runningHigh 유지 130, trail=130-15=115(불변)
  checkClose('트레일 갱신(고가 하락) — runningHigh 하향 금지', trail.runningHigh, 130, 1e-9);
  checkClose('트레일 갱신(고가 하락) — trailStop 하향 금지(그대로 115)', trail.trailStop, 115, 1e-9);
  checkTrue('W3: 종가(95)<=트레일(115) → 청산', checkExitSignal({ method: 'atrTrailing', atrPeriod: 20, multiple: 3 }, secTrail, 4, trail));
  checkTrue('W3: trail=null이면 청산 아님(가드)', !checkExitSignal({ method: 'atrTrailing', atrPeriod: 20, multiple: 3 }, secTrail, 4, null));

  // W4 이동평균 — 당일 포함(SMA에 오늘 종가가 이미 반영된 값을 그대로 비교)
  const secMa = fakeSec({ sma50: [null, null, 100, 100, 100, 100, 100, 100, 100, 100], ownClose: [100, 100, 100, 99, 101, 100, 100, 100, 100, 100] });
  checkTrue('W4: 종가<=SMA50(당일 포함) → 청산', checkExitSignal({ method: 'smaCross', period: 50, currentBarIncluded: true }, secMa, 3, null));
  checkTrue('W4: 종가>SMA50 → 청산 아님', !checkExitSignal({ method: 'smaCross', period: 50, currentBarIncluded: true }, secMa, 4, null));

  // 재진입(55일 신고가 돌파)
  const secEntry = fakeSec({ highChannel55: [null, 100, 100, 100, 100, 100, 100, 100, 100, 100], ownClose: [100, 100, 99, 100, 101, 100, 100, 100, 100, 100] });
  checkTrue('재진입: 종가==채널(경계 포함)', checkEntrySignal(secEntry, 3));
  checkTrue('재진입: 종가>채널', checkEntrySignal(secEntry, 4));
  checkTrue('재진입: 종가<채널 → 아님', !checkEntrySignal(secEntry, 2));

  // isWarmedUp — 전 지표 유효해야
  const secWarm = fakeSec({
    atr: [null, 1, 1, 1, 1, 1, 1, 1, 1, 1], highChannel55: [null, 100, 100, 100, 100, 100, 100, 100, 100, 100],
    lowChannel20: [null, 100, 100, 100, 100, 100, 100, 100, 100, 100], sma50: [null, null, 100, 100, 100, 100, 100, 100, 100, 100],
  });
  checkTrue('워밍업 미충족(atr null) → false', !isWarmedUp({ method: 'donchian', lookback: 20, currentBarExcluded: true }, secWarm, 0));
  checkTrue('워밍업 충족(도치안) → true', isWarmedUp({ method: 'donchian', lookback: 20, currentBarExcluded: true }, secWarm, 2));
  checkTrue('워밍업: smaCross는 sma50도 요구(sma50 null인 index1은 미충족)', !isWarmedUp({ method: 'smaCross', period: 50, currentBarIncluded: true }, secWarm, 1));
  checkTrue('워밍업: smaCross도 sma50 유효하면 충족', isWarmedUp({ method: 'smaCross', period: 50, currentBarIncluded: true }, secWarm, 2));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('4. metrics — recoveryDays·median·percentile·periodBucket');
// ════════════════════════════════════════════════════════════════════════════
{
  const dates = ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-04', '2020-01-05', '2020-01-06', '2020-01-07'];
  const curve = [100, 120, 90, 80, 110, 121, 130]; // 고점120(idx1) 저점80(idx3) 회복(idx5, 121>=120)
  checkClose('recoveryDays: 고점→회복 4일', recoveryDays(dates, curve) as number, 4, 1e-9);
  checkClose('recoveryDays: 낙폭 없음 → 0', recoveryDays(['2020-01-01', '2020-01-02'], [100, 101]) as number, 0, 1e-9);
  check('recoveryDays: 끝까지 미회복 → null', recoveryDays(['2020-01-01', '2020-01-02', '2020-01-03'], [100, 50, 60]), null);

  checkClose('median 홀수', median([1, 3, 2]), 2, 1e-12);
  checkClose('median 짝수(평균)', median([1, 2, 3, 4]), 2.5, 1e-12);
  checkClose('percentile p0', percentile([5, 1, 3], 0), 1, 1e-12);
  checkClose('percentile p1', percentile([5, 1, 3], 1), 5, 1e-12);

  check('periodBucketOfStart 2019 → 2016-2019', periodBucketOfStart('2019-06'), '2016-2019');
  check('periodBucketOfStart 2020 → 2020-2022', periodBucketOfStart('2020-01'), '2020-2022');
  check('periodBucketOfStart 2023 → 2023-present', periodBucketOfStart('2023-01'), '2023-present');

  // incrementalContributions·maxContributorConcentration — 종목별 증분손익 집중도(§13-2 BTC 교훈과 동일 정의)
  function fakeRun(trades: CompletedTradeRecord[]): PortfolioRunResult {
    return {
      dates: [], equityCurve: [], finalEquityKRW: 0, years: 0, cagr: 0, mdd: 0, calmar: 0,
      totalReentryFills: 0, totalSellFills: 0, completedRoundTrips: 0, totalCostKRW: 0, lambdaScaleDays: 0,
      maxConcurrentReentered: 0, avgCashPct: 0, trades,
      invariants: {
        negativeCash: 0, positionCapBreach: 0, totalRiskBreach: 0, maxUnitsBreach: 0,
        duplicatePosition: 0, duplicateOrder: 0, sameBarFill: 0, holidayFill: 0,
      },
    };
  }
  function tr(ticker: string, pnlKRW: number): CompletedTradeRecord {
    return { ticker, assetClass: '한국주식', kind: 'reentered', openedDate: '', closedDate: '', exitReason: 'exit', qty: 0, exitPriceLocal: 0, pnlKRW, rMultiple: 0 };
  }
  const variantEntries: StartRunEntry[] = [{
    startYyyyMm: '2020-01', turtle: fakeRun([tr('BTC', 1000), tr('AAPL', 100)]), bh: fakeRun([]), sellOnly: fakeRun([]),
  }];
  const baselineEntries: StartRunEntry[] = [{
    startYyyyMm: '2020-01', turtle: fakeRun([tr('BTC', 0), tr('AAPL', 0)]), bh: fakeRun([]), sellOnly: fakeRun([]),
  }];
  const contribs = incrementalContributions(variantEntries, baselineEntries);
  checkClose('BTC 증분손익 = 1000', contribs.find(c => c.ticker === 'BTC')?.incrementalPnlKRW as number, 1000, 1e-9);
  const conc = maxContributorConcentration(contribs)!;
  check('최대기여종목 = BTC', conc.ticker, 'BTC');
  checkClose('집중도 = 1000/(1000+100) = 0.909...', conc.shareOfTotal, 1000 / 1100, 1e-9);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('5. buildInitialHoldings — 워밍업 제외·비중 재정규화·FX');
// ════════════════════════════════════════════════════════════════════════════
{
  // 60일치 오름세 바 — ATR20·채널55·SMA50 워밍업 충분(>=55).
  function risingBars(n: number, base: number): Bar[] {
    return Array.from({ length: n }, (_, i) => ({ o: base + i, h: base + i, l: base + i, c: base + i }));
  }
  const secOk = buildTestSec({ ticker: 'OK', bars: risingBars(60, 100), weightPct: 0.5 });
  const secShort = buildTestSec({ ticker: 'SHORT', bars: risingBars(10, 100), weightPct: 0.5 }); // 워밍업 미달(10일뿐)

  const initial = buildInitialHoldings([secOk, secShort], EMPTY_FX, 59, 100_000_000, () => true);
  check('워밍업 미달 종목 제외', initial.excludedTickers.length, 1);
  check('제외 사유', initial.excludedTickers[0]?.reason, 'no-warmup');
  checkTrue('워밍업 충족 종목만 포함', initial.perTicker.has('OK') && !initial.perTicker.has('SHORT'));
  // 재정규화: SHORT(0.5) 제외 후 OK가 비중 100% 흡수 → 전액 배분
  const okHolding = initial.perTicker.get('OK')!;
  checkClose('재정규화 후 전액 배분(반올림 오차 이내)', okHolding.valueKRW, 100_000_000, 200);

  // FX 환산 — USD 종목, 환율 1300
  const secUsd = buildTestSec({ ticker: 'USDX', bars: risingBars(60, 100), currency: 'USD', weightPct: 1 });
  const fxTable: FxTable = { usdKrw: new Array(60).fill(1300), jpyKrw: new Array(60).fill(null) };
  check('fxAt: USD 환율 조회', fxAt('USD', fxTable, 59), 1300);
  check('fxAt: KRW은 항상 1', fxAt('KRW', fxTable, 59), 1);
  const initialUsd = buildInitialHoldings([secUsd], fxTable, 59, 130_000_000, () => true);
  const usdHolding = initialUsd.perTicker.get('USDX')!;
  // price=159(base100+i59), fx=1300 → qty=130,000,000/(159*1300)=629.13...→629
  check('USD 종목 수량 = floor(budget/(price*fx))', usdHolding.qty, Math.floor(130_000_000 / (159 * 1300)));
  checkClose('USD 종목 valueKRW = qty*price*fx', usdHolding.valueKRW, usdHolding.qty * 159 * 1300, 1e-6);

  // 미상장(시작일 이전 데이터 없음) — 60일 공유 캘린더 중 마지막 5일에만 상장된 종목을 캘린더 앞쪽(idx10)에서 조회
  const lateBars = risingBars(5, 100);
  const secLate = buildSecurityIndicators({
    ticker: 'LATE', name: 'LATE', assetClass: '한국주식', currency: 'KRW', isCryptoTicker: false, isKrEtf: false,
    weightPct: 1, scopeClass: 'SATELLITE_TURTLE',
    raw: { symbol: 'LATE', dates: secOk.ownDates.slice(55, 60), open: lateBars.map(b => b.o), high: lateBars.map(b => b.h), low: lateBars.map(b => b.l), close: lateBars.map(b => b.c), ok: true },
    calendar: secOk.ownDates, // 60일 공유 캘린더 — LATE는 뒤 5일에만 매핑됨
  });
  const initialLate = buildInitialHoldings([secLate], EMPTY_FX, 10, 100_000_000, () => true); // idx10은 LATE 상장 전
  check('상장 전(그 시점 이전 데이터 없음) → not-listed-yet 제외', initialLate.excludedTickers[0]?.reason, 'not-listed-yet');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('6. 가드 재사용 — checkCreateGuard/checkFillGuard (freshTurtleLifecycle 직접 재사용)');
// ════════════════════════════════════════════════════════════════════════════
{
  check('생성 가드: 대기주문 중복 → duplicate-order', checkCreateGuard({ hasPending: true, hasPosition: false, kind: 'entry', signalCalIdx: 5, fillCalIdx: 6 }), 'duplicate-order');
  check('생성 가드: entry인데 이미 포지션 → duplicate-position', checkCreateGuard({ hasPending: false, hasPosition: true, kind: 'entry', signalCalIdx: 5, fillCalIdx: 6 }), 'duplicate-position');
  check('생성 가드: 같은 봉 체결 예약 → same-bar', checkCreateGuard({ hasPending: false, hasPosition: false, kind: 'entry', signalCalIdx: 5, fillCalIdx: 5 }), 'same-bar');
  check('생성 가드: 정상', checkCreateGuard({ hasPending: false, hasPosition: false, kind: 'entry', signalCalIdx: 5, fillCalIdx: 6 }), 'ok');

  check('체결 가드: 같은 봉 → same-bar', checkFillGuard({ kind: 'entry', signalCalIdx: 5, fillCalIdx: 5, ownIdxAtFill: 3, hasPosition: false }), 'same-bar');
  check('체결 가드: 휴장(ownIdx<0) → holiday', checkFillGuard({ kind: 'entry', signalCalIdx: 5, fillCalIdx: 6, ownIdxAtFill: -1, hasPosition: false }), 'holiday');
  check('체결 가드: entry인데 이미 포지션 → duplicate-position', checkFillGuard({ kind: 'entry', signalCalIdx: 5, fillCalIdx: 6, ownIdxAtFill: 3, hasPosition: true }), 'duplicate-position');
  check('체결 가드: 정상', checkFillGuard({ kind: 'entry', signalCalIdx: 5, fillCalIdx: 6, ownIdxAtFill: 3, hasPosition: false }), 'ok');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('7. engine 통합 골든 — 보유청산→현금→재진입→불타기→손절 (B/G 비교)');
// ════════════════════════════════════════════════════════════════════════════
{
  // 시나리오: day0..89 엄격 상승(100+i, TR=1 상수→ATR=1 정확), day90 시작(종가190, 보유분).
  // day95 크래시(150) → 20일 저채널(170) 이탈 → day96 시가(145) 체결(매도).
  // day97~100 회복(148,160,180,200) → day100 종가(200)가 55일 고채널(194) 돌파 → day101 시가(205) 체결(재매수).
  //   B: 상한10%가 리스크공식보다 작아 상한 구속 — qty=37122.
  //   G: 유닛=min(리스크공식, 상한÷4) — day101에 즉시 불타기 트리거(종가210>=lastFill205+0.5*atr[101])까지 겹쳐 2유닛 체결.
  // day103 재크래시(190) → 두 변형 모두 공통 손절가 이하로 체결(손절) → day104 시가(185) 체결.
  const bars: Bar[] = [];
  for (let i = 0; i < 140; i++) {
    if (i === 95) bars.push({ o: 150, h: 150, l: 150, c: 150 });
    else if (i === 96) bars.push({ o: 145, h: 145, l: 145, c: 145 });
    else if (i === 97) bars.push({ o: 148, h: 148, l: 148, c: 148 });
    else if (i === 98) bars.push({ o: 160, h: 160, l: 160, c: 160 });
    else if (i === 99) bars.push({ o: 180, h: 180, l: 180, c: 180 });
    else if (i === 100) bars.push({ o: 200, h: 200, l: 200, c: 200 });
    else if (i === 101) bars.push({ o: 205, h: 210, l: 205, c: 210 });
    else if (i === 102) bars.push({ o: 220, h: 220, l: 220, c: 220 });
    else if (i === 103) bars.push({ o: 190, h: 190, l: 190, c: 190 });
    else if (i === 104) bars.push({ o: 185, h: 185, l: 185, c: 185 });
    else if (i < 90) bars.push({ o: 100 + i, h: 100 + i, l: 100 + i, c: 100 + i });
    else if (i <= 94) bars.push({ o: 100 + i, h: 100 + i, l: 100 + i, c: 100 + i });
    else bars.push({ o: 185, h: 185, l: 185, c: 185 });
  }
  const sec = buildTestSec({ ticker: 'TEST', bars, weightPct: 1 });

  checkClose('ATR20 상승구간 워밍업 후 정확히 1', sec.atr[20] as number, 1, 1e-12);
  check('20일 저채널(day90, 현재봉 제외)', sec.lowChannel20[90], 170);
  check('55일 고채널(day100, 현재봉 제외)', sec.highChannel55[100], 194);

  const initial = buildInitialHoldings([sec], EMPTY_FX, 90, 100_000_000, () => true);
  check('시작 보유 수량(=100,000,000/190 내림)', initial.perTicker.get('TEST')?.qty, 526315);
  checkClose('시작 배분액', initial.deployedKRW, 99999850, 1e-6);

  const runB = simulatePortfolio({
    securities: [sec], fx: EMPTY_FX, calendar: sec.ownDates, initial,
    exitRule: { method: 'donchian', lookback: 20, currentBarExcluded: true }, stopMultipleN: 2,
    sizing: { riskPerUnitPct: 1, maxUnits: 1, positionCapPct: 10, pyramid: 'none' },
    reentryEnabled: true, tradable: () => true,
    costMultiplier: 1, cashAnnualRatePct: 0, maxTotalRiskPct: 12, minOrderKRW: 50000,
    drawdownScaling: false, drawdownStepDown: 0.1, drawdownReduce: 0.2,
  });
  check('B: 완료거래 2건(보유청산+재매수손절)', runB.trades.length, 2);
  const bInit = runB.trades[0], bReenter = runB.trades[1];
  check('B: 보유분 청산일', bInit?.closedDate, '2024-04-06');
  check('B: 보유분 청산수량', bInit?.qty, 526315);
  check('B: 보유분 체결가(시가, 클램프 없음)', bInit?.exitPriceLocal, 145);
  checkClose('B: 보유분 pnl(세금·비용 반영)', bInit?.pnlKRW as number, -23897858.89, 1e-2);
  check('B: 보유분 rMultiple=null(손절 없음)', bInit?.rMultiple, null);
  check('B: 재매수 수량(상한 구속)', bReenter?.qty, 37122);
  check('B: 재매수 청산 사유=손절', bReenter?.exitReason, 'stop');
  checkClose('B: 재매수 pnl', bReenter?.pnlKRW as number, -769279.206, 1e-2);
  checkClose('B: 재매수 R배수', bReenter?.rMultiple as number, -1.9694390480523498, 1e-6);
  check('B: 불변식 위반 0', Object.values(runB.invariants).reduce((a, b) => a + b, 0), 0);
  checkClose('B: 최종평가액', runB.finalEquityKRW, 75332711.904, 1e-2);

  const runG = simulatePortfolio({
    securities: [sec], fx: EMPTY_FX, calendar: sec.ownDates, initial,
    exitRule: { method: 'donchian', lookback: 20, currentBarExcluded: true }, stopMultipleN: 2,
    sizing: { riskPerUnitPct: 1, maxUnits: 4, positionCapPct: 10, pyramid: 'fixed-cap-div4', pyramidStepN: 0.5 },
    reentryEnabled: true, tradable: () => true,
    costMultiplier: 1, cashAnnualRatePct: 0, maxTotalRiskPct: 12, minOrderKRW: 50000,
    drawdownScaling: false, drawdownStepDown: 0.1, drawdownReduce: 0.2,
  });
  check('G: 완료거래 2건', runG.trades.length, 2);
  const gReenter = runG.trades[1];
  check('G: 재매수 수량(2유닛 합, 고정크기)', gReenter?.qty, 18560);
  check('G: 재매수 청산 사유=손절', gReenter?.exitReason, 'stop');
  checkClose('G: 재매수 pnl', gReenter?.pnlKRW as number, -523958.08, 1e-2);
  checkClose('G: 재매수 R배수(1유닛 rDenom 기준 — 위험단위로 해석 금지, §13-2 캐비엇 동일)', gReenter?.rMultiple as number, -5.365849447091814, 1e-6);
  check('G: 불변식 위반 0', Object.values(runG.invariants).reduce((a, b) => a + b, 0), 0);
  checkClose('G: 최종평가액', runG.finalEquityKRW, 75578033.03, 1e-2);

  // 입력 순서 무관 — 종목 배열이 하나뿐이라도 fx/calendar 구성 재현성 확인(동일 결과 재현)
  const runBAgain = simulatePortfolio({
    securities: [sec], fx: EMPTY_FX, calendar: sec.ownDates, initial,
    exitRule: { method: 'donchian', lookback: 20, currentBarExcluded: true }, stopMultipleN: 2,
    sizing: { riskPerUnitPct: 1, maxUnits: 1, positionCapPct: 10, pyramid: 'none' },
    reentryEnabled: true, tradable: () => true,
    costMultiplier: 1, cashAnnualRatePct: 0, maxTotalRiskPct: 12, minOrderKRW: 50000,
    drawdownScaling: false, drawdownStepDown: 0.1, drawdownReduce: 0.2,
  });
  check('결정론: 동일 입력 재실행 시 완전히 동일한 최종평가액', runBAgain.finalEquityKRW, runB.finalEquityKRW);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('8. λ 비례축소 — 공유 현금 경합 시 동일 비율로 축소(선착순 금지)');
// ════════════════════════════════════════════════════════════════════════════
{
  function crashBars(): Bar[] {
    const bars: Bar[] = [];
    for (let i = 0; i < 140; i++) {
      if (i === 95) bars.push({ o: 150, h: 150, l: 150, c: 150 });
      else if (i === 96) bars.push({ o: 145, h: 145, l: 145, c: 145 });
      else if (i === 97) bars.push({ o: 148, h: 148, l: 148, c: 148 });
      else if (i === 98) bars.push({ o: 160, h: 160, l: 160, c: 160 });
      else if (i === 99) bars.push({ o: 180, h: 180, l: 180, c: 180 });
      else if (i === 100) bars.push({ o: 200, h: 200, l: 200, c: 200 });
      else if (i === 101) bars.push({ o: 205, h: 210, l: 205, c: 210 });
      else if (i < 95) bars.push({ o: 100 + i, h: 100 + i, l: 100 + i, c: 100 + i });
      else bars.push({ o: 205, h: 205, l: 205, c: 205 });
    }
    return bars;
  }
  function risingForeverBars(): Bar[] {
    return Array.from({ length: 140 }, (_, i) => ({ o: 100 + i, h: 100 + i, l: 100 + i, c: 100 + i }));
  }
  const secBig = buildTestSec({ ticker: 'BIG', bars: risingForeverBars(), weightPct: 0.90 });
  const secA = buildTestSec({ ticker: 'AAA', bars: crashBars(), weightPct: 0.05 });
  const secB = buildTestSec({ ticker: 'BBB', bars: crashBars(), weightPct: 0.05 });
  const securities = [secBig, secA, secB];
  const initial = buildInitialHoldings(securities, EMPTY_FX, 90, 100_000_000, () => true);

  const run = simulatePortfolio({
    securities, fx: EMPTY_FX, calendar: secBig.ownDates, initial,
    exitRule: { method: 'donchian', lookback: 20, currentBarExcluded: true }, stopMultipleN: 2,
    sizing: { riskPerUnitPct: 1, maxUnits: 1, positionCapPct: 10, pyramid: 'none' },
    reentryEnabled: true, tradable: () => true,
    costMultiplier: 1, cashAnnualRatePct: 0, maxTotalRiskPct: 12, minOrderKRW: 50000,
    drawdownScaling: false, drawdownStepDown: 0.1, drawdownReduce: 0.2,
  });
  checkTrue('λ 축소가 최소 1회 발동', run.lambdaScaleDays >= 1);
  const reenteredA = run.trades.find(t => t.ticker === 'AAA' && t.kind === 'reentered');
  const reenteredB = run.trades.find(t => t.ticker === 'BBB' && t.kind === 'reentered');
  checkTrue('AAA·BBB 둘 다 재매수 체결됨', reenteredA !== undefined && reenteredB !== undefined);
  check('동일 조건 두 종목 — λ 축소 후에도 완전히 같은 수량(선착순 금지, 입력순서 무관 재확인)', reenteredA?.qty, reenteredB?.qty);
  check('불변식 위반 0', Object.values(run.invariants).reduce((a, b) => a + b, 0), 0);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('9. 현금 이자 — 달력일 복리(연 2.5%), 재진입 없음(판매만)');
// ════════════════════════════════════════════════════════════════════════════
{
  const bars: Bar[] = [];
  for (let i = 0; i < 140; i++) {
    if (i === 95) bars.push({ o: 150, h: 150, l: 150, c: 150 });
    else if (i === 96) bars.push({ o: 145, h: 145, l: 145, c: 145 });
    else if (i < 95) bars.push({ o: 100 + i, h: 100 + i, l: 100 + i, c: 100 + i });
    else bars.push({ o: 145, h: 145, l: 145, c: 145 });
  }
  const sec = buildTestSec({ ticker: 'TEST', bars, weightPct: 1 });
  const initial = buildInitialHoldings([sec], EMPTY_FX, 90, 100_000_000, () => true);
  const run = simulatePortfolio({
    securities: [sec], fx: EMPTY_FX, calendar: sec.ownDates, initial,
    exitRule: { method: 'donchian', lookback: 20, currentBarExcluded: true }, stopMultipleN: 2,
    sizing: { riskPerUnitPct: 1, maxUnits: 1, positionCapPct: 10, pyramid: 'none' },
    reentryEnabled: false, tradable: () => true, // 판매만(재진입 없음) — 팔린 뒤 끝까지 현금
    costMultiplier: 1, cashAnnualRatePct: 2.5, maxTotalRiskPct: 12, minOrderKRW: 50000,
    drawdownScaling: false, drawdownStepDown: 0.1, drawdownReduce: 0.2,
  });
  check('판매만: 거래 1건(재진입 없음)', run.trades.length, 1);
  const cashAfterSell = run.trades[0]!.pnlKRW + 99999850; // pnl = proceeds-cost-costBasis → cash = costBasis+pnl
  const days = 139 - 96;
  const expected = cashAfterSell * Math.pow(1 + 2.5 / 100, days / 365.2425);
  checkClose('연2.5% 달력일 복리 — 폐쇄형 공식과 일치', run.finalEquityKRW, expected, 1e-3);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('10. 최소 재매수 금액(5만원) 미만 — 재진입 생략');
// ════════════════════════════════════════════════════════════════════════════
{
  const bars: Bar[] = [];
  for (let i = 0; i < 140; i++) {
    if (i === 95) bars.push({ o: 150, h: 150, l: 150, c: 150 });
    else if (i === 96) bars.push({ o: 145, h: 145, l: 145, c: 145 });
    else if (i === 97) bars.push({ o: 148, h: 148, l: 148, c: 148 });
    else if (i === 98) bars.push({ o: 160, h: 160, l: 160, c: 160 });
    else if (i === 99) bars.push({ o: 180, h: 180, l: 180, c: 180 });
    else if (i === 100) bars.push({ o: 200, h: 200, l: 200, c: 200 });
    else if (i === 101) bars.push({ o: 205, h: 210, l: 205, c: 210 });
    else if (i < 95) bars.push({ o: 100 + i, h: 100 + i, l: 100 + i, c: 100 + i });
    else bars.push({ o: 205, h: 205, l: 205, c: 205 });
  }
  const sec = buildTestSec({ ticker: 'TINY', bars, weightPct: 1 });
  const initial = buildInitialHoldings([sec], EMPTY_FX, 90, 300_000, () => true); // 예산을 아주 작게
  const run = simulatePortfolio({
    securities: [sec], fx: EMPTY_FX, calendar: sec.ownDates, initial,
    exitRule: { method: 'donchian', lookback: 20, currentBarExcluded: true }, stopMultipleN: 2,
    sizing: { riskPerUnitPct: 1, maxUnits: 1, positionCapPct: 10, pyramid: 'none' },
    reentryEnabled: true, tradable: () => true,
    costMultiplier: 1, cashAnnualRatePct: 0, maxTotalRiskPct: 12, minOrderKRW: 50000,
    drawdownScaling: false, drawdownStepDown: 0.1, drawdownReduce: 0.2,
  });
  check('재진입 신호는 발생하나 5만원 미만이라 생략 — 거래 1건만', run.trades.length, 1);
  check('불변식 위반 0', Object.values(run.invariants).reduce((a, b) => a + b, 0), 0);
}

// ── 결과 ──
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
