import type { AlertRule, AlertSettings } from '../types/alertRules';

/** 기본 매도 감지 규칙 */
const SELL_RULES: AlertRule[] = [
  {
    id: 'stop-loss',
    name: '기계적 손절',
    description: '보유 수익률이 임계값 이하로 하락',
    severity: 'critical',
    action: 'sell',
    enabled: true,
    filters: ['LOSS_THRESHOLD'],
    filterConfig: { lossThreshold: 5 },
  },
  {
    id: 'overheat-drop',
    name: '과열 후 하락',
    description: 'RSI ≥70 과매수 상태에서 당일 하락 시작',
    severity: 'critical',
    action: 'sell',
    enabled: true,
    filters: ['RSI_OVERBOUGHT', 'DAILY_DROP'],
    filterConfig: {},
  },
  {
    id: 'dead-cross',
    name: '단기 데드크로스',
    description: '단기 이평선이 장기 이평선 하향 돌파',
    severity: 'warning',
    action: 'sell',
    enabled: true,
    filters: ['MA_DEAD_CROSS'],
    filterConfig: { maShortPeriod: 5, maLongPeriod: 20 },
  },
  {
    id: 'trend-break',
    name: '추세 이탈',
    description: '현재가가 단기 이평선 아래 + 손실 중',
    severity: 'warning',
    action: 'sell',
    enabled: true,
    filters: ['PRICE_BELOW_SHORT_MA', 'PROFIT_NEGATIVE'],
    filterConfig: { maShortPeriod: 20 },
  },
  {
    id: 'long-decline',
    name: '장기 하락 확인',
    description: '역배열 + 고점대비 큰 폭 하락',
    severity: 'warning',
    action: 'sell',
    enabled: true,
    filters: ['MA_BEARISH_ALIGN', 'DROP_FROM_HIGH'],
    filterConfig: { maShortPeriod: 20, maLongPeriod: 60, dropFromHighThreshold: 20 },
  },
];

/** 기본 매수 기회 규칙 */
const BUY_RULES: AlertRule[] = [
  {
    id: 'pullback',
    name: '눌림목 매수',
    description: '장기MA 위에서 RSI 과매도 — 저점 매수 기회',
    severity: 'info',
    action: 'buy',
    enabled: true,
    filters: ['PRICE_ABOVE_LONG_MA', 'RSI_OVERSOLD'],
    filterConfig: { maLongPeriod: 60 },
  },
  {
    id: 'golden-cross',
    name: '골든크로스',
    description: '단기 이평선이 장기 이평선 상향 돌파',
    severity: 'info',
    action: 'buy',
    enabled: true,
    filters: ['MA_GOLDEN_CROSS'],
    filterConfig: { maShortPeriod: 5, maLongPeriod: 20 },
  },
  {
    id: 'bottom-bounce',
    name: '바닥 반등',
    description: 'RSI 30 이하에서 반등 시작',
    severity: 'info',
    action: 'buy',
    enabled: true,
    filters: ['RSI_BOUNCE'],
    filterConfig: {},
  },
];

export const DEFAULT_ALERT_RULES: AlertRule[] = [...SELL_RULES, ...BUY_RULES];

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  rules: DEFAULT_ALERT_RULES,
  enableAutoPopup: true,
};
