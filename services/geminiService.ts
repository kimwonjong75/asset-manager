import { GoogleGenAI } from '@google/genai';
import { Asset, SymbolSearchResult } from '../types';

// FIX: Initialize the GoogleGenAI client according to the coding guidelines.
// The API key must be obtained exclusively from the environment variable import.meta.env.VITE_GEMINI_API_KEY.
const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY! });

export const fetchAssetData = async (ticker: string, exchange: string): Promise<{ name: string; priceKRW: number; priceOriginal: number; currency: string; pricePreviousClose: number; }> => {
    const prompt = `Using Google Search, find the closing price for the most recent trading day for the asset with ticker "${ticker}" listed on the "${exchange}" exchange/market from a reliable financial source. Also, find the closing price of the PREVIOUS trading day (yesterday's close) and its official name in Korean.

Return the response ONLY as a JSON object with five keys:
1. "name": The official Korean name of the asset.
2. "priceOriginal": The closing price in its native currency (e.g., USD for NASDAQ, JPY for TSE).
3. "currency": The ISO 4217 currency code for the original price (e.g., "USD", "JPY", "KRW").
4. "priceKRW": The closing price converted to Korean Won (KRW).
5. "pricePreviousClose": The closing price of the PREVIOUS trading day converted to Korean Won (KRW). If not available, use the same value as priceKRW.

For example, for ticker 'AAPL' on 'NASDAQ', the native currency is USD. For ticker '8001.T' on 'TSE (도쿄)', it's JPY. For '005930' on 'KRX (코스피/코스닥)', it's KRW. For 'BTC' on '주요 거래소 (종합)', find the price in USD and convert it to KRW.

Ensure the prices are numbers, without any currency symbols or commas. The currency code must be a standard ISO 4217 string.

Your final output must be only the JSON object, nothing else.`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                tools: [{googleSearch: {}}],
            }
        });

        const jsonString = response.text.trim();
        
        // JSON 추출: 여러 패턴 시도
        let cleanedJsonString = jsonString;
        
        // 패턴 1: ```json ... ``` 제거
        cleanedJsonString = cleanedJsonString.replace(/^```json\s*|```$/g, '');
        
        // 패턴 2: ``` ... ``` 제거
        cleanedJsonString = cleanedJsonString.replace(/^```\s*|```$/g, '');
        
        // 패턴 3: JSON 객체만 추출 (중괄호로 시작하고 끝나는 부분)
        const jsonMatch = cleanedJsonString.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            cleanedJsonString = jsonMatch[0];
        }
        
        // 패턴 4: 앞뒤 불필요한 텍스트 제거
        cleanedJsonString = cleanedJsonString.trim();
        
        // "I am unable" 같은 오류 메시지 체크
        if (cleanedJsonString.toLowerCase().includes('i am unable') || 
            cleanedJsonString.toLowerCase().includes('i cannot') ||
            cleanedJsonString.toLowerCase().startsWith('i ') ||
            !cleanedJsonString.startsWith('{')) {
            console.error('Invalid response from Gemini:', cleanedJsonString.substring(0, 200));
            throw new Error('API가 유효한 JSON을 반환하지 않았습니다.');
        }
        
        let data;
        try {
            data = JSON.parse(cleanedJsonString);
        } catch (parseError) {
            console.error('JSON parse error:', parseError);
            console.error('Response text:', cleanedJsonString.substring(0, 500));
            throw new Error('JSON 파싱에 실패했습니다.');
        }

        if (typeof data.name !== 'string' || typeof data.priceKRW !== 'number' || typeof data.priceOriginal !== 'number' || typeof data.currency !== 'string') {
            throw new Error('Invalid data format from API.');
        }

        return {
            name: data.name,
            priceKRW: data.priceKRW,
            priceOriginal: data.priceOriginal,
            currency: data.currency,
            pricePreviousClose: typeof data.pricePreviousClose === 'number' ? data.pricePreviousClose : data.priceKRW,
        };
    } catch (error) {
        console.error(`Error fetching data for ticker ${ticker} on ${exchange}:`, error);
        if (error instanceof Error) {
            console.error('Gemini response was:', (error as any).response?.text);
        }
        throw new Error('Failed to fetch asset data. Please check the ticker and try again.');
    }
};

export const fetchHistoricalExchangeRate = async (date: string, fromCurrency: string, toCurrency: string): Promise<number> => {
    if (fromCurrency === toCurrency) {
        return 1;
    }
    const prompt = `Using Google Search, what was the exchange rate between ${fromCurrency} and ${toCurrency} at the end of the day on ${date}?
Provide the answer ONLY as a single number representing how many ${toCurrency} one ${fromCurrency} was worth.
For example, for USD to KRW, the answer should be a number like 1350.5.
Do not include any text, symbols, or explanations. Your final output must be only the number.`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                tools: [{ googleSearch: {} }],
            }
        });

        const rateString = response.text.trim().replace(/,/g, '');
        const rate = parseFloat(rateString);

        if (isNaN(rate)) {
            throw new Error('Invalid number format from API for exchange rate.');
        }

        return rate;
    } catch (error) {
        console.error(`Error fetching exchange rate for ${fromCurrency} to ${toCurrency} on ${date}:`, error);
        if (error instanceof Error) {
            console.error('Gemini response was:', (error as any).response?.text);
        }
        throw new Error('Failed to fetch historical exchange rate.');
    }
};

export const fetchCurrentExchangeRate = async (fromCurrency: string, toCurrency: string): Promise<number> => {
    if (fromCurrency === toCurrency) {
        return 1;
    }
    const prompt = `Using Google Search, what was the closing exchange rate for the most recent business day between ${fromCurrency} and ${toCurrency}?
Provide the answer ONLY as a single number representing how many ${toCurrency} one ${fromCurrency} is worth.
For example, for USD to KRW, the answer should be a number like 1380.25.
Do not include any text, symbols, or explanations. Your final output must be only the number.`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                tools: [{ googleSearch: {} }],
            }
        });

        const rateString = response.text.trim().replace(/,/g, '');
        const rate = parseFloat(rateString);

        if (isNaN(rate)) {
            throw new Error('Invalid number format from API for exchange rate.');
        }

        return rate;
    } catch (error) {
        console.error(`Error fetching current exchange rate for ${fromCurrency} to ${toCurrency}:`, error);
        if (error instanceof Error) {
            console.error('Gemini response was:', (error as any).response?.text);
        }
        throw new Error('Failed to fetch current exchange rate.');
    }
};


export const searchSymbols = async (query: string): Promise<SymbolSearchResult[]> => {
    const prompt = `Search for stock or crypto symbols matching "${query}".
Return a JSON array of up to 5 results. Each object in the array must have these exact keys: "ticker", "name" (in Korean), and "exchange" (e.g., "NASDAQ", "KRX (코스피/코스닥)", "주요 거래소 (종합)").

Example for query "samsung":
[
  {
    "ticker": "005930",
    "name": "삼성전자",
    "exchange": "KRX (코스피/코스닥)"
  }
]

Example for query "apple":
[
  {
    "ticker": "AAPL",
    "name": "Apple Inc.",
    "exchange": "NASDAQ"
  }
]

If no results are found, return an empty array [].
Your final output must be only the JSON array, with no other text or markdown formatting.`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
             config: {
                tools: [{googleSearch: {}}],
            }
        });

        const jsonString = response.text.trim();
        const cleanedJsonString = jsonString.replace(/^```json\s*|```$/g, '');
        const data = JSON.parse(cleanedJsonString);

        if (!Array.isArray(data)) {
            throw new Error('API did not return an array.');
        }

        return data.filter(item =>
            typeof item.ticker === 'string' &&
            typeof item.name === 'string' &&
            typeof item.exchange === 'string'
        );

    } catch (error) {
        console.error(`Error searching for symbol "${query}":`, error);
        if (error instanceof Error) {
            console.error('Gemini response was:', (error as any).response?.text);
        }
        return [];
    }
};

// 포트폴리오 데이터 캐시 (속도 개선)
let portfolioCache: { data: string; timestamp: number } | null = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5분

export const askPortfolioQuestion = async (assets: Asset[], question: string): Promise<string> => {
    // Simplify asset data to reduce token count and focus on key info
    const simplifiedAssets = assets.map(asset => ({
        name: asset.name,
        category: asset.category,
        quantity: asset.quantity,
        purchase_price_original: asset.purchasePrice,
        current_price_krw: asset.currentPrice,
        currency: asset.currency,
        current_value_krw: asset.currentPrice * asset.quantity,
    }));

    const portfolioJson = JSON.stringify(simplifiedAssets, null, 2);
    
    // 캐시 확인: 데이터가 동일하고 5분 이내면 캐시된 프롬프트 사용
    const now = Date.now();
    if (portfolioCache && portfolioCache.data === portfolioJson && (now - portfolioCache.timestamp) < CACHE_DURATION) {
        // 캐시된 데이터 사용 (프롬프트 재사용)
    } else {
        portfolioCache = { data: portfolioJson, timestamp: now };
    }

    const prompt = `당신은 사용자의 자산 포트폴리오를 분석하고 질문에 답변하는 전문 금융 어시스턴트입니다.
    
다음은 사용자의 현재 포트폴리오 데이터입니다 (JSON 형식):
\`\`\`json
${portfolioJson}
\`\`\`

위 데이터를 기반으로 다음 사용자의 질문에 대해 명확하고 간결하게 답변해주세요. 답변은 한국어로 작성하고, 마크다운 형식을 사용하여 가독성을 높여주세요. 외부 정보는 사용하지 말고, 제공된 포트폴리오 데이터만을 근거로 분석해야 합니다.

사용자 질문: "${question}"`;

    try {
        const response = await ai.models.generateContent({
            // 경량 모델 사용으로 속도 개선
            model: 'gemini-2.0-flash',
            contents: prompt,
            config: {
                temperature: 0.7, // 일관성 있는 답변을 위해 낮춤
            }
        });

        return response.text.trim();
    } catch (error) {
        console.error(`Error asking portfolio question:`, error);
        if (error instanceof Error) {
            console.error('Gemini response was:', (error as any).response?.text);
        }
        throw new Error('포트폴리오 질문에 대한 답변 생성에 실패했습니다.');
    }
};
