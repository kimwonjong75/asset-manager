// services/upbitService.ts

// Cloud Run 서버 URL (기존 STOCK_API_URL과 동일)
const UPBIT_PROXY_URL = 'https://asset-manager-887842923289.asia-northeast3.run.app/upbit';

export interface UpbitTicker {
  market: string;
  trade_price: number;
  prev_closing_price: number;
  signed_change_price: number;
  signed_change_rate: number;
  high_price?: number;
  low_price?: number;
}

// 심볼 변환 (BTC -> KRW-BTC)
export const toUpbitPair = (symbol: string): string => {
  const s = (symbol || '').trim().toUpperCase();
  if (!s) return '';
  if (s.startsWith('KRW-') || s.startsWith('BTC-') || s.startsWith('USDT-')) {
    return s;
  }
  return `KRW-${s.replace(/USDT$/, '')}`;
};

// 유효한 마켓 코드인지 확인
const isValidMarket = (market: string): boolean => {
  if (!market || market === 'KRW-' || market === 'BTC-' || market === 'USDT-') {
    return false;
  }
  const match = market.match(/^(KRW|BTC|USDT)-(.+)$/);
  return match !== null && match[2].length > 0;
};

// 배치 조회 (Cloud Run 프록시 사용)
export const fetchUpbitPricesBatch = async (symbols: string[]): Promise<Map<string, UpbitTicker>> => {
  const resultMap = new Map<string, UpbitTicker>();
  
  if (symbols.length === 0) return resultMap;

  // 유효한 심볼만 필터링
  const validSymbols = symbols
    .map(s => (s || '').trim().toUpperCase())
    .filter(s => s.length > 0);

  if (validSymbols.length === 0) {
    console.warn('[Upbit] 유효한 심볼이 없습니다');
    return resultMap;
  }

  console.log('[Upbit] Cloud Run 프록시 호출:', validSymbols);

  try {
    const res = await fetch(UPBIT_PROXY_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ symbols: validSymbols })
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      console.error(`[Upbit] 프록시 응답 에러: ${res.status}`, errorText);
      return resultMap;
    }

    const data = await res.json();
    console.log('[Upbit] 프록시 응답:', data);

    // 응답 데이터를 Map으로 변환
    Object.entries(data).forEach(([market, tickerData]: [string, any]) => {
      if (tickerData && typeof tickerData === 'object' && !tickerData.error) {
        const ticker: UpbitTicker = {
          market: tickerData.market || market,
          trade_price: tickerData.trade_price || 0,
          prev_closing_price: tickerData.prev_closing_price || 0,
          signed_change_price: tickerData.signed_change_price || 0,
          signed_change_rate: tickerData.signed_change_rate || 0,
          high_price: tickerData.high_price,
          low_price: tickerData.low_price,
        };
        
        // 마켓 코드로 매핑 (KRW-BTC)
        resultMap.set(market, ticker);
        
        // 심볼로도 매핑 (BTC)
        if (market.startsWith('KRW-')) {
          resultMap.set(market.replace('KRW-', ''), ticker);
        }
        if (market.startsWith('BTC-')) {
          resultMap.set(market.replace('BTC-', ''), ticker);
        }
      }
    });

    console.log(`[Upbit] 조회 성공: ${resultMap.size}개 코인`);
    return resultMap;

  } catch (error) {
    console.error('[Upbit] 프록시 호출 에러:', error);
    return resultMap;
  }
};

// 단일 코인 조회
export const fetchUpbitPrice = async (symbol: string): Promise<UpbitTicker | null> => {
  const result = await fetchUpbitPricesBatch([symbol]);
  const ticker = result.get(symbol.toUpperCase()) || result.get(toUpbitPair(symbol));
  return ticker || null;
};