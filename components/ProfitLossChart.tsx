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

      let totalPurchase = 0;
      let totalCurrent = 0;
      relevantAssets.forEach(asset => {
        totalPurchase += asset.purchaseValue;
        totalCurrent += asset.currentValue;
      });
      const totalProfitLoss = totalCurrent - totalPurchase;
      const totalReturn = totalPurchase === 0 ? 0 : (totalProfitLoss / totalPurchase) * 100;
      dateEntry['투자 원금'] = totalPurchase;
      dateEntry['총 평가액'] = totalCurrent;
      dateEntry['손익'] = totalProfitLoss;
      dateEntry['수익률'] = totalReturn;
      return dateEntry;
    });

    return data;
  }, [history, assetsToDisplay]);

  const formatCurrency = (value: number) => {
    return value.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  };
  const formatPercent = (value: number) => `${(Number(value) || 0).toFixed(2)}%`;
  
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const datum = payload.reduce((acc: any, p: any) => {
      if (p && p.dataKey) acc[p.dataKey] = p.value;
      return acc;
    }, {});
    const principal = datum['투자 원금'];
    const total = datum['총 평가액'];
    const returnPct = datum['수익률'];
    return (
      <div style={{ backgroundColor: '#2D3748', border: '1px solid #4A5568', borderRadius: '0.5rem', padding: '0.5rem 0.75rem' }}>
        <div style={{ color: '#E2E8F0', marginBottom: 4 }}>{label}</div>
        <div style={{ color: '#A0AEC0' }}>투자 원금: <span style={{ color: '#E2E8F0', fontWeight: 700 }}>{formatCurrency(principal)} 원</span></div>
        <div style={{ color: '#A0AEC0' }}>총 평가액: <span style={{ color: '#E2E8F0', fontWeight: 700 }}>{formatCurrency(total)} 원</span></div>
        <div style={{ color: '#A0AEC0' }}>수익률: <span style={{ color: '#E2E8F0', fontWeight: 700 }}>{formatPercent(returnPct)}</span></div>
      </div>
    );
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
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{fontSize: "12px", bottom: -10}}/>
            <Line type="monotone" dataKey="투자 원금" name="투자 원금" stroke="#63B3ED" strokeWidth={3} dot={false} />
            <Line type="monotone" dataKey="총 평가액" name="총 평가액" stroke="#48BB78" strokeWidth={3} dot={false} />
            <Line type="monotone" dataKey="손익" name="손익" stroke="#FFFFFF" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
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
