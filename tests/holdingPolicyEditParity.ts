import { strict as assert } from 'node:assert';
import { Currency, type Asset } from '../types';
import type { HoldingPolicyEdit } from '../types/holdingPolicyUi';
import { getHoldingPrincipalKRW } from '../utils/holdingPolicy';
import { buildHoldingPolicyChange, holdingPolicySuggestion } from '../utils/holdingPolicyEdit';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HoldingPolicyControl from '../components/portfolio-table/HoldingPolicyControl';

const asset: Asset = {
  id: 'one', owner: 'WONJONG', ticker: 'EXAMPLE', exchange: 'NASDAQ', name: '테스트',
  categoryId: 2, currency: Currency.USD, quantity: 4, purchasePrice: 100,
  purchaseDate: '2020-01-01', currentPrice: 110, priceOriginal: 110, highestPrice: 115,
};
const edit: HoldingPolicyEdit = {
  assetId: 'one', owner: 'WONJONG', expectedQuantity: 4, mode: 'turtle-after-cost',
  sellCostPct: 0, confirmedPrincipalKRW: 400_000,
};
const when = new Date('2026-11-27T03:01:00Z'); // NY 11월 26일
assert.equal(holdingPolicySuggestion(9_999_999), '1천만원 미만 · 본전 정리 제안');
assert.equal(holdingPolicySuggestion(10_000_000), '1천만원 이상 · 본전부터 터틀 제안');
assert.equal(holdingPolicySuggestion(null), '원금 확인 후 분류');
const commonControl = (holding: Asset) => renderToStaticMarkup(createElement(HoldingPolicyControl, { asset: holding, onOpen: () => {} }));
assert.match(commonControl(asset), /원금 확인 후 분류/);
assert.match(commonControl({ ...asset, currency: Currency.KRW, purchasePrice: 2_500_000 }), /1천만원 이상 · 본전부터 터틀 제안/);
assert.doesNotMatch(commonControl({ ...asset, holdingPolicy: { mode: 'hold' } }), /제안|원금 확인 후 분류/);
const result = buildHoldingPolicyChange(asset, edit, when, 'A');
assert(result.ok && result.policy);
assert.equal(result.policy.startedOn, '2026-11-26');
assert.equal(result.policy.sellCostPct, 0);
assert.equal(result.policy.pyramidingEnabled, false);
assert.equal(result.policy.confirmedUnitCostKRW, 100_000);
assert.equal(getHoldingPrincipalKRW({ ...asset, quantity: 2, holdingPolicy: result.policy }), 200_000);
const armed = { ...asset, holdingPolicy: { ...result.policy, armedOn: '2026-11-26' } };
const liveEdit = { ...edit, expectedCycleId: 'A' };
const changed = (edits: Partial<HoldingPolicyEdit>) => buildHoldingPolicyChange(armed, { ...liveEdit, ...edits }, when, 'B');
const toggle = changed({ pyramidingEnabled: true });
assert(toggle.ok && toggle.policy);
assert.equal(toggle.policy.pyramidingEnabled, true);
assert.equal(toggle.policy.cycleId, 'A');
assert.equal(toggle.policy.armedOn, '2026-11-26');
const costs = changed({ sellCostPct: 0.25 });
assert(costs.ok && costs.policy);
assert.equal(costs.policy.cycleId, 'B');
assert.equal(costs.policy.armedOn, '2026-11-26');
for (const edits of [{ expectedCycleId: 'old' }, { expectedQuantity: 3 }, { owner: 'YUSEON' as const },
  { sellCostPct: -1 }, { sellCostPct: Number.NaN }, { sellCostPct: 100 }, { confirmedPrincipalKRW: 0 }]) {
  assert.equal(changed(edits).ok, false);
}
const blank = changed({ sellCostPct: undefined, confirmedPrincipalKRW: undefined, mode: 'exit-at-cost' });
assert(blank.ok && blank.policy);
assert.equal(blank.policy.sellCostPct, undefined);
assert.equal(blank.policy.armedOn, undefined);
assert.equal(getHoldingPrincipalKRW({ ...asset, purchaseExchangeRate: 1_550, holdingPolicy: blank.policy }), 620_000);
assert.equal(getHoldingPrincipalKRW({ ...asset, quantity: 2, purchaseExchangeRate: 1_550 }), 310_000);
assert.equal(getHoldingPrincipalKRW({ ...asset, purchaseExchangeRate: 0 }), null);
const cleared = changed({ mode: null });
assert(cleared.ok && cleared.policy === undefined);
const conflict = buildHoldingPolicyChange({ ...armed, memo: '원종&유선 공동' }, liveEdit, when, 'B');
assert.equal(conflict.ok, false);
const needsConfirmation = buildHoldingPolicyChange({ ...asset, currency: Currency.KRW,
  holdingPolicy: { ...armed.holdingPolicy, confirmedUnitCostKRW: undefined, requiresCostConfirmation: true } },
  { ...liveEdit, confirmedPrincipalKRW: undefined, sellCostPct: 0.8 }, when, 'B');
assert(needsConfirmation.ok && needsConfirmation.policy?.requiresCostConfirmation);
process.stdout.write('보유 방침 편집 · 실제 원금 · 계정 충돌 · 활성일 보존 통과\n');
