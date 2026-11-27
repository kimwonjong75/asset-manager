import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useAssetActions } from '../hooks/useAssetActions';
import { Currency, type Asset } from '../types';
import { mergeSaveSnapshot, type PortfolioSaveSnapshot } from '../types/portfolioSave';
import { DEFAULT_CATEGORY_STORE } from '../types/category';
import { DEFAULT_TURTLE_SETTINGS } from '../types/turtle';
import { DEFAULT_VALUATION_SETTINGS } from '../types/valuation';
import { hasDifferentTurtleFillCurrency } from '../utils/holdingTradeCurrency';
import { applyUpbitHoldingQuote } from '../utils/applyMarketQuotes';

// 실제 거래 훅의 잔고/원장/감시 커밋을 인메모리에서 관측한다. KRW이면 네트워크 요청이 필요 없다.
const asset: Asset = { id: 'synth', name: '합성', ticker: 'SYNTH', categoryId: 1, exchange: 'KRX',
  currency: Currency.KRW, owner: 'WONJONG', quantity: 5, purchasePrice: 100, purchaseDate: '2026-10-01',
  currentPrice: 114, priceOriginal: 114, highestPrice: 130, holdingPolicy: { mode: 'exit-at-cost', sellCostPct: 0 } };
const family: Asset = { ...asset, id: 'family-synth', owner: 'YUSEON', holdingPolicy: { mode: 'hold' } };
let snapshot: PortfolioSaveSnapshot = { assets: [asset, family], sellHistory: [], buyHistory: [], watchlist: [],
  portfolioHistory: [], exchangeRates: { USD: 1500, JPY: 10 }, allocationTargets: { weights: {} },
  sellAlertDropRate: 10, categoryStore: DEFAULT_CATEGORY_STORE, actionQueue: [], turtlePositions: [],
  knowledgeBase: { version: 2, sources: [], claims: [], rules: [], journal: [], lastUpdated: '2026-10-01' },
  turtleSettings: DEFAULT_TURTLE_SETTINGS, valuationSettings: DEFAULT_VALUATION_SETTINGS };
let actions!: ReturnType<typeof useAssetActions>;
let commits = 0;
function CaptureActions() {
  actions = useAssetActions({ assets: snapshot.assets, exchangeRates: snapshot.exchangeRates, isSignedIn: true,
    getSnapshot: () => snapshot, commitPortfolioPatch: patch => { snapshot = mergeSaveSnapshot(snapshot, patch); commits++; },
    setError: () => {}, setSuccessMessage: () => {} });
  return null;
}
renderToStaticMarkup(createElement(CaptureActions));
assert.equal(commits, 0, '화면을 열거나 아무 행동 없이 기다려도 매도 원장에 변화가 없다');
assert.equal(hasDifferentTurtleFillCurrency('Upbit', Currency.USD), true);
assert.equal(hasDifferentTurtleFillCurrency('Bithumb', undefined), true);
assert.equal(hasDifferentTurtleFillCurrency('Upbit', Currency.KRW), false);
assert.equal(hasDifferentTurtleFillCurrency('NASDAQ', Currency.USD), false);
const legacyCoin = { ...asset, exchange: 'Upbit', currency: Currency.USD, purchasePrice: 80, purchaseExchangeRate: 1300 };
const quotedCoin = applyUpbitHoldingQuote(legacyCoin, { market: 'KRW-SYN', trade_price: 110000, prev_closing_price: 109500,
  signed_change_price: 500, signed_change_rate: 500 / 109500 });
assert.deepEqual([quotedCoin.priceOriginal, quotedCoin.currency, quotedCoin.purchasePrice, quotedCoin.purchaseExchangeRate],
  [110000, Currency.USD, 80, 1300], '원화 시세 갱신은 달러 매입원가를 보존');

const date = '2026-11-15';
for (const invalid of ['2099-01-01', '2025-02-30']) {
  assert.deepEqual(await actions.handleConfirmSell(asset.id, 5, 114, invalid), { ok: false, reason: 'invalid-fill' });
  assert.equal(commits, 0);
}
const partial = await actions.handleConfirmSell(asset.id, 2, 109, date, Currency.KRW, true);
assert.equal(partial.ok, true);
assert.equal(commits, 1);
assert.equal(snapshot.assets.find(a => a.id === asset.id)?.quantity, 3);
assert.deepEqual(snapshot.sellHistory.map(r => [r.sellDate, r.sellQuantity, r.sellPriceOriginal]), [[date, 2, 109]]);
assert.equal(snapshot.watchlist.length, 0);

const full = await actions.handleConfirmSell(asset.id, 3, 110, date, Currency.KRW, true);
assert.equal(full.ok, true);
assert.equal(commits, 2, '전량 체결과 감시 변경이 한 번의 커밋');
assert.equal(snapshot.watchlist.length, 0, '구 체크박스가 켜져도 영구 정리');
assert.deepEqual(snapshot.assets, [family]);
assert.equal(snapshot.sellHistory[1].closedHolding?.policy?.mode, 'exit-at-cost');

const retry = await actions.handleConfirmSell(asset.id, 3, 110, date, Currency.KRW, true);
assert.equal(retry.ok, false);
assert.equal(commits, 2);

const active: Asset = { ...asset, holdingPolicy: { mode: 'turtle-after-cost', armedOn: '2026-11-13', sellCostPct: 0 } };
snapshot = { ...snapshot, assets: [family, active] };
const turtle = await actions.handleConfirmSell(active.id, 5, 103, date, Currency.KRW, false);
assert.equal(turtle.ok, true);
assert.equal(commits, 3);
assert.deepEqual(snapshot.watchlist.map(w => [w.owner, w.turtleWatch?.soldAt, w.turtleWatch?.soldPriceOriginal]), [['WONJONG', date, 103]]);
assert.equal(snapshot.sellHistory[2].sellQuantity, 5);

const buy = await actions.handleConfirmBuyMore(family.id, 1, 112, date, () => ({ ok: false, reason: 'policy-blocked' }));
assert.deepEqual(buy, { ok: false, reason: 'policy-blocked' });
assert.equal(commits, 3, '불타기 검증 실패 시 매수 원장 쓰기 없음');
assert.equal(snapshot.buyHistory.length, 0);
assert.deepEqual(snapshot.assets, [family]);
process.stdout.write('실제 체결 훅의 미체결·부분·전량·재시도·계정·감시·불타기 원자성 통과\n');
