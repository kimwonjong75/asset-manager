import { GoogleGenAI } from '@google/genai';
import { Asset, Currency, SymbolSearchResult, AssetCategory } from '../types';

// =================================================================
// 유틸리티 함수
// =================================================================
function formatAssetsForAI(assets: Asset[]): string {
  return assets.map(asset => {
    const value = asset.quantity * asset.currentPrice;
    return `- ${asset.name} (${asset.ticker}): ${asset.quantity}주, 현재가 ${asset.currentPrice.toLocaleString()}원, 평가액 ${value.toLocaleString()}원`;
  }).join('\n');
}

// =================================================================
// Gemini API 설정
// =================================================================
const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

// [디버깅용 로그] 배포 후 F12 콘솔에서 키가 들어왔는지 확인 가능
console.log("Gemini API Key Status:", apiKey ? `Loaded (${apiKey.length} chars)` : "MISSING (UNDEFINED)");

const isAiEnabled = !!apiKey && apiKey.length > 0;

// 키가 없으면 더미 객체 생성 (404 에러 방지용)
const ai = isAiEnabled 
    ? new GoogleGenAI({ apiKey: apiKey }) 
    : {
        models: {
            generateContent: async () => ({
                text: "API 키가 누락되었습니다. GitHub Secrets 설정을 확인해주세요."
            })
        }
      } as any;

// =================================================================
// 환율 함수
// =================================================================
let exchangeRateCache: Map<Currency, { rate: number, timestamp: number }> = new Map();
const EXCHANGE_CACHE_DURATION = 3600000; // 1시간

export const fetchCurrentExchangeRate = async (from: string, to: string): Promise<number> => {
  if (from === 'USD' && to === 'KRW') {
    const cached = exchangeRateCache.get(Currency.USD);
    if (cached && Date.now() - cached.timestamp < EXCHANGE_CACHE_DURATION) {
      return cached.rate;
    }
    const mockRate = 1450; 
    exchangeRateCache.set(Currency.USD, { rate: mockRate, timestamp: Date.now() });
    return mockRate;
  }
  return 1;
};

export const fetchHistoricalExchangeRate = async (date: string, from: string, to: string): Promise<number> => {
  return await fetchCurrentExchangeRate(from, to);
};

// =================================================================
// 종목 검색
// =================================================================
let searchCache: Map<string, SymbolSearchResult[]> = new Map();

export async function searchSymbols(query: string): Promise<SymbolSearchResult[]> {
    if (!isAiEnabled) {
        console.warn("Search disabled: No API Key");
        return [];
    }

    const cacheKey = query.toLowerCase();
    if (searchCache.has(cacheKey)) {
        return searchCache.get(cacheKey)!;
    }

    try {
        const prompt = `사용자가 자산의 티커(Ticker)나 이름으로 검색하고 있습니다. 검색어는 "${query}"입니다. 가장 관련성이 높은 주식, ETF, 암호화폐, 금현물 종목 5개를 추천해주세요. 결과는 오직 JSON 배열로만 응답하세요. 예: [{"ticker":"AAPL","name":"Apple Inc.","exchange":"NASDAQ"}]`;
        
        const response = await ai.models.generateContent({
            model: "gemini-1.5-flash",
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });
        
        const jsonText = response.text?.trim() || "[]";
        const results = JSON.parse(jsonText) as SymbolSearchResult[];
        searchCache.set(cacheKey, results);
        return results;
    } catch (error) {
        console.error("Symbol search failed:", error);
        return [];
    }
}

// =================================================================
// Gemini 채팅
// =================================================================
export const askPortfolioQuestion = async (assets: Asset[], question: string): Promise<string> => {
    return analyzePortfolio(assets, question);
};

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

const chatHistory: ChatMessage[] = [];

export async function analyzePortfolio(assets: Asset[], message: string): Promise<string> {
    if (!isAiEnabled) return "API 키가 설정되지 않았습니다. GitHub Settings > Secrets를 확인해주세요.";
    if (assets.length === 0) return "현재 포트폴리오에 자산이 없습니다.";
    
    const portfolioData = formatAssetsForAI(assets);
    const systemInstruction = `당신은 금융 AI 어시스턴트입니다. 아래 포트폴리오 데이터를 기반으로 질문에 답하세요.\n포트폴리오 데이터:\n${portfolioData}`;

    const contents = [
        { role: 'system', parts: [{ text: systemInstruction }] },
        ...chatHistory.map(msg => ({ role: msg.role, parts: [{ text: msg.text }] }))
    ];

    try {
        const response = await ai.models.generateContent({ 
            model: "gemini-1.5-flash", 
            contents: [...contents, { role: 'user', parts: [{ text: message }] }],
            config: { systemInstruction }
        });

        const modelResponse = response.text || "답변을 생성할 수 없습니다.";
        chatHistory.push({ role: 'user', text: message });
        chatHistory.push({ role: 'model', text: modelResponse });

        return modelResponse;
    } catch (error) {
        return "죄송합니다. 분석 중 오류가 발생했습니다.";
    }
}

// =================================================================
// 암호화폐 - Upbit (404/429 방지 강화)
// =================================================================
let cryptoCache: Map<string, { price: number; prevClose: number }> = new Map();
let cryptoFetchPromise: Promise<void> | null = null;
let lastCryptoFetch = 0;

const UPBIT_COINS = [
  'BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA', 'TRX', 
  'SHIB', 'LINK', 'EOS', 'SAND', 'MANA', 'APE', 
  'USDT', 'USDC', 'AVAX', 'MATIC', 'ETC', 'BCH' 
];

async function refreshCryptoCache(): Promise<void> {
  const now = Date.now();
  if (cryptoFetchPromise) return cryptoFetchPromise; 
  if (now - lastCryptoFetch < 10000 && cryptoCache.size > 0) return;

  cryptoFetchPromise = (async () => {
    try {
      // [수정] URL 생성 시 공백 제거 및 인코딩 처리 (404 방지)
      const marketString = UPBIT_COINS.map(c => `KRW-${c}`).join(',');
      const url = `https://api.upbit.com/v1/ticker?markets=${marketString}`;
      
      const res = await fetch(url);
      
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
          lastCryptoFetch = Date.now();
        }
      } else {
        console.warn(`Upbit Bulk Fetch Failed: ${res.status}`);
      }
    } catch (e) {
      console.warn('Crypto fetch failed:', e);
    } finally {
      cryptoFetchPromise = null;
    }
  })();
  return cryptoFetchPromise;
}

async function fetchCryptoPrice(ticker: string): Promise<{ price: number; prevClose: number }> {
  const t = ticker.toUpperCase().replace('KRW-', '');
  
  await refreshCryptoCache();
  
  const cached = cryptoCache.get(t);
  if (cached) return cached;

  return { price: 0, prevClose: 0 };
}

// =================================================================
// 모의 데이터
// =================================================================
let stockCache: Map<string, { price: number; prevClose: number, timestamp: number }> = new Map();
const STOCK_CACHE_DURATION = 600000; 

async function fetchStockPrice(ticker: string, exchange: string): Promise<{ price: number; prevClose: number } | null> {
    if (!isAiEnabled) return null; 

    const cacheKey = `${ticker}-${exchange}`.toLowerCase();
    const cached = stockCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < STOCK_CACHE_DURATION) {
        return { price: cached.price, prevClose: cached.prevClose };
    }

    try {
        const prompt = `"${exchange}" 시장의 "${ticker}" 종목의 현재가와 전일 종가를 예측하여 JSON으로 주세요. {"price": 100, "prevClose": 90} 형식 준수.`;
        const response = await ai.models.generateContent({
            model: "gemini-1.5-flash",
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });
        
        const text = response.text?.trim() || "{}";
        const result = JSON.parse(text);
        
        if (result.price !== undefined) {
            stockCache.set(cacheKey, { ...result, timestamp: Date.now() });
            return result;
        }
        return null;
    } catch (error) {
        return null; 
    }
}

// =================================================================
// 메인 함수
// =================================================================

export interface AssetDataResult {
  name: string;               
  priceOriginal: number;
  priceKRW: number;           
  currency: string;           
  pricePreviousClose: number; 
  highestPrice?: number;
  isMocked: boolean;
}

export const fetchAssetData = async (ticker: string, exchange: string, currencyInput?: Currency): Promise<AssetDataResult> => {
  const upperTicker = ticker.toUpperCase().replace('KRW-', '');
  
  const currency = currencyInput || (exchange.includes('KRX') || exchange.includes('코스피') ? Currency.KRW : Currency.USD);

  let priceData: { price: number; prevClose: number } | null = null;
  let isMocked = false;

  const cryptoKeywords = ['업비트', '종합', '거래소', 'CRYPTO', 'COIN'];
  const isCrypto = cryptoKeywords.some(keyword => exchange.toUpperCase().includes(keyword.toUpperCase()));

  if (isCrypto) {
    try {
      priceData = await fetchCryptoPrice(upperTicker);
      isMocked = false;
    } catch { priceData = null; }
  } else {
    try {
      priceData = await fetchStockPrice(upperTicker, exchange); 
      isMocked = true;
    } catch { priceData = null; }
  }

  if (!priceData || priceData.price === 0) {
    return { 
        name: ticker,
        priceOriginal: 0, 
        priceKRW: 0, 
        currency: currency, 
        pricePreviousClose: 0, 
        highestPrice: 0,
        isMocked 
    };
  }
  
  const exchangeRate = await fetchCurrentExchangeRate('USD', 'KRW');
  const finalRate = currency === Currency.KRW ? 1 : exchangeRate;
  
  const currentPriceKRW = priceData.price * finalRate;
  const prevCloseKRW = priceData.prevClose * finalRate;
  const highestPriceKRW = currentPriceKRW * (1 + (Math.random() * 0.1));

  return {
    name: ticker, 
    priceOriginal: priceData.price,
    priceKRW: currentPriceKRW,       
    currency: currency,              
    pricePreviousClose: prevCloseKRW,
    highestPrice: highestPriceKRW,
    isMocked: isMocked,
  };
};