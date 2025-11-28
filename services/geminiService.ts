// services/geminiService.ts

import { GoogleGenAI } from '@google/genai';
import { Asset, SymbolSearchResult } from '../types';

// Gemini는 포트폴리오 질문용으로만 유지
const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY! });

// =================================================================
// 1. 유틸리티: Worker 프록시 설정 및 배치(Batch) 처리기
// =================================================================

// [사용자 입력 필수] 
// 1단계에서 복사한 Worker URL을 여기에 붙여넣으세요.
const WORKER_PROXY_URL = "https://yahoo-proxy.sseng0520.workers.dev"; // 👈 예시 주소, 본인의 주소로 변경하세요!

// 요청을 잠시 모아둘 대기열
let upbitBuffer: { ticker: string, resolve: (val: any) => void, reject: (err: any) => void }[] = [];
let upbitTimeout: any = null;
let yahooBuffer: { ticker: string, resolve: (val: any) => void, reject: (err: any) => void }[] = [];
let yahooTimeout: any = null;
let callQueuePromise: Promise<void> = Promise.resolve(); // 요청 줄세우기 Promise

// Worker를 통해 요청을 보내는 함수 (나만의 프록시 사용)
async function fetchWithProxy(targetUrl: string) {
    const url = `${WORKER_PROXY_URL}/?url=${encodeURIComponent(targetUrl)}`;
    
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Worker Proxy Failed (${response.status}): ${await response.text()}`);
    }
    return response.json();
}

// =================================================================
// 2. 암호화폐 (Upbit) - 자동 배치 처리 (Auto-Batching)
// =================================================================

const UPBIT_DELAY = 50; // 요청 간격 0.05초 (Worker 사용시 더 짧게 설정)

// 이전 요청이 끝난 시점부터 ms만큼 대기하는 Promise를 체이닝
const throttle = (ms: number) => {
    const nextCall = callQueuePromise.then(() => new Promise<void>(resolve => setTimeout(resolve, ms)));
    callQueuePromise = nextCall;
    return nextCall;
};

const processUpbitQueue = async () => {
    if (upbitBuffer.length === 0) return;

    // 배치 처리 전, 429 방지를 위해 대기열 진입
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
// 3. 주식 (Yahoo Finance) - 자동 배치 처리 (Auto-Batching)
// =================================================================

const processYahooQueue = async () => {
    if (yahooBuffer.length === 0) return;

    // Yahoo는 Rate Limit이 불분명하므로, 안전하게 0.1초 딜레이
    await throttle(100); 

    const currentBatch = [...yahooBuffer];
    yahooBuffer = [];
    yahooTimeout = null;

    try {
        const symbols = [...new Set(currentBatch.map(i => i.ticker))].join(',');
        
        // 야후 quote API 사용 (Worker를 통해 프록시 처리)
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
// 5. 기타 필수 함수들
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