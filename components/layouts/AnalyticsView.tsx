import React from 'react';
import { Asset, SellRecord } from '../../types';
import SellAnalyticsPage from '../SellAnalyticsPage';

interface AnalyticsViewProps {
  assets: Asset[];
  sellHistory: SellRecord[];
}

const AnalyticsView: React.FC<AnalyticsViewProps> = ({ assets, sellHistory }) => {
  return (
    <SellAnalyticsPage assets={assets} sellHistory={sellHistory} />
  );
};

export default AnalyticsView;
