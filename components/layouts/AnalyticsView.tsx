import React from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import SellAnalyticsPage from '../SellAnalyticsPage';

const AnalyticsView: React.FC = () => {
  const { data } = usePortfolio();
  return (
    <SellAnalyticsPage assets={data.assets} sellHistory={data.sellHistory} categories={data.categoryStore.categories} exchangeRates={data.exchangeRates} />
  );
};

export default AnalyticsView;
