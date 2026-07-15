// scripts/backtest/onboardingPolicy/reprUniverse.ts
// 대표군 19종 — **이미 동결된 명단**. 출처: docs/backtest/REPORT_종목별채널.md §"유니버스 repr".
// 생성 스크립트는 리포지토리에 없으므로 보고서 표에서 복구했다. 종목 추가·삭제 금지.

/** 동결 명단 (보고서 표기 그대로). */
export const REPR_UNIVERSE_19 = [
  'BTC-USD', 'XLK', 'DBC', 'IWM', '069500', 'XLE', 'QQQ', 'SPY', 'TLT',
  'FXI', 'EFA', 'EEM', 'EWJ', 'VNQ', 'IEF', 'GLD', 'LQD', 'ETH-USD', 'SLV',
] as const;

export type ReprTicker = (typeof REPR_UNIVERSE_19)[number];

/**
 * 보고서 표기 티커 → 가격조회 심볼 = **표기 그대로**.
 * 백엔드 /history 는 KRX 를 6자리 원형(`069500`)으로 받는다 — `.KS` 접미는 오히려 실패한다
 * (실측: `069500.KS`→"No data found", `069500`→정상). 동결 명단 표기를 변형하지 않는다.
 */
export function reprFetchSymbol(ticker: string): string {
  return ticker;
}

/** 종목 통화 (현지통화 원장 — 수익률 비교는 통화 무관하나 기록용). */
export function reprCurrency(ticker: string): 'KRW' | 'USD' {
  return /^\d{6}$/.test(ticker) ? 'KRW' : 'USD';
}
