import { GoogleGenAI } from '@google/genai';
import { Asset, Currency, SymbolSearchResult, normalizeExchange } from '../types';
import { AssetDataResult } from '../types/api';
import {
  fetchStockHistoricalPrices,
  fetchCryptoHistoricalPrices,
  convertTickerForAPI,
  isCryptoExchange,
} from './historicalPriceService';
import { calculateSMA, calculateRSI, getRequiredHistoryDays } from '../utils/maCalculations';

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

// 특수 종목 정의 (백엔드 전용 코드)
const SPECIAL_ASSETS: SymbolSearchResult[] = [
  {
    ticker: 'KRX-GOLD',
    name: 'KRX 금현물',
    exchange: 'KRX (코스피/코스닥)',
  },
];

// 특수 종목 검색 키워드 매핑
function findSpecialAsset(query: string): SymbolSearchResult | null {
  const q = query.toLowerCase().trim();
  const goldKeywords = ['금현물', 'krx-gold', 'krx gold', 'gold', 'm04020000', '금', '골드'];

  if (goldKeywords.some(kw => q.includes(kw))) {
    return SPECIAL_ASSETS.find(a => a.ticker === 'KRX-GOLD') || null;
  }

  return null;
}

export async function searchSymbols(query: string): Promise<SymbolSearchResult[]> {
  const cacheKey = query.toLowerCase();
  const cached = getCached(searchCache, cacheKey);
  if (cached) return cached;

  // 특수 종목 우선 검색 (KRX 금현물 등)
  const specialAsset = findSpecialAsset(query);
  if (specialAsset) {
    const results = [specialAsset];
    setCache(searchCache, cacheKey, results);
    return results;
  }

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
// 8. 포트폴리오 분석 (AI 채팅)
// =================================================================

// 기술적 분석 키워드 감지
const TECHNICAL_KEYWORDS = [
  '이평선', '이동평균', 'MA', 'ma', '정배열', '역배열',
  '골든크로스', '데드크로스', 'RSI', 'rsi', '과매수', '과매도',
  '기술적', '차트', '매매신호', '시그널', 'signal',
  '단기', '장기', '추세', '지지', '저항',
];

function containsTechnicalKeywords(question: string): boolean {
  return TECHNICAL_KEYWORDS.some(kw => question.includes(kw));
}

/**
 * 기술적 질문 시 과거 시세를 직접 fetch하여 지표 계산
 */
const MA_PERIODS = [5, 10, 20, 60, 120, 200];
const RSI_PERIOD = 14;

interface TechnicalIndicators {
  ma: Record<number, number | null>;
  prevMa: Record<number, number | null>;
  rsi: number | null;
  prevRsi: number | null;
}

async function fetchTechnicalIndicators(
  assets: Asset[]
): Promise<Map<string, TechnicalIndicators>> {
  const result = new Map<string, TechnicalIndicators>();
  if (assets.length === 0) return result;

  try {
    const days = getRequiredHistoryDays(200);
    const endDate = new Date().toISOString().split('T')[0];
    const startD = new Date();
    startD.setDate(startD.getDate() - days);
    const startDate = startD.toISOString().split('T')[0];

    const stockTickers: { asset: Asset; apiTicker: string }[] = [];
    const cryptoTickers: { asset: Asset; apiTicker: string }[] = [];

    for (const asset of assets) {
      // 현금은 기술적 분석 불필요
      if (asset.category === '현금') continue;
      const apiTicker = convertTickerForAPI(asset.ticker, asset.exchange, asset.category);
      if (isCryptoExchange(asset.exchange)) {
        cryptoTickers.push({ asset, apiTicker });
      } else {
        stockTickers.push({ asset, apiTicker });
      }
    }

    const [stockResults, cryptoResults] = await Promise.all([
      stockTickers.length > 0
        ? fetchStockHistoricalPrices(stockTickers.map(t => t.apiTicker), startDate, endDate)
        : Promise.resolve({}),
      cryptoTickers.length > 0
        ? fetchCryptoHistoricalPrices(cryptoTickers.map(t => t.apiTicker), startDate, endDate)
        : Promise.resolve({}),
    ]);

    const allItems = [
      ...stockTickers.map(t => ({ ...t, results: stockResults })),
      ...cryptoTickers.map(t => ({ ...t, results: cryptoResults })),
    ];

    for (const { asset, apiTicker, results } of allItems) {
      const entry = results[apiTicker] || results[Object.keys(results).find(k => k === apiTicker) || ''];
      const priceData = entry?.data;
      if (!priceData || Object.keys(priceData).length === 0) continue;

      const sortedDates = Object.keys(priceData).sort();
      const sortedPrices = sortedDates.map(date => ({ date, price: priceData[date] }));

      const ma: Record<number, number | null> = {};
      const prevMa: Record<number, number | null> = {};
      for (const period of MA_PERIODS) {
        const smaValues = calculateSMA(sortedPrices, period);
        const lastIdx = smaValues.length - 1;
        ma[period] = lastIdx >= 0 ? smaValues[lastIdx] : null;
        prevMa[period] = lastIdx >= 1 ? smaValues[lastIdx - 1] : null;
      }

      const rsiValues = calculateRSI(sortedPrices, RSI_PERIOD);
      const lastRsiIdx = rsiValues.length - 1;
      const rsi = lastRsiIdx >= 0 ? rsiValues[lastRsiIdx] : null;
      const prevRsi = lastRsiIdx >= 1 ? rsiValues[lastRsiIdx - 1] : null;

      result.set(asset.ticker, { ma, prevMa, rsi, prevRsi });
    }
  } catch (err) {
    console.error('[fetchTechnicalIndicators] error:', err);
  }

  return result;
}

export const askPortfolioQuestion = async (
  assets: Asset[],
  question: string
): Promise<string> => {
  if (!ai) return "API 키가 설정되지 않았습니다.";

  const isTechnicalQuestion = containsTechnicalKeywords(question);

  // 기술적 질문이면 과거 시세를 직접 fetch하여 지표 계산
  let enrichedMap: Map<string, TechnicalIndicators> | null = null;
  if (isTechnicalQuestion) {
    enrichedMap = await fetchTechnicalIndicators(assets);
  }

  const hasTechnicalData = enrichedMap && enrichedMap.size > 0;

  const simplifiedAssets = assets.map(asset => {
    const base: Record<string, unknown> = {
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
    };

    // 기술적 질문 시 enriched 지표 추가
    if (hasTechnicalData) {
      const enriched = enrichedMap!.get(asset.ticker);
      if (enriched) {
        const ma = enriched.ma;
        const prevMa = enriched.prevMa;
        base.ma_5 = ma[5] ?? null;
        base.ma_10 = ma[10] ?? null;
        base.ma_20 = ma[20] ?? null;
        base.ma_60 = ma[60] ?? null;
        base.ma_120 = ma[120] ?? null;
        base.ma_200 = ma[200] ?? null;
        base.rsi = enriched.rsi ?? null;

        // 정배열/역배열 (단기MA > 장기MA)
        const shortMa = ma[20];
        const longMa = ma[60];
        if (typeof shortMa === 'number' && typeof longMa === 'number') {
          base.ma_alignment = shortMa > longMa ? '정배열' : '역배열';
        }

        // 골든크로스/데드크로스
        const prevShort = prevMa[20];
        const prevLong = prevMa[60];
        if (typeof shortMa === 'number' && typeof longMa === 'number' &&
            typeof prevShort === 'number' && typeof prevLong === 'number') {
          if (prevShort <= prevLong && shortMa > longMa) {
            base.cross_signal = '골든크로스';
          } else if (prevShort >= prevLong && shortMa < longMa) {
            base.cross_signal = '데드크로스';
          }
        }

        // 현재가 vs 주요 이평선 위치
        const priceForMa = asset.priceOriginal || asset.currentPrice;
        if (typeof shortMa === 'number') {
          base.price_vs_ma20 = priceForMa > shortMa ? '위' : '아래';
        }
        if (typeof longMa === 'number') {
          base.price_vs_ma60 = priceForMa > longMa ? '위' : '아래';
        }
      }
    }

    return base;
  });

  const portfolioJson = JSON.stringify(simplifiedAssets, null, 2);

  const technicalGuide = hasTechnicalData
    ? `\n\n각 종목에는 기술적 지표가 포함되어 있습니다:
- \`ma_5\` ~ \`ma_200\`: 5일~200일 이동평균선 값 (원화가 아닌 해당 종목의 원래 통화 기준)
- \`rsi\`: RSI(14일) 값 (70 이상 과매수, 30 이하 과매도)
- \`ma_alignment\`: 정배열(단기MA>장기MA, 상승추세) 또는 역배열(하락추세)
- \`cross_signal\`: 골든크로스(매수신호) 또는 데드크로스(매도신호) 발생 여부
- \`price_vs_ma20\`, \`price_vs_ma60\`: 현재가가 해당 이평선 대비 위/아래
이 지표들을 적극 활용하여 기술적 관점에서 분석해주세요.`
    : '';

  const prompt = `당신은 사용자의 자산 포트폴리오를 분석하고 질문에 답변하는 전문 금융 어시스턴트입니다.

다음은 사용자의 현재 포트폴리오 데이터입니다 (JSON 형식). 각 항목에는 현재가와 함께 어제 종가가 포함될 수 있으므로, "어제 대비" 변동을 계산할 때는 \`yesterday_price_krw\`를 사용하세요. 날짜 메타가 없으면 제공된 값만으로 판단하세요:${technicalGuide}
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
// 9. 캐시 관리 유틸리티
// =================================================================
export function clearPriceCache(): void {
  priceCache.clear();
  console.log("🗑️ Price cache cleared");
}

export function clearAllCaches(): void {
  priceCache.clear();
  searchCache.clear();
  console.log("🗑️ All caches cleared");
}

export function getCacheStats(): { prices: number; searches: number } {
  return {
    prices: priceCache.size,
    searches: searchCache.size,
  };
}
