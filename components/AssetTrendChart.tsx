import React, { useMemo } from 'react';
import { PortfolioSnapshot } from '../types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface AssetTrendChartProps {
  history: PortfolioSnapshot[];
  assetId: string;
  assetName: string;
  currentQuantity: number;
  currentPrice: number; // [수정] 실시간 현재가 prop 추가
}

const AssetTrendChart: React.FC<AssetTrendChartProps> = ({ 
  history, 
  assetId, 
  assetName, 
  currentQuantity, 
  currentPrice // [수정] 구조 분해 할당
}) => {
  const chartData = useMemo(() => {
    // 1. 과거 데이터 매핑
    const data = (history || []).map(snapshot => {
      const assetSnapshot = snapshot.assets.find(a => a.id === assetId);
      
      let price = 0;
      if (assetSnapshot) {
        if (assetSnapshot.unitPrice !== undefined && assetSnapshot.unitPrice > 0) {
            price = assetSnapshot.unitPrice;
        } else if (currentQuantity > 0) {
            price = assetSnapshot.currentValue / currentQuantity;
        }
      }
      
      return {
        date: new Date(snapshot.date).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }),
        '현재가': Math.round(price),
        originalDate: snapshot.date // 날짜 비교용
      };
    }).filter(d => d['현재가'] > 0);

    // 2. [핵심 수정] 오늘 날짜의 실시간 데이터 추가 (또는 갱신)
    if (currentPrice > 0) {
      const todayStr = new Date().toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
      const todayISO = new Date().toISOString().split('T')[0];

      // 마지막 데이터가 오늘 날짜인지 확인
      const lastItem = data[data.length - 1];
      const isLastItemToday = lastItem && (lastItem.date === todayStr || lastItem.originalDate === todayISO);

      if (isLastItemToday) {
        // 이미 오늘 저장된 스냅샷이 있다면, 차트에서는 실시간 가격으로 덮어씌워 보여줌
        lastItem['현재가'] = Math.round(currentPrice);
      } else {
        // 오늘 데이터가 없으면 추가
        data.push({
          date: todayStr,
          '현재가': Math.round(currentPrice),
          originalDate: todayISO
        });
      }
    }

    return data;
  }, [history, assetId, assetName, currentQuantity, currentPrice]);

  const formatCurrency = (value: number) => {
    return value.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  };

  return (
    <div className="bg-gray-800 p-4 rounded-lg h-64">
      <h3 className="text-md font-bold text-white mb-4 text-center">{`"${assetName}" 현재가 추이`}</h3>
      {chartData.length > 0 ? ( // 조건 완화 (1개여도 점으로 표시 가능)
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