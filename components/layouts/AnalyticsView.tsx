import React from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { useGlobalPeriodDays } from '../../hooks/useGlobalPeriodDays';
import SellAnalyticsPage from '../SellAnalyticsPage';

const AnalyticsView: React.FC = () => {
  const { data, ui } = usePortfolio();
  const assets = data.assets;
  const sellHistory = data.sellHistory;
  const { startDate, endDate } = useGlobalPeriodDays(ui.globalPeriod);
  return (
    <SellAnalyticsPage assets={assets} sellHistory={sellHistory} periodStartDate={startDate} periodEndDate={endDate} categories={data.categoryStore.categories} />
  );
};

export default AnalyticsView;
