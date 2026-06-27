// tests/signalReplayParity.ts
// ---------------------------------------------------------------------------
// 신호 리플레이 회귀 테스트 — 운영 함수만 호출(계산식 복제 없음). 수동 실행: npm run test:replay (tsx)
// 핵심:
//   ① 룩어헤드 방지 — asOf 이후 데이터가 buildEnrichedIndicator/진단에 절대 영향 주지 않음
//      (full 시리즈와 asOf까지 잘라낸 시리즈가 동일 진단을 산출). 단, outcome은 미래 종가 기반이라 달라야 함.
//   ② boundaryDistance — between/음수/0 임계값 안전.
//   ③ applyRuleOverrides — leafId 패치·enabled=false 제거·비파괴.
//   ④ flattenLeaves/deriveLeafId — 안정적 id(재실행 동일·중복순번·명시 id 우선).
// 통과 시 exit 0, 실패 1건이라도 있으면 exit 1.

import { prepareSeries, evaluateReplayDay } from '../utils/replayEval';
import { buildReplayTimeline } from '../utils/signalReplay';
import { boundaryDistance } from '../utils/boundaryDistance';
import { applyRuleOverrides, mergeOverrides, hashRuleset } from '../utils/ruleOverrides';
import { flattenLeaves } from '../utils/conditionLeafId';
import {
  verdictKey, findVerdict, upsertVerdict, removeVerdict, verdictsForTicker,
  datesWithVerdict, parseVerdicts, serializeVerdicts, isVerdictKind,
} from '../utils/replayVerdicts';
import {
  collectPerRuleResults, buildRuleSnapshot, computeResultMetrics, buildVerificationCase,
  diffSignalDates, diffCaseResults, upsertCase, removeCase, parseCases,
} from '../utils/replayCases';
import { EMPTY_VERIFICATION } from '../types/knowledge';
import type { KnowledgeRule, KnowledgeClaim, ConditionNode, RuleDiagnostic } from '../types/knowledge';
import type { AlertRule } from '../types/alertRules';
import type {
  RuleOverride, SignalVerdict, ReplayDay, ReplayTimeline,
} from '../types/signalReplay';
import type { HistoricalPriceResult } from '../services/historicalPriceService';

const NOW = new Date('2026-06-26T00:00:00Z');

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function checkTrue(name: string, cond: boolean): void {
  if (cond) pass++; else fails.push(`✗ ${name}: expected true`);
}

// ── 합성 OHLCV 시리즈 (300 거래일, 결정론적) ──────────────────────────────────
function makeHistory(nDays: number): HistoricalPriceResult {
  const data: Record<string, number> = {};
  const open: Record<string, number> = {};
  const high: Record<string, number> = {};
  const low: Record<string, number> = {};
  const volume: Record<string, number> = {};
  const base = new Date('2025-01-01T00:00:00Z').getTime();
  let prev = 100;
  for (let i = 0; i < nDays; i++) {
    const date = new Date(base + i * 86400000).toISOString().slice(0, 10);
    const close = 100 + i * 0.3 + Math.sin(i / 9) * 6; // 완만한 상승 + 진동
    data[date] = close;
    open[date] = prev;
    high[date] = Math.max(prev, close) * 1.01;
    low[date] = Math.min(prev, close) * 0.99;
    volume[date] = 1_000_000 + (i % 7) * 50_000;
    prev = close;
  }
  return { data, open, high, low, volume };
}

function sliceHistory(h: HistoricalPriceResult, keep: number): HistoricalPriceResult {
  const dates = Object.keys(h.data ?? {}).sort().slice(0, keep);
  const pick = (s?: Record<string, number>) => {
    if (!s) return undefined;
    const o: Record<string, number> = {};
    for (const d of dates) if (d in s) o[d] = s[d];
    return o;
  };
  return { data: pick(h.data), open: pick(h.open), high: pick(h.high), low: pick(h.low), volume: pick(h.volume) };
}

// ── fixture 규칙 ──────────────────────────────────────────────────────────────
const vfApproved = { ...EMPTY_VERIFICATION, userApproved: true };
const guruRules: KnowledgeRule[] = [
  {
    id: 'r-overheat', claimIds: [], title: 'RSI 과열 경고', ruleType: 'exit-profit',
    computability: 'signal', action: 'sell-warning', status: 'active', requiredMetrics: ['rsi14'],
    verification: vfApproved, condition: { all: [{ metric: 'rsi14', operator: '>=', value: 70 }] },
  },
  {
    id: 'r-pullback', claimIds: [], title: 'MA20 눌림목', ruleType: 'entry-setup',
    computability: 'signal', action: 'buy-watch', status: 'active', requiredMetrics: ['priceToMa20Pct'],
    verification: vfApproved, condition: { all: [{ metric: 'priceToMa20Pct', operator: 'between', value: [-3, 3] }] },
  },
];
const claims: KnowledgeClaim[] = [];
const alertRules: AlertRule[] = [
  { id: 'a-rsi-ob', name: 'RSI 과매수', description: '', severity: 'warning', action: 'sell', enabled: true, filters: ['RSI_OVERBOUGHT'], filterConfig: {} },
  { id: 'a-rsi-os', name: 'RSI 과매도', description: '', severity: 'info', action: 'buy', enabled: true, filters: ['RSI_OVERSOLD'], filterConfig: {} },
];

// ── ① 룩어헤드 방지 ───────────────────────────────────────────────────────────
{
  const ASOF = 200;
  const full = makeHistory(300);
  const trunc = sliceHistory(full, ASOF + 1); // 0..200 만
  const fullSeries = prepareSeries(full);
  const truncSeries = prepareSeries(trunc);

  const common = { ticker: 'TST', name: 'TST', guruRules, claims, alertRules, now: NOW };
  const dFull = evaluateReplayDay({ ...common, series: fullSeries, asOfIndex: ASOF });
  const dTrunc = evaluateReplayDay({ ...common, series: truncSeries, asOfIndex: ASOF });

  check('lookahead: enriched identical', dFull.enriched, dTrunc.enriched);
  check('lookahead: guru diagnostics identical', dFull.guruDiagnostics, dTrunc.guruDiagnostics);
  check('lookahead: alert diagnostics identical', dFull.alertDiagnostics, dTrunc.alertDiagnostics);
  check('lookahead: leaf distances identical', dFull.guruLeafDistances, dTrunc.guruLeafDistances);
  // outcome 은 미래 종가 기반 — full 은 값 있음, trunc 는 미래 없어 null. (신호와 분리됨을 입증)
  checkTrue('lookahead: full outcome has future ret5', dFull.outcome.ret5 !== null);
  checkTrue('lookahead: truncated outcome ret5 is null', dTrunc.outcome.ret5 === null);
}

// ── ② boundaryDistance ────────────────────────────────────────────────────────
check('bd >= pass margin', boundaryDistance(75, '>=', 70), 5);
check('bd >= shortfall', boundaryDistance(65, '>=', 70), -5);
check('bd <= pass margin', boundaryDistance(60, '<=', 70), 10);
check('bd <= boundary zero', boundaryDistance(0, '<=', 0), 0);
check('bd between inside (closest bound)', boundaryDistance(2, 'between', [-3, 3]), 1);
check('bd between below', boundaryDistance(-5, 'between', [-3, 3]), -2);
check('bd between above', boundaryDistance(5, 'between', [-3, 3]), -2);
check('bd = is null', boundaryDistance(50, '=', 'uptrend'), null);
check('bd string value is null', boundaryDistance('uptrend', '=', 'uptrend'), null);
check('bd missing value is null', boundaryDistance(null, '>=', 70), null);

// ── ③ applyRuleOverrides ──────────────────────────────────────────────────────
{
  const rule: KnowledgeRule = {
    id: 'r1', claimIds: [], title: 't', ruleType: 'entry-setup', computability: 'signal',
    action: 'buy-watch', status: 'active', requiredMetrics: [], verification: vfApproved,
    condition: { all: [
      { metric: 'rsi14', operator: '>=', value: 70 },
      { metric: 'priceToMa20Pct', operator: '<=', value: 3 },
    ] },
  };
  const originalJson = JSON.stringify(rule);

  // leafId: rsi14__>=__0, priceToMa20Pct__<=__0
  const ov1: RuleOverride[] = [{ ruleId: 'r1', leafId: 'rsi14__>=__0', value: 60 }];
  const [patched] = applyRuleOverrides([rule], ov1);
  const firstLeaf = (patched.condition as { all: ConditionNode[] }).all[0];
  check('override: value patched', (firstLeaf as { value: unknown }).value, 60);
  check('override: original unchanged (비파괴)', JSON.stringify(rule), originalJson);

  // enabled:false 로 한 leaf 제거 → 다른 leaf 만 남음
  const ov2: RuleOverride[] = [{ ruleId: 'r1', leafId: 'rsi14__>=__0', enabled: false }];
  const [dropped] = applyRuleOverrides([rule], ov2);
  const remaining = (dropped.condition as { all: ConditionNode[] }).all;
  check('override: leaf removed leaves 1', remaining.length, 1);
  check('override: remaining leaf metric', (remaining[0] as { metric: string }).metric, 'priceToMa20Pct');

  // 빈 오버라이드 = 넘긴 배열을 그대로 반환(identity)
  const arr = [rule];
  checkTrue('override: empty = identity', applyRuleOverrides(arr, []) === arr);

  // operator 패치
  const ov3: RuleOverride[] = [{ ruleId: 'r1', leafId: 'priceToMa20Pct__<=__0', operator: '>=' }];
  const [opPatched] = applyRuleOverrides([rule], ov3);
  const l2 = (opPatched.condition as { all: ConditionNode[] }).all[1];
  check('override: operator patched', (l2 as { operator: string }).operator, '>=');

  // mergeOverrides: sandbox 가 perm 을 덮어씀
  const merged = mergeOverrides(
    [{ ruleId: 'r1', leafId: 'rsi14__>=__0', value: 50 }],
    [{ ruleId: 'r1', leafId: 'rsi14__>=__0', value: 80 }],
  );
  check('mergeOverrides: sandbox wins', merged.length === 1 && merged[0].value, 80);
}

// ── ④ flattenLeaves / deriveLeafId 안정성 ────────────────────────────────────
{
  const cond: ConditionNode = { all: [
    { metric: 'rsi14', operator: '>=', value: 30 },
    { metric: 'rsi14', operator: '>=', value: 70 }, // 같은 metric+operator 중복 → 순번
    { metric: 'priceToMa20Pct', operator: 'between', value: [-3, 3] },
  ] };
  const ids1 = flattenLeaves(cond).map(l => l.leafId);
  const ids2 = flattenLeaves(cond).map(l => l.leafId);
  check('leafId: stable across runs', ids1, ids2);
  check('leafId: duplicate metric+operator numbered', ids1, ['rsi14__>=__0', 'rsi14__>=__1', 'priceToMa20Pct__between__0']);

  const explicit: ConditionNode = { all: [{ metric: 'rsi14', operator: '>=', value: 70, id: 'custom-id' }] };
  check('leafId: explicit id wins', flattenLeaves(explicit).map(l => l.leafId), ['custom-id']);
}

// ── ⑤ buildReplayTimeline 동작 ────────────────────────────────────────────────
{
  const tl = buildReplayTimeline({
    ticker: 'TST', name: 'TST', history: makeHistory(300),
    guruRules, claims, alertRules, now: NOW, windowTradingDays: 120,
  });
  checkTrue('timeline: days produced', tl.days.length > 0);
  checkTrue('timeline: chartPoints cover series', tl.chartPoints.length >= tl.days.length);
  checkTrue('timeline: each day has diagnostics', tl.days.every(d => Array.isArray(d.guruDiagnostics) && Array.isArray(d.alertDiagnostics)));
  // 마커/신호일은 구루 기준 — 알림-only 날짜가 신호 발생일로 잡히면 안 됨.
  checkTrue('timeline: markers are guru-gated (guruCount>0)', tl.markers.every(m => m.guruCount > 0));
  checkTrue('timeline: signalDates all backed by a guru marker', tl.signalDates.every(d => tl.markers.some(m => m.date === d && m.guruCount > 0)));
}

// ── ⑥ 신호 사용자 판정 저장(replayVerdicts) ──────────────────────────────────
{
  const t = '2026-01-05T00:00:00Z';
  const v = (ticker: string, date: string, kind: SignalVerdict['kind'], ruleId?: string, memo?: string): SignalVerdict =>
    ({ ticker, date, ruleId, kind, memo, createdAt: t });

  // 키: ruleId 유무로 구분
  check('verdictKey: day-level', verdictKey('SLV', '2026-01-05'), 'SLV::2026-01-05::');
  check('verdictKey: rule-scoped', verdictKey('SLV', '2026-01-05', 'r-overheat'), 'SLV::2026-01-05::r-overheat');
  checkTrue('verdictKey: day vs rule differ', verdictKey('SLV', '2026-01-05') !== verdictKey('SLV', '2026-01-05', 'r1'));

  checkTrue('isVerdictKind: valid', isVerdictKind('missed-buy'));
  checkTrue('isVerdictKind: invalid', !isVerdictKind('maybe'));

  // upsert: 생성 → 같은 키 수정(교체, 개수 불변) → ruleId 다르면 별도 추가
  let list: SignalVerdict[] = [];
  list = upsertVerdict(list, v('SLV', '2026-01-05', 'good'));
  check('verdict upsert: created', list.length, 1);
  list = upsertVerdict(list, v('SLV', '2026-01-05', 'too-late', undefined, '늦음'));
  check('verdict upsert: same key replaces (count)', list.length, 1);
  check('verdict upsert: kind updated', findVerdict(list, 'SLV', '2026-01-05')?.kind, 'too-late');
  check('verdict upsert: memo updated', findVerdict(list, 'SLV', '2026-01-05')?.memo, '늦음');
  list = upsertVerdict(list, v('SLV', '2026-01-05', 'false', 'r-overheat'));
  check('verdict upsert: rule-scoped is separate', list.length, 2);

  // 놓친 매수/매도 — 신호 없는(미발화) 날에도 태깅 가능 = 단지 새 날짜의 판정
  list = upsertVerdict(list, v('SLV', '2026-02-10', 'missed-buy'));
  check('verdict: false-negative tag on non-signal day', findVerdict(list, 'SLV', '2026-02-10')?.kind, 'missed-buy');

  // 비파괴 — upsert 가 원본 배열을 변형하지 않음
  const before = list.slice();
  upsertVerdict(list, v('SLV', '2026-03-01', 'good'));
  check('verdict upsert: non-destructive', list.length, before.length);

  // 조회/필터/날짜집합
  check('verdictsForTicker: count', verdictsForTicker(list, 'SLV').length, 3);
  check('verdictsForTicker: other ticker empty', verdictsForTicker(list, 'GLD').length, 0);
  check('datesWithVerdict: set', [...datesWithVerdict(list, 'SLV')].sort(), ['2026-01-05', '2026-02-10']);

  // 삭제: day-level 만 제거 → rule-scoped 는 남음
  const afterDel = removeVerdict(list, 'SLV', '2026-01-05');
  check('verdict remove: day-level gone', findVerdict(afterDel, 'SLV', '2026-01-05'), undefined);
  check('verdict remove: rule-scoped remains', findVerdict(afterDel, 'SLV', '2026-01-05', 'r-overheat')?.kind, 'false');

  // 직렬화 라운드트립 + 안전 파싱
  check('verdict roundtrip', parseVerdicts(serializeVerdicts(list)).length, list.length);
  check('parseVerdicts: garbage → []', parseVerdicts('not json'), []);
  check('parseVerdicts: null → []', parseVerdicts(null), []);
  check('parseVerdicts: drops invalid kind', parseVerdicts(JSON.stringify([{ ticker: 'X', date: '2026-01-01', kind: 'bogus' }])), []);
}

// ── ⑦ 검증 사례 저장/diff(replayCases) ───────────────────────────────────────
{
  // 최소 ReplayDay/RuleDiagnostic fixture — collectPerRuleResults 는 date+guruDiagnostics 만 참조.
  const mkDiag = (ruleId: string, action: RuleDiagnostic['action'], eligible: boolean, evaluation: RuleDiagnostic['evaluation']): RuleDiagnostic =>
    ({ ruleId, ruleTitle: ruleId, action, eligibility: { eligible, reasons: [] }, evaluation, coverage: [], leaves: [] });
  const mkDay = (date: string, diags: RuleDiagnostic[], ret20: number | null = null): ReplayDay =>
    ({ date, close: 100, previousClose: 99, changePct: 1, enriched: {}, guruDiagnostics: diags, alertDiagnostics: [],
       guruLeafDistances: {}, outcome: { ret5: null, ret20, ret60: null, maxRise: null, maxDrop: null } } as unknown as ReplayDay);

  const days: ReplayDay[] = [
    mkDay('2026-01-02', [mkDiag('r-buy', 'buy-watch', true, 'matched')], 5),
    mkDay('2026-01-03', [mkDiag('r-buy', 'buy-watch', false, 'matched'), mkDiag('r-sell', 'sell-warning', true, 'unmatched')]), // eligible=false → 제외
    mkDay('2026-01-06', [mkDiag('r-sell', 'sell-warning', true, 'matched')], 10),
    mkDay('2026-01-07', [mkDiag('r-buy', 'buy-watch', true, 'matched')], -2),
  ];

  // collectPerRuleResults: eligible&&matched 만, 규칙별 날짜 정렬
  const per = collectPerRuleResults(days);
  check('collect: rule count', per.length, 2);
  const buy = per.find(p => p.ruleId === 'r-buy');
  check('collect: r-buy dates (eligible&&matched only)', buy?.signalDates, ['2026-01-02', '2026-01-07']);
  check('collect: r-buy action', buy?.action, 'buy-watch');
  check('collect: r-sell dates', per.find(p => p.ruleId === 'r-sell')?.signalDates, ['2026-01-06']);

  // 타임라인 fixture(signalDates = 구루 마커일) → resultMetrics
  const timeline: ReplayTimeline = {
    ticker: 'SLV', name: 'iShares Silver', days,
    chartPoints: [], markers: [],
    signalDates: ['2026-01-02', '2026-01-06', '2026-01-07'],
  };
  const metrics = computeResultMetrics(timeline);
  check('resultMetrics: signalCount', metrics.signalCount, 3);
  // 신호일 ret20: 5, 10, -2 → 평균 4.333…
  checkTrue('resultMetrics: avgRet20 ≈ 4.33', Math.abs((metrics.avgRet20 ?? 0) - (13 / 3)) < 1e-9);

  // ruleSnapshot + rulesetHash — signal 규칙만, 해시는 hashRuleset 과 동일
  const snap = buildRuleSnapshot(guruRules);
  check('ruleSnapshot: signal rules only', snap.length, 2);
  checkTrue('ruleSnapshot: has conditionJson', snap.every(s => s.conditionJson.length > 0 && s.leafIds.length > 0));

  // buildVerificationCase — id/createdAt 주입, overridesSnapshot 그대로, 해시 일치
  // 판정은 윈도 기간(timeline.days) 안의 날짜만 저장 — 기간 밖(2025-12-01)·규칙별(in-window)·in-window 혼재 입력.
  const c = buildVerificationCase({
    id: 'case-1', createdAt: '2026-06-26T00:00:00Z',
    ticker: 'SLV', name: 'iShares Silver', exchange: 'ARCA', categoryId: 2,
    caseRole: 'holdout', anchorDate: '2026-01-07', windowTradingDays: 252,
    effectiveRules: guruRules, overridesSnapshot: [], timeline,
    verdicts: [
      { ticker: 'SLV', date: '2026-01-02', kind: 'good', createdAt: '2026-06-26T00:00:00Z' },             // in-window
      { ticker: 'SLV', date: '2026-01-06', ruleId: 'r-sell', kind: 'too-late', createdAt: '2026-06-26T00:00:00Z' }, // in-window, 규칙별
      { ticker: 'SLV', date: '2025-12-01', kind: 'good', createdAt: '2026-06-26T00:00:00Z' },             // 기간 밖 → 제외
      { ticker: 'GLD', date: '2026-01-02', kind: 'good', createdAt: '2026-06-26T00:00:00Z' },             // 다른 종목 → 제외
    ],
    memo: '은 바닥 검증',
  });
  check('case: id preserved', c.id, 'case-1');
  check('case: caseRole', c.caseRole, 'holdout');
  check('case: overridesSnapshot empty (P2)', c.overridesSnapshot, []);
  check('case: rulesetHash == hashRuleset', c.rulesetHash, hashRuleset(guruRules));
  check('case: perRuleResults captured', c.perRuleResults.length, 2);
  check('case: out-of-window / other-ticker verdict dropped', c.verdicts.length, 2);
  check('case: only in-window same-ticker dates', c.verdicts.map(v => v.date).sort(), ['2026-01-02', '2026-01-06']);
  checkTrue('case: all verdicts match case ticker', c.verdicts.every(v => v.ticker === 'SLV'));
  checkTrue('case: rule-scoped verdict kept', c.verdicts.some(v => v.ruleId === 'r-sell' && v.kind === 'too-late'));

  // diffSignalDates
  check('diffSignalDates: added', diffSignalDates(['a', 'b'], ['a', 'b', 'c']).added, ['c']);
  check('diffSignalDates: removed', diffSignalDates(['a', 'b'], ['b']).removed, ['a']);
  check('diffSignalDates: identical → empty', diffSignalDates(['a'], ['a']), { added: [], removed: [] });

  // diffCaseResults — 규칙별 added/removed + 전체, 변화 없는 규칙은 perRule 에서 제외
  const prev = collectPerRuleResults(days);
  const nextDays = days.slice(0, 3); // 2026-01-07 r-buy 발화 제거됨
  const diff = diffCaseResults(prev, collectPerRuleResults(nextDays));
  check('diffCase: overall removed', diff.overall.removed, ['2026-01-07']);
  check('diffCase: overall added empty', diff.overall.added, []);
  check('diffCase: perRule only changed rules', diff.perRule.map(r => r.ruleId), ['r-buy']);
  check('diffCase: r-buy removed', diff.perRule[0].removed, ['2026-01-07']);
  check('diffCase: identical → no perRule', diffCaseResults(prev, prev).perRule, []);

  // 사례 목록 CRUD + 안전 파싱
  let cases = upsertCase([], c);
  check('upsertCase: created', cases.length, 1);
  const c2 = { ...c, id: 'case-2' };
  cases = upsertCase(cases, c2);
  check('upsertCase: newest first', cases[0].id, 'case-2');
  cases = upsertCase(cases, { ...c, memo: '수정됨' });
  check('upsertCase: same id replaces (count)', cases.length, 2);
  check('upsertCase: memo updated', cases.find(x => x.id === 'case-1')?.memo, '수정됨');
  cases = removeCase(cases, 'case-2');
  check('removeCase: deleted', cases.map(x => x.id), ['case-1']);
  check('parseCases: garbage → []', parseCases('{bad'), []);
  check('parseCases: drops missing fields', parseCases(JSON.stringify([{ id: 'x' }])), []);
}

// ── 결과 ─────────────────────────────────────────────────────────────────────
console.log(`\n신호 리플레이 테스트: ${pass} 통과, ${fails.length} 실패`);
if (fails.length) { fails.forEach(f => console.log('  ' + f)); process.exit(1); }
console.log('✓ 전부 통과');
