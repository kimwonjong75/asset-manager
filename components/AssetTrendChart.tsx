import React, { useMemo, useState } from 'react';
import { PortfolioSnapshot, Currency } from '../types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface AssetTrendChartProps {
  history: PortfolioSnapshot[];
  assetId: string;
  assetName: string;
  currentQuantity: number;
  currentPrice: number;       // 실시간 현재가 (외화 원본)
  currency?: Currency;        // 자산 통화 (USD, KRW, JPY...)
  exchangeRate?: number;      // 환율 (KRW 변환용)
}

const AssetTrendChart: React.FC<AssetTrendChartProps> = ({ 
  history, 
  assetId, 
  assetName, 
  currentQuantity, 
  currentPrice,
  currency = Currency.KRW,
  exchangeRate = 1,
}) => {
  const [showInKRW, setShowInKRW] = useState<boolean>(false);

  const chartData = useMemo(() => {
    // 1. 과거 데이터 매핑
    const data = (history || []).map(snapshot => {
      const assetSnapshot = snapshot.assets.find(a => a.id === assetId);
      
      let price = 0;
      if (assetSnapshot) {
        // KRW로 보기 옵션이 켜져 있거나, 원래 KRW 자산인 경우
        if (showInKRW || currency === Currency.KRW) {
            // 1순위: unitPrice (원화 단가) 사용
            if (assetSnapshot.unitPrice !== undefined && assetSnapshot.unitPrice > 0) {
                price = assetSnapshot.unitPrice;
            }
            // 2순위: unitPriceOriginal이 있다면 환율 적용 (환율 정보가 없으면 현재 환율 사용 - 근사치)
            else if (assetSnapshot.unitPriceOriginal !== undefined && assetSnapshot.unitPriceOriginal > 0) {
                price = assetSnapshot.unitPriceOriginal * exchangeRate;
            }
            // 3순위: currentValue / quantity 역산
            else if (currentQuantity > 0) {
                price = assetSnapshot.currentValue / currentQuantity;
            }
        } 
        // 외화로 보기 (기본값)
        else {
            // 1순위: unitPriceOriginal (외화 원본) 사용
            if (assetSnapshot.unitPriceOriginal !== undefined && assetSnapshot.unitPriceOriginal > 0) {
                price = assetSnapshot.unitPriceOriginal;
            }
            // 2순위: unitPrice (원화)를 환율로 나누어 역산 (과거 데이터 호환성)
            // 주의: 과거 환율 정보가 없으므로 현재 환율을 사용하여 근사치를 구함.
            // 이는 스케일 차이(예: 20만원 vs 150달러)를 보정하기 위함임.
            else if (assetSnapshot.unitPrice !== undefined && assetSnapshot.unitPrice > 0) {
                price = assetSnapshot.unitPrice / exchangeRate;
            }
            // 3순위: currentValue / quantity 역산 후 환율 적용
            else if (currentQuantity > 0) {
                price = (assetSnapshot.currentValue / currentQuantity) / exchangeRate;
            }
        }
      }

      return {
        date: new Date(snapshot.date).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }),
        fullDate: snapshot.date,
        '가격': price,
      };
    }).filter(d => d['가격'] > 0);

    // 2. 오늘 날짜(실시간 현재가) 처리 로직
    if (currentPrice > 0) {
      const today = new Date();
      const todayStr = today.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
      const todayISO = today.toISOString().split('T')[0];

      // 표시할 현재가 결정
      const displayCurrentPrice = (showInKRW && currency !== Currency.KRW)
        ? currentPrice * exchangeRate
        : currentPrice;

      // 차트 데이터의 마지막 날짜 확인
      const lastItem = data[data.length - 1];

      // 마지막 데이터가 오늘 날짜라면 -> 실시간 가격으로 교체
      if (lastItem && (lastItem.date === todayStr || lastItem.fullDate === todayISO)) {
        lastItem['가격'] = displayCurrentPrice;
      } 
      // 오늘 데이터가 차트에 아직 없다면 -> 추가
      else {
        data.push({
          date: todayStr,
          fullDate: todayISO,
          '가격': displayCurrentPrice
        });
      }
    }

    return data;
  }, [history, assetId, currentQuantity, currentPrice, currency, exchangeRate, showInKRW]);

  // 통화 기호 표시 헬퍼 함수
  const getCurrencySymbol = (curr: string) => {
    if (showInKRW) return '₩';
    switch(curr) {
      case 'USD': return '$';
      case 'JPY': return '¥';
      case 'KRW': return '₩';
      default: return curr;
    }
  };

  // 표시 통화 결정
  const displayCurrency = showInKRW ? Currency.KRW : currency;

  // 툴팁 포맷터
  const formatTooltip = (value: number) => {
    const symbol = getCurrencySymbol(currency);
    const formattedValue = displayCurrency === Currency.KRW 
      ? value.toLocaleString('ko-KR')
      : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    return [`${symbol} ${formattedValue}`, '가격'];
  };

  // Y축 포맷터
  const formatYAxis = (value: number) => {
    if (displayCurrency === Currency.KRW) {
      if (value >= 10000) {
        return `${(value / 10000).toFixed(0)}만`;
      }
      return value.toLocaleString();
    }
    return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  };

  return (
    <div className="bg-gray-800 p-4 rounded-lg h-64 relative">
      <div className="flex justify-between items-center mb-4">
          <h3 className="text-md font-bold text-white text-center flex-1">
            {`"${assetName}" 가격 추이 (${displayCurrency})`}
          </h3>
          
          {/* 통화 전환 토글 (외화 자산인 경우에만 표시) */}
          {currency !== Currency.KRW && (
              <button
                  onClick={() => setShowInKRW(!showInKRW)}
                  className="absolute right-4 top-4 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-2 py-1 rounded border border-gray-600 transition-colors"
                  title={showInKRW ? "외화로 보기" : "원화로 보기"}
              >
                  {showInKRW ? `원화(${Currency.KRW})` : `외화(${currency})`}
              </button>
          )}
      </div>
      
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
              domain={['auto', 'auto']} 
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
          <p className="text-gray-500 text-sm">추이 데이터가 부족합니다.</p>
        </div>
      )}
    </div>
  );
};

export default AssetTrendChart;