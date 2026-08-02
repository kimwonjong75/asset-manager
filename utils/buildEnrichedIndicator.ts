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
const PRICE_HIGH_TOLERANCE = 1e-9;
const LONG_TREND_LOOKBACK = 60;
const LONG_TREND_GROWTH = 1.1;
const SWING_LOW_LOOKBACK = 60;
const SWING_LOW_BARS = 5;
// ── 강의검증 급성 매도 신호 창 상수 (scripts/backtest/lectureSignals/configTypes.ts CONST와 동일) ──
const RUNUP_1M_LOOKBACK = 21;      // S1: 21거래일
const RUNUP_1W_LOOKBACK = 5;       // S2: 5거래일
const ACUTE_VOLUME_BASELINE = 20;  // S4/S6: 20일 평균거래량 (당일 제외)
const TURNOVER_MAX_WINDOW = 63;    // S5: 거래대금 프록시 최근 63일 최대 (당일 포함)

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

  // ── 강의검증 급성 매도 신호 재료 (KR 전용, 룩어헤드 0 — 아래 규약 준수) ──
  // · 수익률/가격비: close[i]/close[i-k] (미래참조 없음).
  // · 20일 평균거래량은 당일 D 제외([i-20 .. i-1], 백테스트 priorMean과 동일) — 룩어헤드 방지.
  // · 거래대금 프록시 63일 최대는 당일 포함([i-62 .. i]) — "당일이 신고 거래대금" 판정(S5_APP_PROXY 정의).
  // 판정은 evaluateSingleFilter가 하고, 여기서는 순수 재료만 계산한다.
  const runup21dRatio = (() => {
    const j = lastIdx - RUNUP_1M_LOOKBACK;
    if (j < 0) return null;
    const base = closes[j];
    return typeof todayClose === 'number' && base > 0 ? todayClose / base : null;
  })();
  const runup5dRatio = (() => {
    const j = lastIdx - RUNUP_1W_LOOKBACK;
    if (j < 0) return null;
    const base = closes[j];
    return typeof todayClose === 'number' && base > 0 ? todayClose / base : null;
  })();
  // 당일 종가/전일 종가 (close-to-close, 백테스트 dailyRatio). **metrics.yesterdayChange 아님** — 백테스트 정합용.
  const todayDailyRatio =
    typeof prevClose === 'number' && prevClose > 0 && typeof todayClose === 'number'
      ? todayClose / prevClose
      : null;
  // 종가==고가 (상대 허용오차, 백테스트 S3와 동일: |close-high| ≤ 1e-9·max(1,high))
  const todayCloseEqualsHigh =
    typeof todayHigh === 'number' && typeof todayClose === 'number'
      ? Math.abs(todayClose - todayHigh) <= PRICE_HIGH_TOLERANCE * Math.max(1, todayHigh)
      : null;
  // 시가갭 open[i]/close[i-1]
  const gapUpRatio =
    typeof todayOpen === 'number' && typeof prevClose === 'number' && prevClose > 0
      ? todayOpen / prevClose
      : null;
  // 당일 음봉 (close < open) — isBullishCandle(close>open)과 별개(도지 close==open은 둘 다 false)
  const todayIsBearishCandle =
    typeof todayOpen === 'number' && typeof todayClose === 'number'
      ? todayClose < todayOpen
      : null;
  // 20일 평균거래량 대비 (당일 제외 — 룩어헤드 규약). 창 내 거래량 결측 있으면 판정 불가(null).
  const volumeVs20dAvg = (() => {
    const start = lastIdx - ACUTE_VOLUME_BASELINE;
    if (start < 0 || typeof todayVolume !== 'number') return null;
    let s = 0;
    for (let k = start; k <= lastIdx - 1; k++) {
      const v = volumes[k];
      if (typeof v !== 'number') return null;
      s += v;
    }
    const base = s / ACUTE_VOLUME_BASELINE;
    return base > 0 ? todayVolume / base : null;
  })();
  // 거래대금 프록시(종가×거래량)가 최근 63일(당일 포함) 최대 여부.
  // **프록시 주의**: 원천 거래대금(거래대금 amount)이 아니라 조정종가×거래량. 백테스트에서 원천(S5_AMOUNT)과
  // 프록시(S5_APP_PROXY)가 검증등급 동일(둘 다 REVIEW_WARNING) 확인됨 → 런타임은 프록시만 사용.
  const turnoverProxyIsMax63d = (() => {
    const start = lastIdx - TURNOVER_MAX_WINDOW + 1;
    if (start < 0 || typeof todayVolume !== 'number' || typeof todayClose !== 'number') return null;
    const today = todayClose * todayVolume;
    let mx = -Infinity;
    for (let k = start; k <= lastIdx; k++) {
      const v = volumes[k];
      if (typeof v !== 'number') return null;
      const p = closes[k] * v;
      if (p > mx) mx = p;
    }
    return today >= mx;
  })();

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
    runup21dRatio,
    runup5dRatio,
    todayDailyRatio,
    todayCloseEqualsHigh,
    gapUpRatio,
    todayIsBearishCandle,
    volumeVs20dAvg,
    turnoverProxyIsMax63d,
  };
}
