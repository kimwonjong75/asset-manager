import React, { useMemo } from 'react';
import { PortfolioSnapshot } from '../types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface AssetTrendChartProps {
  history: PortfolioSnapshot[];
  assetId: string;
  assetName: string;
}

const AssetTrendChart: React.FC<AssetTrendChartProps> = ({ history, assetId, assetName }) => {
  const chartData = useMemo(() => {
    if (!history || history.length === 0) {
      return [];
    }

    const data = history.map(snapshot => {
      const assetSnapshot = snapshot.assets.find(a => a.id === assetId);
      const profitLoss = assetSnapshot ? assetSnapshot.currentValue - assetSnapshot.purchaseValue : 0;
      
      return {
        date: new Date(snapshot.date).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }),
        [assetName]: profitLoss,
      };
    }).filter(d => d[assetName] !== 0 || history.some(snap => snap.assets.some(a => a.id === assetId))); // Filter out dates where asset didn't exist, unless it exists somewhere in history

    return data;
  }, [history, assetId, assetName]);

  const formatCurrency = (value: number) => {
    return value.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  };

  return (
    <div className="bg-gray-800 p-4 rounded-lg h-64">
      <h3 className="text-md font-bold text-white mb-4 text-center">{`"${assetName}" 손익 추이`}</h3>
      {chartData.length > 1 ? (
        <ResponsiveContainer width="100%" height="85%">
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
            <XAxis dataKey="date" stroke="#A0AEC0" fontSize={12} />
            <YAxis stroke="#A0AEC0" fontSize={12} tickFormatter={formatCurrency} width={80} />
            <Tooltip
              formatter={(value: number) => [`${formatCurrency(value)} 원`, '손익']}
              contentStyle={{ backgroundColor: '#2D3748', border: '1px solid #4A5568', borderRadius: '0.5rem' }}
              labelStyle={{ color: '#E2E8F0' }}
              itemStyle={{ fontWeight: 'bold' }}
            />
            <Legend wrapperStyle={{fontSize: "12px", bottom: -10}} />
            <Line type="monotone" dataKey={assetName} stroke="#818CF8" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-full">
          <p className="text-gray-500 text-sm">이 자산의 추이를 표시하기 위한 데이터가 부족합니다.</p>
        </div>
      )}
    </div>
  );
};

export default AssetTrendChart;
