// tests/turtleExecutionParity.ts
// ---------------------------------------------------------------------------
// 터틀 "저장 성공 후" 상태 전이 순수 함수 골든 테스트 (Phase 2b-4b-2c/2d).
//   · applyEntryExecution / applyPyramidExecution / applyCloseExecution (포지션 없음=불변)
//   · completeQueueItem (done + linkedSellRecordId)
//   · exitReasonForKind
// 수동 실행: npm run test:turtleexec (tsx). 통과 시 exit 0.

import { TurtleSettings, DEFAULT_TURTLE_SETTINGS, TurtlePosition } from '../types/turtle';
import { ActionItem } from '../types/actionQueue';
import {
  applyEntryExecution,
  applyPyramidExecution,
  applyCloseExecution,
  completeQueueItem,
  exitReasonForKind,
  resolveTurtleUpdate,
} from '../utils/turtleExecution';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function checkClose(name: string, actual: number, expected: number, eps = 1e-6): void {
  if (Math.abs(actual - expected) <= eps) pass++; else fails.push(`✗ ${name}: got ${actual}, expected ${expected}`);
}

const S = (over: Partial<TurtleSettings> = {}): TurtleSettings => ({ ...DEFAULT_TURTLE_SETTINGS, stopMultipleN: 2, ...over });

function openPos(id: string): TurtlePosition {
  return {
    id, ticker: 'ABC', name: '에이', assetId: `asset-${id}`, status: 'open', openedAt: '2026-07-01', entryDonchianHigh: 99,
    units: [{ fillDate: '2026-07-01', fillPrice: 100, quantity: 250, nAtFill: 5, fxRateAtFill: 1 }],
    stopPrice: 90,
  };
}

// ── 1. applyEntryExecution — 신규 포지션 추가 ──
{
  const out = applyEntryExecution([], S(), {
    id: 'tp-1', ticker: 'ABC', name: '에이', assetId: 'asset-1',
    fillDate: '2026-07-05', fillPrice: 100, quantity: 250, nAtEntry: 5, fxRate: 1400, donchianHigh: 99,
  });
  check('진입 실행 → 1 포지션', out.length, 1);
  check('진입 status open', out[0].status, 'open');
  checkClose('진입 손절 90', out[0].stopPrice, 90);
  check('진입 assetId', out[0].assetId, 'asset-1');
}

// ── 2. applyPyramidExecution — 유닛 추가 / 포지션 없거나 closed면 불변 ──
{
  const positions = [openPos('tp-1')];
  const out = applyPyramidExecution(positions, S(), 'tp-1', { fillDate: '2026-07-07', fillPrice: 105, quantity: 250, nAtFill: 5, fxRate: 1 });
  check('피라미딩 → 유닛 2', out[0].units.length, 2);
  checkClose('피라미딩 손절 95', out[0].stopPrice, 95);
  check('원본 불변', positions[0].units.length, 1);
  // 없는 포지션 → 불변
  check('없는 포지션 → 불변', applyPyramidExecution(positions, S(), 'nope', { fillDate: '2026-07-07', fillPrice: 105, quantity: 1, nAtFill: 5 }), positions);
  // closed 포지션 → 불변
  const closedList = [{ ...openPos('tp-2'), status: 'closed' as const }];
  check('closed 포지션 → 불변', applyPyramidExecution(closedList, S(), 'tp-2', { fillDate: '2026-07-07', fillPrice: 105, quantity: 1, nAtFill: 5 }), closedList);
}

// ── 3. applyCloseExecution — 종료 / 없으면 불변 ──
{
  const positions = [openPos('tp-1')];
  const out = applyCloseExecution(positions, 'tp-1', { closedAt: '2026-07-20', exitReason: 'stop' });
  check('종료 status closed', out[0].status, 'closed');
  check('종료 closedAt', out[0].closedAt, '2026-07-20');
  check('종료 exitReason', out[0].exitReason, 'stop');
  check('원본 open 유지', positions[0].status, 'open');
  check('없는 포지션 종료 → 불변', applyCloseExecution(positions, 'nope', { closedAt: '2026-07-20', exitReason: 'stop' }), positions);
}

// ── 4. completeQueueItem — done + linkedSellRecordId ──
{
  const queue: ActionItem[] = [
    { id: 'a1', createdDate: '2026-07-05', kind: 'TURTLE_STOP', ticker: 'ABC', name: 'A', quantity: 1, refPrice: 1, reasonText: '', ruleSnapshot: {}, status: 'pending' },
    { id: 'a2', createdDate: '2026-07-05', kind: 'TURTLE_ENTRY', ticker: 'XYZ', name: 'X', quantity: 1, refPrice: 1, reasonText: '', ruleSnapshot: {}, status: 'pending' },
  ];
  const out = completeQueueItem(queue, 'a1', { resolvedDate: '2026-07-20', linkedSellRecordId: 'sr-99' });
  check('a1 done', out.find(i => i.id === 'a1')!.status, 'done');
  check('a1 resolvedDate', out.find(i => i.id === 'a1')!.resolvedDate, '2026-07-20');
  check('a1 linkedSellRecordId', out.find(i => i.id === 'a1')!.linkedSellRecordId, 'sr-99');
  check('a2 불변 pending', out.find(i => i.id === 'a2')!.status, 'pending');
  check('원본 불변', queue[0].status, 'pending');
  // linkedSellRecordId 없이 done (매수)
  const out2 = completeQueueItem(queue, 'a2', { resolvedDate: '2026-07-06' });
  check('a2 done (link 없음)', out2.find(i => i.id === 'a2')!.status, 'done');
  check('a2 link undefined', out2.find(i => i.id === 'a2')!.linkedSellRecordId, undefined);
}

// ── 5. exitReasonForKind ──
check('STOP → stop', exitReasonForKind('TURTLE_STOP'), 'stop');
check('EXIT → channel-exit', exitReasonForKind('TURTLE_EXIT'), 'channel-exit');
check('ENTRY → null', exitReasonForKind('TURTLE_ENTRY'), null);
check('PYRAMID → null', exitReasonForKind('TURTLE_PYRAMID'), null);

// ── 6. resolveTurtleUpdate — kind별 저장성공 후 positions+queue (실제 체결값 기준) ──
function mkAction(over: Partial<ActionItem> & { id: string; kind: ActionItem['kind'] }): ActionItem {
  return {
    createdDate: '2026-07-05', ticker: 'ABC', name: '에이', quantity: 250, refPrice: 100,
    reasonText: '', ruleSnapshot: {}, status: 'pending', ...over,
  };
}
const TODAY = '2026-07-20';
{
  // ENTRY: 실제 체결 100/250 → 신규 포지션(손절 90), action done
  const action = mkAction({ id: 'a-entry', kind: 'TURTLE_ENTRY', ruleSnapshot: { n: 5, donchianHigh: 99 } });
  const queue = [action];
  const out = resolveTurtleUpdate({
    action, fill: { fillDate: '2026-07-05', fillPrice: 100, quantity: 250 }, settings: S(),
    turtlePositions: [], actionQueue: queue, today: TODAY, assetId: 'asset-1', fxRate: 1400, newPositionId: 'tp-1',
  })!;
  check('ENTRY 포지션 1', out.turtlePositions.length, 1);
  check('ENTRY assetId 연결', out.turtlePositions[0].assetId, 'asset-1');
  check('ENTRY 실제수량 250', out.turtlePositions[0].units[0].quantity, 250);
  checkClose('ENTRY 손절 90 (실제가 100−2×5)', out.turtlePositions[0].stopPrice, 90);
  check('ENTRY action done', out.actionQueue[0].status, 'done');
  // 가드: assetId/newPositionId 누락 → null
  check('ENTRY assetId 누락 → null', resolveTurtleUpdate({ action, fill: { fillDate: '2026-07-05', fillPrice: 100, quantity: 250 }, settings: S(), turtlePositions: [], actionQueue: queue, today: TODAY, newPositionId: 'tp-1' }), null);
  check('ENTRY positionId 누락 → null', resolveTurtleUpdate({ action, fill: { fillDate: '2026-07-05', fillPrice: 100, quantity: 250 }, settings: S(), turtlePositions: [], actionQueue: queue, today: TODAY, assetId: 'asset-1' }), null);
}
{
  // PYRAMID: 기존 포지션에 실제 105/250 추가 → 손절 95, done
  const pos = openPos('tp-1');
  const action = mkAction({ id: 'a-pyr', kind: 'TURTLE_PYRAMID', positionId: 'tp-1', ruleSnapshot: { n: 5 } });
  const out = resolveTurtleUpdate({
    action, fill: { fillDate: '2026-07-07', fillPrice: 105, quantity: 250 }, settings: S(),
    turtlePositions: [pos], actionQueue: [action], today: TODAY, fxRate: 1,
  })!;
  check('PYRAMID 유닛 2', out.turtlePositions[0].units.length, 2);
  checkClose('PYRAMID 손절 95', out.turtlePositions[0].stopPrice, 95);
  check('PYRAMID action done', out.actionQueue[0].status, 'done');
  // 없는 포지션 → null
  check('PYRAMID 없는 포지션 → null', resolveTurtleUpdate({ action: mkAction({ id: 'x', kind: 'TURTLE_PYRAMID', positionId: 'nope' }), fill: { fillDate: '2026-07-07', fillPrice: 105, quantity: 250 }, settings: S(), turtlePositions: [pos], actionQueue: [], today: TODAY }), null);
}
{
  // STOP: 실제 매도일 종료 + linkedSellRecordId
  const pos = openPos('tp-1');
  const action = mkAction({ id: 'a-stop', kind: 'TURTLE_STOP', positionId: 'tp-1' });
  const out = resolveTurtleUpdate({
    action, fill: { fillDate: '2026-07-20', fillPrice: 88, quantity: 250 }, settings: S(),
    turtlePositions: [pos], actionQueue: [action], today: TODAY, sellRecordId: 'sr-9',
  })!;
  check('STOP 포지션 closed', out.turtlePositions[0].status, 'closed');
  check('STOP exitReason', out.turtlePositions[0].exitReason, 'stop');
  check('STOP closedAt=실제 매도일', out.turtlePositions[0].closedAt, '2026-07-20');
  check('STOP action done', out.actionQueue[0].status, 'done');
  check('STOP linkedSellRecordId', out.actionQueue[0].linkedSellRecordId, 'sr-9');
}
{
  // EXIT: channel-exit
  const pos = openPos('tp-1');
  const action = mkAction({ id: 'a-exit', kind: 'TURTLE_EXIT', positionId: 'tp-1' });
  const out = resolveTurtleUpdate({
    action, fill: { fillDate: '2026-07-21', fillPrice: 91, quantity: 250 }, settings: S(),
    turtlePositions: [pos], actionQueue: [action], today: TODAY, sellRecordId: 'sr-10',
  })!;
  check('EXIT exitReason channel-exit', out.turtlePositions[0].exitReason, 'channel-exit');
  check('EXIT action done + link', out.actionQueue[0].linkedSellRecordId, 'sr-10');
  // positionId 누락 → null
  check('STOP/EXIT positionId 누락 → null', resolveTurtleUpdate({ action: mkAction({ id: 'y', kind: 'TURTLE_STOP' }), fill: { fillDate: '2026-07-20', fillPrice: 88, quantity: 250 }, settings: S(), turtlePositions: [pos], actionQueue: [], today: TODAY }), null);
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ turtleExecution parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  console.error(`\n통과 ${pass} / 실패 ${fails.length}`);
  process.exit(1);
} else {
  console.log(`✅ turtleExecution parity 전체 통과 (${pass} 단언)`);
}
