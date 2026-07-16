// tests/turtleReviewParity.ts
// ---------------------------------------------------------------------------
// 터틀 자동 검토 요약 회귀 테스트 (자동 검토 Phase A/B/C).
// 핵심 앵커:
//   · summarizePreview(diagnose(...)).previewCount === buildTurtleActions(...).length
//     (프리뷰 배지 건수 ≡ 실제 「오늘 주문 생성」 건수 — 브리핑 예고가 실제 생성과 어긋나지 않음)
//   · previewCount === kind별 분해(entry+pyramid+stop+exit) 합
//   · summarizeActiveQueue: pending/snoozed만 카운트 + 에스컬레이션(3일+/스누즈2회+)
//   · evaluateAutoPopupGate 실행 축 확장: 미주입 시 기존 동작 100% 동일(하위호환),
//     알림 0건+실행>0 → will-show, 검토 대기 → not-ready(일자 미기록 유도)
// 수동 실행: npm run test:turtlereview (tsx). 통과 시 exit 0.

import { TurtleSettings, DEFAULT_TURTLE_SETTINGS, TurtlePosition } from '../types/turtle';
import { ActionItem } from '../types/actionQueue';
import {
  buildTurtleActions,
  diagnoseTurtleActions,
  TurtleMarketInput,
  BuildTurtleActionsInput,
} from '../utils/actionQueueGenerator';
import {
  summarizeActiveQueue,
  summarizePreview,
  buildTurtleReviewSummary,
} from '../utils/turtleReview';
import { evaluateAutoPopupGate } from '../utils/alertDiagnostics';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

const TODAY = '2026-07-07';
const makeId = (seq: number) => `t${seq}`;
const S = (over: Partial<TurtleSettings> = {}): TurtleSettings => ({
  ...DEFAULT_TURTLE_SETTINGS, satelliteBudgetKRW: 100_000_000, riskPerUnitPct: 0.5,
  stopMultipleN: 2, positionValueCapPct: 0, maxUnitsPerPosition: 2, maxTotalRiskPct: 12, ...over,
});
function mkMarket(p: Partial<TurtleMarketInput> & { ticker: string }): TurtleMarketInput {
  return { name: p.ticker, price: 0, n: null, donchianHigh: null, donchianLow: null, fxRate: 1, ...p };
}
function mkPos(p: { ticker: string; fillPrice: number; qty: number; n: number; stopPrice: number; status?: 'open' | 'closed'; id?: string }): TurtlePosition {
  return {
    id: p.id ?? `pos-${p.ticker}`, ticker: p.ticker, name: p.ticker, status: p.status ?? 'open',
    openedAt: '2026-01-01', entryDonchianHigh: p.fillPrice,
    units: [{ fillDate: '2026-01-01', fillPrice: p.fillPrice, quantity: p.qty, nAtFill: p.n, fxRateAtFill: 1 }],
    stopPrice: p.stopPrice,
  };
}
function mkAction(p: Partial<ActionItem> & { id: string }): ActionItem {
  return {
    createdDate: TODAY, kind: 'TURTLE_ENTRY', ticker: 'AAA', name: 'A',
    quantity: 1, refPrice: 100, reasonText: '', ruleSnapshot: {}, status: 'pending', ...p,
  };
}
function mkInput(over: Partial<BuildTurtleActionsInput> = {}): BuildTurtleActionsInput {
  return {
    positions: [], candidates: [], marketByTicker: new Map(), settings: S(),
    existingQueue: [], remainingBudgetKRW: 100_000_000, today: TODAY, makeId, ...over,
  };
}

/** 앵커: 프리뷰 요약 ≡ 실제 생성 건수 ≡ kind 분해 합. */
function checkPreviewParity(name: string, over: Partial<BuildTurtleActionsInput>) {
  const input = mkInput(over);
  const built = buildTurtleActions(input);
  const { makeId: _omit, ...diagInput } = input;
  const diag = diagnoseTurtleActions(diagInput);
  const preview = summarizePreview(diag);
  check(`${name}: previewCount == build.length`, preview.previewCount, built.length);
  check(`${name}: previewCount == 분해 합`, preview.previewCount,
    preview.previewEntry + preview.previewPyramid + preview.previewStop + preview.previewExit);
  return preview;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. summarizeActiveQueue — 대기(pending/snoozed)만 + 에스컬레이션
// ════════════════════════════════════════════════════════════════════════════
check('빈 큐', summarizeActiveQueue([], TODAY), { activeCount: 0, escalatedCount: 0 });
{
  const queue: ActionItem[] = [
    mkAction({ id: 'a', status: 'pending', createdDate: TODAY }),                    // 활성, 0일
    mkAction({ id: 'b', status: 'snoozed', createdDate: TODAY, snoozeCount: 1 }),    // 활성, 스누즈 1회 (미달)
    mkAction({ id: 'c', status: 'done', createdDate: '2026-07-01' }),                // 비활성
    mkAction({ id: 'd', status: 'skipped', createdDate: '2026-07-01' }),             // 비활성
  ];
  check('pending+snoozed만 카운트', summarizeActiveQueue(queue, TODAY), { activeCount: 2, escalatedCount: 0 });
}
{
  const queue: ActionItem[] = [
    mkAction({ id: 'a', status: 'pending', createdDate: '2026-07-04' }),                 // 3일 → level 1
    mkAction({ id: 'b', status: 'pending', createdDate: '2026-06-30' }),                 // 7일 → level 2
    mkAction({ id: 'c', status: 'snoozed', createdDate: TODAY, snoozeCount: 2 }),        // 스누즈 2회 → level 1
    mkAction({ id: 'd', status: 'pending', createdDate: '2026-07-06' }),                 // 1일 → level 0
  ];
  check('에스컬레이션(3일+/7일+/스누즈2회+)', summarizeActiveQueue(queue, TODAY), { activeCount: 4, escalatedCount: 3 });
}

// ════════════════════════════════════════════════════════════════════════════
// 2. summarizePreview ≡ 생성 건수 (앵커) + kind 분해
// ════════════════════════════════════════════════════════════════════════════
check('진단 null → 전부 0', summarizePreview(null),
  { previewCount: 0, previewEntry: 0, previewPyramid: 0, previewStop: 0, previewExit: 0 });

{ // 진입 1건
  const market = new Map([['AAA', mkMarket({ ticker: 'AAA', price: 80_000, n: 2000, donchianHigh: 80_000 })]]);
  const p = checkPreviewParity('진입 생성', { candidates: [{ ticker: 'AAA', name: 'A' }], marketByTicker: market });
  check('진입 분해', [p.previewEntry, p.previewPyramid, p.previewStop, p.previewExit], [1, 0, 0, 0]);
}
{ // 미돌파 → 0건
  const market = new Map([['AAA', mkMarket({ ticker: 'AAA', price: 79_999, n: 2000, donchianHigh: 80_000 })]]);
  const p = checkPreviewParity('미돌파 0건', { candidates: [{ ticker: 'AAA', name: 'A' }], marketByTicker: market });
  check('미돌파 previewCount 0', p.previewCount, 0);
}
{ // 손절 1건 (가격 ≤ stopPrice)
  const pos = mkPos({ ticker: 'BBB', fillPrice: 100_000, qty: 10, n: 2000, stopPrice: 96_000 });
  const market = new Map([['BBB', mkMarket({ ticker: 'BBB', price: 95_000, n: 2000, donchianLow: 90_000 })]]);
  const p = checkPreviewParity('손절 생성', { positions: [pos], marketByTicker: market });
  check('손절 분해', [p.previewEntry, p.previewPyramid, p.previewStop, p.previewExit], [0, 0, 1, 0]);
}
{ // 청산 1건 (손절 미달 + 20일 저가 이탈)
  const pos = mkPos({ ticker: 'CCC', fillPrice: 100_000, qty: 10, n: 2000, stopPrice: 90_000 });
  const market = new Map([['CCC', mkMarket({ ticker: 'CCC', price: 95_000, n: 2000, donchianLow: 96_000 })]]);
  const p = checkPreviewParity('청산 생성', { positions: [pos], marketByTicker: market });
  check('청산 분해', [p.previewEntry, p.previewPyramid, p.previewStop, p.previewExit], [0, 0, 0, 1]);
}
{ // 불타기 1건 (직전 체결가 + 0.5N 이상)
  const pos = mkPos({ ticker: 'DDD', fillPrice: 100_000, qty: 10, n: 2000, stopPrice: 96_000 });
  const market = new Map([['DDD', mkMarket({ ticker: 'DDD', price: 101_000, n: 2000, donchianLow: 90_000 })]]);
  const p = checkPreviewParity('불타기 생성', { positions: [pos], marketByTicker: market });
  check('불타기 분해', [p.previewEntry, p.previewPyramid, p.previewStop, p.previewExit], [0, 1, 0, 0]);
}
{ // 이미 대기 중(duplicate-pending) → 프리뷰 0 (배지 이중 카운트 방지의 근거)
  const market = new Map([['AAA', mkMarket({ ticker: 'AAA', price: 80_000, n: 2000, donchianHigh: 80_000 })]]);
  const existing = [mkAction({ id: 'q1', kind: 'TURTLE_ENTRY', ticker: 'AAA', status: 'pending' })];
  const p = checkPreviewParity('대기 중 중복 배제', {
    candidates: [{ ticker: 'AAA', name: 'A' }], marketByTicker: market, existingQueue: existing,
  });
  check('중복 previewCount 0', p.previewCount, 0);
}
{ // 혼합: 손절 1 + 진입 1
  const pos = mkPos({ ticker: 'BBB', fillPrice: 100_000, qty: 10, n: 2000, stopPrice: 96_000 });
  const market = new Map([
    ['BBB', mkMarket({ ticker: 'BBB', price: 95_000, n: 2000, donchianLow: 90_000 })],
    ['AAA', mkMarket({ ticker: 'AAA', price: 80_000, n: 2000, donchianHigh: 80_000 })],
  ]);
  const p = checkPreviewParity('혼합(손절+진입)', {
    positions: [pos], candidates: [{ ticker: 'AAA', name: 'A' }], marketByTicker: market,
  });
  check('혼합 previewCount 2', p.previewCount, 2);
  check('혼합 분해', [p.previewEntry, p.previewStop], [1, 1]);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. buildTurtleReviewSummary — actionable = 대기 + 프리뷰 합성
// ════════════════════════════════════════════════════════════════════════════
{
  const market = new Map([['AAA', mkMarket({ ticker: 'AAA', price: 80_000, n: 2000, donchianHigh: 80_000 })]]);
  const existing = [mkAction({ id: 'q1', kind: 'TURTLE_STOP', ticker: 'ZZZ', status: 'pending', createdDate: '2026-07-01' })];
  const input = mkInput({ candidates: [{ ticker: 'AAA', name: 'A' }], marketByTicker: market, existingQueue: existing });
  const { makeId: _omit, ...diagInput } = input;
  const diag = diagnoseTurtleActions(diagInput);
  const summary = buildTurtleReviewSummary({
    queue: existing, today: TODAY, diagnostics: diag,
    turtleCandidateCount: 1, budgetMissing: false,
    isChecking: false, reviewPending: false, reviewFailed: false, checkedAt: '09:30',
  });
  // **터틀 안전잠금(types/turtleLock)**: 공개 요약은 **원시 숫자까지** 잠긴 터틀을 뺀다 —
  // 소비처(AlertPopup/App 배지)가 activeCount·escalatedCount·preview* 를 직접 읽으므로
  // actionableCount 만 걸러선 잠긴 터틀 숫자가 그대로 새어 나간다.
  // 여기 큐 1건은 TURTLE_STOP, 프리뷰 1건도 터틀 → 공개값 전부 0.
  // 순수 집계 함수(summarizeActiveQueue/summarizePreview)는 잠금을 모른 채 유지된다(위 앵커 테스트가 강제).
  check('summary activeCount — 잠금 터틀 제외', summary.activeCount, 0);
  check('summary escalatedCount — 잠금 터틀 제외', summary.escalatedCount, 0);
  check('summary previewCount — 잠금 중 0', summary.previewCount, 0);
  check('summary actionableCount — 잠금 중 터틀 제외', summary.actionableCount, 0);
  check('summary turtleLocked', summary.turtleLocked, true);
  check('summary lockedCount(대기 터틀 1건)', summary.lockedCount, 1);
  check('summary checkedAt 통과', summary.checkedAt, '09:30');
}
{ // 진단 없음(검토 전/실패) — 대기 건수만
  const existing = [mkAction({ id: 'q1', status: 'pending' })]; // 기본 kind = TURTLE_ENTRY → 잠금 대상
  const summary = buildTurtleReviewSummary({
    queue: existing, today: TODAY, diagnostics: null,
    turtleCandidateCount: 0, budgetMissing: true,
    isChecking: false, reviewPending: true, reviewFailed: false, checkedAt: null,
  });
  // 잠금 중: 대기 1건이 터틀이라 공개 요약에서 빠진다(큐 기록 자체는 보존 — lockedCount 로만 노출).
  check('진단 없음 actionable — 잠금 중 터틀 제외', summary.actionableCount, 0);
  check('진단 없음 공개 activeCount — 잠금 터틀 제외', summary.activeCount, 0);
  check('진단 없음 lockedCount 로 보존', summary.lockedCount, 1);
  check('진단 없음 previewCount 0', summary.previewCount, 0);
  // 잠금은 터틀에만 적용된다 — 비터틀(리밸런싱·대청소)은 실행 가능 건수에 그대로 남는다.
  const mixed = buildTurtleReviewSummary({
    queue: [
      mkAction({ id: 'q1', status: 'pending' }),                          // TURTLE_ENTRY → 제외
      mkAction({ id: 'q2', kind: 'REBALANCE_BUY', status: 'pending' }),   // 유지
      mkAction({ id: 'q3', kind: 'CLEANUP_SELL', status: 'pending' }),    // 유지
    ],
    today: TODAY, diagnostics: null, turtleCandidateCount: 0, budgetMissing: true,
    isChecking: false, reviewPending: true, reviewFailed: false, checkedAt: null,
  });
  check('잠금은 터틀에만 — 비터틀 2건은 실행 가능 유지', mixed.actionableCount, 2);
  check('잠금 제외 터틀 1건', mixed.lockedCount, 1);
  check('budgetMissing 통과', summary.budgetMissing, true);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. evaluateAutoPopupGate 실행 축 — 하위호환 + will-show/not-ready 확장
// ════════════════════════════════════════════════════════════════════════════
const gate = (o: Partial<Parameters<typeof evaluateAutoPopupGate>[0]> = {}) =>
  evaluateAutoPopupGate({
    enableAutoPopup: true, hasAutoUpdated: true, isLoading: false, assetCount: 5,
    lastCheckedDate: '2026-07-06', today: TODAY, matchedRuleCount: 0, ...o,
  });

// 하위호환: 실행 축 미주입 시 기존 동작 100% 동일 (반환 형태 포함)
check('하위호환 no-matches', gate({}), { willAutoShow: false, reason: 'no-matches', matchedRuleCount: 0 });
check('하위호환 will-show', gate({ matchedRuleCount: 2 }), { willAutoShow: true, reason: 'will-show', matchedRuleCount: 2 });

// 실행 축: 알림 0건 + 실행 있음 → will-show
check('알림0+실행2 → will-show', gate({ executionActionableCount: 2 }),
  { willAutoShow: true, reason: 'will-show', matchedRuleCount: 0 });
check('알림0+실행0 → no-matches', gate({ executionActionableCount: 0 }).reason, 'no-matches');

// 검토 대기 → not-ready (일자 미기록 유도 — 검토 완료 후 재평가)
check('검토 대기 → not-ready', gate({ executionReviewPending: true, executionActionableCount: 0 }).reason, 'not-ready');
check('검토 대기여도 오늘 이미 확인 → already-checked 우선',
  gate({ executionReviewPending: true, lastCheckedDate: TODAY }).reason, 'already-checked-today');
check('자동팝업 OFF 최우선', gate({ enableAutoPopup: false, executionActionableCount: 5 }).reason, 'auto-popup-disabled');
check('준비 안 됨 우선', gate({ hasAutoUpdated: false, executionActionableCount: 5 }).reason, 'not-ready');

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${pass}개 통과, ${fails.length}개 실패`);
if (fails.length > 0) {
  for (const f of fails) console.error(f);
  process.exit(1);
}
