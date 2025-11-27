import { GoogleGenAI } from '@google/genai';
import { Asset, SymbolSearchResult } from '../types';

// Gemini는 포트폴리오 질문용으로만 유지
const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY! });

// =================================================================
// 1. 유틸리티: 지연(Delay) 함수 및 프록시 설정
// =================================================================

// 요청 사이에 시간을 두는 함수 (비동기 지연) - 업비트 차단 방지용
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 프록시 목록 (하나가 막히면 다른거 시도) - 야후 파이낸스 차단 방지용
const PROXY_LIST = [
    "https://api.allorigins.win/raw?url=",
    "https://corsproxy.io/?", 
    "https://thingproxy.freeboard.io/fetch/" 
];

// 여러 프록시를 돌면서 시도하는 함수
async function fetchWithProxy(targetUrl: string) {
    const encodedUrl = encodeURIComponent(targetUrl);
    
    // 여러 프록시를 순차적으로 시도
    for (const proxyBase of PROXY_LIST) {
        try {
            // corsproxy.io는 인코딩 없이 쓰는 경우도 있어 분기 처리
            const url = proxyBase.includes('corsproxy.io') ? `${proxyBase}${targetUrl}` : `${proxyBase}${encodedUrl}`;
            
            const response = await fetch(url);
            if (response.ok) {
                return await response.json();
            }
        } catch (e) {
            console.warn(`Proxy ${proxyBase} failed, trying next...`);
        }
    }
    throw new Error("All proxies failed. 주가 정보를 가져올 수 없습니다.");
}

// =================================================================
// 2. 암호화폐 (Upbit API) - 요청 속도 조절 적용
// =================================================================

// 마지막 요청 시간을 기록하여 속도 조절
let lastUpbitCall = 0;
const UPBIT_DELAY = 300; // 요청 간 최소 0.3초 간격 (너무 빠르면 늘리세요)

async function fetchCryptoPrice(ticker: string): Promise<{ price: number; prevClose: number }> {
    const now = Date.now();
    const timeSinceLastCall = now - lastUpbitCall;
    
    // 너무 빨리 요청하면 강제로 기다림 (Throttling)
    if (timeSinceLastCall < UPBIT_DELAY) {
        await delay(UPBIT_DELAY - timeSinceLastCall);
    }
    lastUpbitCall = Date.now(); // 시간 갱신

    // 티커 처리 (BTC -> KRW-BTC)
    const marketCode = ticker.toUpperCase().startsWith('KRW-') ? ticker : `KRW-${ticker}`;
    
    try {
        const url = `https://api.upbit.com/v1/ticker?markets=${marketCode}`;
        const response = await fetch(url);
        
        if (response.status === 429) {
            throw new Error("Too Many Requests (Upbit) - 잠시 후 다시 시도됩니다.");
        }

        const data = await response.json();
        if (!data || data.length === 0) throw new Error('Coin not found');

        const item = data[0];
        return {
            price: item.trade_price,
            prevClose: item.prev_closing_price
        };
    } catch (e) {
        console.error(`Upbit error: ${ticker}`, e);
        throw e;
    }
}

// =================================================================
// 3. 주식 (Yahoo Finance)
// =================================================================

// 한국 주식 티커 정규화 (005930 -> 005930.KS)
function normalizeStockTicker(ticker: string, exchange: string): string {
    const t = ticker.toUpperCase().trim();
    if (t.includes('.')) return t; // 이미 확장자가 있으면 패스
    
    // 숫자 6자리인 경우 한국 주식으로 간주
    if (/^\d{6}$/.test(t)) {
        return exchange.includes('코스닥') ? `${t}.KQ` : `${t}.KS`;
    }
    return t;
}

async function fetchStockPrice(ticker: string) {
    try {
        // 야후 파이낸스 차트 API 사용
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`;
        const data = await fetchWithProxy(url);

        if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
            throw new Error("Invalid Yahoo Finance Data");
        }

        const result = data.chart.result[0];
        const meta = result.meta;
        return {
            price: meta.regularMarketPrice,
            prevClose: meta.previousClose,
            currency: meta.currency
        };
    } catch (e) {
        console.error(`Yahoo Finance error: ${ticker}`, e);
        throw e;
    }
}

// =================================================================
// 4. 메인 Export 함수 (기존 로직 대체)
// =================================================================

export const fetchAssetData = async (ticker: string, exchange: string) => {
    // 암호화폐 여부 확인 (거래소 이름이나 티커로 판단)
    const isCrypto = exchange.includes('종합') || exchange.includes('업비트') || ['BTC', 'ETH', 'XRP', 'SOL', 'USDC', 'TRX', 'APE'].includes(ticker.toUpperCase());

    if (isCrypto) {
        const data = await fetchCryptoPrice(ticker);
        return {
            name: ticker,
            priceKRW: data.price,
            priceOriginal: data.price,
            currency: 'KRW',
            pricePreviousClose: data.prevClose
        };
    } else {
        // 주식 처리
        const yahooTicker = normalizeStockTicker(ticker, exchange);
        const data = await fetchStockPrice(yahooTicker);
        
        // 환율 처리 (간단화: USD면 1430원 가정, 필요 시 API 연동)
        // 실제 운영 시에는 환율 API도 프록시를 통해 가져와야 정확함
        let rate = 1;
        if (data.currency === 'USD') rate = 1430; // 임시 고정 환율
        else if (data.currency === 'JPY') rate = 9.2;

        return {
            name: ticker, // 야후에서 이름을 따로 주지 않을 경우 티커 사용
            priceOriginal: data.price,
            currency: data.currency,
            priceKRW: data.price * rate,
            pricePreviousClose: data.prevClose * rate
        };
    }
};

// =================================================================
// 5. 기타 필수 함수들 (앱이 깨지지 않도록 유지)
// =================================================================

export const searchSymbols = async (query: string): Promise<SymbolSearchResult[]> => {
    // 야후 검색 API 사용 (프록시 경유)
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&lang=ko-KR&region=KR&quotesCount=5`;
    try {
        const data = await fetchWithProxy(url);
        return (data.quotes || []).map((item: any) => ({
            ticker: item.symbol,
            name: item.shortname || item.longname || item.symbol,
            exchange: item.exchange
        }));
    } catch {
        return [];
    }
};

export const fetchCurrentExchangeRate = async (from: string, to: string) => {
    if (from === to) return 1;
    if (from === 'USD' && to === 'KRW') return 1430; // 에러 방지용 고정값
    return 1; 
};

export const fetchHistoricalExchangeRate = async (date: string, from: string, to: string) => {
    if (from === 'USD' && to === 'KRW') return 1430;
    return 1;
};

// 포트폴리오 질문 기능 (Gemini 사용 유지)
let portfolioCache: { data: string; timestamp: number } | null = null;
const CACHE_DURATION = 5 * 60 * 1000;

export const askPortfolioQuestion = async (assets: Asset[], question: string): Promise<string> => {
    try {
        const simplifiedAssets = assets.map(asset => ({
            name: asset.name,
            category: asset.category,
            quantity: asset.quantity,
            current_value_krw: asset.currentPrice * asset.quantity,
        }));
        const portfolioJson = JSON.stringify(simplifiedAssets, null, 2);
        
        const now = Date.now();
        if (portfolioCache && portfolioCache.data === portfolioJson && (now - portfolioCache.timestamp) < CACHE_DURATION) {
            // 캐시 활용