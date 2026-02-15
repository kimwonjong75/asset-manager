import React from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import WatchlistPage from '../WatchlistPage';
import WatchlistAddModal from '../WatchlistAddModal';
import WatchlistEditModal from '../WatchlistEditModal';

const WatchlistView: React.FC = () => {
  const { data, status, actions } = usePortfolio();
  return (
    <>
      <WatchlistPage
        watchlist={data.watchlist}
        onDelete={actions.deleteWatchItem}
        onToggleMonitoring={actions.toggleWatchMonitoring}
        onOpenAddModal={actions.openAddWatchItem}
        onOpenEditModal={actions.openEditWatchItem}
        isLoading={status.isLoading}
        onBulkDelete={actions.bulkDeleteWatchItems}
        exchangeRates={data.exchangeRates}
      />
      <WatchlistAddModal />
      <WatchlistEditModal />
    </>
  );
};

export default WatchlistView;
