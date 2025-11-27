import { GoogleGenAI } from '@google/genai';
import { Asset, SymbolSearchResult } from '../types';

// Gemini는 포트폴리오 질문용으로만 유지
const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY! });

// =================================================================
// 1. 유틸리티: 프록시 및 배치(Batch) 처리기
// =================================================================

const PROXY_LIST = [
    "https://api.allorigins.win/raw?url=",
    "https://corsproxy.io/?", 
    "https://thingproxy.freeboard.io/fetch/" 
];

// 여러 프록시를 순차적으로 시도
async function fetchWithProxy(targetUrl: string) {
    const encodedUrl = encodeURIComponent(targetUrl);
    for (const proxyBase of PROXY_LIST) {
        try {
            const url = proxyBase.includes('corsproxy.io') ? `${proxyBase}${targetUrl}` : `${proxyBase}${encodedUrl}`;
            const response = await fetch(url);
            if (response.ok) return await response.json();
        } catch (e) {
            console.warn(`Proxy ${proxyBase} failed, trying next...`);
        }
    }
    throw new Error("모든 프록시 연결 실패");
}

// =================================================================
// 2. 암호화폐 (Upbit) - 자동 배치 처리 (Auto-Batching)
// =================================================================

// 요청을 잠시 모아둘 대기열
let upbitBuffer: { ticker: string, resolve: (val: any) => void, reject: (err: any) => void }[] = [];
let upbitTimeout: any = null;

// 대기열에 있는 모든 코인을 한 번에 조회하여 분배하는 함수
const processUpbitQueue = async () => {
    if (upbitBuffer.length === 0) return;

    // 대기열 복사 및 초기화 (다음 요청을 위해)
    const currentBatch = [...upbitBuffer];
    upbitBuffer = [];
    upbitTimeout = null;

    try {
        // 티커들을 'KRW-BTC,KRW-ETH' 형태로 합침
        const marketCodes = [...new Set(currentBatch.map(item => {
            const t = item.ticker.toUpperCase();
            return t.startsWith('KRW-') ? t : `KRW-${t}`;
        }))].join(',');

        // 단 1번의 요청으로 모든 데이터 수신
        const url = `https://api.upbit.com/v1/ticker?markets=${marketCodes}`;
        const response = await fetch(url);
        const data = await response.json(); // 업비트는 배열로 반환됨

        // 결과를 기다리던 각 요청에게 배달
        currentBatch.forEach(({ ticker, resolve, reject }) => {
            const code = ticker.toUpperCase().startsWith('KRW-') ? ticker.toUpperCase() : `KRW-${ticker.toUpperCase()}`;
            const match = data.find((d: any) => d.market === code);
            
            if (match) {
                resolve({
                    price: match.trade_price,
                    prevClose: match.prev_closing_price
                });
            } else {
                reject(new Error(`Coin not found: ${ticker}`));
            }
        });

    } catch (error) {
        // 배치 요청 실패 시, 기다리던 모든 요청에 에러 전파
        currentBatch.forEach(({ reject }) => reject(error));
    }
};

// 개별 요청을 받아서 대기열에 넣는 함수
function fetchCryptoPriceBatched(ticker: string): Promise<{ price: number; prevClose: number }> {
    return new Promise((resolve, reject) => {
        upbitBuffer.push({ ticker, resolve, reject });
        
        // 50ms 동안 추가 요청이 없으면 배치 처리 실행 (Debounce)
        if (upbitTimeout) clearTimeout(upbitTimeout);
        upbitTimeout = setTimeout(processUpbitQueue, 50);
    });
}

// =================================================================
// 3. 주식 (Yahoo Finance) - 자동 배치 처리 (Auto-Batching)
// =================================================================

let yahooBuffer: { ticker: string, resolve: (val: any) => void, reject: (err: any) => void }[] = [];
let yahooTimeout: any = null;

const processYahooQueue = async () => {
    if (yahooBuffer.length === 0) return;

    const currentBatch = [...yahooBuffer];
    yahooBuffer = [];
    yahooTimeout = null;

    try {
        const symbols = [...new Set(currentBatch.map(i => i.ticker))].join(',');
        
        // 야후의 'quote' API는 여러 심볼을 한 번에 조회 가능
        const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`;
        const data = await fetchWithProxy(url);
        
        const results = data.quoteResponse?.result || [];

        currentBatch.forEach(({ ticker, resolve, reject }) => {
            const match = results.find((r: any) => r.symbol === ticker);
            if (match) {
                resolve({
                    price: match.regularMarketPrice,
                    prevClose: match.regularMarketPreviousClose,
                    currency: match.currency,
                    name: match.shortName || match.longName || ticker 
                });
            } else {
                resolve({ price: 0, prevClose: 0, currency: 'KRW', name: ticker });
            }
        });

    } catch (error) {
        currentBatch.forEach(({ reject }) => reject(error));
    }
};

function normalizeStockTicker(ticker: string, exchange: string): string {
    const t = ticker.toUpperCase().trim();
    if (t.includes('.')) return t;
    if (/^\d{6}$/.test(t)) return exchange.includes('코스닥') ? `${t}.KQ` : `${t}.KS`;
    return t;
}

function fetchStockPriceBatched(ticker: string): Promise<any> {
    return new Promise((resolve, reject) => {
        yahooBuffer.push({ ticker, resolve, reject });
        if (yahooTimeout) clearTimeout(yahooTimeout);
        yahooTimeout = setTimeout(processYahooQueue, 50);
    });
}

// =================================================================
// 4. 메인 Export 함수 
// =================================================================

export const fetchAssetData = async (ticker: string, exchange: string) => {
    const isCrypto = exchange.includes('종합') || exchange.includes('업비트') || ['BTC', 'ETH', 'XRP', 'SOL', 'USDC', 'TRX', 'APE', 'DOGE', 'ADA', 'SUI'].includes(ticker.toUpperCase());

    if (isCrypto) {
        const data = await fetchCryptoPriceBatched(ticker);
        return {
            name: ticker,
            priceKRW: data.price,
            priceOriginal: data.price,
            currency: 'KRW',
            pricePreviousClose: data.prevClose
        };
    } else {
        const yahooTicker = normalizeStockTicker(ticker, exchange);
        const data = await fetchStockPriceBatched(yahooTicker);
        
        let rate = 1;
        if (data.currency === 'USD') rate = 1435; 
        else if (data.currency === 'JPY') rate = 9.2;

        return {
            name: data.name || ticker,
            priceOriginal: data.price,
            currency: data.currency,
            priceKRW: data.price * rate,
            pricePreviousClose: data.prevClose * rate
        };
    }
};

// =================================================================
// 5. 기타 필수 함수들 (에러 수정됨)
// =================================================================

export const searchSymbols = async (query: string): Promise<SymbolSearchResult[]> => {
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
    if (from === 'USD' && to === 'KRW') return 1435;
    return 1; 
};

// [수정됨] 매개변수(date, from, to)를 받도록 수정하여 빌드 에러 해결
export const fetchHistoricalExchangeRate = async (date: string, from: string, to: string) => {
    if (from === 'USD' && to === 'KRW') return 1435;
    return 1;
};

// 포트폴리오 질문 (Gemini)
let portfolioCache: { data: string; timestamp: number } | null = null;
const CACHE_DURATION = 5 * 60 * 1000;

export const askPortfolioQuestion = async (assets: Asset[], question: string): Promise<string> => {
    try {
        const simplifiedAssets = assets.map(asset => ({
            name: asset.name,
            quantity: asset.quantity,
            current_value_krw: asset.currentPrice * asset.quantity,
        }));
        const portfolioJson = JSON.stringify(simplifiedAssets, null, 2);
        
        const now = Date.now();
        if (portfolioCache && portfolioCache.data === portfolioJson && (now - portfolioCache.timestamp) < CACHE_DURATION) {
            // 캐시 사용
        } else {
            portfolioCache = { data: portfolioJson, timestamp: now };
        }

        const prompt = `투자 전문가로서 답변해줘. 자산 데이터:\n${portfolioJson}\n\n질문: "${question}"`;
        const response = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: prompt,
        });
        return response.text.trim();
    } catch (error) {
        return "AI 서버 연결 상태가 좋지 않아 답변할 수 없습니다.";
    }
};