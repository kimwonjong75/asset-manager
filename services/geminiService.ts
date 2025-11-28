import { GoogleGenerativeAI } from '@google/genai';
import { Asset, Currency, SymbolSearchResult, AssetCategory } from './types';
import { formatAssetForAI, formatAssetsForAI, toKRW } from './utils';

// =================================================================
// Gemini API 설정
// =================================================================
const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("VITE_GEMINI_API_KEY is not set in environment variables");
}
const ai = new GoogleGenerativeAI(apiKey);

// 모델 초기화
const model = ai.getGenerativeModel({ model: "gemini-2.5-flash" });

// =================================================================
// 종목 검색
// =================================================================

let searchCache: Map<string, SymbolSearchResult[]> = new Map();

export async function searchSymbols(query: string): Promise<SymbolSearchResult[]> {
    const cacheKey = query.toLowerCase();
    if (searchCache.has(cacheKey)) {
        return searchCache.get(cacheKey)!;
    }

    try {
        const prompt = `사용자가 자산의 티커(Ticker)나 이름으로 검색하고 있습니다. 검색어는 "${query}"입니다. 자산 관리 앱에서 사용할 수 있도록 가장 관련성이 높은 주식, ETF, 암호화폐, 금현물 종목 5개를 추천해주세요.

결과는 반드시 아래 JSON 형식으로만 응답해야 하며, 다른 텍스트는 포함하지 마세요. 추천 자산이 없다면 빈 배열 \`[]\`을 반환합니다.

[
  {
    "ticker": "종목의 티커(코드). 예: AAPL, 005930, BTC, GLD",
    "name": "종목의 공식 명칭 (한국어 가능)",
    "exchange": "거래소/시장. 예: NASDAQ, KRX (코스피/코스닥), 주요 거래소 (종합), KRX 금시장"
  }
]
`;
        const response = await model.generateContent({
            contents: prompt,
            config: {
                responseMimeType: "application/json",
            }
        });
        
        const jsonText = response.text.trim();
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

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

const chatHistory: ChatMessage[] = [];

export async function analyzePortfolio(assets: Asset[], message: string): Promise<string> {
    if (assets.length === 0) {
        return "현재 포트폴리오에 자산이 없습니다. 자산을 먼저 추가해 주세요.";
    }
    
    // 포트폴리오 데이터를 AI에게 제공하기 위해 포맷
    const portfolioData = formatAssetsForAI(assets);

    // 시스템 프롬프트: AI의 역할과 제공되는 데이터의 형식을 명시
    const systemInstruction = `
당신은 개인 자산 관리 및 투자 조언을 전문으로 하는 금융 AI 어시스턴트입니다.
사용자의 현재 포트폴리오 정보가 CSV 형태로 제공됩니다. 이 정보를 기반으로 사용자의 질문에 답변하고 투자 분석 및 조언을 제공해야 합니다.
답변은 친절하고 전문적인 어투(한국어)로 작성하며, 분석 결과는 명확한 근거와 함께 제시해야 합니다.
포트폴리오 데이터:
${portfolioData}
`;

    // 대화 기록 준비
    const contents = [
        { role: 'system', parts: [{ text: systemInstruction }] },
        ...chatHistory.map(msg => ({ role: msg.role, parts: [{ text: msg.text }] }))
    ];

    try {
        const response = await ai.getGenerativeModel({ 
            model: "gemini-2.5-flash", 
            config: { systemInstruction } 
        }).generateContent({
            contents: [...contents, { role: 'user', parts: [{ text: message }] }],
        });

        const modelResponse = response.text;
        
        // 대화 기록 업데이트
        chatHistory.push({ role: 'user', text: message });
        chatHistory.push({ role: 'model', text: modelResponse });

        return modelResponse;
    } catch (error) {
        console.error("Gemini analysis failed:", error);
        return "죄송합니다. 포트폴리오 분석 중 오류가 발생했습니다. 다시 시도해 주세요.";
    }
}

export function clearChatHistory() {
    chatHistory.length = 0;
}


// =================================================================
// 환율 - Hana Bank API 호출
// =================================================================
let exchangeRateCache: Map<Currency, { rate: number, timestamp: number }> = new Map();
const EXCHANGE_CACHE_DURATION = 3600000; // 1시간 (3,600,000ms)

async function fetchExchangeRate(currency: Currency): Promise<number> {
  if (currency === Currency.KRW) return 1;

  const cached = exchangeRateCache.get(currency);
  if (cached && Date.now() - cached.timestamp < EXCHANGE_CACHE_DURATION) {
    return cached.rate;
  }

  // USD 기준 (Upbit, KRX) 환율 정보 제공
  if (currency === Currency.USD) {
    // 임시: USD/KRW 환율을 가져오는 신뢰할 수 있는 공공 API가 없으므로 임시로 1350으로 설정
    // 실제 배포 시에는 적절한 환율 API(예: 네이버, 구글 환율 검색 API)를 사용해야 합니다.
    const mockRate = 1350; 
    const result = { rate: mockRate, timestamp: Date.now() };
    exchangeRateCache.set(currency, result);
    return mockRate;
  }

  // 다른 통화는 현재 지원하지 않음
  console.warn(`Exchange rate for ${currency} is not supported. Using 0.`);
  return 0;
}


// =================================================================
// 암호화폐 - Upbit 직접 호출 (수정됨: 중복 요청 방지 로직 추가)
// =================================================================
let cryptoCache: Map<string, { price: number; prevClose: number }> = new Map();
let cryptoFetchPromise: Promise<void> | null = null; // 중복 요청 방지용 Promise
let lastCryptoFetch = 0;

// Upbit에서 실제 거래되는 주요 코인만 (목록을 넉넉하게 추가)
// 429 에러 방지를 위해 가급적 이 목록에 있는 코인들은 한 번에 가져오게 합니다.
const UPBIT_COINS = [
  'BTC', 'ETH', 'XRP', 'SOL', 'DOGE', 'ADA', 'TRX', 
  'SHIB', 'LINK', 'EOS', 'SAND', 'MANA', 'APE', 
  'USDT', 'USDC', 'AVAX', 'MATIC', 'ETC', 'BCH' 
];

async function refreshCryptoCache(): Promise<void> {
  const now = Date.now();

  // 1. 이미 요청 중이라면 그 요청이 끝날 때까지 기다림 (핵심 수정)
  if (cryptoFetchPromise) {
    return cryptoFetchPromise; 
  }

  // 2. 최근 10초 내에 갱신되었고 캐시에 데이터가 있다면 재요청 하지 않음
  if (now - lastCryptoFetch < 10000 && cryptoCache.size > 0) {
    return;
  }

  // 3. 새로운 요청 시작: 요청이 완료될 때까지 Promise를 유지하여 중복 호출 방지
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
        console.warn(`Upbit Bulk Fetch Failed: ${res.status}`);
      }
    } catch (e) {
      console.warn('Crypto fetch failed:', e);
    } finally {
      // 요청이 끝나면 Promise 초기화
      cryptoFetchPromise = null;
    }
  })();

  return cryptoFetchPromise; // Promise를 반환하여 호출자가 완료될 때까지 대기하도록 함
}

async function fetchCryptoPrice(ticker: string): Promise<{ price: number; prevClose: number }> {
  const t = ticker.toUpperCase().replace('KRW-', '');
  
  // 1. 캐시 갱신 요청 (이미 진행 중인 요청이 있다면 그 작업이 끝날 때까지 대기함)
  await refreshCryptoCache();
  
  // 2. 캐시에서 찾기
  const cached = cryptoCache.get(t);
  if (cached) {
    return cached;
  }
  
  // 3. 캐시에 없는 경우 (개별 요청)
  // 429 에러 방지를 위해 개별 요청 전 약간의 지연(Throttle)을 줍니다.
  await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));

  try {
    const res = await fetch(`https://api.upbit.com/v1/ticker?markets=KRW-${t}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const item = data[0];
        const result = { price: item.trade_price, prevClose: item.prev_closing_price };
        // 개별 조회한 것도 캐시에 저장
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
// 주식, 금현물 - Gemini에서 제공하는 모의 데이터 호출
// =================================================================

// 모의 데이터 캐시
let stockCache: Map<string, { price: number; prevClose: number } | { price: number; prevClose: number, timestamp: number }> = new Map();
const STOCK_CACHE_DURATION = 600000; // 10분

// 모의 데이터 프롬프트
const STOCK_PRICE_PROMPT = (ticker: string, exchange: string) => `
현재 날짜는 ${new Date().toLocaleDateString('ko-KR')}입니다.
"${exchange}" 시장의 "${ticker}" 종목의 현재가(원화 환산된 가격이 아닌, 해당 시장의 통화 기준)와 전일 종가를 예측하여 JSON 형태로 제공하세요.
예측 가격은 실제 시장 상황을 반영하여 변동성이 있도록 생성해야 합니다.
결과는 반드시 아래 JSON 형식으로만 응답해야 하며, 다른 텍스트는 포함하지 마세요.

{
  "price": 123.45,
  "prevClose": 120.00
}
`;

// fetchStockPrice 함수: 실패 시 null을 반환하도록 수정하여 fetchAssetData의 오류 방지
async function fetchStockPrice(ticker: string, exchange: string): Promise<{ price: number; prevClose: number } | null> {
  const cacheKey = `${ticker}-${exchange}`.toLowerCase();
  
  const cached = stockCache.get(cacheKey) as { price: number; prevClose: number, timestamp: number } | undefined;
  if (cached && Date.now() - cached.timestamp < STOCK_CACHE_DURATION) {
    return { price: cached.price, prevClose: cached.prevClose };
  }

  try {
    const prompt = STOCK_PRICE_PROMPT(ticker, exchange);
    const response = await model.generateContent({
        contents: prompt,
        config: {
            responseMimeType: "application/json",
        }
    });

    const jsonText = response.text.trim();
    const result = JSON.parse(jsonText) as { price: number; prevClose: number };

    if (result.price !== undefined && result.prevClose !== undefined) {
      const cacheResult = { ...result, timestamp: Date.now() };
      stockCache.set(cacheKey, cacheResult);
      return result;
    }
    
    throw new Error('Invalid mock data structure from Gemini.');

  } catch (error) {
    console.error(`Gemini mock price fetch failed for ${ticker} (${exchange}):`, error);
    // 실패 시 null 반환 (핵심 수정)
    return null; 
  }
}


// =================================================================
// 메인 함수
// =================================================================

export interface AssetDataResult {
  priceOriginal: number; // 원래 통화 기준 현재가
  currentPrice: number; // 원화 환산 현재가
  highestPrice: number; // 원화 환산 52주 최고가 (모의값)
  yesterdayClose: number; // 원화 환산 전일 종가
  isMocked: boolean; // 모의 데이터 사용 여부
}

export const fetchAssetData = async (ticker: string, exchange: string, currency: Currency): Promise<AssetDataResult> => {
  const upperTicker = ticker.toUpperCase().replace('KRW-', '');

  // fetchStockPrice 함수의 반환 타입 변경에 맞춰 수정
  let priceData: { price: number; prevClose: number } | null = null;
  let isMocked = false;

  // 암호화폐 판별
  const cryptoKeywords = ['업비트', '종합', '거래소', 'CRYPTO', 'COIN'];
  const isCrypto = cryptoKeywords.some(keyword => exchange.toUpperCase().includes(keyword.toUpperCase()));

  if (isCrypto) {
    // 1. 암호화폐 (Upbit 직접 호출)
    try {
      priceData = await fetchCryptoPrice(upperTicker);
      isMocked = false;
    } catch (e) {
      console.error(`Failed to fetch crypto price for ${upperTicker}:`, e);
      priceData = null; // 안전을 위해 추가
    }
  } else {
    // 2. 주식 및 기타 자산 (Gemini 모의 데이터)
    try {
      priceData = await fetchStockPrice(upperTicker, exchange); 
      isMocked = true;
    } catch (e) {
      console.error(`Failed to fetch mock price for ${upperTicker}:`, e);
      priceData = null; // 안전을 위해 추가
    }
  }

  // priceData가 null인 경우 바로 리턴하여 'price' 속성 참조를 방지 (핵심 수정)
  if (!priceData || priceData.price === 0) {
    return { priceOriginal: 0, currentPrice: 0, highestPrice: 0, yesterdayClose: 0, isMocked };
  }
  
  const exchangeRate = await fetchExchangeRate(currency);
  
  const currentPriceKRW = priceData.price * exchangeRate;
  const prevCloseKRW = priceData.prevClose * exchangeRate;
  
  // 52주 최고가는 모의 데이터 생성 (현재가보다 10% 이내에서 랜덤하게 높게 설정)
  const highestPriceKRW = currentPriceKRW * (1 + (Math.random() * 0.1));

  return {
    priceOriginal: priceData.price,
    currentPrice: currentPriceKRW,
    highestPrice: highestPriceKRW,
    yesterdayClose: prevCloseKRW,
    isMocked: isMocked,
  };
};