import type { SmartFilterState, SmartFilterKey, SmartFilterGroup } from '../types/smartFilter';
import { FILTER_KEY_TO_GROUP } from '../types/smartFilter';
import type { EnrichedAsset } from '../types/ui';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';

/**
 * 단일 필터 키에 대해 자산이 조건을 충족하는지 판정
 */
export interface ExtraFilterConfig {
  profitTargetThreshold?: number;
  dailySurgeThreshold?: number;
  dailyCrashThreshold?: number;
  maCrossPeriod?: number;
  /** 이벤트형 필터 감지 유지 일수 (0 = 당일만, undefined = 당일만 폴백) */
  withinDays?: number;
  /** MA 교차류 필터 — 교차 발생 이후 N거래일 이내만 매칭 (undefined = 상태 검사만) */
  maxLookbackTradingDays?: number;
  // ── 클라이맥스 탑 ──
  /** CLIMAX_TOP: 충족해야 할 플래그 수 (기본 2, 1~3) */
  climaxFlagsRequired?: number;
  /** (a) slopeRatio >= 임계 (기본 3) */
  climaxSlopeMultiplier?: number;
  /** (b) dayRangeOverAtr >= 임계 (기본 2.5, OHLCV 필요) */
  climaxAtrMultiple?: number;
  // ── 디스트리뷰션 ──
  /** 카운트 윈도우 거래일 수 (기본 13, 최대 30) */
  distributionWindow?: number;
  /** 거래량 / 50일 평균 비율 임계 (기본 1.5) */
  distributionVolumeRatio?: number;
  /** 윈도우 내 충족일 수 임계 (기본 5) */
  distributionThreshold?: number;
}

export const matchesSingleFilter = (
  asset: EnrichedAsset,
  key: SmartFilterKey,
  dropFromHighThreshold: number,
  maShortPeriod: number,
  maLongPeriod: number,
  enriched?: EnrichedIndicatorData,
  lossThreshold: number = 5,
  extraConfig?: ExtraFilterConfig
): boolean => {
  const ind = asset.indicators;
  const m = asset.metrics;

  switch (key) {
    // ── MA: enriched 데이터 우선, 없으면 기존 indicators 폴백 ──
    case 'PRICE_ABOVE_SHORT_MA': {
      const maVal = enriched?.ma[maShortPeriod];
      if (typeof maVal === 'number') return asset.priceOriginal > maVal;
      // 폴백: 기존 indicators (maShortPeriod === 20일 때만)
      if (maShortPeriod === 20 && typeof ind?.ma20 === 'number') return asset.priceOriginal > ind.ma20;
      if (maShortPeriod === 60 && typeof ind?.ma60 === 'number') return asset.priceOriginal > ind.ma60;
      return false;
    }
    case 'PRICE_ABOVE_LONG_MA': {
      const maVal = enriched?.ma[maLongPeriod];
      if (typeof maVal === 'number') return asset.priceOriginal > maVal;
      if (maLongPeriod === 20 && typeof ind?.ma20 === 'number') return asset.priceOriginal > ind.ma20;
      if (maLongPeriod === 60 && typeof ind?.ma60 === 'number') return asset.priceOriginal > ind.ma60;
      return false;
    }
    case 'PRICE_BELOW_SHORT_MA': {
      const maVal = enriched?.ma[maShortPeriod];
      if (typeof maVal === 'number') return asset.priceOriginal < maVal;
      if (maShortPeriod === 20 && typeof ind?.ma20 === 'number') return asset.priceOriginal < ind.ma20;
      if (maShortPeriod === 60 && typeof ind?.ma60 === 'number') return asset.priceOriginal < ind.ma60;
      return false;
    }
    case 'PRICE_BELOW_LONG_MA': {
      const maVal = enriched?.ma[maLongPeriod];
      if (typeof maVal === 'number') return asset.priceOriginal < maVal;
      if (maLongPeriod === 20 && typeof ind?.ma20 === 'number') return asset.priceOriginal < ind.ma20;
      if (maLongPeriod === 60 && typeof ind?.ma60 === 'number') return asset.priceOriginal < ind.ma60;
      return false;
    }
    case 'MA_BULLISH_ALIGN': {
      const shortMa = enriched?.ma[maShortPeriod];
      const longMa = enriched?.ma[maLongPeriod];
      if (typeof shortMa === 'number' && typeof longMa === 'number') return shortMa > longMa;
      // 폴백: 기존 ma20 > ma60 (기본값일 때)
      if (maShortPeriod === 20 && maLongPeriod === 60 &&
          typeof ind?.ma20 === 'number' && typeof ind?.ma60 === 'number') {
        return ind.ma20 > ind.ma60;
      }
      return false;
    }
    case 'MA_BEARISH_ALIGN': {
      const shortMa = enriched?.ma[maShortPeriod];
      const longMa = enriched?.ma[maLongPeriod];
      if (typeof shortMa === 'number' && typeof longMa === 'number') return shortMa < longMa;
      if (maShortPeriod === 20 && maLongPeriod === 60 &&
          typeof ind?.ma20 === 'number' && typeof ind?.ma60 === 'number') {
        return ind.ma20 < ind.ma60;
      }
      return false;
    }

    // ── 골든크로스/데드크로스: 상태 기반 (경과일은 UI 뱃지로 표시) ──
    case 'MA_GOLDEN_CROSS': {
      if (!enriched) return false;
      const todayShort = enriched.ma[maShortPeriod];
      const todayLong = enriched.ma[maLongPeriod];
      if (typeof todayShort !== 'number' || typeof todayLong !== 'number') return false;
      return todayShort > todayLong;
    }
    case 'MA_DEAD_CROSS': {
      if (!enriched) return false;
      const todayShort = enriched.ma[maShortPeriod];
      const todayLong = enriched.ma[maLongPeriod];
      if (typeof todayShort !== 'number' || typeof todayLong !== 'number') return false;
      if (!(todayShort < todayLong)) return false;

      // lookback 옵션이 주입된 경우만 추가 검사 (스마트필터 칩 등 미주입 경로는 영향 없음)
      const lookback = extraConfig?.maxLookbackTradingDays;
      if (typeof lookback === 'number') {
        const crossDays = enriched.maCrossDays?.[maShortPeriod]?.[maLongPeriod];
        if (typeof crossDays !== 'number') return false;
        if (Math.abs(crossDays) > lookback) return false;
      }
      return true;
    }

    // ── 가격 vs MA 상향돌파: withinDays 이내 돌파 + 현재 MA 위 유지 ──
    case 'PRICE_CROSS_ABOVE_MA': {
      if (!enriched) return false;
      const period = extraConfig?.maCrossPeriod ?? maLongPeriod;
      const todayMa = enriched.ma[period];
      if (typeof todayMa !== 'number') return false;
      if (asset.priceOriginal < todayMa) return false; // 현재 MA 아래면 무효

      const days = extraConfig?.withinDays ?? 0;
      if (days > 0) {
        // withinDays 모드: N거래일 이내 상향돌파
        const crossDay = enriched.priceCrossMaDays?.[period];
        return typeof crossDay === 'number' && crossDay <= days;
      }
      // 기존 동작: 당일 돌파만
      const yesterdayMa = enriched.prevMa[period];
      const prevClose = enriched.prevClose;
      if (typeof yesterdayMa !== 'number' || typeof prevClose !== 'number') return false;
      return prevClose < yesterdayMa;
    }

    // ── RSI: 기존 + enriched 전환감지 ──
    case 'RSI_OVERBOUGHT':
      // enriched 우선, 폴백 indicators
      if (typeof enriched?.rsi === 'number') return enriched.rsi >= 70;
      return typeof ind?.rsi === 'number' && ind.rsi >= 70;
    case 'RSI_OVERSOLD':
      if (typeof enriched?.rsi === 'number') return enriched.rsi <= 30;
      return typeof ind?.rsi === 'number' && ind.rsi <= 30;
    case 'RSI_BOUNCE': {
      if (!enriched) return false;
      const { rsi, prevRsi } = enriched;
      if (typeof rsi !== 'number') return false;
      if (rsi <= 30) return false; // 현재 과매도면 반등 아님

      const days = extraConfig?.withinDays ?? 0;
      if (days > 0) {
        const bounceDay = enriched.rsiBounceDay;
        return typeof bounceDay === 'number' && bounceDay <= days;
      }
      // 기존 동작: 당일 반등만
      if (typeof prevRsi !== 'number') return false;
      return prevRsi <= 30;
    }
    case 'RSI_OVERHEAT_ENTRY': {
      if (!enriched) return false;
      const { rsi, prevRsi } = enriched;
      if (typeof rsi !== 'number') return false;
      if (rsi < 65) return false; // 과열 영역 이탈 시 무효 (5pt 여유)

      const days = extraConfig?.withinDays ?? 0;
      if (days > 0) {
        const entryDay = enriched.rsiOverheatEntryDay;
        return typeof entryDay === 'number' && entryDay <= days;
      }
      // 기존 동작: 당일 진입만
      if (typeof prevRsi !== 'number') return false;
      return prevRsi < 70 && rsi >= 70;
    }

    // ── Signal ──
    case 'SIGNAL_STRONG_BUY':
      return ind?.signal === 'STRONG_BUY';
    case 'SIGNAL_BUY':
      return ind?.signal === 'BUY';
    case 'SIGNAL_SELL':
      return ind?.signal === 'SELL';
    case 'SIGNAL_STRONG_SELL':
      return ind?.signal === 'STRONG_SELL';

    // ── 포트폴리오 지표 ──
    case 'PROFIT_POSITIVE':
      return m.returnPercentage > 0;
    case 'PROFIT_NEGATIVE':
      return m.returnPercentage < 0;
    case 'DROP_FROM_HIGH':
      return m.dropFromHigh <= -dropFromHighThreshold;
    case 'DAILY_DROP':
      return (asset.changeRate ?? 0) < 0;
    case 'PROFIT_TARGET':
      return m.returnPercentage >= (extraConfig?.profitTargetThreshold ?? 20);
    case 'DAILY_SURGE':
      return m.yesterdayChange >= (extraConfig?.dailySurgeThreshold ?? 5);
    case 'DAILY_CRASH':
      return m.yesterdayChange <= -(extraConfig?.dailyCrashThreshold ?? 5);
    case 'LOSS_THRESHOLD':
      return m.returnPercentage <= -lossThreshold;

    // ── 거래량 ──
    case 'VOLUME_SURGE':
      return typeof ind?.volume_ratio === 'number' && ind.volume_ratio >= 2.0;
    case 'VOLUME_HIGH':
      return typeof ind?.volume_ratio === 'number' && ind.volume_ratio >= 1.5;
    case 'VOLUME_LOW':
      return typeof ind?.volume_ratio === 'number' && ind.volume_ratio < 0.5;

    // ── 과열 리스크: 미너비니 클라이맥스 탑 (예측 아닌 참고 경고) ──
    case 'CLIMAX_TOP': {
      if (!enriched) return false;
      const slopeMul = extraConfig?.climaxSlopeMultiplier ?? 3;
      const atrMul = extraConfig?.climaxAtrMultiple ?? 2.5;
      const required = extraConfig?.climaxFlagsRequired ?? 2;
      let count = 0;
      // (a) 단기 기울기 ≥ 장기 기울기 × multiplier
      if (typeof enriched.slopeRatio === 'number' && enriched.slopeRatio >= slopeMul) count++;
      // (b) (고가-저가) ≥ ATR × multiple — OHLCV 미수신 시 dayRangeOverAtr === null → 평가 안 됨
      if (typeof enriched.dayRangeOverAtr === 'number' && enriched.dayRangeOverAtr >= atrMul) count++;
      // (c) 52주 신고가 AND 거래량 52주 최대
      if (enriched.priceIsAt52wHigh && enriched.volumeIsAt52wMax) count++;
      return count >= required;
    }

    // ── 과열 리스크: 오닐 디스트리뷰션 (매물 출회) ──
    case 'DISTRIBUTION_HIGH': {
      if (!enriched) return false;
      const window = Math.max(1, extraConfig?.distributionWindow ?? 13);
      const ratioThr = extraConfig?.distributionVolumeRatio ?? 1.5;
      const countThr = extraConfig?.distributionThreshold ?? 5;
      const meta = enriched.distributionDayMeta;
      if (!meta || meta.length === 0) return false;
      const useWindow = Math.min(window, meta.length);
      let count = 0;
      for (let i = meta.length - useWindow; i < meta.length; i++) {
        const d = meta[i];
        if (typeof d.volRatio !== 'number' || d.volRatio < ratioThr) continue;
        // 매물 출회 패턴: 음봉 OR 윗꼬리 마감 OR 정체(등락률 < +0.2%)
        // OHLCV 미수신 구간에서는 isBearish/isLowerHalfClose가 null → 정체 조건만 평가
        const churn =
          d.isBearish === true ||
          d.isLowerHalfClose === true ||
          d.changeRatio < 0.002;
        if (churn) count++;
      }
      return count >= countThr;
    }

    default:
      return false;
  }
};

/**
 * 스마트 필터 매칭 판정
 * - 그룹 내: OR (하나라도 충족하면 통과)
 * - 그룹 간: AND (모든 활성 그룹을 통과해야 최종 통과)
 */
export const matchesSmartFilter = (
  asset: EnrichedAsset,
  filter: SmartFilterState,
  enrichedMap?: Map<string, EnrichedIndicatorData>
): boolean => {
  const { activeFilters, dropFromHighThreshold, maShortPeriod, maLongPeriod, lossThreshold } = filter;
  if (activeFilters.size === 0) return true;

  const enriched = enrichedMap?.get(asset.ticker);
  const extraConfig: ExtraFilterConfig = {
    profitTargetThreshold: filter.profitTargetThreshold ?? 20,
    dailySurgeThreshold: filter.dailySurgeThreshold ?? 5,
    dailyCrashThreshold: filter.dailyCrashThreshold ?? 5,
  };

  // 활성 필터를 그룹별로 분류
  const groupedFilters = new Map<SmartFilterGroup, SmartFilterKey[]>();
  for (const key of activeFilters) {
    const group = FILTER_KEY_TO_GROUP[key];
    const existing = groupedFilters.get(group);
    if (existing) {
      existing.push(key);
    } else {
      groupedFilters.set(group, [key]);
    }
  }

  // 각 그룹별 OR, 그룹 간 AND
  for (const [, keys] of groupedFilters) {
    const groupPassed = keys.some(key =>
      matchesSingleFilter(asset, key, dropFromHighThreshold, maShortPeriod, maLongPeriod, enriched, lossThreshold, extraConfig)
    );
    if (!groupPassed) return false;
  }

  return true;
};
