import assert from 'node:assert/strict';
import { Currency, type Asset, type SellRecord } from '../types';
import { hasUnresolvedOwners, matchesOwnerFilter, withoutJointLabel } from '../types/owner';
import { ownerTradeEntries, splitOwnerHolding } from '../utils/ownerTransactions';

const original: Asset = {
  id: 'old', categoryId: 2, ticker: 'ETF', name: 'Example (H)', customName: '유선&원종_Example (H)',
  owner: 'YUSEON', exchange: 'AMEX', currency: Currency.USD, quantity: 0.3, purchasePrice: 52,
  priceOriginal: 55, currentPrice: 55, highestPrice: 60, purchaseExchangeRate: 1300, purchaseDate: '2025-01-01',
  memo: '원종 & 유선 보유분', sellTransactions: [{ id: 'inline', sellDate: '2026-01-02', sellPrice: 80000, sellQuantity: 1 }],
};
const recorded: SellRecord = { assetId: original.id, ticker: 'ETF', name: 'Example', categoryId: 2,
  id: 'global', sellDate: '2026-01-03', sellPrice: 80000, sellQuantity: 1,
  originalPurchasePrice: 40, originalCurrency: Currency.USD, owner: 'WONJONG' };
const snapshot = { assets: [original], sellHistory: [recorded], turtlePositions: [], actionQueue: [] };
const ids = { WONJONG: 'new-w', YUSEON: 'new-y' };
const input = { assetId: 'old', expectedQuantity: 0.3,
  balances: { WONJONG: {quantity: 0.1, price: 50, rate: 1310}, YUSEON: {quantity: 0.2, price: 53, rate: 1290} } };
const date = '2026-11-27';
assert.equal(matchesOwnerFilter(original, 'YUSEON'), false);
assert.equal(matchesOwnerFilter(original, 'ALL'), true);
assert.equal(withoutJointLabel('유선&원종_Example (H)'), 'Example (H)');
assert.equal(withoutJointLabel('Example (H) (원종 / 유선)'), 'Example (H)');
const result = splitOwnerHolding(snapshot, input, ids, date);
assert(result.ok);
assert.deepEqual(result.assets.map(a => [a.id,a.owner,a.quantity,a.purchasePrice,a.purchaseExchangeRate]),
  [['new-w','WONJONG',0.1,50,1310],['new-y','YUSEON',0.2,53,1290]]);
for (const a of result.assets) {
  assert.equal(a.name, 'Example (H)');
  assert.equal(a.memo, original.memo);
  assert.equal(a.ownerAllocation?.sourceId, original.id);
  assert.equal(hasUnresolvedOwners(a), false);
  assert.equal(a.sellTransactions, undefined);
}
assert.equal(result.sellHistory.length,2);
assert.deepEqual(result.sellHistory[0],recorded);
assert.equal(result.sellHistory[1].assetId,'old');
assert.equal(result.sellHistory[1].owner,undefined);
assert.deepEqual(ownerTradeEntries([],result.sellHistory,result.assets).map(row=>[row.key,row.owner,row.currency]),
  [['sell-old-global','WONJONG','KRW'],['sell-old-inline',undefined,'KRW']]);
assert.equal(splitOwnerHolding({...snapshot,...result},input,ids,date).ok,false);
assert.equal(splitOwnerHolding(snapshot,{...input,expectedQuantity:12},ids,date).ok,false);
assert.equal(splitOwnerHolding(snapshot,{...input,balances:{...input.balances,YUSEON:{quantity:0.5,price:53,rate:1290}}},ids,date).ok,false);
assert.equal(splitOwnerHolding(snapshot,{...input,balances:{...input.balances,YUSEON:{quantity:0.2,price:53,rate:0}}},ids,date).ok,false);
assert.equal(splitOwnerHolding({...snapshot,assets:[original,result.assets[0]]},input,ids,date).ok,false);
