// tests/tradePlanLinkParity.ts
// ---------------------------------------------------------------------------
// utils/tradePlanLink.ts 골든 테스트(P2b) — 명시적 절대값만 고정한다.
//   · defaultSellOutcome: 신호 → 기본 매도 효과(half/stop/exit/none). null=계획 없음 → none
//   · sellPrefillFor: half만 절반(정수 내림 / 암호화폐 1e-8 절사), 나머지 전량 · 가격 passthrough
//   · applySellOutcome: half=halfSold 기록 / stop·exit=closePlan(사유 구분) / none=같은 참조
//   · pyramidPrecheck: 통과 시 level·상향된 손절선, 실패 시 사유 + PYRAMID_FILL_ERROR_LABELS 문구
//   · decisionHelpText / DECISION_REASON_PRESETS: 문구 고정
//
// 불타기 픽스처 계산(손으로 검증한 값 — 회귀 시 이 주석과 대조할 것):
//   기준가 10,000 · 손절폭 7% → 손절선 9,300 · 총자산 1억 · 위험 1% → 허용손실 1,000,000원
//   보유 100주 → 최초 투입 1,000,000원 · 불타기 pct 10% · sizing half · maxAdds 3
//   1차 트리거 = 10,000×1.1 = 11,000 · 계획수량 50주(원 수량의 절반, 캡에 안 걸림)
//   1차 체결(11,000×50) 후 손절선 = max(9,300, 11,000×0.93=10,230, 10,000) = 10,230
//
// 수동 실행: npx tsx tests/tradePlanLinkParity.ts (scripts/verify.mjs가 자동 수집한다). 통과 시 exit 0.

import { Currency } from '../types';
import { DEFAULT_CATEGORIES } from '../types/category';
import type { PlanFill, PlanSignal, TradePlan, TradePlanEvaluation } from '../types/tradePlan';
import { PYRAMID_FILL_ERROR_LABELS } from '../types/tradePlan';
import { buildTradePlan, floorQuantity } from '../utils/tradePlan';
import {
  defaultSellOutcome,
  sellPrefillFor,
  applySellOutcome,
  pyramidPrecheck,
  decisionHelpText,
  DECISION_REASON_PRESETS,
} from '../utils/tradePlanLink';

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

const NOW = '2026-09-04T05:20:00.000Z';
const STOCK_CAT = DEFAULT_CATEGORIES.find(c => c.baseType === 'KOREAN_STOCK')?.id ?? -1;
const CRYPTO_CAT = DEFAULT_CATEGORIES.find(c => c.baseType === 'CRYPTOCURRENCY')?.id ?? -1;

/** 평가 결과는 signal만 쓰인다 — 나머지는 타입을 만족시키는 더미. */
function ev(signal: PlanSignal): TradePlanEvaluation {
  return { signal, tier: 'none', action: 'none', lines: [], sentence: '', distanceToStopPct: null, stale: false };
}

interface PlanFixtureOpts {
  pyramidEnabled?: boolean;
  maxAdds?: 1 | 2 | 3;
  riskPct?: number;
  totalEquityKRW?: number;
}
function mkPlan(o: PlanFixtureOpts = {}): TradePlan {
  const r = buildTradePlan({
    mode: 'holding', anchor: 'today', anchorPrice: 10_000, anchorDate: '2026-09-04',
    currency: Currency.KRW, totalEquityKRW: o.totalEquityKRW ?? 100_000_000,
    riskPct: o.riskPct ?? 1, stopPct: 7, profitMultiple: 3,
    exitLine: { kind: 'ma', period: 20 },
    pyramid: {
      enabled: o.pyramidEnabled ?? false, stepUnit: 'pct', step: 10,
      sizing: 'half', maxAdds: o.maxAdds ?? 3,
    },
    holdingQuantity: 100, fxRateToKRW: 1, now: NOW,
  });
  if (!r.ok) throw new Error(`fixture build failed: ${r.reason}`);
  return r.plan;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. defaultSellOutcome — 신호 → 기본 매도 효과
// ════════════════════════════════════════════════════════════════════════════
check('계획 평가 없음(null) → none', defaultSellOutcome(null), 'none');
check('take-profit-hit → half', defaultSellOutcome(ev('take-profit-hit')), 'half');
check('stop-hit → stop', defaultSellOutcome(ev('stop-hit')), 'stop');
check('already-below-stop → stop', defaultSellOutcome(ev('already-below-stop')), 'stop');
check('exit-line-hit → exit', defaultSellOutcome(ev('exit-line-hit')), 'exit');
check('waiting → none', defaultSellOutcome(ev('waiting')), 'none');
check('near-stop → none(근접은 아직 매도 아님)', defaultSellOutcome(ev('near-stop')), 'none');
check('pyramid-hit → none(매수 신호)', defaultSellOutcome(ev('pyramid-hit')), 'none');
check('exit-line-watch → none(장중 관찰, 종가 미확정)', defaultSellOutcome(ev('exit-line-watch')), 'none');
check('near-pyramid → none', defaultSellOutcome(ev('near-pyramid')), 'none');
check('already-below-exit → none', defaultSellOutcome(ev('already-below-exit')), 'none');
check('stale → none', defaultSellOutcome(ev('stale')), 'none');
check('unavailable → none', defaultSellOutcome(ev('unavailable')), 'none');

// ════════════════════════════════════════════════════════════════════════════
// 2. sellPrefillFor — 수량 프리필
// ════════════════════════════════════════════════════════════════════════════
{
  const plan = mkPlan();
  const stock = { quantity: 121, priceOriginal: 12_345, categoryId: STOCK_CAT };
  check('주식 half → 정수 내림 60주(121/2=60.5)', sellPrefillFor(plan, stock, 'half').quantity, 60);
  check('주식 stop → 전량 121주', sellPrefillFor(plan, stock, 'stop').quantity, 121);
  check('주식 exit → 전량 121주', sellPrefillFor(plan, stock, 'exit').quantity, 121);
  check('주식 none → 전량 121주', sellPrefillFor(plan, stock, 'none').quantity, 121);
  check('가격은 priceOriginal 그대로(half)', sellPrefillFor(plan, stock, 'half').priceOriginal, 12_345);
  check('가격은 priceOriginal 그대로(stop)', sellPrefillFor(plan, stock, 'stop').priceOriginal, 12_345);

  const crypto = { quantity: 0.12345678, priceOriginal: 98_765_432, categoryId: CRYPTO_CAT };
  check('암호화폐 half → 1e-8 절사 0.06172839', sellPrefillFor(plan, crypto, 'half').quantity, 0.06172839);
  check('암호화폐 half는 floorQuantity(allowFractional=true)와 동일',
    sellPrefillFor(plan, crypto, 'half').quantity, floorQuantity(0.12345678 / 2, true));
  check('암호화폐 stop → 전량(절사 없음)', sellPrefillFor(plan, crypto, 'stop').quantity, 0.12345678);

  const oddCrypto = { quantity: 0.5, priceOriginal: 100, categoryId: CRYPTO_CAT };
  check('암호화폐 0.5 half → 0.25', sellPrefillFor(plan, oddCrypto, 'half').quantity, 0.25);
  const oneShare = { quantity: 1, priceOriginal: 500, categoryId: STOCK_CAT };
  check('주식 1주 half → 0주(내림)', sellPrefillFor(plan, oneShare, 'half').quantity, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. applySellOutcome — 계획 상태 전이
// ════════════════════════════════════════════════════════════════════════════
{
  const plan = mkPlan();
  const fill: PlanFill = { date: '2026-09-10', price: 12_100, quantity: 50, sellRecordId: 'sr-1' };
  const LATER = '2026-09-10T06:00:00.000Z';

  const half = applySellOutcome(plan, 'half', fill, LATER);
  check('half → halfSold에 체결 그대로 기록', half.halfSold, { date: '2026-09-10', price: 12_100, quantity: 50, sellRecordId: 'sr-1' });
  check('half → 계획은 계속 active', half.status, 'active');
  check('half → updatedAt은 주입한 now', half.updatedAt, LATER);
  check('half → 원본 불변(halfSold 없음)', plan.halfSold, undefined);

  const stop = applySellOutcome(plan, 'stop', fill, LATER);
  check('stop → status closed', stop.status, 'closed');
  check('stop → closedReason stop', stop.closedReason, 'stop');
  check('stop → closedAt은 체결일(now 아님)', stop.closedAt, '2026-09-10');

  const exit = applySellOutcome(plan, 'exit', fill, LATER);
  check('exit → status closed', exit.status, 'closed');
  check('exit → closedReason exit-line', exit.closedReason, 'exit-line');
  check('exit → closedAt은 체결일', exit.closedAt, '2026-09-10');

  const none = applySellOutcome(plan, 'none', fill, LATER);
  check('none → 같은 참조(무변경, touch도 없음)', none === plan, true);
  check('none → updatedAt 원본 그대로', none.updatedAt, NOW);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. pyramidPrecheck — 불타기 사전 검사
// ════════════════════════════════════════════════════════════════════════════
{
  // 픽스처 자체 확인(1차 단계가 기대대로 잡혔는가)
  const plan = mkPlan({ pyramidEnabled: true });
  check('픽스처 1차 트리거 11,000원', plan.pyramid.steps[0].triggerPrice, 11_000);
  check('픽스처 1차 계획수량 50주', plan.pyramid.steps[0].plannedQuantity, 50);
  check('픽스처 초기 손절선 9,300원', plan.stopPrice, 9_300);

  const goodFill: PlanFill = { date: '2026-09-11', price: 11_000, quantity: 50 };
  const okRes = pyramidPrecheck(plan, goodFill, 1);
  check('정상 체결 → ok', okRes.ok, true);
  if (okRes.ok) {
    check('정상 체결 → 1차', okRes.level, 1);
    checkClose('정상 체결 → 손절선 10,230원으로 상향', okRes.nextPlan.stopPrice, 10_230);
    check('정상 체결 → 1차 단계에 fill 기록', okRes.nextPlan.pyramid.steps[0].fill, { date: '2026-09-11', price: 11_000, quantity: 50 });
    check('정상 체결 → 원본 손절선 불변', plan.stopPrice, 9_300);

    // 모든 단계 소진 → no-step (maxAdds 1 픽스처를 1차까지 채운 뒤 재검사)
    const one = mkPlan({ pyramidEnabled: true, maxAdds: 1 });
    const filled = pyramidPrecheck(one, goodFill, 1);
    check('maxAdds=1 첫 체결은 통과', filled.ok, true);
    if (filled.ok) {
      const again = pyramidPrecheck(filled.nextPlan, { date: '2026-09-12', price: 12_100, quantity: 10 }, 1);
      check('단계 소진 후 → no-step', again.ok === false && again.reason, 'no-step');
      check('no-step 문구 일치', again.ok === false && again.label, PYRAMID_FILL_ERROR_LABELS['no-step']);
    }
  }

  // 실패 ①: 불타기 미사용 계획
  const off = pyramidPrecheck(mkPlan({ pyramidEnabled: false }), goodFill, 1);
  check('불타기 OFF → pyramid-disabled', off.ok === false && off.reason, 'pyramid-disabled');
  check('pyramid-disabled 문구 일치', off.ok === false && off.label, PYRAMID_FILL_ERROR_LABELS['pyramid-disabled']);

  // 실패 ②: 물타기(마지막 체결가 = 기준가 이하)
  const down = pyramidPrecheck(plan, { date: '2026-09-11', price: 9_500, quantity: 10 }, 1);
  check('기준가 아래 매수 → price-not-above-last-fill', down.ok === false && down.reason, 'price-not-above-last-fill');
  check('price-not-above-last-fill 문구 일치', down.ok === false && down.label, PYRAMID_FILL_ERROR_LABELS['price-not-above-last-fill']);

  // 실패 ③: 총투입 상한(최초 투입 1,000,000 × 2 초과)
  const tooBig = pyramidPrecheck(plan, { date: '2026-09-11', price: 11_000, quantity: 200 }, 1);
  check('투입 3,200,000원 → cost-cap-exceeded', tooBig.ok === false && tooBig.reason, 'cost-cap-exceeded');
  check('cost-cap-exceeded 문구 일치', tooBig.ok === false && tooBig.label, PYRAMID_FILL_ERROR_LABELS['cost-cap-exceeded']);

  // 실패 ④: 허용손실 초과(위험 0.001% → 허용손실 1,000원 vs 손절 시 손실 15,500원)
  const tinyRisk = pyramidPrecheck(mkPlan({ pyramidEnabled: true, riskPct: 0.001 }), goodFill, 1);
  check('허용손실 초과 → risk-budget-exceeded', tinyRisk.ok === false && tinyRisk.reason, 'risk-budget-exceeded');
  check('risk-budget-exceeded 문구 일치', tinyRisk.ok === false && tinyRisk.label, PYRAMID_FILL_ERROR_LABELS['risk-budget-exceeded']);

  // 실패 ⑤: 종목 비중 상한(총자산 500만 → 25% = 125만 vs 체결 후 평가 155만)
  const fat = pyramidPrecheck(mkPlan({ pyramidEnabled: true, totalEquityKRW: 5_000_000 }), goodFill, 1);
  check('비중 상한 초과 → position-cap-exceeded', fat.ok === false && fat.reason, 'position-cap-exceeded');
  check('position-cap-exceeded 문구 일치', fat.ok === false && fat.label, PYRAMID_FILL_ERROR_LABELS['position-cap-exceeded']);

  // 환율 없음(CNY 등): KRW 기준 상한 ③④-b는 판정 불가 → 원통화 상한만 남아 통과
  const noFx = pyramidPrecheck(mkPlan({ pyramidEnabled: true, totalEquityKRW: 5_000_000 }), goodFill, null);
  check('환율 없음 → KRW 상한 미적용으로 통과', noFx.ok, true);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 문구 — decisionHelpText / DECISION_REASON_PRESETS
// ════════════════════════════════════════════════════════════════════════════
const STOP_HELP = '손절은 끝이 아닙니다. 다시 오르면 다시 사면 됩니다 — 큰 손실만 피하면 됩니다';
check('stop-hit → 손절 안내 문구', decisionHelpText('stop-hit'), STOP_HELP);
check('already-below-stop → 같은 손절 안내 문구', decisionHelpText('already-below-stop'), STOP_HELP);
check('take-profit-hit → 안내 없음', decisionHelpText('take-profit-hit'), null);
check('exit-line-hit → 안내 없음', decisionHelpText('exit-line-hit'), null);
check('near-stop → 안내 없음(아직 손절 아님)', decisionHelpText('near-stop'), null);
check('waiting → 안내 없음', decisionHelpText('waiting'), null);
check('pyramid-hit → 안내 없음', decisionHelpText('pyramid-hit'), null);

check('건너뜀 사유 프리셋 3종 고정', DECISION_REASON_PRESETS,
  ['현금 부족', '이미 증권사에서 처리함', '다시 생각해 보겠음']);

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ tradePlanLink parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ tradePlanLink parity 전체 통과 (${pass} 단언)`);
