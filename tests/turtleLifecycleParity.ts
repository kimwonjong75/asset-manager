// tests/turtleLifecycleParity.ts
// ---------------------------------------------------------------------------
// 터틀 포지션 lifecycle 순수 함수 골든 테스트 (Phase 2b-4b-1).
//   · createPositionFromEntry — 진입가−2N 손절, units[0], open
//   · addPyramidUnit — 유닛 추가 + 손절 동반 상향, 원통화 보존
//   · closePosition — status closed + closedAt + exitReason
//   · upsertPosition — 교체/추가 불변
//   · 통화 규약: 손절가/체결가 원통화, fxRateAtFill는 감사용
// 수동 실행: npm run test:turtlelifecycle (tsx). 통과 시 exit 0.

import { TurtleSettings, DEFAULT_TURTLE_SETTINGS, TurtlePosition } from '../types/turtle';
import {
  createPositionFromEntry,
  addPyramidUnit,
  closePosition,
  upsertPosition,
} from '../utils/turtleLifecycle';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function checkClose(name: string, actual: number, expected: number, eps = 1e-6): void {
  if (Math.abs(actual - expected) <= eps) pass++; else fails.push(`✗ ${name}: got ${actual}, expected ${expected}`);
}
function checkTrue(name: string, cond: boolean): void {
  if (cond) pass++; else fails.push(`✗ ${name}: expected true`);
}

const S = (over: Partial<TurtleSettings> = {}): TurtleSettings => ({ ...DEFAULT_TURTLE_SETTINGS, stopMultipleN: 2, ...over });

// ════════════════════════════════════════════════════════════════════════════
// 1. createPositionFromEntry — 진입 100, N 5 → 손절 90 (원통화)
// ════════════════════════════════════════════════════════════════════════════
const entryPos = createPositionFromEntry({
  id: 'tp-1', ticker: 'ABC', name: '에이비씨', assetId: 'asset-1',
  fillDate: '2026-07-05', fillPrice: 100, quantity: 250, nAtEntry: 5, fxRate: 1400, donchianHigh: 99,
}, S());
check('진입 status open', entryPos.status, 'open');
check('진입 유닛 1개', entryPos.units.length, 1);
checkClose('진입 손절가 90 (100−2×5, 원통화)', entryPos.stopPrice, 90);
check('진입 openedAt = 체결일', entryPos.openedAt, '2026-07-05');
check('진입 assetId 연결', entryPos.assetId, 'asset-1');
check('진입 entryDonchianHigh 스냅샷', entryPos.entryDonchianHigh, 99);
check('유닛 fxRateAtFill 감사 저장', entryPos.units[0].fxRateAtFill, 1400);
check('유닛 체결가 원통화', entryPos.units[0].fillPrice, 100);
check('유닛 nAtFill', entryPos.units[0].nAtFill, 5);

// ════════════════════════════════════════════════════════════════════════════
// 2. addPyramidUnit — 105 추가, N 5 → 손절 95 (마지막 체결가−2N), 원통화 보존
// ════════════════════════════════════════════════════════════════════════════
const pyr = addPyramidUnit(entryPos, { fillDate: '2026-07-07', fillPrice: 105, quantity: 250, nAtFill: 5, fxRate: 1410 }, S());
check('피라미딩 후 유닛 2개', pyr.units.length, 2);
checkClose('피라미딩 후 손절 95 (105−2×5)', pyr.stopPrice, 95);
check('첫 유닛 체결가 보존', pyr.units[0].fillPrice, 100);
check('둘째 유닛 체결가', pyr.units[1].fillPrice, 105);
check('둘째 유닛 fxRateAtFill', pyr.units[1].fxRateAtFill, 1410);
// 불변성: 원본 포지션 미변경
check('원본 포지션 불변(유닛 1)', entryPos.units.length, 1);
checkClose('원본 손절가 불변 90', entryPos.stopPrice, 90);

// ════════════════════════════════════════════════════════════════════════════
// 3. closePosition — status closed + closedAt + exitReason, 유닛/손절 보존
// ════════════════════════════════════════════════════════════════════════════
const closed = closePosition(pyr, { closedAt: '2026-07-20', exitReason: 'stop' });
check('종료 status closed', closed.status, 'closed');
check('종료 closedAt', closed.closedAt, '2026-07-20');
check('종료 exitReason', closed.exitReason, 'stop');
check('종료도 유닛 보존', closed.units.length, 2);
checkClose('종료도 손절가 보존', closed.stopPrice, 95);
check('원본 pyr 불변(open 유지)', pyr.status, 'open');

// ════════════════════════════════════════════════════════════════════════════
// 4. upsertPosition — 교체/추가 불변
// ════════════════════════════════════════════════════════════════════════════
const list: TurtlePosition[] = [entryPos];
const replaced = upsertPosition(list, closePosition(entryPos, { closedAt: '2026-07-21', exitReason: 'channel-exit' }));
check('교체 길이 유지', replaced.length, 1);
check('교체 반영', replaced[0].status, 'closed');
check('원본 리스트 불변', list[0].status, 'open');
const added = upsertPosition(list, createPositionFromEntry({
  id: 'tp-2', ticker: 'XYZ', name: 'XYZ', fillDate: '2026-07-05', fillPrice: 50, quantity: 10, nAtEntry: 2, donchianHigh: 49,
}, S()));
check('신규 추가 길이', added.length, 2);
checkTrue('신규 id 존재', added.some(p => p.id === 'tp-2'));

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ turtleLifecycle parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  console.error(`\n통과 ${pass} / 실패 ${fails.length}`);
  process.exit(1);
} else {
  console.log(`✅ turtleLifecycle parity 전체 통과 (${pass} 단언)`);
}
