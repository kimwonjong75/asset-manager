import type {
  SmartFilterState, SmartFilterKey, SmartFilterGroup, FilterEvalReason, FilterEvalResult, ExtraFilterConfig,
} from '../types/smartFilter';
import { FILTER_KEY_TO_GROUP } from '../types/smartFilter';
import type { EnrichedAsset } from '../types/ui';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';
import { countClimaxFlags } from './climaxFlags';
import { countDistributionDays } from './marketDistribution';

// ExtraFilterConfig/FilterEvalReason/FilterEvalResult 는 types/smartFilter.ts 단일 소스(프로젝트 규칙: 타입은 types/).
const NO_DATA: FilterEvalResult = { result: null, reason: 'no-data' };
const NOT_APPLICABLE: FilterEvalResult = { result: null, reason: 'not-applicable' };
const cmp = (ok: boolean, actual?: number | string, threshold?: number | string): FilterEvalResult =>
  ok ? { result: true, reason: 'met', actual, threshold } : { result: false, reason: 'not-met', actual, threshold };
// 지표는 있으나 대상 이벤트/구조가 미발생 — 미충족(result=false)이되 사유를 'no-data'와 구분.
const eventNotFound = (actual?: number | string, threshold?: number | string): FilterEvalResult =>
  ({ result: false, reason: 'event-not-found', actual, threshold });

/**
 * 단일 필터 키를 3치(true/false/null)로 평가 + 사유/실제값/기준값을 반환 (순수, side effect 없음).
 * 5B 진단/민감도 레이어의 단일 소스. **데이터 미수신은 null('no-data')** — matchesSingleFilter(아래 wrapper)가
 * null→false로 매핑해 기존 boolean 발화를 1건도 바꾸지 않는다(발화 불변, smartFilterParity가 강제).
 * 기존 matchesSingleFilter의 모든 분기를 1:1 보존하되, "데이터 없어 false"였던 지점만 null로 정밀화한다.
 */
export const evaluateSingleFilter = (
  asset: EnrichedAsset,
  key: SmartFilterKey,
  dropFromHighThreshold: number,
  maShortPeriod: number,
  maLongPeriod: number,
  enriched?: EnrichedIndicatorData,
  lossThreshold: number = 5,
  extraConfig?: ExtraFilterConfig
): FilterEvalResult => {
  const ind = asset.indicators;
  const m = asset.metrics;
  const price = asset.priceOriginal;

  switch (key) {
    // ── MA: enriched 데이터 우선, 없으면 기존 indicators 폴백 ──
    case 'PRICE_ABOVE_SHORT_MA': {
      const maVal = enriched?.ma[maShortPeriod];
      if (typeof maVal === 'number') return cmp(price > maVal, price, maVal);
      if (maShortPeriod === 20 && typeof ind?.ma20 === 'number') return cmp(price > ind.ma20, price, ind.ma20);
      if (maShortPeriod === 60 && typeof ind?.ma60 === 'number') return cmp(price > ind.ma60, price, ind.ma60);
      return NO_DATA;
    }
    case 'PRICE_ABOVE_LONG_MA': {
      const maVal = enriched?.ma[maLongPeriod];
      if (typeof maVal === 'number') return cmp(price > maVal, price, maVal);
      if (maLongPeriod === 20 && typeof ind?.ma20 === 'number') return cmp(price > ind.ma20, price, ind.ma20);
      if (maLongPeriod === 60 && typeof ind?.ma60 === 'number') return cmp(price > ind.ma60, price, ind.ma60);
      return NO_DATA;
    }
    case 'PRICE_BELOW_SHORT_MA': {
      const maVal = enriched?.ma[maShortPeriod];
      if (typeof maVal === 'number') return cmp(price < maVal, price, maVal);
      if (maShortPeriod === 20 && typeof ind?.ma20 === 'number') return cmp(price < ind.ma20, price, ind.ma20);
      if (maShortPeriod === 60 && typeof ind?.ma60 === 'number') return cmp(price < ind.ma60, price, ind.ma60);
      return NO_DATA;
    }
    case 'PRICE_BELOW_LONG_MA': {
      const maVal = enriched?.ma[maLongPeriod];
      if (typeof maVal === 'number') return cmp(price < maVal, price, maVal);
      if (maLongPeriod === 20 && typeof ind?.ma20 === 'number') return cmp(price < ind.ma20, price, ind.ma20);
      if (maLongPeriod === 60 && typeof ind?.ma60 === 'number') return cmp(price < ind.ma60, price, ind.ma60);
      return NO_DATA;
    }
    case 'MA_BULLISH_ALIGN': {
      const shortMa = enriched?.ma[maShortPeriod];
      const longMa = enriched?.ma[maLongPeriod];
      if (typeof shortMa === 'number' && typeof longMa === 'number') return cmp(shortMa > longMa, shortMa, longMa);
      if (maShortPeriod === 20 && maLongPeriod === 60 &&
          typeof ind?.ma20 === 'number' && typeof ind?.ma60 === 'number') {
        return cmp(ind.ma20 > ind.ma60, ind.ma20, ind.ma60);
      }
      return NO_DATA;
    }
    case 'MA_BEARISH_ALIGN': {
      const shortMa = enriched?.ma[maShortPeriod];
      const longMa = enriched?.ma[maLongPeriod];
      if (typeof shortMa === 'number' && typeof longMa === 'number') return cmp(shortMa < longMa, shortMa, longMa);
      if (maShortPeriod === 20 && maLongPeriod === 60 &&
          typeof ind?.ma20 === 'number' && typeof ind?.ma60 === 'number') {
        return cmp(ind.ma20 < ind.ma60, ind.ma20, ind.ma60);
      }
      return NO_DATA;
    }

    // ── 골든크로스/데드크로스: 상태 기반 (경과일은 UI 뱃지로 표시) ──
    case 'MA_GOLDEN_CROSS': {
      if (!enriched) return NO_DATA;
      const todayShort = enriched.ma[maShortPeriod];
      const todayLong = enriched.ma[maLongPeriod];
      if (typeof todayShort !== 'number' || typeof todayLong !== 'number') return NO_DATA;
      return cmp(todayShort > todayLong, todayShort, todayLong);
    }
    case 'MA_DEAD_CROSS': {
      if (!enriched) return NO_DATA;
      const todayShort = enriched.ma[maShortPeriod];
      const todayLong = enriched.ma[maLongPeriod];
      if (typeof todayShort !== 'number' || typeof todayLong !== 'number') return NO_DATA;
      if (!(todayShort < todayLong)) return cmp(false, todayShort, todayLong); // 역배열 아님 → 미충족

      // lookback 옵션이 주입된 경우만 추가 검사 (스마트필터 칩 등 미주입 경로는 영향 없음)
      const lookback = extraConfig?.maxLookbackTradingDays;
      if (typeof lookback === 'number') {
        const crossDays = enriched.maCrossDays?.[maShortPeriod]?.[maLongPeriod];
        // 역배열 상태는 확인됨 → crossDays 부재/초과는 "최근 교차 없음"(데이터 부족 아님) = event-not-found.
        if (typeof crossDays !== 'number') return eventNotFound(undefined, lookback);
        if (Math.abs(crossDays) > lookback) return eventNotFound(Math.abs(crossDays), lookback);
      }
      return cmp(true, todayShort, todayLong);
    }

    // ── 가격 vs MA 상향돌파: withinDays 이내 돌파 + 현재 MA 위 유지 ──
    case 'PRICE_CROSS_ABOVE_MA': {
      if (!enriched) return NO_DATA;
      const period = extraConfig?.maCrossPeriod ?? maLongPeriod;
      const todayMa = enriched.ma[period];
      if (typeof todayMa !== 'number') return NO_DATA;
      if (price < todayMa) return cmp(false, price, todayMa); // 현재 MA 아래면 무효(미충족)

      const days = extraConfig?.withinDays ?? 0;
      if (days > 0) {
        const crossDay = enriched.priceCrossMaDays?.[period];
        // 현재 MA 위는 확인됨 → 돌파 경과일 부재는 "최근 돌파 이벤트 없음" = event-not-found.
        if (typeof crossDay !== 'number') return eventNotFound(undefined, days);
        return cmp(crossDay <= days, crossDay, days);
      }
      const yesterdayMa = enriched.prevMa[period];
      const prevClose = enriched.prevClose;
      if (typeof yesterdayMa !== 'number' || typeof prevClose !== 'number') return NO_DATA;
      return cmp(prevClose < yesterdayMa, prevClose, yesterdayMa);
    }

    // ── 가격 vs MA 하향이탈: withinDays 이내 이탈 + 현재 MA 아래 유지 (와인스타인 매도 트리거) ──
    case 'PRICE_CROSS_BELOW_MA': {
      if (!enriched) return NO_DATA;
      const period = extraConfig?.maCrossPeriod ?? maLongPeriod;
      const todayMa = enriched.ma[period];
      if (typeof todayMa !== 'number') return NO_DATA;
      if (price >= todayMa) return cmp(false, price, todayMa); // 현재 MA 위면 무효(미충족)

      const days = extraConfig?.withinDays ?? 0;
      if (days > 0) {
        const breakDay = enriched.priceBreakBelowMaDays?.[period];
        // 현재 MA 아래는 확인됨 → 이탈 경과일 부재는 "최근 이탈 이벤트 없음" = event-not-found.
        if (typeof breakDay !== 'number') return eventNotFound(undefined, days);
        return cmp(breakDay <= days, breakDay, days);
      }
      const yesterdayMa = enriched.prevMa[period];
      const prevClose = enriched.prevClose;
      if (typeof yesterdayMa !== 'number' || typeof prevClose !== 'number') return NO_DATA;
      return cmp(prevClose >= yesterdayMa, prevClose, yesterdayMa);
    }

    // ── RSI: 기존 + enriched 전환감지 ──
    case 'RSI_OVERBOUGHT':
      if (typeof enriched?.rsi === 'number') return cmp(enriched.rsi >= 70, enriched.rsi, 70);
      if (typeof ind?.rsi === 'number') return cmp(ind.rsi >= 70, ind.rsi, 70);
      return NO_DATA;
    case 'RSI_OVERSOLD':
      if (typeof enriched?.rsi === 'number') return cmp(enriched.rsi <= 30, enriched.rsi, 30);
      if (typeof ind?.rsi === 'number') return cmp(ind.rsi <= 30, ind.rsi, 30);
      return NO_DATA;
    case 'RSI_BOUNCE': {
      if (!enriched) return NO_DATA;
      const { rsi, prevRsi } = enriched;
      if (typeof rsi !== 'number') return NO_DATA;
      if (rsi <= 30) return cmp(false, rsi, 30); // 현재 과매도면 반등 아님(미충족)

      const days = extraConfig?.withinDays ?? 0;
      if (days > 0) {
        const bounceDay = enriched.rsiBounceDay;
        // 현재 RSI(>30)는 확인됨 → 반등 경과일 부재는 "최근 반등 이벤트 없음" = event-not-found.
        if (typeof bounceDay !== 'number') return eventNotFound(undefined, days);
        return cmp(bounceDay <= days, bounceDay, days);
      }
      if (typeof prevRsi !== 'number') return NO_DATA;
      return cmp(prevRsi <= 30, prevRsi, 30);
    }
    case 'RSI_OVERHEAT_ENTRY': {
      if (!enriched) return NO_DATA;
      const { rsi, prevRsi } = enriched;
      if (typeof rsi !== 'number') return NO_DATA;
      if (rsi < 65) return cmp(false, rsi, 65); // 과열 영역 이탈 시 무효(미충족, 5pt 여유)

      const days = extraConfig?.withinDays ?? 0;
      if (days > 0) {
        const entryDay = enriched.rsiOverheatEntryDay;
        // 과열 영역(≥65)은 확인됨 → 진입 경과일 부재는 "최근 과열 진입 이벤트 없음" = event-not-found.
        if (typeof entryDay !== 'number') return eventNotFound(undefined, days);
        return cmp(entryDay <= days, entryDay, days);
      }
      if (typeof prevRsi !== 'number') return NO_DATA;
      // 진입 이벤트는 (전일<70 AND 당일≥70). actual에 전일→당일 전이를 담아 "현재 RSI만 보고 모순" 방지.
      const transition = `전일 ${Math.round(prevRsi)}→당일 ${Math.round(rsi)}`;
      return cmp(prevRsi < 70 && rsi >= 70, transition, 70);
    }

    // ── Signal ── (signal 미수신은 no-data, 다른 값은 미충족)
    case 'SIGNAL_STRONG_BUY':
      return ind?.signal === undefined ? NO_DATA : cmp(ind.signal === 'STRONG_BUY', ind.signal);
    case 'SIGNAL_BUY':
      return ind?.signal === undefined ? NO_DATA : cmp(ind.signal === 'BUY', ind.signal);
    case 'SIGNAL_SELL':
      return ind?.signal === undefined ? NO_DATA : cmp(ind.signal === 'SELL', ind.signal);
    case 'SIGNAL_STRONG_SELL':
      return ind?.signal === undefined ? NO_DATA : cmp(ind.signal === 'STRONG_SELL', ind.signal);

    // ── 포트폴리오 지표 (metrics는 항상 존재 → met/not-met) ──
    case 'PROFIT_POSITIVE':
      return cmp(m.returnPercentage > 0, m.returnPercentage, 0);
    case 'PROFIT_NEGATIVE':
      return cmp(m.returnPercentage < 0, m.returnPercentage, 0);
    case 'DROP_FROM_HIGH':
      return cmp(m.dropFromHigh <= -dropFromHighThreshold, m.dropFromHigh, -dropFromHighThreshold);
    case 'DAILY_DROP':
      // 당일 변동률 미수신은 0으로 오판(not-met)하지 말고 no-data — "왜 안 떴나"에서 데이터 누락을 정확히 진단.
      if (typeof asset.changeRate !== 'number') return NO_DATA;
      return cmp(asset.changeRate < 0, asset.changeRate, 0);
    case 'PROFIT_TARGET': {
      const thr = extraConfig?.profitTargetThreshold ?? 20;
      return cmp(m.returnPercentage >= thr, m.returnPercentage, thr);
    }
    case 'DAILY_SURGE': {
      const thr = extraConfig?.dailySurgeThreshold ?? 5;
      return cmp(m.yesterdayChange >= thr, m.yesterdayChange, thr);
    }
    case 'DAILY_CRASH': {
      const thr = extraConfig?.dailyCrashThreshold ?? 5;
      return cmp(m.yesterdayChange <= -thr, m.yesterdayChange, -thr);
    }
    case 'LOSS_THRESHOLD':
      return cmp(m.returnPercentage <= -lossThreshold, m.returnPercentage, -lossThreshold);

    // ── 거래량 (volume_ratio 미수신은 no-data) ──
    case 'VOLUME_SURGE':
      return typeof ind?.volume_ratio === 'number' ? cmp(ind.volume_ratio >= 2.0, ind.volume_ratio, 2.0) : NO_DATA;
    case 'VOLUME_HIGH':
      return typeof ind?.volume_ratio === 'number' ? cmp(ind.volume_ratio >= 1.5, ind.volume_ratio, 1.5) : NO_DATA;
    case 'VOLUME_LOW':
      return typeof ind?.volume_ratio === 'number' ? cmp(ind.volume_ratio < 0.5, ind.volume_ratio, 0.5) : NO_DATA;

    // ── 과열 리스크: 미너비니 클라이맥스 탑 (예측 아닌 참고 경고) ──
    case 'CLIMAX_TOP': {
      if (!enriched) return NO_DATA;
      const required = extraConfig?.climaxFlagsRequired ?? 2;
      // smartFilter 프로필 — 토글(기본 true)을 그대로 주입. 카운팅 로직은 공유 countClimaxFlags.
      const count = countClimaxFlags(enriched, {
        slopeMultiplier: extraConfig?.climaxSlopeMultiplier ?? 2.5, // P4.5 C1: 3 → 2.5
        atrMultiple: extraConfig?.climaxAtrMultiple ?? 2.5,
        requireBullishCandle: extraConfig?.climaxRequireBullishCandle ?? true,
        requireLongTrendUp: extraConfig?.climaxRequireLongTrendUp ?? true,
      });
      return cmp(count >= required, count, required);
    }

    // ── 추세 종료: 직전 swing low 이탈 (와인스타인 매도 트리거) ──
    case 'SWING_LOW_BREAK': {
      if (!enriched) return NO_DATA;
      const swingLow = enriched.recentSwingLow;
      // swing low 미형성은 데이터 부족이 아니라 "직전 저점 구조 미형성" = event-not-found.
      if (typeof swingLow !== 'number' || swingLow <= 0) return eventNotFound();
      return cmp(price < swingLow, price, swingLow);
    }

    // ── 과열 리스크: 오닐 디스트리뷰션 (매물 출회) ──
    case 'DISTRIBUTION_HIGH': {
      if (!enriched) return NO_DATA;
      // 빈 메타 = OHLCV 미수신(실제 데이터 없음) → no-data. (몇 개 있으나 임계 미달은 아래 cmp의 not-met)
      if (!enriched.distributionDayMeta || enriched.distributionDayMeta.length === 0) return NO_DATA;
      const countThr = extraConfig?.distributionThreshold ?? 5;
      // 카운팅 로직은 공유 countDistributionDays — 짧은 윈도우·null volRatio·정체 조건 동일 처리.
      const count = countDistributionDays(
        enriched.distributionDayMeta,
        extraConfig?.distributionWindow ?? 13,
        extraConfig?.distributionVolumeRatio ?? 1.5,
      );
      return cmp(count >= countThr, count, countThr);
    }

    default:
      return NOT_APPLICABLE;
  }
};

/**
 * 단일 필터 키에 대해 자산이 조건을 충족하는지 판정 (boolean).
 * evaluateSingleFilter의 wrapper — **null(데이터 없음)·false 모두 false로 매핑**(발화 불변).
 * 기존 호출부(matchesSmartFilter/alertChecker)의 시그니처·동작을 그대로 유지한다.
 */
export const matchesSingleFilter = (
  asset: EnrichedAsset,
  key: SmartFilterKey,
  dropFromHighThreshold: number,
  maShortPeriod: number,
  maLongPeriod: number,
  enriched?: EnrichedIndicatorData,
  lossThreshold: number = 5,
  extraConfig?: ExtraFilterConfig
): boolean =>
  evaluateSingleFilter(asset, key, dropFromHighThreshold, maShortPeriod, maLongPeriod, enriched, lossThreshold, extraConfig).result === true;

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
