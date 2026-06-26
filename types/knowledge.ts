// 투자 구루 지식 베이스 (v2) — 원문 → 주장 → 실행규칙 → 매매복기 4컬렉션 구조
// ---------------------------------------------------------------------------
// 설계 원칙 (사용자·다중 AI 토론 수렴):
//   · 자연어 "주장(claim)"과 실행 가능한 "규칙(rule, typed condition)"을 분리한다.
//   · 검증은 단일 enum이 아니라 독립 플래그(VerificationFlags)로 둔다.
//   · 미검증/검증불가 지식은 절대 신호로 자동 활성화되지 않는다 (utils/knowledgeScoring.isActiveSignal 게이트).
//   · 강환국 우선은 "절대권력"이 아니라 "초기 신뢰도"(authorityTier) — 시간이 지나면 performance가 권위를 이긴다.
//   · 감쇠는 유형별(decayClass)로 다르다 — 리스크 원칙은 무감쇠, 종목 코멘트는 며칠~몇 주.
// 점수/감쇠/활성게이트: utils/knowledgeScoring.ts. 시드: constants/knowledgeBase.ts.
// v1(납작한 KnowledgeEntry)은 types/knowledge.legacy.ts + constants/knowledgeBase.legacy.ts에 보존.

export type KnowledgeCategory =
  | 'market-regime'    // 시장 레짐 / 추세 판단 (언제)
  | 'screening'        // 종목 선정 (무엇)
  | 'entry-setup'      // 진입 셋업
  | 'entry-timing'     // 진입 타이밍
  | 'exit-stoploss'    // 손절
  | 'exit-profit'      // 익절
  | 'position-sizing'  // 베팅 규모 (얼마나)
  | 'psychology';      // 심리 / 행동 / 메타

export type GuruId =
  | 'kang-hwanguk' | 'kullamagi' | 'oneil' | 'minervini' | 'weinstein'
  | 'darvas' | 'livermore' | 'frohlich' | 'russo' | 'breitstein' | 'generic';

// 강환국 우선순위 = 초기 신뢰도(점수 가중). utils/knowledgeScoring.AUTHORITY_WEIGHT 와 1:1.
export type AuthorityTier =
  | 'kang-direct-principle'  // 강환국이 직접 말한 원칙        (1.30)
  | 'kang-recommendation'    // 강환국이 추천/해석한 전략       (1.20)
  | 'kang-introduced-guru'   // 강환국 자료 속 타 구루 전략     (1.05)
  | 'external-guru'          // 타 구루 원문/검증된 전략        (1.00)
  | 'ai-inference';          // AI가 추론한 해석               (0.60)

// 유형별 감쇠 클래스. 반감기는 utils/knowledgeScoring.DECAY_HALF_LIFE_WEEKS.
export type DecayClass =
  | 'risk-principle'      // 무감쇠 (1% 룰, 물타기 금지 …)
  | 'evergreen-reference' // 무감쇠 (정의/개념: CANSLIM, 포지션 산식 …)
  | 'strategy-rule'       // 12~24개월 (눌림목·돌파·런치패드 …)
  | 'market-regime'       // 2~8주
  | 'stock-comment'       // 1~4주 (종목별 코멘트)
  | 'event-news';         // 며칠~2주 (뉴스/이벤트)

export type KnowledgeConfidence = 'strong' | 'qualified' | 'optional' | 'author-opinion';

export type Computability = 'signal' | 'advisory';

// 검증은 독립 플래그(직교 차원). 신호 활성 게이트는 이들의 논리식.
export interface VerificationFlags {
  sourceVerified: boolean;    // 원문에 실제 그런 말이 있음
  factVerified: boolean;      // 외부 사실관계 확인됨 (웹 교차검증 등)
  dataVerified: boolean;      // 가격/거래량 데이터로 수치 확인됨
  backtestVerified: boolean;  // 전략 조건의 과거 성과 확인됨
  userApproved: boolean;      // 사용자가 앱 반영을 승인함
  rejected: boolean;          // 폐기
}

export const EMPTY_VERIFICATION: VerificationFlags = {
  sourceVerified: false, factVerified: false, dataVerified: false,
  backtestVerified: false, userApproved: false, rejected: false,
};

// ── 1. 원문 보관함 ─────────────────────────────────────────────────────────
export interface KnowledgeSource {
  id: string;
  title: string;
  author: string;
  sourceDate: string;        // YYYY-MM-DD (자료 작성/강의일) — recency 기준
  ingestedAt: string;        // YYYY-MM-DD (DB 편입일)
  sourceType: 'lecture-transcript' | 'book' | 'article' | 'manual';
  originPath: string;        // 원문 파일 경로
  sha256?: string;           // 원문 해시 (무결성, 덮어쓰기 방지)
  priorityProfile: string;   // 예: 'khg-primary'
  note?: string;
}

// ── 2. 원자 주장 ───────────────────────────────────────────────────────────
export interface KnowledgeClaim {
  id: string;
  sourceId: string;          // KnowledgeSource.id
  sourceSpan?: string;       // 출처 문장(근거)
  sourceDate: string;        // YYYY-MM-DD (source에서 denormalize — recency 계산 편의)
  statement: string;         // 자연어 주장
  category: KnowledgeCategory;
  decayClass: DecayClass;
  authorityTier: AuthorityTier;
  guru: GuruId;
  confidence: KnowledgeConfidence;
  verification: VerificationFlags;
  tags?: string[];
  citations?: string[];      // 팩트체크 웹 출처 / 교정 근거
  note?: string;             // 교정·캐비엇 (OCR 정정, 미검증 사유, 한국 적용 한계 등)
}

// ── 3. 실행 가능한 규칙 (typed condition) ──────────────────────────────────
export type ConditionOperator =
  | '>=' | '<=' | '>' | '<' | '=' | 'between' | 'in' | 'crossesAbove' | 'crossesBelow';

// 규칙이 참조하는 지표. 일부는 앱 미구현 — RequiredMetric note + rule.requiredMetrics로 추적.
// 구현됨(guruSignalEngine.buildMetricValues): rsi14, climaxFlags, distributionCount, volumeRatio50,
//   priceToMa20Pct, priceToMa60Pct, priceToMa150Pct, pctBelow52wHigh, maCompression,
//   assetTrendRegime, priceCrossAboveMa20Days
// 미구현(신규 필요): rsRank(시장 유니버스 백분위), rsRank1m, marketRegime(지수기반),
//   priceToMa10Pct, gapPct, ma65, allTimeHigh, priceVsMa, swingLow
// 주의: rsRank는 시장 유니버스 백분위 — 지수 대비 상대강도(Mansfield RS)와 혼동 금지(다른 데이터 구조).
//       Mansfield RS 구현 시 별도 metric(relativeStrengthVsBenchmark)으로 두고 rsRank로 부르지 말 것.
export type RequiredMetric =
  | 'rsi14' | 'climaxFlags' | 'distributionCount' | 'volumeRatio50' | 'priceVsMa' | 'swingLow'
  | 'rsRank' | 'rsRank1m' | 'marketRegime' | 'priceToMa10Pct' | 'priceToMa20Pct'
  | 'priceToMa60Pct' | 'priceToMa150Pct' | 'pctBelow52wHigh' | 'assetTrendRegime'
  | 'priceCrossAboveMa20Days'
  | 'maCompression' | 'gapPct' | 'ma65' | 'allTimeHigh';

// guruSignalEngine.buildMetricValues 가 실제 산출하는 지표(= 신호로 허용 가능한 지표)의 단일 소스.
// triage_commit.py·knowledgeIngest·guruDiagnostics 가 모두 이걸 참조 (drift 방지). 미구현 지표는 영원히 안 뜸.
export const IMPLEMENTED_METRICS: ReadonlySet<RequiredMetric> = new Set<RequiredMetric>([
  'rsi14', 'climaxFlags', 'distributionCount', 'volumeRatio50',
  'priceToMa20Pct', 'priceToMa60Pct', 'priceToMa150Pct', 'pctBelow52wHigh',
  'maCompression', 'assetTrendRegime', 'priceCrossAboveMa20Days',
]);

export interface ConditionLeaf {
  metric: RequiredMetric;
  operator: ConditionOperator;
  value: number | number[] | string | string[];
  /**
   * 안정적 조건 식별자 (선택). 신호 리플레이 샌드박스의 leaf 단위 오버라이드 타깃팅용.
   * 미지정 시 utils/conditionLeafId 에서 `metric__operator__중복순번`으로 결정론적 derive.
   * 평가 엔진(evaluateCondition/diagnose)은 이 필드를 사용하지 않는다(순수 부가 메타).
   */
  id?: string;
}

export interface ConditionGroup {
  all?: ConditionNode[];
  any?: ConditionNode[];
  not?: ConditionNode;
}

export type ConditionNode = ConditionLeaf | ConditionGroup;

export type RuleStatus = 'draft' | 'active' | 'archived';

export type RuleAction =
  | 'buy-watch'     // 관찰 후보
  | 'buy-setup'     // 진입 검토 후보
  | 'sell-warning'  // 매도/위험 경고
  | 'risk-sizing'   // 포지션/리스크 계산
  | 'regime-filter' // 시장 국면 필터
  | 'review';       // 복기/행동 권고

export interface KnowledgeRule {
  id: string;
  claimIds: string[];          // 근거 KnowledgeClaim.id (1:N)
  title: string;
  ruleType: KnowledgeCategory;
  computability: Computability;
  condition?: ConditionNode;   // signal 규칙의 실행 조건식 (advisory는 생략 가능)
  action: RuleAction;
  mappedSignalKey?: string;    // 기존/신규 시그널 키 (예: 'climax-top', 'MA_PULLBACK_ENTRY')
  status: RuleStatus;
  requiredMetrics: RequiredMetric[];
  riskPolicy?: string;         // 손절/사이징 정책 메모
  verification: VerificationFlags; // 활성 게이트 판정 기준 (규칙 단위)
  note?: string;
}

// ── 규칙 진단 (5A) — 자격(eligibility)/평가(evaluation)/지표 준비도(coverage) 3축 ──
// 세 축은 직교: active여도(eligible) 데이터 부족으로 unknown일 수 있고, draft여도 평가는 가능.
export type MetricAvailability =
  | 'available'    // 구현됨 + 값 존재 + (OHLC 의존 지표면) 완전
  | 'partial'      // 구현됨 + 값 존재하나 OHLC 미수신으로 일부 sub-condition 평가 불가 (climaxFlags/distributionCount)
  | 'missing'      // 구현됨이나 이 종목 데이터 없음
  | 'unsupported'; // 앱 미구현 (rsRank·marketRegime…) → 영구 dormant

export type InactiveReason =
  | 'draft' | 'archived'  // rule.status ≠ 'active'
  | 'advisory'            // computability ≠ 'signal'
  | 'rejected'            // verification.rejected
  | 'unverified'          // userApproved·dataVerified·backtestVerified 모두 없음
  | 'claim-expired'       // 근거 claim decayClass 만료
  | 'no-condition';       // condition 없음 (getActiveSignalRules 층 게이트)

export type RuleEvaluation = 'matched' | 'unmatched' | 'unknown' | 'not-evaluated';

export interface MetricCoverage {
  metric: RequiredMetric;
  availability: MetricAvailability;
  value?: number | string;
}

// 규칙당 준비도 = 조건 leaf 중 최악 availability (unsupported>missing>partial>complete).
// 조건 없는 규칙(no-condition)은 평가할 지표가 없어 준비도 적용 불가 → 'not-applicable'.
export type RuleReadiness = 'complete' | 'partial' | 'missing' | 'unsupported' | 'not-applicable';

// 조건 leaf별 충족 상세 (실제 지표값 vs 기준). conditionDescribe.explainConditionLeaves 산출.
export interface LeafExplain {
  label: string;     // "현재가의 20일선 대비 위치"
  condition: string; // "−3%~+3% 사이"
  actual: string;    // "+1.2%"
  passed: boolean | null;
}

export interface RuleDiagnostic {
  ruleId: string;
  ruleTitle: string;
  action: RuleAction;
  eligibility: { eligible: boolean; reasons: InactiveReason[] };
  evaluation: RuleEvaluation;
  coverage: MetricCoverage[];
  leaves: LeafExplain[];
}

// 진단 요약 — 3축을 collapse하지 않고 각각 독립 카운트(partial이 미충족으로 숨지 않도록).
export interface DiagnosticSummary {
  total: number;
  eligibility: { eligible: number; inactive: number };
  evaluation: { matched: number; unmatched: number; unknown: number; notEvaluated: number };
  readiness: Record<RuleReadiness, number>; // 'not-applicable' 포함(조건 없는 규칙)
}

// 3축(eligibility×evaluation×readiness)을 사용자용 단일 상태로 정밀 번역한 결과 — "왜 안 뜨나" 패널용.
// 핵심 불변식(엔진결과 왜곡 금지): evaluation==='matched'면 엔진이 실제 발화한 것이므로 절대
//   'unsupported'/'not-met'으로 강등하지 않는다(matched 우선). partial/missing은 readiness로만 캐비엇.
export type RuleStatusKind =
  | 'firing'           // 자격O + 충족 + 데이터 완전 → 실제 발화
  | 'firing-partial'   // 자격O + 충족이나 일부 데이터 누락/degrade(OHLC 등) → '일부 데이터 기준 충족'
  | 'not-met'          // 자격O + 미충족 + 데이터 완전 → 순수 조건 불일치
  | 'not-met-partial'  // 자격O + 미충족 + 일부 데이터 누락 → '현재 계산상 미충족·일부 데이터 누락'(≠판정유보)
  | 'data-missing'     // 자격O + 판정불가(unknown) + 데이터 없음 → '데이터 부족으로 판정 불가'
  | 'unsupported'      // 자격O + 조건이 미구현 지표 의존(미발화 상태) → '현재 앱에서 미지원'(영구 dormant)
  | 'no-condition'     // 자격O이나 조건식 없음 → 평가 대상 아님
  | 'inactive';        // 자격X(draft/unverified/rejected/claim-expired) → 신호로 비활성

export type StatusTone = 'positive' | 'neutral' | 'caution' | 'muted';

export interface RuleStatusDescriptor {
  kind: RuleStatusKind;
  label: string;      // 사용자에게 보이는 한 줄 상태
  detail?: string;    // 부연(비활성 사유, 누락/미지원 지표명 등)
  tone: StatusTone;
}

export const RULE_STATUS_LABELS: Record<RuleStatusKind, string> = {
  'firing': '충족 — 신호 발화',
  'firing-partial': '일부 데이터 기준 충족',
  'not-met': '미충족 (조건 불일치)',
  'not-met-partial': '현재 계산상 미충족·일부 데이터 누락',
  'data-missing': '데이터 부족으로 판정 불가',
  'unsupported': '현재 앱에서 미지원',
  'no-condition': '조건식 없음 (평가 대상 아님)',
  'inactive': '비활성 규칙',
};

export const INACTIVE_REASON_LABELS: Record<InactiveReason, string> = {
  'draft': '초안(미승인) 규칙',
  'archived': '보관됨',
  'advisory': '참고용(신호 아님)',
  'rejected': '폐기됨',
  'unverified': '미검증(승인·데이터·백테스트 전)',
  'claim-expired': '근거 지식 만료',
  'no-condition': '조건식 없음',
};

// ── 4. 매매 복기 (성과 피드백) ─────────────────────────────────────────────
export type DecisionType = 'buy' | 'sell' | 'hold' | 'reduce' | 'skip';

export interface KnowledgeJournalEntry {
  id: string;
  ruleIds: string[];           // 판단 근거가 된 규칙
  assetId?: string;
  decidedAt: string;           // YYYY-MM-DD
  decisionType: DecisionType;
  plannedEntry?: number;
  plannedStop?: number;
  positionSize?: number;
  result?: string;             // 결과(손익/전개)
  reviewNote?: string;         // 복기
}

export interface KnowledgeBase {
  version: number;             // 스키마 버전 (현재 2)
  sources: KnowledgeSource[];
  claims: KnowledgeClaim[];
  rules: KnowledgeRule[];
  journal: KnowledgeJournalEntry[];
  lastUpdated: string;         // YYYY-MM-DD
}

// ── 5. 인제스트 승인 큐 (로컬 DB/queue/knowledge-inbox.jsonl → 앱 import → 승인) ──
// triage(scripts/ingest)가 만든 정제 후보. 앱에서 사용자가 승인해야만 knowledgeBase에 반영된다.
export interface IngestQueueEntry {
  queueId: string;             // "<sourceId>::<candidateId>"
  kind: 'claim' | 'rule';
  sourceId: string;            // 원문 대장 id (예: 260620_f4953b99)
  triagedAt: string;           // YYYY-MM-DD
  reason: string;              // 초보용 분류 사유
  dedup: string;               // 'new' | 'refines:<id>'
  confidence: 'high' | 'medium' | 'low';
  candidate: KnowledgeClaim | KnowledgeRule;
}

// promote(rule.status='active' = 신호 활성화) 직전 무결성 검사 결과.
// isActiveSignal 게이트가 rule만 보므로, 승인 단계가 연결 claim 무결성까지 마지막 문지기 역할을 한다.
export interface PromoteCheck {
  ok: boolean;
  blockers: string[];
}

// ── 표시명 ─────────────────────────────────────────────────────────────────
export const KNOWLEDGE_CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  'market-regime': '시장 레짐(언제)',
  'screening': '종목 선정(무엇)',
  'entry-setup': '진입 셋업',
  'entry-timing': '진입 타이밍',
  'exit-stoploss': '손절',
  'exit-profit': '익절',
  'position-sizing': '베팅 규모(얼마나)',
  'psychology': '심리·행동',
};

export const GURU_LABELS: Record<GuruId, string> = {
  'kang-hwanguk': '강환국',
  'kullamagi': '쿨라매기(Kullamägi)',
  'oneil': "오닐(O'Neil)",
  'minervini': '미너비니(Minervini)',
  'weinstein': '와인스타인(Weinstein)',
  'darvas': '다바스(Darvas)',
  'livermore': '리버모어(Livermore)',
  'frohlich': '프롤리히(Frohlich)',
  'russo': '루소(가명)',
  'breitstein': '브라이트스타인(Breitstein)',
  'generic': '다수 트레이더 공통',
};

export const RULE_ACTION_LABELS: Record<RuleAction, string> = {
  'sell-warning': '매도 경고',
  'buy-setup': '진입 검토',
  'buy-watch': '관찰 후보',
  'risk-sizing': '리스크',
  'regime-filter': '시장 국면',
  'review': '복기',
};

export const AUTHORITY_TIER_LABELS: Record<AuthorityTier, string> = {
  'kang-direct-principle': '강환국 직접 원칙',
  'kang-recommendation': '강환국 추천/해석',
  'kang-introduced-guru': '강환국 소개 타구루',
  'external-guru': '타구루 원문',
  'ai-inference': 'AI 추론',
};

export const DECAY_CLASS_LABELS: Record<DecayClass, string> = {
  'risk-principle': '리스크 원칙(무감쇠)',
  'evergreen-reference': '개념/정의(무감쇠)',
  'strategy-rule': '전략 규칙(12~24개월)',
  'market-regime': '시장 국면(2~8주)',
  'stock-comment': '종목 코멘트(1~4주)',
  'event-news': '뉴스/이벤트(며칠~2주)',
};
