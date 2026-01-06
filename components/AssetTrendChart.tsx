import React, { useMemo } from 'react';
import { PortfolioSnapshot, Currency } from '../types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface AssetTrendChartProps {
  history: PortfolioSnapshot[];
  assetId: string;
  assetName: string;
  currentQuantity: number;
  currentPrice: number;       // 실시간 현재가
  currency?: Currency;        // 자산 통화 (USD, KRW, JPY...)
  exchangeRate?: number;      // (사용하지 않음 - 외화 그대로 표기 위해 남겨둠)
}

const AssetTrendChart: React.FC<AssetTrendChartProps> = ({ 
  history, 
  assetId, 
  assetName, 
  currentQuantity, 
  currentPrice,
  currency = Currency.KRW,
  // exchangeRate는 더 이상 차트 계산에 쓰지 않지만 인터페이스 호환성을 위해 남겨둠
}) => {
  const chartData = useMemo(() => {
    // 1. 과거 데이터 매핑 (history는 '과거 종가'로 간주)
    // 외화 자산도 원화로 변환하지 않고 그대로(original) 사용
    const data = (history || []).map(snapshot => {
      const assetSnapshot = snapshot.assets.find(a => a.id === assetId);
      
      let price = 0;
      if (assetSnapshot) {
        // 스냅샷에 unitPrice(1주당 단가)가 있으면 우선 사용 (가장 정확)
        if (assetSnapshot.unitPrice !== undefined && assetSnapshot.unitPrice > 0) {
            price = assetSnapshot.unitPrice;
        } 
        // unitPrice가 없으면 평가액/수량으로 역산
        else if (currentQuantity > 0) {
            price = assetSnapshot.currentValue / currentQuantity;
        }
      }

      return {
        date: new Date(snapshot.date).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }),
        fullDate: snapshot.date, // YYYY-MM-DD (비교용)
        '가격': price, // 키값을 '현재가'에서 '가격'으로 변경
      };
    }).filter(d => d['가격'] > 0);

    // 2. 오늘 날짜(실시간 현재가) 처리 로직
    if (currentPrice > 0) {
      const today = new Date();
      const todayStr = today.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
      const todayISO = today.toISOString().split('T')[0];

      // 차트 데이터의 마지막 날짜 확인
      const lastItem = data[data.length - 1];

      // 마지막 데이터가 오늘 날짜라면 -> 스냅샷(종가)을 무시하고 실시간 가격으로 교체
      if (lastItem && (lastItem.date === todayStr || lastItem.fullDate === todayISO)) {
        lastItem['가격'] = currentPrice;
      } 
      // 오늘 데이터가 차트에 아직 없다면 -> 추가
      else {
        data.push({
          date: todayStr,
          fullDate: todayISO,
          '가격': currentPrice
        });
      }
    }

    return data;
  }, [history, assetId, currentQuantity, currentPrice]);

  // 통화 기호 표시 헬퍼 함수
  const getCurrencySymbol = (curr: string) => {
    switch(curr) {
      case 'USD': return '$';
      case 'JPY': return '¥';
      case 'KRW': return '₩';
      default: return curr;
    }
  };

  // 툴팁 포맷터 (상세 금액 표시)
  const formatTooltip = (value: number) => {
    const symbol = getCurrencySymbol(currency);
    // 소수점 처리: KRW는 소수점 없이, 외화는 소수점 2자리까지
    const formattedValue = currency === Currency.KRW 
      ? value.toLocaleString('ko-KR')
      : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return [`${symbol} ${formattedValue}`, '가격'];
  };

  // Y축용 간략 포맷터 (공간 절약)
  const formatYAxis = (value: number) => {
    if (value >= 10000 && currency === Currency.KRW) {
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
            <XAxis 
              dataKey="date" 
              stroke="#A0AEC0" 
              fontSize={12} 
            />
            <YAxis 
              stroke="#A0AEC0" 
              fontSize={12} 
              tickFormatter={formatYAxis} 
              domain={['auto', 'auto']} // 값의 범위에 따라 자동으로 스케일 조정
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
              isAnimationActive={false} // 깜빡임 방지
            />
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