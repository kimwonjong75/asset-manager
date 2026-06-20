// utils/maCalculations.ts
// 이동평균선(MA) 계산 유틸리티

import { HistoricalPriceData } from '../services/historicalPriceService';

export interface MALineConfig {
  /** 슬롯 식별자 (ma1~ma6) — period가 사용자 편집 대상이 되어도 슬롯 정체성 유지용 */
  id: string;
  period: number;
  color: string;
  enabled: boolean;
}

export const DEFAULT_MA_CONFIGS: MALineConfig[] = [
  { id: 'ma1', period: 5,   color: '#F59E0B', enabled: false },
  { id: 'ma2', period: 10,  color: '#10B981', enabled: false },
  { id: 'ma3', period: 20,  color: '#EF4444', enabled: true  },
  { id: 'ma4', period: 60,  color: '#3B82F6', enabled: true  },
  { id: 'ma5', period: 120, color: '#EC4899', enabled: false },
  { id: 'ma6', period: 200, color: '#8B5CF6', enabled: false },
];

/** 사용자 입력 MA 기간을 유효 범위로 보정 (1~400 정수, 데이터 10년≈2500거래일 내) */
export function clampMAPeriod(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(400, Math.max(1, Math.round(value)));
}

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
 * 가격이 MA를 하향이탈한 경과 거래일 수 계산
 * sortedPrices와 smaValues는 동일 길이, 날짜 오름차순
 * 반환: 양수 = N거래일 전 하향이탈, null = 미확인(현재 MA 위거나 전 구간 아래)
 */
export function calculatePriceBreakBelowMaDays(
  sortedPrices: PricePoint[],
  smaValues: (number | null)[]
): number | null {
  const last = sortedPrices.length - 1;
  if (last < 1) return null;

  const currentPrice = sortedPrices[last].price;
  const currentMa = smaValues[last];
  if (currentMa === null || currentPrice >= currentMa) return null; // 현재 MA 위면 무의미

  // 역순회: 가격이 MA 위였던 마지막 지점 탐색
  for (let i = last - 1; i >= 0; i--) {
    const ma = smaValues[i];
    if (ma === null) break;
    if (sortedPrices[i].price >= ma) {
      // i일에 위 → i+1일에 하향이탈
      return last - (i + 1);
    }
  }
  return null; // 전체 구간 동안 항상 MA 아래
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

/**
 * OHLCV 기반 신호(52주 신고가/최대거래량/ATR/기울기)에 필요한 최소 캘린더 일수
 * 252 거래일 × 1.5(주말/공휴일 보정) + 60(MA200 워밍업) ≈ 440일
 */
export function getRequiredHistoryDaysForOHLCV(): number {
  return Math.ceil(252 * 1.5) + 60;
}

/**
 * ATR(Average True Range) — Wilder's smoothing
 * True Range = max(high-low, |high-prevClose|, |low-prevClose|)
 * 입력 3개 배열은 동일 길이/날짜 오름차순. 어느 한 값이라도 null/undefined면 해당 인덱스 ATR도 null.
 * 반환 배열의 처음 period개는 null (워밍업)
 */
export function calculateATR(
  highs: (number | null)[],
  lows: (number | null)[],
  closes: (number | null)[],
  period: number = 14
): (number | null)[] {
  const n = Math.min(highs.length, lows.length, closes.length);
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period + 1) return result;

  // True Range 시계열
  const tr: (number | null)[] = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    const h = highs[i], l = lows[i], pc = closes[i - 1];
    if (typeof h !== 'number' || typeof l !== 'number' || typeof pc !== 'number') {
      tr[i] = null;
      continue;
    }
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }

  // 초기 ATR = 첫 period일 TR 단순평균 (인덱스 1..period)
  let sum = 0;
  let validCount = 0;
  for (let i = 1; i <= period; i++) {
    if (typeof tr[i] === 'number') { sum += tr[i] as number; validCount++; }
  }
  if (validCount < period) return result; // 데이터 부족
  let atr = sum / period;
  result[period] = atr;

  // Wilder's smoothing
  for (let i = period + 1; i < n; i++) {
    const t = tr[i];
    if (typeof t !== 'number') {
      result[i] = result[i - 1]; // null 구간은 직전 값 유지
      continue;
    }
    atr = (atr * (period - 1) + t) / period;
    result[i] = atr;
  }
  return result;
}

/**
 * 52주(또는 지정 lookback) 최고 종가
 * 끝에서 lookback개 윈도우의 최댓값. 데이터 부족 시 가용 범위 사용 (null은 데이터 0개일 때만)
 */
export function calculate52WeekHigh(closes: (number | null)[], lookback: number = 252): number | null {
  if (closes.length === 0) return null;
  const start = Math.max(0, closes.length - lookback);
  let max = -Infinity;
  for (let i = start; i < closes.length; i++) {
    const c = closes[i];
    if (typeof c === 'number' && c > max) max = c;
  }
  return max === -Infinity ? null : max;
}

/**
 * 52주(또는 지정 lookback) 최대 거래량
 */
export function calculate52WeekMaxVolume(volumes: (number | null)[], lookback: number = 252): number | null {
  if (volumes.length === 0) return null;
  const start = Math.max(0, volumes.length - lookback);
  let max = -Infinity;
  for (let i = start; i < volumes.length; i++) {
    const v = volumes[i];
    if (typeof v === 'number' && v > max) max = v;
  }
  return max === -Infinity ? null : max;
}

/**
 * 단순 OLS 선형회귀 기울기 — 끝에서 period개 값의 기울기를 평균값으로 정규화
 * 정규화: slope / mean → 종목 간 비교 가능한 무차원 값
 * 반환 단위: "1거래일당 평균값 대비 변화 비율" (예: 0.01 = 일평균 1% 상승 추세)
 */
export function calculateLinearRegressionSlope(values: (number | null)[], period: number): number | null {
  if (values.length < period) return null;
  const start = values.length - period;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < period; i++) {
    const v = values[start + i];
    if (typeof v !== 'number') return null;
    xs.push(i);
    ys.push(v);
  }
  const meanY = ys.reduce((a, b) => a + b, 0) / period;
  if (meanY === 0) return null;

  const meanX = (period - 1) / 2;
  let num = 0;
  let den = 0;
  for (let i = 0; i < period; i++) {
    const dx = xs[i] - meanX;
    num += dx * (ys[i] - meanY);
    den += dx * dx;
  }
  if (den === 0) return null;
  const slope = num / den;
  return slope / meanY;
}

/**
 * 단기/장기 기울기 비율 (미너비니 클라이맥스 (a)용)
 * 단기 기울기 / 장기 기울기. 두 기울기 모두 양수일 때만 의미 있음.
 * 둘 중 하나가 null/0/음수면 null.
 */
export function calculateSlopeRatio(
  closes: (number | null)[],
  shortPeriod: number = 10,
  longPeriod: number = 60
): number | null {
  const shortSlope = calculateLinearRegressionSlope(closes, shortPeriod);
  const longSlope = calculateLinearRegressionSlope(closes, longPeriod);
  if (shortSlope === null || longSlope === null) return null;
  if (longSlope <= 0) return null; // 장기 추세가 상승이 아니면 클라이맥스 정의 불가
  if (shortSlope <= 0) return 0;
  return shortSlope / longSlope;
}

function formatDateForChart(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
}
