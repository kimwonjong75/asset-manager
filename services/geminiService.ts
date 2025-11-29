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
// Gemini API 설정 (안전한 초기화)
// =================================================================
const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

// API 키 상태 확인용 플래그
const isAiEnabled = !!apiKey && apiKey.length > 0;

// 키가 있을 때만 인스턴스 생성 (없으면 null)
const ai = isAiEnabled ? new GoogleGenAI({ apiKey: apiKey }) : null;

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
    if (!isAiEnabled || !ai) {
        console.warn("API Key missing: Search disabled");
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
// Gemini 채팅 (분석)
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
    if (!isAiEnabled || !ai) return "API 키가 설정되지 않아 AI 기능을 사용할 수 없습니다. (Settings > Secrets 확인 필요)";
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
// 암호화폐 - Upbit (안전 모드: 재요청 차단)
// =================================================================
let cryptoCache: Map<string, { price: number; prevClose: number }> = new Map();
let cryptoFetchPromise: Promise<void> | null = null;
let lastCryptoFetch = 0;

// 조회할 코인 목록 고정
const UPBIT_COINS = [
  'BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA', 'TRX', 
  'SHIB', 'LINK', 'EOS', 'SAND', 'MANA', 'APE', 
  'USDT', 'USDC', 'AVAX', 'MATIC', 'ETC', 'BCH' 
];

async function refreshCryptoCache(): Promise<void> {
  const now = Date.now();
  if (cryptoFetchPromise) return cryptoFetchPromise; 
  // 10초 쿨타임
  if (now - lastCryptoFetch < 10000 && cryptoCache.size > 0) return;

  cryptoFetchPromise = (async () => {
    try {
      const markets = UPBIT_COINS.map(c => `KRW-${c}`).join(',');
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
          lastCryptoFetch = Date.now();
        }
      } else {
        console.warn(`Upbit Bulk Fetch Failed: ${res.status} - 재요청을 중단합니다.`);
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
  
  // 1. 전체 시세 갱신 시도
  await refreshCryptoCache();
  
  // 2. 캐시 확인
  const cached = cryptoCache.get(t);
  if (cached) return cached;

  // [중요 수정] 캐시에 없다고 해서 개별 요청을 마구 보내지 않음 (429 에러 방지)
  // Upbit는 전체 조회에 실패하면 개별 조회도 실패할 확률이 높음. 0 리턴하고 종료.
  return { price: 0, prevClose: 0 };
}

// =================================================================
// 주식 모의 데이터
// =================================================================
let stockCache: Map<string, { price: number; prevClose: number, timestamp: number }> = new Map();
const STOCK_CACHE_DURATION = 600000; 

async function fetchStockPrice(ticker: string, exchange: string): Promise<{ price: number; prevClose: number } | null> {
    if (!isAiEnabled || !ai) return null; // 키 없으면 중단

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