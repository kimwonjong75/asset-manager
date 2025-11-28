// services/geminiService.ts

import { GoogleGenAI } from '@google/genai';
import { Asset, SymbolSearchResult } from '../types';

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY! });

// =================================================================
// 1. 요청 속도 제한 (Rate Limiting)
// =================================================================
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let lastUpbitCall = 0;
const UPBIT_DELAY = 200; // 0.2초 간격

let lastKrxCall = 0;
const KRX_DELAY = 300; // 0.3초 간격

// =================================================================
// 2. 환율
// =================================================================
let cachedRate: { rate: number; time: number } | null = null;

async function getUSDKRWRate(): Promise<number> {
  if (cachedRate && Date.now() - cachedRate.time < 3600000) {
    return cachedRate.rate;
  }
  
  try {
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    if (res.ok) {
      const data = await res.json();
      const rate = data.rates?.KRW || 1380;
      cachedRate = { rate, time: Date.now() };
      return rate;
    }
  } catch (e) {
    console.warn('Exchange rate failed');
  }
  return 1380;
}

// =================================================================
// 3. 암호화폐 (Upbit) - 배치 요청
// =================================================================
let cryptoCache: Map<string, { price: number; prevClose: number; time: number }> = new Map();
const CRYPTO_CACHE_DURATION = 30000; // 30초 캐시
let lastBatchFetch = 0;

async function fetchAllCryptoPrices(): Promise<void> {
  const now = Date.now();
  
  // 마지막 요청 후 5초 이내면 스킵
  if (now - lastBatchFetch < 5000) {
    return;
  }
  lastBatchFetch = now;
  
  // 주요 암호화폐 목록
  const coins = ['BTC', 'ETH', 'XRP', 'SOL', 'USDC', 'TRX', 'APE', 'DOGE', 'ADA', 'SUI', 'USDT', 'MATIC', 'AVAX', 'SHIB', 'LINK'];
  const markets = coins.map(c => `KRW-${c}`).join(',');
  
  try {
    const res = await fetch(`https://api.upbit.com/v1/ticker?markets=${markets}`);
    
    if (res.ok) {
      const data = await res.json();
      
      data.forEach((item: any) => {
        const ticker = item.market.replace('KRW-', '');
        cryptoCache.set(ticker, {
          price: item.trade_price,
          prevClose: item.prev_closing_price,
          time: now
        });
      });
    }
  } catch (e) {
    console.warn('Batch crypto fetch failed:', e);
  }
}

async function fetchCryptoPrice(ticker: string): Promise<{ price: number; prevClose: number }> {
  const t = ticker.toUpperCase().replace('KRW-', '');
  
  // 캐시 확인
  const cached = cryptoCache.get(t);
  if (cached && Date.now() - cached.time < CRYPTO_CACHE_DURATION) {
    return { price: cached.price, prevClose: cached.prevClose };
  }
  
  // 캐시가 없거나 오래됐으면 전체 갱신
  await fetchAllCryptoPrices();
  
  // 다시 캐시 확인
  const updated = cryptoCache.get(t);
  if (updated) {
    return { price: updated.price, prevClose: updated.prevClose };
  }
  
  // 그래도 없으면 개별 요청
  try {
    await delay(500); // 0.5초 대기
    const res = await fetch(`https://api.upbit.com/v1/ticker?markets=KRW-${t}`);
    
    if (res.ok) {
      const data = await res.json();
      if (data && data[0]) {
        return { price: data[0].trade_price, prevClose: data[0].prev_closing_price };
      }
    }
  } catch (e) {
    console.warn('Individual crypto fetch failed:', t);
  }
  
  return { price: 0, prevClose: 0 };
}

// =================================================================
// 4. 한국 주식 - KRX 공공 API 사용
// =================================================================
async function fetchKoreanStockPrice(ticker: string): Promise<{ price: number; prevClose: number; name: string }> {
  const now = Date.now();
  const waitTime = KRX_DELAY - (now - lastKrxCall);
  if (waitTime > 0) {
    await delay(waitTime);
  }
  lastKrxCall = Date.now();
  
  const code = ticker.replace(/\.(KS|KQ)$/i, '').padStart(6, '0');
  
  try {
    // 프록시를 통해 KRX 정보 가져오기
    const proxyUrl = import.meta.env.VITE_YAHOO_PROXY_URL;
    if (proxyUrl) {
      const targetUrl = `https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=day&count=2&requestType=0`;
      const res = await fetch(`${proxyUrl}/?url=${encodeURIComponent(targetUrl)}`);
      
      if (res.ok) {
        const text = await res.text();
        // XML에서 가격 추출
        const matches = text.match(/<item data="([^"]+)"/g);
        if (matches && matches.length >= 1) {
          const lastMatch = matches[matches.length - 1];
          const dataMatch = lastMatch.match(/data="([^"]+)"/);
          if (dataMatch) {
            const parts = dataMatch[1].split('|');
            const closePrice = parseFloat(parts[4]) || 0;
            
            let prevClose = closePrice;
            if (matches.length >= 2) {
              const prevMatch = matches[matches.length - 2].match(/data="([^"]+)"/);
              if (prevMatch) {
                const prevParts = prevMatch[1].split('|');
                prevClose = parseFloat(prevParts[4]) || closePrice;
              }
            }
            
            return { price: closePrice, prevClose, name: code };
          }
        }
      }
    }
  } catch (e) {
    console.warn('Korean stock error:', ticker, e);
  }
  
  return { price: 0, prevClose: 0, name: ticker };
}

// =================================================================
// 5. 미국 주식 - 프록시 + 여러 소스
// =================================================================
async function fetchUSStockPrice(ticker: string): Promise<{ price: number; prevClose: number; name: string }> {
  const proxyUrl = import.meta.env.VITE_YAHOO_PROXY_URL;
  
  if (!proxyUrl) {
    return { price: 0, prevClose: 0, name: ticker };
  }
  
  try {
    // Stooq 무료 API (제한 없음)
    const stooqUrl = `https://stooq.com/q/l/?s=${ticker.toLowerCase()}.us&f=sd2t2ohlcv&h&e=csv`;
    const res = await fetch(`${proxyUrl}/?url=${encodeURIComponent(stooqUrl)}`);
    
    if (res.ok) {
      const text = await res.text();
      const lines = text.trim().split('\n');
      if (lines.length >= 2) {
        const values = lines[1].split(',');
        const close = parseFloat(values[6]) || 0;
        const open = parseFloat(values[3]) || close;
        
        if (close > 0) {
          return { price: close, prevClose: open, name: ticker };
        }
      }
    }
  } catch (e) {
    console.warn('US stock error:', ticker, e);
  }
  
  return { price: 0, prevClose: 0, name: ticker };
}

// =================================================================
// 6. 메인 함수
// =================================================================
export const fetchAssetData = async (ticker: string, exchange: string) => {
  const upperTicker = ticker.toUpperCase();
  
  // 암호화폐 판별
  const cryptoKeywords = ['업비트', '종합', '거래소', 'CRYPTO', 'COIN'];
  const cryptoList = ['BTC', 'ETH', 'XRP', 'SOL', 'USDC', 'TRX', 'APE', 'DOGE', 'ADA', 'SUI', 'USDT', 'BNB', 'AVAX', 'MATIC', 'SHIB', 'LINK'];
  const isCrypto = cryptoKeywords.some(k => exchange.includes(k)) || 
                   cryptoList.includes(upperTicker.replace('KRW-', ''));

  // 한국 주식 판별
  const isKoreanStock = exchange.includes('KRX') || 
                        exchange.includes('코스피') || 
                        exchange.includes('코스닥') ||
                        /^\d{6}$/.test(ticker);

  if (isCrypto) {
    const data = await fetchCryptoPrice(ticker);
    return {
      name: upperTicker.replace('KRW-', ''),
      priceKRW: data.price,
      priceOriginal: data.price,
      currency: 'KRW',
      pricePreviousClose: data.prevClose
    };
  } else if (isKoreanStock) {
    const data = await fetchKoreanStockPrice(ticker);
    return {
      name: data.name,
      priceKRW: data.price,
      priceOriginal: data.price,
      currency: 'KRW',
      pricePreviousClose: data.prevClose
    };
  } else {
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
// 7. 종목 검색
// =================================================================
export const searchSymbols = async (query: string): Promise<SymbolSearchResult[]> => {
  const results: SymbolSearchResult[] = [];
  
  // 영문이면 미국 주식으로 추가
  if (/^[A-Za-z]+$/.test(query)) {
    results.push({
      ticker: query.toUpperCase(),
      name: query.toUpperCase(),
      exchange: 'NASDAQ'
    });
  }
  
  // 숫자면 한국 주식으로 추가
  if (/^\d+$/.test(query)) {
    results.push({
      ticker: query.padStart(6, '0'),
      name: query,
      exchange: 'KRX (코스피/코스닥)'
    });
  }
  
  // 암호화폐 추가
  const cryptoList = ['BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA'];
  const upperQuery = query.toUpperCase();
  if (cryptoList.includes(upperQuery)) {
    results.push({
      ticker: upperQuery,
      name: upperQuery,
      exchange: '주요 거래소 (종합)'
    });
  }
  
  return results;
};

// =================================================================
// 8. 환율 함수
// =================================================================
export const fetchCurrentExchangeRate = async (from: string, to: string): Promise<number> => {
  if (from === 'USD' && to === 'KRW') {
    return await getUSDKRWRate();
  }
  return 1;
};

export const fetchHistoricalExchangeRate = async (date: string, from: string, to: string): Promise<number> => {
  return await fetchCurrentExchangeRate(from, to);
};

// =================================================================
// 9. AI 어시스턴트
// =================================================================
export const askPortfolioQuestion = async (assets: Asset[], question: string): Promise<string> => {
  try {
    const simplifiedAssets = assets.map(asset => ({
      name: asset.name,
      category: asset.category,
      quantity: asset.quantity,
      current_value_krw: asset.currentPrice * asset.quantity,
    }));
    
    const prompt = `투자 전문가로서 답변해주세요.

포트폴리오:
${JSON.stringify(simplifiedAssets, null, 2)}

질문: ${question}`;

    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt,
    });
    
    return response.text?.trim() || '답변 생성 실패';
  } catch (error) {
    return '죄송합니다. AI 서버 연결에 문제가 있습니다.';
  }
};