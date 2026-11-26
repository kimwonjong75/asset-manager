import assert from 'node:assert/strict';
import { Currency, type Asset } from '../types';
import { computeAssetMetrics } from '../utils/portfolioMetrics';
import { buildPortfolioOwnerGroups, commonHoldingValue, sharedPortfolioHoldingIds } from '../utils/portfolioOwnerGroups';
import { formatOwnerQuantity } from '../utils/ownerQuantity';

function stock(id: string, overrides: Partial<Asset> = {}) {
  const asset: Asset = {
    id, owner: 'WONJONG', categoryId: 2, ticker: 'QQQ', exchange: 'NASDAQ', name: 'QQQ',
    currency: Currency.USD, quantity: 64, purchasePrice: 400, currentPrice: 600, priceOriginal: 600, highestPrice: 620,
    purchaseDate: '2026-01-03', ...overrides,
  };
  return computeAssetMetrics(asset, { USD: 1400, JPY: 9 }, 100_000_000, { plBasis: 'native' });
}
const w = stock('w');
const y = stock('y', { owner: 'YUSEON', quantity: 8, purchasePrice: 500, purchaseDate: '2026-10-10' });
const separate = stock('other', { ticker: 'VTV', quantity: 70 });
const unknown = stock('legacy', { name: '원종&유선 QQQ' });
const zero = stock('zero', { ticker: 'VTV', owner: 'YUSEON', quantity: 0 });
const foreign = stock('foreign', { exchange: 'HKEX (홍콩)', owner: 'YUSEON' });
const units = [w, y, separate, unknown, zero, foreign];
assert.deepEqual([...sharedPortfolioHoldingIds(units)], ['w', 'y']);
const [joint, single, marked] = buildPortfolioOwnerGroups(units, 'ALL', null);
assert.deepEqual(joint.holdings, [w, y]);
assert.deepEqual(joint.quantities, { WONJONG: 64, YUSEON: 8 });
assert.deepEqual(joint.quantity, 72);
assert.equal(joint.currentValueKRW, 60_480_000);
assert.equal(joint.purchaseValueKRW, 41_440_000);
assert.equal(joint.profitLossKRW, 19_040_000);
assert.equal(joint.returnPercentage, 100 * 19_040_000 / 41_440_000);
assert.deepEqual(marked.quantities, {});
assert.equal(single.quantity, 70);
assert.equal(commonHoldingValue(joint.holdings, a => a.purchaseDate), null);
assert.equal(commonHoldingValue(joint.holdings, a => a.priceOriginal), 600);
assert.equal(commonHoldingValue([], a => a.priceOriginal), null);
assert.deepEqual(buildPortfolioOwnerGroups([separate, w, y], 'ALL', { key: 'quantity', direction: 'descending' }).map(g => g.quantity), [72, 70]);
assert.equal(buildPortfolioOwnerGroups([w, y], 'YUSEON', null).length, 2); // 개인 화면은 전달받은 실보유분 순서 보존
assert.deepEqual(buildPortfolioOwnerGroups([w, separate, stock('duplicate')], 'ALL', null).map(g => g.holdings[0].id), ['w', 'other', 'duplicate']);
assert.equal(buildPortfolioOwnerGroups([w], 'ALL', null)[0].quantity, 64);
assert.equal(buildPortfolioOwnerGroups([stock('z1', { purchasePrice: 0 }), stock('z2', { owner: 'YUSEON', purchasePrice: 0 })], 'ALL', null)[0].returnPercentage, null);
assert.equal(formatOwnerQuantity(w, 0.0125), '0.0125주');
assert.equal(formatOwnerQuantity(stock('cash', { categoryId: 9, purchasePrice: 1, currentPrice: 1 }), 13.5), '13.5 USD');
assert.equal(formatOwnerQuantity(stock('principal', { categoryId: 9 }), 1), '1단위');
const dollars = stock('rp1', { ticker: 'RP', categoryId: 9, name: 'USD RP 30일', currentPrice: 1, purchasePrice: 1 });
const otherUnit = stock('rp2', { ticker: 'RP', categoryId: 9, name: 'USD RP 30일', owner: 'YUSEON' });
const otherTerm = stock('rp3', { ticker: 'RP', categoryId: 9, name: 'USD RP 90일', currentPrice: 1, purchasePrice: 1, owner: 'YUSEON' });
assert.equal(buildPortfolioOwnerGroups([dollars, otherUnit, otherTerm], 'ALL', null).length, 3);
