import React, { useMemo } from 'react';
import { Asset, ExchangeRates, Currency } from '../../types';
import { getCategoryName } from '../../types/category';
import { getAssetBucket, BUCKET_LABELS } from '../../types/bucket';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

interface AllocationChartProps {
  assets: Asset[];
  exchangeRates: ExchangeRates;
}

const COLORS = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#3B82F6', '#8B5CF6', '#EC4899', '#F97316', '#84CC16'];
// 투더문 조각 전용 색 — 테이블/카드의 투더문 뱃지(purple-500)와 동일 계열로 고정
const SATELLITE_COLOR = '#A855F7';

interface ChartData {
  name: string;
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
  const { data } = usePortfolio();
  const categories = data.categoryStore.categories;

  // 카테고리는 코어 버킷의 배분 축 — 투더문(위성)은 카테고리에 섞지 않고 단일 '투더문' 조각으로 분리
  // (2단 리밸런싱과 동일한 분해: 코어=카테고리 비중, 투더문=덩어리)
  const chartData = useMemo(() => {
    const categoryTotals = new Map<number, number>();
    let satelliteTotal = 0;
    assets.forEach(asset => {
      // [수정] 환율 적용하여 원화 가치로 변환
      const rate = asset.currency === Currency.KRW ? 1 : (exchangeRates[asset.currency] || 0);
      const value = asset.currentPrice * asset.quantity * rate;

      if (getAssetBucket(asset) === 'SATELLITE') {
        satelliteTotal += value;
      } else {
        categoryTotals.set(asset.categoryId, (categoryTotals.get(asset.categoryId) || 0) + value);
      }
    });
    const rows = Array.from(categoryTotals.entries()).map(([id, value]) => ({ name: getCategoryName(id, categories), value }));
    if (satelliteTotal > 0) rows.push({ name: BUCKET_LABELS.SATELLITE, value: satelliteTotal });
    return rows;
  }, [assets, exchangeRates, categories]);

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
                <Cell key={`cell-${index}`} fill={entry.name === BUCKET_LABELS.SATELLITE ? SATELLITE_COLOR : COLORS[index % COLORS.length]} />
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
