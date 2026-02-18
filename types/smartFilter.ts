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
  | 'DROP_FROM_HIGH'
  | 'DAILY_DROP'
  | 'LOSS_THRESHOLD';

/** 필터 그룹 */
export type SmartFilterGroup = 'ma' | 'rsi' | 'signal' | 'portfolio';

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
  DROP_FROM_HIGH: 'portfolio',
  DAILY_DROP: 'portfolio',
  LOSS_THRESHOLD: 'portfolio',
};

/** 스마트 필터 전체 상태 */
export interface SmartFilterState {
  activeFilters: Set<SmartFilterKey>;
  dropFromHighThreshold: number;
  lossThreshold: number;
  maShortPeriod: number;
  maLongPeriod: number;
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
}

/** 초기 필터 상태 */
export const EMPTY_SMART_FILTER: SmartFilterState = {
  activeFilters: new Set(),
  dropFromHighThreshold: 20,
  lossThreshold: 5,
  maShortPeriod: 20,
  maLongPeriod: 60,
};
