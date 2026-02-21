// services/historicalPriceService.ts
// 과거 시세 백필(Backfill)용 API 서비스

// AssetCategory import removed — category param is now optional string

const API_BASE_URL = 'https://asset-manager-887842923289.asia-northeast3.run.app';

export interface HistoricalPriceData {
  [date: string]: number; // { "2024-01-15": 72500, "2024-01-16": 73000, ... }
}

export interface HistoricalPriceResult {
  data?: HistoricalPriceData;
  volume?: HistoricalPriceData;  // 거래량 시계열 { "YYYY-MM-DD": volume }
  error?: string;
  ticker?: string;
  market?: string;
}

/**
 * 주식/ETF/금 등의 과거 종가 조회 (FinanceDataReader 사용)
 */
export async function fetchStockHistoricalPrices(
  tickers: string[],
  startDate: string,
  endDate: string
): Promise<Record<string, HistoricalPriceResult>> {
  if (tickers.length === 0) return {};

  try {
    const response = await fetch(`${API_BASE_URL}/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tickers,
        start_date: startDate,
        end_date: endDate,
      }),
    });

    if (!response.ok) {
      console.error(`[HistoricalPrice] API Error: ${response.status}`);
      return {};
    }

    const data = await response.json();
    return data as Record<string, HistoricalPriceResult>;
  } catch (error) {
    console.error('[HistoricalPrice] Stock fetch error:', error);
    return {};
  }
}

/**
 * 암호화폐 과거 종가 조회 (Upbit API 사용)
 */
export async function fetchCryptoHistoricalPrices(
  symbols: string[],
  startDate: string,
  endDate: string
): Promise<Record<string, HistoricalPriceResult>> {
  if (symbols.length === 0) return {};

  try {
    const response = await fetch(`${API_BASE_URL}/upbit/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbols,
        start_date: startDate,
        end_date: endDate,
      }),
    });

    if (!response.ok) {
      console.error(`[HistoricalPrice] Upbit API Error: ${response.status}`);
      return {};
    }

    const data = await response.json();
    return data as Record<string, HistoricalPriceResult>;
  } catch (error) {
    console.error('[HistoricalPrice] Crypto fetch error:', error);
    return {};
  }
}

/**
 * 환율 과거 데이터 조회 (USD/KRW)
 */
export async function fetchExchangeRateHistory(
  startDate: string,
  endDate: string
): Promise<HistoricalPriceData> {
  try {
    const response = await fetch(`${API_BASE_URL}/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tickers: ['USD/KRW'],
        start_date: startDate,
        end_date: endDate,
      }),
    });

    if (!response.ok) {
      return {};
    }

    const data = await response.json();
    const result = data['USD/KRW'];
    return result?.data || {};
  } catch (error) {
    console.error('[HistoricalPrice] Exchange rate fetch error:', error);
    return {};
  }
}

/**
 * 티커 변환 함수
 * - 한국주식: 005930 → 005930 (FDR이 자동 처리)
 * - 미국주식: AAPL → AAPL (변환 없음)
 * - KRX 금: KRX-GOLD (특수 처리)
 */
export function convertTickerForAPI(
  ticker: string,
  exchange: string,
  category?: string
): string {
  const t = ticker.trim().toUpperCase();

  // KRX 금시장 특수 처리
  if (exchange.includes('KRX 금시장') || exchange.includes('금시장')) {
    return 'KRX-GOLD';
  }

  // FinanceDataReader는 대부분의 티커를 자동으로 처리
  return t;
}

/**
 * 암호화폐 거래소인지 확인
 */
export function isCryptoExchange(exchange: string): boolean {
  const normalized = (exchange || '').toLowerCase().trim();
  const cryptoExchanges = ['upbit', 'bithumb', '주요 거래소 (종합)'];
  return cryptoExchanges.some(ex => normalized.includes(ex));
}
