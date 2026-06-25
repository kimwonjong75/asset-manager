// 지식 인제스트 — 큐 파싱 + promote 무결성 검사 + 승인 반영 (순수 함수)
// ---------------------------------------------------------------------------
// 로컬 DB/queue/knowledge-inbox.jsonl 을 앱이 import → 사용자가 승인 → knowledgeBase 반영.
// 핵심 안전장치: canPromoteRule — rule.status='active'(신호 활성화) 직전, isActiveSignal이
//   보지 않는 "연결 claim 무결성"까지 검사하는 마지막 문지기. (knowledgeScoring.isActiveSignal 보완)
// side effect 금지(utils 규칙). 상태 변경/저장은 hooks/useKnowledgeInbox 에서.

import type {
  KnowledgeBase, KnowledgeClaim, KnowledgeRule, RequiredMetric,
  IngestQueueEntry, PromoteCheck,
} from '../types/knowledge';
import { IMPLEMENTED_METRICS } from '../types/knowledge';
import { createLogger } from './logger';

const logger = createLogger('knowledgeIngest');

// IMPLEMENTED_METRICS 는 types/knowledge 로 이전(단일 소스) — knowledgeIngest·guruDiagnostics·triage_commit.py 공용.

/** JSONL 텍스트 → 큐 항목 배열. 형식 불일치 줄은 스킵(부분 성공 허용). */
export function parseIngestQueue(jsonlText: string): IngestQueueEntry[] {
  const out: IngestQueueEntry[] = [];
  for (const line of jsonlText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Partial<IngestQueueEntry>;
      const validKind = obj.kind === 'claim' || obj.kind === 'rule';
      if (validKind && obj.candidate && typeof obj.candidate.id === 'string' && obj.queueId) {
        out.push(obj as IngestQueueEntry);
      } else {
        logger.warn('큐 항목 형식 불일치 — 스킵');
      }
    } catch {
      logger.warn('큐 JSON 파싱 실패 — 스킵');
    }
  }
  return out;
}

/**
 * 규칙을 신호(active)로 활성화할 자격이 있는가 — promote 직전 무결성 검사.
 * isActiveSignal 은 rule만 게이트하므로(연결 claim의 승인/거부 미확인), 여기서 마지막으로 막는다.
 */
export function canPromoteRule(
  rule: KnowledgeRule,
  kb: KnowledgeBase,
  implemented: ReadonlySet<RequiredMetric> = IMPLEMENTED_METRICS,
): PromoteCheck {
  const blockers: string[] = [];
  const claimById = new Map(kb.claims.map(c => [c.id, c]));

  // 1) 연결 claim 실재
  if (!rule.claimIds || rule.claimIds.length === 0) {
    blockers.push('근거 claim이 없습니다');
  }
  const missing = (rule.claimIds ?? []).filter(id => !claimById.has(id));
  if (missing.length) blockers.push(`존재하지 않는 근거 claim: ${missing.join(', ')}`);

  // 2) 연결 claim 거부 안 됨 + 3) sourceId 보유
  for (const id of rule.claimIds ?? []) {
    const c = claimById.get(id);
    if (!c) continue;
    if (c.verification.rejected) blockers.push(`근거 claim '${id}'가 거부됨(rejected)`);
    if (!c.sourceId) blockers.push(`근거 claim '${id}'에 출처(sourceId) 없음`);
  }

  // 4) 규칙 검증 게이트 (verificationAllowsSignal 과 동일 기준)
  const v = rule.verification;
  if (v.rejected) blockers.push('규칙이 거부됨(rejected)');
  if (!(v.userApproved || v.dataVerified || v.backtestVerified)) {
    blockers.push('검증 근거 없음 (userApproved / dataVerified / backtestVerified 중 하나 필요)');
  }

  // 5) signal 규칙은 구현된 지표만 (미구현이면 발화 불가)
  if (rule.computability === 'signal') {
    const unimpl = (rule.requiredMetrics ?? []).filter(m => !implemented.has(m));
    if (unimpl.length) {
      blockers.push(`미구현 지표 사용: ${unimpl.join(', ')} → advisory로 두거나 지표 구현 후 활성화`);
    }
  }

  return { ok: blockers.length === 0, blockers };
}

function upsertById<T extends { id: string }>(arr: readonly T[], item: T): T[] {
  const idx = arr.findIndex(x => x.id === item.id);
  if (idx === -1) return [...arr, item];
  const copy = arr.slice();
  copy[idx] = item;
  return copy;
}

export interface ApprovalOptions {
  /** rule을 신호(active)로 활성화할지. 기본 false = draft 유지(관찰만). canPromoteRule 통과 시에만 적용. */
  activateRuleAsSignal?: boolean;
}

export interface ApprovalResult {
  kb: KnowledgeBase;
  promote?: PromoteCheck; // rule일 때만
}

/**
 * 승인된 큐 항목을 knowledgeBase에 반영(순수). 같은 id면 교체(upsert).
 * claim: userApproved=true, pending-ingest 태그 제거.
 * rule:  userApproved=true, activate&&canPromote면 status='active' 아니면 'draft'.
 */
export function applyApproval(
  kb: KnowledgeBase,
  entry: IngestQueueEntry,
  opts: ApprovalOptions,
  today: string,
): ApprovalResult {
  if (entry.kind === 'claim') {
    const c = entry.candidate as KnowledgeClaim;
    const approved: KnowledgeClaim = {
      ...c,
      verification: { ...c.verification, userApproved: true },
      tags: (c.tags ?? []).filter(t => t !== 'pending-ingest'),
    };
    return { kb: { ...kb, claims: upsertById(kb.claims, approved), lastUpdated: today } };
  }

  const r = entry.candidate as KnowledgeRule;
  const promote = canPromoteRule(r, kb);
  const activate = !!opts.activateRuleAsSignal && promote.ok;
  const approved: KnowledgeRule = {
    ...r,
    status: activate ? 'active' : 'draft',
    verification: { ...r.verification, userApproved: true },
  };
  return { kb: { ...kb, rules: upsertById(kb.rules, approved), lastUpdated: today }, promote };
}
