// types/marketOverview.ts
// ---------------------------------------------------------------------------
// 시장 요약(금 김치 프리미엄 + 환율) 통합 타입.
// 기존 GoldPremiumResult(services/goldPremiumService)를 대체.
//
// 설계 원칙:
//  · 스냅샷은 **원시 시세만** 보관한다. 프리미엄(%)은 저장하지 않고 렌더 시
//    유효 환율로 재계산한다 — 초기 조회가 임시 환율(예: 1450)로 발사돼도
//    실제 환율이 로드되면 김프가 자동으로 맞춰진다(과거 왜곡 버그 방지).
//  · sourceDate(실제 시세 기준일)와 fetchedAt(앱이 확인한 시각)을 분리한다.
//    주말·휴일에 마지막 거래일 종가임을 사용자가 오인하지 않도록.
// ---------------------------------------------------------------------------

/** troy ounce → gram (국제금 USD/oz → KRW/g 환산 상수) */
export const TROY_OZ_TO_GRAM = 31.1035;

/**
 * 현재 시장 요약 스냅샷 (원시 시세).
 * 프리미엄은 파생값이므로 여기 저장하지 않는다 —
 * utils/marketOverviewCalculations.goldPremiumPct 로 렌더 시 계산.
 */
export interface MarketOverviewSnapshot {
  /** KRX 국내금 KRW/g (0 = 조회 실패/미확보) */
  domesticGoldKRWPerG: number;
  /** 국내금 전일 종가 KRW/g (전일 대비 표시용, 0 = 없음) */
  domesticGoldPrevKRWPerG: number;
  /** COMEX GC=F 국제금 USD/troy oz (0 = 조회 실패/미확보) */
  intlGoldUSDPerOz: number;
  /** 국제금 전일 종가 USD/oz (0 = 없음) */
  intlGoldPrevUSDPerOz: number;
  /** 시장 USD/KRW (백엔드 조회값, 0 = 없음) */
  usdKrw: number;
  /** 시장 JPY/KRW (0 = 없음) */
  jpyKrw: number;
  /** 국내금 시세 기준일 YYYY-MM-DD (백엔드 date, null = 미확보) */
  goldSourceDate: string | null;
  /** 환율 시세 기준일 YYYY-MM-DD (null = 미확보) */
  fxSourceDate: string | null;
  /** 앱이 이 스냅샷을 확인한 시각 (ISO 8601) */
  fetchedAt: string;
}

/** 조회 상태 — UI 배지("방금 확인"/"갱신 실패") 표기용 */
export type MarketOverviewStatus = 'idle' | 'loading' | 'fresh' | 'stale-fallback' | 'error';

/**
 * 금 김치 프리미엄 일별 차트 포인트.
 * KRX-GOLD 거래일을 시간 축으로 삼고, 국제금·환율은 직전 거래일 값으로
 * forward-fill 정렬한다(휴장일 불일치 대응).
 */
export interface GoldPremiumSeriesPoint {
  /** KRX 거래일 YYYY-MM-DD */
  date: string;
  /** 국내금 KRW/g */
  domesticKRWPerG: number;
  /** 국제금 환산 KRW/g (= intlUSD/oz × usdKrw ÷ 31.1035) */
  intlKRWPerG: number;
  /** 김치 프리미엄 % (양수=프리미엄, 음수=역프리미엄) */
  premiumPct: number;
  /** 이 포인트 계산에 실제 사용된 환율 기준일 (forward-fill 시 date와 다를 수 있음) */
  fxDate: string;
}

/** 환율 일별 차트 포인트 (USD/KRW · JPY/KRW). */
export interface FxSeriesPoint {
  /** 거래일 YYYY-MM-DD */
  date: string;
  /** USD/KRW (없으면 null → 차트 gap) */
  usdKrw: number | null;
  /** JPY/KRW (없으면 null → 차트 gap) */
  jpyKrw: number | null;
}

/** 차트 두 종을 함께 담는 히스토리 번들 (한 번의 /history 호출로 채워짐). */
export interface MarketOverviewHistory {
  goldPremium: GoldPremiumSeriesPoint[];
  fx: FxSeriesPoint[];
}
