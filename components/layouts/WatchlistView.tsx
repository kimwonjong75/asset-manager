import React from 'react';
import { WatchlistItem } from '../../types';
import { usePortfolio } from '../../contexts/PortfolioContext';
import WatchlistPage from '../WatchlistPage';

const WatchlistView: React.FC = () => {
  const { data, status, actions } = usePortfolio();
  const watchlist = data.watchlist;
  const isLoading = status.isLoading;
  return (
    <WatchlistPage
      watchlist={watchlist}
      onAdd={actions.addWatchItem}
      onUpdate={actions.updateWatchItem}
      onDelete={actions.deleteWatchItem}
      onToggleMonitoring={actions.toggleWatchMonitoring}
      onRefreshAll={actions.refreshWatchlistPrices}
      isLoading={isLoading}
      onBulkDelete={actions.bulkDeleteWatchItems}
    />
  );
};

export default WatchlistView;
