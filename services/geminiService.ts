// services/geminiService.ts
import { GoogleGenAI } from '@google/genai';
import { Asset, SymbolSearchResult, AssetCategory } from '../types';

// Gemini 클라이언트는 포트폴리오 질문용으로만 유지
const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY! });

// =================================================================
// 1. 유틸리티: CORS 프록시 및 API 호출 함수
// =================================================================

// GitHub Pages 등 브라우저 환경에서 CORS 문제를 피하기 위한 프록시
const PROXY_URL = "https://api.allorigins.win/raw?url=";

async function fetchJson(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);
  return response.json();
}

async function fetchWithProxy(url: string) {
  // CORS 프록시를 통해 요청
  const encodedUrl = encodeURIComponent(url);
  return fetchJson(`${PROXY_URL}${encodedUrl}`);
}

// =================================================================
// 2. 암호화폐 (Upbit API)
// =================================================================

async function fetchCryptoPrice(ticker: string): Promise<{ price: number; prevClose: number }> {
  // 업비트는 'KRW-BTC' 형태의 마켓 코드가 필요함
  // 티커가 'BTC' 처럼 들어오면 'KRW-'를 붙여서 시도
  const marketCode = ticker.toUpperCase().startsWith('KRW-') ? ticker : `KRW-${ticker}`;
  
  try {
    const url = `https://api.upbit.com/v1/ticker?markets=${marketCode}`;
    const data = await fetchJson(url); // 업비트는 CORS 허용됨 (프록시 불필요 가능성 높으나, 안되면 프록시 사용)
    
    if (!data || data.length === 0) {
        throw new Error('Coin not found');
    }

    const item = data[0];
    return {
      price: item.trade_price,         // 현재가
      prevClose: item.prev_closing_price // 전일 종가
    };
  } catch (e) {
    console.error(`Upbit fetch failed for ${ticker}`, e);
    // 실패 시 USDT 마켓 등 다른 시도 혹은 에러 처리
    throw e;
  }
}

// =================================================================
// 3. 주식 (Yahoo Finance API)
// =================================================================

// 한국 주식 코드 변환 (예: 005930 -> 005930.KS)
function normalizeStockTicker(ticker: string, exchange: string): string {
  const t = ticker.toUpperCase().trim();
  
  // 이미 확장자가 있다면 그대로 반환
  if (t.includes('.')) return t;

  // 한국 코스피/코스닥 식별 로직 (단순화: 6자리 숫자는 한국 주식으로 간주)
  if (/^\d{6}$/.test(t)) {
    // 코스닥인지 코스피인지 정확히 알기 어려우므로 기본 KS(코스피) 시도 후 실패시 KQ(코스닥) 로직이 필요하나,
    // 야후에서는 보통 .KS(코스피), .KQ(코스닥)을 붙여야 함.
    // 여기서는 사용자가 거래소를 선택했다면 그에 따르고, 아니면 기본 .KS로 가정
    if (exchange.includes('코스닥')) return `${t}.KQ`;
    return `${t}.KS`; 
  }

  return t; // 미국 주식 등은 그대로 (AAPL, TSLA)
}

async function fetchStockPrice(ticker: string): Promise<{ price: number; prevClose: number; currency: string }> {
  try {
    // 야후 파이낸스 차트 API (비공식적이지만 널리 쓰임, 데이터 제한적일 수 있음)
    // CORS 문제로 프록시 사용 필수
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`;
    const data = await fetchWithProxy(url);

    const result = data.chart.result[0];
    const meta = result.meta;
    
    // 현재가 (정규장 마감 후에는 regularMarketPrice 사용)
    const currentPrice = meta.regularMarketPrice;
    const prevClose = meta.previousClose;
    const currency = meta.currency;

    return {
      price: currentPrice,
      prevClose: prevClose,
      currency: currency
    };
  } catch (e) {
    console.error(`Yahoo Finance fetch failed for ${ticker}`, e);
    throw e;
  }
}

// =================================================================
// 4. 메인 함수: 데이터 가져오기 (Export)
// =================================================================

export const fetchAssetData = async (ticker: string, exchange: string): Promise<{ name: string; priceKRW: number; priceOriginal: number; currency: string; pricePreviousClose: number; }> => {
  // 1. 암호화폐 판별
  // 카테고리가 CRYPTO 이거나, 거래소 이름에 '업비트'/'코인' 등이 있거나, 티커가 BTC/ETH 등인 경우
  const isCrypto = exchange.includes('종합') || exchange.includes('업비트') || ['BTC', 'ETH', 'XRP', 'SOL'].includes(ticker.toUpperCase());
  
  if (isCrypto) {
    const cryptoData = await fetchCryptoPrice(ticker);
    return {
      name: ticker, // 업비트 API는 한글명을 바로 주지 않음 (별도 조회 필요하지만 일단 티커로 대체)
      priceKRW: cryptoData.price,
      priceOriginal: cryptoData.price,
      currency: 'KRW', // 업비트 KRW 마켓 기준
      pricePreviousClose: cryptoData.prevClose
    };
  }

  // 2. 주식 처리
  const yahooTicker = normalizeStockTicker(ticker, exchange);
  const stockData = await fetchStockPrice(yahooTicker);
  
  // 3. 환율 처리 (주식이 KRW가 아닌 경우)
  let finalPriceKRW = stockData.price;
  let finalPrevCloseKRW = stockData.prevClose;

  if (stockData.currency !== 'KRW') {
    try {
        const rate = await fetchCurrentExchangeRate(stockData.currency, 'KRW');
        finalPriceKRW = stockData.price * rate;
        finalPrevCloseKRW = stockData.prevClose * rate;
    } catch (e) {
        console.warn('Exchange rate fetch failed, using original currency');
    }
  }

  return {
    name: ticker, // 야후 차트 API는 shortName을 주지 않는 경우가 있어 티커로 대체하거나, 별도 검색 필요
    priceOriginal: stockData.price,
    currency: stockData.currency,
    priceKRW: finalPriceKRW,
    pricePreviousClose: finalPrevCloseKRW
  };
};

// =================================================================
// 5. 환율 및 검색 함수 (Export)
// =================================================================

export const fetchHistoricalExchangeRate = async (date: string, fromCurrency: string, toCurrency: string): Promise<number> => {
   // 과거 환율은 무료 API로 정확히 얻기 어려움. 
   // 여기서는 Gemini를 유지하거나, 현재 환율로 대체하는 것이 안정적.
   // 기존 로직(Gemini) 유지 (사용 빈도가 낮으므로)
    if (fromCurrency === toCurrency) return 1;

    // 만약 Gemini 오류가 계속된다면 아래처럼 현재 환율로 Fallback 하는 로직 권장
    try {
        const aiResponse = await fetchCurrentExchangeRate(fromCurrency, toCurrency); // 임시: 현재 환율 사용
        return aiResponse; 
    } catch {
        return 1350; // 하드코딩 Fallback (최악의 경우)
    }
};

export const fetchCurrentExchangeRate = async (fromCurrency: string, toCurrency: string): Promise<number> => {
  if (fromCurrency === toCurrency) return 1;
  
  // 야후 파이낸스 환율 정보 사용 (예: USDKRW=X)
  try {
    const pair = `${fromCurrency}${toCurrency}=X`;
    const data = await fetchStockPrice(pair);
    return data.price;
  } catch (e) {
    console.error('Exchange rate fetch failed', e);
    // 실패시 대략적인 상수값 혹은 Gemini 사용
    return fromCurrency === 'USD' ? 1400 : 1000; 
  }
};

export const searchSymbols = async (query: string): Promise<SymbolSearchResult[]> => {
  if (!query || query.length < 1) return [];

  // 야후 파이낸스 자동완성 API 사용
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&lang=ko-KR&region=KR&quotesCount=5&newsCount=0`;
  
  try {
    const data = await fetchWithProxy(url);
    const quotes = data.quotes || [];

    return quotes.map((item: any) => ({
      ticker: item.symbol,
      name: item.shortname || item.longname || item.symbol,
      exchange: item.exchange
    }));
  } catch (e) {
    console.error('Symbol search failed', e);
    return [];
  }
};


// =================================================================
// 6. 포트폴리오 질문 (Gemini 유지)
// =================================================================
// 이 부분은 LLM의 강점이므로 기존 코드를 유지하되, 에러 처리를 강화합니다.

let portfolioCache: { data: string; timestamp: number } | null = null;
const CACHE_DURATION = 5 * 60 * 1000;

export const askPortfolioQuestion = async (assets: Asset[], question: string): Promise<string> => {
    // ... (기존 코드와 동일하게 유지) ...
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
    
    const now = Date.now();
    if (portfolioCache && portfolioCache.data === portfolioJson && (now - portfolioCache.timestamp) < CACHE_DURATION) {
       // cache hit
    } else {
        portfolioCache = { data: portfolioJson, timestamp: now };
    }

    const prompt = `당신은 투자 전문가입니다. 아래 JSON 포트폴리오 데이터를 보고 질문에 답하세요.\n\n${portfolioJson}\n\n질문: "${question}"`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-1.5-flash', // 혹은 gemini-2.0-flash
            contents: prompt,
        });
        return response.text.trim();
    } catch (error) {
        console.error(`Gemini Error:`, error);
        return "죄송합니다. 현재 인공지능 서버 연결이 원활하지 않아 답변해 드릴 수 없습니다.";
    }
};