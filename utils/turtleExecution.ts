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

/** 실제 체결값 (모달 최종 입력). 주문안 refPrice가 아니라 이 값으로 lifecycle을 만든다. */
export interface TurtleFill {
  fillDate: string;
  fillPrice: number;
  quantity: number;
}

export interface ResolveTurtleUpdateInput {
  action: ActionItem;
  fill: TurtleFill;
  settings: TurtleSettings;
  turtlePositions: TurtlePosition[];
  actionQueue: ActionItem[];
  today: string;
  // 저장 성공 후 주입되는 실제 메타
  assetId?: string;        // ENTRY: 생성된 Asset id
  fxRate?: number;         // ENTRY/PYRAMID: 체결 환율 (감사용)
  sellRecordId?: string;   // STOP/EXIT: 생성된 SellRecord id
  newPositionId?: string;  // ENTRY: 새 포지션 id (주입)
}

/**
 * 저장 성공 후 kind별 **turtlePositions + actionQueue** 다음 상태 계산 (순수).
 * assets/sellHistory는 호출부가 머니 액션 반환(nextAssets/nextSellHistory)을 그대로 쓴다(재계산·divergence 없음).
 * N·donchianHigh는 `action.ruleSnapshot`(생성 시 원통화), 손절가는 실제 체결가 기준 recomputeStop.
 * 필수 입력 누락(assetId/newPositionId/positionId 등)이면 null → 호출부가 커밋 안 함(안전).
 */
export function resolveTurtleUpdate(input: ResolveTurtleUpdateInput):
  { turtlePositions: TurtlePosition[]; actionQueue: ActionItem[] } | null {
  const { action, fill, settings, turtlePositions, actionQueue, today } = input;
  const snap = action.ruleSnapshot;

  if (action.kind === 'TURTLE_ENTRY') {
    if (!input.assetId || !input.newPositionId) return null;
    const positions = applyEntryExecution(turtlePositions, settings, {
      id: input.newPositionId,
      ticker: action.ticker,
      name: action.name,
      assetId: input.assetId,
      fillDate: fill.fillDate,
      fillPrice: fill.fillPrice,
      quantity: fill.quantity,
      nAtEntry: snap.n ?? 0,
      fxRate: input.fxRate,
      donchianHigh: snap.donchianHigh ?? fill.fillPrice,
    });
    const queue = completeQueueItem(actionQueue, action.id, { resolvedDate: today });
    return { turtlePositions: positions, actionQueue: queue };
  }

  if (action.kind === 'TURTLE_PYRAMID') {
    if (!action.positionId) return null;
    const target = turtlePositions.find(p => p.id === action.positionId && p.status === 'open');
    if (!target) return null;
    const lastUnit = target.units[target.units.length - 1];
    const positions = applyPyramidExecution(turtlePositions, settings, action.positionId, {
      fillDate: fill.fillDate,
      fillPrice: fill.fillPrice,
      quantity: fill.quantity,
      nAtFill: snap.n ?? lastUnit?.nAtFill ?? 0,
      fxRate: input.fxRate,
    });
    const queue = completeQueueItem(actionQueue, action.id, { resolvedDate: today });
    return { turtlePositions: positions, actionQueue: queue };
  }

  if (action.kind === 'TURTLE_STOP' || action.kind === 'TURTLE_EXIT') {
    if (!action.positionId) return null;
    const reason = exitReasonForKind(action.kind);
    if (!reason) return null;
    const positions = applyCloseExecution(turtlePositions, action.positionId, {
      closedAt: fill.fillDate,
      exitReason: reason,
    });
    const queue = completeQueueItem(actionQueue, action.id, {
      resolvedDate: today,
      linkedSellRecordId: input.sellRecordId,
    });
    return { turtlePositions: positions, actionQueue: queue };
  }

  return null; // 리밸런싱/대청소 등은 별도 경로
}
