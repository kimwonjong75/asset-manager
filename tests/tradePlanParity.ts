// tests/tradePlanParity.ts
// ---------------------------------------------------------------------------
// 매매 계획(TradePlan) 골든 테스트 — 명시적 절대값만 고정한다(경로A-vs-경로B 비교 금지).
//   · 스크린샷 사례(총자산 10억·1%·손절 7%·SLV $59.07·환율 1,370.53): 1,764주·손절 54.9351·익절 71.4747·
//     투자 142,808,513원(≈142,808,516)·최악손실 −9,996,596원(≈1.0%)
//   · 연구 엔진(sellRuleEngine) 수식 교차 골든: stop=p(1−s), tp=p(1+s·m), 불타기 pct/r 트리거, 손절 상향
//   · 평가: 우선순위(손절>익절>불타기>추세선)·3등급·판정불가·stale·장중 추세선 보류·재돌파 후 적용
//   · 불타기 4중 검사(물타기 금지·손절 하향 금지·1% 총손실·2×투입/25% 비중) + 수량 캡 골든
//   · 통화(CNY null)·일괄 대상·결정 기록 상한·카톡 문구 200자·불변성
// 수동 실행: npm run test:tradeplan (tsx). 통과 시 exit 0.

import { Currency, type Asset } from '../types';
import { DEFAULT_CATEGORIES } from '../types/category';
import type { TradePlan, TradePlanBuildInput, TradePlanMarket, TradePlanEvaluation } from '../types/tradePlan';
import { DEFAULT_TRADE_PLAN_TEMPLATE, PLAN_DECISION_MAX } from '../types/tradePlan';
import {
  buildTradePlan,
  evaluateTradePlan,
  applyHalfSell,
  applyPyramidFill,
  recordDecision,
  consecutiveTomorrowCount,
  armExitLine,
  closePlan,
  cancelPlan,
  computeExitLineValue,
  isEligibleForBulkPlan,
  formatKakaoText,
  formatKakaoDigest,
  formatPlanPrice,
  pyramidTriggerPrice,
  stopAfterPyramid,
  takeProfitPriceFor,
  capPyramidQuantity,
  nextPyramidStep,
  KAKAO_TEXT_MAX,
} from '../utils/tradePlan';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function checkClose(name: string, actual: number | null, expected: number, eps = 1e-6): void {
  if (actual !== null && Math.abs(actual - expected) <= eps) pass++;
  else fails.push(`✗ ${name}: got ${actual}, expected ${expected} (±${eps})`);
}
function checkTrue(name: string, cond: boolean): void {
  if (cond) pass++;
  else fails.push(`✗ ${name}: expected true`);
}

const NOW = '2026-09-03T05:20:00.000Z';
const TODAY = '2026-09-03';

function baseInput(over: Partial<TradePlanBuildInput> = {}): TradePlanBuildInput {
  return {
    mode: 'holding',
    anchor: 'today',
    anchorPrice: 10_000,
    anchorDate: TODAY,
    currency: Currency.KRW,
    totalEquityKRW: 100_000_000,
    riskPct: 1,
    stopPct: 7,
    profitMultiple: 3,
    exitLine: { kind: 'ma', period: 20 },
    pyramid: { ...DEFAULT_TRADE_PLAN_TEMPLATE.pyramid },
    holdingQuantity: 100,
    fxRateToKRW: 1,
    now: NOW,
    ...over,
  };
}
function mustBuild(over: Partial<TradePlanBuildInput> = {}): TradePlan {
  const r = buildTradePlan(baseInput(over));
  if (!r.ok) throw new Error(`build failed: ${r.reason}`);
  return r.plan;
}
function mkMarket(over: Partial<TradePlanMarket> = {}): TradePlanMarket {
  return { price: 10_500, priceAsOf: TODAY, isIntraday: false, sessionDate: TODAY, ma: { 20: 10_200 }, maAsOf: TODAY, ...over };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. 스크린샷 골든 — SLV $59.07, 10억, 1%, 7%, 3배, 환율 1,370.53
// ════════════════════════════════════════════════════════════════════════════
{
  const r = buildTradePlan({
    mode: 'new-buy', anchor: 'today', anchorPrice: 59.07, anchorDate: '2026-09-02', currency: Currency.USD,
    totalEquityKRW: 1_000_000_000, riskPct: 1, stopPct: 7, profitMultiple: 3,
    exitLine: { kind: 'ma', period: 20 }, pyramid: { ...DEFAULT_TRADE_PLAN_TEMPLATE.pyramid },
    fxRateToKRW: 1370.53, now: NOW,
  });
  check('SLV build ok', r.ok, true);
  if (r.ok) {
    check('SLV 수량 1,764주', r.preview.quantity, 1764);
    checkClose('SLV 손절선 54.9351', r.plan.stopPrice, 54.9351, 1e-9);
    checkClose('SLV 익절선 71.4747', r.plan.takeProfitPrice, 71.4747, 1e-9);
    checkClose('SLV 투자금액 142,808,513원(코드 골든)', r.preview.investmentKRW, 142_808_513.3, 1);
    checkTrue('SLV 투자금액 ≈ 스크린샷 142,808,516 (0.02% 이내)',
      Math.abs((r.preview.investmentKRW as number) - 142_808_516) / 142_808_516 < 0.0002);
    checkClose('SLV 최악손실 −9,996,596원', r.preview.worstLossKRW, -9_996_595.9, 1);
    checkTrue('SLV 최악손실 ≈ 총자산 1.0%', Math.abs((r.preview.worstLossPct as number) + 0.99966) < 0.001);
    checkClose('SLV 허용손실 1,000만원', r.preview.riskAmountKRW, 10_000_000);
    check('SLV 총자산 캡 아님', r.preview.capped, false);
    check('SLV 리스크 예산 초과 아님', r.preview.exceedsRiskBudget, false);
    checkTrue('SLV 갭 손실이 최악손실보다 큼', (r.preview.adverseLossKRW as number) < (r.preview.worstLossKRW as number));
    checkClose('SLV 갭 손실 골든(−1764×(59.07−54.9351×0.97)×1370.53)',
      r.preview.adverseLossKRW, -1764 * (59.07 - 54.9351 * 0.97) * 1370.53, 1);
    check('SLV 불타기 안 함 → steps 0', r.plan.pyramid.steps.length, 0);
    check('SLV 모드/기준/통화', [r.plan.mode, r.plan.anchor, r.plan.currency], ['new-buy', 'today', 'USD']);
    check('SLV status active·decisions 빈 배열', [r.plan.status, r.plan.decisions.length], ['active', 0]);
    check('SLV brokerStopOrderRegistered 기본 false', r.plan.brokerStopOrderRegistered, false);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 연구 엔진 수식 교차 골든
// ════════════════════════════════════════════════════════════════════════════
checkClose('tp = p(1+s·m): 100·(1+0.07·3)=121', takeProfitPriceFor(100, 7, 3), 121);
check('tp null when multiple null', takeProfitPriceFor(100, 7, null), null);
checkClose('pct 트리거 k=1: 100·1.1', pyramidTriggerPrice(100, 93, 'pct', 10, 1), 110);
checkClose('pct 트리거 k=3: 100·1.1³=133.1', pyramidTriggerPrice(100, 93, 'pct', 10, 3), 133.1);
checkClose('r 트리거 k=1: 100+2·7=114', pyramidTriggerPrice(100, 93, 'r', 2, 1), 114);
checkClose('r 트리거 k=2: 100+4·7=128', pyramidTriggerPrice(100, 93, 'r', 2, 2), 128);
checkClose('불타기 후 손절 = max(93, 110·0.93, 100) = 102.3', stopAfterPyramid(93, 110, 7, 100), 102.3);
checkClose('불타기 후 손절 — 기존이 더 높으면 유지', stopAfterPyramid(105, 110, 7, 100), 105);
checkClose('불타기 후 손절 — 최소 본전', stopAfterPyramid(80, 101, 7, 100), 100);

// ════════════════════════════════════════════════════════════════════════════
// 3. 생성 검증·모드·통화
// ════════════════════════════════════════════════════════════════════════════
check('invalid-anchor', buildTradePlan(baseInput({ anchorPrice: 0 })), { ok: false, reason: 'invalid-anchor' });
check('invalid-equity', buildTradePlan(baseInput({ totalEquityKRW: 0 })), { ok: false, reason: 'invalid-equity' });
check('invalid-risk 0', buildTradePlan(baseInput({ riskPct: 0 })), { ok: false, reason: 'invalid-risk' });
check('invalid-risk 101', buildTradePlan(baseInput({ riskPct: 101 })), { ok: false, reason: 'invalid-risk' });
check('invalid-stop pct 0', buildTradePlan(baseInput({ stopPct: 0 })), { ok: false, reason: 'invalid-stop' });
check('invalid-stop pct 100', buildTradePlan(baseInput({ stopPct: 100 })), { ok: false, reason: 'invalid-stop' });
check('invalid-stop price ≥ anchor', buildTradePlan(baseInput({ stopPrice: 10_000 })), { ok: false, reason: 'invalid-stop' });
check('invalid-quantity holding 0', buildTradePlan(baseInput({ holdingQuantity: 0 })), { ok: false, reason: 'invalid-quantity' });
check('unsupported-currency new-buy fx null', buildTradePlan(baseInput({ mode: 'new-buy', currency: Currency.CNY, fxRateToKRW: null })), { ok: false, reason: 'unsupported-currency' });
{
  const r = buildTradePlan(baseInput({ currency: Currency.CNY, fxRateToKRW: null, holdingQuantity: 10 }));
  check('holding fx null → ok', r.ok, true);
  if (r.ok) {
    check('holding fx null → KRW 금액 전부 null', [r.preview.investmentKRW, r.preview.worstLossKRW, r.preview.worstLossPct, r.preview.adverseLossKRW], [null, null, null, null]);
    check('holding fx null → exceedsRiskBudget false', r.preview.exceedsRiskBudget, false);
    checkClose('holding fx null → 손절선은 원통화로 계산', r.plan.stopPrice, 9_300);
  }
}
{
  const p = mustBuild({ stopPrice: 9_200 });
  checkClose('stopPrice 직접 입력 → pct 역산 8%', p.stopPct, 8);
  checkClose('stopPrice 직접 입력 → 손절선 9,200', p.stopPrice, 9_200);
  checkClose('익절선 = 10,000·(1+0.08·3) = 12,400', p.takeProfitPrice, 12_400);
}
{
  const r = buildTradePlan(baseInput({ holdingQuantity: 100, totalEquityKRW: 5_000_000 }));
  check('holding: 손절손실 70,000 > 허용 50,000 → exceedsRiskBudget', r.ok && r.preview.exceedsRiskBudget, true);
  if (r.ok) checkClose('holding 최악손실 −70,000', r.preview.worstLossKRW, -70_000);
}
check('armMode 기본: 기준가 < 추세선 → after-reclaim', mustBuild({ currentExitLineValue: 10_500 }).exitLineArmMode, 'after-reclaim');
check('armMode 기본: 기준가 ≥ 추세선 → immediate', mustBuild({ currentExitLineValue: 9_500 }).exitLineArmMode, 'immediate');
check('armMode 기본: 추세선 값 없음 → immediate', mustBuild({ currentExitLineValue: null }).exitLineArmMode, 'immediate');
check('armMode 명시 우선', mustBuild({ currentExitLineValue: 10_500, exitLineArmMode: 'immediate' }).exitLineArmMode, 'immediate');
check('profitMultiple null → 익절선 null', mustBuild({ profitMultiple: null }).takeProfitPrice, null);
check('brokerStopOrderRegistered 전달', mustBuild({ brokerStopOrderRegistered: true }).brokerStopOrderRegistered, true);

// ════════════════════════════════════════════════════════════════════════════
// 4. 불타기 단계 사전 계산 — 캡 골든
// ════════════════════════════════════════════════════════════════════════════
{
  // 'same' 사이징은 +10%에서 2×투입 상한에 걸린다: 잔여 1,000,000/11,000 = 90.9 → 90
  const p = mustBuild({ pyramid: { enabled: true, stepUnit: 'pct', step: 10, sizing: 'same', maxAdds: 1 } });
  check('same 1차 트리거 11,000', p.pyramid.steps[0].triggerPrice, 11_000);
  check('same 1차 수량 = 2×투입 캡 90', p.pyramid.steps[0].plannedQuantity, 90);
}
{
  // 리스크 캡: riskPct 0.1 (허용 10,000) → room (10,000+23,000)/770 = 42.8 → 42
  const p = mustBuild({ totalEquityKRW: 10_000_000, riskPct: 0.1, pyramid: { enabled: true, stepUnit: 'pct', step: 10, sizing: 'same', maxAdds: 1 } });
  check('1% 불변식 캡 → 42', p.pyramid.steps[0].plannedQuantity, 42);
}
{
  // 비중 캡: 총자산 5,000,000 → 25% = 1,250,000, 보유 1,000,000 → 250,000/11,000 = 22.7 → 22
  const p = mustBuild({ totalEquityKRW: 5_000_000, pyramid: { enabled: true, stepUnit: 'pct', step: 10, sizing: 'same', maxAdds: 1 } });
  check('25% 비중 캡 → 22', p.pyramid.steps[0].plannedQuantity, 22);
}
{
  // r 단위: R=700 → 11,400 / 12,800 / 14,200
  const p = mustBuild({ pyramid: { enabled: true, stepUnit: 'r', step: 2, sizing: 'half', maxAdds: 3 } });
  check('r 트리거 3단계', p.pyramid.steps.map(s => s.triggerPrice), [11_400, 12_800, 14_200]);
  check('half 사이징 수량 50/25 · 3차는 2×투입 캡(110,000/14,200=7.7→7)', p.pyramid.steps.map(s => s.plannedQuantity), [50, 25, 7]);
}
{
  // SLV + 불타기(pct 10, half, 3) — 2차는 25% 비중 캡(292), 3차는 비중 한도 소진(0)
  const r = buildTradePlan({
    mode: 'new-buy', anchor: 'today', anchorPrice: 59.07, anchorDate: '2026-09-02', currency: Currency.USD,
    totalEquityKRW: 1_000_000_000, riskPct: 1, stopPct: 7, profitMultiple: 3, exitLine: { kind: 'ma', period: 20 },
    pyramid: { enabled: true, stepUnit: 'pct', step: 10, sizing: 'half', maxAdds: 3 }, fxRateToKRW: 1370.53, now: NOW,
  });
  check('SLV 불타기 수량 882/292/0', r.ok ? r.plan.pyramid.steps.map(s => s.plannedQuantity) : null, [882, 292, 0]);
  if (r.ok) checkClose('SLV 2차 트리거 71.4747', r.plan.pyramid.steps[1].triggerPrice, 71.4747, 1e-9);
}
check('capPyramidQuantity: desired 0 → 0', capPyramidQuantity({
  anchorPrice: 100, stopPct: 7, currentStop: 93, riskAmountKRW: 1e6, totalEquityKRW: 1e8, fxRateToKRW: 1,
  held: [{ price: 100, quantity: 10 }], costSoFar: 1000, originalCost: 1000, triggerPrice: 110, desiredQuantity: 0, allowFractional: false,
}), 0);
check('capPyramidQuantity: fx null → 원통화 2×투입 캡만 (1000/110=9.09→9)', capPyramidQuantity({
  anchorPrice: 100, stopPct: 7, currentStop: 93, riskAmountKRW: 1, totalEquityKRW: 1, fxRateToKRW: null,
  held: [{ price: 100, quantity: 10 }], costSoFar: 1000, originalCost: 1000, triggerPrice: 110, desiredQuantity: 100, allowFractional: false,
}), 9);

// ════════════════════════════════════════════════════════════════════════════
// 5. 평가 — 우선순위·3등급·fail-closed
// ════════════════════════════════════════════════════════════════════════════
const P = mustBuild(); // 손절 9,300 · 익절 12,100 · MA20 · immediate · 불타기 없음
const PY = mustBuild({ pyramid: { enabled: true, stepUnit: 'pct', step: 10, sizing: 'half', maxAdds: 3 } }); // 1차 11,000
const sig = (plan: TradePlan, m: Partial<TradePlanMarket>): [string, string, string] => {
  const e = evaluateTradePlan(plan, mkMarket(m));
  return [e.signal, e.tier, e.action];
};
check('손절선 도달 → 긴급·전량', sig(P, { price: 9_300 }), ['stop-hit', 'urgent', 'sell-all']);
check('손절선 아래 → 긴급·전량', sig(P, { price: 9_000 }), ['stop-hit', 'urgent', 'sell-all']);
check('손절선 근접(9,400=+1.08%, 추세선 위) → 준비·확인', sig(P, { price: 9_400, ma: { 20: 9_000 } }), ['near-stop', 'prepare', 'check']);
check('손절선 근접이어도 추세선 이탈(확정)이면 긴급', sig(P, { price: 9_400 }), ['exit-line-hit', 'urgent', 'sell-all']);
check('익절선 도달 → 오늘 실행·절반', sig(P, { price: 12_100, ma: { 20: 11_000 } }), ['take-profit-hit', 'today', 'sell-half']);
check('대기(선 위) → waiting', sig(P, { price: 10_500 }), ['waiting', 'none', 'wait']);
check('가격 null → 판정 불가', sig(P, { price: null }), ['unavailable', 'none', 'check']);
check('추세선 이탈(확정 종가) → 긴급·전량', sig(P, { price: 10_100, ma: { 20: 10_200 }, isIntraday: false }), ['exit-line-hit', 'urgent', 'sell-all']);
check('추세선 아래(장중) → 준비·종가 확인', sig(P, { price: 10_100, ma: { 20: 10_200 }, isIntraday: true }), ['exit-line-watch', 'prepare', 'check']);
check('추세선 값 없음 → 선 unavailable, 신호 waiting', (() => {
  const e = evaluateTradePlan(P, mkMarket({ ma: {} }));
  return [e.signal, e.lines.find(l => l.key === 'exitLine')?.state];
})(), ['waiting', 'unavailable']);
check('우선순위: 손절 > 익절(가격이 둘 다 충족 불가하므로 손절 아래 값)', sig(P, { price: 9_299, ma: { 20: 9_000 } }), ['stop-hit', 'urgent', 'sell-all']);
check('우선순위: 익절 > 불타기(12,100 ≥ 11,000)', sig(PY, { price: 12_100, ma: { 20: 11_000 } }), ['take-profit-hit', 'today', 'sell-half']);
check('불타기선 도달 → 준비·추가매수', sig(PY, { price: 11_000, ma: { 20: 10_200 } }), ['pyramid-hit', 'prepare', 'buy-add']);
check('불타기선 근접(10,800=−1.8%) → 준비', sig(PY, { price: 10_800, ma: { 20: 10_200 } }), ['near-pyramid', 'prepare', 'wait']);
check('우선순위: 불타기 > 추세선(11,000 도달인데 추세선 아래)', sig(PY, { price: 11_000, ma: { 20: 11_500 }, isIntraday: false }), ['pyramid-hit', 'prepare', 'buy-add']);
check('stale: 익절 가격이어도 익절 미발화', sig(P, { price: 12_100, priceAsOf: '2026-09-02', sessionDate: TODAY }), ['stale', 'none', 'check']);
check('stale: 불타기 미발화', sig(PY, { price: 11_000, priceAsOf: '2026-09-02', sessionDate: TODAY }), ['stale', 'none', 'check']);
check('stale: 손절 아래는 긴급이되 확인 액션', sig(P, { price: 9_000, priceAsOf: '2026-09-02', sessionDate: TODAY }), ['stop-hit', 'urgent', 'check']);
{
  const half = applyHalfSell(P, { date: TODAY, price: 12_100, quantity: 50 });
  check('halfSold → 익절선 비활성(done), 12,500에서도 익절 없음', sig(half, { price: 12_500, ma: { 20: 11_000 } }), ['waiting', 'none', 'wait']);
  check('halfSold 선 상태 done', evaluateTradePlan(half, mkMarket({ price: 12_500 })).lines.find(l => l.key === 'takeProfit')?.state, 'done');
}
check('익절 없음 → 익절선 inactive', evaluateTradePlan(mustBuild({ profitMultiple: null }), mkMarket()).lines.find(l => l.key === 'takeProfit')?.state, 'inactive');
check('종료된 계획 → none', sig(closePlan(P, 'manual', TODAY), { price: 9_000 }), ['waiting', 'none', 'none']);
{
  const e = evaluateTradePlan(P, mkMarket({ price: 9_500 }));
  checkClose('distanceToStopPct 9,500 vs 9,300 = 2.15%', e.distanceToStopPct, (200 / 9_300) * 100, 1e-9);
  check('stale 플래그 false', e.stale, false);
  check('lines 4개·라벨', e.lines.map(l => l.label), ['손절선', '익절선', '추세선', '불타기선']);
  check('불타기 없음 → 불타기선 inactive', e.lines[3].state, 'inactive');
}

// 재돌파 후 적용(after-reclaim)
{
  const AR = mustBuild({ currentExitLineValue: 10_500 }); // 기준가 10,000 < 추세선 → after-reclaim
  check('after-reclaim & 선 아래(확정) → already-below-exit·wait', sig(AR, { price: 10_100, ma: { 20: 10_500 }, isIntraday: false }), ['already-below-exit', 'none', 'wait']);
  check('after-reclaim & 선 위(확정) → arm-exit 제안', sig(AR, { price: 10_700, ma: { 20: 10_500 }, isIntraday: false }), ['waiting', 'prepare', 'arm-exit']);
  check('after-reclaim & 선 위(장중) → 아직 제안 없음', sig(AR, { price: 10_700, ma: { 20: 10_500 }, isIntraday: true }), ['waiting', 'none', 'wait']);
  check('after-reclaim 선 상태 disarmed', evaluateTradePlan(AR, mkMarket({ price: 10_100, ma: { 20: 10_500 } })).lines.find(l => l.key === 'exitLine')?.state, 'disarmed');
  const armed = armExitLine(AR, TODAY);
  check('armExitLine 저장', armed.exitLineArmedAt, TODAY);
  check('무장 후 선 아래(확정) → 긴급 이탈', sig(armed, { price: 10_100, ma: { 20: 10_500 }, isIntraday: false }), ['exit-line-hit', 'urgent', 'sell-all']);
  check('무장 후에도 손절이 우선', sig(armed, { price: 9_000, ma: { 20: 10_500 }, isIntraday: false }), ['stop-hit', 'urgent', 'sell-all']);
}
// 직접 가격 추세선
{
  const PP = mustBuild({ exitLine: { kind: 'price', price: 9_800 } });
  check('직접 가격 추세선 이탈', sig(PP, { price: 9_700, ma: {}, isIntraday: false }), ['exit-line-hit', 'urgent', 'sell-all']);
  check('직접 가격 추세선 값', evaluateTradePlan(PP, mkMarket({ ma: {} })).lines.find(l => l.key === 'exitLine')?.price, 9_800);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 불타기 체결 4중 검사
// ════════════════════════════════════════════════════════════════════════════
{
  const fx = { fxRateToKRW: 1 };
  check('pyramid-disabled', applyPyramidFill(P, { date: TODAY, price: 11_000, quantity: 10 }, fx), { ok: false, reason: 'pyramid-disabled' });
  check('물타기 금지(9,900 < 기준가)', applyPyramidFill(PY, { date: TODAY, price: 9_900, quantity: 10 }, fx), { ok: false, reason: 'price-not-above-last-fill' });
  const r1 = applyPyramidFill(PY, { date: TODAY, price: 11_000, quantity: 50 }, fx);
  check('1차 체결 ok', r1.ok, true);
  if (r1.ok) {
    checkClose('1차 후 손절선 10,230', r1.plan.stopPrice, 10_230);
    check('1차 fill 기록', r1.plan.pyramid.steps[0].fill, { date: TODAY, price: 11_000, quantity: 50 });
    check('다음 단계 2차', nextPyramidStep(r1.plan)?.level, 2);
    check('2차 체결가가 1차보다 낮으면 거부', applyPyramidFill(r1.plan, { date: TODAY, price: 10_900, quantity: 10 }, fx), { ok: false, reason: 'price-not-above-last-fill' });
    const r2 = applyPyramidFill(r1.plan, { date: TODAY, price: 12_100, quantity: 25 }, fx);
    check('2차 체결 ok', r2.ok, true);
    if (r2.ok) {
      checkClose('2차 후 손절선 11,253', r2.plan.stopPrice, 11_253);
      checkTrue('손절선은 내려가지 않음', r2.plan.stopPrice >= r1.plan.stopPrice);
    }
  }
  check('2×투입 초과(100주×11,000=1,100,000 > 잔여 1,000,000)', applyPyramidFill(PY, { date: TODAY, price: 11_000, quantity: 100 }, fx), { ok: false, reason: 'cost-cap-exceeded' });
  const tight = mustBuild({ totalEquityKRW: 1_000_000, riskPct: 1, pyramid: { enabled: true, stepUnit: 'pct', step: 10, sizing: 'half', maxAdds: 3 } });
  check('1% 총손실 초과(15,500 > 10,000)', applyPyramidFill(tight, { date: TODAY, price: 11_000, quantity: 50 }, fx), { ok: false, reason: 'risk-budget-exceeded' });
  const capped = mustBuild({ totalEquityKRW: 4_000_000, riskPct: 5, pyramid: { enabled: true, stepUnit: 'pct', step: 10, sizing: 'half', maxAdds: 3 } });
  check('25% 비중 초과(1,550,000 > 1,000,000)', applyPyramidFill(capped, { date: TODAY, price: 11_000, quantity: 50 }, fx), { ok: false, reason: 'position-cap-exceeded' });
  const one = mustBuild({ pyramid: { enabled: true, stepUnit: 'pct', step: 10, sizing: 'half', maxAdds: 1 } });
  const f1 = applyPyramidFill(one, { date: TODAY, price: 11_000, quantity: 50 }, fx);
  check('maxAdds 1 소진 후 no-step', f1.ok ? applyPyramidFill(f1.plan, { date: TODAY, price: 12_000, quantity: 5 }, fx) : null, { ok: false, reason: 'no-step' });
  check('fx null → 2×투입 검사만(50주 ok)', applyPyramidFill(mustBuild({ currency: Currency.CNY, fxRateToKRW: null, pyramid: { enabled: true, stepUnit: 'pct', step: 10, sizing: 'half', maxAdds: 1 } }), { date: TODAY, price: 11_000, quantity: 50 }, { fxRateToKRW: null }).ok, true);
}

// ════════════════════════════════════════════════════════════════════════════
// 7. 추세선 값·결정 기록·종료·불변성
// ════════════════════════════════════════════════════════════════════════════
{
  const closes = Array.from({ length: 25 }, (_, i) => i + 1); // 1..25
  checkClose('MA20 of 6..25 = 15.5', computeExitLineValue(closes, { kind: 'ma', period: 20 }), 15.5);
  check('MA50 데이터 부족 → null', computeExitLineValue(closes, { kind: 'ma', period: 50 }), null);
  checkClose('MA10 of 16..25 = 20.5', computeExitLineValue(closes, { kind: 'ma', period: 10 }), 20.5);
  check('직접 가격 → 그대로', computeExitLineValue(closes, { kind: 'price', price: 123 }), 123);
  checkClose('0/NaN 종가는 제외', computeExitLineValue([0, NaN, ...closes], { kind: 'ma', period: 20 }), 15.5);
}
{
  let p = P;
  for (let i = 0; i < 35; i++) p = recordDecision(p, { date: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`, signal: 'near-stop', choice: i % 2 ? 'tomorrow' : 'skip', reason: `r${i}` });
  check('결정 기록 상한 30', p.decisions.length, PLAN_DECISION_MAX);
  check('최신 결정이 마지막', p.decisions[p.decisions.length - 1].reason, 'r34');
  check('원본 계획은 불변(decisions 0)', P.decisions.length, 0);
  const t = recordDecision(recordDecision(recordDecision(P, { date: '2026-09-01', signal: 'stop-hit', choice: 'tomorrow' }), { date: '2026-09-02', signal: 'stop-hit', choice: 'tomorrow' }), { date: '2026-09-03', signal: 'stop-hit', choice: 'tomorrow' });
  check('연속 미룸 3회', consecutiveTomorrowCount(t, 'stop-hit'), 3);
  check('다른 신호는 0', consecutiveTomorrowCount(t, 'take-profit-hit'), 0);
  const broken = recordDecision(t, { date: '2026-09-04', signal: 'stop-hit', choice: 'done' });
  check('실행 후 연속 미룸 0', consecutiveTomorrowCount(broken, 'stop-hit'), 0);
}
{
  const c = closePlan(P, 'stop', TODAY);
  check('closePlan', [c.status, c.closedReason, c.closedAt], ['closed', 'stop', TODAY]);
  check('cancelPlan = manual', cancelPlan(P, TODAY).closedReason, 'manual');
  check('원본 status 불변', P.status, 'active');
  const before = JSON.stringify(PY);
  applyPyramidFill(PY, { date: TODAY, price: 11_000, quantity: 50 }, { fxRateToKRW: 1 });
  applyHalfSell(PY, { date: TODAY, price: 12_100, quantity: 50 });
  evaluateTradePlan(PY, mkMarket({ price: 11_000 }));
  check('전이/평가 후 원본 불변', JSON.stringify(PY), before);
}

// ════════════════════════════════════════════════════════════════════════════
// 8. 일괄 계획 대상
// ════════════════════════════════════════════════════════════════════════════
{
  const cashId = DEFAULT_CATEGORIES.find(c => c.baseType === 'CASH')?.id ?? -1;
  const mk = (over: Partial<Asset> = {}): Asset => ({
    id: 'a', categoryId: 1, ticker: '000000', exchange: 'KRX', name: 'X', quantity: 10, purchasePrice: 100,
    purchaseDate: TODAY, currency: Currency.KRW, currentPrice: 110, priceOriginal: 110, highestPrice: 120, bucket: 'SATELLITE', ...over,
  });
  check('SATELLITE 보유 → 대상', isEligibleForBulkPlan(mk()), true);
  check('CORE → 제외', isEligibleForBulkPlan(mk({ bucket: 'CORE' })), false);
  check('CORE + includeCore → 대상', isEligibleForBulkPlan(mk({ bucket: 'CORE' }), { includeCore: true }), true);
  check('유선 → 제외', isEligibleForBulkPlan(mk({ owner: 'YUSEON' })), false);
  check('현금 → 제외', isEligibleForBulkPlan(mk({ categoryId: cashId })), false);
  check('수량 0 → 제외', isEligibleForBulkPlan(mk({ quantity: 0 })), false);
  check('시세 없음 → 제외', isEligibleForBulkPlan(mk({ priceOriginal: 0 })), false);
  check('활성 계획 있음 → 제외', isEligibleForBulkPlan(mk({ tradePlan: P })), false);
  check('종료된 계획 → 대상', isEligibleForBulkPlan(mk({ tradePlan: closePlan(P, 'manual', TODAY) })), true);
}

// ════════════════════════════════════════════════════════════════════════════
// 9. 카톡 문구 — 200자 이내·핵심 단어
// ════════════════════════════════════════════════════════════════════════════
{
  const mkText = (plan: TradePlan, m: Partial<TradePlanMarket>, name = '풍산'): string => {
    const market = mkMarket(m);
    const ev: TradePlanEvaluation = evaluateTradePlan(plan, market);
    return formatKakaoText({ name, evaluation: ev, plan, price: market.price ?? 0, priceAsOf: market.priceAsOf, timeLabel: '14:00', isIntraday: market.isIntraday, quantity: 120 });
  };
  const cases: Array<[string, TradePlan, Partial<TradePlanMarket>, string]> = [
    ['손절', P, { price: 9_000, isIntraday: true }, '전량 매도'],
    ['익절', P, { price: 12_100, ma: { 20: 11_000 }, isIntraday: true }, '절반 매도'],
    ['추세 이탈', P, { price: 10_100, ma: { 20: 10_200 }, isIntraday: false }, '나머지 전량 매도'],
    ['추세 장중', P, { price: 10_100, ma: { 20: 10_200 }, isIntraday: true }, '종가로 확정'],
    ['불타기', PY, { price: 11_000, ma: { 20: 10_200 }, isIntraday: true }, '검증되지 않은'],
    ['손절 근접', P, { price: 9_400, ma: { 20: 9_000 }, isIntraday: true }, '예약주문'],
    ['stale', P, { price: 10_500, priceAsOf: '2026-09-02' }, '오래됨'],
    ['unavailable', P, { price: null }, '조회 실패'],
    ['arm', mustBuild({ currentExitLineValue: 10_500 }), { price: 10_700, ma: { 20: 10_500 }, isIntraday: false }, '적용 시작'],
  ];
  for (const [label, plan, m, kw] of cases) {
    const t = mkText(plan, m);
    checkTrue(`카톡 ${label} ≤ ${KAKAO_TEXT_MAX}자 (${t.length})`, t.length <= KAKAO_TEXT_MAX);
    checkTrue(`카톡 ${label} 핵심어 "${kw}"`, t.includes(kw));
  }
  const long = mkText(P, { price: 9_000, isIntraday: true }, '아주아주아주아주아주아주아주아주긴종목이름입니다');
  checkTrue('긴 종목명도 200자 이내', long.length <= KAKAO_TEXT_MAX);
  checkTrue('손절 문구에 계획 기준일', mkText(P, { price: 9_000, isIntraday: true }).includes('계획 09-03 기준'));
  const digest = formatKakaoDigest({ timeLabel: '15:40', urgent: 1, today: 1, prepare: 2, unavailable: 2, brokerStopMissing: 3, planless: 7 });
  checkTrue('요약 200자 이내', digest.length <= KAKAO_TEXT_MAX);
  checkTrue('요약 핵심 숫자', digest.includes('긴급 1') && digest.includes('손절주문 미등록 3') && digest.includes('투더문 7종'));
  check('formatPlanPrice KRW', formatPlanPrice(10_000, 'KRW'), '10,000원');
  check('formatPlanPrice USD', formatPlanPrice(59.07, 'USD'), '$59.07');
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ tradePlan parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ tradePlan parity 전체 통과 (${pass} 단언)`);
