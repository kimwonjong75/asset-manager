// tests/cleanupPlanParity.ts
// ---------------------------------------------------------------------------
// Phase 3 대청소 순수 계산(3a) 골든 테스트 — 후보 선정·자동 제안·세금 참고 추정.
// 수동 실행: npm run test:cleanup (tsx). 통과 시 exit 0.

import { Asset, Currency, ExchangeRates, SellRecord } from '../types';
import { EnrichedAsset, AssetMetrics } from '../types/ui';
import {
  selectCleanupCandidates,
  suggestCleanupTag,
  isForeignSettlement,
  realizedForeignGainYTD,
  plannedForeignGainKRW,
  estimateForeignCapGainsTax,
  applyCleanupDecisions,
  buildCleanupCommit,
} from '../utils/cleanupPlan';
import { CleanupDecision } from '../types/cleanup';
import { WatchlistItem } from '../types';
import { ActionItem } from '../types/actionQueue';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function checkClose(name: string, actual: number, expected: number, eps = 1e-6): void {
  if (Math.abs(actual - expected) <= eps) pass++; else fails.push(`✗ ${name}: got ${actual}, expected ${expected}`);
}

const rates: ExchangeRates = { USD: 1450, JPY: 9.5 };

function mkMetrics(over: Partial<AssetMetrics>): AssetMetrics {
  return {
    purchasePrice: 0, currentPrice: 0, currentPriceKRW: 0, purchasePriceKRW: 0,
    purchaseValue: 0, currentValue: 0, purchaseValueKRW: 0, currentValueKRW: 0,
    returnPercentage: 0, allocation: 0, dropFromHigh: 0, profitLoss: 0, profitLossKRW: 0,
    diffFromHigh: 0, yesterdayChange: 0, diffFromYesterday: 0, ...over,
  };
}
function mkEnriched(p: {
  id: string; currency?: Currency; bucket?: 'CORE' | 'SATELLITE';
  returnPercentage: number; allocation: number; currentValueKRW?: number; profitLossKRW?: number;
}): EnrichedAsset {
  const asset: Asset = {
    id: p.id, categoryId: 2, ticker: `T-${p.id}`, exchange: 'NASDAQ', name: p.id,
    quantity: 10, purchasePrice: 100, purchaseDate: '2025-01-01',
    currency: p.currency ?? Currency.USD, currentPrice: 100, priceOriginal: 100, highestPrice: 100,
    bucket: p.bucket,
  };
  return {
    ...asset,
    metrics: mkMetrics({ returnPercentage: p.returnPercentage, allocation: p.allocation, currentValueKRW: p.currentValueKRW ?? 0, profitLossKRW: p.profitLossKRW ?? 0 }),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. suggestCleanupTag — 자동 제안 분기 (core/turtle은 자동 제안 안 함)
// ════════════════════════════════════════════════════════════════════════════
check('deepLoss+dust → liquidate', suggestCleanupTag({ loss: true, deepLoss: true, dust: true, foreign: false }).tag, 'liquidate');
check('deepLoss만 → liquidate', suggestCleanupTag({ loss: true, deepLoss: true, dust: false, foreign: false }).tag, 'liquidate');
check('dust+loss → liquidate', suggestCleanupTag({ loss: true, deepLoss: false, dust: true, foreign: false }).tag, 'liquidate');
check('작은 손실 → keep', suggestCleanupTag({ loss: true, deepLoss: false, dust: false, foreign: false }).tag, 'keep');
check('이익 먼지 → keep', suggestCleanupTag({ loss: false, deepLoss: false, dust: true, foreign: false }).tag, 'keep');

// ════════════════════════════════════════════════════════════════════════════
// 2. selectCleanupCandidates — 선정/제외/플래그
// ════════════════════════════════════════════════════════════════════════════
{
  const assets: EnrichedAsset[] = [
    mkEnriched({ id: 'deepDust', returnPercentage: -60, allocation: 0.3, currency: Currency.USD }),   // 깊은손실+먼지
    mkEnriched({ id: 'deepOnly', returnPercentage: -55, allocation: 5, currency: Currency.KRW }),      // 깊은손실
    mkEnriched({ id: 'dustLoss', returnPercentage: -10, allocation: 0.5, currency: Currency.JPY }),    // 먼지+손실
    mkEnriched({ id: 'smallLoss', returnPercentage: -8, allocation: 4, currency: Currency.KRW }),      // 작은손실
    mkEnriched({ id: 'winnerBig', returnPercentage: 30, allocation: 10, currency: Currency.KRW }),     // 이익+큰비중 → 제외
    mkEnriched({ id: 'winnerDust', returnPercentage: 12, allocation: 0.2, currency: Currency.USD }),   // 이익 먼지 → 포함(dust)
  ];
  const cands = selectCleanupCandidates(assets);
  check('선정 수 (이익+큰비중 제외 → 5)', cands.length, 5);
  check('winnerBig 제외', cands.some(c => c.assetId === 'winnerBig'), false);
  check('winnerDust 포함(먼지)', cands.some(c => c.assetId === 'winnerDust'), true);

  const byId = (id: string) => cands.find(c => c.assetId === id)!;
  check('deepDust suggest liquidate', byId('deepDust').suggestedTag, 'liquidate');
  check('deepDust deepLoss+dust', [byId('deepDust').flags.deepLoss, byId('deepDust').flags.dust], [true, true]);
  check('deepDust foreign(USD)', byId('deepDust').flags.foreign, true);
  check('deepOnly suggest liquidate', byId('deepOnly').suggestedTag, 'liquidate');
  check('deepOnly foreign=false(KRW)', byId('deepOnly').flags.foreign, false);
  check('dustLoss suggest liquidate', byId('dustLoss').suggestedTag, 'liquidate');
  check('smallLoss suggest keep', byId('smallLoss').suggestedTag, 'keep');
  check('winnerDust suggest keep', byId('winnerDust').suggestedTag, 'keep');
  check('winnerDust loss=false', byId('winnerDust').flags.loss, false);
}
{
  // 임계값 커스터마이즈
  const assets = [mkEnriched({ id: 'x', returnPercentage: -40, allocation: 2, currency: Currency.KRW })];
  check('기본 임계(-50)에선 deepLoss 아님', selectCleanupCandidates(assets)[0].flags.deepLoss, false);
  check('임계 -30이면 deepLoss', selectCleanupCandidates(assets, { deepLossThresholdPct: -30 })[0].flags.deepLoss, true);
}
{
  // isExcluded predicate (가족/유선 제외)
  const assets = [
    mkEnriched({ id: 'keepMe', returnPercentage: -20, allocation: 0.5 }),
    mkEnriched({ id: 'family', returnPercentage: -20, allocation: 0.5 }),
  ];
  const cands = selectCleanupCandidates(assets, {}, a => a.id === 'family');
  check('제외 predicate 적용', cands.map(c => c.assetId), ['keepMe']);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. isForeignSettlement
// ════════════════════════════════════════════════════════════════════════════
check('USD foreign', isForeignSettlement(Currency.USD), true);
check('JPY foreign', isForeignSettlement(Currency.JPY), true);
check('KRW 국내', isForeignSettlement(Currency.KRW), false);
check('undefined 국내', isForeignSettlement(undefined), false);

// ════════════════════════════════════════════════════════════════════════════
// 4. realizedForeignGainYTD — 해외·당해년만 집계
// ════════════════════════════════════════════════════════════════════════════
{
  const mkSell = (o: Partial<SellRecord> & { id: string }): SellRecord => ({
    assetId: 'a', ticker: 'T', name: 'T', categoryId: 2,
    sellDate: '2026-03-01', sellPrice: 0, sellQuantity: 10, ...o,
  });
  const history: SellRecord[] = [
    // 해외(USD) 2026: 매도 174,000×10=1,740,000, 매수 100×1400×10=1,400,000 → +340,000
    mkSell({ id: 'f26', settlementCurrency: Currency.USD, sellPrice: 174_000, sellPriceOriginal: 120, sellExchangeRate: 1450, originalPurchasePrice: 100, originalPurchaseExchangeRate: 1400, originalCurrency: Currency.USD }),
    // 국내(KRW) 2026 → 제외
    mkSell({ id: 'k26', settlementCurrency: Currency.KRW, sellPrice: 5000, originalPurchasePrice: 4000, originalCurrency: Currency.KRW }),
    // 해외(USD) 2025 → 제외
    mkSell({ id: 'f25', sellDate: '2025-12-31', settlementCurrency: Currency.USD, sellPrice: 200_000, sellPriceOriginal: 130, sellExchangeRate: 1450, originalPurchasePrice: 100, originalPurchaseExchangeRate: 1400, originalCurrency: Currency.USD }),
  ];
  checkClose('실현 해외손익 2026 = 340,000', realizedForeignGainYTD(history, [], rates, 2026), 340_000);
  checkClose('실현 해외손익 2025 = +... (다른해)', realizedForeignGainYTD(history, [], rates, 2025), 200_000 * 10 - 100 * 1400 * 10);
}
{
  // 비정상 환율 보정: sellExchangeRate 5000(>3000) → 현재환율 1450 사용
  const rec: SellRecord = {
    id: 'abn', assetId: 'a', ticker: 'T', name: 'T', categoryId: 2, sellDate: '2026-05-01',
    settlementCurrency: Currency.USD, sellPrice: 999_999, sellPriceOriginal: 120, sellExchangeRate: 5000, sellQuantity: 10,
    originalPurchasePrice: 100, originalPurchaseExchangeRate: 1400, originalCurrency: Currency.USD,
  };
  // sellAmount 보정 = 120×1450×10 = 1,740,000, 매수 1,400,000 → +340,000 (999,999 무시)
  checkClose('비정상 환율 보정 적용', realizedForeignGainYTD([rec], [], rates, 2026), 340_000);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. plannedForeignGainKRW — 선택된 해외 청산 후보만
// ════════════════════════════════════════════════════════════════════════════
{
  const cands = selectCleanupCandidates([
    mkEnriched({ id: 'usdLoss', returnPercentage: -60, allocation: 0.3, currency: Currency.USD, profitLossKRW: -2_000_000 }),
    mkEnriched({ id: 'krwLoss', returnPercentage: -60, allocation: 0.3, currency: Currency.KRW, profitLossKRW: -1_000_000 }),
    mkEnriched({ id: 'usdWin', returnPercentage: -5, allocation: 0.4, currency: Currency.USD, profitLossKRW: 500_000 }),
  ]);
  const planned = new Set(['usdLoss', 'krwLoss', 'usdWin']);
  // 해외만: usdLoss(-2M) + usdWin(+0.5M) = -1.5M (krwLoss 제외)
  checkClose('예정 해외손익(해외만 합산)', plannedForeignGainKRW(cands, planned), -1_500_000);
  checkClose('선택 안 하면 0', plannedForeignGainKRW(cands, new Set()), 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. estimateForeignCapGainsTax — 공제·세율·통산 절감
// ════════════════════════════════════════════════════════════════════════════
{
  // 실현 +5,000,000, 예정 0 → taxable 2,500,000 × 0.22 = 550,000, 절감 0
  const t = estimateForeignCapGainsTax({ realizedForeignGainKRW: 5_000_000, plannedForeignGainKRW: 0, year: 2026 });
  checkClose('taxable', t.taxableKRW, 2_500_000);
  checkClose('estimatedTax', t.estimatedTaxKRW, 550_000);
  checkClose('offset 0', t.offsetSavingsKRW, 0);
  check('참고 플래그', t.isReference, true);
  check('세율 0.22', t.rate, 0.22);
}
{
  // 실현 +5,000,000, 예정 손실 -3,000,000 → net 2,000,000 → taxable 0 → tax 0
  // 절감 = 예정없이 550,000 → 0 = 550,000
  const t = estimateForeignCapGainsTax({ realizedForeignGainKRW: 5_000_000, plannedForeignGainKRW: -3_000_000, year: 2026 });
  checkClose('통산 후 taxable 0', t.taxableKRW, 0);
  checkClose('통산 후 tax 0', t.estimatedTaxKRW, 0);
  checkClose('통산 절감 550,000', t.offsetSavingsKRW, 550_000);
}
{
  // 예정 이익 추가: 실현 5M + 예정 1M → net 6M → taxable 3.5M × 0.22 = 770,000
  const t = estimateForeignCapGainsTax({ realizedForeignGainKRW: 5_000_000, plannedForeignGainKRW: 1_000_000, year: 2026 });
  checkClose('예정 이익 포함 tax', t.estimatedTaxKRW, 770_000);
  checkClose('이익 추가 시 절감 0', t.offsetSavingsKRW, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 7. applyCleanupDecisions — 일괄 분류 저장 (기본값 강제 없음·버킷 효과·false 미저장)
// ════════════════════════════════════════════════════════════════════════════
{
  const mkA = (id: string, over: Partial<Asset> = {}): Asset => ({
    id, categoryId: 2, ticker: id, exchange: 'NASDAQ', name: id, quantity: 1,
    purchasePrice: 1, purchaseDate: '2025-01-01', currency: Currency.USD,
    currentPrice: 1, priceOriginal: 1, highestPrice: 1, ...over,
  });
  const assets: Asset[] = [
    mkA('core'), mkA('turtle'), mkA('liq', { bucket: 'CORE' }), mkA('keep'),
    mkA('excl'), mkA('unexcl', { excludedFromCleanup: true }), mkA('untouched', { bucket: 'SATELLITE' }),
  ];
  const decisions: Record<string, CleanupDecision> = {
    core: { cleanupTag: 'core' },
    turtle: { cleanupTag: 'turtle' },
    liq: { cleanupTag: 'liquidate' },
    keep: { cleanupTag: 'keep' },
    excl: { excludedFromCleanup: true },
    unexcl: { excludedFromCleanup: false },
    // untouched: 결정 없음
  };
  const next = applyCleanupDecisions(assets, decisions);
  const by = (id: string) => next.find(a => a.id === id)!;

  check('core → tag core', by('core').cleanupTag, 'core');
  check('core → bucket CORE', by('core').bucket, 'CORE');
  check('turtle → tag turtle', by('turtle').cleanupTag, 'turtle');
  check('turtle → bucket SATELLITE', by('turtle').bucket, 'SATELLITE');
  check('liquidate → tag liquidate', by('liq').cleanupTag, 'liquidate');
  check('liquidate → bucket 불변(CORE)', by('liq').bucket, 'CORE');
  check('keep → tag keep', by('keep').cleanupTag, 'keep');
  check('keep → bucket 불변(undefined)', by('keep').bucket, undefined);
  check('excl → excludedFromCleanup true', by('excl').excludedFromCleanup, true);
  check('excl → cleanupTag 미설정(미검토 보존)', by('excl').cleanupTag, undefined);
  check('unexcl(false) → 필드 제거(undefined)', by('unexcl').excludedFromCleanup, undefined);
  check('결정 없는 자산 불변(참조 동일)', by('untouched') === assets[6], true);
  check('결정 없는 자산 bucket 보존', by('untouched').bucket, 'SATELLITE');
  // 원본 불변(순수)
  check('원본 core 자산 미변경', assets[0].cleanupTag, undefined);
}

// ════════════════════════════════════════════════════════════════════════════
// 8. buildCleanupCommit — turtle→watchlist · liquidate→CLEANUP_SELL (이번 저장 변경분만·dedup)
// ════════════════════════════════════════════════════════════════════════════
{
  const mkA = (id: string, over: Partial<Asset> = {}): Asset => ({
    id, categoryId: 2, ticker: id.toUpperCase(), exchange: 'NASDAQ', name: id, quantity: 10,
    purchasePrice: 100, purchaseDate: '2025-01-01', currency: Currency.USD,
    currentPrice: 50, priceOriginal: 50, highestPrice: 100, ...over,
  });
  const makeId = (seq: number) => `cl-${seq}`;
  const opts = { today: '2026-07-05', makeId };

  // (1) turtle 신규 → watchlist 신규 항목(메타·priceOriginal·isTurtleCandidate)
  {
    const assets = [mkA('t1', { cleanupTag: undefined })];
    const r = buildCleanupCommit({ t1: { cleanupTag: 'turtle' } }, { assets, watchlist: [], actionQueue: [] }, opts);
    check('turtle 신규 watchlist 1건', r.watchlist.length, 1);
    check('watchlist ticker', r.watchlist[0].ticker, 'T1');
    check('watchlist isTurtleCandidate', r.watchlist[0].isTurtleCandidate, true);
    check('watchlist priceOriginal 채움', r.watchlist[0].priceOriginal, 50);
    check('watchlist id=makeId', r.watchlist[0].id, 'cl-0');
    check('summary watchRegistered 1', r.summary.watchRegistered, 1);
    check('assets bucket SATELLITE', r.assets[0].bucket, 'SATELLITE');
    check('CLEANUP_SELL 없음', r.actionQueue.length, 0);
  }

  // (2) turtle 이미 같은 ticker 존재 → isTurtleCandidate만 갱신, 신규 생성 안 함
  {
    const assets = [mkA('t1')];
    const wl: WatchlistItem[] = [{ id: 'w1', ticker: 'T1', exchange: 'NASDAQ', name: 't1', categoryId: 2 }];
    const r = buildCleanupCommit({ t1: { cleanupTag: 'turtle' } }, { assets, watchlist: wl, actionQueue: [] }, opts);
    check('기존 ticker → 신규 안 함(1건 유지)', r.watchlist.length, 1);
    check('기존 항목 후보 갱신', r.watchlist[0].isTurtleCandidate, true);
    check('id 보존', r.watchlist[0].id, 'w1');
    check('watchRegistered 1(갱신)', r.summary.watchRegistered, 1);
  }

  // (3) turtle인데 이미 후보 → no-op (watchRegistered 0)
  {
    const assets = [mkA('t1')];
    const wl: WatchlistItem[] = [{ id: 'w1', ticker: 'T1', exchange: 'NASDAQ', name: 't1', categoryId: 2, isTurtleCandidate: true }];
    const r = buildCleanupCommit({ t1: { cleanupTag: 'turtle' } }, { assets, watchlist: wl, actionQueue: [] }, opts);
    check('이미 후보 → watchRegistered 0', r.summary.watchRegistered, 0);
  }

  // (4) liquidate 신규 + price>0 → CLEANUP_SELL 생성(전량·refPrice·assetId)
  {
    const assets = [mkA('l1', { quantity: 7, priceOriginal: 42 })];
    const metricsOf = (id: string) => (id === 'l1' ? { returnPct: -58, profitLossKRW: -1_200_000 } : undefined);
    const r = buildCleanupCommit({ l1: { cleanupTag: 'liquidate' } }, { assets, watchlist: [], actionQueue: [] }, { ...opts, metricsOf });
    check('CLEANUP_SELL 1건', r.actionQueue.length, 1);
    const act = r.actionQueue[0];
    check('kind CLEANUP_SELL', act.kind, 'CLEANUP_SELL');
    check('assetId', act.assetId, 'l1');
    check('전량 수량', act.quantity, 7);
    check('refPrice=priceOriginal', act.refPrice, 42);
    check('status pending', act.status, 'pending');
    check('ruleSnapshot 숫자만(returnPct)', act.ruleSnapshot.returnPct, -58);
    check('summary cleanupGenerated 1', r.summary.cleanupGenerated, 1);
  }

  // (5) liquidate + price 0 → 생성 안 함, skippedNoPrice에 ticker
  {
    const assets = [mkA('l2', { priceOriginal: 0 })];
    const r = buildCleanupCommit({ l2: { cleanupTag: 'liquidate' } }, { assets, watchlist: [], actionQueue: [] }, opts);
    check('price 0 → 미생성', r.actionQueue.length, 0);
    check('skippedNoPrice에 ticker', r.summary.cleanupSkippedNoPrice, ['L2']);
  }

  // (6) liquidate dedup — 이미 active CLEANUP_SELL(같은 assetId) → 중복 생성 안 함
  {
    const assets = [mkA('l1', { priceOriginal: 42 })];
    const existing: ActionItem[] = [{ id: 'e', createdDate: '2026-07-04', kind: 'CLEANUP_SELL', ticker: 'L1', name: 'l1', assetId: 'l1', quantity: 10, refPrice: 42, reasonText: '', ruleSnapshot: {}, status: 'pending' }];
    const r = buildCleanupCommit({ l1: { cleanupTag: 'liquidate' } }, { assets, watchlist: [], actionQueue: existing }, opts);
    check('중복 pending → 미생성', r.actionQueue.length, 1);
    check('cleanupGenerated 0', r.summary.cleanupGenerated, 0);
  }

  // (7) 이미 그 태그였던 자산(변경 아님) → 부수효과 없음
  {
    const assets = [mkA('t1', { cleanupTag: 'turtle' }), mkA('l1', { cleanupTag: 'liquidate', priceOriginal: 42 })];
    const r = buildCleanupCommit({ t1: { cleanupTag: 'turtle' }, l1: { cleanupTag: 'liquidate' } }, { assets, watchlist: [], actionQueue: [] }, opts);
    check('기존 태그 재저장 → watchlist 0', r.watchlist.length, 0);
    check('기존 태그 재저장 → CLEANUP_SELL 0', r.actionQueue.length, 0);
  }

  // (8) 결정 없는 자산 → 전 도메인 무변경(참조 동일)
  {
    const assets = [mkA('x')];
    const wl: WatchlistItem[] = [{ id: 'w', ticker: 'Z', exchange: 'NASDAQ', name: 'z', categoryId: 2 }];
    const aq: ActionItem[] = [];
    const r = buildCleanupCommit({}, { assets, watchlist: wl, actionQueue: aq }, opts);
    check('watchlist 참조 동일', r.watchlist === wl, true);
    check('actionQueue 참조 동일', r.actionQueue === aq, true);
  }
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ cleanupPlan parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ cleanupPlan parity 전체 통과 (${pass} 단언)`);
