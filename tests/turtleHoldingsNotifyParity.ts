// tests/turtleHoldingsNotifyParity.ts
// ---------------------------------------------------------------------------
// utils/turtleHoldingsNotify.ts 골든 테스트 — 카카오톡 알림(GAS) "보유종목 터틀" 문구 조립
// (계획서 `docs/PLAN_터틀중심_앱재정비_260925.md` §4.5·§6 P4).
//
// 명시적 절대값만 고정한다(RULES §13 — 경로A-vs-경로B 자기참조 비교 금지). 다만 불타기(N 의존) 시나리오는
// ATR을 정확히 21봉(=period+1)으로 맞춰 Wilder 재귀 없이 "첫 20개 TR 단순평균"만으로 손계산했다
// (tests/turtleHoldingsViewParity.ts와 동일 기법).
//
// 교차 단언(§): 같은 합성 일봉 입력에서 이 파일의 순수 판정(GAS가 그대로 쓰는 함수)과
// utils/turtleHoldingsView.ts의 화면 행 빌더(P2, GAS는 쓰지 않지만 같은 utils/turtleHoldings.ts P0
// 공식을 공유한다)가 같은 "상태 방향"을 내는지 확인한다 — 두 소비자가 같은 계산에서 갈라지지 않는다.
//
// 실행: npx tsx tests/turtleHoldingsNotifyParity.ts

import { Currency, WatchlistItem } from '../types';
import { EnrichedAsset } from '../types/ui';
import { TurtlePosition } from '../types/turtle';
import { DEFAULT_TURTLE_HOLDINGS_SETTINGS } from '../types/turtleHoldings';
import { RawSeries, DailyBar, resolveMarketTz, extractCompletedBars } from '../utils/todayTurtle';
import { clip, KAKAO_TEXT_MAX } from '../utils/tradePlan';
import {
  buildTurtleHoldingsLegacyRow,
  buildTurtleHoldingsReentryRow,
  buildTurtleHoldingsWatchRow,
} from '../utils/turtleHoldingsView';
import {
  evaluateLegacyHoldingForNotify,
  evaluateReentryPositionForNotify,
  evaluateWatchItemForNotify,
  formatTurtleMorningDigest,
  TurtleLegacyHoldingLike,
  TurtleReentryPositionLike,
  TurtleWatchItemLike,
} from '../utils/turtleHoldingsNotify';

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else { fail++; console.error(`  ✗ ${name}\n      기대=${e}\n      실제=${a}`); }
}
function ok(name: string, cond: boolean): void {
  if (cond) pass++; else { fail++; console.error(`  ✗ ${name}`); }
}

const KR_EX = 'KRX (코스피/코스닥)';
const US_EX = 'NASDAQ';

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
function mkBars(bars: B[]): DailyBar[] {
  return bars.map((b, i) => ({ date: iso(i), open: b.o, high: b.h, low: b.l, close: b.c }));
}
/** 마지막 봉 다음날 정오(UTC)를 "오늘"로 → 전부 완료봉. */
function nowAfter(bars: B[]): Date {
  return new Date(Date.parse(`${iso(bars.length)}T12:00:00Z`));
}

const S = DEFAULT_TURTLE_HOLDINGS_SETTINGS; // exitLookback=20, entryLookback=55, stopMultipleN=2, pyramidSpacing='2R'

console.log('turtleHoldingsNotify — 골든 테스트\n');

// ════════════════════════════════════════════════════════════════════════════
console.log('1. evaluateLegacyHoldingForNotify — 팔 때(청산선 이하 경계) 골든 문구');
// ════════════════════════════════════════════════════════════════════════════
{
  // 20일 최저가 311,500원 — 직전 20봉 low 전부 311,500, D봉 종가도 311,500(경계 "이하")
  const prior = Array.from({ length: 20 }, () => ({ o: 311_500, h: 312_000, l: 311_500, c: 311_800 }));
  const d = { o: 311_500, h: 311_600, l: 311_000, c: 311_500 };
  const bars = mkBars([...prior, d]);
  const item: TurtleLegacyHoldingLike = { ticker: 'OTTOGI', name: '오뚜기', currency: Currency.KRW, quantity: 10 };

  const c = evaluateLegacyHoldingForNotify(item, bars, S);
  ok('팔 때 후보 생성됨', c !== null);
  check('signal=legacy-sell', c?.signal, 'legacy-sell');
  check('summary', c?.summary, '오뚜기 팔 때');
  check('본문 골든', c?.text,
    '🔵 [팔 때] 오뚜기 — 20일 최저가 311,500원 이하로 마감 (종가 311,500원)\n' +
    '보유 10주 매도 검토 후 앱에서 [팔았음 기록]하세요.');

  // 경계 위(마감이 청산선 위) → 신호 없음
  const noSell = evaluateLegacyHoldingForNotify(item, mkBars([...prior, { ...d, c: 311_900 }]), S);
  ok('청산선 위 마감 → null(신호 없음)', noSell === null);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('2. evaluateReentryPositionForNotify — 손절 이탈(USD $ 표기) 골든 문구');
// ════════════════════════════════════════════════════════════════════════════
{
  const bars = mkBars([{ o: 149, h: 151, l: 147, c: 148.25 }]);
  const item: TurtleReentryPositionLike = {
    ticker: 'AAPL', name: 'AAPL', currency: Currency.USD, quantity: 10,
    units: [{ fillPrice: 160, quantity: 10, nAtFill: 5 }],
    stopPrice: 150.5, openedAt: iso(0),
  };
  const c = evaluateReentryPositionForNotify(item, bars, S);
  ok('손절 이탈 후보 생성됨', c !== null);
  check('signal=reentry-stop', c?.signal, 'reentry-stop');
  check('summary', c?.summary, 'AAPL 손절 이탈');
  check('본문 골든(USD $ 표기)', c?.text,
    '🟠 [손절 이탈] AAPL — 손절가 $150.50 아래로 마감했습니다(종가 $148.25).\n' +
    '손절 매도 후 앱에서 [팔았음 기록]하세요.');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('3. evaluateReentryPositionForNotify — 2R 불타기(추가 매수) 도달 경계 골든 문구');
// ════════════════════════════════════════════════════════════════════════════
{
  // 21봉 전부 동일(open60000/high61000/low60000/close60500) → TR=max(1000,500,500)=1000(전부) → N=1000(단순평균)
  const flat = Array.from({ length: 21 }, () => ({ o: 60_000, h: 61_000, l: 60_000, c: 60_500 }));
  const bars = mkBars(flat);
  // 청산선(donchian 20) = 직전 20봉 low 최솟값 = 60,000 < lastClose(60,500) → 청산 아님
  // 손절가 55,000 < lastClose → 손절 아님
  // 트리거 = lastFillPrice(56,500) + 2×stopMultipleN(2)×N(1000) = 56,500+4,000 = 60,500 = lastClose(경계 "이상")
  const item: TurtleReentryPositionLike = {
    ticker: 'SAMSUNG', name: '삼성전자', currency: Currency.KRW, quantity: 50,
    units: [{ fillPrice: 56_500, quantity: 50, nAtFill: 1_000 }],
    stopPrice: 55_000, openedAt: iso(0),
  };
  const c = evaluateReentryPositionForNotify(item, bars, S);
  ok('불타기 후보 생성됨', c !== null);
  check('signal=reentry-pyramid', c?.signal, 'reentry-pyramid');
  check('summary', c?.summary, '삼성전자 추가 매수');
  check('본문 골든', c?.text,
    '🔺 [추가 매수] 삼성전자 — 마지막 매수가 56,500원에서 4,000원 오른 60,500원 이상으로 마감해 추가 매수(불타기) 기준을 충족했습니다.\n' +
    '계획대로 추가 매수 후 앱에서 [샀음 기록]하세요(손절선이 상향됩니다).');

  // 유닛 한도 도달(4/4) → N이 있어도 불타기 미판정(신호 없음)
  const capped: TurtleReentryPositionLike = {
    ...item,
    units: [
      { fillPrice: 50_000, quantity: 10, nAtFill: 1000 },
      { fillPrice: 52_000, quantity: 10, nAtFill: 1000 },
      { fillPrice: 54_000, quantity: 10, nAtFill: 1000 },
      { fillPrice: 56_500, quantity: 10, nAtFill: 1000 },
    ],
  };
  ok('유닛 4/4(한도) → 불타기 미판정(신호 없음)', evaluateReentryPositionForNotify(capped, bars, S) === null);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('4. evaluateWatchItemForNotify — 다시 살 때(55일 최고가 돌파) 골든 문구');
// ════════════════════════════════════════════════════════════════════════════
{
  const prior = Array.from({ length: 55 }, () => ({ o: 59_000, h: 60_000, l: 58_500, c: 59_500 }));
  const d = { o: 60_100, h: 60_500, l: 60_000, c: 60_400 };
  const bars = mkBars([...prior, d]);
  const item: TurtleWatchItemLike = { ticker: 'HYUNDAI', name: '현대차', currency: Currency.KRW };

  const c = evaluateWatchItemForNotify(item, bars, S);
  ok('다시 살 때 후보 생성됨', c !== null);
  check('signal=watch-reentry', c?.signal, 'watch-reentry');
  check('summary', c?.summary, '현대차 다시 살 때');
  check('본문 골든', c?.text,
    '🔺 [다시 살 때] 현대차 — 55일 최고가 60,000원 위로 마감 (종가 60,400원)\n' +
    '앱에서 재매수 계산기를 확인하고 [샀음 기록]하세요.');

  const noBreak = evaluateWatchItemForNotify(item, mkBars([...prior, { ...d, c: 59_900 }]), S);
  ok('돌파 미달 → null(신호 없음)', noBreak === null);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('5. clip — 200자 초과 시 분할(말줄임표)');
// ════════════════════════════════════════════════════════════════════════════
{
  const long = 'A'.repeat(250);
  const clipped = clip(long);
  ok('KAKAO_TEXT_MAX=200', KAKAO_TEXT_MAX === 200);
  ok('길이<=200', clipped.length <= 200);
  ok('말줄임표로 끝남', clipped.endsWith('…'));
  check('짧은 문자열은 그대로', clip('short'), 'short');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('6. formatTurtleMorningDigest — 아침 요약(건수+종목명)');
// ════════════════════════════════════════════════════════════════════════════
{
  ok('전부 0건 → null(스팸 방지)', formatTurtleMorningDigest({ sellNames: [], reentryNames: [], pyramidNames: [] }) === null);
  const text = formatTurtleMorningDigest({
    sellNames: ['오뚜기', '삼성전자'], reentryNames: ['현대차'], pyramidNames: [],
  });
  check('건수+종목명 골든', text, '📋 [터틀 오늘 할 일] 팔 때 2(오뚜기, 삼성전자) · 다시 살 때 1(현대차)');
  const many = formatTurtleMorningDigest({ sellNames: ['A', 'B', 'C', 'D', 'E'], reentryNames: [], pyramidNames: [] });
  check('4건 초과 → 상위 3 + 외 N건', many, '📋 [터틀 오늘 할 일] 팔 때 5(A, B, C 외 2)');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('7. 교차 단언 — GAS 판정(turtleHoldingsNotify) vs 앱 view-model(turtleHoldingsView) 상태 일치');
// ════════════════════════════════════════════════════════════════════════════
function mkEnrichedAsset(over: Partial<EnrichedAsset> & { id: string }): EnrichedAsset {
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
{
  // 7a. legacy — 청산선 이하로 마감(팔 때) vs buildTurtleHoldingsLegacyRow
  const prior = Array.from({ length: 20 }, () => ({ o: 100, h: 101, l: 99, c: 100 }));
  const sellDay = { o: 98, h: 99, l: 97, c: 98 }; // low(99) 아래로 마감
  const rawBars = [...prior, sellDay];
  const raw = mkRaw(rawBars);
  const now = nowAfter(rawBars);
  const marketTz = resolveMarketTz(KR_EX, false);
  const bars = extractCompletedBars(raw, marketTz, now).bars;

  const asset = mkEnrichedAsset({ id: 'a1', ticker: 'OTTOGI', exchange: KR_EX });
  const row = buildTurtleHoldingsLegacyRow({ asset, raw, isCrypto: false, fetchFailed: false, now, settings: S });
  const notifyItem: TurtleLegacyHoldingLike = { ticker: 'OTTOGI', name: '오뚜기', currency: Currency.KRW, quantity: 10 };
  const notify = evaluateLegacyHoldingForNotify(notifyItem, bars, S);
  check('legacy row.status', row.status, 'sell');
  ok('GAS 판정도 팔 때 신호 생성 — view와 방향 일치', notify !== null && notify.signal === 'legacy-sell');

  // 보유 유지 쪽(청산선 위) — 둘 다 신호 없음
  const holdRawBars = [...prior, { o: 100, h: 102, l: 100, c: 101 }];
  const holdRaw = mkRaw(holdRawBars);
  const holdNow = nowAfter(holdRawBars);
  const holdBars = extractCompletedBars(holdRaw, marketTz, holdNow).bars;
  const holdRow = buildTurtleHoldingsLegacyRow({ asset, raw: holdRaw, isCrypto: false, fetchFailed: false, now: holdNow, settings: S });
  const holdNotify = evaluateLegacyHoldingForNotify(notifyItem, holdBars, S);
  check('legacy row.status(보유 유지)', holdRow.status, 'hold');
  ok('GAS 판정도 신호 없음 — view와 방향 일치', holdNotify === null);
}
{
  // 7b. reentry — 불타기 도달 vs buildTurtleHoldingsReentryRow (동일 21봉 flat 픽스처 재사용)
  const flat = Array.from({ length: 21 }, () => ({ o: 60_000, h: 61_000, l: 60_000, c: 60_500 }));
  const raw = mkRaw(flat);
  const now = nowAfter(flat);
  const marketTz = resolveMarketTz(KR_EX, false);
  const bars = extractCompletedBars(raw, marketTz, now).bars;

  const asset = mkEnrichedAsset({ id: 'a2', ticker: 'SAMSUNG', exchange: KR_EX, name: '삼성전자' });
  const position: TurtlePosition = {
    id: 'pos1', ticker: 'SAMSUNG', name: '삼성전자', assetId: 'a2',
    units: [{ fillDate: iso(0), fillPrice: 56_500, quantity: 50, nAtFill: 1_000 }],
    stopPrice: 55_000, entryDonchianHigh: 61_000, status: 'open', openedAt: iso(0), origin: 'holdings-reentry',
  };
  const row = buildTurtleHoldingsReentryRow({
    position, asset, raw, isCrypto: false, fetchFailed: false, now, settings: S, fxRate: 1, effectiveManagedEquityKRW: 1_000_000_000,
  });
  const notifyItem: TurtleReentryPositionLike = {
    ticker: 'SAMSUNG', name: '삼성전자', currency: Currency.KRW, quantity: 50,
    units: [{ fillPrice: 56_500, quantity: 50, nAtFill: 1_000 }], stopPrice: 55_000, openedAt: iso(0),
  };
  const notify = evaluateReentryPositionForNotify(notifyItem, bars, S);
  check('reentry row.status', row.status, 'pyramid');
  ok('GAS 판정도 불타기 신호 생성 — view와 방향 일치', notify !== null && notify.signal === 'reentry-pyramid');
}
{
  // 7c. watch — 55일 돌파 vs buildTurtleHoldingsWatchRow
  const prior = Array.from({ length: 55 }, () => ({ o: 59_000, h: 60_000, l: 58_500, c: 59_500 }));
  const d = { o: 60_100, h: 60_500, l: 60_000, c: 60_400 };
  const rawBars = [...prior, d];
  const raw = mkRaw(rawBars);
  const now = nowAfter(rawBars);
  const marketTz = resolveMarketTz(US_EX, false);
  const bars = extractCompletedBars(raw, marketTz, now).bars;

  const watchItem: WatchlistItem = { id: 'w1', ticker: 'HYUNDAI', exchange: US_EX, name: '현대차', categoryId: 1, isTurtleCandidate: true };
  const row = buildTurtleHoldingsWatchRow({
    watchItem, raw, isCrypto: false, fetchFailed: false, now, settings: S, fxRate: 1,
    effectiveManagedEquityKRW: 1_000_000_000, heldTickerKeys: new Set(),
  });
  const notifyItem: TurtleWatchItemLike = { ticker: 'HYUNDAI', name: '현대차', currency: Currency.KRW };
  const notify = evaluateWatchItemForNotify(notifyItem, bars, S);
  check('watch row.status', row.status, 'reentry');
  ok('GAS 판정도 다시 살 때 신호 생성 — view와 방향 일치', notify !== null && notify.signal === 'watch-reentry');
}

// ── 결과 ──
console.log('');
if (fail > 0) {
  console.error(`❌ turtleHoldingsNotify parity 실패 (${fail}/${pass + fail})`);
  process.exit(1);
}
console.log(`✅ turtleHoldingsNotify parity 전체 통과 (${pass} 단언)`);
