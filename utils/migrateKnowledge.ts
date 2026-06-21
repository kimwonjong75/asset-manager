// 지식 베이스 v1 → v2 마이그레이션 (순수 함수, 결정론적)
// ---------------------------------------------------------------------------
// 레거시 KnowledgeEntry(납작한 단일구조) 배열을 v2 claims/rules로 변환한다.
// 손 변환의 불일치를 막기 위해 매핑 규칙을 한 곳(여기)에 모은다.
// - decayClass: 카테고리 기본 + 명시 override(리스크 원칙/개념 정의)
// - authorityTier: guru/confidence로 강환국 4단 사다리 매핑
// - verification: 구 enum → 독립 6플래그 (앱이 실데이터로 계산하는 신호는 dataVerified)
// - computability='signal' + mappedSignalKey 가 있으면 rule도 생성(조건식은 후속 페이즈에서)
// 의존: types/knowledge.legacy(입력 타입), types/knowledge(출력 타입)

import type { KnowledgeEntry } from '../types/knowledge.legacy';
import type {
  KnowledgeClaim, KnowledgeRule, VerificationFlags,
  DecayClass, AuthorityTier, RuleAction,
} from '../types/knowledge';
import { EMPTY_VERIFICATION } from '../types/knowledge';

// 앱이 이미 실데이터로 계산하는 기존 신호 → dataVerified 인정 + 활성 후보
const EXISTING_APP_SIGNALS = new Set(['climax-top', 'distribution-high', 'weinstein-150-break']);

// 카테고리 기본 감쇠를 덮어쓰는 명시 목록
const EVERGREEN_IDS = new Set([
  'position-size-from-stop', 'canslim-framework', 'min-sample-30-40',
  'low-winrate-high-payoff', 'focus-1-2-strategies',
]);
const RISK_PRINCIPLE_IDS = new Set([
  'no-averaging-down', 'stop-on-entry-order', 'plan-exit-before-entry',
  'profit-target-danger',
]);

export function deriveDecayClass(e: KnowledgeEntry): DecayClass {
  if (EVERGREEN_IDS.has(e.id)) return 'evergreen-reference';
  if (RISK_PRINCIPLE_IDS.has(e.id)) return 'risk-principle';
  if (e.category === 'position-sizing' || e.category === 'psychology') return 'risk-principle';
  // market-regime/screening/entry/exit 의 durable 규칙(시점성 콜은 시드에서 이미 제외됨)
  return 'strategy-rule';
}

export function deriveAuthorityTier(e: KnowledgeEntry): AuthorityTier {
  if (e.guru === 'kang-hwanguk') {
    return e.confidence === 'author-opinion' ? 'kang-recommendation' : 'kang-direct-principle';
  }
  if (e.guru === 'generic') return 'external-guru';
  return 'kang-introduced-guru'; // 강환국 자료 속 타 구루
}

export function deriveVerification(e: KnowledgeEntry): VerificationFlags {
  const v: VerificationFlags = { ...EMPTY_VERIFICATION };
  switch (e.verification) {
    case 'verified':
      v.sourceVerified = true;
      v.factVerified = true;
      if (e.mappedSignalKey && EXISTING_APP_SIGNALS.has(e.mappedSignalKey)) v.dataVerified = true;
      break;
    case 'unverifiable-claim':
      v.sourceVerified = true; // 원문엔 있으나 사실/데이터 검증 안 됨 → 신호 게이트 차단
      break;
    case 'rejected':
      v.rejected = true;
      break;
    case 'draft':
    default:
      break;
  }
  if (e.citations && e.citations.length > 0) v.factVerified = true;
  return v;
}

function deriveAction(category: KnowledgeEntry['category']): RuleAction {
  switch (category) {
    case 'exit-stoploss':
    case 'exit-profit': return 'sell-warning';
    case 'entry-setup':
    case 'entry-timing': return 'buy-setup';
    case 'screening': return 'buy-watch';
    case 'market-regime': return 'regime-filter';
    case 'position-sizing': return 'risk-sizing';
    case 'psychology': return 'review';
    default: return 'buy-watch';
  }
}

export interface MigrationResult {
  claims: KnowledgeClaim[];
  rules: KnowledgeRule[];
}

export function migrateLegacyEntries(entries: KnowledgeEntry[]): MigrationResult {
  const claims: KnowledgeClaim[] = [];
  const rules: KnowledgeRule[] = [];

  for (const e of entries) {
    const verification = deriveVerification(e);
    claims.push({
      id: e.id,
      sourceId: e.sourceDoc,
      sourceDate: e.sourceDate,
      statement: e.statement,
      category: e.category,
      decayClass: deriveDecayClass(e),
      authorityTier: deriveAuthorityTier(e),
      guru: e.guru,
      confidence: e.confidence,
      verification,
      tags: e.tags,
      citations: e.citations,
      // 레거시 parameters(자연어 수치)는 note에 보존 — 실행 조건식은 후속 페이즈에서 구조화
      note: e.parameters
        ? `파라미터: ${e.parameters}${e.note ? ` | ${e.note}` : ''}`
        : e.note,
    });

    if (e.computability === 'signal' && e.mappedSignalKey) {
      const isExisting = EXISTING_APP_SIGNALS.has(e.mappedSignalKey);
      rules.push({
        id: `rule-${e.id}`,
        claimIds: [e.id],
        title: e.title,
        ruleType: e.category,
        computability: 'signal',
        action: deriveAction(e.category),
        mappedSignalKey: e.mappedSignalKey,
        status: isExisting && verification.dataVerified ? 'active' : 'draft',
        requiredMetrics: [],
        verification,
        note: isExisting
          ? '앱 기존 신호와 연결(실데이터 계산).'
          : '마이그레이션 자동생성 — typed condition·지표 구현 + 검증/승인 후 active.',
      });
    }
  }

  return { claims, rules };
}
