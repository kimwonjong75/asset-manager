import React, { useMemo } from 'react';
import { Asset, AssetCategory, ExchangeRates, Currency } from '../types';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

interface AllocationChartProps {
  assets: Asset[];
  exchangeRates: ExchangeRates;
}

const COLORS = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#3B82F6', '#8B5CF6', '#EC4899', '#F97316', '#84CC16'];

interface ChartData {
  name: AssetCategory;
  value: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number; payload?: ChartData }>;
  totalValue: number;
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload, totalValue }) => {
  if (active && payload && payload.length) {
    const { name, value } = payload[0].payload;
    const percent = totalValue > 0 ? (value / totalValue) * 100 : 0;
    return (
      <div className="bg-gray-700 p-3 rounded-md border border-gray-600 shadow-lg">
        <p className="font-bold text-white">{name}</p>
        <p className="text-sm text-gray-300">
          금액: {value.toLocaleString('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 })}
        </p>
         <p className="text-sm text-gray-300">
          비중: {percent.toFixed(2)}%
        </p>
      </div>
    );
  }
  return null;
};

const AllocationChart: React.FC<AllocationChartProps> = ({ assets, exchangeRates }) => {
  const chartData = useMemo(() => {
    const categoryTotals = new Map<AssetCategory, number>();
    assets.forEach(asset => {
      // [수정] 환율 적용하여 원화 가치로 변환
      const rate = asset.currency === Currency.KRW ? 1 : (exchangeRates[asset.currency] || 0);
      const value = asset.currentPrice * asset.quantity * rate;
      
      categoryTotals.set(asset.category, (categoryTotals.get(asset.category) || 0) + value);
    });
    return Array.from(categoryTotals.entries()).map(([name, value]) => ({ name, value }));
  }, [assets, exchangeRates]);

  const totalValue = useMemo(() => chartData.reduce((sum, entry) => sum + entry.value, 0), [chartData]);

  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-lg h-96" title="자산 종류별 비중을 원형 차트로 보여줍니다.">
      <h2 className="text-xl font-bold text-white mb-4">자산 종류별 배분</h2>
      {assets.length > 0 ? (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              labelLine={true}
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              outerRadius={80}
              fill="#8884d8"
              dataKey="value"
              nameKey="name"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip totalValue={totalValue} />} />
          </PieChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-full">
            <p className="text-gray-500">표시할 데이터가 없습니다.</p>
        </div>
      )}
    </div>
  );
};

export default AllocationChart;
