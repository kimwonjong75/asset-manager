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
 * 두 SMA 배열을 역순회하여 가장 최근 교차(crossover) 시점까지의 거래일 수를 반환.
 * 양수 = 골든크로스 N일 전, 음수 = 데드크로스 N일 전, null = 데이터 부족
 */
export function calculateCrossDays(
  shortSma: (number | null)[],
  longSma: (number | null)[]
): number | null {
  // 끝에서부터 둘 다 유효한 첫 인덱스 찾기
  let last = Math.min(shortSma.length, longSma.length) - 1;
  while (last >= 0 && (shortSma[last] === null || longSma[last] === null)) {
    last--;
  }
  if (last < 0) return null;

  const currentShort = shortSma[last]!;
  const currentLong = longSma[last]!;
  // 정확히 같으면 교차 직전/직후 판별 불가
  if (currentShort === currentLong) return null;

  const isGolden = currentShort > currentLong; // 현재 상태

  // 역순회: 상태가 반전된 지점 탐색
  for (let i = last - 1; i >= 0; i--) {
    const s = shortSma[i];
    const l = longSma[i];
    if (s === null || l === null) break; // 데이터 끊김 → 탐색 중단

    const wasGolden = s > l;
    if (wasGolden !== isGolden) {
      // i+1일에 교차 발생 → last에서의 거리
      const daysAgo = last - (i + 1);
      return isGolden ? daysAgo : -daysAgo;
    }
  }

  // 사용 가능한 전체 구간에서 교차 없음 → null
  return null;
}

/**
 * 가격이 MA를 상향돌파한 경과 거래일 수 계산
 * sortedPrices와 smaValues는 동일 길이, 날짜 오름차순
 * 반환: 양수 = N거래일 전 상향돌파, null = 미확인
 */
export function calculatePriceCrossMaDays(
  sortedPrices: PricePoint[],
  smaValues: (number | null)[]
): number | null {
  const last = sortedPrices.length - 1;
  if (last < 1) return null;

  const currentPrice = sortedPrices[last].price;
  const currentMa = smaValues[last];
  if (currentMa === null || currentPrice < currentMa) return null; // 현재 MA 아래면 무의미

  // 역순회: 가격이 MA 아래였던 마지막 지점 탐색
  for (let i = last - 1; i >= 0; i--) {
    const ma = smaValues[i];
    if (ma === null) break;
    if (sortedPrices[i].price < ma) {
      // i일에 아래 → i+1일에 상향돌파
      return last - (i + 1);
    }
  }
  return null; // 전체 구간 동안 항상 MA 위
}

/**
 * RSI가 특정 임계값을 상향돌파한 경과 거래일 수 계산
 * 반환: 양수 = N거래일 전 상향돌파, null = 미확인
 */
export function calculateRsiCrossDays(
  rsiValues: (number | null)[],
  threshold: number
): number | null {
  const last = rsiValues.length - 1;
  if (last < 1) return null;

  const currentRsi = rsiValues[last];
  if (currentRsi === null || currentRsi <= threshold) return null;

  // 역순회: RSI가 threshold 이하였던 마지막 지점 탐색
  for (let i = last - 1; i >= 0; i--) {
    const rsi = rsiValues[i];
    if (rsi === null) break;
    if (rsi <= threshold) {
      return last - (i + 1);
    }
  }
  return null;
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
