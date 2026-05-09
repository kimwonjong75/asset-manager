import type { SmartFilterKey } from './smartFilter';

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
