// tests/guruDiagnosticsParity.ts
// ---------------------------------------------------------------------------
// 5A 구루 진단 회귀 테스트 — guruDiagnostics 가 기존 신호 결과를 바꾸지 않으며(additive),
// 3축(eligibility/evaluation/coverage)을 정확히 산출함을 고정한다.
//
// 운영 함수만 호출(계산식 복제 안 함). 수동 실행: npm run test:diagnostics  (tsx)
// 통과 시 exit 0, 불일치 1건이라도 있으면 exit 1.

import {
  diagnoseRule, diagnoseAssetRules, classifyMetricAvailability, summarizeDiagnostics, ruleReadiness,
} from '../utils/guruDiagnostics';
import { getSignalEligibility, isActiveSignal } from '../utils/knowledgeScoring';
import { evaluateGuruSignals, type GuruSignalTarget, type MetricValues } from '../utils/guruSignalEngine';
import { buildMetricValues } from '../utils/guruSignalEngine';
import { IMPLEMENTED_METRICS, EMPTY_VERIFICATION } from '../types/knowledge';
import type {
  KnowledgeRule, KnowledgeClaim, ConditionNode, RequiredMetric, VerificationFlags, InactiveReason,
} from '../types/knowledge';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';
import { readFileSync } from 'node:fs';

const NOW = new Date('2026-06-25T00:00:00Z');

// ── 단언기 ───────────────────────────────────────────────────────────────────
let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
const sorted = (a: string[]): string[] => [...a].sort();

// ── fixture 헬퍼 ──────────────────────────────────────────────────────────────
function mkRule(over: Partial<KnowledgeRule>): KnowledgeRule {
  return {
    id: 'r', claimIds: [], title: 't', ruleType: 'entry-setup',
    computability: 'signal', action: 'buy-watch', status: 'active',
    requiredMetrics: [],
    verification: { ...EMPTY_VERIFICATION, userApproved: true },
    ...over,
  };
}
const vf = (p: Partial<VerificationFlags>): VerificationFlags => ({ ...EMPTY_VERIFICATION, ...p });
const leaf = (metric: RequiredMetric, operator: '>=' | '<=', value: number): ConditionNode => ({ metric, operator, value });

function mkEnriched(o: Partial<EnrichedIndicatorData> = {}): EnrichedIndicatorData {
  return {
    ma: {}, prevMa: {}, rsi: null, prevRsi: null, maCrossDays: {},
    prevClose: null, priceCrossMaDays: {}, priceBreakBelowMaDays: {},
    rsiBounceDay: null, rsiOverheatEntryDay: null,
    atr14: null, high52w: null, volume52wMax: null,
    slopeRatio: null, dayRangeOverAtr: null,
    priceIsAt52wHigh: false, volumeIsAt52wMax: false,
    distributionDayMeta: [], ohlcvAvailable: true,
    isBullishCandle: null, longTrendUp: null, recentSwingLow: null,
    ...o,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. evaluation — all/any/not × {true/false/null} 정책 (3치 논리 보존)
//    metrics 를 직접 핸드크래프트해 diagnoseRule.evaluation 을 핀.
// ════════════════════════════════════════════════════════════════════════════
function evalOf(cond: ConditionNode, metrics: MetricValues): string {
  return diagnoseRule(mkRule({ condition: cond }), [], metrics, true, NOW).evaluation;
}
// rsi14 = 평가 가능 leaf, priceToMa20Pct 부재 = null leaf
check('eval leaf true', evalOf(leaf('rsi14', '>=', 50), { rsi14: 60 }), 'matched');
check('eval leaf false', evalOf(leaf('rsi14', '>=', 50), { rsi14: 40 }), 'unmatched');
check('eval leaf null', evalOf(leaf('rsi14', '>=', 50), {}), 'unknown');
check('eval all[false,null]=false', evalOf({ all: [leaf('rsi14', '>=', 50), leaf('priceToMa20Pct', '>=', 0)] }, { rsi14: 40 }), 'unmatched');
check('eval all[true,null]=null', evalOf({ all: [leaf('rsi14', '>=', 50), leaf('priceToMa20Pct', '>=', 0)] }, { rsi14: 60 }), 'unknown');
check('eval any[false,null]=null', evalOf({ any: [leaf('rsi14', '>=', 50), leaf('priceToMa20Pct', '>=', 0)] }, { rsi14: 40 }), 'unknown');
check('eval any[true,null]=true', evalOf({ any: [leaf('rsi14', '>=', 50), leaf('priceToMa20Pct', '>=', 0)] }, { rsi14: 60 }), 'matched');
check('eval not(null)=null', evalOf({ not: leaf('priceToMa20Pct', '>=', 0) }, {}), 'unknown');
check('eval not(true)=false', evalOf({ not: leaf('rsi14', '>=', 50) }, { rsi14: 60 }), 'unmatched');
check('eval not(false)=true', evalOf({ not: leaf('rsi14', '>=', 50) }, { rsi14: 40 }), 'matched');
check('eval no-condition=not-evaluated', diagnoseRule(mkRule({}), [], {}, true, NOW).evaluation, 'not-evaluated');

// ════════════════════════════════════════════════════════════════════════════
// 2. eligibility — 사유별 분류 + getSignalEligibility().eligible === isActiveSignal()
// ════════════════════════════════════════════════════════════════════════════
const expiredClaim: KnowledgeClaim = {
  id: 'c-exp', sourceId: 's', sourceDate: '2026-03-01', statement: 'x',
  category: 'screening', decayClass: 'event-news', authorityTier: 'external-guru',
  guru: 'generic', confidence: 'qualified', verification: EMPTY_VERIFICATION,
};
const eligCases: Array<{ name: string; rule: KnowledgeRule; claims: KnowledgeClaim[]; reasons: InactiveReason[] }> = [
  { name: 'eligible', rule: mkRule({}), claims: [], reasons: [] },
  { name: 'draft', rule: mkRule({ status: 'draft' }), claims: [], reasons: ['draft'] },
  { name: 'archived', rule: mkRule({ status: 'archived' }), claims: [], reasons: ['archived'] },
  { name: 'advisory', rule: mkRule({ computability: 'advisory' }), claims: [], reasons: ['advisory'] },
  { name: 'rejected', rule: mkRule({ verification: vf({ rejected: true }) }), claims: [], reasons: ['rejected'] },
  { name: 'unverified', rule: mkRule({ verification: EMPTY_VERIFICATION }), claims: [], reasons: ['unverified'] },
  { name: 'claim-expired', rule: mkRule({ claimIds: ['c-exp'] }), claims: [expiredClaim], reasons: ['claim-expired'] },
  { name: 'multi(draft+advisory+unverified)', rule: mkRule({ status: 'draft', computability: 'advisory', verification: EMPTY_VERIFICATION }), claims: [], reasons: ['draft', 'advisory', 'unverified'] },
];
for (const c of eligCases) {
  const elig = getSignalEligibility(c.rule, c.claims, NOW);
  check(`elig reasons: ${c.name}`, elig.reasons, c.reasons);
  check(`elig eligible: ${c.name}`, elig.eligible, c.reasons.length === 0);
  // 등가성: 리팩터 후에도 isActiveSignal === getSignalEligibility().eligible
  check(`elig==isActiveSignal: ${c.name}`, isActiveSignal(c.rule, c.claims, NOW), elig.eligible);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. coverage — available / partial(OHLC+climax) / missing / unsupported
// ════════════════════════════════════════════════════════════════════════════
check('cov unsupported(rsRank)', classifyMetricAvailability('rsRank', {}, true), 'unsupported');
check('cov missing(impl, absent)', classifyMetricAvailability('priceToMa20Pct', {}, true), 'missing');
check('cov available(rsi14)', classifyMetricAvailability('rsi14', { rsi14: 50 }, true), 'available');
check('cov partial(climax, ohlcv=false)', classifyMetricAvailability('climaxFlags', { climaxFlags: 0 }, false), 'partial');
check('cov available(climax, ohlcv=true)', classifyMetricAvailability('climaxFlags', { climaxFlags: 0 }, true), 'available');
check('cov missing>partial(climax absent)', classifyMetricAvailability('climaxFlags', {}, false), 'missing');
check('cov volumeRatio50 not OHLC-partial', classifyMetricAvailability('volumeRatio50', { volumeRatio50: 1.5 }, false), 'available');
// diagnoseRule coverage 통합 (조건 leaf 기준, 중복 제거)
{
  const cond: ConditionNode = { all: [leaf('rsi14', '>=', 50), leaf('climaxFlags', '<=', 2), leaf('priceToMa20Pct', '>=', 0), leaf('rsRank', '>=', 90)] };
  const d = diagnoseRule(mkRule({ condition: cond }), [], { rsi14: 55, climaxFlags: 0 }, false, NOW);
  const cov = Object.fromEntries(d.coverage.map(c => [c.metric, c.availability]));
  check('diag coverage map', cov, { rsi14: 'available', climaxFlags: 'partial', priceToMa20Pct: 'missing', rsRank: 'unsupported' });
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 매치셋 동일성 — diag.filter(eligible && matched) === evaluateGuruSignals
// ════════════════════════════════════════════════════════════════════════════
{
  const target: GuruSignalTarget = {
    assetId: 'a1', ticker: 'TST', name: '테스트',
    currentPrice: 1000, enriched: mkEnriched({ rsi: 60 }), source: 'portfolio',
  };
  const rules: KnowledgeRule[] = [
    mkRule({ id: 'A-match', condition: leaf('rsi14', '>=', 50) }),                       // eligible + matched
    mkRule({ id: 'B-unmatch', condition: leaf('rsi14', '>=', 99) }),                      // eligible + unmatched
    mkRule({ id: 'C-draft', status: 'draft', condition: leaf('rsi14', '>=', 0) }),        // ineligible(would match)
    mkRule({ id: 'D-unsupported', condition: leaf('rsRank', '>=', 90) }),                 // eligible + unknown
    mkRule({ id: 'E-advisory', computability: 'advisory', condition: leaf('rsi14', '>=', 0) }), // 신호 아님(진단 제외)
  ];
  const expected = sorted(
    evaluateGuruSignals({ rules, claims: [], targets: [target], now: NOW })
      .filter(m => m.assetId === 'a1').map(m => m.ruleId),
  );
  const diags = diagnoseAssetRules({ rules, claims: [], target, now: NOW });
  const actual = sorted(diags.filter(d => d.eligibility.eligible && d.evaluation === 'matched').map(d => d.ruleId));
  check('matched-set parity', actual, expected);
  check('matched-set == [A-match]', actual, ['A-match']);
  // advisory 규칙은 진단 대상에서 제외
  check('diag excludes advisory', diags.some(d => d.ruleId === 'E-advisory'), false);
  // 요약 카운트 — 3축 독립(collapse 안 함)
  const sum = summarizeDiagnostics(diags);
  check('summary 3-axis', sum, {
    total: 4,
    eligibility: { eligible: 3, inactive: 1 },
    evaluation: { matched: 2, unmatched: 1, unknown: 1, notEvaluated: 0 },
    readiness: { complete: 3, partial: 0, missing: 0, unsupported: 1, 'not-applicable': 0 },
  });
}

// 4c. 조건 없는 규칙 → readiness 'not-applicable' (complete 오분류 방지)
{
  const d = diagnoseRule(mkRule({ id: 'nc' }), [], {}, true, NOW);
  check('no-condition: evaluation not-evaluated', d.evaluation, 'not-evaluated');
  check('no-condition: readiness not-applicable', ruleReadiness(d), 'not-applicable');
  check('no-condition: reasons has no-condition', d.eligibility.reasons.includes('no-condition'), true);
}

// ════════════════════════════════════════════════════════════════════════════
// 4b. partial 이 요약에서 숨지 않음 — climaxFlags=0(degrade)+OHLC누락 → unmatched이나 readiness.partial
// ════════════════════════════════════════════════════════════════════════════
{
  const target: GuruSignalTarget = {
    assetId: 'a2', ticker: 'T2', name: 'n2',
    currentPrice: 1000, enriched: mkEnriched({ ohlcvAvailable: false }), source: 'portfolio',
  };
  const rule = mkRule({ id: 'climax-sell', action: 'sell-warning', condition: leaf('climaxFlags', '>=', 2) });
  const diags = diagnoseAssetRules({ rules: [rule], claims: [], target, now: NOW });
  check('partial: evaluation=unmatched(0<2)', diags[0].evaluation, 'unmatched');
  check('partial: coverage=partial', diags[0].coverage[0].availability, 'partial');
  const sum = summarizeDiagnostics(diags);
  check('partial NOT hidden: readiness.partial=1', sum.readiness.partial, 1);
  check('partial: evaluation.unmatched=1', sum.evaluation.unmatched, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. now 주입 — claim 만료가 now 기준으로 결정적
// ════════════════════════════════════════════════════════════════════════════
{
  const rule = mkRule({ claimIds: ['c-exp'] });
  check('now=2026-06-25 → expired', getSignalEligibility(rule, [expiredClaim], NOW).reasons, ['claim-expired']);
  check('now=2026-03-05 → not expired', getSignalEligibility(rule, [expiredClaim], new Date('2026-03-05T00:00:00Z')).eligible, true);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. drift 가드 — buildMetricValues 산출 키 ⊆ IMPLEMENTED_METRICS
// ════════════════════════════════════════════════════════════════════════════
{
  const full = mkEnriched({
    rsi: 55, ma: { 20: 100, 60: 95, 150: 90 }, high52w: 120,
    slopeRatio: 1.2, dayRangeOverAtr: 1.0, priceIsAt52wHigh: false, volumeIsAt52wMax: false,
    distributionDayMeta: [{ volRatio: 1.1, isBearish: false, isLowerHalfClose: false, changeRatio: 0.01 }],
    longTrendUp: true, isBullishCandle: true, ohlcvAvailable: true, priceCrossMaDays: { 20: 2 },
  });
  const produced = new Set(Object.keys(buildMetricValues(full, 110)) as RequiredMetric[]);
  // 양방향 집합 동일성: 산출 키 = IMPLEMENTED_METRICS (한쪽이라도 어긋나면 실패 — 단방향 ⊆ 만으론 phantom 못 잡음)
  check('drift: produced ∖ declared = ∅', [...produced].filter(k => !IMPLEMENTED_METRICS.has(k)).sort(), []);
  check('drift: declared ∖ produced = ∅ (full fixture)', [...IMPLEMENTED_METRICS].filter(k => !produced.has(k)).sort(), []);
}

// 6b. TS ↔ Python(triage_commit.py) IMPLEMENTED_METRICS 동기 (엄밀한 단일 소스 강제)
{
  try {
    const py = readFileSync('scripts/ingest/triage_commit.py', 'utf8');
    const block = py.match(/IMPLEMENTED_METRICS\s*=\s*\{([^}]*)\}/);
    const pyMetrics = new Set((block ? block[1].match(/"([^"]+)"/g) ?? [] : []).map(s => s.replace(/"/g, '')));
    check('py↔ts: only-in-py = ∅', [...pyMetrics].filter(k => !IMPLEMENTED_METRICS.has(k as RequiredMetric)).sort(), []);
    check('py↔ts: only-in-ts = ∅', [...IMPLEMENTED_METRICS].filter(k => !pyMetrics.has(k)).sort(), []);
  } catch (e) {
    fails.push(`✗ py↔ts sync: triage_commit.py 읽기 실패 — ${String(e)}`);
  }
}

// ── 결과 ─────────────────────────────────────────────────────────────────────
console.log(`\nguru diagnostics: ${pass} passed, ${fails.length} failed`);
if (fails.length > 0) {
  for (const f of fails) console.log(f);
  process.exitCode = 1;
} else {
  console.log('✓ 진단 3축(eligibility/evaluation/coverage) + 매치셋 동일성 고정');
}
