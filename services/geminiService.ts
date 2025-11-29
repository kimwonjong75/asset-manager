import { Asset, Currency, SymbolSearchResult } from '../types';

// =================================================================
// 1. 유틸리티 및 설정
// =================================================================
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

console.log("Service Status:", API_KEY ? "API Key Loaded" : "No API Key");

function formatAssetsForAI(assets: Asset[]): string {
  return assets.map(asset => {
    const value = asset.quantity * asset.currentPrice;
    return `- ${asset.name} (${asset.ticker}): ${asset.quantity}주, 현재가 ${asset.currentPrice.toLocaleString()}원, 평가액 ${value.toLocaleString()}원`;
  }).join('\n');
}

// =================================================================
// 2. Gemini API (최종 REST 호출 경로 수정)
// =================================================================
async function callGeminiAPI(prompt: string, isJson: boolean = false): Promise<string> {
    if (!API_KEY) return "";

    // [핵심 수정] URL을 모델 이름만 지정하는 방식으로 변경하여 404 에러 회피
    // (모델 이름 앞에 models/ 접두사를 붙이는 방식이 원인일 가능성이 높습니다.)
    // v1 엔드포인트를 사용합니다.
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;
    
    const bodyPayload = {
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: isJson ? { responseMimeType: "application/json" } : undefined
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyPayload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error(`Gemini API Error ${response.status}:`, errorData);
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

    const prompt = `Find 5 active stock or crypto symbols matching "${query}".
    Return ONLY a JSON array.
    Format: [{"ticker": "Symbol", "name": "Name (Korean preferred)", "exchange": "Exchange Name"}]`;

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
    const prompt = `You are a financial AI assistant.
    User Portfolio: ${data}
    User Question: ${message}
    Answer in Korean kindly.`;
    
    const response = await callGeminiAPI(prompt);
    return response || "죄송합니다. 답변을 생성할 수 없습니다.";
}

// =================================================================
// 5. 통합 시세 조회 (Google 검색으로 처리)
// =================================================================
export interface AssetDataResult {
  name: string; priceOriginal: number; priceKRW: number; currency: string; 
  pricePreviousClose: number; highestPrice?: number; isMocked: boolean;
}

export const fetchAssetData = async (ticker: string, exchange: string, currencyInput?: any): Promise<AssetDataResult> => {
    const prompt = `Search specifically for the most recent market data for "${ticker}" on "${exchange}".
    Required:
    1. Most recent price (Original Currency).
    2. Most recent price (KRW).
    3. Previous close (Original Currency).
    4. Currency Code.
    
    Return ONLY JSON:
    {
      "name": "Asset Name",
      "priceOriginal": Number,
      "priceKRW": Number,
      "previousClose": Number,
      "currency": "String"
    }`;

    const jsonText = await callGeminiAPI(prompt, true);

    try {
        const data = JSON.parse(jsonText || "{}");
        
        const priceOriginal = Number(data.priceOriginal) || 0;
        const priceKRW = Number(data.priceKRW) || 0;
        const previousClose = Number(data.previousClose) || priceOriginal;
        
        return {
            name: data.name || ticker,
            priceOriginal: priceOriginal,
            priceKRW: priceKRW,
            currency: data.currency || 'KRW',
            pricePreviousClose: previousClose,
            highestPrice: priceKRW * 1.1, 
            isMocked: false
        };
    } catch (e) {
        return {
            name: ticker, priceOriginal: 0, priceKRW: 0, currency: 'KRW',
            pricePreviousClose: 0, highestPrice: 0, isMocked: true
        };
    }
};

// =================================================================
// 6. 환율
// =================================================================
export const fetchCurrentExchangeRate = async (from: string, to: string): Promise<number> => {
    if (from === to) return 1;
    const prompt = `Current exchange rate ${from} to ${to}? Return JSON: {"rate": Number}`;
    const jsonText = await callGeminiAPI(prompt, true);
    try {
        const data = JSON.parse(jsonText);
        return Number(data.rate) || 1450;
    } catch {
        return 1450;
    }
};

export const fetchHistoricalExchangeRate = async (date: string, from: string, to: string) => {
    return fetchCurrentExchangeRate(from, to);
};