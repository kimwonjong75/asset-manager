// tests/todayViewModelParity.ts
// utils/todayViewModel.ts 골든 테스트 — 명시적 절대값만 고정한다.
//   · buildTodayHeadline: 0건 빈 상태 문구·계획 있음+0건 문구·1건·다건 조인·3개 초과 "외 N"
//   · actionNeededCount: 자산 id 합집합(긴급·오늘 ∪ 결측·오래됨·미등록)
//   · groupRowsByTier: 4등급 분배(순서 보존)
//   · needsCheckRows: unavailable/stale/brokerStopMissing 독립 필터
//   · observeCounts / pendingOrderCounts / countPlanPriorityObserved: 합산·중복제거
// 수동 실행: npm run test:todayviewmodel (tsx). 통과 시 exit 0.

import { Currency, type Asset } from '../types';
import type { TradePlanBuildInput, TradePlanMarket } from '../types/tradePlan';
import { DEFAULT_TRADE_PLAN_TEMPLATE } from '../types/tradePlan';
import { buildTradePlan, evaluateTradePlan } from '../utils/tradePlan';
import type { TradePlanSignalRow } from '../hooks/useTradePlanSignals';
import { summarizeTradePlanSignals } from '../utils/tradePlanMarket';
import type { AlertResult } from '../types/alertRules';
import type { RiskMatrixRow } from '../utils/riskMatrix';
import type { ActionItem } from '../types/actionQueue';
import {
  buildTodayHeadline,
  groupRowsByTier,
  needsCheckRows,
  observeCounts,
  pendingOrderCounts,
  countPlanPriorityObserved,
  actionNeededCount,
} from '../utils/todayViewModel';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function checkTrue(name: string, cond: boolean): void {
  if (cond) pass++;
  else fails.push(`✗ ${name}: expected true`);
}

const NOW = '2026-09-03T05:20:00.000Z';
const TODAY = '2026-09-03';

// ── 픽스처 ────────────────────────────────────────────────────────────────

function makeAsset(id: string, name: string, over: Partial<Asset> = {}): Asset {
  return {
    id, categoryId: 2, ticker: name, exchange: 'KRX', name, quantity: 100,
    purchasePrice: 10_000, purchaseDate: '2025-01-01', currency: Currency.KRW,
    currentPrice: 10_500, priceOriginal: 10_500, highestPrice: 11_000,
    ...over,
  };
}

function baseInput(over: Partial<TradePlanBuildInput> = {}): TradePlanBuildInput {
  return {
    mode: 'holding', anchor: 'today', anchorPrice: 10_000, anchorDate: TODAY,
    currency: Currency.KRW, totalEquityKRW: 100_000_000, riskPct: 1, stopPct: 7,
    profitMultiple: 3, exitLine: { kind: 'ma', period: 20 },
    pyramid: { ...DEFAULT_TRADE_PLAN_TEMPLATE.pyramid },
    holdingQuantity: 100, fxRateToKRW: 1, now: NOW,
    brokerStopOrderRegistered: true,
    ...over,
  };
}

function mkMarket(over: Partial<TradePlanMarket> = {}): TradePlanMarket {
  return { price: 10_500, priceAsOf: TODAY, isIntraday: false, sessionDate: TODAY, ma: { 20: 10_200 }, maAsOf: TODAY, ...over };
}

/** id/name + 계획 입력 오버라이드 + 시장 오버라이드로 완전한 TradePlanSignalRow 하나를 조립한다. */
function makeRow(
  id: string,
  name: string,
  planOver: Partial<TradePlanBuildInput> = {},
  marketOver: Partial<TradePlanMarket> = {}
): TradePlanSignalRow {
  const built = buildTradePlan(baseInput(planOver));
  if (!built.ok) throw new Error(`fixture build failed: ${built.reason}`);
  const market = mkMarket(marketOver);
  const evaluation = evaluateTradePlan(built.plan, market);
  return { asset: makeAsset(id, name), plan: built.plan, evaluation, market };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. buildTodayHeadline
// ════════════════════════════════════════════════════════════════════════════
{
  const urgentRow = makeRow('a1', '풍산', {}, { price: 9_000 }); // stop 9,300 아래 → stop-hit(urgent, sell-all)
  const todayRow = makeRow('a2', 'NAVER', { profitMultiple: 3 }, { price: 12_200 }); // takeProfit 12,100 위 → sell-half(today)
  // 손절 근접(2% 이내) → prepare. MA20을 가격 아래로 둬(9,000) 추세선 이탈 분기가 먼저 잡히지 않게 한다.
  const prepareRow = makeRow('a3', '삼성전자', {}, { price: 9_450, ma: { 20: 9_000 } });
  const waitingRow = makeRow('a4', 'LG전자', {}, { price: 10_500 }); // 어디도 안 닿음 → waiting

  checkTrue('urgent row는 실제로 urgent 등급', urgentRow.evaluation.tier === 'urgent');
  checkTrue('today row는 실제로 today 등급', todayRow.evaluation.tier === 'today');
  checkTrue('prepare row는 실제로 prepare 등급', prepareRow.evaluation.tier === 'prepare');
  checkTrue('waiting row는 tier none', waitingRow.evaluation.tier === 'none');

  const emptySummary = summarizeTradePlanSignals([]);
  check('0건 → 빈 상태 문구', buildTodayHeadline([], emptySummary), { count: 0, text: '오늘은 할 일이 없습니다. 기다리는 것도 계획입니다.' });

  const oneRow = [urgentRow];
  const oneSummary = summarizeTradePlanSignals(oneRow);
  check('1건(긴급) → count 1 + 종목명 + 행동', buildTodayHeadline(oneRow, oneSummary), { count: 1, text: '오늘 할 일 1건 — 풍산 전량 매도' });

  const twoRows = [urgentRow, todayRow];
  const twoSummary = summarizeTradePlanSignals(twoRows);
  check('2건(긴급+오늘) → 둘 다 나열', buildTodayHeadline(twoRows, twoSummary), { count: 2, text: '오늘 할 일 2건 — 풍산 전량 매도 · NAVER 절반 매도' });

  // prepare/waiting은 헤드라인 이름 목록에서 제외되지만 count에는 영향 없음(count는 urgent+today 합)
  const mixedRows = [urgentRow, todayRow, prepareRow, waitingRow];
  const mixedSummary = summarizeTradePlanSignals(mixedRows);
  check('준비/대기 행은 헤드라인에서 제외', buildTodayHeadline(mixedRows, mixedSummary), { count: 2, text: '오늘 할 일 2건 — 풍산 전량 매도 · NAVER 절반 매도' });

  // 계획은 있으나 긴급+오늘 0건 → "계획 있는 종목 N개" 문구(계획 0건 빈 상태 문구와 구분)
  const quietRows = [prepareRow, waitingRow];
  check(
    '계획 있음 + 긴급/오늘 0건 → 계획 종목 수 문구',
    buildTodayHeadline(quietRows, summarizeTradePlanSignals(quietRows)),
    { count: 0, text: '계획 있는 종목 2개 — 오늘은 손절·익절선에 닿은 종목이 없어요' }
  );

  // 4개 초과 → 상위 3개 + "외 N"
  const r3 = makeRow('a5', '카카오', {}, { price: 9_000 });
  const r4 = makeRow('a6', '현대차', { profitMultiple: 3 }, { price: 12_200 });
  const fourPlus = [urgentRow, todayRow, r3, r4];
  const fourSummary = summarizeTradePlanSignals(fourPlus);
  check(
    '4건 초과 → 상위 3개 + 외 N',
    buildTodayHeadline(fourPlus, fourSummary),
    { count: 4, text: '오늘 할 일 4건 — 풍산 전량 매도 · NAVER 절반 매도 · 카카오 전량 매도 외 1' }
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2. groupRowsByTier
// ════════════════════════════════════════════════════════════════════════════
{
  const urgentRow = makeRow('b1', '긴급종목', {}, { price: 9_000 });
  const todayRow = makeRow('b2', '오늘종목', { profitMultiple: 3 }, { price: 12_200 });
  const prepareRow = makeRow('b3', '준비종목', {}, { price: 9_450, ma: { 20: 9_000 } });
  const waitingRow = makeRow('b4', '대기종목', {}, { price: 10_500 });

  const grouped = groupRowsByTier([urgentRow, todayRow, prepareRow, waitingRow]);
  check('urgent 버킷', grouped.urgent.map(r => r.asset.id), ['b1']);
  check('today 버킷', grouped.today.map(r => r.asset.id), ['b2']);
  check('prepare 버킷', grouped.prepare.map(r => r.asset.id), ['b3']);
  check('waiting 버킷', grouped.waiting.map(r => r.asset.id), ['b4']);
  check('빈 입력 → 전부 빈 배열', groupRowsByTier([]), { urgent: [], today: [], prepare: [], waiting: [] });
}

// ════════════════════════════════════════════════════════════════════════════
// 3. needsCheckRows
// ════════════════════════════════════════════════════════════════════════════
{
  const unavailableRow = makeRow('c1', '시세없음', {}, { price: null });
  const staleRow = makeRow('c2', '오래됨', {}, { priceAsOf: '2026-09-01', sessionDate: '2026-09-03' });
  const brokerMissingRow = makeRow('c3', '미등록', { brokerStopOrderRegistered: false }, { price: 10_500 });
  const cleanRow = makeRow('c4', '정상', { brokerStopOrderRegistered: true }, { price: 10_500 });

  checkTrue('unavailable row는 실제로 unavailable 신호', unavailableRow.evaluation.signal === 'unavailable');
  checkTrue('stale row는 실제로 stale 플래그', staleRow.evaluation.stale === true);

  const rows = [unavailableRow, staleRow, brokerMissingRow, cleanRow];
  const nc = needsCheckRows(rows);
  check('unavailable 목록', nc.unavailable.map(r => r.asset.id), ['c1']);
  check('stale 목록', nc.stale.map(r => r.asset.id), ['c2']);
  check('brokerStopMissing 목록(등록 안 된 것만)', nc.brokerStopMissing.map(r => r.asset.id), ['c3']);
  checkTrue('정상 row는 세 목록 어디에도 없음', !nc.unavailable.includes(cleanRow) && !nc.stale.includes(cleanRow) && !nc.brokerStopMissing.includes(cleanRow));
}

// ════════════════════════════════════════════════════════════════════════════
// 3-b. actionNeededCount — 자산 id 합집합(긴급·오늘 ∪ 확인 필요)
// ════════════════════════════════════════════════════════════════════════════
{
  // 긴급 가격(9,000) + 오래된 시세 → 긴급/stale 중복 플래그
  const urgentStale = makeRow('d1', '긴급오래됨', {}, { price: 9_000, priceAsOf: '2026-09-01', sessionDate: '2026-09-03' });
  const todayRow = makeRow('d2', '익절', { profitMultiple: 3 }, { price: 12_200 });
  // 시세 결측 + 손절주문 미등록 → 확인 필요 플래그 2개가 한 자산에 겹침
  const missingBoth = makeRow('d3', '결측미등록', { brokerStopOrderRegistered: false }, { price: null });
  const clean = makeRow('d4', '정상', {}, { price: 10_500 });

  checkTrue('d1 fixture: stale 플래그', urgentStale.evaluation.stale === true);
  checkTrue('d2 fixture: today 등급', todayRow.evaluation.tier === 'today');
  checkTrue('d3 fixture: unavailable + 미등록', missingBoth.evaluation.signal === 'unavailable' && !missingBoth.plan.brokerStopOrderRegistered);
  checkTrue('d4 fixture: 아무 플래그 없음', clean.evaluation.tier === 'none' && !clean.evaluation.stale && clean.plan.brokerStopOrderRegistered);

  check('예시 4행(긴급+stale · 오늘 · 결측+미등록 · 정상) → 3', actionNeededCount([urgentStale, todayRow, missingBoth, clean]), 3);
  check('빈 입력 → 0', actionNeededCount([]), 0);
  check('플래그 겹친 한 행 → 1', actionNeededCount([missingBoth]), 1);
  // 같은 자산 id가 두 행에 나타나도(방어) 자산 단위 1건
  const dupSameAsset = makeRow('d3', '결측미등록', {}, { priceAsOf: '2026-09-01', sessionDate: '2026-09-03' });
  check('같은 자산 id 두 행 → 1', actionNeededCount([missingBoth, dupSameAsset]), 1);
  check('정상 행만 → 0', actionNeededCount([clean]), 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. observeCounts
// ════════════════════════════════════════════════════════════════════════════
function makeAlertResult(matchedAssetIds: string[]): AlertResult {
  return {
    rule: { id: 'r1', name: 'test', description: '', severity: 'info', action: 'sell', enabled: true, filters: [], filterConfig: {} },
    matchedAssets: matchedAssetIds.map(id => ({ assetId: id, assetName: id, ticker: id, details: '' })),
  };
}
function makeRiskRow(assetId: string): RiskMatrixRow {
  return {
    assetId, ticker: assetId, assetName: assetId, source: 'portfolio',
    assessment: { tier: 'red', score: 10, reasons: [], climaxFlagCount: 2, distributionCount: 0 },
  };
}
{
  const counts = observeCounts({
    alertResults: [makeAlertResult(['x1', 'x2']), makeAlertResult(['x3'])],
    riskMatrix: [makeRiskRow('x1'), makeRiskRow('x4')],
    turtleWatchBreakouts: 1,
  });
  check('알림 건수 = matchedAssets 총합', counts.alertCount, 3);
  check('과열 건수 = riskMatrix 길이', counts.riskCount, 2);
  check('55일 돌파는 주입값 그대로', counts.breakoutCount, 1);

  const zero = observeCounts({ alertResults: [], riskMatrix: [], turtleWatchBreakouts: 0 });
  check('빈 입력 → 전부 0', zero, { alertCount: 0, riskCount: 0, breakoutCount: 0 });
}

// ════════════════════════════════════════════════════════════════════════════
// 5. pendingOrderCounts
// ════════════════════════════════════════════════════════════════════════════
function makeAction(over: Partial<ActionItem> & { id: string; kind: ActionItem['kind'] }): ActionItem {
  return {
    createdDate: TODAY, ticker: 'X', name: 'X', quantity: 1, refPrice: 100,
    reasonText: '', ruleSnapshot: {}, status: 'pending',
    ...over,
  };
}
{
  const queue: ActionItem[] = [
    makeAction({ id: '1', kind: 'REBALANCE_BUY' }),
    makeAction({ id: '2', kind: 'REBALANCE_SELL' }),
    makeAction({ id: '3', kind: 'REBALANCE_SELL', status: 'snoozed' }), // snoozed도 active(스누즈 후 재대기)
    makeAction({ id: '4', kind: 'CLEANUP_SELL' }),
    makeAction({ id: '5', kind: 'TURTLE_ENTRY' }), // 잠김 kind — 집계 제외
    makeAction({ id: '6', kind: 'REBALANCE_BUY', status: 'done' }), // 처리됨 — 제외
    makeAction({ id: '7', kind: 'CLEANUP_SELL', status: 'skipped' }), // 처리됨 — 제외
  ];
  check('대기 리밸런싱 3(스누즈 포함) · 대청소 1', pendingOrderCounts(queue), { rebalance: 3, cleanup: 1 });
  check('빈 큐 → 0/0', pendingOrderCounts([]), { rebalance: 0, cleanup: 0 });
}

// ════════════════════════════════════════════════════════════════════════════
// 6. countPlanPriorityObserved
// ════════════════════════════════════════════════════════════════════════════
{
  const alertResults = [makeAlertResult(['p1', 'p2']), makeAlertResult(['p1', 'p3'])]; // p1 중복
  const riskMatrix = [makeRiskRow('p2'), makeRiskRow('p4')];
  const planned = new Set(['p1', 'p2', 'p4', 'p9']); // p9는 알림/리스크에 안 나타남

  check('계획 종목 중 알림·리스크에 걸린 자산 수(중복 제거)', countPlanPriorityObserved(alertResults, riskMatrix, planned), 3);
  check('계획 종목 없음 → 0', countPlanPriorityObserved(alertResults, riskMatrix, new Set()), 0);
  check('알림·리스크 자체가 없음 → 0', countPlanPriorityObserved([], [], planned), 0);
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ todayViewModel parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ todayViewModel parity 전체 통과 (${pass} 단언)`);
