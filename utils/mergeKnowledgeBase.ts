// 지식 베이스 병합 (앱 시드 ⊕ Drive 저장본) — 순수·결정론
// ---------------------------------------------------------------------------
// 배경: SEED_KNOWLEDGE_BASE(constants/knowledgeBase)는 릴리스마다 진화한다(큐레이션 규칙 추가,
//       레거시 마이그레이션 보강). 반면 Drive에 저장된 사용자본에는 사용자 고유 데이터가 있다
//       (규칙 승인/반려 플래그, 활성/보관 상태 변경, 매매 복기 journal, 주간 추가 전사본 등).
// 병합 원칙:
//   · 정의(definition)는 앱 시드 우선 — 규칙 조건/문구/지표 매핑 등 릴리스 업데이트가 반영돼야 한다.
//   · 사용자 소유 필드는 저장본 우선 — verification(승인/반려), rule.status는 사용자 결정을 보존.
//   · journal은 순수 사용자 데이터 → 저장본 사용.
//   · 시드에 없고 저장본에만 있는 항목(사용자 신규 추가)은 그대로 유지.
// side effect 없음, any 없음. 의존: types/knowledge.

import type {
  KnowledgeBase,
  KnowledgeClaim,
  KnowledgeRule,
  KnowledgeSource,
} from '../types/knowledge';

interface HasId {
  id: string;
}

/**
 * id 기준 union. 시드 순서를 유지하고, 겹치는 id는 mergeOverlap으로 필드 병합,
 * 저장본에만 있는 항목은 끝에 덧붙인다.
 */
function unionById<T extends HasId>(
  seedArr: T[],
  savedArr: T[],
  mergeOverlap: (seed: T, saved: T) => T,
): T[] {
  const savedMap = new Map<string, T>();
  for (const item of savedArr) savedMap.set(item.id, item);
  const seedIds = new Set(seedArr.map(i => i.id));

  const result: T[] = seedArr.map(s => {
    const saved = savedMap.get(s.id);
    return saved ? mergeOverlap(s, saved) : s;
  });
  for (const sv of savedArr) {
    if (!seedIds.has(sv.id)) result.push(sv);
  }
  return result;
}

// 규칙: 정의는 시드, 사용자 결정(status·verification)은 저장본 보존.
const mergeRule = (seed: KnowledgeRule, saved: KnowledgeRule): KnowledgeRule => ({
  ...seed,
  status: saved.status,
  verification: saved.verification,
});

// 주장: 정의는 시드, 검증 플래그는 저장본 보존.
const mergeClaim = (seed: KnowledgeClaim, saved: KnowledgeClaim): KnowledgeClaim => ({
  ...seed,
  verification: saved.verification,
});

// 원문 메타: 앱/인제스트 소유 → 시드 우선(저장본 전용 소스는 union으로 별도 보존).
const mergeSource = (seed: KnowledgeSource): KnowledgeSource => seed;

export function mergeKnowledgeBase(
  seed: KnowledgeBase,
  saved: KnowledgeBase | undefined | null,
): KnowledgeBase {
  // 저장본이 없거나 스키마 버전이 다르면 안전하게 시드 그대로 사용.
  if (!saved || saved.version !== seed.version) return seed;
  if (!Array.isArray(saved.claims) || !Array.isArray(saved.rules)) return seed;

  return {
    version: seed.version,
    sources: unionById(
      seed.sources,
      Array.isArray(saved.sources) ? saved.sources : [],
      mergeSource,
    ),
    claims: unionById(seed.claims, saved.claims, mergeClaim),
    rules: unionById(seed.rules, saved.rules, mergeRule),
    journal: Array.isArray(saved.journal) ? saved.journal : seed.journal,
    lastUpdated:
      saved.lastUpdated && saved.lastUpdated > seed.lastUpdated
        ? saved.lastUpdated
        : seed.lastUpdated,
  };
}
