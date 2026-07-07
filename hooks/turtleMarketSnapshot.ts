// hooks/turtleMarketSnapshot.ts
// ---------------------------------------------------------------------------
// 공용 터틀 시장 스냅샷 로더 (자동 검토 Phase B) — 훅이 아니라 훅들이 공유하는 async 함수.
//
// `useActionQueue.refreshActionQueue`(생성·저장)와 `useTurtleActionReview`(읽기 전용 자동 검토)가
// **동일한 fetch→조립 경로**를 공유한다 — "브리핑 예고 건수 ≠ 실제 생성 건수" drift 차단이 목적.
// (ATR20은 Wilder smoothing이라 경로 의존적 — 다른 기간의 시계열로 계산하면 N이 미세하게 달라져
//  경계 판정이 뒤집힐 수 있다. 그래서 데이터 재사용이 아니라 "경로 공유"가 정답.)
//
// 순수 계산(N·돈치안 조립)은 utils/turtleMarketData에 위임, 여기는 메타 해석 + fetch만.
// fail-closed: fetch 실패 종목은 marketByTicker에서 빠짐 → 생성기/진단이 no-market 처리.

import {
  fetchStockHistoricalPrices,
  fetchCryptoHistoricalPrices,
  isCryptoExchange,
  convertTickerForAPI,
  HistoricalPriceResult,
} from '../services/historicalPriceService';
import {
  assembleMarketInput,
  extractOhlcvSeries,
  turtleHistoryWindow,
} from '../utils/turtleMarketData';
import { TurtleMarketInput } from '../utils/actionQueueGenerator';
import { Asset, Currency, ExchangeRates, WatchlistItem } from '../types';
import { TurtlePosition, TurtleSettings } from '../types/turtle';

interface TickerMeta {
  ticker: string;
  name: string;
  price: number;          // 현재가 (priceOriginal, 원통화)
  currency?: Currency;
  exchange: string;
  isCrypto: boolean;
  fetchTicker: string;    // API 조회용 변환 티커
}

export interface TurtleMarketSnapshot {
  /** 종목별 계산된 시장 입력 (원통화 N·돈치안·환율). fetch 실패 종목은 없음(fail-closed) */
  marketByTicker: Map<string, TurtleMarketInput>;
  /** 메타 해석된 대상 수 (오픈 포지션 + 유효가 터틀 후보, dedup). 0이면 fetch 자체를 안 함 */
  targetCount: number;
}

/** 진입 후보로 평가 가능한 터틀 후보 (isTurtleCandidate + 유효 현재가) — 생성·검토가 동일 필터 공유. */
export function turtleCandidateItems(watchlist: WatchlistItem[]): WatchlistItem[] {
  return watchlist.filter(w => w.isTurtleCandidate && (w.priceOriginal ?? 0) > 0);
}

/**
 * 오픈 터틀 포지션 + 터틀 후보의 OHLCV를 최소 기간(≈105일)만 fetch해 TurtleMarketInput 맵으로 조립한다.
 * 저장·상태 변경 없음(호출부가 결정) — 생성 경로와 검토 경로가 같은 스냅샷 위에서 판정하도록 하는 공유 지점.
 */
export async function loadTurtleMarketSnapshot(params: {
  assets: Asset[];
  watchlist: WatchlistItem[];
  turtlePositions: TurtlePosition[];
  turtleSettings: TurtleSettings;
  exchangeRates: ExchangeRates;
  today: string; // YYYY-MM-DD (주입 — 테스트/결정성)
}): Promise<TurtleMarketSnapshot> {
  const { assets, watchlist, turtlePositions, turtleSettings, exchangeRates, today } = params;

  const openPositions = turtlePositions.filter(p => p.status === 'open');
  const candidateItems = turtleCandidateItems(watchlist);

  // ── 종목 메타 해석 (현재가·통화·거래소) ──
  const metaByTicker = new Map<string, TickerMeta>();
  const addMeta = (ticker: string, name: string, price: number | undefined, currency: Currency | undefined, exchange: string) => {
    if (metaByTicker.has(ticker) || !(price && price > 0)) return;
    metaByTicker.set(ticker, {
      ticker, name, price, currency, exchange,
      isCrypto: isCryptoExchange(exchange),
      fetchTicker: convertTickerForAPI(ticker, exchange),
    });
  };
  for (const p of openPositions) {
    const asset = (p.assetId ? assets.find(a => a.id === p.assetId) : undefined) ?? assets.find(a => a.ticker === p.ticker);
    if (asset) addMeta(p.ticker, p.name, asset.priceOriginal, asset.currency, asset.exchange);
  }
  for (const w of candidateItems) addMeta(w.ticker, w.name, w.priceOriginal, w.currency, w.exchange);

  const metas = [...metaByTicker.values()];
  if (metas.length === 0) {
    return { marketByTicker: new Map(), targetCount: 0 };
  }

  // ── OHLCV 최소 기간 fetch (주식/코인 분기) ──
  const { startDate, endDate } = turtleHistoryWindow(turtleSettings, today);
  const cryptoTickers = metas.filter(m => m.isCrypto).map(m => m.fetchTicker);
  const stockTickers = metas.filter(m => !m.isCrypto).map(m => m.fetchTicker);
  const empty: Record<string, HistoricalPriceResult> = {};
  const [cryptoRes, stockRes] = await Promise.all([
    cryptoTickers.length ? fetchCryptoHistoricalPrices(cryptoTickers, startDate, endDate) : Promise.resolve(empty),
    stockTickers.length ? fetchStockHistoricalPrices(stockTickers, startDate, endDate) : Promise.resolve(empty),
  ]);

  // ── 시장 입력 조립 ──
  const marketByTicker = new Map<string, TurtleMarketInput>();
  for (const m of metas) {
    const result = (m.isCrypto ? cryptoRes : stockRes)[m.fetchTicker];
    const series = extractOhlcvSeries(result);
    if (series.sortedDates.length === 0) continue; // fetch 실패 → 이 종목 스킵 (fail-closed)
    marketByTicker.set(m.ticker, assembleMarketInput({
      ticker: m.ticker, name: m.name, price: m.price, currency: m.currency,
      isCrypto: m.isCrypto, series, settings: turtleSettings, rates: exchangeRates,
    }));
  }

  return { marketByTicker, targetCount: metas.length };
}
