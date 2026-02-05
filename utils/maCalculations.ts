// utils/maCalculations.ts
// 이동평균선(MA) 계산 유틸리티

import { HistoricalPriceData } from '../services/historicalPriceService';

export interface MALineConfig {
  period: number;
  color: string;
  enabled: boolean;
}

export const DEFAULT_MA_CONFIGS: MALineConfig[] = [
  { period: 5,   color: '#F59E0B', enabled: false },
  { period: 10,  color: '#10B981', enabled: false },
  { period: 20,  color: '#EF4444', enabled: true  },
  { period: 60,  color: '#3B82F6', enabled: true  },
  { period: 120, color: '#EC4899', enabled: false },
  { period: 200, color: '#8B5CF6', enabled: false },
];

interface PricePoint {
  date: string;
  price: number;
}

/**
 * 단순이동평균(SMA) 계산
 * sortedPrices는 날짜 오름차순 정렬된 배열이어야 함
 * 데이터가 period보다 적으면 해당 인덱스에 null 반환
 */
export function calculateSMA(
  sortedPrices: PricePoint[],
  period: number
): (number | null)[] {
  const result: (number | null)[] = [];

  for (let i = 0; i < sortedPrices.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }

    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += sortedPrices[j].price;
    }
    result.push(sum / period);
  }

  return result;
}

export interface MAChartDataPoint {
  date: string;
  fullDate: string;
  가격: number;
  [key: string]: string | number | undefined;
}

/**
 * 과거 시세 데이터 + 활성 MA 기간으로 Recharts용 데이터 배열 생성
 */
export function buildChartDataWithMA(
  historicalPrices: HistoricalPriceData,
  enabledPeriods: number[]
): MAChartDataPoint[] {
  // 날짜 오름차순 정렬
  const sortedDates = Object.keys(historicalPrices).sort();
  if (sortedDates.length === 0) return [];

  const sortedPrices: PricePoint[] = sortedDates.map(date => ({
    date,
    price: historicalPrices[date],
  }));

  // 각 활성 MA에 대해 SMA 계산
  const maResults: Record<string, (number | null)[]> = {};
  for (const period of enabledPeriods) {
    maResults[`MA${period}`] = calculateSMA(sortedPrices, period);
  }

  // 차트에 표시할 범위: 가장 큰 MA period 이후부터 (MA 값이 존재하는 구간만)
  // 단, 최소 30일은 표시
  const maxPeriod = enabledPeriods.length > 0 ? Math.max(...enabledPeriods) : 0;
  const startIdx = Math.max(0, maxPeriod - 1);
  const displayStartIdx = Math.max(0, Math.min(startIdx, sortedPrices.length - 30));

  const chartData: MAChartDataPoint[] = [];
  for (let i = displayStartIdx; i < sortedPrices.length; i++) {
    const point: MAChartDataPoint = {
      date: formatDateForChart(sortedPrices[i].date),
      fullDate: sortedPrices[i].date,
      가격: sortedPrices[i].price,
    };

    for (const period of enabledPeriods) {
      const maValue = maResults[`MA${period}`][i];
      if (maValue !== null) {
        point[`MA${period}`] = Math.round(maValue * 100) / 100;
      }
    }

    chartData.push(point);
  }

  return chartData;
}

/**
 * API 요청에 필요한 과거 일수 계산
 * MA 계산을 위해 maxPeriod * 1.5 + 30 (주말/공휴일 보정)
 */
export function getRequiredHistoryDays(maxPeriod: number): number {
  return Math.ceil(maxPeriod * 1.5) + 30;
}

function formatDateForChart(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
}
