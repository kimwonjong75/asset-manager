// utils/turtleExecution.ts
// ---------------------------------------------------------------------------
// 터틀 주문 "저장 성공 후" 상태 전이 (Phase 2b-4b-2c/2d, 순수 함수).
// 매수/매도 저장이 실제로 성공한 뒤 호출부(context)가 이 함수들로 다음 상태를 계산한다.
// 계산만 — 실제 setState/Drive 저장은 context가 수행하며, 반드시 saveResult.ok === true일 때만 부른다.
//
// 안전 불변식(Codex):
//   · lifecycle은 **실제 저장값**(사용자 최종 입력) 기준 — 주문안 refPrice로 포지션 만들기 금지.
//   · 손절가/체결가/N 원통화(D6). 포지션 못 찾으면 배열 불변(안전).

import { TurtlePosition, TurtleSettings, TurtleExitReason } from '../types/turtle';
import { ActionItem } from '../types/actionQueue';
import {
  createPositionFromEntry,
  addPyramidUnit,
  closePosition,
  upsertPosition,
  EntryExecution,
  PyramidExecution,
} from './turtleLifecycle';

/** 진입 저장 성공 → 신규 포지션 생성 후 배열에 추가. */
export function applyEntryExecution(
  positions: TurtlePosition[],
  settings: TurtleSettings,
  exec: EntryExecution
): TurtlePosition[] {
  return upsertPosition(positions, createPositionFromEntry(exec, settings));
}

/** 피라미딩 저장 성공 → 해당 포지션 유닛 추가 + 손절 상향. 포지션 없으면 불변. */
export function applyPyramidExecution(
  positions: TurtlePosition[],
  settings: TurtleSettings,
  positionId: string,
  exec: PyramidExecution
): TurtlePosition[] {
  const pos = positions.find(p => p.id === positionId && p.status === 'open');
  if (!pos) return positions;
  return upsertPosition(positions, addPyramidUnit(pos, exec, settings));
}

/** 매도(손절/청산) 저장 성공 → 해당 포지션 종료. 포지션 없으면 불변. */
export function applyCloseExecution(
  positions: TurtlePosition[],
  positionId: string,
  opts: { closedAt: string; exitReason: TurtleExitReason }
): TurtlePosition[] {
  const pos = positions.find(p => p.id === positionId && p.status === 'open');
  if (!pos) return positions;
  return upsertPosition(positions, closePosition(pos, opts));
}

/** 큐 항목을 done 처리 (resolvedDate + 선택적 linkedSellRecordId). 그 외 항목 불변. */
export function completeQueueItem(
  queue: ActionItem[],
  actionId: string,
  opts: { resolvedDate: string; linkedSellRecordId?: string }
): ActionItem[] {
  return queue.map(it =>
    it.id === actionId
      ? { ...it, status: 'done' as const, resolvedDate: opts.resolvedDate, linkedSellRecordId: opts.linkedSellRecordId ?? it.linkedSellRecordId }
      : it
  );
}

/** action.kind → 매도 종료 사유. stop/exit만 유효, 그 외 null. */
export function exitReasonForKind(kind: ActionItem['kind']): TurtleExitReason | null {
  if (kind === 'TURTLE_STOP') return 'stop';
  if (kind === 'TURTLE_EXIT') return 'channel-exit';
  return null;
}
