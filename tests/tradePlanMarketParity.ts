// tests/tradePlanMarketParity.ts
// ---------------------------------------------------------------------------
// utils/tradePlanMarket.ts 골든 테스트 — 명시적 절대값만 고정한다.
//   · fxRateToKRWFor: KRW=1 · USD/JPY는 rates>0일 때만 · CNY 등은 항상 null(|| 0 금지)
//   · marketIdForExchange(utils/holdingMarkets 추가분): KR/US/CRYPTO 판정
//   · buildTradePlanMarket: price/priceAsOf/isIntraday/sessionDate/ma 조립
//   · summarizeTradePlanSignals: 등급별 건수 + 확인필요(unavailable/stale/brokerStopMissing)
//   · defaultEditorInput: holding(anchor today/purchase)·new-buy·MA20 무장값·통화 폴백
//
// **로컬 타임존 가정**: `buildTradePlanMarket`의 `priceAsOf`는 `utils/localDate.localDateString`
// (브라우저/Node 로컬 달력일)을 쓴다 — 이 리포의 개발/실행 환경은 Asia/Seoul(KST, UTC+9)
// 고정이므로 이 테스트의 명시값도 KST 기준으로 손으로 환산했다(marketHoursParity와 동일 관례).
// 수동 실행: npm run test:tradeplanmarket (tsx). 통과 시 exit 0.

import { Currency, type Asset, type ExchangeRates, type WatchlistItem } from '../types';
import { DEFAULT_CATEGORIES } from '../types/category';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';
import type { PlanSignal, PlanTier, TradePlanEvaluation } from '../types/tradePlan';
import { marketIdForExchange } from '../utils/holdingMarkets';
import { buildTradePlan } from '../utils/tradePlan';
import {
  fxRateToKRWFor,
  buildTradePlanMarket,
  summarizeTradePlanSignals,
  defaultEditorInput,
  estimateTradePlanStopLoss,
  type TradePlanTarget,
} from '../utils/tradePlanMarket';

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

const RATES: ExchangeRates = { USD: 1370, JPY: 9 };
const NOW = '2026-09-03T05:20:00.000Z';

function mkEnriched(o: Partial<EnrichedIndicatorData> = {}): EnrichedIndicatorData {
  return {
    ma: {}, prevMa: {}, rsi: null, prevRsi: null, maCrossDays: {},
    prevClose: null, priceCrossMaDays: {}, priceBreakBelowMaDays: {},
    rsiBounceDay: null, rsiOverheatEntryDay: null,
    atr14: null, high52w: null, volume52wMax: null, slopeRatio: null, dayRangeOverAtr: null,
    priceIsAt52wHigh: false, volumeIsAt52wMax: false, distributionDayMeta: [], ohlcvAvailable: true,
    isBullishCandle: null, longTrendUp: null, recentSwingLow: null, ...o,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. fxRateToKRWFor
// ════════════════════════════════════════════════════════════════════════════
check('KRW → 1', fxRateToKRWFor(Currency.KRW, RATES), 1);
check('USD → rates.USD', fxRateToKRWFor(Currency.USD, RATES), 1370);
check('JPY → rates.JPY', fxRateToKRWFor(Currency.JPY, RATES), 9);
check('USD 0 → null', fxRateToKRWFor(Currency.USD, { USD: 0, JPY: 9 }), null);
check('USD undefined → null', fxRateToKRWFor(Currency.USD, { USD: undefined as unknown as number, JPY: 9 }), null);
check('JPY 0 → null', fxRateToKRWFor(Currency.JPY, { USD: 1370, JPY: 0 }), null);
check('CNY → 항상 null(미지원)', fxRateToKRWFor(Currency.CNY, RATES), null);

// ════════════════════════════════════════════════════════════════════════════
// 2. marketIdForExchange (utils/holdingMarkets 추가분) — classifyHoldingMarkets와 동일 규칙
// ════════════════════════════════════════════════════════════════════════════
check('KRX → KR', marketIdForExchange('KRX (코스피/코스닥)'), 'KR');
check('KONEX → KR', marketIdForExchange('KONEX'), 'KR');
check('NASDAQ → US', marketIdForExchange('NASDAQ'), 'US');
check('NYSE → US', marketIdForExchange('NYSE'), 'US');
check('Upbit → CRYPTO', marketIdForExchange('Upbit'), 'CRYPTO');
check('주요 거래소 (종합) → CRYPTO', marketIdForExchange('주요 거래소 (종합)'), 'CRYPTO');
check('알수없는 거래소 → US(폴백)', marketIdForExchange('알수없는거래소'), 'US');

// ════════════════════════════════════════════════════════════════════════════
// 3. buildTradePlanMarket
// ════════════════════════════════════════════════════════════════════════════
{
  // 월요일 09:00:00 KST = 2026-09-07T00:00:00Z(KR 개장 경계, marketHoursParity 골든과 동일 사실)
  const m = buildTradePlanMarket({
    priceOriginal: 54_300, exchange: 'KRX (코스피/코스닥)', enriched: undefined,
    priceDataAsOf: null, now: '2026-09-07T00:00:00.000Z',
  });
  check('priceOriginal>0 → price 그대로', m.price, 54_300);
  check('priceDataAsOf null → sessionDate(KR, 월 09:00) = 2026-09-07', m.sessionDate, '2026-09-07');
  check('priceDataAsOf null → priceAsOf = sessionDate', m.priceAsOf, '2026-09-07');
  check('priceDataAsOf null → isIntraday false(확정 종가로 간주)', m.isIntraday, false);
  check('maAsOf = sessionDate', m.maAsOf, m.sessionDate);
  check('enriched 없음 → ma 전부 null', m.ma, { 10: null, 20: null, 50: null });
}
{
  const m = buildTradePlanMarket({
    priceOriginal: 0, exchange: 'NASDAQ', enriched: undefined, priceDataAsOf: null, now: NOW,
  });
  check('priceOriginal 0 → price null(시세 없음)', m.price, null);
}
{
  // 금요일 15:00 KST(개장중, 15:30 마감 전) = 2026-09-04T06:00:00Z
  const m = buildTradePlanMarket({
    priceOriginal: 54_300, exchange: 'KRX (코스피/코스닥)',
    enriched: mkEnriched({ ma: { 10: 55_000, 20: 52_900, 50: 51_000 } }),
    priceDataAsOf: '2026-09-04T06:00:00.000Z', now: '2026-09-04T06:00:00.000Z',
  });
  check('장중 시각 → isIntraday true', m.isIntraday, true);
  check('enriched ma 값 전달', m.ma, { 10: 55_000, 20: 52_900, 50: 51_000 });
}
{
  // 금요일 17:00 KST(마감 후) = 2026-09-04T08:00:00Z
  const m = buildTradePlanMarket({
    priceOriginal: 54_300, exchange: 'KRX (코스피/코스닥)', enriched: undefined,
    priceDataAsOf: '2026-09-04T08:00:00.000Z', now: '2026-09-04T08:00:00.000Z',
  });
  check('마감 후 시각 → isIntraday false', m.isIntraday, false);
  check('priceDataAsOf(로컬 KST) → 2026-09-04', m.priceAsOf, '2026-09-04');
}

// ════════════════════════════════════════════════════════════════════════════
// 4. summarizeTradePlanSignals
// ════════════════════════════════════════════════════════════════════════════
function mkRow(tier: PlanTier, o: { signal?: PlanSignal; stale?: boolean; brokerStopOrderRegistered?: boolean } = {}) {
  const evaluation: TradePlanEvaluation = {
    signal: o.signal ?? 'waiting', tier, action: 'wait', lines: [], sentence: '',
    distanceToStopPct: null, stale: o.stale ?? false,
  };
  return { evaluation, plan: { brokerStopOrderRegistered: o.brokerStopOrderRegistered ?? true } };
}
{
  const rows = [
    mkRow('urgent'), mkRow('urgent'), mkRow('today'), mkRow('prepare'),
    mkRow('none', { signal: 'unavailable' }),
    mkRow('none', { stale: true }),
    mkRow('prepare', { brokerStopOrderRegistered: false }),
  ];
  const s = summarizeTradePlanSignals(rows);
  check('urgent 2건', s.urgent, 2);
  check('today 1건', s.today, 1);
  check('prepare 2건', s.prepare, 2);
  check('unavailable 1건', s.unavailable, 1);
  check('stale 1건', s.stale, 1);
  check('brokerStopMissing 1건', s.brokerStopMissing, 1);
}
check('빈 배열 → 전부 0', summarizeTradePlanSignals([]), { urgent: 0, today: 0, prepare: 0, unavailable: 0, stale: 0, brokerStopMissing: 0 });

// ════════════════════════════════════════════════════════════════════════════
// 5. defaultEditorInput
// ════════════════════════════════════════════════════════════════════════════
function mkAsset(o: Partial<Asset> = {}): Asset {
  return {
    id: 'a1', categoryId: 2, ticker: 'AAPL', exchange: 'NASDAQ', name: 'Apple',
    quantity: 10, purchasePrice: 150, purchaseDate: '2026-01-01', currency: Currency.USD,
    currentPrice: 200, priceOriginal: 200, highestPrice: 210,
    ...o,
  };
}
function mkWatch(o: Partial<WatchlistItem> = {}): WatchlistItem {
  return {
    id: 'w1', ticker: 'MSFT', exchange: 'NASDAQ', name: 'Microsoft', categoryId: 2,
    currentPrice: 500, priceOriginal: 500, currency: Currency.USD,
    ...o,
  };
}
{
  const target: TradePlanTarget = { kind: 'asset', asset: mkAsset() };
  const input = defaultEditorInput(target, {
    totalEquityKRW: 1_000_000_000, rates: RATES, enriched: mkEnriched({ ma: { 20: 190 } }), now: NOW, anchor: 'today',
  });
  check('holding(anchor today) → mode holding', input.mode, 'holding');
  check('holding(anchor today) → anchorPrice = priceOriginal', input.anchorPrice, 200);
  check('holding → holdingQuantity = 보유수량', input.holdingQuantity, 10);
  check('holding → currentExitLineValue = ma20', input.currentExitLineValue, 190);
  check('holding → fxRateToKRW = rates.USD', input.fxRateToKRW, 1370);
  check('강의 기본값: riskPct 1', input.riskPct, 1);
  check('강의 기본값: stopPct 7', input.stopPct, 7);
  check('강의 기본값: profitMultiple 3', input.profitMultiple, 3);
  check('강의 기본값: exitLine MA20', input.exitLine, { kind: 'ma', period: 20 });
  check('강의 기본값: 불타기 안 함', input.pyramid.enabled, false);
  check('주식 → allowFractional false', input.allowFractional, false);
}
{
  const target: TradePlanTarget = { kind: 'asset', asset: mkAsset() };
  const input = defaultEditorInput(target, {
    totalEquityKRW: 1_000_000_000, rates: RATES, enriched: undefined, now: NOW, anchor: 'purchase',
  });
  check('holding(anchor purchase) → anchorPrice = purchasePrice', input.anchorPrice, 150);
  check('enriched 없음 → currentExitLineValue null', input.currentExitLineValue, null);
}
{
  const target: TradePlanTarget = { kind: 'watch', item: mkWatch() };
  const input = defaultEditorInput(target, {
    totalEquityKRW: 1_000_000_000, rates: RATES, enriched: undefined, now: NOW, anchor: 'today',
  });
  check('관심종목 → mode new-buy', input.mode, 'new-buy');
  check('관심종목 → holdingQuantity undefined', input.holdingQuantity, undefined);
  check('관심종목 → anchorPrice = priceOriginal', input.anchorPrice, 500);
}
{
  const cryptoCatId = DEFAULT_CATEGORIES.find(c => c.baseType === 'CRYPTOCURRENCY')?.id ?? -1;
  const target: TradePlanTarget = { kind: 'asset', asset: mkAsset({ categoryId: cryptoCatId }) };
  const input = defaultEditorInput(target, {
    totalEquityKRW: 1_000_000_000, rates: RATES, enriched: undefined, now: NOW, anchor: 'today',
  });
  check('암호화폐 카테고리 → allowFractional true', input.allowFractional, true);
}
{
  const target: TradePlanTarget = { kind: 'asset', asset: mkAsset({ currency: Currency.CNY }) };
  const input = defaultEditorInput(target, {
    totalEquityKRW: 1_000_000_000, rates: RATES, enriched: undefined, now: NOW, anchor: 'today',
  });
  check('CNY 보유 종목 → fxRateToKRW null', input.fxRateToKRW, null);
}
{
  const target: TradePlanTarget = { kind: 'watch', item: mkWatch({ currency: undefined }) };
  const input = defaultEditorInput(target, {
    totalEquityKRW: 1_000_000_000, rates: RATES, enriched: undefined, now: NOW, anchor: 'today',
  });
  check('관심종목 통화 미지정 → KRW 폴백', input.currency, 'KRW');
}

// ════════════════════════════════════════════════════════════════════════════
// 6. estimateTradePlanStopLoss — 카드 표시용 손실 추정
// ════════════════════════════════════════════════════════════════════════════
{
  const r = buildTradePlan({
    mode: 'holding', anchor: 'today', anchorPrice: 10_000, anchorDate: '2026-09-03',
    currency: Currency.KRW, totalEquityKRW: 100_000_000, riskPct: 1, stopPct: 7, profitMultiple: 3,
    exitLine: { kind: 'ma', period: 20 }, pyramid: { enabled: false, stepUnit: 'pct', step: 10, sizing: 'half', maxAdds: 3 },
    holdingQuantity: 100, fxRateToKRW: 1, now: NOW,
  });
  if (!r.ok) throw new Error('fixture build failed');
  const est = estimateTradePlanStopLoss(r.plan, 1);
  check('보유수량 100 그대로', est.remainingQuantity, 100);
  check('손절 예상손실 −70,000원(100×(10,000−9,300))', est.worstLossKRW, -70_000);
  checkClose('손절 예상손실 총자산 대비 −0.07%', est.worstLossPct, -0.07);
  check('갭 손실(−3%) −97,900원(100×(10,000−9,021))', est.adverseLossKRW, -97_900);
  const noFx = estimateTradePlanStopLoss(r.plan, null);
  check('환율 없음 → KRW 금액 전부 null(수량은 유지)', noFx, { remainingQuantity: 100, worstLossKRW: null, worstLossPct: null, adverseLossKRW: null });
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ tradePlanMarket parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ tradePlanMarket parity 전체 통과 (${pass} 단언)`);
