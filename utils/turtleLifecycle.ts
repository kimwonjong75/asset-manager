// utils/turtleLifecycle.ts
// ---------------------------------------------------------------------------
// 터틀 포지션 lifecycle 순수 함수 (Phase 2b-4b-1).
// "매수/매도 저장이 성공한 뒤" 어떤 포지션 상태로 바뀌는지를 계산한다 — 계산만, 저장/모달/큐는 호출부(context).
//
// 안전 불변식 (Codex 감시):
//   · 이 함수들은 순수 계산일 뿐 — 실제 상태 변경은 호출부가 "저장 성공 이후에만" 수행한다.
//   · 손절가/N/진입가/트리거는 종목 통화 원본(D6) — KRW 환산 없음.
//   · 손절가는 recomputeStop(마지막 체결가 − stopMultipleN×N)으로만 산출(피라미딩 시 동반 상향).

import { TurtlePosition, TurtleUnit, TurtleSettings, TurtleExitReason } from '../types/turtle';
import { recomputeStop } from './turtleEngine';

export interface EntryExecution {
  id: string;              // 새 포지션 id (호출부 생성)
  ticker: string;
  name: string;
  assetId?: string;        // 실행으로 생성/연결된 Asset id
  fillDate: string;        // 실제 체결일 (모달 입력)
  fillPrice: number;       // 실제 체결가 (원통화)
  quantity: number;        // 실제 체결 수량
  nAtEntry: number;        // 진입 시 N (원통화)
  fxRate?: number;         // 체결 시 환율 (감사용)
  donchianHigh: number;    // 진입 근거 스냅샷 (원통화)
}

/** 진입 체결 성공 → 신규 오픈 포지션 (units[0] + 손절가 = 진입가 − stopMultipleN×N). */
export function createPositionFromEntry(exec: EntryExecution, settings: TurtleSettings): TurtlePosition {
  const unit: TurtleUnit = {
    fillDate: exec.fillDate,
    fillPrice: exec.fillPrice,
    quantity: exec.quantity,
    nAtFill: exec.nAtEntry,
    fxRateAtFill: exec.fxRate,
  };
  const position: TurtlePosition = {
    id: exec.id,
    ticker: exec.ticker,
    name: exec.name,
    assetId: exec.assetId,
    units: [unit],
    stopPrice: 0,
    entryDonchianHigh: exec.donchianHigh,
    status: 'open',
    openedAt: exec.fillDate,
  };
  position.stopPrice = recomputeStop(position, settings);
  return position;
}

export interface PyramidExecution {
  fillDate: string;
  fillPrice: number;
  quantity: number;
  nAtFill: number;         // 추가 체결 시 N (원통화)
  fxRate?: number;
}

/** 피라미딩 체결 성공 → 유닛 추가 + 전체 손절가 상향(마지막 체결가 − stopMultipleN×N). 불변 포지션 반환. */
export function addPyramidUnit(position: TurtlePosition, exec: PyramidExecution, settings: TurtleSettings): TurtlePosition {
  const unit: TurtleUnit = {
    fillDate: exec.fillDate,
    fillPrice: exec.fillPrice,
    quantity: exec.quantity,
    nAtFill: exec.nAtFill,
    fxRateAtFill: exec.fxRate,
  };
  const next: TurtlePosition = { ...position, units: [...position.units, unit] };
  next.stopPrice = recomputeStop(next, settings);
  return next;
}

/** 매도(손절/청산) 체결 성공 → 포지션 종료. 손절가/유닛/원통화 값은 보존(기록). */
export function closePosition(
  position: TurtlePosition,
  opts: { closedAt: string; exitReason: TurtleExitReason }
): TurtlePosition {
  return { ...position, status: 'closed', closedAt: opts.closedAt, exitReason: opts.exitReason };
}

/** 포지션 배열에서 id 일치 항목을 교체, 없으면 추가 (불변). */
export function upsertPosition(positions: TurtlePosition[], updated: TurtlePosition): TurtlePosition[] {
  const idx = positions.findIndex(p => p.id === updated.id);
  if (idx === -1) return [...positions, updated];
  const next = positions.slice();
  next[idx] = updated;
  return next;
}
