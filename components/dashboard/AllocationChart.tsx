import React, { useMemo } from 'react';
import { Asset, ExchangeRates, Currency } from '../../types';
import { getCategoryName } from '../../types/category';
import { getAssetBucket, BUCKET_LABELS } from '../../types/bucket';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import Card from '../common/Card';
import { CATEGORY_PALETTE, CHART_TOOLTIP_STYLE } from '../../utils/chartFormat';

interface AllocationChartProps {
  assets: Asset[];
  exchangeRates: ExchangeRates;
  /** 제목 옆 보조 슬롯(홈: 범위 칩) */
  headerExtra?: React.ReactNode;
}

// Stage C 차트 팔레트 — 상태 색(빨강·파랑·주황·핑크·초록)은 조각 색으로 쓰지 않는다(RULES.md §8).
// 투더문 조각은 팔레트의 violet(투더문 뱃지 보라 계열)로 고정하고, 카테고리 조각은 나머지 7색을 순환 — 둘이 겹치지 않는다.
const SATELLITE_COLOR = '#A78BFA';
const COLORS = CATEGORY_PALETTE.filter(c => c !== SATELLITE_COLOR);

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
  // recharts 는 payload 항목의 `payload` 를 선택 필드로 준다 — 없으면 툴팁을 그리지 않는다.
  if (active && payload && payload.length && payload[0].payload) {
    const { name, value } = payload[0].payload;
    const percent = totalValue > 0 ? (value / totalValue) * 100 : 0;
    return (
      <div style={{ ...CHART_TOOLTIP_STYLE.contentStyle, padding: '0.5rem 0.75rem' }}>
        <p style={CHART_TOOLTIP_STYLE.labelStyle}>{name}</p>
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

const AllocationChart: React.FC<AllocationChartProps> = ({ assets, exchangeRates, headerExtra }) => {
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
    <Card title="자산 종류별 배분" actions={headerExtra} clip={false}>
      {assets.length > 0 ? (
        <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 20, right: 30, bottom: 20, left: 30 }}>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              labelLine={true}
              label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
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
        </div>
      ) : (
        <div className="flex items-center justify-center h-40">
            <p className="text-gray-500">표시할 데이터가 없습니다.</p>
        </div>
      )}
    </Card>
  );
};

export default AllocationChart;
