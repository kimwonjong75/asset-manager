import React from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import SellAnalyticsPage from '../SellAnalyticsPage';

const AnalyticsView: React.FC = () => {
  const { data } = usePortfolio();
  const assets = data.assets;
  const sellHistory = data.sellHistory;
  return (
    <SellAnalyticsPage assets={assets} sellHistory={sellHistory} />
  );
};

export default AnalyticsView;
