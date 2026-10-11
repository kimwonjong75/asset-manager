import type { Currency } from './index';

export type TurtleHoldingsReviewTarget =
  | { source: 'portfolio'; id: string }
  | { source: 'watchlist'; id: string };

export interface TurtleHoldingsChartTarget {
  key: string;
  assetId: string;
  assetName: string;
  currentQuantity: number;
  currentPrice: number;
  currency: Currency;
  exchangeRate: number;
  ticker: string;
  exchange: string;
  categoryId: number;
  purchasePrice?: number;
  reviewTarget: TurtleHoldingsReviewTarget;
}
