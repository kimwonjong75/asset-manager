import { Asset, Currency, SymbolSearchResult } from '../types';

// =================================================================
// 1. 유틸리티 및 설정
// =================================================================
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// 디버깅용 로그
console.log("Service Status:", API_KEY ? "API Key Loaded" : "No API Key");

function formatAssetsForAI(assets: Asset[]): string {
  return assets.map(asset => {
    const value = asset.quantity * asset.currentPrice;
    return `- ${asset.name} (${asset.ticker}): ${asset.quantity}주, 현재가 ${asset.currentPrice.toLocaleString()}원, 평가액 ${value.toLocaleString()}원`;
  }).join('\n');
}

// =================================================================
// 2. Gemini API (SDK 없이 직접 fetch 호출 - 호환성 문제 해결)
// =================================================================
async function callGeminiAPI(prompt: string, isJson: boolean = false): Promise<string> {
    if (!API_KEY) return "";

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: isJson ? { responseMimeType: "application/json" } : undefined
            })
        });

        if (!response.ok) {
            console.error(`Gemini API Error: ${response.status}`);
            return "";
        }

        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } catch (error) {
        console.error("Gemini Fetch Failed:", error);
        return "";
    }
}

// =================================================================
// 3. 종목 검색
// =================================================================
const searchCache = new Map<string, SymbolSearchResult[]>();

export async function searchSymbols(query: string): Promise<SymbolSearchResult[]> {
    const cacheKey = query.toLowerCase();
    if (searchCache.has(cacheKey)) return searchCache.get(cacheKey)!;

    if (!API_KEY) return [];

    const prompt = `사용자가 "${query}"(으)로 종목을 검색 중입니다. 가장 관련성 높은 주식, 코인, ETF 5개를 추천해주세요. 
    반드시 아래 JSON 포맷으로만 응답하세요. 설명 금지.
    [{"ticker":"티커","name":"이름","exchange":"거래소"}]`;

    const jsonText = await callGeminiAPI(prompt, true);
    try {
        const results = JSON.parse(jsonText || "[]");
        searchCache.set(cacheKey, results);
        return results;
    } catch {
        return [];
    }
}

// =================================================================
// 4. 포트폴리오 분석 (채팅)
// =================================================================
export const askPortfolioQuestion = async (assets: Asset[], question: string): Promise<string> => {
    return analyzePortfolio(assets, question);
};

export async function analyzePortfolio(assets: Asset[], message: string): Promise<string> {
    if (!API_KEY) return "API 키가 설정되지 않았습니다.";
    const data = formatAssetsForAI(assets);
    const prompt = `당신은 금융 AI 비서입니다. 
    포트폴리오: ${data}
    사용자 질문: ${message}
    친절하게 답변해주세요.`;
    
    const response = await callGeminiAPI(prompt);
    return response || "죄송합니다. 답변을 생성할 수 없습니다.";
}

// =================================================================
// 5. 암호화폐 시세 (Upbit - 없는 코인 제거하여 404 방지)
// =================================================================
const cryptoCache = new Map<string, { price: number; prevClose: number }>();
let lastCryptoFetch = 0;
let cryptoFetchPromise: Promise<void> | null = null;

// [중요] 업비트 원화 마켓에 확실히 존재하는 코인만 남김 (USDC 등 제거)
const SAFE_COINS = ['BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA', 'TRX', 'SHIB', 'LINK', 'EOS', 'SAND', 'MANA', 'AVAX', 'MATIC', 'ETC'];

async function refreshCryptoCache() {
    const now = Date.now();
    if (cryptoFetchPromise) return cryptoFetchPromise;
    if (now - lastCryptoFetch < 10000 && cryptoCache.size > 0) return;

    cryptoFetchPromise = (async () => {
        try {
            const markets = SAFE_COINS.map(c => `KRW-${c}`).join(',');
            const res = await fetch(`https://api.upbit.com/v1/ticker?markets=${markets}`);
            if (res.ok) {
                const data = await res.json();
                data.forEach((item: any) => {
                    const ticker = item.market.replace('KRW-', '');
                    cryptoCache.set(ticker, { price: item.trade_price, prevClose: item.prev_closing_price });
                });
                lastCryptoFetch = Date.now();
            }
        } catch (e) {
            console.warn("Upbit update failed");
        } finally {
            cryptoFetchPromise = null;
        }
    })();
    return cryptoFetchPromise;
}

async function fetchCryptoPrice(ticker: string) {
    const t = ticker.toUpperCase().replace('KRW-', '');
    await refreshCryptoCache();
    return cryptoCache.get(t) || { price: 0, prevClose: 0 };
}

// =================================================================
// 6. 주식 시세 (Gemini 모의 데이터)
// =================================================================
const stockCache = new Map<string, any>();

async function fetchStockPrice(ticker: string, exchange: string) {
    const key = `${ticker}-${exchange}`;
    if (stockCache.has(key)) return stockCache.get(key);

    const prompt = `"${exchange}"의 "${ticker}" 현재가와 전일종가를 JSON으로 주세요. {"price":100,"prevClose":90}`;
    const jsonText = await callGeminiAPI(prompt, true);
    
    try {
        const result = JSON.parse(jsonText);
        if (result.price) {
            stockCache.set(key, result);
            return result;
        }
    } catch {}
    return null;
}

// =================================================================
// 7. 환율 및 메인 함수
// =================================================================
export const fetchCurrentExchangeRate = async (from: string, to: string) => (from === 'USD' ? 1450 : 1);
export const fetchHistoricalExchangeRate = async (date: string, from: string, to: string) => 1450;

export interface AssetDataResult {
  name: string; priceOriginal: number; priceKRW: number; currency: string; 
  pricePreviousClose: number; highestPrice?: number; isMocked: boolean;
}

export const fetchAssetData = async (ticker: string, exchange: string, currencyInput?: any): Promise<AssetDataResult> => {
  const upperTicker = ticker.toUpperCase().replace('KRW-', '');
  const currency = currencyInput || 'KRW';
  let priceData = null;
  let isMocked = false;

  const isCrypto = ['업비트', 'COIN', 'CRYPTO'].some(k => exchange.toUpperCase().includes(k));

  if (isCrypto) {
      priceData = await fetchCryptoPrice(upperTicker);
  } else {
      priceData = await fetchStockPrice(upperTicker, exchange);
      isMocked = true;
  }

  // 데이터 없으면 0 리턴 (앱 멈춤 방지)
  if (!priceData || !priceData.price) {
      return { name: ticker, priceOriginal: 0, priceKRW: 0, currency, pricePreviousClose: 0, highestPrice: 0, isMocked };
  }

  const rate = currency === 'USD' ? 1450 : 1;
  const currentPriceKRW = priceData.price * rate;

  return {
      name: ticker,
      priceOriginal: priceData.price,
      priceKRW: currentPriceKRW,
      currency,
      pricePreviousClose: priceData.prevClose * rate,
      highestPrice: currentPriceKRW * 1.1,
      isMocked
  };
};