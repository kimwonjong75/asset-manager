import type { SignalType, RSIStatus } from './api';

/** 개별 필터 조건 식별자 */
export type SmartFilterKey =
  // 이동평균 (MA) — 선택 기간 기반
  | 'PRICE_ABOVE_SHORT_MA'
  | 'PRICE_ABOVE_LONG_MA'
  | 'PRICE_BELOW_SHORT_MA'
  | 'PRICE_BELOW_LONG_MA'
  | 'MA_BULLISH_ALIGN'
  | 'MA_BEARISH_ALIGN'
  | 'MA_GOLDEN_CROSS'
  | 'MA_DEAD_CROSS'
  | 'PRICE_CROSS_ABOVE_MA'
  | 'PRICE_CROSS_BELOW_MA'
  // RSI
  | 'RSI_OVERBOUGHT'
  | 'RSI_OVERSOLD'
  | 'RSI_BOUNCE'
  | 'RSI_OVERHEAT_ENTRY'
  // 매매신호
  | 'SIGNAL_STRONG_BUY'
  | 'SIGNAL_BUY'
  | 'SIGNAL_SELL'
  | 'SIGNAL_STRONG_SELL'
  // 포트폴리오 지표
  | 'PROFIT_POSITIVE'
  | 'PROFIT_NEGATIVE'
  | 'PROFIT_TARGET'
  | 'DROP_FROM_HIGH'
  | 'DAILY_DROP'
  | 'DAILY_SURGE'
  | 'DAILY_CRASH'
  | 'LOSS_THRESHOLD'
  // 거래량
  | 'VOLUME_SURGE'
  | 'VOLUME_HIGH'
  | 'VOLUME_LOW'
  // 과열 리스크 (예측 아님, 참고용 경고)
  | 'CLIMAX_TOP'
  | 'DISTRIBUTION_HIGH'
  // 추세 종료 (와인스타인)
  | 'SWING_LOW_BREAK';

/** 필터 그룹 */
export type SmartFilterGroup = 'ma' | 'rsi' | 'signal' | 'portfolio' | 'volume';

/** 각 필터 키가 속한 그룹 매핑 */
export const FILTER_KEY_TO_GROUP: Record<SmartFilterKey, SmartFilterGroup> = {
  PRICE_ABOVE_SHORT_MA: 'ma',
  PRICE_ABOVE_LONG_MA: 'ma',
  PRICE_BELOW_SHORT_MA: 'ma',
  PRICE_BELOW_LONG_MA: 'ma',
  MA_BULLISH_ALIGN: 'ma',
  MA_BEARISH_ALIGN: 'ma',
  MA_GOLDEN_CROSS: 'ma',
  MA_DEAD_CROSS: 'ma',
  PRICE_CROSS_ABOVE_MA: 'ma',
  PRICE_CROSS_BELOW_MA: 'ma',
  RSI_OVERBOUGHT: 'rsi',
  RSI_OVERSOLD: 'rsi',
  RSI_BOUNCE: 'rsi',
  RSI_OVERHEAT_ENTRY: 'rsi',
  SIGNAL_STRONG_BUY: 'signal',
  SIGNAL_BUY: 'signal',
  SIGNAL_SELL: 'signal',
  SIGNAL_STRONG_SELL: 'signal',
  PROFIT_POSITIVE: 'portfolio',
  PROFIT_NEGATIVE: 'portfolio',
  PROFIT_TARGET: 'portfolio',
  DROP_FROM_HIGH: 'portfolio',
  DAILY_DROP: 'portfolio',
  DAILY_SURGE: 'portfolio',
  DAILY_CRASH: 'portfolio',
  LOSS_THRESHOLD: 'portfolio',
  VOLUME_SURGE: 'volume',
  VOLUME_HIGH: 'volume',
  VOLUME_LOW: 'volume',
  CLIMAX_TOP: 'signal',
  DISTRIBUTION_HIGH: 'signal',
  SWING_LOW_BREAK: 'signal',
};

/** 스마트 필터 전체 상태 */
export interface SmartFilterState {
  activeFilters: Set<SmartFilterKey>;
  dropFromHighThreshold: number;
  lossThreshold: number;
  maShortPeriod: number;
  maLongPeriod: number;
  profitTargetThreshold?: number;
  dailySurgeThreshold?: number;
  dailyCrashThreshold?: number;
}

/** 필터 칩 UI 정의 */
export interface SmartFilterChipDef {
  key: SmartFilterKey;
  label: string;
  /** 동적 라벨 함수 — 있으면 label 대신 사용 */
  labelFn?: (state: SmartFilterState) => string;
  group: SmartFilterGroup;
  colorClass: string;
  /** enriched 데이터 필요 여부 (true면 로딩 중 반투명 처리) */
  needsEnriched?: boolean;
  /** 반대 방향 필터 키 (tri-state 토글용: off → key → pairKey → off) */
  pairKey?: SmartFilterKey;
  /** pairKey 활성 시 사용할 색상 */
  pairColorClass?: string;
  /** 툴팁 설명 */
  description?: string;
}

/** 초기 필터 상태 */
export const EMPTY_SMART_FILTER: SmartFilterState = {
  activeFilters: new Set(),
  dropFromHighThreshold: 20,
  lossThreshold: 5,
  maShortPeriod: 20,
  maLongPeriod: 60,
};

/** 필터 임계값/옵션 묶음 — `matchesSingleFilter`/`evaluateSingleFilter`/`matchesRule`에 전달. */
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
  /** (b) ATR 폭발일을 양봉일 때만 카운트 (기본 true) */
  climaxRequireBullishCandle?: boolean;
  /** "수개월 상승" 전제 강제 — longTrendUp이 false면 카운트 0으로 (기본 true) */
  climaxRequireLongTrendUp?: boolean;
  // ── 디스트리뷰션 ──
  /** 카운트 윈도우 거래일 수 (기본 13, 최대 30) */
  distributionWindow?: number;
  /** 거래량 / 50일 평균 비율 임계 (기본 1.5) */
  distributionVolumeRatio?: number;
  /** 윈도우 내 충족일 수 임계 (기본 5) */
  distributionThreshold?: number;
}

// ── 5B 알림 진단 (단일 필터 3치 평가) ──────────────────────────────────────────
// 안정 enum. 진단/민감도 레이어가 의존하는 사유 코드. **팝업 전달 상태와 무관**(필터 판정 전용).
// no-data(판정 불가) vs event-not-found(평가됐으나 대상 이벤트·구조 미발생)를 구분 — "왜 안 떴나"의 원인이 다름.
export type FilterEvalReason =
  | 'met'              // 충족 (result=true)
  | 'not-met'          // 조건 평가됐으나 미충족 (result=false)
  | 'event-not-found'  // 지표는 있으나 대상 이벤트/구조 미발생 (result=false) — 예: 최근 N일 내 돌파·반등 없음, swing low 미형성, 최근 교차 없음
  | 'no-data'          // 평가에 필요한 지표 미수신 (result=null) — 발화 불가, 데이터 부족
  | 'not-applicable';  // 알 수 없는 키 (result=null)

export interface FilterEvalResult {
  result: boolean | null;      // true=충족, false=미충족/이벤트없음, null=판정 불가(데이터 없음)
  reason: FilterEvalReason;
  actual?: number | string;    // 진단 표시용 실제값
  threshold?: number | string; // 진단 표시용 기준값
}
