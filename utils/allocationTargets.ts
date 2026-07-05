// utils/allocationTargets.ts
// ---------------------------------------------------------------------------
// AllocationTargets 저장 병합 (Phase 4b-1, 순수).
//
// 결함 방지(재검토 발견): useRebalancing.handleSave가 목표비중만 저장하면서
//   객체를 통째로 새로 만들면 `categoryInstruments`(대표 종목 매핑)가 유실된다.
// → 항상 기존값(prev)을 spread해 부분 갱신하고, categoryInstruments는
//   **미관리(undefined)면 prev 폴백, 전량 삭제({})면 그대로 반영**한다.

import { AllocationTargets, RebalanceInstrument } from '../types';

export interface AllocationEdit {
  weights: Record<string, number>;
  targetTotalAmount: number;
  bucketWeights: Record<string, number>;
  categoryInstruments?: Record<string, RebalanceInstrument>;
}

/**
 * 편집 state → 저장 객체 (prev 보존). weights/targetTotalAmount/bucketWeights는 편집값으로 교체,
 * categoryInstruments는 편집값이 있으면 그대로(삭제 반영), undefined면 prev 유지.
 * prev의 알 수 없는(미래) 필드는 spread로 보존한다.
 */
export function buildAllocationTargetsSave(prev: AllocationTargets, edit: AllocationEdit): AllocationTargets {
  return {
    ...prev,
    weights: edit.weights,
    targetTotalAmount: edit.targetTotalAmount,
    bucketWeights: edit.bucketWeights,
    categoryInstruments: edit.categoryInstruments ?? prev.categoryInstruments,
  };
}

// ── 미저장 변경 판정 (Phase 4b-3a) ──────────────────────────────────────
// 리밸런싱 주문 생성은 "저장본" 기준이므로, 편집 state ≠ 저장본이면 "저장 후 생성"으로 막아야 한다.
// JSON.stringify 단순 비교는 키 순서/숫자키/undefined/{} 차이로 오탐이 나므로 canonicalize 후 비교한다.

/** 키를 재귀 정렬해 안정적 문자열화 (오브젝트 키 순서 무관 비교). */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

/**
 * 편집 state가 저장본과 다른지 (미저장 변경 여부).
 * 정규화: bucketWeights/weights/categoryInstruments의 undefined는 {}로, targetTotalAmount undefined는 0으로.
 *   · categoryInstruments **undefined≡{}**("미관리/매핑 없음"은 동일) — 4b-1 의미 보존.
 *   · 단 저장본 {'1':inst} vs 편집 {}(전량 삭제)는 **다름**(dirty) — 삭제도 미저장 변경.
 */
export function isAllocationDirty(edit: AllocationEdit, saved: AllocationTargets): boolean {
  const norm = (a: Partial<AllocationEdit>): string => stableStringify({
    weights: a.weights ?? {},
    bucketWeights: a.bucketWeights ?? {},
    targetTotalAmount: a.targetTotalAmount ?? 0,
    categoryInstruments: a.categoryInstruments ?? {},
  });
  return norm(edit) !== norm(saved);
}
