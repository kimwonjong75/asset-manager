// utils/chartFormat.ts
// 차트 공용 포맷/색상 헬퍼 (순수). SignalReplayChart 가 사용 (AssetTrendChart 의 소형 헬퍼와 동형).
// AssetTrendChart 마이그레이션은 회귀 위험 회피로 후속(현재는 신규 코드만 사용).

import { Currency } from '../types';

// 한국식 캔들 — 양봉=상승=빨강, 음봉=하락=파랑
export const CANDLE_UP_COLOR = '#F23645';
export const CANDLE_DOWN_COLOR = '#2962FF';

/** YYYY-MM-DD → lightweight-charts time (문자열 그대로 허용) */
export function toChartTime(dateStr: string): string {
  return dateStr;
}

export function getCurrencySymbol(curr: Currency): string {
  switch (curr) {
    case Currency.USD: return '$';
    case Currency.JPY: return '¥';
    case Currency.KRW: return '₩';
    default: return '';
  }
}

export function formatPrice(value: number, curr: Currency): string {
  const symbol = getCurrencySymbol(curr);
  const formatted =
    curr === Currency.KRW
      ? Math.round(value).toLocaleString('ko-KR')
      : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbol}${formatted}`;
}

/** 수익률/변동률 부호 라벨 */
export function formatPct(value: number | null, digits = 1): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}
