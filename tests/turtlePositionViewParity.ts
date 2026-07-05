// tests/turtlePositionViewParity.ts
// ---------------------------------------------------------------------------
// 터틀 오픈 포지션 표시 모델 + KRW 리스크 게이지 골든 테스트 (Phase 2b-5).
// 검증 초점(Codex): 가격-공간 원통화 불변 · 돈-공간 KRW = 원통화×fxRate ·
//   외화 fx 미확보 시 과소평가 금지(unresolved 분리) · assetId만 신뢰 · closed 제외.
// 수동 실행: npm run test:turtleview (tsx). 통과 시 exit 0.

import { Asset, Currency, ExchangeRates } from '../types';
import { TurtlePosition, TurtleSettings, DEFAULT_TURTLE_SETTINGS } from '../types/turtle';
import {
  resolvePositionFxRate,
  buildTurtlePositionViews,
  computeTurtleRiskGauge,
} from '../utils/turtlePositionView';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function checkClose(name: string, actual: number, expected: number, eps = 1e-6): void {
  if (Math.abs(actual - expected) <= eps) pass++; else fails.push(`✗ ${name}: got ${actual}, expected ${expected}`);
}

const settings: TurtleSettings = { ...DEFAULT_TURTLE_SETTINGS, satelliteBudgetKRW: 10_000_000, maxUnitsPerPosition: 2, pyramidStepN: 0.5, maxTotalRiskPct: 12 };
const rates: ExchangeRates = { USD: 1400, JPY: 9 };

function mkAsset(id: string, currency: Currency): Asset {
  return { id, categoryId: 5, ticker: `T-${id}`, exchange: 'X', name: id, quantity: 0, purchasePrice: 0, purchaseDate: '2026-01-01', currency, currentPrice: 0, priceOriginal: 0, highestPrice: 0 };
}
function mkPos(p: Partial<TurtlePosition> & { id: string; ticker: string; assetId?: string }): TurtlePosition {
  return {
    name: p.ticker, units: [], stopPrice: 0, entryDonchianHigh: 0, status: 'open', openedAt: '2026-06-01',
    ...p,
  } as TurtlePosition;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. resolvePositionFxRate
// ════════════════════════════════════════════════════════════════════════════
check('fx KRW=1', resolvePositionFxRate(Currency.KRW, rates), 1);
check('fx USD=rate', resolvePositionFxRate(Currency.USD, rates), 1400);
check('fx JPY=rate', resolvePositionFxRate(Currency.JPY, rates), 9);
check('fx CNY=null(미보유)', resolvePositionFxRate(Currency.CNY, rates), null);
check('fx undefined=null', resolvePositionFxRate(undefined, rates), null);
check('fx USD rate 0 → null', resolvePositionFxRate(Currency.USD, { USD: 0, JPY: 9 }), null);

// ════════════════════════════════════════════════════════════════════════════
// 2. KRW 포지션 — fx 1, riskKRW = riskOriginal
//    units: 진입 100주 @1000, N=50 → stop = 1000-2*50 = 900. risk = 100*(1000-900) = 10,000
// ════════════════════════════════════════════════════════════════════════════
{
  const krw = mkPos({
    id: 'p1', ticker: 'KRWCO', assetId: 'a1',
    units: [{ fillDate: '2026-06-01', fillPrice: 1000, quantity: 100, nAtFill: 50 }],
    stopPrice: 900, entryDonchianHigh: 990,
  });
  const map = buildTurtlePositionViews([krw], [mkAsset('a1', Currency.KRW)], rates, settings);
  const v = map.get('a1')!;
  check('KRW view 존재', !!v, true);
  check('KRW currency', v.currency, Currency.KRW);
  check('KRW fxRate', v.fxRate, 1);
  checkClose('KRW riskOriginal', v.riskOriginal, 10_000);
  checkClose('KRW riskKRW = original', v.riskKRW!, 10_000);
  checkClose('KRW entryPrice', v.entryPrice, 1000);
  checkClose('KRW stopPrice', v.stopPrice, 900);
  check('KRW unitsCount', v.unitsCount, 1);
  check('KRW maxUnits', v.maxUnits, 2);
  checkClose('KRW totalQuantity', v.totalQuantity, 100);
  // pyramid trigger = lastFill + 0.5*N = 1000 + 25 = 1025 (여유 1유닛)
  checkClose('KRW pyramidTrigger', v.pyramidTriggerPrice!, 1025);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. USD 포지션 — 가격-공간 원통화 불변, riskKRW = riskOriginal × fx
//    units: 10주 @100, stop 90 → riskOriginal = 10*(100-90) = 100 (USD)
//    riskKRW @1400 = 140,000 / @1500 = 150,000 (stop·riskOriginal 불변 = D6)
// ════════════════════════════════════════════════════════════════════════════
{
  const usd = mkPos({
    id: 'p2', ticker: 'USDCO', assetId: 'a2',
    units: [{ fillDate: '2026-06-01', fillPrice: 100, quantity: 10, nAtFill: 5 }],
    stopPrice: 90, entryDonchianHigh: 99,
  });
  const asset = mkAsset('a2', Currency.USD);
  const v1400 = buildTurtlePositionViews([usd], [asset], { USD: 1400, JPY: 9 }, settings).get('a2')!;
  const v1500 = buildTurtlePositionViews([usd], [asset], { USD: 1500, JPY: 9 }, settings).get('a2')!;
  check('USD currency', v1400.currency, Currency.USD);
  checkClose('USD riskOriginal 불변', v1400.riskOriginal, 100);
  checkClose('USD riskOriginal 환율무관', v1500.riskOriginal, 100);
  checkClose('USD stopPrice 불변', v1500.stopPrice, 90);
  checkClose('USD riskKRW @1400', v1400.riskKRW!, 140_000);
  checkClose('USD riskKRW @1500', v1500.riskKRW!, 150_000);
  check('USD fxRate @1500', v1500.fxRate, 1500);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 유닛 상한 도달 → pyramidTrigger null
// ════════════════════════════════════════════════════════════════════════════
{
  const full = mkPos({
    id: 'p3', ticker: 'FULL', assetId: 'a3',
    units: [
      { fillDate: '2026-06-01', fillPrice: 100, quantity: 10, nAtFill: 5 },
      { fillDate: '2026-06-05', fillPrice: 110, quantity: 10, nAtFill: 5 },
    ],
    stopPrice: 100, entryDonchianHigh: 99,
  });
  const v = buildTurtlePositionViews([full], [mkAsset('a3', Currency.USD)], rates, settings).get('a3')!;
  check('상한 유닛 → pyramidTrigger null', v.pyramidTriggerPrice, null);
  check('상한 unitsCount', v.unitsCount, 2);
  checkClose('2유닛 totalQuantity', v.totalQuantity, 20);
  // riskOriginal = 10*(100-100) + 10*(110-100) = 0 + 100 = 100
  checkClose('2유닛 riskOriginal', v.riskOriginal, 100);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. closed / assetId 없음 → 표시 맵 제외
// ════════════════════════════════════════════════════════════════════════════
{
  const closed = mkPos({ id: 'p4', ticker: 'CL', assetId: 'a4', status: 'closed', units: [{ fillDate: '2026-06-01', fillPrice: 100, quantity: 10, nAtFill: 5 }], stopPrice: 90 });
  const noAsset = mkPos({ id: 'p5', ticker: 'NA', units: [{ fillDate: '2026-06-01', fillPrice: 100, quantity: 10, nAtFill: 5 }], stopPrice: 90 });
  const map = buildTurtlePositionViews([closed, noAsset], [mkAsset('a4', Currency.USD)], rates, settings);
  check('closed 제외', map.has('a4'), false);
  check('assetId 없음 제외(맵 크기 0)', map.size, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 리스크 게이지 — 혼합통화 KRW 정확 합산
//    KRW risk 10,000 + USD risk 100×1400=140,000 = 150,000. budget 10,000,000 → 1.5%
// ════════════════════════════════════════════════════════════════════════════
{
  const krw = mkPos({ id: 'g1', ticker: 'K', assetId: 'a1', units: [{ fillDate: '2026-06-01', fillPrice: 1000, quantity: 100, nAtFill: 50 }], stopPrice: 900 });
  const usd = mkPos({ id: 'g2', ticker: 'U', assetId: 'a2', units: [{ fillDate: '2026-06-01', fillPrice: 100, quantity: 10, nAtFill: 5 }], stopPrice: 90 });
  const assets = [mkAsset('a1', Currency.KRW), mkAsset('a2', Currency.USD)];
  const g = computeTurtleRiskGauge([krw, usd], assets, rates, settings);
  checkClose('게이지 openRiskKRW 혼합', g.openRiskKRW, 150_000);
  checkClose('게이지 riskPct', g.riskPct!, 1.5);
  check('게이지 openPositionCount', g.openPositionCount, 2);
  check('게이지 resolvedCount', g.resolvedCount, 2);
  check('게이지 hasUnresolved=false', g.hasUnresolved, false);
  check('게이지 limitPct', g.limitPct, 12);
}

// ════════════════════════════════════════════════════════════════════════════
// 7. fail-safe — CNY(환율 미보유)는 합산 제외 + unresolved 노출 (과소평가 금지)
// ════════════════════════════════════════════════════════════════════════════
{
  const krw = mkPos({ id: 'g3', ticker: 'K', assetId: 'a1', units: [{ fillDate: '2026-06-01', fillPrice: 1000, quantity: 100, nAtFill: 50 }], stopPrice: 900 });
  const cny = mkPos({ id: 'g4', ticker: 'CNYCO', assetId: 'a5', units: [{ fillDate: '2026-06-01', fillPrice: 50, quantity: 20, nAtFill: 3 }], stopPrice: 44 });
  const assets = [mkAsset('a1', Currency.KRW), mkAsset('a5', Currency.CNY)];
  const g = computeTurtleRiskGauge([krw, cny], assets, rates, settings);
  checkClose('CNY 제외 openRiskKRW(=KRW만)', g.openRiskKRW, 10_000);
  check('CNY hasUnresolved', g.hasUnresolved, true);
  check('CNY unresolved 1건', g.unresolved.length, 1);
  check('CNY unresolved ticker', g.unresolved[0].ticker, 'CNYCO');
  check('CNY unresolved currency', g.unresolved[0].currency, Currency.CNY);
  check('CNY resolvedCount', g.resolvedCount, 1);
  check('CNY openPositionCount', g.openPositionCount, 2);
  // 표시 맵에서도 CNY는 riskKRW null
  const v = buildTurtlePositionViews([cny], assets, rates, settings).get('a5')!;
  check('CNY view fxRate null', v.fxRate, null);
  check('CNY view riskKRW null', v.riskKRW, null);
  checkClose('CNY view riskOriginal(원통화)', v.riskOriginal, 120); // 20*(50-44)
}

// ════════════════════════════════════════════════════════════════════════════
// 8. budget 0 → riskPct null (0 나눗셈 방지)
// ════════════════════════════════════════════════════════════════════════════
{
  const usd = mkPos({ id: 'g5', ticker: 'U', assetId: 'a2', units: [{ fillDate: '2026-06-01', fillPrice: 100, quantity: 10, nAtFill: 5 }], stopPrice: 90 });
  const g = computeTurtleRiskGauge([usd], [mkAsset('a2', Currency.USD)], rates, { ...settings, satelliteBudgetKRW: 0 });
  check('budget 0 → riskPct null', g.riskPct, null);
  checkClose('budget 0 → openRiskKRW 여전히 계산', g.openRiskKRW, 140_000);
}

// ── 결과 ──
if (fails.length > 0) {
  console.error(`❌ turtlePositionView parity 실패 (${fails.length}건):`);
  for (const f of fails) console.error('  ' + f);
  process.exit(1);
}
console.log(`✅ turtlePositionView parity 전체 통과 (${pass} 단언)`);
