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
import { RawSeries, DailyBar, resolveMarketTz, extractCompletedBars, extractBarsThroughSession } from '../utils/todayTurtle';
import { clip, KAKAO_TEXT_MAX } from '../utils/tradePlan';
import { closeConfirmTime, lastSessionDate } from '../utils/marketHours';
import {
  buildTurtleHoldingsLegacyRow,
  buildTurtleHoldingsReentryRow,
  buildTurtleHoldingsWatchRow,
} from '../utils/turtleHoldingsView';
import {
  evaluateLegacyHoldingForNotify,
  evaluateReentryPositionForNotify,
  evaluateWatchItemForNotify,
  decideTurtleCloseProgress,
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

// ════════════════════════════════════════════════════════════════════════════
console.log('8. decideTurtleCloseProgress — done / retry / give-up 경계');
// ════════════════════════════════════════════════════════════════════════════
{
  check('KR 2026-10-23 마감 확정 = 15:40 KST = 06:40Z', closeConfirmTime('KR', '2026-10-23'), '2026-10-23T06:40:00.000Z');
  const confirmAtMs = Date.parse(closeConfirmTime('KR', '2026-10-23'));
  const cutoffMs = confirmAtMs + 12 * 3_600_000;
  check('컷오프(확정 + 12h) = 18:40Z', new Date(cutoffMs).toISOString(), '2026-10-23T18:40:00.000Z');
  const base = { confirmAtMs, maxWaitHours: 12 };

  check('대기 0건(정착 직후) → done', decideTurtleCloseProgress({ ...base, pendingCount: 0, nowMs: confirmAtMs + 20 * 60_000 }), 'done');
  check('대기 0건은 컷오프 이후에도 done(포기 아님)', decideTurtleCloseProgress({ ...base, pendingCount: 0, nowMs: cutoffMs + 3_600_000 }), 'done');
  check('대기 3건 · 정착 직후 → retry', decideTurtleCloseProgress({ ...base, pendingCount: 3, nowMs: confirmAtMs + 20 * 60_000 }), 'retry');
  check('대기 1건 · 컷오프 1ms 전 → retry', decideTurtleCloseProgress({ ...base, pendingCount: 1, nowMs: cutoffMs - 1 }), 'retry');
  check('대기 1건 · 정확히 컷오프 → give-up', decideTurtleCloseProgress({ ...base, pendingCount: 1, nowMs: cutoffMs }), 'give-up');
  check('대기 1건 · 컷오프 1ms 후 → give-up', decideTurtleCloseProgress({ ...base, pendingCount: 1, nowMs: cutoffMs + 1 }), 'give-up');
  check('maxWaitHours 가 컷오프를 결정(1h: 확정+1h 정각 → give-up)', decideTurtleCloseProgress({ confirmAtMs, maxWaitHours: 1, pendingCount: 2, nowMs: confirmAtMs + 3_600_000 }), 'give-up');
}

// ════════════════════════════════════════════════════════════════════════════
// 9~11 공통 — closeCheck 터틀 파트의 "순수 조각 이어붙인 모델"
//
// ⚠ `scripts/notify/gas/entry.ts`의 `runTurtleCloseForMarket`은 GAS 전역(PropertiesService의
// `TURTLE_DONE_<market>`, `SENT_LOG_JSON`/`hasSent`)에 묶여 있어 Node 테스트에서 직접 실행할 수 없다.
// 그래서 아래 모델은 같은 **순수 조각**(extractBarsThroughSession + decideTurtleCloseProgress +
// evaluate*ForNotify + 멱등키 문자열)을 인메모리 저장소로 이어붙여 흐름의 기대값을 **명시적 절대값**으로 고정한다.
// TURTLE_DONE/hasSent 자체의 GAS 구현(getProp/setProp, SENT_LOG_JSON)은 이 테스트가 보증하지 않는다 —
// 순수 조각의 동작과 그 조합의 결과만 보증한다. (상수 20분/12시간은 entry.ts의
// TURTLE_CLOSE_SETTLE_MIN/TURTLE_MAX_WAIT_HOURS 와 같은 값을 손으로 맞춘 것이다.)
// ════════════════════════════════════════════════════════════════════════════
const SETTLE_MIN = 20;
const MAX_WAIT_HOURS = 12;

interface SimHolding { id: string; item: TurtleLegacyHoldingLike; raw: RawSeries | undefined }
interface SimStore { turtleDone: string | null; sent: string[] }
interface SimRun {
  /** 'before-settle' | 'already-done' | 'done' | 'retry' | 'give-up' */
  outcome: string;
  /** 세션 봉이 있어 실제로 판정한 종목 수. */
  evaluated: number;
  /** 세션 봉이 없어 판정하지 않은 종목 수. */
  pending: number;
  /** 이번 실행에서 새로 발송한 멱등키. */
  newlySent: string[];
  /** 이번 실행에서 새로 발송한 본문. */
  texts: string[];
}

function simulateCloseRun(holdings: SimHolding[], sessionDate: string, nowMs: number, confirmAtMs: number, store: SimStore): SimRun {
  if (nowMs < confirmAtMs + SETTLE_MIN * 60_000) return { outcome: 'before-settle', evaluated: 0, pending: 0, newlySent: [], texts: [] };
  if (store.turtleDone === sessionDate) return { outcome: 'already-done', evaluated: 0, pending: 0, newlySent: [], texts: [] };
  let evaluated = 0, pending = 0;
  const newlySent: string[] = [], texts: string[] = [];
  for (const h of holdings) {
    const r = extractBarsThroughSession(h.raw, sessionDate, true);
    if (!r.sessionBarPresent) { pending++; continue; }
    evaluated++;
    const c = evaluateLegacyHoldingForNotify(h.item, r.bars, S);
    if (!c) continue;
    const key = `turtle|legacy|${h.id}|${c.signal}|${sessionDate}`;
    if (store.sent.includes(key)) continue; // hasSent
    store.sent.push(key);
    newlySent.push(key);
    texts.push(c.text);
  }
  const progress = decideTurtleCloseProgress({ pendingCount: pending, nowMs, confirmAtMs, maxWaitHours: MAX_WAIT_HOURS });
  if (progress !== 'retry') store.turtleDone = sessionDate;
  return { outcome: progress, evaluated, pending, newlySent, texts };
}

/** 20봉 flat(low 100) + D-1 봉(종가 99 = 청산선 100 아래) + D 봉. 인덱스: flat 0..19, D-1 = 20, D = 21. */
const FLAT20: B[] = Array.from({ length: 20 }, () => ({ o: 101, h: 103, l: 100, c: 102 }));
const DM1_BELOW: B = { o: 101, h: 102, l: 98, c: 99 };
const D_BACK_ABOVE: B = { o: 99, h: 104, l: 99, c: 103 };
const D_SELL: B = { o: 99, h: 100, l: 96, c: 97 };
const OTTOGI: TurtleLegacyHoldingLike = { ticker: 'OTTOGI', name: '오뚜기', currency: Currency.KRW, quantity: 10 };
const SESSION_D = iso(21);   // 2026-01-22 (목)
const SESSION_DM1 = iso(20); // 2026-01-21 (수)

// ════════════════════════════════════════════════════════════════════════════
console.log('9. [장 마감 후 당일 봉 사용] closeConfirmTime 이후엔 세션 당일 봉으로 판정 (D-1 종가를 "마감"이라 보내던 버그 회귀)');
// ════════════════════════════════════════════════════════════════════════════
{
  const confirmIso = closeConfirmTime('KR', SESSION_D);
  check('KR 세션 D 마감 확정 = 15:40 KST', confirmIso, '2026-01-22T06:40:00.000Z');
  const closeCheckNowMs = Date.parse(confirmIso) + 6 * 60_000; // 15:46 KST — 실제 트리거 시각대
  check('closeCheck 15:46 KST ≥ 마감 확정', closeCheckNowMs >= Date.parse(confirmIso), true);

  // 실사용 사례: D-1 은 청산선 아래로 마감했지만 D 에서 다시 청산선 위로 마감.
  const raw = mkRaw([...FLAT20, DM1_BELOW, D_BACK_ABOVE]);

  // (a) 신규 경로: 세션 D 봉까지 포함 → 마지막 봉 = D(종가 103 > D 기준 청산선 98) → 매도 후보 없음.
  const through = extractBarsThroughSession(raw, SESSION_D, true);
  check('(a) 세션 D 봉 존재', through.sessionBarPresent, true);
  check('(a) 마지막 봉 = D, 종가 103', [through.lastBarDate, through.bars[through.bars.length - 1].close], [SESSION_D, 103]);
  ok('(a) D 에서 청산선 위로 회복 → 매도 후보 없음(null)', evaluateLegacyHoldingForNotify(OTTOGI, through.bars, S) === null);

  // (b) 옛 경로(버그 재현): extractCompletedBars 는 KR 현지 "오늘"=D 라서 D 봉을 잘라 D-1 이 마지막 봉이 된다.
  //     D-1 종가 99 ≤ 청산선 100 → "…이하로 마감 (종가 99원)" 매도 후보가 나와 버렸다(전일 종가를 오늘 마감처럼 발송).
  const oldBars = extractCompletedBars(raw, 'KR', new Date(closeCheckNowMs)).bars;
  check('(b) 옛 경로 마지막 봉 = D-1', oldBars[oldBars.length - 1].date, SESSION_DM1);
  const oldCand = evaluateLegacyHoldingForNotify(OTTOGI, oldBars, S);
  check('(b) 옛 경로는 매도 후보를 만들었다(버그)', oldCand?.signal, 'legacy-sell');
  check('(b) 옛 경로 본문 = D-1 종가(99원)', oldCand?.text,
    '🔵 [팔 때] 오뚜기 — 20일 최저가 100원 이하로 마감 (종가 99원)\n' +
    '보유 10주 매도 검토 후 앱에서 [팔았음 기록]하세요.');
  // 같은 "D-1 까지만" 뷰는 includeSession=false 로도 만들 수 있다 — 마감 전 아침 요약 등에서만 허용되는 뷰.
  const dm1Only = extractBarsThroughSession(raw, SESSION_D, false);
  check('(b) includeSession=false 뷰 = D-1 까지(sessionBarPresent=false)', [dm1Only.lastBarDate, dm1Only.sessionBarPresent], [SESSION_DM1, false]);
  check('(b) 그 뷰는 매도 후보를 낸다(= 마감 후에 쓰면 안 되는 이유)', evaluateLegacyHoldingForNotify(OTTOGI, dm1Only.bars, S)?.signal, 'legacy-sell');

  // (c) 모델 실행: 마감 후 첫 실행(정착 15:40+20분 = 16:00 이후) → D 봉 평가, 후보 없음, 세션 닫힘(done).
  const store: SimStore = { turtleDone: null, sent: [] };
  const run = simulateCloseRun([{ id: 'a1', item: OTTOGI, raw }], SESSION_D, Date.parse(confirmIso) + 66 * 60_000, Date.parse(confirmIso), store);
  check('(c) 16:46 KST 실행: 평가 1건·대기 0·발송 0·done', [run.outcome, run.evaluated, run.pending, run.newlySent.length], ['done', 1, 0, 0]);
  check('(c) TURTLE_DONE = D', store.turtleDone, SESSION_D);

  // (d) 확정 봉(D)이 실제로 청산선 아래로 마감한 날은 D 종가로 발송한다(종가 97원, 청산선 98원 — D-1 의 99/100 아님).
  const rawSell = mkRaw([...FLAT20, DM1_BELOW, D_SELL]);
  const storeSell: SimStore = { turtleDone: null, sent: [] };
  const runSell = simulateCloseRun([{ id: 'a1', item: OTTOGI, raw: rawSell }], SESSION_D, Date.parse(confirmIso) + 66 * 60_000, Date.parse(confirmIso), storeSell);
  check('(d) D 봉이 청산선 아래 → 발송 1건', [runSell.outcome, runSell.newlySent], ['done', [`turtle|legacy|a1|legacy-sell|${SESSION_D}`]]);
  check('(d) 본문 = D 종가 97원 / D 기준 청산선 98원', runSell.texts[0],
    '🔵 [팔 때] 오뚜기 — 20일 최저가 98원 이하로 마감 (종가 97원)\n' +
    '보유 10주 매도 검토 후 앱에서 [팔았음 기록]하세요.');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('10. [휴장일 중복 발송 방지] 세션 봉이 없으면 판정 0건 · 컷오프 후 give-up · 멱등키가 전일 알림을 새 키로 재발송하지 않음');
// ════════════════════════════════════════════════════════════════════════════
{
  // 전일 D-1(수) 은 정상 거래일: D-1 봉이 청산선 아래로 마감 → 정상 발송 1건.
  // D(목) 은 휴장일: 공급자에 D 봉이 없다(마지막 봉 = D-1). 옛 코드는 휴장일마다 D-1 봉을 다시 평가해
  //   키 `…|<휴장일>` 로 같은 문구를 재발송했다(2026-10-05·10-09 실사용 12건).
  const rawThroughDm1 = mkRaw([...FLAT20, DM1_BELOW]);
  const store: SimStore = { turtleDone: null, sent: [] };

  const confirmDm1 = Date.parse(closeConfirmTime('KR', SESSION_DM1));
  const runDm1 = simulateCloseRun([{ id: 'a1', item: OTTOGI, raw: rawThroughDm1 }], SESSION_DM1, confirmDm1 + 66 * 60_000, confirmDm1, store);
  check('D-1(정상 거래일) 세션: 평가 1·발송 1·done', [runDm1.outcome, runDm1.evaluated, runDm1.pending, runDm1.newlySent], ['done', 1, 0, [`turtle|legacy|a1|legacy-sell|${SESSION_DM1}`]]);
  check('D-1 본문(종가 99원)', runDm1.texts[0],
    '🔵 [팔 때] 오뚜기 — 20일 최저가 100원 이하로 마감 (종가 99원)\n' +
    '보유 10주 매도 검토 후 앱에서 [팔았음 기록]하세요.');

  // 휴장일 세션 D: 봉 없음 → sessionBarPresent=false.
  const viewD = extractBarsThroughSession(rawThroughDm1, SESSION_D, true);
  check('휴장일 D: 세션 봉 없음, 마지막 봉 = D-1', [viewD.sessionBarPresent, viewD.lastBarDate], [false, SESSION_DM1]);

  const confirmD = Date.parse(closeConfirmTime('KR', SESSION_D));
  // 시간별 트리거: 정착 직후·몇 시간 뒤 모두 retry(발송 0, 평가 0, 대기 1), TURTLE_DONE 미기록.
  const hourly = [66, 126, 186, 666].map(min =>
    simulateCloseRun([{ id: 'a1', item: OTTOGI, raw: rawThroughDm1 }], SESSION_D, confirmD + min * 60_000, confirmD, store));
  check('휴장일: 컷오프 전 매시간 retry · 평가 0 · 대기 1 · 발송 0',
    hourly.map(r => [r.outcome, r.evaluated, r.pending, r.newlySent.length]),
    [['retry', 0, 1, 0], ['retry', 0, 1, 0], ['retry', 0, 1, 0], ['retry', 0, 1, 0]]);
  check('휴장일: 컷오프 전에는 TURTLE_DONE 미기록 (D-1 세션 기록은 그대로)', store.turtleDone, SESSION_DM1);

  // 컷오프(확정 + 12h) 정각 실행 → give-up: 세션을 닫지만 **발송은 없다**.
  const giveUp = simulateCloseRun([{ id: 'a1', item: OTTOGI, raw: rawThroughDm1 }], SESSION_D, confirmD + 12 * 3_600_000, confirmD, store);
  check('휴장일: 컷오프에서 give-up · 평가 0 · 대기 1 · 발송 0', [giveUp.outcome, giveUp.evaluated, giveUp.pending, giveUp.newlySent.length], ['give-up', 0, 1, 0]);
  check('휴장일: give-up 후 TURTLE_DONE = D (더 이상 재시도하지 않음)', store.turtleDone, SESSION_D);
  const after = simulateCloseRun([{ id: 'a1', item: OTTOGI, raw: rawThroughDm1 }], SESSION_D, confirmD + 13 * 3_600_000, confirmD, store);
  check('휴장일: give-up 이후 실행은 건너뜀', [after.outcome, after.newlySent.length], ['already-done', 0]);

  // 멱등키: 발송된 키는 봉이 실제로 있었던 세션(D-1)에만 묶여 있다 — 휴장일 키(…|D)가 새로 생기지 않았다.
  check('발송 이력 = D-1 키 1건뿐 (휴장일 키 없음 → 전일 알림이 새 키로 재발송되지 않음)', store.sent, [`turtle|legacy|a1|legacy-sell|${SESSION_DM1}`]);

  // 대조: 옛 경로는 휴장일 D 에 같은 D-1 봉을 평가해 **다른 키**로 같은 문구를 다시 만든다 → 중복 발송의 원인.
  const oldHolidayBars = extractCompletedBars(rawThroughDm1, 'KR', new Date(confirmD + 66 * 60_000)).bars;
  const oldHolidayCand = evaluateLegacyHoldingForNotify(OTTOGI, oldHolidayBars, S);
  check('대조: 옛 경로는 휴장일에도 매도 후보를 만든다(버그)', oldHolidayCand?.signal, 'legacy-sell');
  check('대조: 옛 키는 휴장일 날짜로 달라져 hasSent 를 통과했다', `turtle|legacy|a1|legacy-sell|${SESSION_D}` !== `turtle|legacy|a1|legacy-sell|${SESSION_DM1}`, true);

  // marketHours 는 공휴일을 모르므로 평일 휴장일도 세션 날짜가 된다 — 그래서 봉 존재 확인이 유일한 방어선이다.
  check('lastSessionDate(KR) 는 2026-10-09(한글날, 휴장)도 세션으로 본다', lastSessionDate('KR', '2026-10-09T06:46:00Z'), '2026-10-09');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('11. [데이터 지연 시 재시도] 봉이 늦으면 retry(TURTLE_DONE 미기록) → 다음 실행에서 봉이 오면 1번만 평가·발송');
// ════════════════════════════════════════════════════════════════════════════
{
  // 종목 A: D 봉이 처음부터 있고 D 에서 청산선 아래 마감. 종목 B: 공급자가 늦어 첫 실행에는 D 봉이 없고, 다음 실행에 도착.
  // (모델은 순수 조각을 인메모리 저장소로 이어붙인 것 — 위 ⚠ 주석 참고. GAS getProp/setProp/hasSent 자체는 미검증.)
  const rawA = mkRaw([...FLAT20, DM1_BELOW, D_SELL]);
  const rawBLate = mkRaw([...FLAT20, DM1_BELOW]);          // D 봉 아직 없음
  const rawBArrived = mkRaw([...FLAT20, DM1_BELOW, D_SELL]); // 다음 실행에는 도착
  const itemB: TurtleLegacyHoldingLike = { ticker: 'SAMSUNG', name: '삼성전자', currency: Currency.KRW, quantity: 5 };
  const confirmMs = Date.parse(closeConfirmTime('KR', SESSION_D));
  const store: SimStore = { turtleDone: null, sent: [] };
  const holdingsRun1: SimHolding[] = [{ id: 'a', item: OTTOGI, raw: rawA }, { id: 'b', item: itemB, raw: rawBLate }];
  const holdingsRun2: SimHolding[] = [{ id: 'a', item: OTTOGI, raw: rawA }, { id: 'b', item: itemB, raw: rawBArrived }];

  // 정착 전(15:50 KST = 확정 + 10분)에는 아무것도 하지 않는다.
  const early = simulateCloseRun(holdingsRun1, SESSION_D, confirmMs + 10 * 60_000, confirmMs, store);
  check('정착(20분) 전 실행은 건너뜀', [early.outcome, early.evaluated, early.newlySent.length, store.turtleDone], ['before-settle', 0, 0, null]);

  // 1차 실행(정착 후): A 는 판정·발송, B 는 봉 대기 → retry, TURTLE_DONE 미기록.
  const run1 = simulateCloseRun(holdingsRun1, SESSION_D, confirmMs + 66 * 60_000, confirmMs, store);
  check('1차: retry · 평가 1(A) · 대기 1(B) · TURTLE_DONE 미기록', [run1.outcome, run1.evaluated, run1.pending, store.turtleDone], ['retry', 1, 1, null]);
  check('1차: A 만 발송', run1.newlySent, [`turtle|legacy|a|legacy-sell|${SESSION_D}`]);

  // 2차 실행(다음 시간): B 봉 도착 → B 판정·발송, A 는 hasSent 로 중복 발송 안 함, 대기 0 → done.
  const run2 = simulateCloseRun(holdingsRun2, SESSION_D, confirmMs + 126 * 60_000, confirmMs, store);
  check('2차: done · 평가 2(A,B) · 대기 0', [run2.outcome, run2.evaluated, run2.pending], ['done', 2, 0]);
  check('2차: B 만 새로 발송 (A 는 중복 방지)', run2.newlySent, [`turtle|legacy|b|legacy-sell|${SESSION_D}`]);
  check('2차 후 TURTLE_DONE = D', store.turtleDone, SESSION_D);
  check('발송 이력은 종목당 정확히 1건', store.sent, [`turtle|legacy|a|legacy-sell|${SESSION_D}`, `turtle|legacy|b|legacy-sell|${SESSION_D}`]);

  // 3차 실행: 세션이 닫혔으므로 재평가·재발송 없음.
  const run3 = simulateCloseRun(holdingsRun2, SESSION_D, confirmMs + 186 * 60_000, confirmMs, store);
  check('3차: 이미 처리된 세션 → 건너뜀 · 발송 0', [run3.outcome, run3.newlySent.length, store.sent.length], ['already-done', 0, 2]);

  // 순수 조각 단독 확인: B 봉이 늦은 시점 vs 도착 시점의 sessionBarPresent.
  check('B 봉 지연 시 sessionBarPresent=false', extractBarsThroughSession(rawBLate, SESSION_D, true).sessionBarPresent, false);
  check('B 봉 도착 후 sessionBarPresent=true', extractBarsThroughSession(rawBArrived, SESSION_D, true).sessionBarPresent, true);
  check('지연 중 + 컷오프 전 → retry', decideTurtleCloseProgress({ pendingCount: 1, nowMs: confirmMs + 126 * 60_000, confirmAtMs: confirmMs, maxWaitHours: 12 }), 'retry');
  check('도착 후 대기 0 → done', decideTurtleCloseProgress({ pendingCount: 0, nowMs: confirmMs + 126 * 60_000, confirmAtMs: confirmMs, maxWaitHours: 12 }), 'done');
}

// ── 결과 ──
console.log('');
if (fail > 0) {
  console.error(`❌ turtleHoldingsNotify parity 실패 (${fail}/${pass + fail})`);
  process.exit(1);
}
console.log(`✅ turtleHoldingsNotify parity 전체 통과 (${pass} 단언)`);
