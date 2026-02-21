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
  현재가: number;
  거래량?: number;
  [key: string]: string | number | undefined;
}

/**
 * 과거 시세 데이터 + 활성 MA 기간으로 Recharts용 데이터 배열 생성
 */
/**
 * RSI(Relative Strength Index) 계산 — Wilder's smoothing
 * sortedPrices는 날짜 오름차순 정렬된 배열이어야 함
 * 최소 period+1개의 데이터 필요 (변동값 계산에 1개 소모)
 */
export function calculateRSI(
  sortedPrices: PricePoint[],
  period: number = 14
): (number | null)[] {
  const result: (number | null)[] = [];
  if (sortedPrices.length < period + 1) {
    return sortedPrices.map(() => null);
  }

  // 현재가 변동 배열 (index 0은 null — 이전 현재가 없음)
  const changes: number[] = [];
  for (let i = 1; i < sortedPrices.length; i++) {
    changes.push(sortedPrices[i].price - sortedPrices[i - 1].price);
  }

  // 첫 period일간 단순평균으로 초기 avgGain/avgLoss
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    const change = changes[i];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // 첫 번째 데이터는 변동값 계산 불가 → null
  result.push(null);

  // changes[0]~changes[period-2]까지는 period 미충족 → null
  for (let i = 0; i < period - 1; i++) {
    result.push(null);
  }

  // 첫 RSI (period번째 인덱스에 대응)
  const firstRS = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + firstRS));

  // Wilder's smoothing으로 이후 RSI 계산
  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs));
  }

  return result;
}

export function buildChartDataWithMA(
  historicalPrices: HistoricalPriceData,
  enabledPeriods: number[],
  volumeData?: HistoricalPriceData | null
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
      현재가: sortedPrices[i].price,
    };

    // 거래량 데이터 매핑
    if (volumeData) {
      const vol = volumeData[sortedPrices[i].date];
      if (vol !== undefined && vol > 0) {
        point['거래량'] = vol;
      }
    }

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
