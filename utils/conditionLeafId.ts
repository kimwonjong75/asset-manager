// utils/conditionLeafId.ts
// 조건 트리의 leaf에 안정적 식별자(leafId)를 부여 — 순수 함수.
//
// 안정성 설계(조건 #2):
//   · 단순 배열 index 금지 — 조건 순서가 바뀌면 깨진다.
//   · leafId = 명시 id(seed가 부여한 경우) 우선, 없으면 `${metric}__${operator}__${중복순번}`.
//     → 임계값(value)을 튜닝해도, 조건 순서를 바꿔도 안정. (같은 metric+operator가 한 규칙에 여러 번일 때만
//       중복순번이 의미를 갖고, 그 둘의 순서를 맞바꾸면 순번이 swap됨 — 현재 활성 규칙엔 그런 중복 없음.)
//   · mergeKnowledgeBase 가 규칙 condition을 항상 seed에서 가져오므로(저장본은 status/verification만 보존),
//     leafId는 저장 데이터에 보존조차 되지 않아 드리프트가 구조적으로 불가능 → 마이그레이션 불필요.
//
// flattenLeaves 와 (utils/ruleOverrides의) rebuild 는 동일한 DFS 순서(all→any→not)와 동일 occ 카운팅을
// 공유해야 leafId가 일치한다 — 그래서 deriveLeafId 를 단일 소스로 export 한다.

import type { ConditionLeaf, ConditionNode } from '../types/knowledge';

export function isConditionLeaf(node: ConditionNode): node is ConditionLeaf {
  return 'metric' in node;
}

/**
 * leaf의 안정적 id를 산출(부수효과: occ 맵에 중복순번 기록).
 * 동일 occ 맵을 공유하며 동일 순서로 호출해야 호출자 간 id가 일치한다.
 */
export function deriveLeafId(leaf: ConditionLeaf, occ: Map<string, number>): string {
  if (leaf.id) return leaf.id;
  const base = `${leaf.metric}__${leaf.operator}`;
  const k = occ.get(base) ?? 0;
  occ.set(base, k + 1);
  return `${base}__${k}`;
}

export interface IdentifiedLeaf {
  leafId: string;
  leaf: ConditionLeaf;
}

/** 조건 트리를 DFS(all→any→not) 순서로 평탄화하며 각 leaf에 안정적 leafId를 부여. */
export function flattenLeaves(node: ConditionNode | undefined): IdentifiedLeaf[] {
  const out: IdentifiedLeaf[] = [];
  if (!node) return out;
  const occ = new Map<string, number>();
  const walk = (n: ConditionNode): void => {
    if (isConditionLeaf(n)) {
      out.push({ leafId: deriveLeafId(n, occ), leaf: n });
      return;
    }
    n.all?.forEach(walk);
    n.any?.forEach(walk);
    if (n.not) walk(n.not);
  };
  walk(node);
  return out;
}
