import type { SmartFilterKey } from './smartFilter';
import type { DistributionTierClassification } from '../utils/distributionTierState';

/** 알림 규칙의 필터 설정 */
export interface AlertRuleFilterConfig {
  maShortPeriod?: number;
  maLongPeriod?: number;
  lossThreshold?: number;
  dropFromHighThreshold?: number;
  profitTargetThreshold?: number;
  dailySurgeThreshold?: number;
  dailyCrashThreshold?: number;
  maCrossPeriod?: number;
  /** 이벤트형 필터 감지 유지 일수 (PRICE_CROSS_ABOVE_MA, RSI_BOUNCE, RSI_OVERHEAT_ENTRY) */
  withinDays?: number;
  /** MA 교차류 룰 — 교차 발생 이후 N거래일 이내만 매칭 (없으면 무제한 / 상태 검사만) */
  maxLookbackTradingDays?: number;

  // ── 클라이맥스 탑 (CLIMAX_TOP) 임계값 ──
  /** 충족해야 할 플래그 수 (1~3, 기본 2) */
  climaxFlagsRequired?: number;
  /** (a) 단기 기울기/장기 기울기 비율 임계값 (기본 3) */
  climaxSlopeMultiplier?: number;
  /** (b) 당일 (고가-저가) / ATR14 임계 배수 (기본 2.5, OHLCV 필요) */
  climaxAtrMultiple?: number;
  /** (b) ATR 폭발일을 양봉(close > open)일 때만 카운트 (방향성 보강, 기본 true) */
  climaxRequireBullishCandle?: boolean;
  /** "수개월 상승" 전제 강제 — MA60이 60일 전 대비 +10% 이상일 때만 클라이맥스 판정 (기본 true) */
  climaxRequireLongTrendUp?: boolean;

  // ── 디스트리뷰션 (DISTRIBUTION_HIGH) 임계값 ──
  /** 카운트 윈도우 거래일 수 (기본 13) */
  distributionWindow?: number;
  /** 거래량 / 20일 평균거래량 비율 임계 (기본 1.5) */
  distributionVolumeRatio?: number;
  /** 윈도우 내 충족일 수 임계 (기본 5) */
  distributionThreshold?: number;
}

/** 개별 알림 규칙 */
export interface AlertRule {
  id: string;
  name: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  action: 'sell' | 'buy';
  enabled: boolean;
  filters: SmartFilterKey[];
  filterConfig: AlertRuleFilterConfig;
}

/** 알림 체크 결과 — 매칭된 자산 정보 */
export interface AlertMatchedAsset {
  assetId: string;
  assetName: string;
  ticker: string;
  details: string;
  /** 당일 등락률 (%) */
  dailyChange?: number;
  /** 수익률 (%) */
  returnPct?: number;
  /** 고점대비 (%) */
  dropFromHigh?: number;
  /** RSI */
  rsi?: number;
  /** 출처 (포트폴리오 vs 관심종목) */
  source?: 'portfolio' | 'watchlist';
  /** distribution-high 룰 한정 — P4.5 D1 단계 분류 (3/4/5 + new/ongoing). 다른 룰에서는 undefined */
  distributionTier?: DistributionTierClassification;
}

/** 규칙별 알림 결과 */
export interface AlertResult {
  rule: AlertRule;
  matchedAssets: AlertMatchedAsset[];
}

/** 알림 설정 (사용자 커스터마이징, Google Drive 저장) */
export interface AlertSettings {
  rules: AlertRule[];
  enableAutoPopup: boolean;
}
