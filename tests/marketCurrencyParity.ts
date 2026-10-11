import { Currency, type Asset, type ExchangeRates, type WatchlistItem } from '../types';
import { inferCurrencyFromExchange, isLikelyKrxTicker, resolveMarketCurrency } from '../utils/marketCurrency';
import { buildTurtleHoldingsChartTarget } from '../utils/turtleHoldingsDetail';
import type { TurtleHoldingsRow } from '../utils/turtleHoldingsView';

let pass = 0;
const fails: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass += 1;
  else fails.push(`✗ ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

check('KRX는 저장값이 USD여도 KRW', resolveMarketCurrency('KRX (코스피/코스닥)', undefined, Currency.USD), Currency.KRW);
check('NASDAQ은 저장값이 KRW여도 USD', resolveMarketCurrency('NASDAQ', undefined, Currency.KRW), Currency.USD);
check('KRX 6자리 숫자 티커 판정', isLikelyKrxTicker('309230'), true);
check('KRX 신형 영문 혼합 티커 판정', isLikelyKrxTicker('0047A0'), true);
check('미국 거래소로 잘못 저장된 KRX 티커는 KRW', resolveMarketCurrency('NASDAQ', undefined, Currency.USD, '309230'), Currency.KRW);
check('SSE 6자리 티커는 CNY 유지', resolveMarketCurrency('SSE (상하이)', undefined, Currency.KRW, '600519'), Currency.CNY);
check('TSE는 JPY', inferCurrencyFromExchange('TSE (도쿄)'), Currency.JPY);
check('SSE는 CNY', inferCurrencyFromExchange('SSE (상하이)'), Currency.CNY);
check('지원하지 않는 시장은 API 통화 우선', resolveMarketCurrency('HKEX (홍콩)', Currency.CNY, Currency.USD), Currency.CNY);
check('시장·API가 불명이면 저장 통화', resolveMarketCurrency('UNKNOWN', undefined, Currency.JPY), Currency.JPY);
check('통화 정보가 전부 없으면 KRW', resolveMarketCurrency(undefined), Currency.KRW);

const rates: ExchangeRates = { USD: 1_450, JPY: 9.5 };
const rowBase: Omit<TurtleHoldingsRow, 'kind' | 'ticker' | 'name' | 'currency' | 'status'> = {
  lastClose: 70_000,
  exitLine: null,
  reentryLine: null,
  exitGapPct: null,
  n: null,
  volatilityLabel: null,
  unitsCount: null,
  maxUnits: null,
  rebuy: null,
  reasonText: 'test',
  stopCheckText: null,
  dataIssue: null,
  asOfDate: '2026-10-10',
};

const asset: Asset = {
  id: 'asset-1', categoryId: 1, ticker: 'AAPL', exchange: 'NASDAQ', name: 'Apple',
  quantity: 2, purchasePrice: 180, purchaseDate: '2025-01-01', currency: Currency.USD,
  currentPrice: 220, priceOriginal: 220, highestPrice: 230,
};
const assetRow: TurtleHoldingsRow = {
  ...rowBase, kind: 'legacy-holding', assetId: asset.id, ticker: asset.ticker, name: asset.name,
  currency: asset.currency, status: 'hold',
};
const assetTarget = buildTurtleHoldingsChartTarget(assetRow, [asset], [], rates);
check('보유행은 보유자산 검토 대상으로 연결', assetTarget?.reviewTarget, { source: 'portfolio', id: 'asset-1' });
check('보유행 차트는 자산 원통화 사용', assetTarget?.currency, Currency.USD);

const watch: WatchlistItem = {
  id: 'watch-1', categoryId: 1, ticker: '005930', exchange: 'KRX (코스피/코스닥)', name: '삼성전자',
  currentPrice: 70_000, priceOriginal: 70_000, currency: Currency.USD,
};
const watchRow: TurtleHoldingsRow = {
  ...rowBase, kind: 'watch', watchItemId: watch.id, ticker: watch.ticker, name: watch.name,
  currency: Currency.KRW, status: 'reentry',
};
const watchTarget = buildTurtleHoldingsChartTarget(watchRow, [], [watch], rates);
check('관심행은 관심종목 검토 대상으로 연결', watchTarget?.reviewTarget, { source: 'watchlist', id: 'watch-1' });
check('관심행 차트는 잘못 저장된 USD 대신 거래소 KRW 사용', watchTarget?.currency, Currency.KRW);
check('관심행 원화 환율은 1', watchTarget?.exchangeRate, 1);

if (fails.length > 0) {
  console.error(`\n❌ marketCurrency parity 실패 (${fails.length})`);
  fails.forEach(failure => console.error(`  ${failure}`));
  process.exit(1);
}

console.log(`✅ marketCurrency parity 전체 통과 (${pass} 단언)`);
