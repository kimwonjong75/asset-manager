import React, { useMemo } from 'react';
import { Asset, PortfolioSnapshot } from '../types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface ProfitLossChartProps {
  history: PortfolioSnapshot[];
  assetsToDisplay: Asset[];
  title: string;
}

const ProfitLossChart: React.FC<ProfitLossChartProps> = ({ history, assetsToDisplay, title }) => {
  const chartData = useMemo(() => {
    if (!history || history.length === 0) {
      return [];
    }
    
    const assetIdsToDisplay = new Set(assetsToDisplay.map(a => a.id));

    const data = history.map(snapshot => {
      const dateEntry: { [key: string]: any } = {
        date: new Date(snapshot.date).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }),
      };
      
      const relevantAssets = snapshot.assets.filter(asset => assetIdsToDisplay.has(asset.id));

      let totalProfitLoss = 0;
      relevantAssets.forEach(asset => {
        const profitLoss = asset.currentValue - asset.purchaseValue;
        totalProfitLoss += profitLoss;
      });
      dateEntry['손익'] = totalProfitLoss;
      return dateEntry;
    });

    return data;
  }, [history, assetsToDisplay]);

  const formatCurrency = (value: number) => {
    return value.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  };
  
  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-lg h-96 mb-6" title="포트폴리오의 평가 손익 추이를 보여줍니다.">
      <h2 className="text-xl font-bold text-white mb-4">{title}</h2>
      {chartData.length > 1 ? (
        <ResponsiveContainer width="100%" height="90%">
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
            <XAxis dataKey="date" stroke="#A0AEC0" fontSize={12} />
            <YAxis stroke="#A0AEC0" fontSize={12} tickFormatter={formatCurrency} width={80} />
            <Tooltip
              formatter={(value: number) => [`${formatCurrency(value)} 원`, '손익']}
              contentStyle={{ backgroundColor: '#2D3748', border: '1px solid #4A5568', borderRadius: '0.5rem' }}
              labelStyle={{ color: '#E2E8F0' }}
              itemStyle={{ fontWeight: 'bold' }}
            />
            <Legend wrapperStyle={{fontSize: "12px", bottom: -10}}/>
            <Line type="monotone" dataKey="손익" name="손익" stroke="#FFFFFF" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 8 }} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-full">
          <p className="text-gray-500">손익 추이를 표시하려면 데이터가 2일 이상 필요합니다.</p>
        </div>
      )}
    </div>
  );
};

export default ProfitLossChart;