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
}) => {
  const chartData = useMemo(() => {
    // 1. 과거 데이터 처리 (저장된 스냅샷)
    const data = (history || []).map(snapshot => {
      const assetSnapshot = snapshot.assets.find(a => a.id === assetId);
      if (!assetSnapshot) return null;

      // 저장된 데이터에서 가격 추출 (단위가격 우선 사용)
      // 주의: 과거에 KRW로 저장된 데이터가 있을 수 있으나, 외화 자산이라면 단위가격을 최대한 신뢰
      let price = assetSnapshot.unitPrice;
      
      // 만약 unitPrice가 없으면 전체가치/수량으로 역산
      if (!price && currentQuantity > 0) {
        price = assetSnapshot.currentValue / currentQuantity;
      }
      
      return {
        date: new Date(snapshot.date).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }),
        fullDate: snapshot.date,
        '가격': price || 0,
      };
    }).filter(d => d !== null && d['가격'] > 0);

    // 2. 오늘 날짜(실시간 현재가) 처리
    // 과거 데이터의 마지막 날짜와 오늘이 같으면 -> 오늘 데이터는 실시간 가격으로 덮어쓰기
    if (currentPrice > 0) {
      const today = new Date();
      const todayStr = today.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
      const todayISO = today.toISOString().split('T')[0];

      const lastItem = data[data.length - 1];

      if (lastItem && (lastItem.date === todayStr || lastItem.fullDate === todayISO)) {
        // 이미 오늘자 스냅샷이 있어도, 차트에서는 '실시간 가격'을 보여줌
        lastItem['가격'] = currentPrice;
      } else {
        // 오늘 데이터가 없으면 추가
        data.push({
          date: todayStr,
          fullDate: todayISO,
          '가격': currentPrice
        });
      }
    }

    return data;
  }, [history, assetId, currentQuantity, currentPrice]);

  // 통화 기호 표시 함수
  const getCurrencySymbol = (curr: string) => {
    switch(curr) {
      case 'USD': return '$';
      case 'JPY': return '¥';
      case 'KRW': return '₩';
      default: return curr;
    }
  };

  // 툴팁 포맷터 (정확한 금액 표시)
  const formatTooltip = (value: number) => {
    const symbol = getCurrencySymbol(currency);
    return [`${symbol} ${value.toLocaleString()}`, '가격'];
  };

  // Y축 포맷터 (간략 표시)
  const formatYAxis = (value: number) => {
    if (currency === Currency.KRW && value >= 10000) {
      return `${(value / 10000).toFixed(0)}만`;
    }
    return value.toLocaleString();
  };

  return (
    <div className="bg-gray-800 p-4 rounded-lg h-64">
      <h3 className="text-md font-bold text-white mb-4 text-center">
        {`"${assetName}" 가격 추이 (${currency})`}
      </h3>
      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height="85%">
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
            <XAxis dataKey="date" stroke="#A0AEC0" fontSize={12} />
            <YAxis 
              stroke="#A0AEC0" 
              fontSize={12} 
              tickFormatter={formatYAxis} 
              domain={['auto', 'auto']} // 차트 높낮이 자동 조절
              width={60}
            />
            <Tooltip
              formatter={formatTooltip}
              contentStyle={{ backgroundColor: '#2D3748', border: '1px solid #4A5568', borderRadius: '0.5rem' }}
              labelStyle={{ color: '#E2E8F0' }}
              itemStyle={{ fontWeight: 'bold', color: '#818CF8' }}
            />
            <Legend wrapperStyle={{fontSize: "12px", bottom: -10}} />
            <Line 
              type="monotone" 
              dataKey="가격" 
              stroke="#818CF8" 
              strokeWidth={2} 
              dot={{ r: 3 }} 
              activeDot={{ r: 6 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-full">
          <p className="text-gray-500 text-sm">데이터가 충분하지 않습니다.</p>
        </div>
      )}
    </div>
  );
};

export default AssetTrendChart;