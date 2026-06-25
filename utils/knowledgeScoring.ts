// 지식 우선순위 점수 + 신호 활성 게이트 (순수 함수)
// ---------------------------------------------------------------------------
// score = authority(강환국 초기신뢰도) × confidence × recency(유형별 감쇠) × performance(표본 충분시)
// 활성 게이트(isActiveSignal): 미검증/검증불가 지식은 절대 자동으로 신호가 되지 않는다.
//   active = rule.status='active' AND computability='signal' AND !rejected
//            AND (userApproved OR dataVerified OR backtestVerified)
//            AND 근거 claim이 decayClass 기준 만료되지 않음
// side effect 금지(utils 규칙) → 현재 시각은 호출부에서 `now: Date` 로 주입.
// 의존: types/knowledge

import type {
  KnowledgeClaim,
  KnowledgeRule,
  KnowledgeJournalEntry,
  KnowledgeConfidence,
  AuthorityTier,
  DecayClass,
  InactiveReason,
} from '../types/knowledge';

// ── 가중 테이블 ─────────────────────────────────────────────────────────────
export const AUTHORITY_WEIGHT: Record<AuthorityTier, number> = {
  'kang-direct-principle': 1.30,
  'kang-recommendation': 1.20,
  'kang-introduced-guru': 1.05,
  'external-guru': 1.00,
  'ai-inference': 0.60,
};

const CONFIDENCE_WEIGHT: Record<KnowledgeConfidence, number> = {
  'strong': 1.0,
  'qualified': 0.7,
  'optional': 0.4,
  'author-opinion': 0.5,
};

// 유형별 반감기(주). null = 무감쇠. 빠른 감쇠 유형은 만료(near-0)되도록 순수 지수감쇠 사용.
export const DECAY_HALF_LIFE_WEEKS: Record<DecayClass, number | null> = {
  'risk-principle': null,        // 무감쇠
  'evergreen-reference': null,   // 무감쇠
  'strategy-rule': 78,           // ~18개월
  'market-regime': 5,            // 2~8주 중간
  'stock-comment': 2.5,          // 1~4주 중간
  'event-news': 1.5,             // 며칠~2주
};

// recency가 이 값 미만이면 만료로 간주(신호 게이트에서 차단). 무감쇠 유형은 만료 없음.
export const EXPIRY_THRESHOLD = 0.05;
// 성과가 권위를 이기기 시작하는 최소 복기 표본(강환국 "유의미 표본 30~40회" 원칙).
export const MIN_PERFORMANCE_SAMPLE = 30;

const MS_PER_WEEK = 1000 * 60 * 60 * 24 * 7;

function ageWeeks(sourceDate: string, now: Date): number {
  const src = new Date(sourceDate).getTime();
  if (Number.isNaN(src)) return 0;
  return Math.max(0, (now.getTime() - src) / MS_PER_WEEK);
}

/** 유형별 최신성 계수. 무감쇠 유형은 1.0, 그 외는 exp(-age/halflife)로 0을 향해 감쇠. */
export function recencyFactor(decayClass: DecayClass, sourceDate: string, now: Date): number {
  const halfLife = DECAY_HALF_LIFE_WEEKS[decayClass];
  if (halfLife === null) return 1.0;
  return Math.exp(-ageWeeks(sourceDate, now) / halfLife);
}

/** 만료 여부(빠른 감쇠 지식의 신호 차단용). 무감쇠 유형은 만료되지 않음. */
export function isExpired(decayClass: DecayClass, sourceDate: string, now: Date): boolean {
  if (DECAY_HALF_LIFE_WEEKS[decayClass] === null) return false;
  return recencyFactor(decayClass, sourceDate, now) < EXPIRY_THRESHOLD;
}

/**
 * 성과 배수: 복기 표본이 MIN_PERFORMANCE_SAMPLE 미만이면 1.0(중립) — 소표본 노이즈로 권위를 왜곡하지 않음.
 * 표본이 충분하면 승률·손익비로 0.5~1.5 범위 조정(실현 성과가 초기 권위를 이기도록).
 */
export function performanceMultiplier(
  rule: KnowledgeRule,
  journal: KnowledgeJournalEntry[],
): number {
  const linked = journal.filter(j => j.ruleIds.includes(rule.id));
  if (linked.length < MIN_PERFORMANCE_SAMPLE) return 1.0;
  // TODO: journal.result를 구조화(손익/승패)한 뒤 실제 승률·손익비로 산출.
  // 현재는 표본만 충족하면 중립 유지(결과 파싱 로직은 journal 페이즈에서 구현).
  return 1.0;
}

/** 주장(claim) 단위 우선순위 점수. 표시·랭킹·충돌해소용. */
export function claimPriorityScore(claim: KnowledgeClaim, now: Date): number {
  if (claim.verification.rejected) return 0;
  return (
    AUTHORITY_WEIGHT[claim.authorityTier] *
    CONFIDENCE_WEIGHT[claim.confidence] *
    recencyFactor(claim.decayClass, claim.sourceDate, now)
  );
}

/** 규칙(rule) 단위 점수. 근거 claim 중 최고 점수 × 성과 배수. */
export function rulePriorityScore(
  rule: KnowledgeRule,
  claims: KnowledgeClaim[],
  journal: KnowledgeJournalEntry[],
  now: Date,
): number {
  const linked = claims.filter(c => rule.claimIds.includes(c.id));
  const base = linked.reduce((max, c) => Math.max(max, claimPriorityScore(c, now)), 0);
  return base * performanceMultiplier(rule, journal);
}

/** 검증 플래그가 신호 활성 조건을 만족하는가 (미검증 자동활성 차단의 핵심). */
export function verificationAllowsSignal(v: KnowledgeRule['verification']): boolean {
  if (v.rejected) return false;
  return v.userApproved || v.dataVerified || v.backtestVerified;
}

/**
 * 규칙의 신호 활성 자격 + 비활성 사유(reason code)를 함께 산출 — 진단/게이트 단일 소스.
 * isActiveSignal 은 이 결과의 eligible 만 본다(사유 분류 로직 복제 금지 → drift 방지).
 * 주의: 'no-condition' 은 규칙 단위가 아니라 getActiveSignalRules 층 게이트 → 진단에서 별도 부여.
 * 근거 claim들을 함께 넘겨 만료(decayClass) 여부까지 확인한다.
 */
export function getSignalEligibility(
  rule: KnowledgeRule,
  linkedClaims: KnowledgeClaim[],
  now: Date,
): { eligible: boolean; reasons: InactiveReason[] } {
  const reasons: InactiveReason[] = [];
  if (rule.status === 'draft') reasons.push('draft');
  else if (rule.status === 'archived') reasons.push('archived');
  if (rule.computability !== 'signal') reasons.push('advisory');
  if (rule.verification.rejected) reasons.push('rejected');
  else if (!(rule.verification.userApproved || rule.verification.dataVerified || rule.verification.backtestVerified)) {
    reasons.push('unverified');
  }
  const claims = linkedClaims.filter(c => rule.claimIds.includes(c.id));
  if (claims.some(c => isExpired(c.decayClass, c.sourceDate, now))) reasons.push('claim-expired');
  return { eligible: reasons.length === 0, reasons };
}

/** 규칙이 실제 앱 신호로 활성화될 자격이 있는가 (= getSignalEligibility().eligible). */
export function isActiveSignal(
  rule: KnowledgeRule,
  linkedClaims: KnowledgeClaim[],
  now: Date,
): boolean {
  return getSignalEligibility(rule, linkedClaims, now).eligible;
}

/** 같은 mappedSignalKey 규칙 중 최우선 1개만 남겨 충돌 해소(점수→최신 source 순). */
export function resolveRuleConflicts(
  rules: KnowledgeRule[],
  claims: KnowledgeClaim[],
  journal: KnowledgeJournalEntry[],
  now: Date,
): KnowledgeRule[] {
  const byKey = new Map<string, KnowledgeRule[]>();
  const standalone: KnowledgeRule[] = [];
  for (const r of rules) {
    if (r.mappedSignalKey) {
      const arr = byKey.get(r.mappedSignalKey);
      if (arr) arr.push(r);
      else byKey.set(r.mappedSignalKey, [r]);
    } else {
      standalone.push(r);
    }
  }
  const winners: KnowledgeRule[] = [...standalone];
  for (const arr of byKey.values()) {
    arr.sort((a, b) => rulePriorityScore(b, claims, journal, now) - rulePriorityScore(a, claims, journal, now));
    winners.push(arr[0]);
  }
  return winners;
}
