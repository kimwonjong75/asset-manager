import { GoogleGenAI } from '@google/genai';
import { Asset, Currency, SymbolSearchResult, normalizeExchange, AssetDataResult } from '../types';

// =================================================================
// 1. 설정 및 초기화
// =================================================================
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

console.log("Gemini Service Status:", API_KEY ? "✅ API Key Loaded" : "❌ No API Key");

// =================================================================
// 2. 캐싱 시스템 (API 호출 횟수 감소)
// =================================================================
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL = 5 * 60 * 1000; // 5분
const priceCache = new Map<string, CacheEntry<AssetDataResult>>();
const searchCache = new Map<string, CacheEntry<SymbolSearchResult[]>>();
const exchangeRateCache = new Map<string, CacheEntry<number>>();

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data;
  }
  cache.delete(key);
  return null;
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

// =================================================================
// 3. Rate Limiting (API 차단 방지)
// =================================================================
const requestQueue: Array<() => Promise<void>> = [];
let isProcessing = false;
const MIN_REQUEST_INTERVAL = 500; // 0.5초 간격

async function processQueue(): Promise<void> {
  if (isProcessing || requestQueue.length === 0) return;
  
  isProcessing = true;
  while (requestQueue.length > 0) {
    const request = requestQueue.shift();
    if (request) {
      await request();
      await delay(MIN_REQUEST_INTERVAL);
    }
  }
  isProcessing = false;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =================================================================
// 4. Gemini API 호출 (SDK 방식 - 안정적)
// =================================================================
async function callGeminiWithSearch(prompt: string): Promise<string> {
  if (!ai) {
    console.error("Gemini AI not initialized");
    return "";
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      }
    });

    const text = response.text?.trim() || "";
    // JSON 블록 정리
    return text.replace(/^```json\s*|```$/g, '').trim();
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "";
  }
}

async function callGeminiBasic(prompt: string): Promise<string> {
  if (!ai) {
    console.error("Gemini AI not initialized");
    return "";
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text?.trim() || "";
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "";
  }
}

// =================================================================
// 5. 종목 검색
// =================================================================
export async function searchSymbols(query: string): Promise<SymbolSearchResult[]> {
  const cacheKey = query.toLowerCase();
  const cached = getCached(searchCache, cacheKey);
  if (cached) return cached;

  if (!ai) return [];

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
    const jsonText = await callGeminiWithSearch(prompt);
    const parsed = JSON.parse(jsonText || "[]");
    const isItem = (x: unknown): x is SymbolSearchResult => {
      return !!x && typeof (x as SymbolSearchResult).ticker === 'string' &&
        typeof (x as SymbolSearchResult).name === 'string' &&
        typeof (x as SymbolSearchResult).exchange === 'string';
    };
    const results: SymbolSearchResult[] = Array.isArray(parsed) ? parsed.filter(isItem) : [];
    setCache(searchCache, cacheKey, results);
    return results;
  } catch (error) {
    console.error(`Search failed for "${query}":`, error);
    return [];
  }
}

// =================================================================
// 6. 단일 자산 시세 조회
// =================================================================

export const fetchAssetData = async (
  ticker: string, 
  exchange: string, 
  currencyInput?: Currency
): Promise<AssetDataResult> => {
  const normalizedExchange = normalizeExchange(exchange);
  const cacheKey = `${ticker}-${exchange}`;
  const cached = getCached(priceCache, cacheKey);
  if (cached) {
    console.log(`📦 Cache hit: ${ticker}`);
    return cached;
  }

  if (!ai) {
    return createMockResult(ticker);
  }

  const prompt = `Using Google Search, find the following data for the asset with ticker "${ticker}" listed on the "${normalizedExchange}" exchange.
Use EXACT ticker match ("${ticker}"). If the exchange is NYSE American/AMEX, treat them as synonyms.
Do NOT return data for similarly named tickers:
1. The closing price for the MOST RECENT trading day.
1. The closing price for the MOST RECENT trading day.
2. The closing price for the PREVIOUS trading day (the day before the most recent one).
3. Its official name in Korean.

Return the response ONLY as a JSON object with these keys:
- "name": Official Korean name.
- "priceOriginal": Most recent closing price in native currency.
- "previousClose": Previous trading day's closing price in native currency.
- "currency": ISO 4217 currency code (e.g., USD, KRW, JPY).
- "priceKRW": Most recent closing price converted to Korean Won (KRW).

Example for AAPL (NASDAQ):
{
  "name": "애플",
  "priceOriginal": 215.50,
  "previousClose": 214.00,
  "currency": "USD",
  "priceKRW": 295000
}

Ensure all prices are numbers. Return ONLY the JSON object.`;

  try {
    const jsonText = await callGeminiWithSearch(prompt);
    const data = JSON.parse(jsonText || "{}");

    const priceOriginal = Number(data.priceOriginal) || 0;
    const priceKRW = Number(data.priceKRW) || 0;
    const previousClose = Number(data.previousClose) || priceOriginal;

    if (priceOriginal === 0 && priceKRW === 0) {
      throw new Error('Invalid price data');
    }

    const result: AssetDataResult = {
      name: data.name || ticker,
      priceOriginal,
      priceKRW,
      currency: data.currency || 'KRW',
      previousClosePrice: previousClose,
      highestPrice: priceKRW * 1.1,
      isMocked: false
    };

    setCache(priceCache, cacheKey, result);
    console.log(`✅ Fetched: ${ticker} = ${priceKRW.toLocaleString()} KRW`);
    return result;
  } catch (error) {
    console.error(`❌ Failed to fetch ${ticker}:`, error);
    return createMockResult(ticker);
  }
};

function createMockResult(ticker: string): AssetDataResult {
  return {
    name: ticker,
    priceOriginal: 0,
    priceKRW: 0,
    currency: Currency.KRW,
    previousClosePrice: 0,
    highestPrice: 0,
    isMocked: true
  };
}

// =================================================================
// 7. 배치 시세 조회 (핵심 성능 개선!)
// =================================================================
export const fetchBatchAssetPrices = async (
  assets: { ticker: string; exchange: string; id: string }[]
): Promise<Map<string, AssetDataResult>> => {
  const resultMap = new Map<string, AssetDataResult>();
  
  if (assets.length === 0) return resultMap;
  if (!ai) {
    assets.forEach(a => resultMap.set(a.id, createMockResult(a.ticker)));
    return resultMap;
  }

  // 캐시 확인 - 캐시에 있는 것들은 바로 반환
  const uncachedAssets: typeof assets = [];
  for (const asset of assets) {
    const cacheKey = `${asset.ticker}-${asset.exchange}`;
    const cached = getCached(priceCache, cacheKey);
    if (cached) {
      resultMap.set(asset.id, cached);
      console.log(`📦 Cache hit: ${asset.ticker}`);
    } else {
      uncachedAssets.push(asset);
    }
  }

  if (uncachedAssets.length === 0) {
    return resultMap;
  }

  // 배치 크기 제한 (한 번에 최대 10개)
  const BATCH_SIZE = 10;
  const batches: typeof assets[] = [];
  
  for (let i = 0; i < uncachedAssets.length; i += BATCH_SIZE) {
    batches.push(uncachedAssets.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    const batchResults = await fetchBatchInternal(batch);
    batchResults.forEach((value, key) => {
      resultMap.set(key, value);
    });
    
    // 배치 간 딜레이
    if (batches.length > 1) {
      await delay(1000);
    }
  }

  return resultMap;
};

interface BatchItem {
  id: string;
  name?: string;
  priceKRW: number;
  priceOriginal?: number;
  previousClose?: number;
  currency?: string;
}

async function fetchBatchInternal(
  assets: { ticker: string; exchange: string; id: string }[]
): Promise<Map<string, AssetDataResult>> {
  const resultMap = new Map<string, AssetDataResult>();

  const assetsListString = assets
    .map(a => `{"ticker": "${a.ticker}", "exchange": "${normalizeExchange(a.exchange)}", "id": "${a.id}"}`)
    .join(',\n');

  const prompt = `I have a list of assets. Using Google Search, find the following for EACH asset:
1. Closing price of the MOST RECENT trading day.
2. Closing price of the PREVIOUS trading day (Previous Close).

Assets List:
[
${assetsListString}
]

Use EXACT ticker matches. If the exchange is NYSE American/AMEX, treat them as synonyms.
Return the response ONLY as a JSON ARRAY of objects. Each object must strictly follow this structure:
{
  "id": "The exact id provided in the input",
  "name": "The official Korean name of the asset",
  "priceOriginal": Number (recent close in native currency),
  "previousClose": Number (previous close in native currency),
  "currency": "ISO 4217 currency code (e.g. USD, KRW, JPY)",
  "priceKRW": Number (recent close converted to Korean Won)
}

Ensure all prices are numbers. Do not miss any assets. Return ONLY the JSON array.`;

  try {
    const jsonText = await callGeminiWithSearch(prompt);
    const data = JSON.parse(jsonText || "[]");

    if (!Array.isArray(data)) {
      throw new Error('Batch API did not return an array.');
    }

    data.forEach((item: BatchItem) => {
      if (item.id && typeof item.priceKRW === 'number') {
        const result: AssetDataResult = {
          name: item.name || '',
          priceKRW: item.priceKRW,
          priceOriginal: item.priceOriginal || item.priceKRW,
          previousClosePrice: item.previousClose || item.priceOriginal || item.priceKRW,
          currency: (item.currency as Currency) || Currency.KRW,
          highestPrice: item.priceKRW * 1.1,
          isMocked: false
        };
        
        resultMap.set(item.id, result);
        
        // 개별 캐시에도 저장
        const asset = assets.find(a => a.id === item.id);
        if (asset) {
          const cacheKey = `${asset.ticker}-${asset.exchange}`;
          setCache(priceCache, cacheKey, result);
        }
        
        console.log(`✅ Batch fetched: ${item.name || item.id} = ${item.priceKRW?.toLocaleString()} KRW`);
      }
    });

    // 실패한 자산들은 mock 데이터로 채움
    assets.forEach(asset => {
      if (!resultMap.has(asset.id)) {
        console.warn(`⚠️ Missing in batch result: ${asset.ticker}`);
        resultMap.set(asset.id, createMockResult(asset.ticker));
      }
    });

    return resultMap;
  } catch (error) {
    console.error('❌ Batch fetch failed:', error);
    // 전체 실패 시 개별 조회로 폴백
    for (const asset of assets) {
      try {
        const singleResult = await fetchAssetData(asset.ticker, asset.exchange);
        resultMap.set(asset.id, singleResult);
        await delay(500);
      } catch {
        resultMap.set(asset.id, createMockResult(asset.ticker));
      }
    }
    return resultMap;
  }
}

// =================================================================
// 8. 환율 조회
// =================================================================
export const fetchCurrentExchangeRate = async (
  fromCurrency: string, 
  toCurrency: string
): Promise<number> => {
  if (fromCurrency === toCurrency) return 1;

  const cacheKey = `${fromCurrency}-${toCurrency}`;
  const cached = getCached(exchangeRateCache, cacheKey);
  if (cached) return cached;

  if (!ai) return getDefaultExchangeRate(fromCurrency, toCurrency);

  const prompt = `Using Google Search, what was the closing exchange rate for the most recent business day between ${fromCurrency} and ${toCurrency}?
Return the response ONLY as a JSON object with a single key "rate".
The value should be a number representing how many ${toCurrency} one ${fromCurrency} is worth.
For example, for USD to KRW, the response should be:
{
  "rate": 1380.25
}
Do not include any other text, symbols, or explanations. Your final output must be only the JSON object.`;

  try {
    const jsonText = await callGeminiWithSearch(prompt);
    const data = JSON.parse(jsonText || "{}");

    if (typeof data.rate !== 'number') {
      throw new Error('Invalid rate format');
    }

    setCache(exchangeRateCache, cacheKey, data.rate);
    console.log(`💱 Exchange rate ${fromCurrency}→${toCurrency}: ${data.rate}`);
    return data.rate;
  } catch (error) {
    console.error(`Failed to fetch exchange rate ${fromCurrency}→${toCurrency}:`, error);
    return getDefaultExchangeRate(fromCurrency, toCurrency);
  }
};

export const fetchHistoricalExchangeRate = async (
  date: string, 
  fromCurrency: string, 
  toCurrency: string
): Promise<number> => {
  if (fromCurrency === toCurrency) return 1;
  if (!ai) return getDefaultExchangeRate(fromCurrency, toCurrency);

  const prompt = `Using Google Search, what was the exchange rate between ${fromCurrency} and ${toCurrency} at the end of the day on ${date}?
Return the response ONLY as a JSON object with a single key "rate".
The value should be a number representing how many ${toCurrency} one ${fromCurrency} was worth.
For example, for USD to KRW, the response should be:
{
  "rate": 1350.5
}
Do not include any other text, symbols, or explanations. Your final output must be only the JSON object.`;

  try {
    const jsonText = await callGeminiWithSearch(prompt);
    const data = JSON.parse(jsonText || "{}");

    if (typeof data.rate !== 'number') {
      throw new Error('Invalid rate format');
    }

    return data.rate;
  } catch (error) {
    console.error(`Failed to fetch historical exchange rate:`, error);
    return getDefaultExchangeRate(fromCurrency, toCurrency);
  }
};

function getDefaultExchangeRate(from: string, to: string): number {
  // 기본 환율 (폴백용)
  const rates: Record<string, number> = {
    'USD-KRW': 1400,
    'JPY-KRW': 9.5,
    'EUR-KRW': 1500,
    'CNY-KRW': 195,
  };
  return rates[`${from}-${to}`] || 1;
}

// =================================================================
// 9. 포트폴리오 분석 (AI 채팅)
// =================================================================
function formatAssetsForAI(assets: Asset[]): string {
  return assets.map(asset => {
    const value = asset.quantity * asset.currentPrice;
    const displayName = asset.customName ?? asset.name;
    return `- ${displayName} (${asset.ticker}): ${asset.quantity}주, 현재가 ${asset.currentPrice.toLocaleString()}원, 평가액 ${value.toLocaleString()}원, 카테고리: ${asset.category}`;
  }).join('\n');
}

export const askPortfolioQuestion = async (
  assets: Asset[], 
  question: string
): Promise<string> => {
  if (!ai) return "API 키가 설정되지 않았습니다.";

  const simplifiedAssets = assets.map(asset => ({
    name: asset.customName ?? asset.name,
    ticker: asset.ticker,
    exchange: asset.exchange,
    category: asset.category,
    quantity: asset.quantity,
    purchase_price_original: asset.purchasePrice,
    purchase_date: asset.purchaseDate,
    current_price_krw: asset.currentPrice,
    price_original: asset.priceOriginal,
    currency: asset.currency,
    current_value_krw: asset.currentPrice * asset.quantity,
    highest_price_krw: asset.highestPrice,
    yesterday_price_krw: asset.previousClosePrice ?? null,
  }));

  const portfolioJson = JSON.stringify(simplifiedAssets, null, 2);

  const prompt = `당신은 사용자의 자산 포트폴리오를 분석하고 질문에 답변하는 전문 금융 어시스턴트입니다.
    
다음은 사용자의 현재 포트폴리오 데이터입니다 (JSON 형식). 각 항목에는 현재가와 함께 어제 종가가 포함될 수 있으므로, "어제 대비" 변동을 계산할 때는 \`yesterday_price_krw\`를 사용하세요. 날짜 메타가 없으면 제공된 값만으로 판단하세요:
\`\`\`json
${portfolioJson}
\`\`\`

위 데이터를 기반으로 다음 사용자의 질문에 대해 명확하고 간결하게 답변해주세요. 답변은 한국어로 작성하고, 마크다운 형식을 사용하여 가독성을 높여주세요. 외부 정보는 사용하지 말고, 제공된 포트폴리오 데이터만을 근거로 분석해야 합니다.

사용자 질문: "${question}"`;

  try {
    const response = await callGeminiBasic(prompt);
    return response || "죄송합니다. 답변을 생성할 수 없습니다.";
  } catch (error) {
    console.error('Portfolio question error:', error);
    return "포트폴리오 질문에 대한 답변 생성에 실패했습니다.";
  }
};

// 레거시 호환용
export const analyzePortfolio = askPortfolioQuestion;

// =================================================================
// 10. 캐시 관리 유틸리티
// =================================================================
export function clearPriceCache(): void {
  priceCache.clear();
  console.log("🗑️ Price cache cleared");
}

export function clearAllCaches(): void {
  priceCache.clear();
  searchCache.clear();
  exchangeRateCache.clear();
  console.log("🗑️ All caches cleared");
}

export function getCacheStats(): { prices: number; searches: number; rates: number } {
  return {
    prices: priceCache.size,
    searches: searchCache.size,
    rates: exchangeRateCache.size
  };
}
