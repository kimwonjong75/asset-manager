// tests/assetMutationsParity.ts
// ---------------------------------------------------------------------------
// 매도/추가매수 순수 mutation helper 골든 테스트 (Phase 2b-4b-2d 기반).
// 기존 useAssetActions 핸들러 수식과 1:1 동일함을 절대값으로 고정 — 추출 후에도 일반 흐름 불변 보장.
// 수동 실행: npm run test:assetmut (tsx). 통과 시 exit 0.

import { Asset, Currency, SellRecord } from '../types';
import { buildSellMutation, buildBuyMoreMutation } from '../utils/assetMutations';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function checkClose(name: string, actual: number, expected: number, eps = 1e-6): void {
  if (Math.abs(actual - expected) <= eps) pass++; else fails.push(`✗ ${name}: got ${actual}, expected ${expected}`);
}

function mkAsset(p: Partial<Asset> & { id: string; currency: Currency; quantity: number; purchasePrice: number }): Asset {
  return {
    categoryId: 5, ticker: 'T', exchange: 'X', name: '종목', purchaseDate: '2026-01-01',
    currentPrice: 0, priceOriginal: 0, highestPrice: 0, ...p,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. buildSellMutation — KRW 전량 매도 (자산 제거)
// ════════════════════════════════════════════════════════════════════════════
{
  const asset = mkAsset({ id: 'a', currency: Currency.KRW, quantity: 100, purchasePrice: 1000 });
  const r = buildSellMutation({
    asset, assets: [asset], sellHistory: [], sellExchangeRate: 1, sellPrice: 1200,
    sellQuantity: 100, sellDate: '2026-07-05', settlementCurrency: Currency.KRW, transactionId: 'tx1',
  });
  check('KRW 전량 → assetClosed', r.assetClosed, true);
  check('KRW 전량 → nextAssets 빈배열', r.nextAssets, []);
  check('sellRecord.id = 주입 id', r.sellRecord.id, 'tx1');
  checkClose('KRW sellPrice(=price×rate)', r.sellRecord.sellPrice, 1200);
  checkClose('KRW sellPriceOriginal', r.sellRecord.sellPriceOriginal!, 1200);
  check('nextSellHistory 길이 1', r.nextSellHistory.length, 1);
  check('sellRecord.assetId', r.sellRecord.assetId, 'a');
}

// ════════════════════════════════════════════════════════════════════════════
// 2. buildSellMutation — USD 부분 매도 (수량 차감 + sellTransactions 추가)
// ════════════════════════════════════════════════════════════════════════════
{
  const asset = mkAsset({ id: 'u', currency: Currency.USD, quantity: 10, purchasePrice: 90, purchaseExchangeRate: 1400 });
  const r = buildSellMutation({
    asset, assets: [asset], sellHistory: [], sellExchangeRate: 1400, sellPrice: 100,
    sellQuantity: 4, sellDate: '2026-07-05', settlementCurrency: Currency.USD, transactionId: 'tx2',
  });
  check('USD 부분 → not closed', r.assetClosed, false);
  check('USD 부분 → 수량 6', r.nextAssets[0].quantity, 6);
  check('USD 부분 → sellTransactions 1건', r.nextAssets[0].sellTransactions?.length, 1);
  checkClose('USD sellPriceOriginal(=price, 동일통화)', r.sellRecord.sellPriceOriginal!, 100);
  checkClose('USD sellPrice(=price×rate)', r.sellRecord.sellPrice, 140000);
  check('원본 assets 불변', asset.quantity, 10);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. buildBuyMoreMutation — KRW 가중평균
// ════════════════════════════════════════════════════════════════════════════
{
  const asset = mkAsset({ id: 'k', currency: Currency.KRW, quantity: 100, purchasePrice: 1000 });
  const r = buildBuyMoreMutation({ asset, assets: [asset], buyExchangeRate: 1, buyPrice: 1200, buyQuantity: 100, buyDate: '2026-07-05' });
  check('KRW 총수량 200', r.updatedAsset.quantity, 200);
  checkClose('KRW 가중평균 1100', r.updatedAsset.purchasePrice, 1100); // (100×1000+100×1200)/200
  check('nextAssets 반영', r.nextAssets[0].purchasePrice, 1100);
  check('원본 불변', asset.quantity, 100);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. buildBuyMoreMutation — USD 가중평균 단가 + 가중평균 환율
// ════════════════════════════════════════════════════════════════════════════
{
  const asset = mkAsset({ id: 'ud', currency: Currency.USD, quantity: 10, purchasePrice: 100, purchaseExchangeRate: 1400 });
  const r = buildBuyMoreMutation({ asset, assets: [asset], buyExchangeRate: 1450, buyPrice: 120, buyQuantity: 10, buyDate: '2026-07-05' });
  check('USD 총수량 20', r.updatedAsset.quantity, 20);
  checkClose('USD 가중평균 단가 110', r.updatedAsset.purchasePrice, 110); // (10×100+10×120)/20
  checkClose('USD 가중평균 환율 1425', r.updatedAsset.purchaseExchangeRate!, 1425); // (10×1400+10×1450)/20
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ assetMutations parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  console.error(`\n통과 ${pass} / 실패 ${fails.length}`);
  process.exit(1);
} else {
  console.log(`✅ assetMutations parity 전체 통과 (${pass} 단언)`);
}
