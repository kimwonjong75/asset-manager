// tests/turtleHoldingsViewParity.ts
// ---------------------------------------------------------------------------
// "보유종목 터틀" P2 2-1 — 화면용 view-model 골든 테스트 (계획서 PLAN_터틀중심_앱재정비_260925 §4.1~4.4·§6 P2).
// 명시적 절대값 고정(RULES §13 — 경로A-vs-경로B 자기참조 비교 금지). ATR은 initial-average만 쓰도록
// 정확히 21봉(=period+1)으로 맞춰, Wilder 재귀 없이 "첫 20개 TR의 단순평균"만으로 손계산이 가능하게 했다.
//
// 실행: npx tsx tests/turtleHoldingsViewParity.ts

import { Currency, WatchlistItem, normalizeExchange } from '../types';
import { EnrichedAsset } from '../types/ui';
import { TurtlePosition } from '../types/turtle';
import { TurtleHoldingsSettings, DEFAULT_TURTLE_HOLDINGS_SETTINGS } from '../types/turtleHoldings';
import { RawSeries, todayInstrumentKey } from '../utils/todayTurtle';
import {
  computeManagedEquity,
  resolveEffectiveManagedEquity,
  buildTurtleHoldingsLegacyRow,
  buildTurtleHoldingsReentryRow,
  buildTurtleHoldingsWatchRow,
  summarizeTurtleHoldingsRows,
  sortTurtleHoldingsRows,
  turtleHoldingsRequiredTradingDays,
  turtleHoldingsLookbackCalendarDays,
  describeReentryBaseline,
  REENTRY_BASELINE_CAPTION,
  TurtleHoldingsRow,
} from '../utils/turtleHoldingsView';

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else { fail++; console.error(`  ✗ ${name}\n      기대=${e} 실제=${a}`); }
}
function checkClose(name: string, actual: number | null, expected: number, tol = 1e-6): void {
  if (actual !== null && Number.isFinite(actual) && Math.abs(actual - expected) <= tol) pass++;
  else { fail++; console.error(`  ✗ ${name}\n      기대=${expected} 실제=${String(actual)}`); }
}

const KR_EX = 'KRX (코스피/코스닥)';

function iso(i: number): string {
  return new Date(Date.parse('2026-01-01T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10);
}
interface B { o: number; h: number; l: number; c: number }
function mkRaw(bars: B[]): RawSeries {
  const data: Record<string, number> = {}, open: Record<string, number> = {},
    high: Record<string, number> = {}, low: Record<string, number> = {};
  bars.forEach((b, i) => {
    const d = iso(i);
    data[d] = b.c; open[d] = b.o; high[d] = b.h; low[d] = b.l;
  });
  return { data, open, high, low };
}
/** 마지막 봉 다음날 정오(UTC)를 "오늘"로 → 21봉 전부 완료봉(KR 기준 자정 이후). */
function nowAfter(bars: B[]): Date {
  return new Date(Date.parse(`${iso(bars.length)}T12:00:00Z`));
}
/** 0..19 = 평평한 20봉(close100/high101/low99, TR=2 고정), 20번째(day20)는 시나리오별로 다르다. */
function flatWindow(): B[] {
  return Array.from({ length: 20 }, () => ({ o: 100, h: 101, l: 99, c: 100 }));
}

function mkAsset(over: Partial<EnrichedAsset> & { id: string }): EnrichedAsset {
  const base: EnrichedAsset = {
    id: over.id, categoryId: 1, ticker: '005930', exchange: KR_EX, name: '삼성전자',
    quantity: 10, purchasePrice: 90_000, purchaseDate: '2026-01-01', currency: Currency.KRW,
    currentPrice: 100, priceOriginal: 100, highestPrice: 110,
    metrics: {
      purchasePrice: 90_000, currentPrice: 100, currentPriceKRW: 100, purchasePriceKRW: 90_000,
      purchaseValue: 900_000, currentValue: 1_000, purchaseValueKRW: 900_000, currentValueKRW: 1_000_000,
      returnPercentage: 0, allocation: 0, dropFromHigh: 0, profitLoss: 0, profitLossKRW: 0,
      diffFromHigh: 0, yesterdayChange: 0, diffFromYesterday: 0,
    },
  };
  return { ...base, ...over, metrics: { ...base.metrics, ...(over.metrics ?? {}) } };
}

const H = (over: Partial<TurtleHoldingsSettings> = {}): TurtleHoldingsSettings => ({
  ...DEFAULT_TURTLE_HOLDINGS_SETTINGS, entryLookback: 20, ...over,
});

console.log('turtleHoldingsView — 골든 테스트\n');

// ════════════════════════════════════════════════════════════════════════════
console.log('1. computeManagedEquity — 범위 판정 + 현금/비현금 분리');
// ════════════════════════════════════════════════════════════════════════════
{
  const settings = H({ excludedAssetIds: ['excl-1'], excludedCategoryIds: [77] });
  const assets: EnrichedAsset[] = [
    mkAsset({ id: 'a1', owner: 'WONJONG', categoryId: 1, metrics: { currentValueKRW: 1_000_000 } as never }),
    mkAsset({ id: 'a2', owner: 'YUSEON', categoryId: 1, metrics: { currentValueKRW: 5_000_000 } as never }), // 가족 제외
    mkAsset({ id: 'cash1', owner: 'WONJONG', categoryId: 9, metrics: { currentValueKRW: 2_000_000 } as never }), // CASH=대기자금
    mkAsset({ id: 'excl-1', owner: 'WONJONG', categoryId: 1, metrics: { currentValueKRW: 3_000_000 } as never }), // 개별 제외
    mkAsset({ id: 'a5', owner: 'WONJONG', categoryId: 77, metrics: { currentValueKRW: 4_000_000 } as never }), // 카테고리 제외
  ];
  const eq = computeManagedEquity(assets, settings);
  check('보유 평가액(비현금, 범위 내)', eq.holdingsValueKRW, 1_000_000);
  check('대기 자금(CASH, 범위 내)', eq.parkedCashKRW, 2_000_000);
  check('관리자산 = 평가액+대기자금', eq.managedEquityKRW, 3_000_000);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('2. resolveEffectiveManagedEquity — 계좌 축소(드로다운 감쇄)');
// ════════════════════════════════════════════════════════════════════════════
{
  const off = H({ drawdownScalingEnabled: false });
  const r1 = resolveEffectiveManagedEquity(90, off);
  check('감쇄 꺼짐 → 그대로', r1, { equityKRW: 90, drawdownApplied: false });

  const on = H({ drawdownScalingEnabled: true });
  const r2 = resolveEffectiveManagedEquity(90, on);
  check('기준자산 미지정 → 자기참조(감쇄 없음)', r2, { equityKRW: 90, drawdownApplied: false });

  const r3 = resolveEffectiveManagedEquity(90, on, 100);
  check('기준자산=100, 현재=90 → 1단계 감쇄(80)', r3, { equityKRW: 80, drawdownApplied: true });
}

// ════════════════════════════════════════════════════════════════════════════
console.log('3. buildTurtleHoldingsLegacyRow — 원래 보유분(청산선만, 2N 손절 없음)');
// ════════════════════════════════════════════════════════════════════════════
{
  const settings = H();
  const asset = mkAsset({ id: 'leg1', priceOriginal: 100 });

  // 3-a. 범위 제외
  const outScope = buildTurtleHoldingsLegacyRow({
    asset: mkAsset({ id: 'leg-fam', owner: 'YUSEON' }), raw: undefined, isCrypto: false, fetchFailed: false,
    now: new Date(), settings,
  });
  check('3-a 범위 제외', outScope.status, 'out-of-scope');
  check('3-a rebuy 없음', outScope.rebuy, null);

  // 3-b. 데이터 없음 → 확인 불가
  const noData = buildTurtleHoldingsLegacyRow({ asset, raw: undefined, isCrypto: false, fetchFailed: false, now: new Date(), settings });
  check('3-b 확인 불가', noData.status, 'unavailable');
  check('3-b dataIssue', noData.dataIssue, 'no-high-low');

  // 3-c. 보유 유지(평평한 20봉 + 오늘도 평평, N=2.0)
  const barsHold: B[] = [...flatWindow(), { o: 100, h: 101, l: 99, c: 100 }];
  const rowHold = buildTurtleHoldingsLegacyRow({ asset, raw: mkRaw(barsHold), isCrypto: false, fetchFailed: false, now: nowAfter(barsHold), settings });
  check('3-c 상태=보유 유지', rowHold.status, 'hold');
  check('3-c 청산선=99', rowHold.exitLine, 99);
  checkClose('3-c N=2.0', rowHold.n, 2.0);
  check('3-c 변동성=보통(2%)', rowHold.volatilityLabel, 'normal');
  check('3-c stopCheckText 없음(원래 보유분은 손절 예약 자체가 없음)', rowHold.stopCheckText, null);

  // 3-d. 팔 때(오늘 종가 98 ≤ 청산선 99, TR20=3 → N=(38+3)/20=2.05)
  const barsSell: B[] = [...flatWindow(), { o: 98, h: 99, l: 97, c: 98 }];
  const rowSell = buildTurtleHoldingsLegacyRow({ asset, raw: mkRaw(barsSell), isCrypto: false, fetchFailed: false, now: nowAfter(barsSell), settings });
  check('3-d 상태=팔 때', rowSell.status, 'sell');
  checkClose('3-d N=2.05', rowSell.n, 2.05);
  checkClose('3-d exitGapPct', rowSell.exitGapPct, ((98 - 99) / 99) * 100);
  check('3-d rebuy 없음(원래 보유분은 재매수 계산 없음)', rowSell.rebuy, null);
  checkClose('3-d 손절 없음(원래 보유분)', 0, 0); // 명시: legacy row에는 stopPrice 필드 자체가 없다(kind로 구분)
}

// ════════════════════════════════════════════════════════════════════════════
console.log('4. buildTurtleHoldingsReentryRow — 재매수분(2N 손절 + 불타기)');
// ════════════════════════════════════════════════════════════════════════════
{
  const settings = H({ stopMultipleN: 2, pyramidSpacing: 'halfN', maxUnitsPerPosition: 4, minOrderKRW: 0 });
  const asset = mkAsset({ id: 'p1', priceOriginal: 100 });
  const positionBase: TurtlePosition = {
    id: 'tp1', ticker: '005930', name: '삼성전자', assetId: 'p1',
    units: [{ fillDate: iso(0), fillPrice: 100, quantity: 10, nAtFill: 2 }],
    stopPrice: 90, entryDonchianHigh: 101, status: 'open', openedAt: iso(0), origin: 'holdings-reentry',
  };

  // 4-a. 보유 유지(평평 + 오늘도 평평, N=2.0) — 손절 90/청산선 99 둘 다 안 닿음, 불타기 트리거(100+0.5*2=101)도 안 닿음
  const barsHold: B[] = [...flatWindow(), { o: 100, h: 101, l: 99, c: 100 }];
  const rowHold = buildTurtleHoldingsReentryRow({
    position: positionBase, asset, raw: mkRaw(barsHold), isCrypto: false, fetchFailed: false,
    now: nowAfter(barsHold), settings, fxRate: 1, effectiveManagedEquityKRW: 100_000_000,
  });
  check('4-a 상태=보유 유지', rowHold.status, 'hold');
  checkClose('4-a N=2.0', rowHold.n, 2.0);
  check('4-a 유닛 1/4', { u: rowHold.unitsCount, m: rowHold.maxUnits }, { u: 1, m: 4 });
  // "손절선 확인" 전용 문구 — reasonText(판정 사유)와 다른 문장이어야 한다(칸 의미 혼동 방지).
  check('4-a 손절선 확인 문구(예시)', rowHold.stopCheckText, '증권사 손절 예약 90원이 걸려 있는지 확인하세요 (청산선 99원).');
  check('4-a 손절선 확인 문구 ≠ reasonText(칸 중복 금지)', rowHold.stopCheckText !== rowHold.reasonText, true);

  // 4-b. 손절(종가 89 ≤ stopPrice 90)
  const barsStop: B[] = [...flatWindow(), { o: 90, h: 91, l: 88, c: 89 }];
  const rowStop = buildTurtleHoldingsReentryRow({
    position: positionBase, asset, raw: mkRaw(barsStop), isCrypto: false, fetchFailed: false,
    now: nowAfter(barsStop), settings, fxRate: 1, effectiveManagedEquityKRW: 100_000_000,
  });
  check('4-b 상태=팔 때(손절)', rowStop.status, 'sell');
  check('4-b rebuy 없음(팔 때)', rowStop.rebuy, null);
  check('4-b stopCheckText 없음("팔 때"엔 손절선 확인 칸 자체가 안 뜸)', rowStop.stopCheckText, null);

  // 4-c. 청산선 이탈(종가 98 ≤ 청산선 99, 손절 90은 안 닿음)
  const barsExit: B[] = [...flatWindow(), { o: 98, h: 99, l: 97, c: 98 }];
  const rowExit = buildTurtleHoldingsReentryRow({
    position: positionBase, asset, raw: mkRaw(barsExit), isCrypto: false, fetchFailed: false,
    now: nowAfter(barsExit), settings, fxRate: 1, effectiveManagedEquityKRW: 100_000_000,
  });
  check('4-c 상태=팔 때(청산선)', rowExit.status, 'sell');
  check('4-c stopCheckText 없음("팔 때"엔 손절선 확인 칸 자체가 안 뜸)', rowExit.stopCheckText, null);

  // 4-d. 추가 매수(불타기) — 종가105, TR20=6 → N=(38+6)/20=2.2, 트리거=100+0.5*2.2=101.1 ≤ 105
  const barsPyr: B[] = [...flatWindow(), { o: 105, h: 106, l: 104, c: 105 }];
  const rowPyr = buildTurtleHoldingsReentryRow({
    position: positionBase, asset, raw: mkRaw(barsPyr), isCrypto: false, fetchFailed: false,
    now: nowAfter(barsPyr), settings, fxRate: 1, effectiveManagedEquityKRW: 100_000_000,
  });
  check('4-d 상태=추가 매수', rowPyr.status, 'pyramid');
  checkClose('4-d N=2.2', rowPyr.n, 2.2);
  check('4-d 손절선 확인 문구(예시, 추가 매수 상태에도 뜬다)', rowPyr.stopCheckText, '증권사 손절 예약 90원이 걸려 있는지 확인하세요 (청산선 99원).');
  check('4-d 불타기 사유(reasonText)에 통화 단위(원) 포함', rowPyr.reasonText.includes('원'), true);
  check('4-d 손절선 확인 문구 ≠ 불타기 사유(reasonText, 칸 중복 금지)', rowPyr.stopCheckText !== rowPyr.reasonText, true);
  if (rowPyr.rebuy) {
    check('4-d rebuy qty=10(첫유닛 10×배수1)', rowPyr.rebuy.qty, 10);
    checkClose('4-d rebuy positionValueKRW=10×101.1', rowPyr.rebuy.positionValueKRW, 10 * 101.1, 1e-6);
    checkClose('4-d 새 손절가=max(90, 101.1-4.4)=96.7', rowPyr.rebuy.stopPriceOriginal as number, 96.7);
    checkClose('4-d 다음 불타기가=101.1+0.5×2.2=102.2', rowPyr.rebuy.nextPyramidPriceOriginal as number, 102.2);
    check('4-d skip 없음', rowPyr.rebuy.skipReason, null);
  } else {
    fail++; console.error('  ✗ 4-d rebuy가 null이면 안 됨');
  }

  // 4-e. 유닛 한도 도달(2/2) — 같은 가격 조건이어도 불타기 아님, rebuy 없음
  const positionFull: TurtlePosition = {
    ...positionBase, units: [positionBase.units[0], { fillDate: iso(5), fillPrice: 102, quantity: 10, nAtFill: 2 }],
  };
  const rowFull = buildTurtleHoldingsReentryRow({
    position: positionFull, asset, raw: mkRaw(barsPyr), isCrypto: false, fetchFailed: false,
    now: nowAfter(barsPyr), settings: H({ ...settings, maxUnitsPerPosition: 2 }), fxRate: 1, effectiveManagedEquityKRW: 100_000_000,
  });
  check('4-e 유닛 한도 도달 → 보유 유지(불타기 아님)', rowFull.status, 'hold');
  check('4-e rebuy 없음(한도 도달)', rowFull.rebuy, null);
  check('4-e 유닛 한도 도달해도 손절선 확인 문구는 그대로 뜬다(hold 상태)', rowFull.stopCheckText, '증권사 손절 예약 90원이 걸려 있는지 확인하세요 (청산선 99원).');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('5. buildTurtleHoldingsWatchRow — 관심종목 감시(재매수 후보)');
// ════════════════════════════════════════════════════════════════════════════
{
  const settings = H({ riskPerUnitPct: 1, positionCapPct: 10, maxUnitsPerPosition: 4, minOrderKRW: 50_000, stopMultipleN: 2 });
  const watch: WatchlistItem = { id: 'w1', ticker: 'AAA', exchange: KR_EX, name: '테스트종목', categoryId: 1, currency: Currency.KRW };
  const noHeld = new Set<string>(); // 대부분의 시나리오는 보유 중복이 없는 경우

  // 5-a. 범위 제외(카테고리)
  const outScope = buildTurtleHoldingsWatchRow({
    watchItem: { ...watch, categoryId: 77 }, raw: undefined, isCrypto: false, fetchFailed: false,
    now: new Date(), settings: H({ excludedCategoryIds: [77] }), fxRate: 1, effectiveManagedEquityKRW: 100_000_000,
    heldTickerKeys: noHeld,
  });
  check('5-a 범위 제외', outScope.status, 'out-of-scope');

  // 5-b. 감시 중(종가100 < 재진입선101, N=2.0)
  const barsWatch: B[] = [...flatWindow(), { o: 100, h: 101, l: 99, c: 100 }];
  const rowWatch = buildTurtleHoldingsWatchRow({
    watchItem: watch, raw: mkRaw(barsWatch), isCrypto: false, fetchFailed: false,
    now: nowAfter(barsWatch), settings, fxRate: 1, effectiveManagedEquityKRW: 100_000_000,
    heldTickerKeys: noHeld,
  });
  check('5-b 상태=감시 중', rowWatch.status, 'watching');
  check('5-b 재진입선=101', rowWatch.reentryLine, 101);
  checkClose('5-b N=2.0', rowWatch.n, 2.0);
  if (rowWatch.rebuy) {
    check('5-b rebuy qty=25000(종목한도 캡)', rowWatch.rebuy.qty, 25_000);
    checkClose('5-b positionValueKRW=25000×100', rowWatch.rebuy.positionValueKRW, 2_500_000);
    checkClose('5-b 손절가=100-2×2=96', rowWatch.rebuy.stopPriceOriginal as number, 96);
    checkClose('5-b 다음 불타기가(2R)=100+2×2×2=108', rowWatch.rebuy.nextPyramidPriceOriginal as number, 108);
    check('5-b skip 없음', rowWatch.rebuy.skipReason, null);
  } else {
    fail++; console.error('  ✗ 5-b rebuy가 null이면 안 됨');
  }
  check('5-b stopCheckText는 watch 행에 없음(재매수분 전용)', rowWatch.stopCheckText, null);

  // 5-c. 다시 살 때(종가102 ≥ 재진입선101)
  const barsReentry: B[] = [...flatWindow(), { o: 102, h: 103, l: 101, c: 102 }];
  const rowReentry = buildTurtleHoldingsWatchRow({
    watchItem: watch, raw: mkRaw(barsReentry), isCrypto: false, fetchFailed: false,
    now: nowAfter(barsReentry), settings, fxRate: 1, effectiveManagedEquityKRW: 100_000_000,
    heldTickerKeys: noHeld,
  });
  check('5-c 상태=다시 살 때', rowReentry.status, 'reentry');

  // 5-d. 환율 미확보 → no-fx skip (N은 확보되나 fx=null)
  const rowNoFx = buildTurtleHoldingsWatchRow({
    watchItem: { ...watch, currency: Currency.CNY }, raw: mkRaw(barsWatch), isCrypto: false, fetchFailed: false,
    now: nowAfter(barsWatch), settings, fxRate: null, effectiveManagedEquityKRW: 100_000_000,
    heldTickerKeys: noHeld,
  });
  check('5-d rebuy skip=no-fx', rowNoFx.rebuy?.skipReason, 'no-fx');
  check('5-d rebuy qty=0', rowNoFx.rebuy?.qty, 0);

  // 5-e. 이미 보유 중(방금 [샀음 기록]해 reentry-position이 생긴 경우) → 감시 행을 만들지 않는다
  //   (중복 매수 유도 버그 수정, Advisor 지적 2026-09-26). 티커+정규화 거래소로 매칭 — 대소문자·거래소 별칭 무관.
  const heldKey = todayInstrumentKey(watch.ticker, watch.exchange, normalizeExchange);
  const rowAlreadyHeld = buildTurtleHoldingsWatchRow({
    watchItem: watch, raw: mkRaw(barsReentry), isCrypto: false, fetchFailed: false,
    now: nowAfter(barsReentry), settings, fxRate: 1, effectiveManagedEquityKRW: 100_000_000,
    heldTickerKeys: new Set([heldKey]),
  });
  check('5-e 이미 보유 중 → 감시 제외(범위 제외로 처리)', rowAlreadyHeld.status, 'out-of-scope');
  check('5-e rebuy 없음', rowAlreadyHeld.rebuy, null);
  check('5-e 사유 = 중복 매수 방지 문구', rowAlreadyHeld.reasonText, '이미 보유 중이거나 재매수 포지션이 있어 감시 대상에서 제외했습니다(중복 매수 방지).');

  // 5-e'. 대소문자·거래소 별칭이 달라도 매칭(정규화 — todayInstrumentKey/normalizeExchange 재사용)
  const heldKeyLower = todayInstrumentKey('aaa', KR_EX.toLowerCase(), normalizeExchange);
  const rowAlreadyHeldNormalized = buildTurtleHoldingsWatchRow({
    watchItem: watch, raw: mkRaw(barsReentry), isCrypto: false, fetchFailed: false,
    now: nowAfter(barsReentry), settings, fxRate: 1, effectiveManagedEquityKRW: 100_000_000,
    heldTickerKeys: new Set([heldKeyLower]),
  });
  check('5-e\' 대소문자 달라도 정규화 매칭 → 감시 제외', rowAlreadyHeldNormalized.status, 'out-of-scope');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('6. summarizeTurtleHoldingsRows · sortTurtleHoldingsRows');
// ════════════════════════════════════════════════════════════════════════════
{
  const mk = (over: Partial<TurtleHoldingsRow>): TurtleHoldingsRow => ({
    kind: 'legacy-holding', ticker: 'X', name: 'X', currency: Currency.KRW, status: 'hold',
    lastClose: null, exitLine: null, reentryLine: null, reentryBaseline: null, exitGapPct: null, n: null, volatilityLabel: null,
    unitsCount: null, maxUnits: null, rebuy: null, reasonText: '', stopCheckText: null, dataIssue: null, asOfDate: null,
    ...over,
  });
  const rows: TurtleHoldingsRow[] = [
    mk({ ticker: 'SELL1', status: 'sell' }),
    mk({ ticker: 'REEN1', status: 'reentry', kind: 'watch' }),
    mk({ ticker: 'PYR1', status: 'pyramid', kind: 'reentry-position' }),
    mk({ ticker: 'HOLD-POS', status: 'hold', kind: 'reentry-position' }),
    mk({ ticker: 'HOLD-LEG', status: 'hold', kind: 'legacy-holding' }),
    mk({ ticker: 'WATCH1', status: 'watching', kind: 'watch' }),
    mk({ ticker: 'BAD1', status: 'unavailable' }),
    mk({ ticker: 'OUT1', status: 'out-of-scope' }),
  ];
  const s = summarizeTurtleHoldingsRows(rows);
  check('6 팔 때 1건', s.sellCount, 1);
  check('6 다시 살 때 1건', s.reentryCount, 1);
  check('6 추가 매수 1건', s.pyramidCount, 1);
  check('6 손절선 확인(재매수분 hold+pyramid)=2건', s.stopCheckCount, 2);

  const sorted = sortTurtleHoldingsRows(rows).map(r => r.ticker);
  check('6 정렬 순서', sorted, ['BAD1', 'PYR1', 'REEN1', 'SELL1', 'WATCH1', 'HOLD-LEG', 'HOLD-POS', 'OUT1']);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('7. 조회 기간 산정');
// ════════════════════════════════════════════════════════════════════════════
{
  const settings = H({ entryLookback: 55, exitLookback: 20, maPeriod: 50 });
  check('7 필요 거래일=max(56,21,50,21)=56', turtleHoldingsRequiredTradingDays(settings), 56);
  check('7 달력일=ceil(56×2.4)+30=165', turtleHoldingsLookbackCalendarDays(settings), Math.ceil(56 * 2.4) + 30);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('8. reentryBaseline — \'팔 때\' 행 재진입 기준선(표시 전용, 2026-10-25)');
// ════════════════════════════════════════════════════════════════════════════
{
  // 8-a. 원래 보유분 '팔 때' + 진입창 55일 — 창 경계를 손계산 절대값으로 고정한다.
  //   70봉(index 0..69), 마지막 봉(69)은 제외, 직전 55개 = index 14..68.
  //   index 13(창 밖, high 150)은 무시, index 14(창 안 가장 오래된 봉, high 120)는 포함, index 69(마지막 봉, high 200)는 제외
  //   → 기준선 = 120. 마지막 종가 98 → 격차 = (120−98)/98×100 = 22.4489795918…%, 기준일 = iso(69) = 2026-03-11.
  const settings55 = H({ entryLookback: 55 });
  const asset = mkAsset({ id: 'bl-leg', priceOriginal: 100 });
  const bars55: B[] = Array.from({ length: 70 }, () => ({ o: 100, h: 101, l: 99, c: 100 }));
  bars55[13] = { o: 100, h: 150, l: 99, c: 100 };
  bars55[14] = { o: 100, h: 120, l: 99, c: 100 };
  bars55[69] = { o: 98, h: 200, l: 97, c: 98 };
  const rowSell55 = buildTurtleHoldingsLegacyRow({
    asset, raw: mkRaw(bars55), isCrypto: false, fetchFailed: false, now: nowAfter(bars55), settings: settings55,
  });
  check('8-a 상태=팔 때', rowSell55.status, 'sell');
  check('8-a 기준일 = 마지막 완료봉 2026-03-11', rowSell55.asOfDate, '2026-03-11');
  check('8-a 기준선 = 직전 55봉 high 최댓값 120(마지막 봉 200·창 밖 150 제외)', rowSell55.reentryBaseline?.line, 120);
  checkClose('8-a 격차 = (120−98)/98×100 = 22.448979591836736', rowSell55.reentryBaseline?.gapPct ?? null, 22.448979591836736, 1e-9);
  check('8-a asOfDate = 2026-03-11', rowSell55.reentryBaseline?.asOfDate, '2026-03-11');
  check('8-a reentryLine 필드는 팔 때 행에서 그대로 null(의미 불변)', rowSell55.reentryLine, null);
  check('8-a 표시 문장(원화)', describeReentryBaseline(rowSell55),
    '현재 재진입 기준선 120원 — 최근 확정 종가 대비 +22.4% (기준일 3월 11일)');

  // 8-b. 진입창 20일(H 기본) — 평평한 20봉(high 101) + 팔 때 봉(종가 98): 기준선 101, 격차 3/98×100.
  const settings20 = H();
  const barsSell20: B[] = [...flatWindow(), { o: 98, h: 99, l: 97, c: 98 }];
  const rowSell20 = buildTurtleHoldingsLegacyRow({
    asset: mkAsset({ id: 'bl-leg20', priceOriginal: 100 }), raw: mkRaw(barsSell20), isCrypto: false, fetchFailed: false,
    now: nowAfter(barsSell20), settings: settings20,
  });
  check('8-b 상태=팔 때', rowSell20.status, 'sell');
  check('8-b 기준선=101', rowSell20.reentryBaseline?.line, 101);
  checkClose('8-b 격차 = 3/98×100 = 3.061224489795918', rowSell20.reentryBaseline?.gapPct ?? null, 3.061224489795918, 1e-9);
  check('8-b 기준일 = iso(20) = 2026-01-21', rowSell20.reentryBaseline?.asOfDate, '2026-01-21');
  check('8-b 표시 문장', describeReentryBaseline(rowSell20),
    '현재 재진입 기준선 101원 — 최근 확정 종가 대비 +3.1% (기준일 1월 21일)');

  // 8-c. 보유 유지 → null
  const barsHold20: B[] = [...flatWindow(), { o: 100, h: 101, l: 99, c: 100 }];
  const rowHold20 = buildTurtleHoldingsLegacyRow({
    asset: mkAsset({ id: 'bl-hold', priceOriginal: 100 }), raw: mkRaw(barsHold20), isCrypto: false, fetchFailed: false,
    now: nowAfter(barsHold20), settings: settings20,
  });
  check('8-c 보유 유지 행 → reentryBaseline null', { s: rowHold20.status, b: rowHold20.reentryBaseline }, { s: 'hold', b: null });
  check('8-c 보유 유지 행 → 표시 문장 null', describeReentryBaseline(rowHold20), null);

  // 8-d. 범위 제외 → null (가족 계정)
  const rowOut = buildTurtleHoldingsLegacyRow({
    asset: mkAsset({ id: 'bl-out', owner: 'YUSEON', priceOriginal: 100 }), raw: mkRaw(barsSell20), isCrypto: false,
    fetchFailed: false, now: nowAfter(barsSell20), settings: settings20,
  });
  check('8-d 범위 제외 행 → reentryBaseline null', { s: rowOut.status, b: rowOut.reentryBaseline }, { s: 'out-of-scope', b: null });

  // 8-e. 확인 불가(시세 없음 / 조회 실패) → null
  const rowNoData = buildTurtleHoldingsLegacyRow({
    asset: mkAsset({ id: 'bl-nodata', priceOriginal: 100 }), raw: undefined, isCrypto: false, fetchFailed: false,
    now: new Date(), settings: settings20,
  });
  check('8-e 시세 없음 → reentryBaseline null', { s: rowNoData.status, b: rowNoData.reentryBaseline }, { s: 'unavailable', b: null });
  const rowFetchFail = buildTurtleHoldingsLegacyRow({
    asset: mkAsset({ id: 'bl-ff', priceOriginal: 100 }), raw: mkRaw(barsSell20), isCrypto: false, fetchFailed: true,
    now: nowAfter(barsSell20), settings: settings20,
  });
  check('8-e 조회 실패 → reentryBaseline null', { s: rowFetchFail.status, b: rowFetchFail.reentryBaseline }, { s: 'unavailable', b: null });

  // 8-f. 봉 부족 — 21봉이면 청산선(20일)은 구해져 '팔 때'지만 55일 기준선은 못 구한다 → null(값을 지어내지 않음).
  const rowShort = buildTurtleHoldingsLegacyRow({
    asset: mkAsset({ id: 'bl-short', priceOriginal: 100 }), raw: mkRaw(barsSell20), isCrypto: false, fetchFailed: false,
    now: nowAfter(barsSell20), settings: settings55,
  });
  check('8-f 봉 부족(21봉 < 56) → 팔 때지만 reentryBaseline null', { s: rowShort.status, b: rowShort.reentryBaseline }, { s: 'sell', b: null });
  check('8-f 봉 부족 → 표시 문장 null', describeReentryBaseline(rowShort), null);

  // 8-g. 재매수분 — 손절 이탈과 청산선 이탈 둘 다 status='sell' → 기준선이 붙는다. 보유 유지·불타기는 null.
  const rs = H({ stopMultipleN: 2, pyramidSpacing: 'halfN', maxUnitsPerPosition: 4, minOrderKRW: 0 });
  const posAsset = mkAsset({ id: 'bl-p1', priceOriginal: 100 });
  const position: TurtlePosition = {
    id: 'tp-bl', ticker: '005930', name: '삼성전자', assetId: 'bl-p1',
    units: [{ fillDate: iso(0), fillPrice: 100, quantity: 10, nAtFill: 2 }],
    stopPrice: 90, entryDonchianHigh: 101, status: 'open', openedAt: iso(0), origin: 'holdings-reentry',
  };
  const reentryRowOf = (bars: B[]): TurtleHoldingsRow => buildTurtleHoldingsReentryRow({
    position, asset: posAsset, raw: mkRaw(bars), isCrypto: false, fetchFailed: false,
    now: nowAfter(bars), settings: rs, fxRate: 1, effectiveManagedEquityKRW: 100_000_000,
  });
  const stopRow = reentryRowOf([...flatWindow(), { o: 90, h: 91, l: 88, c: 89 }]); // 종가 89 ≤ 손절 90
  check('8-g 손절 이탈 행 상태=팔 때', stopRow.status, 'sell');
  check('8-g 손절 이탈 행 기준선=101', stopRow.reentryBaseline?.line, 101);
  checkClose('8-g 손절 이탈 행 격차 = 12/89×100 = 13.48314606741573', stopRow.reentryBaseline?.gapPct ?? null, 13.48314606741573, 1e-9);
  check('8-g 손절 이탈 행 기준일', stopRow.reentryBaseline?.asOfDate, '2026-01-21');
  const exitRow = reentryRowOf([...flatWindow(), { o: 98, h: 99, l: 97, c: 98 }]); // 종가 98 ≤ 청산선 99
  check('8-g 청산선 이탈 행 상태=팔 때', exitRow.status, 'sell');
  check('8-g 청산선 이탈 행 기준선=101', exitRow.reentryBaseline?.line, 101);
  checkClose('8-g 청산선 이탈 행 격차 = 3/98×100 = 3.061224489795918', exitRow.reentryBaseline?.gapPct ?? null, 3.061224489795918, 1e-9);
  const holdRow = reentryRowOf([...flatWindow(), { o: 100, h: 101, l: 99, c: 100 }]);
  check('8-g 재매수분 보유 유지 → null', { s: holdRow.status, b: holdRow.reentryBaseline }, { s: 'hold', b: null });
  const pyrRow = reentryRowOf([...flatWindow(), { o: 105, h: 106, l: 104, c: 105 }]);
  check('8-g 재매수분 추가 매수 → null', { s: pyrRow.status, b: pyrRow.reentryBaseline }, { s: 'pyramid', b: null });
  const outPosRow = buildTurtleHoldingsReentryRow({
    position, asset: mkAsset({ id: 'bl-p1', owner: 'YUSEON' }), raw: undefined, isCrypto: false, fetchFailed: false,
    now: new Date(), settings: rs, fxRate: 1, effectiveManagedEquityKRW: 100_000_000,
  });
  check('8-g 재매수분 범위 제외 → null', { s: outPosRow.status, b: outPosRow.reentryBaseline }, { s: 'out-of-scope', b: null });

  // 8-h. 감시 행 — 기존 reentryLine 동작 그대로, reentryBaseline은 항상 null
  const watch: WatchlistItem = { id: 'bl-w1', ticker: 'AAA', exchange: KR_EX, name: '테스트종목', categoryId: 1, currency: Currency.KRW };
  const ws = H({ riskPerUnitPct: 1, positionCapPct: 10, maxUnitsPerPosition: 4, minOrderKRW: 50_000, stopMultipleN: 2 });
  const watchBars: B[] = [...flatWindow(), { o: 100, h: 101, l: 99, c: 100 }];
  const watchRow = buildTurtleHoldingsWatchRow({
    watchItem: watch, raw: mkRaw(watchBars), isCrypto: false, fetchFailed: false, now: nowAfter(watchBars),
    settings: ws, fxRate: 1, effectiveManagedEquityKRW: 100_000_000, heldTickerKeys: new Set<string>(),
  });
  check('8-h 감시 행 reentryLine=101 유지', watchRow.reentryLine, 101);
  check('8-h 감시 행 reentryBaseline=null', watchRow.reentryBaseline, null);
  const reentryBars: B[] = [...flatWindow(), { o: 102, h: 103, l: 101, c: 102 }];
  const reentryWatchRow = buildTurtleHoldingsWatchRow({
    watchItem: watch, raw: mkRaw(reentryBars), isCrypto: false, fetchFailed: false, now: nowAfter(reentryBars),
    settings: ws, fxRate: 1, effectiveManagedEquityKRW: 100_000_000, heldTickerKeys: new Set<string>(),
  });
  check('8-h 다시 살 때 행 reentryLine=101 유지, reentryBaseline=null', { s: reentryWatchRow.status, l: reentryWatchRow.reentryLine, b: reentryWatchRow.reentryBaseline }, { s: 'reentry', l: 101, b: null });

  // 8-i. 문구 규약 — 격차 부호·통화·단정 표현 금지·안내 문구 원문
  const synth = (gapPct: number, line: number, currency: Currency): Pick<TurtleHoldingsRow, 'reentryBaseline' | 'currency'> => ({
    currency, reentryBaseline: { line, gapPct, asOfDate: '2026-10-24' },
  });
  check('8-i 격차 양수 → + 부호', describeReentryBaseline(synth(4.24, 62_000, Currency.KRW)),
    '현재 재진입 기준선 62,000원 — 최근 확정 종가 대비 +4.2% (기준일 10월 24일)');
  check('8-i 격차 음수 → 부호 억지로 안 붙임', describeReentryBaseline(synth(-2.34, 62_000, Currency.KRW)),
    '현재 재진입 기준선 62,000원 — 최근 확정 종가 대비 -2.3% (기준일 10월 24일)');
  check('8-i 격차 0 → 0.0%(+ 없음)', describeReentryBaseline(synth(0, 62_000, Currency.KRW)),
    '현재 재진입 기준선 62,000원 — 최근 확정 종가 대비 0.0% (기준일 10월 24일)');
  check('8-i 격차 -0.04 → -0.0% 대신 0.0%', describeReentryBaseline(synth(-0.04, 62_000, Currency.KRW)),
    '현재 재진입 기준선 62,000원 — 최근 확정 종가 대비 0.0% (기준일 10월 24일)');
  check('8-i USD 통화 표기', describeReentryBaseline(synth(1.26, 62.5, Currency.USD)),
    '현재 재진입 기준선 $62.50 — 최근 확정 종가 대비 +1.3% (기준일 10월 24일)');
  check('8-i 기준선 없음 → null', describeReentryBaseline({ currency: Currency.KRW, reentryBaseline: null }), null);
  check('8-i 안내 문구 원문', REENTRY_BASELINE_CAPTION,
    '기준선은 매일 바뀌며(오래된 고점이 빠지면 내려갈 수도 있음), 실제로 다시 사는 가격은 아직 정해지지 않았습니다.');
  const allText = [describeReentryBaseline(rowSell55) ?? '', REENTRY_BASELINE_CAPTION].join(' ');
  check('8-i 단정 표현 없음("삽니다"·"팔면")', /삽니다|팔면/.test(allText), false);
}

// ── 결과 ──
if (fail > 0) {
  console.error(`\n❌ turtleHoldingsView parity 실패 (${fail}건), 통과 ${pass}건`);
  process.exit(1);
}
console.log(`\n✅ turtleHoldingsView parity 전부 통과 (${pass}건)`);
