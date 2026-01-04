import { Asset, PortfolioSnapshot, AssetCategory, ExchangeRates } from './index';

export interface PortfolioTableProps {
  assets: Asset[];
  history: PortfolioSnapshot[];
  onRefreshAll: () => void;
  onRefreshSelected?: (ids: string[]) => void | Promise<void>;
  onRefreshOne?: (id: string) => void | Promise<void>;
  onEdit: (asset: Asset) => void;
  onSell?: (asset: Asset) => void;
  isLoading: boolean;
  sellAlertDropRate: number;
  filterCategory: AssetCategory | 'ALL';
  onFilterChange: (category: AssetCategory | 'ALL') => void;
  filterAlerts: boolean;
  onFilterAlertsChange: (isActive: boolean) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  onAddSelectedToWatchlist?: (assets: Asset[]) => void;
  failedIds?: Set<string>;
  exchangeRates: ExchangeRates;
}

export type SortKey = 'name' | 'purchaseDate' | 'quantity' | 'purchasePrice' | 'currentPrice' | 'returnPercentage' | 'dropFromHigh' | 'yesterdayChange' | 'purchaseValue' | 'currentValue' | 'allocation' | 'profitLoss' | 'profitLossKRW';
export type SortDirection = 'ascending' | 'descending';

export interface AssetMetrics {
  purchasePrice: number;
  currentPrice: number;
  currentPriceKRW: number;
  purchasePriceKRW: number;
  purchaseValue: number;
  currentValue: number;
  purchaseValueKRW: number;
  currentValueKRW: number;
  returnPercentage: number;
  allocation: number;
  dropFromHigh: number;
  profitLoss: number;
  profitLossKRW: number;
  diffFromHigh: number;
  yesterdayChange: number;
  diffFromYesterday: number;
}

export interface EnrichedAsset extends Asset {
  metrics: AssetMetrics;
}
