import React from 'react';
import { WatchlistItem } from '../../types';
import WatchlistPage from '../WatchlistPage';

interface WatchlistViewProps {
  watchlist: WatchlistItem[];
  isLoading: boolean;
  onAdd: (item: Omit<WatchlistItem, 'id' | 'currentPrice' | 'priceOriginal' | 'currency' | 'yesterdayPrice' | 'highestPrice' | 'lastSignalAt' | 'lastSignalType'>) => void;
  onUpdate: (item: WatchlistItem) => void;
  onDelete: (id: string) => void;
  onToggleMonitoring: (id: string, enabled: boolean) => void;
  onRefreshAll: () => void;
  onBulkDelete: (ids: string[]) => void;
}

const WatchlistView: React.FC<WatchlistViewProps> = ({
  watchlist,
  isLoading,
  onAdd,
  onUpdate,
  onDelete,
  onToggleMonitoring,
  onRefreshAll,
  onBulkDelete
}) => {
  return (
    <WatchlistPage
      watchlist={watchlist}
      onAdd={onAdd}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onToggleMonitoring={onToggleMonitoring}
      onRefreshAll={onRefreshAll}
      isLoading={isLoading}
      onBulkDelete={onBulkDelete}
    />
  );
};

export default WatchlistView;
