// services/geminiService.ts (Trae의 요구사항 반영)

import { GoogleGenAI } from '@google/genai';
import { Asset, SymbolSearchResult } from '../types';

// Gemini는 포트폴리오 질문용으로만 유지
const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY! });

// =================================================================
// 1. 유틸리티: 프록시 설정 및 배치(Batch) 처리기
// =================================================================

// [Trae 변경사항 1: 프록시 후보 목록 및 환경변수 지원]
const PROXY_CANDIDATES = [
    // 환경 변수가 설정되어 있으면 최우선 순위로 사용됨
    import.meta.env.VITE_YAHOO_PROXY_URL, 
    // 공용 프록시 후보들 (Worker 실패 시 폴백용)
    "https://api.allorigins.win/raw?url=",
    "https://corsproxy.io/?", 
];

// 로컬 스토리지에 캐시된 성공 프록시 주소
const CACHED_PROXY_KEY = 'yahoo_proxy_url';

// 요청을 잠시 모아둘 대기열 및 배치 처리 변수
let upbitBuffer: { ticker: string, resolve: (val: any) => void, reject: (err: any) => void }[] = [];
let upbitTimeout: any = null;
let yahooBuffer: { ticker: string, resolve: (val: any) => void, reject: (err: any) => void }[] = [];
let yahooTimeout: any = null;
let callQueuePromise: Promise<void> = Promise.resolve(); // 요청 줄세우기 Promise

// [Trae 변경사항 2: 프록시 폴백 로직]
async function findAndUseProxy(targetUrl: string) {
    const successUrl = localStorage.getItem(CACHED_PROXY_KEY);
    
    // 1. 캐시된 성공 주소가 있다면 먼저 시도
    if (successUrl) {
        try {
            return await attemptFetch(successUrl, targetUrl, true);
        } catch (e) {
            console.warn(`Cached proxy ${successUrl} failed. Trying candidates...`);
            localStorage.removeItem(CACHED_PROXY_KEY); // 실패 시 캐시 제거
        }
    }

    // 2. 후보 목록을 순차적으로 시도
    for (const base of PROXY_CANDIDATES) {
        if (!base) continue; // 환경변수가 없는 경우 스킵
        try {
            const data = await attemptFetch(base, targetUrl, false);
            // 성공 시 캐시
            localStorage.setItem(CACHED_PROXY_KEY, base);
            return data;
        } catch (e) {
            console.warn(`Candidate proxy ${base} failed.`);
        }
    }

    throw new Error("모든 프록시 연결 실패. 환경 변수 VITE_YAHOO_PROXY_URL을 확인하세요.");
}

async function attemptFetch(proxyBase: string, targetUrl: string, isCached: boolean): Promise<any> {
    // Worker URL (사용자 정의) 또는 공용 프록시 URL (일반 인코딩 방식) 구분
    const isWorker = proxyBase.includes('workers.dev');
    
    let url;
    if (isWorker) {
        url = `${proxyBase}/?url=${encodeURIComponent(targetUrl)}`;
    } else if (proxyBase.includes('corsproxy.io')) {
        url = `${proxyBase}${targetUrl}`; // CorsProxy는 보통 인코딩 없이 사용
    } else {
        url = `${proxyBase}${encodeURIComponent(targetUrl)}`;
    }

    const response = await fetch(url);
    
    if (response.status === 401) {
        // [주요 확인 포인트] Worker의 401 Unauthorized 오류
        throw new Error(`Proxy returned 401 Unauthorized. Check Worker/App configuration.`);
    }

    if (!response.ok) {
        throw new Error(`Proxy request failed with status: ${response.status}`);
    }
    return response.json();
}

// =================================================================
// 3. 암호화폐 (Upbit) - 자동 배치 처리 (Auto-Batching)
// =================================================================

const UPBIT_DELAY = 50; 

const throttle = (ms: number) => {
    const nextCall = callQueuePromise.then(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
    callQueuePromise = nextCall;
    return nextCall;
};

const processUpbitQueue = async () => {
    if (upbitBuffer.length === 0) return;

    await throttle(UPBIT_DELAY);

    const currentBatch = [...upbitBuffer];
    upbitBuffer = [];
    upbitTimeout = null;

    try {
        const marketCodes = [...new Set(currentBatch.map(item => {
            const t = item.ticker.toUpperCase();
            return t.startsWith('KRW-') ? t : `KRW-${t}`;
        }))].join(',');

        const url = `https://api.upbit.com/v1/ticker?markets=${marketCodes}`;
        const response = await fetch(url);
        const data = await response.json();

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
        currentBatch.forEach(({ reject }) => reject(error));
    }
};

function fetchCryptoPriceBatched(ticker: string): Promise<{ price: number; prevClose: number }> {
    return new Promise((resolve, reject) => {
        upbitBuffer.push({ ticker, resolve, reject });
        if (upbitTimeout) clearTimeout(upbitTimeout);
        upbitTimeout = setTimeout(processUpbitQueue, 50);
    });
}

// =================================================================
// 4. 주식 (Yahoo Finance) - 자동 배치 처리 (Auto-Batching)
// =================================================================

const processYahooQueue = async () => {
    if (yahooBuffer.length === 0) return;

    await throttle(100); 

    const currentBatch = [...yahooBuffer];
    yahooBuffer = [];
    yahooTimeout = null;

    try {
        const symbols = [...new Set(currentBatch.map(i => i.ticker))].join(',');
        
        const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`;
        // [변경] findAndUseProxy 함수를 통해 프록시를 찾아서 사용
        const data = await findAndUseProxy(url);
        
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
    if (/^\d{6}$/i.test(t)) return exchange.includes('코스닥') ? `${t}.KQ` : `${t}.KS`;
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
// 5. 메인 Export 함수 
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
// 6. 기타 필수 함수들
// =================================================================

export const searchSymbols = async (query: string): Promise<SymbolSearchResult[]> => {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&lang=ko-KR&region=KR&quotesCount=5`;
    try {
        const data = await findAndUseProxy(url);
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

export const fetchHistoricalExchangeRate = async (date: string, from: string, to: string) => {
    if (from === 'USD' && to === 'KRW') return 1435;
    return 1;
};

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