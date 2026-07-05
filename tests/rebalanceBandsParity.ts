// tests/rebalanceBandsParity.ts
// ---------------------------------------------------------------------------
// 코어 카테고리 밴드 판정(Phase 4a) 골든 테스트.
//   · 밴드 안이면 0건 / 이탈 시에만 감지
//   · difference>0→BUY, <0→SELL
//   · target/current/weight 계산 기준을 buildRebalanceRows로 고정(통합 검증)
//   · fail-closed(targetTotalAmount·coreCurrentValue 0)
// 수동 실행: npm run test:rebalance (tsx). 통과 시 exit 0.

import { Asset, Currency, ExchangeRates } from '../types';
import { DEFAULT_CATEGORIES } from '../types/category';
import { buildRebalanceRows, RebalanceRow } from '../utils/bucketRebalancing';
import { detectRebalanceBands, computeCoreBands, DEFAULT_REBALANCE_BAND_PCT } from '../utils/rebalanceBands';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function checkClose(name: string, actual: number, expected: number, eps = 1e-6): void {
  if (Math.abs(actual - expected) <= eps) pass++; else fails.push(`✗ ${name}: got ${actual}, expected ${expected}`);
}

check('기본 밴드 5', DEFAULT_REBALANCE_BAND_PCT, 5);

// ── 계산 기준 고정: 코어 1,000만 (A 500만/50%, B 500만/50%), 목표 A40/B60, 목표총액=현재총액 ──
function coreRows(valuesByKey: Record<string, number>, targetWeights: Record<string, number>, coreValue: number, targetTotal: number): RebalanceRow[] {
  return buildRebalanceRows({
    keys: Object.keys({ ...valuesByKey, ...targetWeights }),
    valuesByKey,
    targetWeights,
    denominatorValue: coreValue,
    targetTotalAmount: targetTotal,
    labelOf: k => `cat-${k}`,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 1. 이탈 감지 — A 초과(SELL), B 부족(BUY)
// ════════════════════════════════════════════════════════════════════════════
{
  const rows = coreRows({ '1': 5_000_000, '2': 5_000_000 }, { '1': 40, '2': 60 }, 10_000_000, 10_000_000);
  // A: current 50% target 40% → dev +10, target 4M, diff -1M → SELL
  // B: current 50% target 60% → dev -10, target 6M, diff +1M → BUY
  const dev = detectRebalanceBands(rows, { targetTotalAmount: 10_000_000, coreCurrentValue: 10_000_000 });
  check('이탈 2건', dev.length, 2);
  const a = dev.find(d => d.key === '1')!;
  const b = dev.find(d => d.key === '2')!;
  check('A 방향 SELL', a.direction, 'SELL');
  checkClose('A difference -1,000,000', a.difference, -1_000_000);
  checkClose('A deviationPct +10', a.deviationPct, 10);
  checkClose('A currentWeight 50', a.currentWeight, 50);
  checkClose('A targetWeight 40', a.targetWeight, 40);
  checkClose('A targetValue 4,000,000', a.targetValue, 4_000_000);
  check('B 방향 BUY', b.direction, 'BUY');
  checkClose('B difference +1,000,000', b.difference, 1_000_000);
  checkClose('B deviationPct -10', b.deviationPct, -10);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 밴드 안 → 0건 (침묵)
// ════════════════════════════════════════════════════════════════════════════
{
  // A 48%/B 52% vs 목표 45/55 → 편차 ±3 < 5 → 침묵
  const rows = coreRows({ '1': 4_800_000, '2': 5_200_000 }, { '1': 45, '2': 55 }, 10_000_000, 10_000_000);
  check('밴드 안 → 0건', detectRebalanceBands(rows, { targetTotalAmount: 10_000_000, coreCurrentValue: 10_000_000 }).length, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 경계(정확히 5%p) → 포함 (>= band)
// ════════════════════════════════════════════════════════════════════════════
{
  // A 50%/target 45% → 편차 정확히 5 → 포함
  const rows = coreRows({ '1': 5_000_000, '2': 5_000_000 }, { '1': 45, '2': 55 }, 10_000_000, 10_000_000);
  const dev = detectRebalanceBands(rows, { targetTotalAmount: 10_000_000, coreCurrentValue: 10_000_000 });
  check('경계 5%p 포함(2건)', dev.length, 2);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 커스텀 밴드
// ════════════════════════════════════════════════════════════════════════════
{
  const rows = coreRows({ '1': 5_300_000, '2': 4_700_000 }, { '1': 50, '2': 50 }, 10_000_000, 10_000_000);
  // 편차 ±3. band 5 → 0건, band 2 → 2건
  check('band 5 → 0건', detectRebalanceBands(rows, { targetTotalAmount: 10_000_000, coreCurrentValue: 10_000_000 }, { bandPct: 5 }).length, 0);
  check('band 2 → 2건', detectRebalanceBands(rows, { targetTotalAmount: 10_000_000, coreCurrentValue: 10_000_000 }, { bandPct: 2 }).length, 2);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. fail-closed — targetTotalAmount / coreCurrentValue 0
// ════════════════════════════════════════════════════════════════════════════
{
  const rows = coreRows({ '1': 5_000_000, '2': 5_000_000 }, { '1': 40, '2': 60 }, 10_000_000, 10_000_000);
  check('targetTotalAmount 0 → []', detectRebalanceBands(rows, { targetTotalAmount: 0, coreCurrentValue: 10_000_000 }).length, 0);
  check('coreCurrentValue 0 → []', detectRebalanceBands(rows, { targetTotalAmount: 10_000_000, coreCurrentValue: 0 }).length, 0);
  check('band 0 → []', detectRebalanceBands(rows, { targetTotalAmount: 10_000_000, coreCurrentValue: 10_000_000 }, { bandPct: 0 }).length, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 목표 0인데 보유 있는 카테고리(orphan) → SELL (편차=현재비중)
// ════════════════════════════════════════════════════════════════════════════
{
  // C 20% 보유, 목표 0 → 편차 +20 ≥5, diff = 0 - 2M = -2M → SELL
  const rows = coreRows({ '1': 6_000_000, '2': 2_000_000, '3': 2_000_000 }, { '1': 50, '2': 50, '3': 0 }, 10_000_000, 10_000_000);
  const dev = detectRebalanceBands(rows, { targetTotalAmount: 10_000_000, coreCurrentValue: 10_000_000 });
  const c = dev.find(d => d.key === '3')!;
  check('orphan C 감지', !!c, true);
  check('orphan C SELL', c.direction, 'SELL');
  checkClose('orphan C difference -2,000,000', c.difference, -2_000_000);
  checkClose('orphan C deviationPct +20', c.deviationPct, 20);
}

// ────────────────────────────────────────────────────────────────────────────
// 7. difference 0(목표=현재) → 제외 (밴드 게이트도 통과 못하지만 이중 방어 확인)
// ════════════════════════════════════════════════════════════════════════════
{
  // 완전 일치 A50/B50 목표 50/50 → 편차 0, diff 0 → 0건
  const rows = coreRows({ '1': 5_000_000, '2': 5_000_000 }, { '1': 50, '2': 50 }, 10_000_000, 10_000_000);
  check('완전 일치 → 0건', detectRebalanceBands(rows, { targetTotalAmount: 10_000_000, coreCurrentValue: 10_000_000 }).length, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 8. computeCoreBands — 저장본/편집값 주입 통일 경로 (display=generation 동일 계산)
// ════════════════════════════════════════════════════════════════════════════
const rates: ExchangeRates = { USD: 1400, JPY: 9 };
function mkCoreAsset(id: string, categoryId: number, price: number, qty: number): Asset {
  return { id, categoryId, ticker: id, exchange: 'KRX (코스피/코스닥)', name: id, quantity: qty, purchasePrice: price, purchaseDate: '2025-01-01', currency: Currency.KRW, currentPrice: price, priceOriginal: price, highestPrice: price } as Asset;
}
{
  // 코어 2카테고리 각 500만(50/50). 목표 40/60, CORE 100%, 총목표=현재 → cat1 SELL, cat2 BUY
  const assets = [mkCoreAsset('a1', 1, 100, 50_000), mkCoreAsset('a2', 2, 100, 50_000)];
  const bands = computeCoreBands({
    assets, rates, categories: DEFAULT_CATEGORIES,
    weights: { '1': 40, '2': 60 }, bucketWeights: { CORE: 100 }, targetTotalAmount: 10_000_000,
  });
  check('computeCoreBands 2건', bands.length, 2);
  const b1 = bands.find(b => b.key === '1')!;
  check('cat1 SELL', b1.direction, 'SELL');
  checkClose('cat1 difference -1,000,000', b1.difference, -1_000_000);
  const b2 = bands.find(b => b.key === '2')!;
  check('cat2 BUY', b2.direction, 'BUY');
}
{
  // 편집값 vs 저장본 주입 차이 — 목표 50/50이면 밴드 안(0건)
  const assets = [mkCoreAsset('a1', 1, 100, 50_000), mkCoreAsset('a2', 2, 100, 50_000)];
  const inBand = computeCoreBands({ assets, rates, categories: DEFAULT_CATEGORIES, weights: { '1': 50, '2': 50 }, bucketWeights: { CORE: 100 }, targetTotalAmount: 10_000_000 });
  check('목표 50/50 → 0건', inBand.length, 0);
}
{
  // 코어 목표금액 0 (CORE 0%) → fail-closed
  const assets = [mkCoreAsset('a1', 1, 100, 50_000)];
  check('CORE 0% → []', computeCoreBands({ assets, rates, categories: DEFAULT_CATEGORIES, weights: { '1': 40 }, bucketWeights: { CORE: 0 }, targetTotalAmount: 10_000_000 }).length, 0);
  check('총목표 0 → []', computeCoreBands({ assets, rates, categories: DEFAULT_CATEGORIES, weights: { '1': 40 }, bucketWeights: { CORE: 100 }, targetTotalAmount: 0 }).length, 0);
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ rebalanceBands parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ rebalanceBands parity 전체 통과 (${pass} 단언)`);
