// tests/guruDiagnosticsParity.ts
// ---------------------------------------------------------------------------
// 5A 구루 진단 회귀 테스트 — guruDiagnostics 가 기존 신호 결과를 바꾸지 않으며(additive),
// 3축(eligibility/evaluation/coverage)을 정확히 산출함을 고정한다.
//
// 운영 함수만 호출(계산식 복제 안 함). 수동 실행: npm run test:diagnostics  (tsx)
// 통과 시 exit 0, 불일치 1건이라도 있으면 exit 1.

import {
  diagnoseRule, diagnoseAssetRules, classifyMetricAvailability, summarizeDiagnostics, ruleReadiness,
  describeRuleStatus,
} from '../utils/guruDiagnostics';
import { getSignalEligibility, isActiveSignal } from '../utils/knowledgeScoring';
import { evaluateGuruSignals, buildGuruSignalTargets, buildMetricValues, type GuruSignalTarget, type MetricValues } from '../utils/guruSignalEngine';
import { IMPLEMENTED_METRICS, EMPTY_VERIFICATION } from '../types/knowledge';
import type {
  KnowledgeRule, KnowledgeClaim, ConditionNode, RequiredMetric, VerificationFlags, InactiveReason,
} from '../types/knowledge';
import type { Asset, WatchlistItem } from '../types';
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

// ════════════════════════════════════════════════════════════════════════════
// 7. describeRuleStatus — 3축 → 사용자용 단일 상태(정밀 라벨). 핵심: 엔진결과(matched) 왜곡 금지.
// ════════════════════════════════════════════════════════════════════════════
const stat = (cond: ConditionNode, metrics: MetricValues, ohlcv = true, over: Partial<KnowledgeRule> = {}) =>
  describeRuleStatus(diagnoseRule(mkRule({ condition: cond, ...over }), [], metrics, ohlcv, NOW));

check('status firing', stat(leaf('rsi14', '>=', 50), { rsi14: 60 }).kind, 'firing');
check('status not-met', stat(leaf('rsi14', '>=', 50), { rsi14: 40 }).kind, 'not-met');
check('status data-missing', stat(leaf('priceToMa20Pct', '>=', 0), {}).kind, 'data-missing');
check('status unsupported', stat(leaf('rsRank', '>=', 90), {}).kind, 'unsupported');

// partial(OHLC degrade) — matched vs unmatched 정밀 라벨 (계약 핵심)
check('status firing-partial kind', stat(leaf('climaxFlags', '<=', 5), { climaxFlags: 0 }, false).kind, 'firing-partial');
check('status firing-partial label', stat(leaf('climaxFlags', '<=', 5), { climaxFlags: 0 }, false).label, '일부 데이터 기준 충족');
check('status not-met-partial kind', stat(leaf('climaxFlags', '>=', 2), { climaxFlags: 0 }, false).kind, 'not-met-partial');
check('status not-met-partial label', stat(leaf('climaxFlags', '>=', 2), { climaxFlags: 0 }, false).label, '현재 계산상 미충족·일부 데이터 누락');
check('status data-missing label', stat(leaf('priceToMa20Pct', '>=', 0), {}).label, '데이터 부족으로 판정 불가');
check('status unsupported label', stat(leaf('rsRank', '>=', 90), {}).label, '현재 앱에서 미지원');

// 자격 없음(draft) → 평가 가능해도 inactive 우선
check('status inactive(draft)', stat(leaf('rsi14', '>=', 0), { rsi14: 60 }, true, { status: 'draft' }).kind, 'inactive');
// 조건 없음 → no-condition
check('status no-condition', describeRuleStatus(diagnoseRule(mkRule({}), [], {}, true, NOW)).kind, 'no-condition');

// 엔진결과 왜곡 금지: any[true, unsupported]=matched → 'unsupported'로 강등 금지(발화 사실 보존)
{
  const cond: ConditionNode = { any: [leaf('rsi14', '>=', 50), leaf('rsRank', '>=', 90)] };
  const s = stat(cond, { rsi14: 60 }); // rsi 충족(matched), rsRank 미지원(null) — readiness=unsupported
  check('status matched+unsupported → firing-partial(NOT unsupported)', s.kind, 'firing-partial');
}

// tone 스폿체크
check('tone firing=positive', stat(leaf('rsi14', '>=', 50), { rsi14: 60 }).tone, 'positive');
check('tone unsupported=muted', stat(leaf('rsRank', '>=', 90), {}).tone, 'muted');
check('tone not-met-partial=caution', stat(leaf('climaxFlags', '>=', 2), { climaxFlags: 0 }, false).tone, 'caution');

// ════════════════════════════════════════════════════════════════════════════
// 8. buildGuruSignalTargets — 신호 평가/진단이 공유하는 "대상 선정" 경로 회귀 핀.
//    (이 빌더가 바뀌면 신호와 진단 양쪽 대상이 동시에 drift하므로 단일 지점에서 고정.)
// ════════════════════════════════════════════════════════════════════════════
{
  const enrichedMap = new Map<string, EnrichedIndicatorData>([
    ['AAA', mkEnriched()], ['BBB', mkEnriched()], ['WWW', mkEnriched()],
    ['DUP', mkEnriched()], ['ZERO', mkEnriched()], ['FB', mkEnriched()],
  ]);
  // 빌더가 읽는 필드만 채워 캐스팅(다른 필수 필드는 미접근).
  const mkAsset = (id: string, ticker: string, priceOriginal: number): Asset =>
    ({ id, ticker, name: `${ticker}명`, priceOriginal } as unknown as Asset);
  const mkWatch = (id: string, ticker: string, o: Partial<WatchlistItem> = {}): WatchlistItem =>
    ({ id, ticker, name: `${ticker}관심`, ...o } as unknown as WatchlistItem);

  // 포트폴리오 우선 순서 + source 태깅 + 포트폴리오는 priceOriginal 사용
  const t1 = buildGuruSignalTargets({
    portfolioAssets: [mkAsset('p1', 'AAA', 100), mkAsset('p2', 'BBB', 200)],
    watchlist: [mkWatch('w1', 'WWW', { priceOriginal: 50 })],
    enrichedMap,
  });
  check('targets: 포트폴리오 우선 순서', t1.map(t => t.assetId), ['p1', 'p2', 'w1']);
  check('targets: source 태깅', t1.map(t => t.source), ['portfolio', 'portfolio', 'watchlist']);
  check('targets: 포트폴리오 price=priceOriginal', t1[0].currentPrice, 100);

  // 동일 ticker 관심종목 제외(포트폴리오 우선)
  const t2 = buildGuruSignalTargets({
    portfolioAssets: [mkAsset('p1', 'DUP', 100)],
    watchlist: [mkWatch('w-dup', 'DUP', { priceOriginal: 99 })],
    enrichedMap,
  });
  check('targets: 동일 ticker 관심종목 제외', t2.map(t => t.assetId), ['p1']);

  // enrichment 없는 종목 제외(포트폴리오/관심 모두)
  const t3 = buildGuruSignalTargets({
    portfolioAssets: [mkAsset('p-noenr', 'NOENR', 100), mkAsset('p1', 'AAA', 100)],
    watchlist: [mkWatch('w-noenr', 'NOENR2', { priceOriginal: 10 })],
    enrichedMap,
  });
  check('targets: enrichment 없는 종목 제외', t3.map(t => t.assetId), ['p1']);

  // 가격 0 이하 관심종목 제외(0 / 음수)
  const t4 = buildGuruSignalTargets({
    portfolioAssets: [],
    watchlist: [mkWatch('w-zero', 'ZERO', { priceOriginal: 0 }), mkWatch('w-neg', 'ZERO', { currentPrice: -5 })],
    enrichedMap,
  });
  check('targets: 가격≤0 관심종목 제외', t4.length, 0);

  // priceOriginal 부재 시 currentPrice fallback(관심종목)
  const t5 = buildGuruSignalTargets({
    portfolioAssets: [],
    watchlist: [mkWatch('w-fb', 'FB', { currentPrice: 77 })],
    enrichedMap,
  });
  check('targets: priceOriginal→currentPrice fallback', t5[0]?.currentPrice, 77);
}

// ── 결과 ─────────────────────────────────────────────────────────────────────
console.log(`\nguru diagnostics: ${pass} passed, ${fails.length} failed`);
if (fails.length > 0) {
  for (const f of fails) console.log(f);
  process.exitCode = 1;
} else {
  console.log('✓ 진단 3축 + 매치셋 동일성 + describeRuleStatus 정밀 라벨 + buildGuruSignalTargets 대상 선정 고정');
}
