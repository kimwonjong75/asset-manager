import type { SmartFilterChipDef } from '../types/smartFilter';

export const SMART_FILTER_CHIPS: SmartFilterChipDef[] = [
  // 이동평균 (MA) — 선택 기간 기반
  {
    key: 'PRICE_ABOVE_SHORT_MA',
    label: '현재가↕MA20',
    labelFn: (s) => `현재가↕MA${s.maShortPeriod}`,
    group: 'ma',
    colorClass: 'bg-emerald-600',
    needsEnriched: true,
    pairKey: 'PRICE_BELOW_SHORT_MA',
    pairColorClass: 'bg-red-600',
  },
  {
    key: 'PRICE_ABOVE_LONG_MA',
    label: '현재가↕MA60',
    labelFn: (s) => `현재가↕MA${s.maLongPeriod}`,
    group: 'ma',
    colorClass: 'bg-emerald-600',
    needsEnriched: true,
    pairKey: 'PRICE_BELOW_LONG_MA',
    pairColorClass: 'bg-red-600',
  },
  { key: 'MA_BULLISH_ALIGN', label: '정배열', group: 'ma', colorClass: 'bg-green-600', needsEnriched: true },
  { key: 'MA_BEARISH_ALIGN', label: '역배열', group: 'ma', colorClass: 'bg-red-600', needsEnriched: true },
  { key: 'MA_GOLDEN_CROSS', label: '골든크로스', group: 'ma', colorClass: 'bg-amber-600', needsEnriched: true },
  { key: 'MA_DEAD_CROSS', label: '데드크로스', group: 'ma', colorClass: 'bg-purple-600', needsEnriched: true },

  // RSI
  { key: 'RSI_OVERBOUGHT', label: '과매수(RSI≥70)', group: 'rsi', colorClass: 'bg-yellow-600' },
  { key: 'RSI_OVERSOLD', label: '과매도(RSI≤30)', group: 'rsi', colorClass: 'bg-blue-600' },
  { key: 'RSI_BOUNCE', label: 'RSI 반등↑', group: 'rsi', colorClass: 'bg-cyan-600', needsEnriched: true },
  { key: 'RSI_OVERHEAT_ENTRY', label: 'RSI 과열진입↓', group: 'rsi', colorClass: 'bg-pink-600', needsEnriched: true },

  // 매매신호
  { key: 'SIGNAL_STRONG_BUY', label: '강력매수', group: 'signal', colorClass: 'bg-red-600' },
  { key: 'SIGNAL_BUY', label: '매수', group: 'signal', colorClass: 'bg-red-500' },
  { key: 'SIGNAL_SELL', label: '매도', group: 'signal', colorClass: 'bg-blue-500' },
  { key: 'SIGNAL_STRONG_SELL', label: '강력매도', group: 'signal', colorClass: 'bg-blue-600' },

  // 거래량
  { key: 'VOLUME_SURGE', label: '급증(2x)', group: 'volume', colorClass: 'bg-orange-500' },
  { key: 'VOLUME_HIGH', label: '증가(1.5x)', group: 'volume', colorClass: 'bg-yellow-500' },
  { key: 'VOLUME_LOW', label: '감소(<0.5x)', group: 'volume', colorClass: 'bg-gray-500' },

  // 포트폴리오 지표
  { key: 'PROFIT_POSITIVE', label: '수익중', group: 'portfolio', colorClass: 'bg-green-500' },
  { key: 'PROFIT_NEGATIVE', label: '손실중', group: 'portfolio', colorClass: 'bg-red-500' },
  { key: 'DROP_FROM_HIGH', label: '고점대비 하락', group: 'portfolio', colorClass: 'bg-orange-600' },
  { key: 'DAILY_DROP', label: '당일 하락', group: 'portfolio', colorClass: 'bg-rose-600' },
  { key: 'LOSS_THRESHOLD', label: '손실률 초과', labelFn: (s) => `손실≥${s.lossThreshold}%`, group: 'portfolio', colorClass: 'bg-red-700' },
];

export const SMART_FILTER_GROUP_LABELS: Record<string, string> = {
  ma: '이동평균',
  rsi: 'RSI',
  signal: '매매신호',
  portfolio: '포트폴리오',
  volume: '거래량',
};
