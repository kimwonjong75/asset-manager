import type { SignalType, RSIStatus, Indicators } from '../types/api';

export interface Badge {
  label: string;
  className: string;
}

export const getSignalBadge = (signal?: SignalType): Badge | null => {
  switch (signal) {
    case 'STRONG_BUY':
      return { label: '강한 매수', className: 'px-2 py-1 rounded bg-green-600/20 text-green-400 text-xs' };
    case 'BUY':
      return { label: '매수', className: 'px-2 py-1 rounded bg-success/20 text-success text-xs' };
    case 'SELL':
      return { label: '매도', className: 'px-2 py-1 rounded bg-danger/20 text-danger text-xs' };
    case 'STRONG_SELL':
      return { label: '강한 매도', className: 'px-2 py-1 rounded bg-red-600/20 text-red-400 text-xs' };
    case 'NEUTRAL':
      return { label: '중립', className: 'px-2 py-1 rounded bg-gray-600/20 text-gray-300 text-xs' };
    default:
      return null;
  }
};

export const getRsiBadge = (status?: RSIStatus, value?: number): Badge | null => {
  switch (status) {
    case 'OVERBOUGHT':
      return { label: `RSI 과매수 (${(value ?? 0).toFixed(1)})`, className: 'px-2 py-1 rounded bg-yellow-600/20 text-yellow-400 text-xs' };
    case 'OVERSOLD':
      return { label: `RSI 과매도 (${(value ?? 0).toFixed(1)})`, className: 'px-2 py-1 rounded bg-blue-600/20 text-blue-400 text-xs' };
    case 'NORMAL':
      return { label: `RSI 정상 (${(value ?? 0).toFixed(1)})`, className: 'px-2 py-1 rounded bg-gray-600/20 text-gray-300 text-xs' };
    default:
      return null;
  }
};

export const hasServerSignal = (ind?: Indicators): boolean => {
  return !!(ind && ind.signal);
};
