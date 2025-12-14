// src/services/upbitService.ts

export interface UpbitTicker {
  market: string;
  trade_price: number;
  prev_closing_price: number;
  signed_change_price: number;
  signed_change_rate: number;
}

// 심볼 변환 (BTC -> KRW-BTC)
export const toUpbitPair = (symbol: string): string => {
  const s = (symbol || '').trim().toUpperCase();
  if (s.startsWith('KRW-') || s.startsWith('BTC-') || s.startsWith('USDT-')) {
    return s;
  }
  return `KRW-${s.replace(/USDT$/, '')}`;
};

// 배치 조회 (여러 코인 한 번에 조회)
export const fetchUpbitPricesBatch = async (symbols: string[]): Promise<Map<string, UpbitTicker>> => {
  if (symbols.length === 0) return new Map();

  // 중복 제거 및 마켓 코드 변환
  const uniqueMarkets = Array.from(new Set(symbols.map(s => toUpbitPair(s))));
  
  // 업비트 API URL (쉼표로 구분해서 한 번에 요청)
  const marketsParam = uniqueMarkets.join(',');
  
  try {
    const res = await fetch(`https://api.upbit.com/v1/ticker?markets=${marketsParam}`, {
      headers: { Accept: 'application/json' }
    });
    
    if (!res.ok) throw new Error(`Upbit API failed: ${res.status}`);
    
    const data: UpbitTicker[] = await res.json();
    const resultMap = new Map<string, UpbitTicker>();
    
    data.forEach(ticker => {
      // 결과 매핑: KRW-BTC -> Ticker 데이터
      resultMap.set(ticker.market, ticker);
      // "BTC"라고만 검색해도 찾을 수 있게 추가 매핑
      if(ticker.market.startsWith('KRW-')) {
        resultMap.set(ticker.market.replace('KRW-', ''), ticker);
      }
    });

    return resultMap;
  } catch (error) {
    console.error("Upbit fetch error:", error);
    return new Map();
  }
};