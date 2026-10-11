import type { Asset, ExchangeRates, WatchlistItem } from '../types';
import type { TurtleHoldingsChartTarget } from '../types/turtleHoldingsDetail';
import type { TurtleHoldingsRow } from './turtleHoldingsView';
import { resolveMarketCurrency } from './marketCurrency';

function exchangeRateFor(currency: Asset['currency'], rates: ExchangeRates): number {
  const rate = rates[currency as keyof ExchangeRates];
  return typeof rate === 'number' && rate > 0 ? rate : 1;
}

export function buildTurtleHoldingsChartTarget(
  row: TurtleHoldingsRow,
  assets: readonly Asset[],
  watchlist: readonly WatchlistItem[],
  exchangeRates: ExchangeRates,
): TurtleHoldingsChartTarget | null {
  if (row.assetId) {
    const asset = assets.find(candidate => candidate.id === row.assetId);
    if (!asset) return null;
    return {
      key: `asset-${asset.id}`,
      assetId: asset.id,
      assetName: asset.customName?.trim() || asset.name,
      currentQuantity: asset.quantity,
      currentPrice: asset.currentPrice,
      currency: asset.currency,
      exchangeRate: exchangeRateFor(asset.currency, exchangeRates),
      ticker: asset.ticker,
      exchange: asset.exchange,
      categoryId: asset.categoryId,
      purchasePrice: asset.purchasePrice,
      reviewTarget: { source: 'portfolio', id: asset.id },
    };
  }

  if (row.watchItemId) {
    const item = watchlist.find(candidate => candidate.id === row.watchItemId);
    if (!item) return null;
    const currency = resolveMarketCurrency(item.exchange, undefined, item.currency);
    return {
      key: `watch-${item.id}`,
      assetId: item.id,
      assetName: item.name,
      currentQuantity: 1,
      currentPrice: item.priceOriginal ?? item.currentPrice ?? row.lastClose ?? 0,
      currency,
      exchangeRate: exchangeRateFor(currency, exchangeRates),
      ticker: item.ticker,
      exchange: item.exchange,
      categoryId: item.categoryId,
      reviewTarget: { source: 'watchlist', id: item.id },
    };
  }

  return null;
}
