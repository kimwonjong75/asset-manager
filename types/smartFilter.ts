import type { SignalType, RSIStatus } from './api';

/** 개별 필터 조건 식별자 */
export type SmartFilterKey =
  // 이동평균 (MA)
  | 'PRICE_ABOVE_MA20'
  | 'PRICE_ABOVE_MA60'
  | 'MA_BULLISH_ALIGN'
  | 'MA_BEARISH_ALIGN'
  // RSI
  | 'RSI_OVERBOUGHT'
  | 'RSI_OVERSOLD'
  // 매매신호
  | 'SIGNAL_STRONG_BUY'
  | 'SIGNAL_BUY'
  | 'SIGNAL_SELL'
  | 'SIGNAL_STRONG_SELL'
  // 포트폴리오 지표
  | 'PROFIT_POSITIVE'
  | 'PROFIT_NEGATIVE'
  | 'DROP_FROM_HIGH';

/** 필터 그룹 */
export type SmartFilterGroup = 'ma' | 'rsi' | 'signal' | 'portfolio';

/** 각 필터 키가 속한 그룹 매핑 */
export const FILTER_KEY_TO_GROUP: Record<SmartFilterKey, SmartFilterGroup> = {
  PRICE_ABOVE_MA20: 'ma',
  PRICE_ABOVE_MA60: 'ma',
  MA_BULLISH_ALIGN: 'ma',
  MA_BEARISH_ALIGN: 'ma',
  RSI_OVERBOUGHT: 'rsi',
  RSI_OVERSOLD: 'rsi',
  SIGNAL_STRONG_BUY: 'signal',
  SIGNAL_BUY: 'signal',
  SIGNAL_SELL: 'signal',
  SIGNAL_STRONG_SELL: 'signal',
  PROFIT_POSITIVE: 'portfolio',
  PROFIT_NEGATIVE: 'portfolio',
  DROP_FROM_HIGH: 'portfolio',
};

/** 스마트 필터 전체 상태 */
export interface SmartFilterState {
  activeFilters: Set<SmartFilterKey>;
  dropFromHighThreshold: number;
}

/** 필터 칩 UI 정의 */
export interface SmartFilterChipDef {
  key: SmartFilterKey;
  label: string;
  group: SmartFilterGroup;
  colorClass: string;
}

/** 초기 필터 상태 */
export const EMPTY_SMART_FILTER: SmartFilterState = {
  activeFilters: new Set(),
  dropFromHighThreshold: 20,
};
