// services/geminiService.ts

import { GoogleGenAI } from '@google/genai';
import { Asset, SymbolSearchResult, Currency } from '../types';

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY! });

// =================================================================
// 1. 환율 정보
// =================================================================
let cachedExchangeRate: { rate: number; timestamp: number } | null = null;
const RATE_CACHE_DURATION = 60 * 60 * 1000; // 1시간

async function getUSDKRWRate(): Promise<number> {
  if (cachedExchangeRate && Date.now() - cachedExchangeRate.timestamp < RATE_CACHE_DURATION) {
    return cachedExchangeRate.rate;
  }
  
  try {
    // 무료 환율 API 사용
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    if (response.ok) {
      const data = await response.json();
      const rate = data.rates?.KRW || 1380;
      cachedExchangeRate = { rate, timestamp: Date.now() };
      return rate;
    }
  } catch (e) {
    console.warn('Exchange rate fetch failed, using default');
  }
  
  return 1380; // 기본값
}

// =================================================================
// 2. 암호화폐 (Upbit)
// =================================================================
async function fetchCryptoPrice(ticker: string): Promise<{ price: number; prevClose: number }> {
  const code = ticker.toUpperCase().startsWith('KRW-') 
    ? ticker.toUpperCase() 
    : `KRW-${ticker.toUpperCase()}`;
  
  const response = await fetch(`https://api.upbit.com/v1/ticker?markets=${code}`);
  
  if (!response.ok) {
    throw new Error(`Upbit API failed: ${response.status}`);
  }
  
  const data = await response.json();
  
  if (!data || data.length === 0) {
    throw new Error(`Coin not found: ${ticker}`);
  }
  
  return {
    price: data[0].trade_price,
    prevClose: data[0].prev_closing_price
  };
}

// =================================================================
// 3. 한국 주식 (KRX)
// =================================================================
async function fetchKoreanStockPrice(ticker: string): Promise<{ price: number; prevClose: number; name: string }> {
  // 6자리 숫자로 정규화
  const code = ticker.replace(/\.(KS|KQ)$/i, '').padStart(6, '0');
  
  try {
    // 네이버 금융 모바일 API (CORS 우회 가능)
    const response = await fetch(`https://m.stock.naver.com/api/stock/${code}/basic`);
    
    if (response.ok) {
      const data = await response.json();
      return {
        price: data.currentPrice || 0,
        prevClose: data.previousClose || 0,
        name: data.stockName || ticker
      };
    }
  } catch (e) {
    console.warn('Naver API failed for', ticker);
  }
  
  // 실패 시 기본값 반환
  return { price: 0, prevClose: 0, name: ticker };
}

// =================================================================
// 4. 미국 주식 - Google Finance 스크래핑 (프록시 사용)
// =================================================================
async function fetchUSStockPrice(ticker: string): Promise<{ price: number; prevClose: number; name: string }> {
  const proxyUrl = import.meta.env.VITE_YAHOO_PROXY_URL;
  
  if (!proxyUrl) {
    console.warn('No proxy URL configured');
    return { price: 0, prevClose: 0, name: ticker };
  }
  
  try {
    // Finnhub 무료 API 사용 (일일 60회 제한이지만 기본적인 사용엔 충분)
    // 또는 Alpha Vantage 사용 가능
    const finnhubKey = 'demo'; // 무료 데모 키
    const url = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${finnhubKey}`;
    
    const response = await fetch(url);
    
    if (response.ok) {
      const data = await response.json();
      if (data.c && data.c > 0) {
        return {
          price: data.c, // current price
          prevClose: data.pc || data.c, // previous close
          name: ticker
        };
      }
    }
  } catch (e) {
    console.warn('Finnhub API failed for', ticker);
  }
  
  // Finnhub 실패 시 프록시로 다른 소스 시도
  try {
    const googleUrl = `https://www.google.com/finance/quote/${ticker}:NASDAQ`;
    const response = await fetch(`${proxyUrl}/?url=${encodeURIComponent(googleUrl)}`);
    
    if (response.ok) {
      const html = await response.text();
      // 가격 추출 (간단한 정규식)
      const priceMatch = html.match(/data-last-price="([0-9.]+)"/);
      if (priceMatch) {
        const price = parseFloat(priceMatch[1]);
        return { price, prevClose: price, name: ticker };
      }
    }
  } catch (e) {
    console.warn('Google Finance scraping failed for', ticker);
  }
  
  return { price: 0, prevClose: 0, name: ticker };
}

// =================================================================
// 5. 메인 Export 함수
// =================================================================
export const fetchAssetData = async (ticker: string, exchange: string) => {
  const upperTicker = ticker.toUpperCase();
  
  // 암호화폐 판별
  const cryptoList = ['BTC', 'ETH', 'XRP', 'SOL', 'USDC', 'TRX', 'APE', 'DOGE', 'ADA', 'SUI', 'USDT', 'BNB', 'AVAX', 'MATIC'];
  const isCrypto = exchange.includes('종합') || 
                   exchange.includes('업비트') || 
                   exchange.includes('거래소') ||
                   cryptoList.includes(upperTicker.replace('KRW-', ''));

  // 한국 주식 판별
  const isKoreanStock = exchange.includes('KRX') || 
                        exchange.includes('코스피') || 
                        exchange.includes('코스닥') ||
                        /^\d{6}$/.test(ticker);

  if (isCrypto) {
    // 암호화폐
    const data = await fetchCryptoPrice(ticker);
    return {
      name: upperTicker.replace('KRW-', ''),
      priceKRW: data.price,
      priceOriginal: data.price,
      currency: 'KRW',
      pricePreviousClose: data.prevClose
    };
  } else if (isKoreanStock) {
    // 한국 주식
    const data = await fetchKoreanStockPrice(ticker);
    return {
      name: data.name,
      priceKRW: data.price,
      priceOriginal: data.price,
      currency: 'KRW',
      pricePreviousClose: data.prevClose
    };
  } else {
    // 미국/해외 주식
    const data = await fetchUSStockPrice(upperTicker);
    const rate = await getUSDKRWRate();
    
    return {
      name: data.name,
      priceOriginal: data.price,
      currency: 'USD',
      priceKRW: data.price * rate,
      pricePreviousClose: data.prevClose * rate
    };
  }
};

// =================================================================
// 6. 종목 검색
// =================================================================
export const searchSymbols = async (query: string): Promise<SymbolSearchResult[]> => {
  const results: SymbolSearchResult[] = [];
  
  // 한국 주식 검색 (네이버)
  try {
    const response = await fetch(
      `https://ac.stock.naver.com/ac?q=${encodeURIComponent(query)}&target=stock`
    );
    
    if (response.ok) {
      const data = await response.json();
      const items = data.items || [];
      
      items.slice(0, 5).forEach((item: any) => {
        results.push({
          ticker: item.code,
          name: item.name,
          exchange: item.market === 'KOSDAQ' ? 'KRX (코스피/코스닥)' : 'KRX (코스피/코스닥)'
        });
      });
    }
  } catch (e) {
    console.warn('Korean stock search failed');
  }
  
  // 검색어가 영문이면 미국 주식도 추가
  if (/^[A-Za-z]+$/.test(query)) {
    results.push({
      ticker: query.toUpperCase(),
      name: query.toUpperCase(),
      exchange: 'NASDAQ'
    });
  }
  
  return results;
};

// =================================================================
// 7. 환율 함수
// =================================================================
export const fetchCurrentExchangeRate = async (from: string, to: string): Promise<number> => {
  if (from === 'USD' && to === 'KRW') {
    return await getUSDKRWRate();
  }
  return 1;
};

export const fetchHistoricalExchangeRate = async (date: string, from: string, to: string): Promise<number> => {
  // 과거 환율은 현재 환율로 대체
  return await fetchCurrentExchangeRate(from, to);
};

// =================================================================
// 8. 포트폴리오 AI 어시스턴트
// =================================================================
export const askPortfolioQuestion = async (assets: Asset[], question: string): Promise<string> => {
  try {
    const simplifiedAssets = assets.map(asset => ({
      name: asset.name,
      category: asset.category,
      quantity: asset.quantity,
      current_value_krw: asset.currentPrice * asset.quantity,
    }));
    
    const portfolioJson = JSON.stringify(simplifiedAssets, null, 2);
    
    const prompt = `당신은 투자 전문가입니다. 아래 포트폴리오 데이터를 분석하고 질문에 답변해주세요.

포트폴리오 데이터:
${portfolioJson}

질문: ${question}

한국어로 친절하고 상세하게 답변해주세요.`;

    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt,
    });
    
    return response.text?.trim() || '답변을 생성할 수 없습니다.';
  } catch (error) {
    console.error('AI assistant error:', error);
    return '죄송합니다. AI 서버 연결에 문제가 있습니다. 잠시 후 다시 시도해주세요.';
  }
};