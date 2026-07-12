// utils/marketOverviewSeries.ts
// ---------------------------------------------------------------------------
// 차트용 일별 시계열 정렬 순수 함수. 상태/부수효과/네트워크 없음.
//
// 금(KRX-GOLD)·국제금(GC=F)·환율(USD/KRW, JPY/KRW)은 거래일이 서로 다르다
// (미국 휴장 vs 한국 휴장, 환율은 주말 결측 등). 따라서:
//  · 금 프리미엄 시계열은 KRX-GOLD 거래일을 시간 축으로 삼고, 국제금·환율을
//    "그 날짜 이하의 가장 최근 값"으로 forward-fill 정렬한다.
//  · 환율 이상치(USD>3000 등)는 forward-fill 대상에서 제외한다.
//  · 어떤 날짜의 정렬 결과에 국제금·환율이 아직 없으면(초기 구간) 그 포인트는 생략.
// ---------------------------------------------------------------------------

import {
  GoldPremiumSeriesPoint,
  FxSeriesPoint,
  MarketOverviewHistory,
} from '../types/marketOverview';
import {
  intlGoldKRWPerG,
  goldPremiumPct,
  isPositiveFinite,
  isSaneUsdKrw,
} from './marketOverviewCalculations';

/** { "YYYY-MM-DD": number } 형태의 일별 시리즈. */
export type DateSeries = Record<string, number>;

/** date 오름차순 정렬 + value 유효성 필터(predicate)한 쌍 목록 생성. */
function toSortedValidPairs(
  series: DateSeries | undefined,
  isValid: (v: number) => boolean,
): Array<[string, number]> {
  if (!series) return [];
  return Object.entries(series)
    .filter(([, v]) => isPositiveFinite(v) && isValid(v))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * 금 프리미엄 일별 시계열 생성.
 * @param gold  KRX-GOLD 종가 KRW/g (시간 축)
 * @param intl  GC=F 종가 USD/oz
 * @param fx    USD/KRW 종가
 */
export function buildGoldPremiumSeries(
  gold: DateSeries | undefined,
  intl: DateSeries | undefined,
  fx: DateSeries | undefined,
): GoldPremiumSeriesPoint[] {
  const goldPairs = toSortedValidPairs(gold, () => true);
  const intlPairs = toSortedValidPairs(intl, () => true);
  const fxPairs = toSortedValidPairs(fx, isSaneUsdKrw); // 이상치 환율 제외

  const out: GoldPremiumSeriesPoint[] = [];
  const intlCursor = { i: 0 };
  let intlLast: number | null = null;
  const fxCursor = { i: 0 };
  let fxLast: number | null = null;
  let fxLastDate = '';

  for (const [date, domestic] of goldPairs) {
    // forward-fill: 커서를 date 이하까지 전진시키며 마지막 값 갱신
    while (intlCursor.i < intlPairs.length && intlPairs[intlCursor.i][0] <= date) {
      intlLast = intlPairs[intlCursor.i][1];
      intlCursor.i++;
    }
    while (fxCursor.i < fxPairs.length && fxPairs[fxCursor.i][0] <= date) {
      fxLast = fxPairs[fxCursor.i][1];
      fxLastDate = fxPairs[fxCursor.i][0];
      fxCursor.i++;
    }

    if (intlLast === null || fxLast === null) continue; // 초기 구간 — 아직 국제금/환율 없음

    const intlKRWPerG = intlGoldKRWPerG(intlLast, fxLast);
    const premium = goldPremiumPct(domestic, intlKRWPerG);
    if (premium === null) continue;

    out.push({
      date,
      domesticKRWPerG: domestic,
      intlKRWPerG,
      premiumPct: premium,
      fxDate: fxLastDate,
    });
  }
  return out;
}

/**
 * 환율 일별 시계열 생성 (USD/KRW · JPY/KRW).
 * 두 통화 날짜 합집합을 축으로, 각 통화는 forward-fill. 이상치는 제외(null → 차트 gap).
 */
export function buildFxSeries(
  usd: DateSeries | undefined,
  jpy: DateSeries | undefined,
): FxSeriesPoint[] {
  const usdPairs = toSortedValidPairs(usd, isSaneUsdKrw);
  const jpyPairs = toSortedValidPairs(jpy, (v) => v > 0 && v <= 50); // JPY 이상치 상한

  const dateSet = new Set<string>();
  usdPairs.forEach(([d]) => dateSet.add(d));
  jpyPairs.forEach(([d]) => dateSet.add(d));
  const dates = Array.from(dateSet).sort();

  const out: FxSeriesPoint[] = [];
  const usdCursor = { i: 0 };
  let usdLast: number | null = null;
  const jpyCursor = { i: 0 };
  let jpyLast: number | null = null;

  for (const date of dates) {
    while (usdCursor.i < usdPairs.length && usdPairs[usdCursor.i][0] <= date) {
      usdLast = usdPairs[usdCursor.i][1];
      usdCursor.i++;
    }
    while (jpyCursor.i < jpyPairs.length && jpyPairs[jpyCursor.i][0] <= date) {
      jpyLast = jpyPairs[jpyCursor.i][1];
      jpyCursor.i++;
    }
    out.push({ date, usdKrw: usdLast, jpyKrw: jpyLast });
  }
  return out;
}

/** 금·환율 시계열을 한 번에 조립. */
export function buildMarketOverviewHistory(
  gold: DateSeries | undefined,
  intl: DateSeries | undefined,
  usd: DateSeries | undefined,
  jpy: DateSeries | undefined,
): MarketOverviewHistory {
  return {
    goldPremium: buildGoldPremiumSeries(gold, intl, usd),
    fx: buildFxSeries(usd, jpy),
  };
}
