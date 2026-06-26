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
import { applyRuleOverrides, mergeOverrides } from '../utils/ruleOverrides';
import { flattenLeaves } from '../utils/conditionLeafId';
import { EMPTY_VERIFICATION } from '../types/knowledge';
import type { KnowledgeRule, KnowledgeClaim, ConditionNode } from '../types/knowledge';
import type { AlertRule } from '../types/alertRules';
import type { RuleOverride } from '../types/signalReplay';
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

// ── 결과 ─────────────────────────────────────────────────────────────────────
console.log(`\n신호 리플레이 테스트: ${pass} 통과, ${fails.length} 실패`);
if (fails.length) { fails.forEach(f => console.log('  ' + f)); process.exit(1); }
console.log('✓ 전부 통과');
