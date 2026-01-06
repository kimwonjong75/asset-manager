import React, { useMemo } from 'react';
import { PortfolioSnapshot, Currency } from '../types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface AssetTrendChartProps {
  history: PortfolioSnapshot[];
  assetId: string;
  assetName: string;
  currentQuantity: number;
  currentPrice: number;
  currency?: Currency;
  exchangeRate?: number;
}

const AssetTrendChart: React.FC<AssetTrendChartProps> = ({ 
  history, 
  assetId, 
  assetName, 
  currentQuantity, 
  currentPrice,
  currency = Currency.KRW,
  exchangeRate = 1
}) => {
  const chartData = useMemo(() => {
    // 1. 과거 데이터 매핑 (외화인 경우 KRW로 환산)
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

      // [핵심] 외화 자산이고, 현재 KRW로 보고 싶다면(exchangeRate > 1) 환산 적용
      // 단, history에 이미 KRW로 저장되어 있을 수도 있으니 주의해야 함.
      // 보통 unitPrice는 원화가 저장되므로, currency가 KRW가 아니면 환율을 곱함.
      let finalPrice = price;
      if (currency !== Currency.KRW && exchangeRate > 1 && price > 0) {
          // 가격이 너무 작으면(외화) 환율 곱하기
          if (price < 5000) { 
              finalPrice = Math.round(price * exchangeRate);
          }
      }

      return {
        date: new Date(snapshot.date).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }),
        '현재가': Math.round(finalPrice),
        originalDate: snapshot.date
      };
    }).filter(d => d['현재가'] > 0);

    // 2. 실시간 현재가 반영 (오늘 날짜)
    if (currentPrice > 0) {
      const todayStr = new Date().toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
      const todayISO = new Date().toISOString().split('T')[0];

      // 현재가도 KRW로 환산 (이미 KRW가 아닌 경우에만)
      let finalCurrentPrice = currentPrice;
      if (currency !== Currency.KRW && exchangeRate > 1) {
         if (currentPrice < 5000) {
             finalCurrentPrice = Math.round(currentPrice * exchangeRate);
         }
      } else {
         finalCurrentPrice = Math.round(currentPrice);
      }

      const lastItem = data[data.length - 1];
      const isLastItemToday = lastItem && (lastItem.date === todayStr || lastItem.originalDate === todayISO);

      if (isLastItemToday) {
        // 오늘자 스냅샷이 있으면 실시간 가격으로 시각적 갱신
        lastItem['현재가'] = finalCurrentPrice;
      } else {
        // 없으면 오늘자 추가
        data.push({
          date: todayStr,
          '현재가': finalCurrentPrice,
          originalDate: todayISO
        });
      }
    }

    return data;
  }, [history, assetId, currentQuantity, currentPrice, currency, exchangeRate]);

  const formatCurrency = (value: number) => {
    return value.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  };

  return (
    <div className="bg-gray-800 p-4 rounded-lg h-64">
      <h3 className="text-md font-bold text-white mb-4 text-center">{`"${assetName}" 가치 추이 (KRW)`}</h3>
      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height="85%">
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
            <XAxis dataKey="date" stroke="#A0AEC0" fontSize={12} />
            <YAxis stroke="#A0AEC0" fontSize={12} tickFormatter={formatCurrency} width={80} domain={['auto', 'auto']} />
            <Tooltip
              formatter={(value: number) => [`${formatCurrency(value)} 원`, '평가금액']}
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