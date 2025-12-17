import React, { useMemo } from 'react';
import { PortfolioSnapshot } from '../types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface AssetTrendChartProps {
  history: PortfolioSnapshot[];
  assetId: string;
  assetName: string;
  currentQuantity: number; // [추가] 역산용 현재 수량
}

const AssetTrendChart: React.FC<AssetTrendChartProps> = ({ history, assetId, assetName, currentQuantity }) => {
  const chartData = useMemo(() => {
    if (!history || history.length === 0) {
      return [];
    }

    const data = history.map(snapshot => {
      const assetSnapshot = snapshot.assets.find(a => a.id === assetId);
      
      let price = 0;
      if (assetSnapshot) {
        // 1순위: 기록된 단가 사용
        if (assetSnapshot.unitPrice !== undefined && assetSnapshot.unitPrice > 0) {
            price = assetSnapshot.unitPrice;
        } 
        // 2순위: 단가가 없으면(과거 데이터) 현재가치 / 수량으로 역산 (수량 불변 가정)
        else if (currentQuantity > 0) {
            price = assetSnapshot.currentValue / currentQuantity;
        }
      }
      
      return {
        date: new Date(snapshot.date).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }),
        '현재가': Math.round(price), // 소수점 제거
      };
    }).filter(d => d['현재가'] > 0);

    return data;
  }, [history, assetId, assetName, currentQuantity]);

  const formatCurrency = (value: number) => {
    return value.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  };

  return (
    <div className="bg-gray-800 p-4 rounded-lg h-64">
      <h3 className="text-md font-bold text-white mb-4 text-center">{`"${assetName}" 현재가 추이`}</h3>
      {chartData.length > 1 ? (
        <ResponsiveContainer width="100%" height="85%">
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
            <XAxis dataKey="date" stroke="#A0AEC0" fontSize={12} />
            <YAxis stroke="#A0AEC0" fontSize={12} tickFormatter={formatCurrency} width={80} domain={['auto', 'auto']} />
            <Tooltip
              formatter={(value: number) => [`${formatCurrency(value)} 원`, '현재가']}
              contentStyle={{ backgroundColor: '#2D3748', border: '1px solid #4A5568', borderRadius: '0.5rem' }}
              labelStyle={{ color: '#E2E8F0' }}
              itemStyle={{ fontWeight: 'bold', color: '#818CF8' }}
            />
            <Legend wrapperStyle={{fontSize: "12px", bottom: -10}} />
            <Line type="monotone" dataKey="현재가" stroke="#818CF8" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-full">
          <p className="text-gray-500 text-sm">추이 데이터가 부족합니다.</p>
        </div>
      )}
    </div>
  );
};

export default AssetTrendChart;