// scripts/backtest/lectureSignals/appRules.ts
// ---------------------------------------------------------------------------
// P4 — 앱 매도규칙(현행 `constants/alertRules.ts` 매도 14종)의 **백테스트 측 독립 재현**.
//
// 목적: "이 신호들을 앱에 넣으면 기존 매도규칙 대비 무엇이 좋아지는가"를 정량화하려면
//   기존 규칙이 과거에 언제 발동했는지를 재현해야 한다. 앱 코드는 **읽기만** 하고
//   여기서 독립 구현한다(계획서 §3 P4: "재현 코드는 앱 로직을 읽어 백테스트 측에 독립 구현").
//   패리티 위험은 `tests/lectureAppRulesParity.ts`의 골든값 + 드라이버의 앱경로 대조감사로 막는다.
//
// 재현 원본(2026-07-26 기준 읽은 파일):
//   · constants/alertRules.ts        — 매도 14종 정의(id/filters/filterConfig/enabled)
//   · utils/smartFilterLogic.ts      — evaluateSingleFilter 3치 판정(필터키별 임계·경계)
//   · utils/alertChecker.ts          — matchesRule = filters **AND** 결합, null→false 매핑
//   · utils/buildEnrichedIndicator.ts— 지표 빌더(MA/RSI/ATR/52주/기울기/스윙로우/디스트리뷰션)
//   · utils/maCalculations.ts        — SMA·RSI(Wilder)·ATR(Wilder)·교차경과일·회귀기울기
//   · utils/climaxFlags.ts           — countClimaxFlags (a)(b)(c)
//   · utils/marketDistribution.ts    — buildDistributionMeta / countDistributionDays
//   · utils/swingPointDetection.ts   — detectRecentSwingLow(60, 5, 5)
//   · hooks/usePortfolioCalculator.ts— metrics.returnPercentage / dropFromHigh / yesterdayChange
//
// 재현 제외 1종: `strong-sell-signal`
//   필터 `SIGNAL_STRONG_SELL`(백엔드 `indicators.signal`) + `VOLUME_HIGH`(백엔드 `volume_ratio`).
//   두 필드 모두 Cloud Run 백엔드가 산출하는 값이고 산식이 이 저장소에 없다(RULES §14, 저장소 밖).
//   백테스트 데이터(OHLCV+거래대금)로 복원 불가. **또한 이 규칙은 앱 기본값이 `enabled: false`**
//   (`constants/alertRules.ts:91`)이므로 현행 앱 사용자에게 발화하지 않는다 → C에서 빠져도
//   "현행 앱 동작"의 재현에는 결손이 없다.
//
// 룩어헤드 0: 모든 계산은 [0 .. i] 구간만 참조한다(앱 빌더가 "마지막 인덱스" 값을 내는 것과 동일).
//
// 규칙: `any`·`console.*`·`Math.random` 금지. 순수 함수만.
// ---------------------------------------------------------------------------

import type { SecurityBars } from './configTypes';

// ===========================================================================
// 규칙 목록 / 설정 (앱 기본값 그대로)
// ===========================================================================

/** 재현 대상 매도규칙 13종(앱 기본 `enabled: true`). 배열 순서 = 리포트 표기 순서. */
export const APP_SELL_RULE_IDS = [
  'stop-loss',
  'overheat-drop',
  'dead-cross',
  'trend-break',
  'long-decline',
  'profit-target',
  'overheat-profit',
  'daily-crash',
  'climax-top',
  'distribution-high',
  'weinstein-150-break',
  'ma120-break',
  'swing-low-break',
] as const;

export type AppSellRuleId = (typeof APP_SELL_RULE_IDS)[number];

/** 재현 불가 규칙(사유는 파일 헤더 참조). */
export const APP_SELL_RULE_EXCLUDED = ['strong-sell-signal'] as const;

/** 앱 `constants/alertRules.ts` 매도규칙의 filterConfig 기본값(하드코딩된 그대로). */
export const APP_RULE_CONST = {
  lossThreshold: 5, // stop-loss
  rsiOverbought: 70, // overheat-drop
  deadCrossShort: 5,
  deadCrossLong: 20,
  deadCrossMaxLookback: 252,
  trendBreakMa: 20, // trend-break maShortPeriod
  longDeclineShort: 20,
  longDeclineLong: 60,
  dropFromHighThreshold: 20,
  profitTarget: 20,
  overheatProfitTarget: 15,
  overheatWithinDays: 3,
  rsiOverheatFloor: 65, // RSI_OVERHEAT_ENTRY 진입 유지 하한
  rsiOverheatEntry: 70, // 진입 임계
  dailyCrashThreshold: 5,
  climaxFlagsRequired: 2,
  climaxSlopeMultiplier: 2.5,
  climaxAtrMultiple: 2.5,
  climaxCVolSurgeRatio: 2.0, // utils/climaxFlags CLIMAX_C_VOL_SURGE_RATIO
  distributionWindow: 13,
  distributionVolumeRatio: 1.5,
  distributionThreshold: 5,
  weinsteinMa: 150,
  weinsteinWithinDays: 5,
  ma120Period: 120,
  ma120WithinDays: 5,
} as const;

/** utils/buildEnrichedIndicator.ts 의 빌더 상수(동일 값). */
export const APP_BUILDER_CONST = {
  maPeriods: [5, 10, 20, 60, 120, 150, 200] as const,
  rsiPeriod: 14,
  atrPeriod: 14,
  distributionMetaLength: 30,
  volumeAvgPeriodDistribution: 50,
  priceHighTolerance: 1e-9,
  longTrendLookback: 60,
  longTrendGrowth: 1.1,
  swingLowLookback: 60,
  swingLowBars: 5,
  high52wLookback: 252,
  slopeShort: 10,
  slopeLong: 60,
} as const;

// ===========================================================================
// 저수준 지표 (utils/maCalculations.ts 재현 — 계산 순서까지 동일)
// ===========================================================================

/**
 * SMA(당일 포함 period일 평균). 앱 `calculateSMA`와 동일 정의 **+ 동일 합산 순서**.
 *
 * ⚠ 롤링합(O(1))을 쓰지 않는다. 거래정지로 종가가 수십 일 동일한 종목에서는 `종가 == MA`가
 * 정확히 성립해 `price < ma` 판정이 **부동소수 마지막 비트**로 갈린다(실제로 감사에서 발견됨:
 * 디에스앤엘 2020-03~04 거래정지 구간, 5540.31 × 20 / 20 ≠ 5540.31). 앱과 완전히 같은
 * 순차 합산(창 시작→끝)으로 계산해 그 경계까지 일치시킨다. O(n·period)이지만 실행에 문제 없다.
 */
export function smaSeries(values: readonly number[], period: number): (number | null)[] {
  const n = values.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (period <= 0) return out;
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    out[i] = sum / period;
  }
  return out;
}

/**
 * 디스트리뷰션·클라이맥스 (c)가 공유하는 거래량비 = volume[i] / mean(volume[i-period .. i-1]).
 * 앱 `marketDistribution.trailingVolumeAvg`와 동일(당일 제외, 창 부족이면 null, 합산 순서 동일).
 */
export function volumeRatioSeries(
  volumes: readonly number[],
  period: number
): (number | null)[] {
  const n = volumes.length;
  const out: (number | null)[] = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    let sum = 0;
    for (let j = i - period; j < i; j++) sum += volumes[j];
    const avg = sum / period;
    out[i] = avg > 0 ? volumes[i] / avg : null;
  }
  return out;
}

/** RSI(Wilder). 앱 `calculateRSI`의 시딩·평활을 1:1 재현. */
export function rsiSeries(closes: readonly number[], period = 14): (number | null)[] {
  const n = closes.length;
  if (n < period + 1) return new Array(n).fill(null);
  const changes: number[] = [];
  for (let i = 1; i < n; i++) changes.push(closes[i] - closes[i - 1]);

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    const c = changes[i];
    if (c > 0) avgGain += c;
    else avgLoss += Math.abs(c);
  }
  avgGain /= period;
  avgLoss /= period;

  const out: (number | null)[] = [];
  out.push(null);
  for (let i = 0; i < period - 1; i++) out.push(null);
  const firstRS = avgLoss === 0 ? 100 : avgGain / avgLoss;
  out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + firstRS));

  for (let i = period; i < changes.length; i++) {
    const c = changes[i];
    const gain = c > 0 ? c : 0;
    const loss = c < 0 ? Math.abs(c) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs));
  }
  return out;
}

/** ATR(Wilder). 앱 `calculateATR` 재현(입력 결측 없음을 전제로 하되 분기는 동일). */
export function atrSeries(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  period = 14
): (number | null)[] {
  const n = Math.min(highs.length, lows.length, closes.length);
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period + 1) return result;

  const tr: (number | null)[] = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    const h = highs[i];
    const l = lows[i];
    const pc = closes[i - 1];
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }

  let sum = 0;
  let validCount = 0;
  for (let i = 1; i <= period; i++) {
    if (typeof tr[i] === 'number') {
      sum += tr[i] as number;
      validCount++;
    }
  }
  if (validCount < period) return result;
  let atr = sum / period;
  result[period] = atr;
  for (let i = period + 1; i < n; i++) {
    const t = tr[i];
    if (typeof t !== 'number') {
      result[i] = result[i - 1];
      continue;
    }
    atr = (atr * (period - 1) + t) / period;
    result[i] = atr;
  }
  return result;
}

/** 정규화 OLS 기울기(앱 `calculateLinearRegressionSlope`) — 끝 인덱스 endIdx 기준 period개. */
export function normalizedSlopeAt(
  values: readonly number[],
  endIdx: number,
  period: number
): number | null {
  const start = endIdx - period + 1;
  if (start < 0) return null;
  let sumY = 0;
  for (let k = 0; k < period; k++) sumY += values[start + k];
  const meanY = sumY / period;
  if (meanY === 0) return null;
  const meanX = (period - 1) / 2;
  let num = 0;
  let den = 0;
  for (let k = 0; k < period; k++) {
    const dx = k - meanX;
    num += dx * (values[start + k] - meanY);
    den += dx * dx;
  }
  if (den === 0) return null;
  return num / den / meanY;
}

/** 단기/장기 기울기 비(앱 `calculateSlopeRatio`). */
export function slopeRatioAt(closes: readonly number[], endIdx: number): number | null {
  const s = normalizedSlopeAt(closes, endIdx, APP_BUILDER_CONST.slopeShort);
  const l = normalizedSlopeAt(closes, endIdx, APP_BUILDER_CONST.slopeLong);
  if (s === null || l === null) return null;
  if (l <= 0) return null;
  if (s <= 0) return 0;
  return s / l;
}

/** 롤링 최댓값(당일 포함 lookback개). 앱 `calculate52WeekHigh/MaxVolume`과 동일 창. */
export function rollingMaxSeries(values: readonly number[], lookback: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(-Infinity);
  const dq: number[] = []; // 인덱스 단조감소 deque
  for (let i = 0; i < n; i++) {
    while (dq.length > 0 && values[dq[dq.length - 1]] <= values[i]) dq.pop();
    dq.push(i);
    const lo = Math.max(0, i - lookback + 1);
    while (dq[0] < lo) dq.shift();
    out[i] = values[dq[0]];
  }
  return out;
}

// ===========================================================================
// 지표 시계열 번들
// ===========================================================================

export interface AppIndicatorSeries {
  code: string;
  dates: readonly string[];
  close: readonly number[];
  open: readonly number[];
  n: number;
  /** MA 전 기간 */
  ma: Record<number, (number | null)[]>;
  rsi: (number | null)[];
  /** MA5/MA20 교차 경과일(양수=골든, 음수=데드, null=교차 미확인) */
  maCrossDays5x20: (number | null)[];
  /** 가격의 MA 하향이탈 경과일 (150·120) */
  breakBelowMaDays: Record<number, (number | null)[]>;
  /** RSI 70 상향돌파 경과일 */
  rsiOverheatEntryDay: (number | null)[];
  /** 클라이맥스 플래그 수 (앱 기본 프로필) */
  climaxFlagCount: number[];
  /** 디스트리뷰션 13일 카운트 */
  distributionCount: number[];
  /** 최근 확정 swing low 종가(없으면 null) */
  swingLow: (number | null)[];
  /** 트레일링 252일 최고 종가(당일 포함) */
  trailingHigh252: number[];
  /** close[i]/close[i-1] */
  dailyRatio: (number | null)[];
}

/** 종목 1개의 앱 지표 시계열 전체를 1회 계산(O(n)~O(n·70)). */
export function buildAppIndicatorSeries(bars: SecurityBars): AppIndicatorSeries {
  const closes = bars.adjClose as readonly number[];
  const opens = bars.adjOpen as readonly number[];
  const highs = bars.adjHigh as readonly number[];
  const lows = bars.adjLow as readonly number[];
  const volumes = bars.adjVolume as readonly number[];
  const n = closes.length;

  // ── MA ──
  const ma: Record<number, (number | null)[]> = {};
  for (const p of APP_BUILDER_CONST.maPeriods) ma[p] = smaSeries(closes, p);

  // ── RSI ──
  const rsi = rsiSeries(closes, APP_BUILDER_CONST.rsiPeriod);

  // ── MA5 x MA20 교차 경과일 ──
  // 앱 calculateCrossDays: b[i] = ma5>ma20 (동률은 false 취급). 가장 최근 b가 반대였던 j를 찾아
  // daysAgo = i-(j+1), 부호 = 현재 골든이면 +, 데드면 −. 동률이면 null. 못 찾으면 null.
  const maCrossDays5x20: (number | null)[] = new Array(n).fill(null);
  {
    const s = ma[APP_RULE_CONST.deadCrossShort];
    const l = ma[APP_RULE_CONST.deadCrossLong];
    let lastTrue = -1; // b[j]===true 인 마지막 j
    let lastFalse = -1; // b[j]===false 인 마지막 j
    for (let i = 0; i < n; i++) {
      const sv = s[i];
      const lv = l[i];
      if (sv === null || lv === null) continue;
      if (sv !== lv) {
        const isGolden = sv > lv;
        const j = isGolden ? lastFalse : lastTrue;
        if (j >= 0) {
          const daysAgo = i - (j + 1);
          maCrossDays5x20[i] = isGolden ? daysAgo : -daysAgo;
        }
      }
      // 상태 갱신(동률은 wasGolden=false 취급 — 앱 backward scan과 동일)
      if (sv > lv) lastTrue = i;
      else lastFalse = i;
    }
  }

  // ── 가격 MA 하향이탈 경과일 (150 · 120) ──
  const breakBelowMaDays: Record<number, (number | null)[]> = {};
  for (const p of [APP_RULE_CONST.weinsteinMa, APP_RULE_CONST.ma120Period]) {
    const arr: (number | null)[] = new Array(n).fill(null);
    const m = ma[p];
    let lastAbove = -1;
    for (let i = 0; i < n; i++) {
      const mv = m[i];
      if (i >= 1 && mv !== null && closes[i] < mv && lastAbove >= 0) {
        arr[i] = i - (lastAbove + 1);
      }
      if (mv !== null && closes[i] >= mv) lastAbove = i;
    }
    breakBelowMaDays[p] = arr;
  }

  // ── RSI 70 상향돌파 경과일 ──
  const rsiOverheatEntryDay: (number | null)[] = new Array(n).fill(null);
  {
    let lastLE = -1;
    for (let i = 0; i < n; i++) {
      const r = rsi[i];
      if (r === null) continue;
      if (i >= 1 && r > APP_RULE_CONST.rsiOverheatEntry && lastLE >= 0) {
        rsiOverheatEntryDay[i] = i - (lastLE + 1);
      }
      if (r <= APP_RULE_CONST.rsiOverheatEntry) lastLE = i;
    }
  }

  // ── 거래량비(디스트리뷰션·클라이맥스 (c) 공용) ──
  const volRatio = volumeRatioSeries(volumes, APP_BUILDER_CONST.volumeAvgPeriodDistribution);

  // ── 디스트리뷰션 메타 + 13일 카운트 ──
  const distributionCount = new Array<number>(n).fill(0);
  {
    const isChurn: boolean[] = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      const h = highs[i];
      const lo = lows[i];
      const c = closes[i];
      const o = opens[i];
      const pc = i > 0 ? closes[i - 1] : null;
      const isBearish = c < o;
      const isLowerHalf = h > lo ? (c - lo) / (h - lo) < 0.5 : null;
      const changeRatio = pc !== null && pc > 0 ? (c - pc) / pc : 0;
      isChurn[i] = isBearish === true || isLowerHalf === true || changeRatio < 0.002;
    }
    const W = APP_RULE_CONST.distributionWindow;
    for (let i = 0; i < n; i++) {
      // 앱: meta 길이 = min(30, i+1), useWindow = min(13, meta.length)
      const metaLen = Math.min(APP_BUILDER_CONST.distributionMetaLength, i + 1);
      const useWindow = Math.min(Math.max(1, W), metaLen);
      let c = 0;
      for (let k = i - useWindow + 1; k <= i; k++) {
        const vr = volRatio[k];
        if (typeof vr !== 'number' || vr < APP_RULE_CONST.distributionVolumeRatio) continue;
        if (isChurn[k]) c++;
      }
      distributionCount[i] = c;
    }
  }

  // ── 클라이맥스 플래그 수 ──
  const climaxFlagCount = new Array<number>(n).fill(0);
  {
    const atr = atrSeries(highs, lows, closes, APP_BUILDER_CONST.atrPeriod);
    const high252 = rollingMaxSeries(closes, APP_BUILDER_CONST.high52wLookback);
    const vol252 = rollingMaxSeries(volumes, APP_BUILDER_CONST.high52wLookback);
    const tol = APP_BUILDER_CONST.priceHighTolerance;
    const ma60 = ma[APP_BUILDER_CONST.longTrendLookback];
    for (let i = 0; i < n; i++) {
      // (c) 보조: 당일 volRatio(50일 trailing, 당일 제외) — 디스트리뷰션과 동일 시계열
      const volRatioToday = volRatio[i];
      // requireLongTrendUp: longTrendUp === false 면 0
      const m60 = ma60[i];
      const pastIdx = i - APP_BUILDER_CONST.longTrendLookback;
      const m60Past = pastIdx >= 0 ? ma60[pastIdx] : null;
      const longTrendUp: boolean | null =
        m60 !== null && m60Past !== null && m60Past > 0
          ? m60 > m60Past * APP_BUILDER_CONST.longTrendGrowth
          : null;
      if (longTrendUp === false) {
        climaxFlagCount[i] = 0;
        continue;
      }
      let count = 0;
      // (a)
      const sr = slopeRatioAt(closes, i);
      if (sr !== null && sr >= APP_RULE_CONST.climaxSlopeMultiplier) count++;
      // (b)
      const a = atr[i];
      if (a !== null && a > 0) {
        const dayRangeOverAtr = (highs[i] - lows[i]) / a;
        if (dayRangeOverAtr >= APP_RULE_CONST.climaxAtrMultiple) {
          // requireBullishCandle: isBullishCandle !== false → close>open 이어야 카운트
          if (closes[i] > opens[i]) count++;
        }
      }
      // (c)
      if (closes[i] >= high252[i] - tol) {
        const volAt52wMax = volumes[i] >= vol252[i] - tol;
        if (
          volAt52wMax ||
          (typeof volRatioToday === 'number' && volRatioToday >= APP_RULE_CONST.climaxCVolSurgeRatio)
        ) {
          count++;
        }
      }
      climaxFlagCount[i] = count;
    }
  }

  // ── swing low ──
  const swingLow: (number | null)[] = new Array(n).fill(null);
  {
    const L = APP_BUILDER_CONST.swingLowBars;
    const LB = APP_BUILDER_CONST.swingLowLookback;
    const isSwing = new Array<boolean>(n).fill(false);
    for (let j = L; j + L < n; j++) {
      const center = closes[j];
      let ok = true;
      for (let k = j - L; k <= j + L; k++) {
        if (k === j) continue;
        if (closes[k] < center) {
          ok = false;
          break;
        }
      }
      isSwing[j] = ok;
    }
    for (let i = 0; i < n; i++) {
      const len = i + 1;
      if (len < L + L + 1) continue;
      const windowStart = Math.max(L, len - LB);
      const windowEnd = len - L - 1; // = i - L
      for (let j = windowEnd; j >= windowStart; j--) {
        if (isSwing[j]) {
          swingLow[i] = closes[j];
          break;
        }
      }
    }
  }

  const trailingHigh252 = rollingMaxSeries(closes, APP_BUILDER_CONST.high52wLookback);

  const dailyRatio: (number | null)[] = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    const pc = closes[i - 1];
    dailyRatio[i] = pc > 0 ? closes[i] / pc : null;
  }

  return {
    code: bars.code,
    dates: bars.dates,
    close: closes,
    open: opens,
    n,
    ma,
    rsi,
    maCrossDays5x20,
    breakBelowMaDays,
    rsiOverheatEntryDay,
    climaxFlagCount,
    distributionCount,
    swingLow,
    trailingHigh252,
    dailyRatio,
  };
}

// ===========================================================================
// 규칙 판정
// ===========================================================================

/** 보유 상태(앱 asset의 매수단가·최고가에 대응). */
export interface AppPositionState {
  /** 매수 체결가(원). metrics.returnPercentage 분모. */
  purchasePrice: number;
  /**
   * 앱 `asset.highestPrice` 대응. 앱은 max(저장된 최고가, 백엔드 52주 고가, 현재가)로 갱신되므로
   * 백테스트는 **max(트레일링 252일 최고 종가, 매수 후 러닝 최고 종가, 매수가)** 로 근사한다.
   * (차이: 앱은 백엔드의 **장중** 52주 고가를 쓸 수 있고 무조정가 기준일 수 있음 — 문서에 명시)
   */
  highestPrice: number;
}

export type AppRuleFlags = Record<AppSellRuleId, boolean>;

const EMPTY_FLAGS = (): AppRuleFlags => ({
  'stop-loss': false,
  'overheat-drop': false,
  'dead-cross': false,
  'trend-break': false,
  'long-decline': false,
  'profit-target': false,
  'overheat-profit': false,
  'daily-crash': false,
  'climax-top': false,
  'distribution-high': false,
  'weinstein-150-break': false,
  'ma120-break': false,
  'swing-low-break': false,
});

/**
 * i일에 각 매도규칙이 발동했는지 판정. 앱 `matchesRule`(filters AND, null→false)와 동등.
 * 미래참조 없음. pos가 없으면 보유가 의존 규칙(stop-loss/trend-break/profit-target/
 * overheat-profit/long-decline)은 전부 false로 둔다.
 */
export function evaluateAppSellRules(
  s: AppIndicatorSeries,
  i: number,
  pos: AppPositionState | null
): AppRuleFlags {
  const f = EMPTY_FLAGS();
  if (i < 0 || i >= s.n) return f;

  const price = s.close[i];
  // 앱 `usePortfolioCalculator`와 **동일한 산식**으로 계산한다(부동소수 경계 일치가 목적).
  //   returnPercentage = (profitLoss / purchaseValue) × 100  ≠  (price/purchase − 1) × 100
  //   yesterdayChange  = changeRate × 100,  changeRate = (종가−전일종가)/전일종가
  const returnPct =
    pos !== null && pos.purchasePrice > 0
      ? ((price - pos.purchasePrice) / pos.purchasePrice) * 100
      : null;
  const dropFromHigh =
    pos !== null && pos.highestPrice > 0 ? ((price - pos.highestPrice) / pos.highestPrice) * 100 : null;
  const prevClose = i >= 1 ? s.close[i - 1] : null;
  const dailyChangePct =
    prevClose !== null && prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : null;
  const rsi = s.rsi[i];

  // 1) stop-loss : LOSS_THRESHOLD(≤ -5%)
  f['stop-loss'] = returnPct !== null && returnPct <= -APP_RULE_CONST.lossThreshold;

  // 2) overheat-drop : RSI_OVERBOUGHT(≥70) AND DAILY_DROP(당일 하락)
  f['overheat-drop'] =
    rsi !== null && rsi >= APP_RULE_CONST.rsiOverbought && dailyChangePct !== null && dailyChangePct < 0;

  // 3) dead-cross : MA_DEAD_CROSS(5<20 AND |교차경과일| ≤ 252)
  {
    const s5 = s.ma[APP_RULE_CONST.deadCrossShort][i];
    const l20 = s.ma[APP_RULE_CONST.deadCrossLong][i];
    if (s5 !== null && l20 !== null && s5 < l20) {
      const cd = s.maCrossDays5x20[i];
      f['dead-cross'] = cd !== null && Math.abs(cd) <= APP_RULE_CONST.deadCrossMaxLookback;
    }
  }

  // 4) trend-break : PRICE_BELOW_SHORT_MA(20) AND PROFIT_NEGATIVE
  {
    const m20 = s.ma[APP_RULE_CONST.trendBreakMa][i];
    f['trend-break'] = m20 !== null && price < m20 && returnPct !== null && returnPct < 0;
  }

  // 5) long-decline : MA_BEARISH_ALIGN(20<60) AND DROP_FROM_HIGH(≤ -20%)
  {
    const m20 = s.ma[APP_RULE_CONST.longDeclineShort][i];
    const m60 = s.ma[APP_RULE_CONST.longDeclineLong][i];
    f['long-decline'] =
      m20 !== null &&
      m60 !== null &&
      m20 < m60 &&
      dropFromHigh !== null &&
      dropFromHigh <= -APP_RULE_CONST.dropFromHighThreshold;
  }

  // 6) profit-target : PROFIT_TARGET(≥ +20%)
  f['profit-target'] = returnPct !== null && returnPct >= APP_RULE_CONST.profitTarget;

  // 7) overheat-profit : PROFIT_TARGET(≥ +15%) AND RSI_OVERHEAT_ENTRY(withinDays 3)
  {
    const okProfit = returnPct !== null && returnPct >= APP_RULE_CONST.overheatProfitTarget;
    let okRsi = false;
    if (rsi !== null && rsi >= APP_RULE_CONST.rsiOverheatFloor) {
      const d = s.rsiOverheatEntryDay[i];
      okRsi = d !== null && d <= APP_RULE_CONST.overheatWithinDays;
    }
    f['overheat-profit'] = okProfit && okRsi;
  }

  // 8) daily-crash : DAILY_CRASH(당일 ≤ -5%)
  f['daily-crash'] = dailyChangePct !== null && dailyChangePct <= -APP_RULE_CONST.dailyCrashThreshold;

  // 9) climax-top : 플래그 ≥ 2
  f['climax-top'] = s.climaxFlagCount[i] >= APP_RULE_CONST.climaxFlagsRequired;

  // 10) distribution-high : 13일 내 매물출회일 ≥ 5
  f['distribution-high'] = s.distributionCount[i] >= APP_RULE_CONST.distributionThreshold;

  // 11) weinstein-150-break : PRICE_CROSS_BELOW_MA(150, withinDays 5)
  {
    const m = s.ma[APP_RULE_CONST.weinsteinMa][i];
    if (m !== null && price < m) {
      const d = s.breakBelowMaDays[APP_RULE_CONST.weinsteinMa][i];
      f['weinstein-150-break'] = d !== null && d <= APP_RULE_CONST.weinsteinWithinDays;
    }
  }

  // 12) ma120-break : PRICE_CROSS_BELOW_MA(120, withinDays 5)
  {
    const m = s.ma[APP_RULE_CONST.ma120Period][i];
    if (m !== null && price < m) {
      const d = s.breakBelowMaDays[APP_RULE_CONST.ma120Period][i];
      f['ma120-break'] = d !== null && d <= APP_RULE_CONST.ma120WithinDays;
    }
  }

  // 13) swing-low-break : 직전 저점 이탈
  {
    const sl = s.swingLow[i];
    f['swing-low-break'] = sl !== null && sl > 0 && price < sl;
  }

  return f;
}

/** 어느 규칙이라도 발동했는가(= C 트리거). */
export function anyAppRuleFired(f: AppRuleFlags): boolean {
  for (const id of APP_SELL_RULE_IDS) if (f[id]) return true;
  return false;
}

/** 발동한 규칙 id 목록(정렬 순서 = APP_SELL_RULE_IDS). */
export function firedAppRules(f: AppRuleFlags): AppSellRuleId[] {
  return APP_SELL_RULE_IDS.filter((id) => f[id]);
}

/**
 * 보유 최고가 갱신(앱 highestPrice 근사): max(트레일링252 최고종가, 매수 후 러닝최고, 매수가).
 * runningMax는 호출부가 매수일부터 누적한 값을 넘긴다.
 */
export function appHighestPrice(
  s: AppIndicatorSeries,
  i: number,
  purchasePrice: number,
  runningMaxSincePurchase: number
): number {
  return Math.max(s.trailingHigh252[i], runningMaxSincePurchase, purchasePrice);
}
