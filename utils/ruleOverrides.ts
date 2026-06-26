// utils/ruleOverrides.ts
// 구루 규칙에 leaf 단위 오버라이드를 비파괴 적용 — 순수 함수.
//
// · 원본 rule.condition 은 절대 변형하지 않는다(시드 불변). 새 트리를 만들어 반환.
// · override 키 = (ruleId, leafId). leafId 는 conditionLeafId.deriveLeafId 와 동일 규칙으로 매칭.
// · value/operator 패치, enabled===false 면 해당 leaf 를 트리에서 제거(빈 그룹은 그룹째 제거).
// · 1차(P1~P3)에서 이 함수의 결과는 "리플레이 화면 내부" 평가에만 쓰인다 — 라이브 신호 불변.

import type { KnowledgeRule, ConditionNode, ConditionGroup } from '../types/knowledge';
import type { RuleOverride } from '../types/signalReplay';
import { isConditionLeaf, deriveLeafId } from './conditionLeafId';

/** 한 규칙의 condition을 오버라이드 맵으로 재구성. 모두 제거되면 null. */
function rebuild(
  node: ConditionNode,
  overrides: Map<string, RuleOverride>,
  occ: Map<string, number>,
): ConditionNode | null {
  if (isConditionLeaf(node)) {
    const leafId = deriveLeafId(node, occ);
    const o = overrides.get(leafId);
    if (!o) return node;
    if (o.enabled === false) return null; // 조건 제외
    const next = { ...node };
    if (o.value !== undefined) next.value = o.value;
    if (o.operator !== undefined) next.operator = o.operator;
    return next;
  }
  const group: ConditionGroup = {};
  if (node.all) {
    const kids = node.all.map(c => rebuild(c, overrides, occ)).filter((c): c is ConditionNode => c !== null);
    if (kids.length) group.all = kids;
  }
  if (node.any) {
    const kids = node.any.map(c => rebuild(c, overrides, occ)).filter((c): c is ConditionNode => c !== null);
    if (kids.length) group.any = kids;
  }
  if (node.not) {
    const k = rebuild(node.not, overrides, occ);
    if (k) group.not = k;
  }
  if (!group.all && !group.any && !group.not) return null; // 모든 하위 leaf 제거됨
  return group;
}

/** 규칙 배열에 오버라이드 적용(비파괴). 오버라이드 없으면 원본 그대로 반환. */
export function applyRuleOverrides(rules: KnowledgeRule[], overrides: RuleOverride[]): KnowledgeRule[] {
  if (overrides.length === 0) return rules;
  const byRule = new Map<string, Map<string, RuleOverride>>();
  for (const o of overrides) {
    let m = byRule.get(o.ruleId);
    if (!m) { m = new Map(); byRule.set(o.ruleId, m); }
    m.set(o.leafId, o);
  }
  return rules.map(rule => {
    const ov = byRule.get(rule.id);
    if (!ov || rule.condition === undefined) return rule;
    const occ = new Map<string, number>();
    const newCond = rebuild(rule.condition, ov, occ);
    // 전부 제거됐으면 원본 유지(빈 조건은 의미 없음 — 방어).
    return newCond ? { ...rule, condition: newCond } : rule;
  });
}

/** 영구 오버라이드(perm) 위에 샌드박스(sandbox)를 덮어쓴다. 키 = (ruleId, leafId). */
export function mergeOverrides(perm: RuleOverride[], sandbox: RuleOverride[]): RuleOverride[] {
  const map = new Map<string, RuleOverride>();
  for (const o of perm) map.set(`${o.ruleId}::${o.leafId}`, o);
  for (const o of sandbox) map.set(`${o.ruleId}::${o.leafId}`, o);
  return [...map.values()];
}

/** 신호 규칙들의 유효 조건을 결정론적 해시(검증 사례 동일성 비교용). djb2. */
export function hashRuleset(rules: KnowledgeRule[]): string {
  const sig = rules
    .filter(r => r.computability === 'signal' && r.condition)
    .map(r => `${r.id}:${JSON.stringify(r.condition)}`)
    .sort()
    .join('|');
  let h = 5381;
  for (let i = 0; i < sig.length; i++) h = ((h << 5) + h + sig.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
