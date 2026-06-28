// tests/knowledgeBaseIntegrity.ts
// ---------------------------------------------------------------------------
// 지식 베이스 참조 무결성 골든 테스트 (audit 합의 가드).
//   런타임 게이트(knowledgeScoring.isActiveSignal)는 status·검증 플래그만 보고 아래를 검사하지
//   않으며, canPromoteRule(미구현 지표 차단)은 rule에만·승인 경로에만 작동한다. 따라서 손으로
//   들어오는 seed/curated(claim/rule)가 빠지거나 어긋나도 조용히 깨질 수 있다 → 빌드/테스트로 고정.
//     ① 모든 claim.sourceId 가 KNOWLEDGE_SOURCES.id 에 존재          (고아 provenance 방지)
//     ② 모든 rule.claimIds[*] 가 claims.id 에 존재                   (깨진 relink/근거 방지)
//     ③ status='active' && computability='signal' 규칙의 requiredMetrics ⊆ IMPLEMENTED_METRICS
//        (영원히 안 뜨는 active 신호 방지 — triage/promote는 막지만 seed는 안 막음)
//   (후속) dedup의 refines:/corrects:/duplicate-of: 대상 id 검사는 큐/인박스 레이어로 확장 가능.
// 수동 실행: npm run test:kb (tsx). 통과 시 exit 0, 실패 시 exit 1.

import { SEED_KNOWLEDGE_BASE } from '../constants/knowledgeBase';
import { IMPLEMENTED_METRICS } from '../types/knowledge';

let pass = 0;
const fails: string[] = [];
function check(cond: boolean, msg: string): void {
  if (cond) pass++;
  else fails.push(`✗ ${msg}`);
}

const { claims, rules, sources } = SEED_KNOWLEDGE_BASE;
const sourceIds = new Set(sources.map(s => s.id));
const claimIds = new Set(claims.map(c => c.id));

// ① claim.sourceId ∈ KNOWLEDGE_SOURCES
for (const c of claims) {
  check(sourceIds.has(c.sourceId), `claim '${c.id}' 의 sourceId '${c.sourceId}' 가 KNOWLEDGE_SOURCES 에 없음 (고아 provenance)`);
}

// ② rule.claimIds[*] ∈ claims
for (const r of rules) {
  for (const cid of r.claimIds) {
    check(claimIds.has(cid), `rule '${r.id}' 의 claimId '${cid}' 가 claims 에 없음 (깨진 relink/근거)`);
  }
}

// ③ active signal rule 의 requiredMetrics ⊆ IMPLEMENTED_METRICS
for (const r of rules) {
  if (r.status === 'active' && r.computability === 'signal') {
    for (const m of r.requiredMetrics ?? []) {
      check(IMPLEMENTED_METRICS.has(m), `active signal rule '${r.id}' 가 미구현 지표 '${m}' 사용 → 영원히 안 뜸 (advisory로 두거나 지표 구현 후 active)`);
    }
  }
}

console.log(`knowledgeBaseIntegrity: ${pass} passed, ${fails.length} failed (claims ${claims.length} / rules ${rules.length} / sources ${sources.length})`);
if (fails.length) {
  fails.forEach(f => console.error(f));
  process.exit(1);
}
