// services/upbitService.ts

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
  if (!s) return ''; // 빈 문자열 처리
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
  // KRW-XXX 형식이고 XXX가 1자 이상인지 확인
  const match = market.match(/^(KRW|BTC|USDT)-(.+)$/);
  return match !== null && match[2].length > 0;
};

// 배치 조회 (여러 코인 한 번에 조회)
export const fetchUpbitPricesBatch = async (symbols: string[]): Promise<Map<string, UpbitTicker>> => {
  const resultMap = new Map<string, UpbitTicker>();
  
  if (symbols.length === 0) return resultMap;

  // 중복 제거, 마켓 코드 변환, 유효하지 않은 마켓 필터링
  const uniqueMarkets = Array.from(
    new Set(
      symbols
        .map(s => toUpbitPair(s))
        .filter(isValidMarket)
    )
  );

  console.log('[Upbit] 요청할 마켓:', uniqueMarkets);

  if (uniqueMarkets.length === 0) {
    console.warn('[Upbit] 유효한 마켓이 없습니다');
    return resultMap;
  }

  // 업비트 API URL (쉼표로 구분해서 한 번에 요청)
  const marketsParam = uniqueMarkets.join(',');
  
  try {
    const res = await fetch(`https://api.upbit.com/v1/ticker?markets=${marketsParam}`, {
      headers: { Accept: 'application/json' }
    });
    
    if (!res.ok) {
      // 일부 마켓이 유효하지 않으면 404 반환됨 -> 개별 조회로 폴백
      console.warn(`[Upbit] 배치 조회 실패 (${res.status}), 개별 조회로 전환`);
      return await fetchUpbitPricesIndividually(uniqueMarkets);
    }
    
    const data: UpbitTicker[] = await res.json();
    
    data.forEach(ticker => {
      // 결과 매핑: KRW-BTC -> Ticker 데이터
      resultMap.set(ticker.market, ticker);
      // "BTC"라고만 검색해도 찾을 수 있게 추가 매핑
      if (ticker.market.startsWith('KRW-')) {
        resultMap.set(ticker.market.replace('KRW-', ''), ticker);
      }
      if (ticker.market.startsWith('BTC-')) {
        resultMap.set(ticker.market.replace('BTC-', ''), ticker);
      }
    });

    console.log(`[Upbit] 조회 성공: ${data.length}개 코인`);
    return resultMap;
  } catch (error) {
    console.error("[Upbit] fetch error:", error);
    // 에러 시 개별 조회 시도
    return await fetchUpbitPricesIndividually(uniqueMarkets);
  }
};

// 개별 조회 (배치 실패 시 폴백)
const fetchUpbitPricesIndividually = async (markets: string[]): Promise<Map<string, UpbitTicker>> => {
  const resultMap = new Map<string, UpbitTicker>();
  
  console.log(`[Upbit] 개별 조회 시작: ${markets.length}개`);
  
  for (const market of markets) {
    try {
      const res = await fetch(`https://api.upbit.com/v1/ticker?markets=${market}`, {
        headers: { Accept: 'application/json' }
      });
      
      if (!res.ok) {
        console.warn(`[Upbit] ${market} 조회 실패: ${res.status}`);
        continue;
      }
      
      const data: UpbitTicker[] = await res.json();
      
      if (data && data.length > 0) {
        const ticker = data[0];
        resultMap.set(ticker.market, ticker);
        if (ticker.market.startsWith('KRW-')) {
          resultMap.set(ticker.market.replace('KRW-', ''), ticker);
        }
        console.log(`[Upbit] ${market} 조회 성공: ${ticker.trade_price?.toLocaleString()}원`);
      }
    } catch (e) {
      console.warn(`[Upbit] ${market} 조회 에러:`, e);
    }
    
    // API 호출 간 딜레이 (rate limit 방지)
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`[Upbit] 개별 조회 완료: ${resultMap.size}개 성공`);
  return resultMap;
};

// 단일 코인 조회 (기존 호환용)
export const fetchUpbitPrice = async (symbol: string): Promise<UpbitTicker | null> => {
  const market = toUpbitPair(symbol);
  if (!isValidMarket(market)) {
    console.warn(`[Upbit] 유효하지 않은 심볼: ${symbol}`);
    return null;
  }
  
  try {
    const res = await fetch(`https://api.upbit.com/v1/ticker?markets=${market}`, {
      headers: { Accept: 'application/json' }
    });
    
    if (!res.ok) {
      console.warn(`[Upbit] ${symbol} 조회 실패: ${res.status}`);
      return null;
    }
    
    const data: UpbitTicker[] = await res.json();
    return data && data.length > 0 ? data[0] : null;
  } catch (error) {
    console.error(`[Upbit] ${symbol} 조회 에러:`, error);
    return null;
  }
};