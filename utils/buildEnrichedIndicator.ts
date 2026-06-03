// utils/buildEnrichedIndicator.ts
// 단일 종목 OHLCV → EnrichedIndicatorData 빌더 (순수 함수)
//
// 이 함수는 `useEnrichedIndicators` 훅(런타임)과 백테스트 스크립트가 동일하게 호출한다.
// 알고리즘 drift를 방지하기 위해 모든 enrichment 계산은 이 한 곳에서만 정의된다.
//
// 입력 시계열은 모두 동일 길이/날짜 오름차순. 값 없는 일자는 null로 채워서 전달할 것.

import {
  calculateSMA,
  calculateRSI,
  calculateCrossDays,
  calculatePriceCrossMaDays,
  calculatePriceBreakBelowMaDays,
  calculateRsiCrossDays,
  calculateATR,
  calculate52WeekHigh,
  calculate52WeekMaxVolume,
  calculateSlopeRatio,
} from './maCalculations';
import { detectRecentSwingLow } from './swingPointDetection';
import { buildDistributionMeta } from './marketDistribution';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';

export const MA_PERIODS = [5, 10, 20, 60, 120, 150, 200] as const;
export const RSI_PERIOD = 14;
export const DISTRIBUTION_META_LENGTH = 30;
export const VOLUME_AVG_PERIOD_DISTRIBUTION = 50;
/** 클라이맥스 (c) 보조 조건: 52w 거래량 최대가 아니어도 50일 평균의 N배 이상이면 인정 (P4.5 C3) */
export const CLIMAX_C_VOL_SURGE_RATIO = 2.0;
const PRICE_HIGH_TOLERANCE = 1e-9;
const LONG_TREND_LOOKBACK = 60;
const LONG_TREND_GROWTH = 1.1;
const SWING_LOW_LOOKBACK = 60;
const SWING_LOW_BARS = 5;

export interface BuildEnrichedInput {
  /** 날짜 오름차순 정렬된 날짜 키 (YYYY-MM-DD) */
  sortedDates: string[];
  /** 종가 — 항상 number (null 자리는 미리 제거된 상태) */
  closes: number[];
  /** 시가 — 값 없으면 null */
  opens: (number | null)[];
  /** 고가 */
  highs: (number | null)[];
  /** 저가 */
  lows: (number | null)[];
  /** 거래량 (프록시 적용 후) */
  volumes: (number | null)[];
}

/**
 * 단일 종목 enrichment — `useEnrichedIndicators` 훅과 백테스트가 공유하는 핵심 빌더.
 * 입력 데이터 부족(sortedDates < 2 등)이면 가능한 필드만 채우고 나머지는 null/false.
 */
export function buildEnrichedIndicator(input: BuildEnrichedInput): EnrichedIndicatorData {
  const { sortedDates, closes, opens, highs, lows, volumes } = input;
  const sortedPrices = sortedDates.map((date, i) => ({ date, price: closes[i] }));

  const ohlcvAvailable =
    opens.some(v => v !== null) &&
    highs.some(v => v !== null) &&
    lows.some(v => v !== null);

  // MA 전 기간 계산
  const ma: Record<number, number | null> = {};
  const prevMa: Record<number, number | null> = {};
  const smaArrays: Record<number, (number | null)[]> = {};
  for (const period of MA_PERIODS) {
    const smaValues = calculateSMA(sortedPrices, period);
    smaArrays[period] = smaValues;
    const lastIdx = smaValues.length - 1;
    ma[period] = lastIdx >= 0 ? smaValues[lastIdx] : null;
    prevMa[period] = lastIdx >= 1 ? smaValues[lastIdx - 1] : null;
  }

  // MA 교차 경과일 (모든 short < long 쌍)
  const maCrossDays: Record<number, Record<number, number | null>> = {};
  for (let i = 0; i < MA_PERIODS.length; i++) {
    for (let j = i + 1; j < MA_PERIODS.length; j++) {
      const short = MA_PERIODS[i];
      const long = MA_PERIODS[j];
      if (!maCrossDays[short]) maCrossDays[short] = {};
      maCrossDays[short][long] = calculateCrossDays(smaArrays[short], smaArrays[long]);
    }
  }

  // RSI
  const rsiValues = calculateRSI(sortedPrices, RSI_PERIOD);
  const lastRsiIdx = rsiValues.length - 1;
  const rsi = lastRsiIdx >= 0 ? rsiValues[lastRsiIdx] : null;
  const prevRsi = lastRsiIdx >= 1 ? rsiValues[lastRsiIdx - 1] : null;

  const prevClose = sortedPrices.length >= 2
    ? sortedPrices[sortedPrices.length - 2].price
    : null;

  // 가격 vs MA 상향돌파/하향이탈 경과일
  const priceCrossMaDays: Record<number, number | null> = {};
  const priceBreakBelowMaDays: Record<number, number | null> = {};
  for (const period of MA_PERIODS) {
    priceCrossMaDays[period] = calculatePriceCrossMaDays(sortedPrices, smaArrays[period]);
    priceBreakBelowMaDays[period] = calculatePriceBreakBelowMaDays(sortedPrices, smaArrays[period]);
  }

  const rsiBounceDay = calculateRsiCrossDays(rsiValues, 30);
  const rsiOverheatEntryDay = calculateRsiCrossDays(rsiValues, 70);

  // ── OHLCV 기반 ──
  const closesNullable: (number | null)[] = closes;

  const atrSeries = ohlcvAvailable
    ? calculateATR(highs, lows, closesNullable, 14)
    : [];
  const atr14 = atrSeries.length > 0 ? atrSeries[atrSeries.length - 1] : null;

  const high52w = calculate52WeekHigh(closesNullable);
  const volume52wMax = calculate52WeekMaxVolume(volumes);
  const slopeRatio = calculateSlopeRatio(closesNullable, 10, 60);

  const lastIdx = sortedDates.length - 1;
  const todayHigh = lastIdx >= 0 ? highs[lastIdx] : null;
  const todayLow = lastIdx >= 0 ? lows[lastIdx] : null;
  const dayRangeOverAtr =
    ohlcvAvailable && typeof todayHigh === 'number' && typeof todayLow === 'number' && typeof atr14 === 'number' && atr14 > 0
      ? (todayHigh - todayLow) / atr14
      : null;

  const todayClose = lastIdx >= 0 ? closes[lastIdx] : null;
  const todayVolume = lastIdx >= 0 ? volumes[lastIdx] : null;
  const priceIsAt52wHigh =
    typeof high52w === 'number' && typeof todayClose === 'number' && todayClose >= high52w - PRICE_HIGH_TOLERANCE;
  const volumeIsAt52wMax =
    typeof volume52wMax === 'number' && typeof todayVolume === 'number' && todayVolume >= volume52wMax - PRICE_HIGH_TOLERANCE;

  const todayOpen = lastIdx >= 0 ? opens[lastIdx] : null;
  const isBullishCandle: boolean | null =
    typeof todayOpen === 'number' && typeof todayClose === 'number'
      ? todayClose > todayOpen
      : null;

  const sma60 = smaArrays[60];
  const ma60Today = sma60[sma60.length - 1] ?? null;
  const ma60PastIdx = sma60.length - 1 - LONG_TREND_LOOKBACK;
  const ma60Past = ma60PastIdx >= 0 ? sma60[ma60PastIdx] : null;
  const longTrendUp: boolean | null =
    typeof ma60Today === 'number' && typeof ma60Past === 'number' && ma60Past > 0
      ? ma60Today > ma60Past * LONG_TREND_GROWTH
      : null;

  const swingLow = detectRecentSwingLow(sortedPrices, SWING_LOW_LOOKBACK, SWING_LOW_BARS, SWING_LOW_BARS);
  const recentSwingLow = swingLow?.price ?? null;

  const distributionDayMeta = buildDistributionMeta(opens, highs, lows, closesNullable, volumes, {
    metaLength: DISTRIBUTION_META_LENGTH,
    volumeAvgPeriod: VOLUME_AVG_PERIOD_DISTRIBUTION,
  });

  return {
    ma,
    prevMa,
    rsi,
    prevRsi,
    maCrossDays,
    prevClose,
    priceCrossMaDays,
    priceBreakBelowMaDays,
    rsiBounceDay,
    rsiOverheatEntryDay,
    atr14,
    high52w,
    volume52wMax,
    slopeRatio,
    dayRangeOverAtr,
    priceIsAt52wHigh,
    volumeIsAt52wMax,
    distributionDayMeta,
    ohlcvAvailable,
    isBullishCandle,
    longTrendUp,
    recentSwingLow,
  };
}
