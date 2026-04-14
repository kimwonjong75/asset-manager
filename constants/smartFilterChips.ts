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
    description: '현재가가 단기 이동평균선 위(>) 또는 아래(<)인 종목 필터',
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
    description: '현재가가 장기 이동평균선 위(>) 또는 아래(<)인 종목 필터',
  },
  { key: 'MA_BULLISH_ALIGN', label: '정배열', group: 'ma', colorClass: 'bg-green-600', needsEnriched: true, description: '단기MA > 장기MA — 상승 추세 정렬' },
  { key: 'MA_BEARISH_ALIGN', label: '역배열', group: 'ma', colorClass: 'bg-red-600', needsEnriched: true, description: '단기MA < 장기MA — 하락 추세 정렬' },
  { key: 'MA_GOLDEN_CROSS', label: '골든크로스', group: 'ma', colorClass: 'bg-amber-600', needsEnriched: true, description: '단기MA > 장기MA 상태 (교차 경과일 표시)' },
  { key: 'MA_DEAD_CROSS', label: '데드크로스', group: 'ma', colorClass: 'bg-purple-600', needsEnriched: true, description: '단기MA < 장기MA 상태 (교차 경과일 표시)' },

  // RSI
  { key: 'RSI_OVERBOUGHT', label: '과매수(RSI≥70)', group: 'rsi', colorClass: 'bg-yellow-600', description: 'RSI 70 이상 — 과매수 구간, 하락 전환 가능성' },
  { key: 'RSI_OVERSOLD', label: '과매도(RSI≤30)', group: 'rsi', colorClass: 'bg-blue-600', description: 'RSI 30 이하 — 과매도 구간, 반등 가능성' },
  { key: 'RSI_BOUNCE', label: 'RSI 반등↑', group: 'rsi', colorClass: 'bg-cyan-600', needsEnriched: true, description: 'RSI가 과매도 구간(30 이하)에서 반등 시작' },
  { key: 'RSI_OVERHEAT_ENTRY', label: 'RSI 과열진입↓', group: 'rsi', colorClass: 'bg-pink-600', needsEnriched: true, description: 'RSI가 과매수 구간(70 이상)에 진입' },

  // 매매신호
  { key: 'SIGNAL_STRONG_BUY', label: '강력매수', group: 'signal', colorClass: 'bg-red-600', description: 'RSI·MA·거래량 복합 강력 매수 신호' },
  { key: 'SIGNAL_BUY', label: '매수', group: 'signal', colorClass: 'bg-red-500', description: '기술적 지표 기반 매수 신호' },
  { key: 'SIGNAL_SELL', label: '매도', group: 'signal', colorClass: 'bg-blue-500', description: '기술적 지표 기반 매도 신호' },
  { key: 'SIGNAL_STRONG_SELL', label: '강력매도', group: 'signal', colorClass: 'bg-blue-600', description: 'RSI·MA·거래량 복합 강력 매도 신호' },

  // 거래량
  { key: 'VOLUME_SURGE', label: '급증(2x)', group: 'volume', colorClass: 'bg-orange-500', description: '거래량이 20일 평균 대비 2배 이상 급증' },
  { key: 'VOLUME_HIGH', label: '증가(1.5x)', group: 'volume', colorClass: 'bg-yellow-500', description: '거래량이 20일 평균 대비 1.5배 이상 증가' },
  { key: 'VOLUME_LOW', label: '감소(<0.5x)', group: 'volume', colorClass: 'bg-gray-500', description: '거래량이 20일 평균 대비 0.5배 미만으로 감소' },

  // 포트폴리오 지표
  { key: 'PROFIT_POSITIVE', label: '수익중', group: 'portfolio', colorClass: 'bg-green-500', description: '현재 수익률이 양수인 종목' },
  { key: 'PROFIT_NEGATIVE', label: '손실중', group: 'portfolio', colorClass: 'bg-red-500', description: '현재 수익률이 음수인 종목' },
  { key: 'DROP_FROM_HIGH', label: '고점대비 하락', group: 'portfolio', colorClass: 'bg-orange-600', description: '52주 최고가 대비 설정한 비율 이상 하락한 종목' },
  { key: 'DAILY_DROP', label: '당일 하락', group: 'portfolio', colorClass: 'bg-rose-600', description: '전일 대비 하락한 종목' },
  { key: 'PROFIT_TARGET', label: '수익률 도달', labelFn: (s) => `수익≥${s.profitTargetThreshold ?? 20}%`, group: 'portfolio', colorClass: 'bg-emerald-600', description: '설정한 목표 수익률에 도달한 종목' },
  { key: 'DAILY_SURGE', label: '당일 급등', labelFn: (s) => `급등≥${s.dailySurgeThreshold ?? 5}%`, group: 'portfolio', colorClass: 'bg-red-500', description: '당일 설정 비율 이상 급등한 종목' },
  { key: 'DAILY_CRASH', label: '당일 급락', labelFn: (s) => `급락≥${s.dailyCrashThreshold ?? 5}%`, group: 'portfolio', colorClass: 'bg-blue-700', description: '당일 설정 비율 이상 급락한 종목' },
  { key: 'LOSS_THRESHOLD', label: '손실률 초과', labelFn: (s) => `손실≥${s.lossThreshold}%`, group: 'portfolio', colorClass: 'bg-red-700', description: '설정한 손실률을 초과한 종목' },
];

export const SMART_FILTER_GROUP_LABELS: Record<string, string> = {
  ma: '이동평균',
  rsi: 'RSI',
  signal: '매매신호',
  portfolio: '포트폴리오',
  volume: '거래량',
};
