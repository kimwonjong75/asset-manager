// tests/todayTurtleParity.ts
// ---------------------------------------------------------------------------
// "오늘의 터틀 확인" 읽기 전용 카드 + 터틀 안전잠금 대상 테스트.
// 명시적 골든 절대값을 고정한다 (RULES §13 — 경로A-vs-경로B 자기참조 비교 금지).
//
// 실행: npx tsx tests/todayTurtleParity.ts

import {
  isValidBar, resolveMarketTz, todayInTz, extractCompletedBars,
  entryBreakoutLine, exitChannelLine, buildWatchRow, buildPositionRow, buildLegacyRow,
  sortRows, summarizeRows, rowSortRank, todayInstrumentKey, isWaitingRow,
  isValidStopPrice, buildTodayRequestKey, isStaleResponse,
  ENTRY_MIN_BARS, EXIT_MIN_BARS, RawSeries,
} from '../utils/todayTurtle';
import { readFileSync } from 'fs';
import { resolvePositionAsset } from '../hooks/useTodayTurtle';
import { TodayRow, LegacySatelliteRow } from '../types/todayTurtle';
import { Asset, Currency } from '../types';
import { matchesOwnerFilter, type OwnerId } from '../types/owner';
import {
  isTurtleOrderLocked, isActionExecutionLocked, isLockedActionKind,
  turtleLockState, TURTLE_ORDER_POLICY, LOCKED_ACTION_KINDS, TURTLE_LOCK_MESSAGE,
} from '../types/turtleLock';
import { summarizeActiveQueue, summarizePreview, buildTurtleReviewSummary, countLockedActive } from '../utils/turtleReview';
import { ActionItem, ActionKind } from '../types/actionQueue';
import { normalizeExchange } from '../types';

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  if (Object.is(actual, expected)) pass++;
  else { fail++; console.error(`  ✗ ${name}\n      기대=${String(expected)} 실제=${String(actual)}`); }
}
function checkClose(name: string, actual: number, expected: number, tol = 1e-9): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) pass++;
  else { fail++; console.error(`  ✗ ${name}\n      기대=${expected} 실제=${actual}`); }
}
function checkTrue(name: string, v: boolean): void { check(name, v, true); }

// ── 합성 데이터 ────────────────────────────────────────────────────────────
function iso(i: number): string {
  return new Date(Date.parse('2026-01-01T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10);
}
interface B { o: number | null; h: number | null; l: number | null; c: number | null }
function flat(): B { return { o: 100, h: 102, l: 98, c: 100 }; }

/** n개 봉 + 꼬리 → RawSeries. 날짜는 iso(0..) */
function mkRaw(bars: B[]): RawSeries {
  const data: Record<string, number> = {}, open: Record<string, number> = {},
    high: Record<string, number> = {}, low: Record<string, number> = {};
  bars.forEach((b, i) => {
    const d = iso(i);
    if (b.c != null) data[d] = b.c;
    if (b.o != null) open[d] = b.o;
    if (b.h != null) high[d] = b.h;
    if (b.l != null) low[d] = b.l;
  });
  return { data, open, high, low };
}
/** 마지막 봉 다음날을 "오늘"로 → 모든 봉이 완료봉 (UTC 기준) */
function nowAfter(bars: B[]): Date {
  return new Date(Date.parse(`${iso(bars.length)}T12:00:00Z`));
}

const CRYPTO_EX = '주요 거래소 (종합)';
const US_EX = 'NASDAQ';
const KR_EX = 'KRX (코스피/코스닥)';

console.log('오늘의 터틀 확인 — 대상 테스트\n');

// ════════════════════════════════════════════════════════════════════════════
console.log('1. 유효 OHLC — 비정상 행이 기간 슬롯을 차지하지 않음');
// ════════════════════════════════════════════════════════════════════════════
{
  check('정상 봉', isValidBar(100, 102, 98, 100), true);
  check('경계: low=open=high=close', isValidBar(100, 100, 100, 100), true);
  check('null 포함 → 무효', isValidBar(100, null, 98, 100), false);
  check('전부 null → 무효', isValidBar(null, null, null, null), false);
  check('0 → 무효', isValidBar(100, 102, 0, 100), false);
  check('음수 → 무효', isValidBar(-1, 102, 98, 100), false);
  check('low > high → 무효', isValidBar(100, 98, 102, 100), false);
  check('open > high → 무효', isValidBar(103, 102, 98, 100), false);
  check('close > high → 무효', isValidBar(100, 102, 98, 103), false);
  check('close < low → 무효', isValidBar(100, 102, 98, 97), false);
  check('NaN → 무효', isValidBar(NaN, 102, 98, 100), false);

  // 비정상 행이 슬롯을 먹지 않는다.
  //   · 전부 null 인 날: services 의 stripNullPrices 가 null 을 제거하므로 **날짜 키 자체가 맵에 없다**
  //     → 애초에 행으로 존재하지 않아 droppedRows 에도 잡히지 않는다(슬롯도 안 먹는다).
  //   · 일부 null·0 이하·관계 위반: 날짜 키는 있고 값이 무효 → droppedRows 로 집계 후 제외.
  const bars: B[] = [];
  for (let i = 0; i < 30; i++) bars.push(flat());
  bars.push({ o: null, h: null, l: null, c: null });         // 빈 행 — 맵에서 아예 빠짐
  bars.push({ o: 100, h: 102, l: 0, c: 100 });               // 0 → 제외
  bars.push({ o: 100, h: 98, l: 102, c: 100 });              // 관계 위반 → 제외
  bars.push({ o: 100, h: 102, l: null, c: 100 });            // 일부 null → 제외
  for (let i = 0; i < 26; i++) bars.push(flat());
  const r = extractCompletedBars(mkRaw(bars), 'CRYPTO', nowAfter(bars));
  check('유효 완료봉 56개 (정상 30+26)', r.bars.length, 56);
  check('제외 행 3개 (존재하지만 무효인 행만)', r.droppedRows, 3);
  checkTrue('비정상 날짜가 봉 배열에 없음', !r.bars.some(b => [iso(30), iso(31), iso(32), iso(33)].includes(b.date)));
  checkTrue('빈 행 날짜는 맵에 아예 없음', !Object.keys(mkRaw(bars).data!).includes(iso(30)));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('2. high/low 부재 → close 폴백 금지, 확인 불가');
// ════════════════════════════════════════════════════════════════════════════
{
  const data: Record<string, number> = {};
  for (let i = 0; i < 60; i++) data[iso(i)] = 100;
  const rawNoHL: RawSeries = { data }; // open/high/low 없음
  const r = extractCompletedBars(rawNoHL, 'CRYPTO', nowAfter(new Array(60).fill(flat())));
  check('hasHighLow=false', r.hasHighLow, false);
  check('봉 0개 (종가 폴백 안 함)', r.bars.length, 0);

  const row = buildWatchRow({
    ticker: 'X', name: 'X', raw: rawNoHL, exchange: US_EX, isCrypto: false,
    intradayPrice: 999, now: nowAfter(new Array(60).fill(flat())),
  });
  check('상태 = 확인 불가', row.status, 'unavailable');
  checkTrue('사유에 no-high-low', row.quality.issues.includes('no-high-low'));
  check('돌파선 null (폴백 없음)', row.breakoutLine, null);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('3. 55일 돌파 — 총 55봉 부족 / 56봉 판정 / D봉 high 미포함 / 동일값 발생');
// ════════════════════════════════════════════════════════════════════════════
{
  check('ENTRY_MIN_BARS = 56', ENTRY_MIN_BARS, 56);

  // 총 55봉 → 확인 불가
  const b55: B[] = []; for (let i = 0; i < 55; i++) b55.push(flat());
  const r55 = buildWatchRow({ ticker: 'A', name: 'A', raw: mkRaw(b55), exchange: US_EX, isCrypto: false, intradayPrice: null, now: nowAfter(b55) });
  check('총 55봉 → 확인 불가', r55.status, 'unavailable');
  checkTrue('사유 = 일봉 부족', r55.quality.issues.includes('insufficient-bars'));
  check('유효 완료봉 55', r55.quality.validCompletedBars, 55);

  // 총 56봉 → 판정 가능. 직전 55개 high 최댓값 = 110 (D 제외)
  const b56: B[] = [];
  for (let i = 0; i < 55; i++) b56.push(i === 10 ? { o: 100, h: 110, l: 98, c: 100 } : flat());
  b56.push({ o: 100, h: 999, l: 98, c: 105 });   // D — high 999 는 자기 채널에 포함되지 않아야 함
  const r56 = buildWatchRow({ ticker: 'A', name: 'A', raw: mkRaw(b56), exchange: US_EX, isCrypto: false, intradayPrice: null, now: nowAfter(b56) });
  check('총 56봉 → 판정 가능', r56.status !== 'unavailable', true);
  checkClose('돌파선 골든 = 110 (D 제외 직전 55개 high 최댓값)', r56.breakoutLine!, 110, 1e-9);
  checkTrue('D봉 high 999 가 비교선에 포함되지 않음', r56.breakoutLine !== 999);
  check('D.close 105 < 110 → 기다림', r56.status, 'waiting');
  checkClose('돌파선까지 남은 비율 = (110−105)/105×100', r56.gapToLinePct!, (110 - 105) / 105 * 100, 1e-9);

  // 종가 == 비교선 → 발생 (>=)
  const bEq: B[] = [];
  for (let i = 0; i < 55; i++) bEq.push(i === 10 ? { o: 100, h: 110, l: 98, c: 100 } : flat());
  bEq.push({ o: 100, h: 112, l: 98, c: 110 });   // close 정확히 110
  const rEq = buildWatchRow({ ticker: 'A', name: 'A', raw: mkRaw(bEq), exchange: US_EX, isCrypto: false, intradayPrice: null, now: nowAfter(bEq) });
  check('종가 == 비교선 → 55일 돌파 확인', rEq.status, 'breakout-confirmed');

  // 종가 = 비교선 − 0.01 → 기다림
  const bLt: B[] = [];
  for (let i = 0; i < 55; i++) bLt.push(i === 10 ? { o: 100, h: 110, l: 98, c: 100 } : flat());
  bLt.push({ o: 100, h: 112, l: 98, c: 109.99 });
  check('종가 < 비교선 → 기다림', buildWatchRow({ ticker: 'A', name: 'A', raw: mkRaw(bLt), exchange: US_EX, isCrypto: false, intradayPrice: null, now: nowAfter(bLt) }).status, 'waiting');

  // entryBreakoutLine 직접
  check('55봉이면 null (D+55 미충족)', entryBreakoutLine(extractCompletedBars(mkRaw(b55), 'US', nowAfter(b55)).bars), null);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('4. 장중 가격은 확정 신호에 쓰이지 않음');
// ════════════════════════════════════════════════════════════════════════════
{
  const bars: B[] = [];
  for (let i = 0; i < 55; i++) bars.push(i === 10 ? { o: 100, h: 110, l: 98, c: 100 } : flat());
  bars.push({ o: 100, h: 105, l: 98, c: 105 });  // D.close 105 < 110
  const row = buildWatchRow({
    ticker: 'A', name: 'A', raw: mkRaw(bars), exchange: US_EX, isCrypto: false,
    intradayPrice: 130, now: nowAfter(bars),    // 장중 130 > 돌파선 110
  });
  check('장중가가 돌파선 위여도 확정 아님', row.status, 'waiting');
  check('장중 돌파 중 플래그만 true', row.intradayAboveLine, true);
  checkClose('완료종가는 105 그대로', row.completedClose!, 105, 1e-9);

  // 완료종가가 이미 돌파면 장중 플래그는 세우지 않는다(중복 표시 방지)
  const bars2: B[] = [];
  for (let i = 0; i < 55; i++) bars2.push(i === 10 ? { o: 100, h: 110, l: 98, c: 100 } : flat());
  bars2.push({ o: 100, h: 115, l: 98, c: 112 });
  const row2 = buildWatchRow({ ticker: 'A', name: 'A', raw: mkRaw(bars2), exchange: US_EX, isCrypto: false, intradayPrice: 130, now: nowAfter(bars2) });
  check('확정 돌파 시 장중 플래그 false', row2.intradayAboveLine, false);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('5. 진행 중 당일 봉 제외 — 시장별 날짜 기준');
// ════════════════════════════════════════════════════════════════════════════
{
  check('KRX → KR', resolveMarketTz(KR_EX, false), 'KR');
  check('KRX 금시장 → KR', resolveMarketTz('KRX 금시장', false), 'KR');
  check('NASDAQ → US', resolveMarketTz(US_EX, false), 'US');
  check('NYSE → US', resolveMarketTz('NYSE', false), 'US');
  check('코인 → CRYPTO', resolveMarketTz(CRYPTO_EX, true), 'CRYPTO');
  check('TSE → UNKNOWN (보수적)', resolveMarketTz('TSE (도쿄)', false), 'UNKNOWN');

  // 시간대별 "오늘"이 다르다 — 한국 로컬시간 하드코딩이 아님을 고정
  const t = new Date(Date.parse('2026-07-16T02:00:00Z')); // UTC 07-16 02:00 → KST 07-16 11:00, NY 07-15 22:00
  check('UTC 오늘', todayInTz('UTC', t), '2026-07-16');
  check('Asia/Seoul 오늘', todayInTz('Asia/Seoul', t), '2026-07-16');
  check('America/New_York 오늘 (아직 07-15)', todayInTz('America/New_York', t), '2026-07-15');

  // 당일 봉 제외: 마지막 봉 날짜 == 시장 현지 오늘 → 제외
  const bars: B[] = []; for (let i = 0; i < 60; i++) bars.push(flat());
  const lastDate = iso(59);
  const nowSameDay = new Date(Date.parse(`${lastDate}T12:00:00Z`));
  const rIn = extractCompletedBars(mkRaw(bars), 'CRYPTO', nowSameDay);
  check('당일 봉 제외 → 59개', rIn.bars.length, 59);
  check('최신 완료봉 = 전일', rIn.bars[rIn.bars.length - 1].date, iso(58));
  const rAfter = extractCompletedBars(mkRaw(bars), 'CRYPTO', nowAfter(bars));
  check('다음날이면 60개 전부 완료', rAfter.bars.length, 60);

  // UNKNOWN: 최신 행 보수적 제외 + 표시
  const rUnk = extractCompletedBars(mkRaw(bars), 'UNKNOWN', nowAfter(bars));
  check('UNKNOWN → 최신 1개 보수적 제외', rUnk.bars.length, 59);
  check('보수적 제외 표시', rUnk.conservativeDrop, true);
  check('CRYPTO 도 공급자 기준 미확인 표시', rAfter.conservativeDrop, true);
  check('US 는 보수적 제외 아님', extractCompletedBars(mkRaw(bars), 'US', nowAfter(bars)).conservativeDrop, false);

  // 완료봉이 하나도 없으면 no-completed-bar
  const one: B[] = [flat()];
  const rNone = extractCompletedBars(mkRaw(one), 'CRYPTO', new Date(Date.parse(`${iso(0)}T12:00:00Z`)));
  check('완료봉 0개', rNone.bars.length, 0);
  const rowNone = buildLegacyRow({ ticker: 'A', name: 'A', raw: mkRaw(one), exchange: CRYPTO_EX, isCrypto: true, now: new Date(Date.parse(`${iso(0)}T12:00:00Z`)) });
  checkTrue('사유 = no-completed-bar', rowNone.quality.issues.includes('no-completed-bar'));
  check('상태 = 확인 불가', rowNone.status, 'unavailable');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('6. 20일 청산 — 20봉 부족 / 21봉 판정');
// ════════════════════════════════════════════════════════════════════════════
{
  check('EXIT_MIN_BARS = 21', EXIT_MIN_BARS, 21);

  const b20: B[] = []; for (let i = 0; i < 20; i++) b20.push(flat());
  check('총 20봉 → 청산선 null', exitChannelLine(extractCompletedBars(mkRaw(b20), 'US', nowAfter(b20)).bars), null);
  check('총 20봉 → 기존 SATELLITE 확인 불가', buildLegacyRow({ ticker: 'A', name: 'A', raw: mkRaw(b20), exchange: US_EX, isCrypto: false, now: nowAfter(b20) }).status, 'unavailable');

  // 총 21봉 → 판정. 직전 20개 low 최솟값 = 90 (D 제외)
  const b21: B[] = [];
  for (let i = 0; i < 20; i++) b21.push(i === 5 ? { o: 100, h: 102, l: 90, c: 100 } : flat());
  b21.push({ o: 100, h: 102, l: 1, c: 95 });   // D — low 1 은 자기 채널 미포함
  const r21 = buildLegacyRow({ ticker: 'A', name: 'A', raw: mkRaw(b21), exchange: US_EX, isCrypto: false, now: nowAfter(b21) });
  checkClose('청산선 골든 = 90 (D 제외)', r21.exitLine!, 90, 1e-9);
  checkTrue('D봉 low 1 미포함', r21.exitLine !== 1);
  check('종가 95 > 90 → 청산선 위', r21.status, 'above-exit-line');

  // 종가 == 청산선 → 도달 (<=)
  const bEq: B[] = [];
  for (let i = 0; i < 20; i++) bEq.push(i === 5 ? { o: 100, h: 102, l: 90, c: 100 } : flat());
  bEq.push({ o: 95, h: 96, l: 89, c: 90 });
  check('종가 == 청산선 → 도달', buildLegacyRow({ ticker: 'A', name: 'A', raw: mkRaw(bEq), exchange: US_EX, isCrypto: false, now: nowAfter(bEq) }).status, 'exit-line-touched');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('7. 정식 터틀 상태 우선순위 — 손절 > 청산 > 기다림');
// ════════════════════════════════════════════════════════════════════════════
{
  const mk = (dClose: number, stop: number, now?: Date) => {
    const bars: B[] = [];
    for (let i = 0; i < 20; i++) bars.push(i === 5 ? { o: 100, h: 102, l: 90, c: 100 } : flat());
    bars.push({ o: 100, h: 102, l: Math.min(89, dClose - 1), c: dClose });
    return buildPositionRow({ ticker: 'A', name: 'A', raw: mkRaw(bars), exchange: US_EX, isCrypto: false, stopPrice: stop, now: now ?? nowAfter(bars) });
  };
  // 청산선 = 90. 손절 = 92 → 종가 88 은 손절·청산 동시 → 손절 우선
  check('손절·청산 동시 → 손절 우선', mk(88, 92).status, 'sell-check-stop');
  // 손절 = 85, 종가 88 → 손절 미달, 청산(≤90) 성립
  check('손절 미달 + 청산 성립 → 청산', mk(88, 85).status, 'sell-check-exit');
  // 손절 = 85, 종가 95 → 둘 다 아님
  check('둘 다 아님 → 기다림', mk(95, 85).status, 'waiting');
  // 경계: 종가 == stopPrice → 손절
  check('종가 == 손절가 → 손절', mk(92, 92).status, 'sell-check-stop');

  // 20일 부족 + 손절 위 → 부분 성공
  const short: B[] = []; for (let i = 0; i < 5; i++) short.push(flat());
  const rShort = buildPositionRow({ ticker: 'A', name: 'A', raw: mkRaw(short), exchange: US_EX, isCrypto: false, stopPrice: 50, now: nowAfter(short) });
  check('20일 부족 + 손절 위 → 부분 성공', rShort.status, 'waiting-exit-unknown');
  check('청산선 null', rShort.exitLine, null);
  // 20일 부족이어도 손절은 판정된다
  const rShortStop = buildPositionRow({ ticker: 'A', name: 'A', raw: mkRaw(short), exchange: US_EX, isCrypto: false, stopPrice: 150, now: nowAfter(short) });
  check('20일 부족해도 손절 판정 가능', rShortStop.status, 'sell-check-stop');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('8. 기존 SATELLITE 모델 — 2N·불타기 필드 부재 · 불타기 상태 미생성');
// ════════════════════════════════════════════════════════════════════════════
{
  const bars: B[] = [];
  for (let i = 0; i < 20; i++) bars.push(flat());
  bars.push(flat());
  const row: LegacySatelliteRow = buildLegacyRow({ ticker: 'A', name: 'A', raw: mkRaw(bars), exchange: US_EX, isCrypto: false, now: nowAfter(bars) });

  // 런타임 키 부재 (타입 차단은 tsc 가 강제 — 여기선 실제 객체 확인)
  const keys = Object.keys(row);
  for (const forbidden of ['stopPrice', 'nAtEntry', 'pyramidPrice', 'pyramidQuantity', 'recommendedSellQuantity']) {
    check(`기존 SATELLITE 에 ${forbidden} 없음`, keys.includes(forbidden), false);
  }
  checkTrue('허용 필드만 존재', keys.every(k => ['kind', 'ticker', 'name', 'status', 'quality', 'completedClose', 'exitLine'].includes(k)));

  // 어떤 입력에서도 불타기 상태가 나오지 않는다 — 전 상태 유니온에 불타기 없음
  const allStatuses = new Set<string>();
  for (const dClose of [80, 90, 100, 120, 200]) {
    const bs: B[] = [];
    for (let i = 0; i < 20; i++) bs.push(i === 5 ? { o: 100, h: 102, l: 90, c: 100 } : flat());
    bs.push({ o: 100, h: Math.max(102, dClose), l: Math.min(89, dClose), c: dClose });
    allStatuses.add(buildLegacyRow({ ticker: 'A', name: 'A', raw: mkRaw(bs), exchange: US_EX, isCrypto: false, now: nowAfter(bs) }).status);
    allStatuses.add(buildPositionRow({ ticker: 'A', name: 'A', raw: mkRaw(bs), exchange: US_EX, isCrypto: false, stopPrice: 85, now: nowAfter(bs) }).status);
    allStatuses.add(buildWatchRow({ ticker: 'A', name: 'A', raw: mkRaw(bs), exchange: US_EX, isCrypto: false, intradayPrice: dClose, now: nowAfter(bs) }).status);
  }
  checkTrue('불타기 상태 미생성', ![...allStatuses].some(s => /pyramid|불타기/i.test(s)));
  checkTrue('상태값이 허용 집합 안', [...allStatuses].every(s => [
    'breakout-confirmed', 'waiting', 'unavailable', 'sell-check-stop', 'sell-check-exit',
    'waiting-exit-unknown', 'exit-line-touched', 'above-exit-line',
  ].includes(s)));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('9. 정렬 · 요약 · 입력 순서 무관');
// ════════════════════════════════════════════════════════════════════════════
{
  const q = { validCompletedBars: 56, asOfDate: '2026-07-15', droppedRows: 0, marketTz: 'US' as const, conservativeDrop: false, issues: [] };
  const rows: TodayRow[] = [
    { kind: 'watch', ticker: 'W1', name: 'W1', status: 'waiting', quality: q, completedClose: 100, breakoutLine: 110, gapToLinePct: 10, intradayAboveLine: false, intradayPrice: null },
    { kind: 'watch', ticker: 'B1', name: 'B1', status: 'breakout-confirmed', quality: q, completedClose: 111, breakoutLine: 110, gapToLinePct: null, intradayAboveLine: false, intradayPrice: null },
    { kind: 'position', ticker: 'P1', name: 'P1', status: 'sell-check-stop', quality: q, completedClose: 80, stopPrice: 85, exitLine: 90 },
    { kind: 'legacy', ticker: 'L1', name: 'L1', status: 'exit-line-touched', quality: q, completedClose: 89, exitLine: 90 },
    { kind: 'watch', ticker: 'U1', name: 'U1', status: 'unavailable', quality: q, completedClose: null, breakoutLine: null, gapToLinePct: null, intradayAboveLine: false, intradayPrice: null },
  ];
  // C-5: 순위 재정의 — 0 데이터·연결 / 1 손절·청산 / 2 기존참고 / 3 돌파확정 / 4 장중돌파 / 5 단순 기다림
  check('순위: 확인 불가 = 0', rowSortRank(rows[4]), 0);
  check('순위: 손절 = 1', rowSortRank(rows[2]), 1);
  check('순위: 기존 참고 = 2', rowSortRank(rows[3]), 2);
  check('순위: 돌파 = 3', rowSortRank(rows[1]), 3);
  check('순위: 단순 기다림 = 5', rowSortRank(rows[0]), 5);

  const sorted = sortRows(rows);
  check('정렬 결과', sorted.map(r => r.ticker).join(','), 'U1,P1,L1,B1,W1');
  const rev = sortRows([...rows].reverse());
  check('입력 역전해도 동일', rev.map(r => r.ticker).join(','), 'U1,P1,L1,B1,W1');
  const shuffled = sortRows([rows[3], rows[0], rows[4], rows[1], rows[2]]);
  check('셔플해도 동일', shuffled.map(r => r.ticker).join(','), 'U1,P1,L1,B1,W1');

  const s = summarizeRows(rows);
  check('요약 sellCheck', s.sellCheck, 1);
  check('요약 breakout', s.breakout, 1);
  check('요약 legacyTouched', s.legacyTouched, 1);
  check('요약 dataIssues', s.dataIssues, 1);
  check('요약 waiting', s.waiting, 1);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('10. 관심종목 · 보유종목 중복 → 신규진입 상태 미생성 (정규화 키)');
// ════════════════════════════════════════════════════════════════════════════
{
  // 훅의 중복 차단과 동일한 키 규약 — 표기 차이를 흡수하는지 고정
  check('대소문자 정규화', todayInstrumentKey('aapl', 'NASDAQ', normalizeExchange), 'AAPL|NASDAQ');
  check('공백 정규화', todayInstrumentKey(' AAPL ', 'NASDAQ', normalizeExchange), 'AAPL|NASDAQ');
  check('거래소 별칭 정규화 (AMEX→NYSE American)', todayInstrumentKey('X', 'AMEX', normalizeExchange), todayInstrumentKey('X', 'NYSE American', normalizeExchange));
  checkTrue('다른 거래소는 다른 키', todayInstrumentKey('X', 'NASDAQ', normalizeExchange) !== todayInstrumentKey('X', 'NYSE', normalizeExchange));

  // 보유 키 집합에 있으면 관심종목 후보에서 빠진다(훅 로직과 동일 규약)
  const heldKeys = new Set([todayInstrumentKey('AAPL', 'NASDAQ', normalizeExchange)]);
  checkTrue('보유 중 → 후보 제외', heldKeys.has(todayInstrumentKey('aapl', 'NASDAQ', normalizeExchange)));
  checkTrue('미보유 → 후보 유지', !heldKeys.has(todayInstrumentKey('MSFT', 'NASDAQ', normalizeExchange)));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('11. 터틀 안전잠금 — 정책 · 사유 전달');
// ════════════════════════════════════════════════════════════════════════════
{
  check('정책 = OBSERVE_ONLY', TURTLE_ORDER_POLICY, 'OBSERVE_ONLY');
  check('잠김', isTurtleOrderLocked(), true);
  check('잠금 대상 4종', LOCKED_ACTION_KINDS.length, 4);
  for (const k of ['TURTLE_ENTRY', 'TURTLE_PYRAMID', 'TURTLE_STOP', 'TURTLE_EXIT'] as ActionKind[]) {
    check(`${k} 잠금 대상`, isLockedActionKind(k), true);
    check(`${k} 실행 차단`, isActionExecutionLocked(k), true);
  }
  for (const k of ['REBALANCE_BUY', 'REBALANCE_SELL', 'CLEANUP_SELL'] as ActionKind[]) {
    check(`${k} 비터틀 — 잠금 대상 아님`, isLockedActionKind(k), false);
    check(`${k} 실행 허용 유지`, isActionExecutionLocked(k), false);
  }
  const st = turtleLockState();
  check('잠금 사유 코드', st.reason, 'observe-only');
  check('사유 문구 전달', st.message, TURTLE_LOCK_MESSAGE);
  checkTrue('사용자 문구가 비어있지 않음', TURTLE_LOCK_MESSAGE.length > 10);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('12. 터틀 프리뷰가 실행 가능 건수에서 제외 · 기존 큐 보존');
// ════════════════════════════════════════════════════════════════════════════
{
  const mkItem = (id: string, kind: ActionKind): ActionItem => ({
    id, createdDate: '2026-07-10', kind, ticker: 'T', name: 'T',
    quantity: 1, refPrice: 100, reasonText: '', ruleSnapshot: {}, status: 'pending',
  });
  const queue: ActionItem[] = [
    mkItem('t1', 'TURTLE_ENTRY'), mkItem('t2', 'TURTLE_STOP'),
    mkItem('r1', 'REBALANCE_BUY'), mkItem('c1', 'CLEANUP_SELL'),
  ];
  // summarizeActiveQueue / summarizePreview 는 **잠금을 모르는 순수 집계**로 유지한다 —
  // 생성기와의 parity 앵커(previewCount ≡ buildTurtleActions().length)를 지키기 위함.
  // 잠금은 합성 지점(buildTurtleReviewSummary)에서만 적용된다.
  const active = summarizeActiveQueue(queue, '2026-07-16');
  check('순수 집계: activeCount 4 (잠금 무관)', active.activeCount, 4);
  check('잠금 대기 터틀 2건', countLockedActive(queue), 2);
  check('큐 원본 보존 (길이 불변)', queue.length, 4);
  checkTrue('큐 항목 상태 불변 (done/skipped 로 바뀌지 않음)', queue.every(it => it.status === 'pending'));

  const diag = {
    positions: [{ ticker: 'T', name: 'T', positionId: 'p', reason: 'stop-generated' as const }],
    candidates: [{ ticker: 'C', name: 'C', reason: 'generated' as const }],
    generatedCount: 2,
  };
  const preview = summarizePreview(diag);
  check('순수 집계: previewCount = generatedCount (앵커 보존)', preview.previewCount, 2);

  // C-2: 공개 요약은 **원시 숫자까지** 잠긴 터틀을 뺀다 (소비처가 preview*/activeCount 를 직접 읽으므로)
  const summary = buildTurtleReviewSummary({
    queue, today: '2026-07-16', diagnostics: diag, turtleCandidateCount: 5,
    budgetMissing: false, isChecking: false, reviewPending: false, reviewFailed: false, checkedAt: '09:00',
  });
  check('actionableCount = 비터틀 2건만 (터틀 대기·프리뷰 제외)', summary.actionableCount, 2);
  check('turtleLocked 플래그 전달', summary.turtleLocked, true);
  check('lockedCount 전달', summary.lockedCount, 2);
  check('공개 previewCount = 0 (잠금)', summary.previewCount, 0);

  // 터틀만 있는 큐 → 실행 가능 0
  const onlyTurtle = buildTurtleReviewSummary({
    queue: [mkItem('t1', 'TURTLE_ENTRY')], today: '2026-07-16', diagnostics: diag, turtleCandidateCount: 1,
    budgetMissing: false, isChecking: false, reviewPending: false, reviewFailed: false, checkedAt: '09:00',
  });
  check('터틀만 있으면 실행 가능 0', onlyTurtle.actionableCount, 0);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('13. 카드 계산에 주문·저장 부작용 없음 (입력 불변)');
// ════════════════════════════════════════════════════════════════════════════
{
  const bars: B[] = [];
  for (let i = 0; i < 56; i++) bars.push(flat());
  const raw = mkRaw(bars);
  const snapshot = JSON.stringify(raw);
  const now = nowAfter(bars);
  buildWatchRow({ ticker: 'A', name: 'A', raw, exchange: US_EX, isCrypto: false, intradayPrice: 100, now });
  buildLegacyRow({ ticker: 'A', name: 'A', raw, exchange: US_EX, isCrypto: false, now });
  buildPositionRow({ ticker: 'A', name: 'A', raw, exchange: US_EX, isCrypto: false, stopPrice: 90, now });
  check('입력 원본 불변 (부작용 없음)', JSON.stringify(raw), snapshot);

  // 동일 입력 → 동일 출력 (결정론)
  const a = buildWatchRow({ ticker: 'A', name: 'A', raw, exchange: US_EX, isCrypto: false, intradayPrice: 100, now });
  const b = buildWatchRow({ ticker: 'A', name: 'A', raw, exchange: US_EX, isCrypto: false, intradayPrice: 100, now });
  check('결정론', JSON.stringify(a), JSON.stringify(b));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('14. [C-2] 잠긴 터틀 원시 숫자가 공개 요약에 노출되지 않음');
// ════════════════════════════════════════════════════════════════════════════
{
  const mkItem = (id: string, kind: ActionKind, createdDate = '2026-07-01'): ActionItem => ({
    id, createdDate, kind, ticker: 'T', name: 'T',
    quantity: 1, refPrice: 100, reasonText: '', ruleSnapshot: {}, status: 'pending',
  });
  // 터틀 3건(전부 오래돼 에스컬레이션 대상) + 비터틀 1건(오늘 생성 → 에스컬레이션 아님)
  const queue: ActionItem[] = [
    mkItem('t1', 'TURTLE_ENTRY'), mkItem('t2', 'TURTLE_PYRAMID'), mkItem('t3', 'TURTLE_STOP'),
    mkItem('r1', 'REBALANCE_BUY', '2026-07-16'),
  ];
  const diag = {
    positions: [
      { ticker: 'A', name: 'A', positionId: 'p1', reason: 'stop-generated' as const },
      { ticker: 'B', name: 'B', positionId: 'p2', reason: 'pyramid-generated' as const },
      { ticker: 'C', name: 'C', positionId: 'p3', reason: 'exit-generated' as const },
    ],
    candidates: [{ ticker: 'D', name: 'D', reason: 'generated' as const }],
    generatedCount: 4,
  };
  const s = buildTurtleReviewSummary({
    queue, today: '2026-07-16', diagnostics: diag, turtleCandidateCount: 3,
    budgetMissing: true, isChecking: false, reviewPending: false, reviewFailed: true, checkedAt: '09:00',
  });
  // 공개 원시 숫자 전부 0 또는 비터틀만
  check('공개 activeCount = 비터틀 1건만', s.activeCount, 1);
  check('공개 escalatedCount = 0 (터틀만 오래됐음)', s.escalatedCount, 0);
  check('공개 previewCount = 0', s.previewCount, 0);
  check('공개 previewEntry = 0', s.previewEntry, 0);
  check('공개 previewPyramid = 0 (불타기 노출 금지)', s.previewPyramid, 0);
  check('공개 previewStop = 0', s.previewStop, 0);
  check('공개 previewExit = 0', s.previewExit, 0);
  check('actionableCount = 비터틀 1건', s.actionableCount, 1);
  check('잠긴 터틀 기록은 lockedCount 에만 보존', s.lockedCount, 3);
  check('큐 원본 길이 불변', queue.length, 4);
  checkTrue('큐 항목 상태 불변(done/skipped 없음)', queue.every(it => it.status === 'pending'));

  // AlertPopup 표시 조건: showExecCard = actionableCount > 0 || isChecking
  // 터틀만 있는 큐 → 카드 자체가 뜨지 않아야 한다(= '오늘 새로 생성 가능' 문구 미노출)
  const onlyTurtle = buildTurtleReviewSummary({
    queue: [mkItem('t1', 'TURTLE_ENTRY'), mkItem('t2', 'TURTLE_PYRAMID')],
    today: '2026-07-16', diagnostics: diag, turtleCandidateCount: 3,
    budgetMissing: false, isChecking: false, reviewPending: false, reviewFailed: false, checkedAt: '09:00',
  });
  check('터틀만 → actionableCount 0', onlyTurtle.actionableCount, 0);
  check('터틀만 → previewCount 0 (오늘 새로 생성 가능 미표시)', onlyTurtle.previewCount, 0);
  checkTrue('AlertPopup 실행카드 미표시 조건 성립', !(onlyTurtle.actionableCount > 0 || onlyTurtle.isChecking));
  check('잠금 중 isChecking = false', onlyTurtle.isChecking, false);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('15. [C-3] requestKey — 동일하면 재조회 없음 / 대상·날짜 변경 시 변경');
// ════════════════════════════════════════════════════════════════════════════
{
  const t = (key: string, kind: 'watch' | 'position' | 'legacy', ft: string) => ({ key, kind, fetchTicker: ft });
  const base = [t('AAPL|NASDAQ', 'watch', 'AAPL'), t('MSFT|NASDAQ', 'watch', 'MSFT')];

  check('동일 대상·동일 날짜 → 동일 키', buildTodayRequestKey(base, '2026-07-16'), buildTodayRequestKey(base, '2026-07-16'));
  checkTrue('입력 순서 뒤집어도 동일 키(정렬)', buildTodayRequestKey(base, '2026-07-16') === buildTodayRequestKey([...base].reverse(), '2026-07-16'));
  checkTrue('날짜 변경 → 키 변경', buildTodayRequestKey(base, '2026-07-16') !== buildTodayRequestKey(base, '2026-07-17'));
  checkTrue('관심종목 추가 → 키 변경', buildTodayRequestKey(base, '2026-07-16') !== buildTodayRequestKey([...base, t('TSLA|NASDAQ', 'watch', 'TSLA')], '2026-07-16'));
  checkTrue('관심종목 삭제 → 키 변경', buildTodayRequestKey(base, '2026-07-16') !== buildTodayRequestKey([base[0]], '2026-07-16'));
  checkTrue('종류 변경(watch→position) → 키 변경',
    buildTodayRequestKey(base, '2026-07-16') !== buildTodayRequestKey([t('AAPL|NASDAQ', 'position', 'AAPL'), base[1]], '2026-07-16'));
  checkTrue('대상 0개 → 키가 비대상 키와 다름', buildTodayRequestKey([], '2026-07-16') !== buildTodayRequestKey(base, '2026-07-16'));
  // 장중 가격은 키 입력에 아예 없다 — 가격 변동만으로 재조회되지 않음
  checkTrue('requestKey 입력에 가격 필드 없음', !JSON.stringify(base).includes('price'));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('16. [C-4] 포지션 연결 — assetId 없음 / 후보 유일 / 후보 모호');
// ════════════════════════════════════════════════════════════════════════════
{
  const mkAsset = (id: string, ticker: string, exchange: string): Asset => ({
    id, categoryId: 1, ticker, exchange, name: ticker, quantity: 1, purchasePrice: 100,
    purchaseDate: '2026-01-01', currency: Currency.USD, currentPrice: 100, priceOriginal: 100, highestPrice: 100,
  } as Asset);

  const ALL_IN = () => true;

  // 1) 유효 assetId → 그대로 연결
  const a1 = mkAsset('a1', 'AAPL', 'NASDAQ');
  const r1 = resolvePositionAsset({ assetId: 'a1', ticker: 'AAPL' }, [a1], ALL_IN);
  check('유효 assetId → 연결', r1.asset?.id, 'a1');
  check('유효 assetId → linkError 없음', r1.linkError, false);

  // 2) assetId 없음 + ticker 후보 유일 → fallback 연결
  const r2 = resolvePositionAsset({ ticker: 'AAPL' }, [a1, mkAsset('a2', 'MSFT', 'NASDAQ')], ALL_IN);
  check('assetId 없음 + 유일 후보 → 연결', r2.asset?.id, 'a1');
  check('유일 후보 → linkError 없음', r2.linkError, false);
  // 대소문자 무관
  check('ticker 대소문자 무관 fallback', resolvePositionAsset({ ticker: 'aapl' }, [a1], ALL_IN).asset?.id, 'a1');
  // 깨진 assetId → ticker fallback
  check('깨진 assetId → ticker fallback', resolvePositionAsset({ assetId: 'gone', ticker: 'AAPL' }, [a1], ALL_IN).asset?.id, 'a1');

  // 3) 후보 2개 이상 → 임의 선택 금지
  const dup = resolvePositionAsset({ ticker: 'AAPL' }, [a1, mkAsset('a3', 'AAPL', 'NYSE')], ALL_IN);
  check('후보 2개 → 연결 안 함', dup.asset, null);
  check('후보 2개 → linkError', dup.linkError, true);

  // 4) 후보 0개 → linkError
  const none = resolvePositionAsset({ ticker: 'ZZZZ' }, [a1], ALL_IN);
  check('후보 0개 → 연결 안 함', none.asset, null);
  check('후보 0개 → linkError', none.linkError, true);

  // 연결 오류 행은 숨기지 않고 표시되며, 기본 접힘이 아니다
  const linkRow = buildPositionRow({
    ticker: 'AAPL', name: 'AAPL', raw: undefined, exchange: '', isCrypto: false,
    stopPrice: 90, now: new Date(), linkError: true,
  });
  check('연결 오류 → link-error 상태', linkRow.status, 'link-error');
  check('연결 오류 순위 = 0 (데이터·연결 확인 필요)', rowSortRank(linkRow), 0);
  check('연결 오류는 기본 접힘 아님', isWaitingRow(linkRow), false);
  checkTrue('연결 오류 사유 기록', linkRow.quality.issues.includes('position-link'));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('17. [C-4] 거래소 키 정규화 — 대소문자·별칭');
// ════════════════════════════════════════════════════════════════════════════
{
  check('nasdaq == NASDAQ', todayInstrumentKey('X', 'nasdaq', normalizeExchange), todayInstrumentKey('X', 'NASDAQ', normalizeExchange));
  check('  NaSdAq  == NASDAQ', todayInstrumentKey('X', '  NaSdAq  ', normalizeExchange), todayInstrumentKey('X', 'NASDAQ', normalizeExchange));
  check('AMEX == NYSE American', todayInstrumentKey('X', 'AMEX', normalizeExchange), todayInstrumentKey('X', 'NYSE American', normalizeExchange));
  check('NYSE MKT == NYSE American', todayInstrumentKey('X', 'NYSE MKT', normalizeExchange), todayInstrumentKey('X', 'nyse american', normalizeExchange));
  checkTrue('NASDAQ ≠ NYSE (실제 다른 거래소는 구분)', todayInstrumentKey('X', 'NASDAQ', normalizeExchange) !== todayInstrumentKey('X', 'NYSE', normalizeExchange));
  checkTrue('티커 다르면 구분', todayInstrumentKey('X', 'NASDAQ', normalizeExchange) !== todayInstrumentKey('Y', 'NASDAQ', normalizeExchange));

  // 보유(nasdaq) vs 관심종목(NASDAQ) → 중복 차단되어야 함
  const held = new Set([todayInstrumentKey('AAPL', 'nasdaq', normalizeExchange)]);
  checkTrue('거래소 대소문자 차이여도 보유 중복 차단', held.has(todayInstrumentKey('AAPL', 'NASDAQ', normalizeExchange)));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('18. [C-4] stopPrice 검증 — 0 으로 대체 금지');
// ════════════════════════════════════════════════════════════════════════════
{
  check('양수 유효', isValidStopPrice(90), true);
  check('null 무효', isValidStopPrice(null), false);
  check('undefined 무효', isValidStopPrice(undefined), false);
  check('NaN 무효', isValidStopPrice(NaN), false);
  check('0 무효', isValidStopPrice(0), false);
  check('음수 무효', isValidStopPrice(-1), false);
  check('Infinity 무효', isValidStopPrice(Infinity), false);
  check('문자열 무효', isValidStopPrice('90'), false);

  const bars: B[] = []; for (let i = 0; i < 25; i++) bars.push(flat());
  for (const bad of [null, undefined, NaN, 0, -5]) {
    const row = buildPositionRow({
      ticker: 'A', name: 'A', raw: mkRaw(bars), exchange: US_EX, isCrypto: false,
      stopPrice: bad as number | null | undefined, now: nowAfter(bars),
    });
    check(`stopPrice=${String(bad)} → stop-record-error`, row.status, 'stop-record-error');
    check(`stopPrice=${String(bad)} → stopPrice null (0 대체 금지)`, row.stopPrice, null);
    check(`stopPrice=${String(bad)} → 기본 접힘 아님`, isWaitingRow(row), false);
    checkTrue(`stopPrice=${String(bad)} → 사유 기록`, row.quality.issues.includes('stop-record-invalid'));
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('19. [C-4] high/low 없어도 저장 stopPrice 손절은 판정');
// ════════════════════════════════════════════════════════════════════════════
{
  // 종가만 있는 시계열 (open/high/low 전무)
  const data: Record<string, number> = {};
  for (let i = 0; i < 30; i++) data[iso(i)] = 100;
  data[iso(29)] = 80;   // 마지막 완료종가 80
  const closeOnly: RawSeries = { data };
  const now = nowAfter(new Array(30).fill(flat()));

  // 종가 80 <= 손절 90 → 손절 발화 (high/low 부족과 무관)
  const stopHit = buildPositionRow({ ticker: 'A', name: 'A', raw: closeOnly, exchange: US_EX, isCrypto: false, stopPrice: 90, now });
  check('high/low 없어도 손절 발화', stopHit.status, 'sell-check-stop');
  checkClose('완료종가 80 사용', stopHit.completedClose!, 80, 1e-9);
  check('20일 청산선은 확인 불가(null)', stopHit.exitLine, null);
  check('판정 기준일 채워짐', stopHit.quality.asOfDate, iso(29));

  // 손절선 위 + high/low 부족 → 20일선만 확인 불가 (부분 성공, 기본 노출)
  const above = buildPositionRow({ ticker: 'A', name: 'A', raw: closeOnly, exchange: US_EX, isCrypto: false, stopPrice: 50, now });
  check('손절선 위 + high/low 부족 → waiting-exit-unknown', above.status, 'waiting-exit-unknown');
  check('20일선 null', above.exitLine, null);
  check('waiting-exit-unknown 은 기본 노출 (접힘 아님)', isWaitingRow(above), false);
  check('waiting-exit-unknown 순위 = 0', rowSortRank(above), 0);

  // 종가조차 없으면 전체 확인 불가
  const nothing = buildPositionRow({ ticker: 'A', name: 'A', raw: { data: {} }, exchange: US_EX, isCrypto: false, stopPrice: 90, now });
  check('종가 없음 → 확인 불가', nothing.status, 'unavailable');

  // 55일·20일 채널은 여전히 종가 폴백 금지
  const watch = buildWatchRow({ ticker: 'A', name: 'A', raw: closeOnly, exchange: US_EX, isCrypto: false, intradayPrice: null, now });
  check('55일 돌파는 종가 폴백 금지 → 확인 불가', watch.status, 'unavailable');
  check('55일 돌파선 null', watch.breakoutLine, null);
  const legacy = buildLegacyRow({ ticker: 'A', name: 'A', raw: closeOnly, exchange: US_EX, isCrypto: false, now });
  check('20일 청산선도 종가 폴백 금지 → 확인 불가', legacy.status, 'unavailable');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('20. [C-3/C-5] fetch-failed 사유 · 장중 돌파 노출');
// ════════════════════════════════════════════════════════════════════════════
{
  const now = new Date(Date.parse('2026-03-01T12:00:00Z'));
  // 조회 실패 → no-high-low 가 아니라 fetch-failed
  const failed = buildWatchRow({ ticker: 'A', name: 'A', raw: undefined, exchange: US_EX, isCrypto: false, intradayPrice: null, now, fetchFailed: true });
  check('조회 실패 → 확인 불가', failed.status, 'unavailable');
  checkTrue('사유 = fetch-failed', failed.quality.issues.includes('fetch-failed'));
  checkTrue('사유에 no-high-low 없음(원인 구분)', !failed.quality.issues.includes('no-high-low'));
  check('fetch-failed 순위 = 0', rowSortRank(failed), 0);
  check('fetch-failed 는 기본 접힘 아님', isWaitingRow(failed), false);

  // 장중 돌파 중 → 접힘 금지, rank 4
  const bars: B[] = [];
  for (let i = 0; i < 55; i++) bars.push(i === 10 ? { o: 100, h: 110, l: 98, c: 100 } : flat());
  bars.push({ o: 100, h: 105, l: 98, c: 105 });
  const intraday = buildWatchRow({ ticker: 'A', name: 'A', raw: mkRaw(bars), exchange: US_EX, isCrypto: false, intradayPrice: 130, now: nowAfter(bars) });
  check('장중 돌파 플래그', intraday.intradayAboveLine, true);
  check('장중 돌파 순위 = 4', rowSortRank(intraday), 4);
  check('장중 돌파는 기본 접힘 아님', isWaitingRow(intraday), false);

  // 단순 기다림만 접힘
  const plain = buildWatchRow({ ticker: 'A', name: 'A', raw: mkRaw(bars), exchange: US_EX, isCrypto: false, intradayPrice: 100, now: nowAfter(bars) });
  check('단순 기다림 순위 = 5', rowSortRank(plain), 5);
  check('단순 기다림만 접힘', isWaitingRow(plain), true);

  // 요약이 순위와 일치
  const s = summarizeRows([failed, intraday, plain]);
  check('요약 dataIssues(=rank0)', s.dataIssues, 1);
  check('요약 intradayBreakout(=rank4)', s.intradayBreakout, 1);
  check('요약 waiting(=rank5)', s.waiting, 1);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('21. [C-3] 오래된 응답이 새 요청을 덮어쓰지 않음');
// ════════════════════════════════════════════════════════════════════════════
{
  check('같은 요청 id → 반영', isStaleResponse(3, 3), false);
  check('이전 요청 응답(1) vs 현재(2) → 폐기', isStaleResponse(1, 2), true);
  check('경합: 2건 연속 발행 후 앞선 응답 폐기', isStaleResponse(1, 3), true);
  check('경합: 마지막 응답만 반영', isStaleResponse(3, 3), false);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('22. [C-1] 관찰모드에서 자동검토 fetch·diagnose·pyramid 미도달 (소스 가드 순서)');
// ════════════════════════════════════════════════════════════════════════════
{
  // 훅 테스트 도구를 새로 설치하지 않으므로, **잠금 가드가 호출부보다 앞에 있음**을 소스 위치로 고정한다.
  // (런타임 계약은 §14 의 isChecking=false·previewCount=0 으로 함께 검증된다.)
  const src = readFileSync(new URL('../hooks/useTurtleActionReview.ts', import.meta.url), 'utf-8');
  const guard = src.indexOf('if (isTurtleOrderLocked()) {');
  const snapshotCall = src.indexOf('await loadTurtleMarketSnapshot(');
  const diagGuard = src.indexOf('if (isTurtleOrderLocked()) return null;');
  const diagCall = src.indexOf('return diagnoseTurtleActions(');
  const autoGenGuard = src.indexOf('if (isTurtleOrderLocked()) return;');
  const buildCall = src.indexOf('buildTurtleActions({');

  checkTrue('검토 effect 에 잠금 가드 존재', guard > 0);
  checkTrue('잠금 가드가 loadTurtleMarketSnapshot 호출보다 앞', guard > 0 && snapshotCall > guard);
  checkTrue('진단 memo 에 잠금 가드 존재', diagGuard > 0);
  checkTrue('잠금 가드가 diagnoseTurtleActions 호출보다 앞', diagGuard > 0 && diagCall > diagGuard);
  checkTrue('자동생성 effect 에 잠금 가드 존재', autoGenGuard > 0);
  checkTrue('잠금 가드가 buildTurtleActions 호출보다 앞', autoGenGuard > 0 && buildCall > autoGenGuard);

  // evaluatePyramid 는 diagnoseTurtleActions 내부에서만 도달한다 → 진단을 막으면 도달 불가
  const gen = readFileSync(new URL('../utils/actionQueueGenerator.ts', import.meta.url), 'utf-8');
  checkTrue('evaluatePyramid 는 생성기 내부에만 존재', gen.includes('evaluatePyramid('));
  const reviewSrc = readFileSync(new URL('../hooks/useTurtleActionReview.ts', import.meta.url), 'utf-8');
  checkTrue('자동검토 훅이 evaluatePyramid 를 직접 호출하지 않음', !reviewSrc.includes('evaluatePyramid('));

  // 새 읽기 전용 카드 경로는 생성기·불타기와 완전 분리
  const todaySrc = readFileSync(new URL('../utils/todayTurtle.ts', import.meta.url), 'utf-8');
  const hookSrc = readFileSync(new URL('../hooks/useTodayTurtle.ts', import.meta.url), 'utf-8');
  for (const [name, s] of [['utils/todayTurtle', todaySrc], ['hooks/useTodayTurtle', hookSrc]] as [string, string][]) {
    checkTrue(`${name}: buildTurtleActions 미사용`, !s.includes('buildTurtleActions('));
    checkTrue(`${name}: diagnoseTurtleActions 미사용`, !s.includes('diagnoseTurtleActions('));
    checkTrue(`${name}: evaluatePyramid 미사용`, !s.includes('evaluatePyramid('));
    checkTrue(`${name}: computeDeployedBudgetKRW 미사용`, !s.includes('computeDeployedBudgetKRW('));
    checkTrue(`${name}: updateActionQueue 미사용`, !s.includes('updateActionQueue('));
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('23. [AMENDMENT-2] 계정 필터 오연결 — 다른 계정 stopPrice 유입 차단');
// ════════════════════════════════════════════════════════════════════════════
{
  const mkOwned = (id: string, ticker: string, owner: OwnerId): Asset => ({
    id, categoryId: 1, ticker, exchange: 'NASDAQ', name: ticker, quantity: 1, purchasePrice: 100,
    purchaseDate: '2026-01-01', currency: Currency.USD, currentPrice: 100, priceOriginal: 100, highestPrice: 100,
    owner,
  } as Asset);

  const yuseonAsset = mkOwned('y1', 'AAPL', 'YUSEON');
  const wonjongAsset = mkOwned('w1', 'AAPL', 'WONJONG');
  const allAssets = [yuseonAsset, wonjongAsset];
  // 실제 앱과 동일한 계정 술어를 쓴다(테스트 전용 판정 재구현 금지)
  const inWonjong = (a: Asset) => matchesOwnerFilter(a, 'WONJONG');

  // ★ 핵심: 유선 포지션(assetId=y1)을 원종 화면에서 보면 → **원종 AAPL 로 fallback 되면 안 된다**
  const cross = resolvePositionAsset({ assetId: 'y1', ticker: 'AAPL' }, allAssets, inWonjong);
  check('유선 assetId → 원종 화면에서 연결 안 됨', cross.asset, null);
  check('유선 assetId → outOfView (제외)', cross.outOfView, true);
  check('유선 assetId → linkError 아님(오류가 아니라 계정 밖)', cross.linkError, false);
  checkTrue('원종 자산 w1 으로 잘못 붙지 않음', cross.asset === null);

  // 반대 방향도 동일
  const inYuseon = (a: Asset) => matchesOwnerFilter(a, 'YUSEON');
  const cross2 = resolvePositionAsset({ assetId: 'w1', ticker: 'AAPL' }, allAssets, inYuseon);
  check('원종 assetId → 유선 화면에서 연결 안 됨', cross2.asset, null);
  check('원종 assetId → outOfView', cross2.outOfView, true);

  // 현재 필터에 속한 정상 assetId → 정상 연결
  const ok = resolvePositionAsset({ assetId: 'w1', ticker: 'AAPL' }, allAssets, inWonjong);
  check('현재 필터 내 assetId → 정상 연결', ok.asset?.id, 'w1');
  check('현재 필터 내 assetId → outOfView 아님', ok.outOfView, false);
  check('현재 필터 내 assetId → linkError 아님', ok.linkError, false);

  // 깨진 assetId + 전체 자산에 ticker 후보 2개 → 임의 연결 금지
  const ambiguous = resolvePositionAsset({ assetId: 'gone', ticker: 'AAPL' }, allAssets, inWonjong);
  check('깨진 assetId + 후보 2개 → 연결 안 함', ambiguous.asset, null);
  check('깨진 assetId + 후보 2개 → linkError', ambiguous.linkError, true);
  check('깨진 assetId + 후보 2개 → outOfView 아님', ambiguous.outOfView, false);
  // assetId 자체가 없어도 동일
  const ambiguous2 = resolvePositionAsset({ ticker: 'AAPL' }, allAssets, inWonjong);
  check('assetId 없음 + 후보 2개 → linkError', ambiguous2.linkError, true);
  check('assetId 없음 + 후보 2개 → 연결 안 함', ambiguous2.asset, null);

  // 전체 자산에서 유일한 ticker 후보 + 현재 필터 일치 → fallback 연결
  const soloWonjong = [mkOwned('w2', 'MSFT', 'WONJONG')];
  const solo = resolvePositionAsset({ ticker: 'MSFT' }, soloWonjong, inWonjong);
  check('유일 후보 + 필터 일치 → fallback 연결', solo.asset?.id, 'w2');
  check('유일 후보 + 필터 일치 → outOfView 아님', solo.outOfView, false);

  // 전체 자산에서 유일하지만 현재 필터 밖 → 연결 확정 후 제외(오류 아님)
  const soloYuseon = [mkOwned('y2', 'MSFT', 'YUSEON')];
  const soloOut = resolvePositionAsset({ ticker: 'MSFT' }, soloYuseon, inWonjong);
  check('유일 후보 + 필터 밖 → 연결 안 함', soloOut.asset, null);
  check('유일 후보 + 필터 밖 → outOfView', soloOut.outOfView, true);
  check('유일 후보 + 필터 밖 → linkError 아님', soloOut.linkError, false);

  // viewAssets 만 넘기던 옛 경로 재현 방지: 전체 assets 를 넘겨야 ID 조회가 성공한다
  const idFoundOnlyInAll = resolvePositionAsset({ assetId: 'y1', ticker: 'AAPL' }, allAssets, inWonjong);
  checkTrue('전체 assets 로 ID 조회 → ticker fallback 으로 흘러가지 않음', idFoundOnlyInAll.outOfView === true && idFoundOnlyInAll.linkError === false);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('24. [AMENDMENT-2] 종가·20일선 기준일 혼합 차단');
// ════════════════════════════════════════════════════════════════════════════
{
  // D-1 까지는 완전한 OHLC, D 는 **close 만** 있는 시계열을 만든다.
  //   · 과거 20일 최저가(채널 D-1 기준) = 90
  //   · D 의 close = 85  → 과거 채널선(90) 아래지만, **채널 기준일(D-1) ≠ 종가일(D)** 이므로 청산 금지
  function mk(dClose: number): RawSeries {
    const data: Record<string, number> = {}, open: Record<string, number> = {},
      high: Record<string, number> = {}, low: Record<string, number> = {};
    for (let i = 0; i < 25; i++) {
      const d = iso(i);
      data[d] = 100; open[d] = 100; high[d] = 102; low[d] = i === 5 ? 90 : 98;
    }
    // D(=iso(25)) 는 close 만 — OHLC 불완전
    data[iso(25)] = dClose;
    return { data, open, high, low };
  }
  const now = nowAfter(new Array(26).fill(flat()));

  // (1) D close 가 과거 20일선(90) 아래여도 channel-exit 을 만들지 않는다
  const mixed = buildPositionRow({ ticker: 'A', name: 'A', raw: mk(85), exchange: US_EX, isCrypto: false, stopPrice: 50, now });
  checkTrue('D close 85 는 과거 채널선 90 아래(테스트 유효성)', 85 < 90);
  checkTrue('기준일 불일치 → channel-exit 미생성', mixed.status !== 'sell-check-exit');
  check('기준일 불일치 → waiting-exit-unknown', mixed.status, 'waiting-exit-unknown');
  check('기준일 불일치 → 20일선 null (혼합 금지)', mixed.exitLine, null);
  checkClose('완료종가는 최신 D 값 85', mixed.completedClose!, 85, 1e-9);
  check('판정 기준일 = 종가일 D', mixed.quality.asOfDate, iso(25));
  check('기준일 불일치 행은 기본 접힘 아님', isWaitingRow(mixed), false);

  // (2) 같은 조건에서 D close 가 stopPrice 아래면 손절은 정상 발화
  const stopFires = buildPositionRow({ ticker: 'A', name: 'A', raw: mk(85), exchange: US_EX, isCrypto: false, stopPrice: 90, now });
  check('기준일 불일치여도 손절은 발화', stopFires.status, 'sell-check-stop');
  checkClose('손절 판정에 쓴 종가 = 85', stopFires.completedClose!, 85, 1e-9);
  check('손절 발화 시에도 20일선은 null(혼합 금지)', stopFires.exitLine, null);
  check('손절 기준일 = 종가일 D', stopFires.quality.asOfDate, iso(25));

  // (3) D 의 OHLC 가 완전하면 같은 D 기준으로 channel-exit 정상 발화
  function mkFull(dClose: number): RawSeries {
    const r = mk(dClose);
    const d = iso(25);
    r.open![d] = 95; r.high![d] = 96; r.low![d] = dClose - 1;
    return r;
  }
  const full = buildPositionRow({ ticker: 'A', name: 'A', raw: mkFull(85), exchange: US_EX, isCrypto: false, stopPrice: 50, now });
  check('D OHLC 완전 → channel-exit 정상 발화', full.status, 'sell-check-exit');
  checkClose('20일선 = 90 (D 제외 직전 20봉 최저)', full.exitLine!, 90, 1e-9);
  check('채널·종가 기준일 동일 = D', full.quality.asOfDate, iso(25));

  // (4) D OHLC 완전 + 청산선 위 → 기존 기다림 유지(회귀 없음)
  const fullAbove = buildPositionRow({ ticker: 'A', name: 'A', raw: mkFull(95), exchange: US_EX, isCrypto: false, stopPrice: 50, now });
  check('D OHLC 완전 + 청산선 위 → 기다림', fullAbove.status, 'waiting');
  checkClose('기다림에도 20일선 표시', fullAbove.exitLine!, 90, 1e-9);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} 통과 / ${fail} 실패`);
if (fail > 0) process.exit(1);
