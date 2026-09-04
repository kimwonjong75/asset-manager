// tests/tradePlanTransferParity.ts
// ---------------------------------------------------------------------------
// 매수 전 계획 → 자산 이전(`utils/tradePlanTransfer.ts`, P2c) 골든 테스트.
//   · 골든: SLV 관심종목 계획(오늘가 $59.07·10억·1%·손절7%·익절3배·MA20, tradePlanParity와 동일 픽스처
//     → 1,764주) + 실제 체결 1,764주 @ $58.9 → anchorPrice 58.9·stopPrice 54.777·takeProfitPrice 71.269·
//     quantity 1,764·mode holding·anchor purchase
//   · 보존: riskPct/stopPct/profitMultiple/exitLine/exitLineArmMode/pyramid(stepUnit·step·sizing·maxAdds)/
//     brokerStopOrderRegistered/memo
//   · 실패: 매수가 0 이하·보유수량 0 → null(자산 추가 자체는 롤백하지 않음이 호출부 책임)
//   · findWatchItemForAsset: 티커+거래소(normalizeExchange) 매칭, 대소문자 무시, 미매치 undefined
// 수동 실행: npx tsx tests/tradePlanTransferParity.ts (scripts/verify.mjs가 자동 수집). 통과 시 exit 0.

import { Currency, type Asset, type WatchlistItem } from '../types';
import { DEFAULT_CATEGORIES } from '../types/category';
import { DEFAULT_TRADE_PLAN_TEMPLATE } from '../types/tradePlan';
import type { TradePlan } from '../types/tradePlan';
import { buildTradePlan } from '../utils/tradePlan';
import { transferWatchPlanToAsset, findWatchItemForAsset } from '../utils/tradePlanTransfer';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function checkClose(name: string, actual: number | null | undefined, expected: number, eps = 1e-9): void {
  if (typeof actual === 'number' && Math.abs(actual - expected) <= eps) pass++;
  else fails.push(`✗ ${name}: got ${actual}, expected ${expected} (±${eps})`);
}

const NOW = '2026-09-10T06:00:00.000Z';
const US_STOCK_CAT = DEFAULT_CATEGORIES.find(c => c.baseType === 'US_STOCK')?.id ?? -1;
const CRYPTO_CAT = DEFAULT_CATEGORIES.find(c => c.baseType === 'CRYPTOCURRENCY')?.id ?? -1;

/** tradePlanParity.ts 1절과 동일 픽스처(SLV $59.07·10억·1%·손절7%·익절3배·MA20) → 1,764주. */
function mkWatchPlan(over: Partial<Parameters<typeof buildTradePlan>[0]> = {}): TradePlan {
  const r = buildTradePlan({
    mode: 'new-buy', anchor: 'today', anchorPrice: 59.07, anchorDate: '2026-09-02', currency: Currency.USD,
    totalEquityKRW: 1_000_000_000, riskPct: 1, stopPct: 7, profitMultiple: 3,
    exitLine: { kind: 'ma', period: 20 }, pyramid: { ...DEFAULT_TRADE_PLAN_TEMPLATE.pyramid },
    fxRateToKRW: 1370.53, now: '2026-09-02T05:20:00.000Z',
    ...over,
  });
  if (!r.ok) throw new Error(`fixture watch plan build failed: ${r.reason}`);
  return r.plan;
}

function mkAsset(over: Partial<Asset> = {}): Asset {
  return {
    id: 'a-slv', categoryId: US_STOCK_CAT, ticker: 'SLV', exchange: 'NYSEARCA', name: 'iShares Silver Trust',
    quantity: 1764, purchasePrice: 58.9, purchaseDate: '2026-09-10', currency: Currency.USD,
    currentPrice: 58.9, priceOriginal: 58.9, highestPrice: 58.9,
    ...over,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. transferWatchPlanToAsset — 골든(SLV 1,764주 @ $58.9)
// ════════════════════════════════════════════════════════════════════════════
{
  const watchPlan = mkWatchPlan();
  check('픽스처 관심종목 계획 수량 1,764주(tradePlanParity 교차)', watchPlan.plannedQuantity, 1764);

  const asset = mkAsset();
  const transferred = transferWatchPlanToAsset(watchPlan, asset, { fxRateToKRW: 1370.53, now: NOW, totalEquityKRW: 1_000_000_000 });
  check('이전 성공(null 아님)', transferred !== null, true);
  if (transferred) {
    check('anchorPrice = 실제 매수가 58.9', transferred.anchorPrice, 58.9);
    checkClose('stopPrice = 54.777 (58.9×0.93)', transferred.stopPrice, 54.777, 1e-9);
    checkClose('takeProfitPrice = 71.269 (58.9×1.21)', transferred.takeProfitPrice as number, 71.269, 1e-9);
    check('quantity = 실제 체결 1,764주', transferred.plannedQuantity, 1764);
    check('mode = holding', transferred.mode, 'holding');
    check('anchor = purchase', transferred.anchor, 'purchase');
    check('anchorDate = 자산 매수일', transferred.anchorDate, '2026-09-10');
    check('status active', transferred.status, 'active');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 사용자 설정 보존
// ════════════════════════════════════════════════════════════════════════════
{
  const watchPlan: TradePlan = {
    ...mkWatchPlan({ pyramid: { enabled: true, stepUnit: 'r', step: 2, sizing: 'half', maxAdds: 2 } }),
    brokerStopOrderRegistered: true,
    memo: '강환국 강의 기본값',
  };
  const asset = mkAsset();
  const transferred = transferWatchPlanToAsset(watchPlan, asset, { fxRateToKRW: 1370.53, now: NOW, totalEquityKRW: 1_000_000_000 });
  check('이전 성공', transferred !== null, true);
  if (transferred) {
    check('riskPct 보존', transferred.riskPct, watchPlan.riskPct);
    check('stopPct 보존', transferred.stopPct, watchPlan.stopPct);
    check('profitMultiple 보존', transferred.profitMultiple, watchPlan.profitMultiple);
    check('exitLine 보존', transferred.exitLine, watchPlan.exitLine);
    check('exitLineArmMode 보존', transferred.exitLineArmMode, watchPlan.exitLineArmMode);
    check('불타기 stepUnit/step/sizing/maxAdds 보존',
      [transferred.pyramid.stepUnit, transferred.pyramid.step, transferred.pyramid.sizing, transferred.pyramid.maxAdds],
      ['r', 2, 'half', 2]);
    check('불타기 enabled 보존', transferred.pyramid.enabled, true);
    check('불타기 steps는 새 기준가로 재계산됨(빈 배열 아님)', transferred.pyramid.steps.length > 0, true);
    check('brokerStopOrderRegistered 보존', transferred.brokerStopOrderRegistered, true);
    check('memo 보존', transferred.memo, '강환국 강의 기본값');
  }

  // 메모 없는 원본 계획은 이전 후에도 메모 필드가 생기지 않는다(JSON에 키 자체가 없음).
  const noMemo = transferWatchPlanToAsset(mkWatchPlan(), asset, { fxRateToKRW: 1370.53, now: NOW, totalEquityKRW: 1_000_000_000 });
  check('메모 없는 원본 → memo 키 없음', noMemo && 'memo' in noMemo, false);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. exitLineArmMode — 계획 시점(after-reclaim)이 그대로 넘어간다(재계산 없음)
// ════════════════════════════════════════════════════════════════════════════
{
  const watchPlan = mkWatchPlan({ exitLineArmMode: 'after-reclaim' });
  check('픽스처 exitLineArmMode after-reclaim', watchPlan.exitLineArmMode, 'after-reclaim');
  const asset = mkAsset();
  const transferred = transferWatchPlanToAsset(watchPlan, asset, { fxRateToKRW: 1370.53, now: NOW, totalEquityKRW: 1_000_000_000 });
  check('after-reclaim 그대로 보존(새 기준가와 무관)', transferred?.exitLineArmMode, 'after-reclaim');
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 환율 없음(CNY 등) — holding 모드는 fx 없이도 성공(new-buy와 다름)
// ════════════════════════════════════════════════════════════════════════════
{
  const watchPlan = mkWatchPlan();
  const asset = mkAsset();
  const transferred = transferWatchPlanToAsset(watchPlan, asset, { fxRateToKRW: null, now: NOW, totalEquityKRW: 1_000_000_000 });
  check('환율 없음 → holding 모드는 그래도 성공', transferred !== null, true);
  checkClose('환율 없음 → stopPrice는 원통화 그대로 계산됨(54.777)', transferred?.stopPrice, 54.777, 1e-9);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 실패 — 유효하지 않은 매수가/수량은 null(호출부가 자산 추가를 롤백하지 않는다)
// ════════════════════════════════════════════════════════════════════════════
{
  const watchPlan = mkWatchPlan();
  const zeroPrice = transferWatchPlanToAsset(watchPlan, mkAsset({ purchasePrice: 0 }), { fxRateToKRW: 1370.53, now: NOW, totalEquityKRW: 1_000_000_000 });
  check('매수가 0 → null', zeroPrice, null);

  const zeroQty = transferWatchPlanToAsset(watchPlan, mkAsset({ quantity: 0 }), { fxRateToKRW: 1370.53, now: NOW, totalEquityKRW: 1_000_000_000 });
  check('보유수량 0 → null', zeroQty, null);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 암호화폐 — allowFractional 반영(소수 수량 그대로 유지, 절사 없음)
// ════════════════════════════════════════════════════════════════════════════
{
  const watchPlan = mkWatchPlan({ currency: Currency.KRW, anchorPrice: 50_000_000, stopPct: 10, fxRateToKRW: 1 });
  const cryptoAsset = mkAsset({
    categoryId: CRYPTO_CAT, ticker: 'BTC', exchange: 'Upbit', currency: Currency.KRW,
    quantity: 0.12345678, purchasePrice: 48_000_000, purchaseDate: '2026-09-10',
  });
  const transferred = transferWatchPlanToAsset(watchPlan, cryptoAsset, { fxRateToKRW: 1, now: NOW, totalEquityKRW: 1_000_000_000 });
  check('암호화폐 이전 성공', transferred !== null, true);
  check('암호화폐 수량은 소수점 그대로(절사 없음)', transferred?.plannedQuantity, 0.12345678);
}

// ════════════════════════════════════════════════════════════════════════════
// 7. findWatchItemForAsset — 티커+거래소 매칭
// ════════════════════════════════════════════════════════════════════════════
{
  const watchlist: WatchlistItem[] = [
    { id: 'w-1', ticker: 'SLV', exchange: 'NYSEARCA', name: 'iShares Silver Trust', categoryId: US_STOCK_CAT },
    { id: 'w-2', ticker: 'AAPL', exchange: 'NASDAQ', name: 'Apple', categoryId: US_STOCK_CAT },
    { id: 'w-3', ticker: 'BRK.B', exchange: 'AMEX', name: 'Berkshire', categoryId: US_STOCK_CAT },
  ];
  const match = findWatchItemForAsset(watchlist, mkAsset());
  check('티커+거래소 일치 → w-1 매칭', match?.id, 'w-1');

  const lower = findWatchItemForAsset(watchlist, mkAsset({ ticker: 'slv' }));
  check('티커 대소문자 무시 매칭', lower?.id, 'w-1');

  const normalized = findWatchItemForAsset(watchlist, mkAsset({ ticker: 'BRK.B', exchange: 'NYSE American' }));
  check('normalizeExchange로 AMEX ↔ NYSE American 매칭', normalized?.id, 'w-3');

  const noMatch = findWatchItemForAsset(watchlist, mkAsset({ ticker: 'MSFT' }));
  check('미매치 → undefined', noMatch, undefined);
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ tradePlanTransfer parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ tradePlanTransfer parity 전체 통과 (${pass} 단언)`);
