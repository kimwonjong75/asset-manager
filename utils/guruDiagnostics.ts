// utils/guruDiagnostics.ts
// 구루 규칙 진단 (5A) — "왜 안 떴나"를 3축으로 분해 (순수 함수, side effect/any 없음).
// ---------------------------------------------------------------------------
// 세 축은 직교한다 (단일 status로 합치면 정보 손실):
//   · eligibility : 규칙 단위 활성 자격 + 비활성 사유(reason code).  getSignalEligibility 재사용(복제 금지).
//   · evaluation  : 종목×규칙 조건 평가 결과 (matched/unmatched/unknown/not-evaluated). 자격과 무관하게 산출.
//   · coverage    : 조건 leaf 지표별 준비도 (available/partial/missing/unsupported). 실제 평가에 쓰는 leaf 기준.
//
// 핵심 설계:
//   · 매치셋 동일성: diag.filter(eligible && evaluation==='matched') === evaluateGuruSignals 결과.
//     → eligibility 는 getSignalEligibility(+no-condition) 로 getActiveSignalRules 멤버십과 일치,
//       evaluation 은 evaluateCondition 재사용 → 구조적으로 보장(테스트로 재확인).
//   · IMPLEMENTED_METRICS 는 types/knowledge 단일 소스 재사용 (새로 만들지 않음 → drift 방지).
//   · partial: climaxFlags/distributionCount 는 OHLC 미수신 시 값이 0으로 degrade(미산출=null 아님)하므로,
//     ohlcvAvailable=false 면 missing이 아니라 partial로 표기 (종가/거래량 기반 일부 sub-condition은 평가됨).
//
// 진단은 평가만 한다 — evaluateGuruSignals/groupGuruSignals 출력은 건드리지 않는다(additive).

import type {
  ConditionNode, ConditionLeaf, RequiredMetric,
  KnowledgeRule, KnowledgeClaim,
  MetricAvailability, RuleEvaluation, MetricCoverage, InactiveReason,
  RuleDiagnostic, DiagnosticSummary, RuleReadiness, LeafExplain,
} from '../types/knowledge';
import { IMPLEMENTED_METRICS } from '../types/knowledge';
import { getSignalEligibility } from './knowledgeScoring';
import { evaluateCondition, buildMetricValues, type MetricValues, type GuruSignalTarget } from './guruSignalEngine';
import { explainConditionLeaves } from './conditionDescribe';

// OHLC(open/high/low) 품질 의존 지표 — 미수신 시 값은 0으로 degrade하지만 (b)/윗꼬리 등 일부 조건 평가 불가.
// volumeRatio50은 OHLC가 아닌 '거래량' 의존이라 별개(없으면 missing).
const OHLCV_QUALITY_METRICS: ReadonlySet<RequiredMetric> = new Set<RequiredMetric>([
  'climaxFlags', 'distributionCount',
]);

function isLeaf(node: ConditionNode): node is ConditionLeaf {
  return 'metric' in node;
}

function collectLeafMetrics(node: ConditionNode, out: RequiredMetric[]): void {
  if (isLeaf(node)) { out.push(node.metric); return; }
  node.all?.forEach(c => collectLeafMetrics(c, out));
  node.any?.forEach(c => collectLeafMetrics(c, out));
  if (node.not) collectLeafMetrics(node.not, out);
}

function isPresent(v: MetricValues[RequiredMetric]): boolean {
  return !(v === undefined || v === null || (typeof v === 'number' && Number.isNaN(v)));
}

/** 단일 지표 준비도 분류 — unsupported(미구현) / missing(데이터없음) / partial(OHLC품질) / available. */
export function classifyMetricAvailability(
  metric: RequiredMetric,
  metrics: MetricValues,
  ohlcvAvailable: boolean,
): MetricAvailability {
  if (!IMPLEMENTED_METRICS.has(metric)) return 'unsupported';
  if (!isPresent(metrics[metric])) return 'missing';
  if (ohlcvAvailable === false && OHLCV_QUALITY_METRICS.has(metric)) return 'partial';
  return 'available';
}

function toEvaluation(r: boolean | null): RuleEvaluation {
  return r === true ? 'matched' : r === false ? 'unmatched' : 'unknown';
}

/**
 * 단일 규칙 × 종목 진단. metrics 는 buildMetricValues 결과(호출부에서 1회 산출해 공유).
 * ohlcvAvailable 는 partial 판정용 (enriched.ohlcvAvailable).
 */
export function diagnoseRule(
  rule: KnowledgeRule,
  claims: KnowledgeClaim[],
  metrics: MetricValues,
  ohlcvAvailable: boolean,
  now: Date,
): RuleDiagnostic {
  const reasons: InactiveReason[] = [...getSignalEligibility(rule, claims, now).reasons];
  const hasCondition = rule.condition !== undefined;
  if (!hasCondition) reasons.push('no-condition'); // getActiveSignalRules 층 게이트
  const eligible = reasons.length === 0;

  let evaluation: RuleEvaluation = 'not-evaluated';
  let coverage: MetricCoverage[] = [];
  let leaves: LeafExplain[] = [];

  if (hasCondition) {
    const cond = rule.condition as ConditionNode;
    const metricsUsed: RequiredMetric[] = [];
    collectLeafMetrics(cond, metricsUsed);
    const seen = new Set<RequiredMetric>();
    coverage = metricsUsed
      .filter(m => (seen.has(m) ? false : (seen.add(m), true)))
      .map(m => {
        const availability = classifyMetricAvailability(m, metrics, ohlcvAvailable);
        const present = availability === 'available' || availability === 'partial';
        return { metric: m, availability, value: present ? metrics[m] : undefined };
      });
    leaves = explainConditionLeaves(cond, metrics);
    evaluation = toEvaluation(evaluateCondition(cond, metrics));
  }

  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    action: rule.action,
    eligibility: { eligible, reasons },
    evaluation,
    coverage,
    leaves,
  };
}

/**
 * 선택 종목에 대해 전 신호 규칙(computability='signal')을 진단.
 * advisory 규칙은 신호 대상이 아니므로 제외(패널은 신호 진단 전용).
 */
export function diagnoseAssetRules(params: {
  rules: KnowledgeRule[];
  claims: KnowledgeClaim[];
  target: GuruSignalTarget;
  now: Date;
}): RuleDiagnostic[] {
  const metrics = buildMetricValues(params.target.enriched, params.target.currentPrice);
  const ohlcvAvailable = params.target.enriched.ohlcvAvailable;
  return params.rules
    .filter(r => r.computability === 'signal')
    .map(r => diagnoseRule(r, params.claims, metrics, ohlcvAvailable, params.now));
}

/** 규칙당 준비도 = 조건 leaf 중 최악 availability (unsupported>missing>partial>complete). 조건/leaf 없으면 not-applicable. */
export function ruleReadiness(d: RuleDiagnostic): RuleReadiness {
  if (d.coverage.length === 0) return 'not-applicable'; // 조건 없음(또는 빈 그룹) → 준비도 적용 불가
  if (d.coverage.some(c => c.availability === 'unsupported')) return 'unsupported';
  if (d.coverage.some(c => c.availability === 'missing')) return 'missing';
  if (d.coverage.some(c => c.availability === 'partial')) return 'partial';
  return 'complete';
}

/**
 * 진단 요약 — 3축을 collapse하지 않고 각 축 독립 카운트.
 * 핵심: partial 지표가 0으로 degrade돼 evaluation=unmatched여도 readiness.partial 로 별도 노출됨
 *   (이전 단일 status는 partial+unmatched를 '미충족'에 숨겨 0-degrade를 재발시켰음).
 *   UI는 evaluation×readiness 교차로 "부분 데이터 → 판정 유보"를 표시할 수 있다.
 */
export function summarizeDiagnostics(diags: RuleDiagnostic[]): DiagnosticSummary {
  const s: DiagnosticSummary = {
    total: diags.length,
    eligibility: { eligible: 0, inactive: 0 },
    evaluation: { matched: 0, unmatched: 0, unknown: 0, notEvaluated: 0 },
    readiness: { complete: 0, partial: 0, missing: 0, unsupported: 0, 'not-applicable': 0 },
  };
  for (const d of diags) {
    if (d.eligibility.eligible) s.eligibility.eligible++; else s.eligibility.inactive++;
    if (d.evaluation === 'matched') s.evaluation.matched++;
    else if (d.evaluation === 'unmatched') s.evaluation.unmatched++;
    else if (d.evaluation === 'unknown') s.evaluation.unknown++;
    else s.evaluation.notEvaluated++;
    s.readiness[ruleReadiness(d)]++;
  }
  return s;
}
