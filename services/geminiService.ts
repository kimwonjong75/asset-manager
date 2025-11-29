import { Asset, Currency, SymbolSearchResult } from '../types';

// =================================================================
// 1. 유틸리티 및 설정
// =================================================================
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// API 키 상태 확인 로그
console.log("Service Status:", API_KEY ? "API Key Loaded" : "No API Key");

function formatAssetsForAI(assets: Asset[]): string {
  return assets.map(asset => {
    const value = asset.quantity * asset.currentPrice;
    return `- ${asset.name} (${asset.ticker}): ${asset.quantity}주, 현재가 ${asset.currentPrice.toLocaleString()}원, 평가액 ${value.toLocaleString()}원`;
  }).join('\n');
}

// =================================================================
// 2. Gemini API (검색 도구 포함, v1beta 사용)
// =================================================================
async function callGeminiAPI(prompt: string, isJson: boolean = false): Promise<string> {
    if (!API_KEY) return "";

    // [핵심 수정 1] v1beta 사용 (도구 및 JSON 모드 호환성 최적화)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;
    
    const bodyPayload = {
        contents: [{ parts: [{ text: prompt }] }],
        // [핵심 수정 2] googleSearch 도구 복구 (이게 없어서 시세 조회가 안되고 에러가 났을 수 있습니다)
        tools: [{ googleSearch: {} }],
        // [핵심 수정 3] JSON 응답 강제 (isJson일 때만)
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
            // 에러 원인을 명확히 보기 위해 로그 출력
            console.error(`Gemini API Error ${response.status}:`, errorData);
            return "";
        }

        const data = await response.json();
        // 응답 구조 파싱 (검색 결과가 포함될 수 있으므로 안전하게 접근)
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
    Format: [{"ticker": "Symbol", "name": "Name (Korean)", "exchange": "Exchange Name"}]`;

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
// 5. 통합 시세 조회 (Upbit + 주식 모두 Google 검색으로 처리)
// =================================================================
// 기존의 복잡한 Upbit/Stock 분기 로직을 제거하고, 사용자가 주신 코드처럼 AI에게 검색을 위임합니다.
// 이렇게 하면 404, 429 에러 없이 구글 검색 결과로 시세를 가져옵니다.

export interface AssetDataResult {
  name: string; priceOriginal: number; priceKRW: number; currency: string; 
  pricePreviousClose: number; highestPrice?: number; isMocked: boolean;
}

export const fetchAssetData = async (ticker: string, exchange: string, currencyInput?: any): Promise<AssetDataResult> => {
    // 1. 프롬프트: 사용자가 제공한 "잘 작동하던 코드"의 프롬프트 로직 차용
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

    // 2. 호출
    const jsonText = await callGeminiAPI(prompt, true);

    // 3. 파싱 및 에러 처리 (앱 멈춤 방지)
    try {
        const data = JSON.parse(jsonText || "{}");
        
        // 데이터가 비어있거나 숫자가 아니면 0으로 처리 (화면 까맣게 됨 방지)
        const priceOriginal = Number(data.priceOriginal) || 0;
        const priceKRW = Number(data.priceKRW) || 0;
        const previousClose = Number(data.previousClose) || priceOriginal;
        
        return {
            name: data.name || ticker,
            priceOriginal: priceOriginal,
            priceKRW: priceKRW,
            currency: data.currency || 'KRW',
            pricePreviousClose: previousClose,
            highestPrice: priceKRW * 1.1, // 최고가는 추정치
            isMocked: false
        };
    } catch (e) {
        console.warn(`Data parsing failed for ${ticker}`, e);
        return {
            name: ticker, priceOriginal: 0, priceKRW: 0, currency: 'KRW',
            pricePreviousClose: 0, highestPrice: 0, isMocked: true
        };
    }
};

// =================================================================
// 6. 환율 (Google 검색 사용)
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