// utils/ruleSandbox.ts
// 신호 리플레이 샌드박스(P3) — 구루 규칙 leaf를 "값(value) + on/off"로 비파괴 조정하기 위한 순수 함수.
//
// 설계 원칙:
//   · **operator(방향)·value 형태(단일↔배열)는 절대 바꾸지 않는다** — P3 범위는 값/사용여부뿐(형태 변경은 P4).
//     → single 은 number 유지, between 은 길이 2 number 배열 유지, 그 외(문자열/in/crosses)는 fixed(값편집 불가, on/off만).
//   · **마지막 활성 leaf off 금지 가드**(`wouldKeepActiveLeaf`): UI보다 먼저 확정. applyRuleOverrides 는 모든 leaf가
//     제거되면 방어적으로 원본 condition을 유지([ruleOverrides.ts] return newCond ? ... : rule)하므로,
//     UI가 막지 않으면 "껐는데 원본이 살아있는" 착시가 생긴다. 이 함수로 그 상태 자체에 도달하지 못하게 한다.
//   · 라이브 신호/KnowledgeBase/시드 불변 — 결과는 리플레이 화면 state(sandboxOverrides)에만 적용.
//
// leafId 는 conditionLeafId.flattenLeaves 와 동일 규칙으로 매칭(applyRuleOverrides 와 단일 소스 공유).

import { flattenLeaves } from './conditionLeafId';
import type { KnowledgeRule, ConditionLeaf, ConditionOperator } from '../types/knowledge';
import type { RuleOverride } from '../types/signalReplay';

export type SandboxLeafKind = 'single' | 'between' | 'fixed';

export type LeafValue = number | number[] | string | string[];

export interface SandboxLeaf {
  leafId: string;
  metric: string;
  operator: ConditionOperator;
  kind: SandboxLeafKind;        // single=숫자 1개 / between=[min,max] / fixed=문자열·in·crosses(값편집 불가)
  baseValue: LeafValue;         // 시드 원본 값
  value: LeafValue;             // override 반영 값(형태는 baseValue 와 동일)
  enabled: boolean;             // override.enabled !== false
  overridden: boolean;          // 이 leaf 에 활성 override 가 있는지(value/enabled)
}

const SINGLE_OPERATORS: ReadonlySet<ConditionOperator> = new Set(['>=', '<=', '>', '<', '=']);

/** leaf 의 편집 형태 분류 — operator + value 타입으로 결정(형태 변경 안 함). */
export function classifyLeaf(leaf: ConditionLeaf): SandboxLeafKind {
  if (leaf.operator === 'between'
    && Array.isArray(leaf.value) && leaf.value.length === 2
    && leaf.value.every(v => typeof v === 'number')) {
    return 'between';
  }
  if (typeof leaf.value === 'number' && SINGLE_OPERATORS.has(leaf.operator)) {
    return 'single';
  }
  return 'fixed';
}

/** 규칙의 각 leaf 를 현재 override 머지 상태로 펼침 — 패널이 그대로 렌더. */
export function describeRuleLeaves(rule: KnowledgeRule, overrides: RuleOverride[]): SandboxLeaf[] {
  const ovById = new Map<string, RuleOverride>();
  for (const o of overrides) if (o.ruleId === rule.id) ovById.set(o.leafId, o);
  return flattenLeaves(rule.condition).map(({ leafId, leaf }) => {
    const o = ovById.get(leafId);
    return {
      leafId,
      metric: leaf.metric,
      operator: leaf.operator,
      kind: classifyLeaf(leaf),
      baseValue: leaf.value,
      value: o?.value !== undefined ? o.value : leaf.value,
      enabled: o?.enabled !== false,
      overridden: !!o && (o.value !== undefined || o.enabled !== undefined),
    };
  });
}

/** 비활성(enabled===false) override leafId 집합. */
function disabledLeafIds(rule: KnowledgeRule, overrides: RuleOverride[]): Set<string> {
  const s = new Set<string>();
  for (const o of overrides) if (o.ruleId === rule.id && o.enabled === false) s.add(o.leafId);
  return s;
}

/** 현재 활성 leaf 수(비활성 override 제외). */
export function countActiveLeaves(rule: KnowledgeRule, overrides: RuleOverride[]): number {
  const disabled = disabledLeafIds(rule, overrides);
  return flattenLeaves(rule.condition).filter(l => !disabled.has(l.leafId)).length;
}

/**
 * leaf 의 enabled 를 nextEnabled 로 바꿨을 때 그 규칙에 활성 leaf 가 ≥1개 남는지.
 * UI 는 off(nextEnabled=false) 직전에 이걸 호출해 false 면 그 off 를 막는다(최소 1개 조건 유지).
 */
export function wouldKeepActiveLeaf(
  rule: KnowledgeRule, overrides: RuleOverride[], leafId: string, nextEnabled: boolean,
): boolean {
  const disabled = disabledLeafIds(rule, overrides);
  if (nextEnabled === false) disabled.add(leafId); else disabled.delete(leafId);
  const active = flattenLeaves(rule.condition).filter(l => !disabled.has(l.leafId)).length;
  return active > 0;
}

// ── override 배열 갱신(비파괴, 키 = (ruleId, leafId)) ──
function upsertOverride(
  overrides: RuleOverride[], ruleId: string, leafId: string, patch: Partial<RuleOverride>,
): RuleOverride[] {
  const idx = overrides.findIndex(o => o.ruleId === ruleId && o.leafId === leafId);
  if (idx < 0) return [...overrides, { ruleId, leafId, ...patch }];
  const next = overrides.slice();
  next[idx] = { ...next[idx], ...patch };
  return next;
}

/** 단일 number leaf 값 변경(형태 유지 — number 그대로 저장). */
export function setLeafValue(
  overrides: RuleOverride[], ruleId: string, leafId: string, value: number,
): RuleOverride[] {
  return upsertOverride(overrides, ruleId, leafId, { value });
}

/** between leaf 의 min/max 한쪽 변경 — 항상 길이 2 number 배열로 유지(형태 불변). */
export function setBetweenBound(
  overrides: RuleOverride[], ruleId: string, leaf: SandboxLeaf, which: 'min' | 'max', n: number,
): RuleOverride[] {
  const cur = Array.isArray(leaf.value) ? leaf.value : [];
  const arr: number[] = [
    typeof cur[0] === 'number' ? cur[0] : 0,
    typeof cur[1] === 'number' ? cur[1] : 0,
  ];
  arr[which === 'min' ? 0 : 1] = n;
  return upsertOverride(overrides, ruleId, leaf.leafId, { value: arr });
}

/**
 * leaf on/off. **정규화**: enabled=true 로 되돌릴 때 value override가 없으면 no-op override를
 * 남기지 않고 해당 leaf override를 아예 제거한다(value override가 있으면 value만 보존하고 enabled 플래그 제거).
 * → "효과 없는 override"가 sandboxOverrides 를 부풀리거나(샌드박스 켜진 것처럼 보임) 사례에 박제되는 걸 방지.
 */
export function setLeafEnabled(
  overrides: RuleOverride[], ruleId: string, leafId: string, enabled: boolean,
): RuleOverride[] {
  if (enabled === false) {
    return upsertOverride(overrides, ruleId, leafId, { enabled: false });
  }
  // enabled === true: 비활성 해제.
  const idx = overrides.findIndex(o => o.ruleId === ruleId && o.leafId === leafId);
  if (idx < 0) return overrides; // 이미 활성(override 없음) → no-op (동일 참조)
  const existing = overrides[idx];
  if (existing.value === undefined) {
    return overrides.filter((_, i) => i !== idx); // value도 없음 → 순수 no-op override 제거
  }
  const { enabled: _drop, ...rest } = existing; // value override 유지, enabled 플래그만 제거
  void _drop;
  const next = overrides.slice();
  next[idx] = rest;
  return next;
}

/** between 값이 역전(min > max)인지 — 항상 미충족이 되는 입력. UI 경고/검증용(순수). */
export function isBetweenInverted(value: LeafValue): boolean {
  return Array.isArray(value) && value.length === 2
    && typeof value[0] === 'number' && typeof value[1] === 'number'
    && (value[0] as number) > (value[1] as number);
}

/** 한 leaf 의 override 제거(시드 값으로 복원). */
export function clearLeafOverride(
  overrides: RuleOverride[], ruleId: string, leafId: string,
): RuleOverride[] {
  return overrides.filter(o => !(o.ruleId === ruleId && o.leafId === leafId));
}

/** 한 규칙의 모든 override 제거(규칙 전체 복원). */
export function clearRuleOverrides(overrides: RuleOverride[], ruleId: string): RuleOverride[] {
  return overrides.filter(o => o.ruleId !== ruleId);
}
