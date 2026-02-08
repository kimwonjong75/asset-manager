import type { SmartFilterChipDef } from '../types/smartFilter';

export const SMART_FILTER_CHIPS: SmartFilterChipDef[] = [
  // 이동평균 (MA)
  { key: 'PRICE_ABOVE_MA20', label: '현재가>MA20', group: 'ma', colorClass: 'bg-emerald-600' },
  { key: 'PRICE_ABOVE_MA60', label: '현재가>MA60', group: 'ma', colorClass: 'bg-emerald-600' },
  { key: 'MA_BULLISH_ALIGN', label: '정배열', group: 'ma', colorClass: 'bg-green-600' },
  { key: 'MA_BEARISH_ALIGN', label: '역배열', group: 'ma', colorClass: 'bg-red-600' },

  // RSI
  { key: 'RSI_OVERBOUGHT', label: '과매수(RSI≥70)', group: 'rsi', colorClass: 'bg-yellow-600' },
  { key: 'RSI_OVERSOLD', label: '과매도(RSI≤30)', group: 'rsi', colorClass: 'bg-blue-600' },

  // 매매신호
  { key: 'SIGNAL_STRONG_BUY', label: '강력매수', group: 'signal', colorClass: 'bg-red-600' },
  { key: 'SIGNAL_BUY', label: '매수', group: 'signal', colorClass: 'bg-red-500' },
  { key: 'SIGNAL_SELL', label: '매도', group: 'signal', colorClass: 'bg-blue-500' },
  { key: 'SIGNAL_STRONG_SELL', label: '강력매도', group: 'signal', colorClass: 'bg-blue-600' },

  // 포트폴리오 지표
  { key: 'PROFIT_POSITIVE', label: '수익중', group: 'portfolio', colorClass: 'bg-green-500' },
  { key: 'PROFIT_NEGATIVE', label: '손실중', group: 'portfolio', colorClass: 'bg-red-500' },
  { key: 'DROP_FROM_HIGH', label: '고점대비 하락', group: 'portfolio', colorClass: 'bg-orange-600' },
];

export const SMART_FILTER_GROUP_LABELS: Record<string, string> = {
  ma: '이동평균',
  rsi: 'RSI',
  signal: '매매신호',
  portfolio: '포트폴리오',
};
