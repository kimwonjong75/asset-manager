// tests/rebalanceActionsParity.ts
// ---------------------------------------------------------------------------
// 코어 리밸런싱 주문 생성기(Phase 4b-2) 골든 테스트.
//   · BUY floor / crypto fractional / SELL 대표우선·fallback최대보유 / 과매도방지
//   · categoryId dedup / no-instrument·no-price·no-fx·no-holding·zero-qty
//   · generated action의 assetId/refPrice/ruleSnapshot(숫자만) 검증
//   · 가격은 marketByInstrument 주입(생성기 내부 fetch 없음)
// 수동 실행: npm run test:rebalaction (tsx). 통과 시 exit 0.

import { Asset, Currency, ExchangeRates, RebalanceInstrument } from '../types';
import { ActionItem } from '../types/actionQueue';
import { RebalanceBandDeviation } from '../utils/rebalanceBands';
import { buildRebalanceActions, findHeldCoreInstrument, buildInstrumentFromPick } from '../utils/rebalanceActions';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function checkClose(name: string, actual: number, expected: number, eps = 1e-6): void {
  if (Math.abs(actual - expected) <= eps) pass++; else fails.push(`✗ ${name}: got ${actual}, expected ${expected}`);
}

const rates: ExchangeRates = { USD: 1400, JPY: 9 };
const TODAY = '2026-07-05';
const makeId = (seq: number) => `rb-${seq}`;

function mkAsset(p: Partial<Asset> & { id: string; ticker: string; categoryId: number; currency: Currency; priceOriginal: number; quantity: number }): Asset {
  return {
    exchange: 'NASDAQ', name: p.ticker, purchasePrice: 0, purchaseDate: '2025-01-01',
    currentPrice: p.priceOriginal, highestPrice: p.priceOriginal, bucket: 'CORE', ...p,
  } as Asset;
}
function dev(p: Partial<RebalanceBandDeviation> & { key: string; difference: number; direction: 'BUY' | 'SELL' }): RebalanceBandDeviation {
  return { label: `cat-${p.key}`, currentValue: 0, currentWeight: 0, targetWeight: 0, targetValue: 0, deviationPct: 0, ...p };
}
const inst = (ticker: string, categoryId: number, exchange = 'NASDAQ'): RebalanceInstrument => ({ ticker, exchange, categoryId });

function build(over: Partial<Parameters<typeof buildRebalanceActions>[0]>) {
  return buildRebalanceActions({
    bandDeviations: [], categoryInstruments: {}, assets: [], rates, existingQueue: [], today: TODAY, makeId, ...over,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 1. BUY floor — 보유 코어 대표종목 (VOO $100, fx 1400), 부족 +₩1,000,000 → 7주(내림)
// ════════════════════════════════════════════════════════════════════════════
{
  const voo = mkAsset({ id: 'a-voo', ticker: 'VOO', categoryId: 2, currency: Currency.USD, priceOriginal: 100, quantity: 5 });
  const r = build({
    bandDeviations: [dev({ key: '2', difference: 1_000_000, direction: 'BUY' })],
    categoryInstruments: { '2': inst('VOO', 2) },
    assets: [voo],
  });
  check('BUY 1건', r.actions.length, 1);
  const a = r.actions[0];
  check('kind BUY', a.kind, 'REBALANCE_BUY');
  check('BUY 수량 floor 7', a.quantity, 7);
  check('BUY refPrice 원통화 100', a.refPrice, 100);
  check('BUY assetId=보유(confirmBuyMore)', a.assetId, 'a-voo');
  check('BUY ruleSnapshot.categoryId', a.ruleSnapshot.categoryId, 2);
  check('BUY ruleSnapshot.fxRate', a.ruleSnapshot.fxRate, 1400);
  checkClose('BUY ruleSnapshot.diffKRW', a.ruleSnapshot.diffKRW, 1_000_000);
  check('diag generated-buy', r.diagnostics[0].reason, 'generated-buy');
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 미보유 대표종목 — marketByInstrument 주입가로 생성, assetId 없음
// ════════════════════════════════════════════════════════════════════════════
{
  const r = build({
    bandDeviations: [dev({ key: '3', difference: 700_000, direction: 'BUY' })],
    categoryInstruments: { '3': inst('EIS', 3) }, // 미보유(이스라엘 ETF)
    assets: [],
    marketByInstrument: { 'EIS|NASDAQ': { price: 50, currency: Currency.USD } }, // 50×1400=70,000/주 → 10주
  });
  check('주입가 BUY 1건', r.actions.length, 1);
  check('주입가 수량 10', r.actions[0].quantity, 10);
  check('미보유 → assetId 없음', r.actions[0].assetId, undefined);
}
{
  // 주입가도 없으면 no-price
  const r = build({
    bandDeviations: [dev({ key: '3', difference: 700_000, direction: 'BUY' })],
    categoryInstruments: { '3': inst('EIS', 3) }, assets: [],
  });
  check('주입가 없음 → 0건', r.actions.length, 0);
  check('no-price 사유', r.diagnostics[0].reason, 'no-price');
}

// ════════════════════════════════════════════════════════════════════════════
// 3. crypto fractional — BTC KRW, 부족 +₩1,000,000, price 1억 → 0.01 (소수 허용)
// ════════════════════════════════════════════════════════════════════════════
{
  const btc = mkAsset({ id: 'a-btc', ticker: 'BTC', exchange: 'Upbit', categoryId: 8, currency: Currency.KRW, priceOriginal: 100_000_000, quantity: 1 });
  const r = build({
    bandDeviations: [dev({ key: '8', difference: 1_000_000, direction: 'BUY' })],
    categoryInstruments: { '8': inst('BTC', 8, 'Upbit') },
    assets: [btc],
  });
  check('crypto BUY 1건', r.actions.length, 1);
  checkClose('crypto 소수 수량 0.01', r.actions[0].quantity, 0.01);
}
{
  // 소수 미허용이면 0주(zero-qty) — 일반 자산이면 floor(0.01)=0
  const stock = mkAsset({ id: 'a-x', ticker: 'X', categoryId: 2, currency: Currency.KRW, priceOriginal: 100_000_000, quantity: 1 });
  const r = build({
    bandDeviations: [dev({ key: '2', difference: 1_000_000, direction: 'BUY' })],
    categoryInstruments: { '2': inst('X', 2) }, assets: [stock],
  });
  check('일반자산 소액 → zero-qty', r.actions.length, 0);
  check('zero-qty 사유', r.diagnostics[0].reason, 'zero-qty');
}

// ════════════════════════════════════════════════════════════════════════════
// 4. SELL 대표종목 우선 — 매핑된 KODEX(작음) vs SAMSUNG(큼) → 매핑 우선
// ════════════════════════════════════════════════════════════════════════════
{
  const kodex = mkAsset({ id: 'a-kodex', ticker: 'KODEX', exchange: 'KRX (코스피/코스닥)', categoryId: 1, currency: Currency.KRW, priceOriginal: 30_000, quantity: 100 });
  const samsung = mkAsset({ id: 'a-sam', ticker: 'SAMSUNG', exchange: 'KRX (코스피/코스닥)', categoryId: 1, currency: Currency.KRW, priceOriginal: 70_000, quantity: 1000 });
  const r = build({
    bandDeviations: [dev({ key: '1', difference: -1_000_000, direction: 'SELL' })],
    categoryInstruments: { '1': inst('KODEX', 1, 'KRX (코스피/코스닥)') },
    assets: [kodex, samsung],
  });
  check('SELL 1건', r.actions.length, 1);
  const a = r.actions[0];
  check('대표종목 우선 assetId', a.assetId, 'a-kodex');
  check('SELL 수량 floor 33 (100만/3만)', a.quantity, 33);
  check('SELL refPrice 30,000', a.refPrice, 30_000);
  check('diag generated-sell', r.diagnostics[0].reason, 'generated-sell');
}

// ════════════════════════════════════════════════════════════════════════════
// 5. SELL fallback — 매핑 없음 → 카테고리 내 최대 보유(SAMSUNG)
// ════════════════════════════════════════════════════════════════════════════
{
  const kodex = mkAsset({ id: 'a-kodex', ticker: 'KODEX', categoryId: 1, currency: Currency.KRW, priceOriginal: 30_000, quantity: 10 });
  const samsung = mkAsset({ id: 'a-sam', ticker: 'SAMSUNG', categoryId: 1, currency: Currency.KRW, priceOriginal: 70_000, quantity: 1000 });
  const r = build({
    bandDeviations: [dev({ key: '1', difference: -1_000_000, direction: 'SELL' })],
    categoryInstruments: {}, assets: [kodex, samsung],
  });
  check('fallback 최대보유 SAMSUNG', r.actions[0].assetId, 'a-sam');
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 과매도 방지 — diff 매우 큼, 보유 100주 상한
// ════════════════════════════════════════════════════════════════════════════
{
  const kodex = mkAsset({ id: 'a-kodex', ticker: 'KODEX', categoryId: 1, currency: Currency.KRW, priceOriginal: 30_000, quantity: 100 });
  const r = build({
    bandDeviations: [dev({ key: '1', difference: -100_000_000, direction: 'SELL' })],
    categoryInstruments: {}, assets: [kodex],
  });
  check('과매도 방지 → 보유 100주 상한', r.actions[0].quantity, 100);
}

// ════════════════════════════════════════════════════════════════════════════
// 7. categoryId dedup — 같은 카테고리 active REBALANCE 존재 → 스킵
// ════════════════════════════════════════════════════════════════════════════
{
  const kodex = mkAsset({ id: 'a-kodex', ticker: 'KODEX', categoryId: 1, currency: Currency.KRW, priceOriginal: 30_000, quantity: 100 });
  const existing: ActionItem[] = [{ id: 'e', createdDate: '2026-07-04', kind: 'REBALANCE_SELL', ticker: 'KODEX', name: 'KODEX', assetId: 'a-kodex', quantity: 10, refPrice: 30_000, reasonText: '', ruleSnapshot: { categoryId: 1 }, status: 'pending' }];
  const r = build({
    bandDeviations: [dev({ key: '1', difference: -1_000_000, direction: 'SELL' })],
    categoryInstruments: {}, assets: [kodex], existingQueue: existing,
  });
  check('categoryId dedup → 0건', r.actions.length, 0);
  check('duplicate 사유', r.diagnostics[0].reason, 'duplicate');
}

// ════════════════════════════════════════════════════════════════════════════
// 8. 스킵 사유 — no-instrument / no-holding / no-fx
// ════════════════════════════════════════════════════════════════════════════
{
  // BUY 대표종목 미지정
  const r = build({ bandDeviations: [dev({ key: '2', difference: 1_000_000, direction: 'BUY' })], categoryInstruments: {}, assets: [] });
  check('no-instrument', r.diagnostics[0].reason, 'no-instrument');
}
{
  // SELL 코어 보유 없음
  const r = build({ bandDeviations: [dev({ key: '5', difference: -1_000_000, direction: 'SELL' })], assets: [] });
  check('no-holding', r.diagnostics[0].reason, 'no-holding');
}
{
  // no-fx: CNY 통화 (환율 미지원)
  const cny = mkAsset({ id: 'a-cny', ticker: 'CNYCO', categoryId: 4, currency: Currency.CNY, priceOriginal: 50, quantity: 100 });
  const r = build({ bandDeviations: [dev({ key: '4', difference: -1_000_000, direction: 'SELL' })], assets: [cny] });
  check('no-fx', r.diagnostics[0].reason, 'no-fx');
  check('no-fx → 0건', r.actions.length, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 9. 밴드 0건 → 0건 (fail-closed 입력)
// ════════════════════════════════════════════════════════════════════════════
{
  const r = build({ bandDeviations: [] });
  check('밴드 0건 → actions 0', r.actions.length, 0);
  check('밴드 0건 → diag 0', r.diagnostics.length, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 10. ruleSnapshot은 숫자만 (타입 안전)
// ════════════════════════════════════════════════════════════════════════════
{
  const voo = mkAsset({ id: 'a-voo', ticker: 'VOO', categoryId: 2, currency: Currency.USD, priceOriginal: 100, quantity: 5 });
  const r = build({
    bandDeviations: [dev({ key: '2', difference: 1_000_000, direction: 'BUY', currentWeight: 30, targetWeight: 20 })],
    categoryInstruments: { '2': inst('VOO', 2) }, assets: [voo],
  });
  const snap = r.actions[0].ruleSnapshot;
  check('snapshot 값 전부 number', Object.values(snap).every(v => typeof v === 'number'), true);
  check('snapshot currentWeight', snap.currentWeight, 30);
  check('snapshot targetWeight', snap.targetWeight, 20);
}

// ════════════════════════════════════════════════════════════════════════════
// 11. findHeldCoreInstrument — 거래소 문자열 달라도 티커+카테고리로 매칭 (KRX ETF 버그 보정)
// ════════════════════════════════════════════════════════════════════════════
{
  // 실제 케이스: PLUS 미국채(464470)는 KRX 상장인데 US_BOND(6) 카테고리·매핑엔 "미국 국채"로 저장됨
  const krxBond = mkAsset({ id: 'a-bond', ticker: '464470', exchange: 'KRX (코스피/코스닥)', categoryId: 6, currency: Currency.KRW, priceOriginal: 54975, quantity: 350 });
  const inst = { ticker: '464470', exchange: '미국 국채', categoryId: 6 };
  check('거래소 불일치+티커 유일 → 매칭', findHeldCoreInstrument([krxBond], inst)?.id, 'a-bond');
  check('거래소 일치 → 매칭', findHeldCoreInstrument([krxBond], { ...inst, exchange: 'KRX (코스피/코스닥)' })?.id, 'a-bond');
  check('다른 categoryId → 미매칭', findHeldCoreInstrument([krxBond], { ...inst, categoryId: 5 }), null);
  // 위성(투더문)은 코어 매칭 대상 아님
  const sat = mkAsset({ id: 'a-sat', ticker: '464470', exchange: 'KRX (코스피/코스닥)', categoryId: 6, currency: Currency.KRW, priceOriginal: 54975, quantity: 10, bucket: 'SATELLITE' });
  check('SATELLITE 제외', findHeldCoreInstrument([sat], inst), null);
  // 같은 카테고리에 같은 티커 2개(거래소 다름) → ambiguous null
  const dup = mkAsset({ id: 'a-dup', ticker: '464470', exchange: 'KONEX', categoryId: 6, currency: Currency.KRW, priceOriginal: 54975, quantity: 5 });
  check('티커 중복 → ambiguous null', findHeldCoreInstrument([krxBond, dup], inst), null);
}

// ════════════════════════════════════════════════════════════════════════════
// 12. BUY 생성 — 거래소 불일치 보유 종목이면 assetId 세팅(추가매수·중복 생성 안 함)
// ════════════════════════════════════════════════════════════════════════════
{
  const krxBond = mkAsset({ id: 'a-bond', ticker: '464470', exchange: 'KRX (코스피/코스닥)', categoryId: 6, currency: Currency.KRW, priceOriginal: 54975, quantity: 350 });
  const r = build({
    bandDeviations: [dev({ key: '6', difference: 197_160_357, direction: 'BUY' })],
    categoryInstruments: { '6': inst('464470', 6, '미국 국채') }, // 저장된 거래소가 틀림
    assets: [krxBond],
    // marketByInstrument 없음 — 보유 매칭돼야 하므로 주입가 불필요
  });
  check('BUY 1건 생성(보유 매칭)', r.actions.length, 1);
  check('★ assetId=보유(신규 아님)', r.actions[0].assetId, 'a-bond');
  check('refPrice=보유 priceOriginal', r.actions[0].refPrice, 54975);
  // qty = floor(197,160,357 / 54,975) = 3586
  check('수량 floor', r.actions[0].quantity, 3586);
}

// ════════════════════════════════════════════════════════════════════════════
// 13. buildInstrumentFromPick — 보유 티커 일치 시 거래소도 보유 값으로 보정
// ════════════════════════════════════════════════════════════════════════════
{
  const holdings = [{ ticker: '464470', name: 'PLUS 미국채30년', currency: Currency.KRW, exchange: 'KRX (코스피/코스닥)' }];
  const picked = buildInstrumentFromPick('464470', '미국 국채', 6, holdings);
  check('★ 거래소 보정(보유 값)', picked?.exchange, 'KRX (코스피/코스닥)');
  check('이름 복사', picked?.name, 'PLUS 미국채30년');
  check('통화 복사', picked?.currency, Currency.KRW);
  // 미보유 → fallback 거래소, name/currency 미지정
  const newInst = buildInstrumentFromPick('SPY', 'NYSE', 2, holdings);
  check('미보유 fallback 거래소', newInst?.exchange, 'NYSE');
  check('미보유 name 미지정', newInst?.name, undefined);
  check('빈 티커 → null', buildInstrumentFromPick('', 'NYSE', 2, holdings), null);
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ rebalanceActions parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ rebalanceActions parity 전체 통과 (${pass} 단언)`);
