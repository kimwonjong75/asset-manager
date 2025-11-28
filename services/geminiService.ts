import { GoogleGenAI } from '@google/genai';
import { Asset, SymbolSearchResult } from '../types';

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY! });

// =================================================================
// 환율
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
// 암호화폐 - Upbit 직접 호출
// =================================================================
let cryptoCache: Map<string, { price: number; prevClose: number }> = new Map();
let lastCryptoFetch = 0;

// Upbit에서 실제 거래되는 주요 코인만
const UPBIT_COINS = [
  'BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA', 'TRX', 
  'SHIB', 'LINK', 'EOS', 'SAND', 'MANA', 'APE'
];

async function refreshCryptoCache(): Promise<void> {
  const now = Date.now();
  if (now - lastCryptoFetch < 10000) return;
  lastCryptoFetch = now;

  const markets = UPBIT_COINS.map(c => `KRW-${c}`).join(',');

  try {
    const res = await fetch(`https://api.upbit.com/v1/ticker?markets=${markets}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        data.forEach((item: any) => {
          const ticker = item.market.replace('KRW-', '');
          cryptoCache.set(ticker, {
            price: item.trade_price,
            prevClose: item.prev_closing_price
          });
        });
      }
    }
  } catch (e) {
    console.warn('Crypto fetch failed:', e);
  }
}

async function fetchCryptoPrice(ticker: string): Promise<{ price: number; prevClose: number }> {
  const t = ticker.toUpperCase().replace('KRW-', '');
  
  // 캐시가 비었으면 갱신
  if (cryptoCache.size === 0) {
    await refreshCryptoCache();
  }
  
  // 캐시에서 찾기
  const cached = cryptoCache.get(t);
  if (cached) {
    return cached;
  }
  
  // 캐시에 없으면 개별 요청
  try {
    const res = await fetch(`https://api.upbit.com/v1/ticker?markets=KRW-${t}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const item = data[0];
        const result = { price: item.trade_price, prevClose: item.prev_closing_price };
        cryptoCache.set(t, result);
        return result;
      }
    }
  } catch (e) {
    console.warn('Individual crypto fetch failed:', t);
  }
  
  return { price: 0, prevClose: 0 };
}

// =================================================================
// 한국 주식
// =================================================================
async function fetchKoreanStockPrice(ticker: string): Promise<{ price: number; prevClose: number; name: string }> {
  const code = ticker.replace(/\.(KS|KQ)$/i, '').padStart(6, '0');
  const proxyUrl = import.meta.env.VITE_YAHOO_PROXY_URL;
  
  if (!proxyUrl) {
    return { price: 0, prevClose: 0, name: ticker };
  }

  try {
    const targetUrl = `https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=day&count=2&requestType=0`;
    const res = await fetch(`${proxyUrl}/?url=${encodeURIComponent(targetUrl)}`);
    
    if (res.ok) {
      const text = await res.text();
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
              prevClose = parseFloat(prevMatch[1].split('|')[4]) || closePrice;
            }
          }
          return { price: closePrice, prevClose, name: code };
        }
      }
    }
  } catch (e) {
    console.warn('Korean stock error:', ticker);
  }
  
  return { price: 0, prevClose: 0, name: ticker };
}

// =================================================================
// 미국 주식
// =================================================================
async function fetchUSStockPrice(ticker: string): Promise<{ price: number; prevClose: number; name: string }> {
  const proxyUrl = import.meta.env.VITE_YAHOO_PROXY_URL;
  
  if (!proxyUrl) {
    return { price: 0, prevClose: 0, name: ticker };
  }

  try {
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
    console.warn('US stock error:', ticker);
  }
  
  return { price: 0, prevClose: 0, name: ticker };
}

// =================================================================
// 메인 함수
// =================================================================
export const fetchAssetData = async (ticker: string, exchange: string) => {
  const upperTicker = ticker.toUpperCase().replace('KRW-', '');
  
  // 암호화폐 판별
  const cryptoKeywords = ['업비트', '종합', '거래소', 'CRYPTO', 'COIN'];
  const cryptoTickers = ['BTC','ETH','XRP','SOL','DOGE','ADA','TRX','SHIB','LINK','EOS','SAND','MANA','APE','USDT','USDC','MATIC','AVAX'];
  const isCrypto = cryptoKeywords.some(k => exchange.toUpperCase().includes(k.toUpperCase())) || 
                   cryptoTickers.includes(upperTicker);

  // 한국 주식 판별
  const isKoreanStock = exchange.includes('KRX') || 
                        exchange.includes('코스피') || 
                        exchange.includes('코스닥') || 
                        /^\d{6}$/.test(ticker);

  if (isCrypto) {
    const data = await fetchCryptoPrice(upperTicker);
    return {
      name: upperTicker,
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
// 종목 검색
// =================================================================
export const searchSymbols = async (query: string): Promise<SymbolSearchResult[]> => {
  const results: SymbolSearchResult[] = [];
  const q = query.toUpperCase();
  
  // 암호화폐
  const cryptoList = ['BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA', 'TRX', 'SHIB', 'LINK'];
  if (cryptoList.includes(q)) {
    results.push({ ticker: q, name: q, exchange: '주요 거래소 (종합)' });
  }
  
  // 영문 = 미국주식
  if (/^[A-Za-z]+$/.test(query) && !cryptoList.includes(q)) {
    results.push({ ticker: q, name: q, exchange: 'NASDAQ' });
  }
  
  // 숫자 = 한국주식
  if (/^\d+$/.test(query)) {
    results.push({ ticker: query.padStart(6, '0'), name: query, exchange: 'KRX (코스피/코스닥)' });
  }
  
  return results;
};

// =================================================================
// 환율 함수
// =================================================================
export const fetchCurrentExchangeRate = async (from: string, to: string): Promise<number> => {
  if (from === 'USD' && to === 'KRW') return await getUSDKRWRate();
  return 1;
};

export const fetchHistoricalExchangeRate = async (date: string, from: string, to: string): Promise<number> => {
  return await fetchCurrentExchangeRate(from, to);
};

// =================================================================
// AI 어시스턴트
// =================================================================
export const askPortfolioQuestion = async (assets: Asset[], question: string): Promise<string> => {
  try {
    const simplifiedAssets = assets.map(asset => ({
      name: asset.name,
      category: asset.category,
      quantity: asset.quantity,
      current_value_krw: asset.currentPrice * asset.quantity,
    }));
    
    const prompt = `투자 전문가로서 답변해주세요.\n\n포트폴리오:\n${JSON.stringify(simplifiedAssets, null, 2)}\n\n질문: ${question}`;

    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt,
    });
    
    return response.text?.trim() || '답변 생성 실패';
  } catch (error) {
    return '죄송합니다. AI 서버 연결에 문제가 있습니다.';
  }
};