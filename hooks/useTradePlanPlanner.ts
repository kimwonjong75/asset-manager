// hooks/useTradePlanPlanner.ts
// ---------------------------------------------------------------------------
// "새 매수 계획" 독립 화면(components/trade-plan/TradePlanPlanner.tsx, P2c)의 데이터/상태 오케스트레이션.
// 계산·API 호출은 전부 여기, 컴포넌트는 렌더만(CLAUDE.md 계층 규칙).
//
//   종목 검색(로컬 인덱스, AddNewAssetModal과 동일 `symbolListService.searchSymbols` — Gemini 미사용)
//   → 선택 시 현재가 조회(`services/priceService.fetchAssetData`)
//   → 매수가(기본 현재가, 직접 수정 가능)
//   → `TradePlanEditor`용 target({kind:'watch', item: pseudo WatchlistItem})
//   → 저장 2경로: saveToWatchlist(관심종목에 계획과 함께 저장) / buyNowWithPlan(지금 매수 기록하며 저장)
//
// side effect(네트워크 fetch)는 훅 안에서만 — 컴포넌트는 결과 상태만 읽는다.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Currency, normalizeExchange, type SymbolSearchResult, type WatchlistItem } from '../types';
import { inferCategoryIdFromExchange } from '../types/category';
import { usePortfolio } from '../contexts/PortfolioContext';
import { searchSymbols } from '../services/symbolListService';
import { fetchAssetData } from '../services/priceService';
import { buildTradePlanMarket, type TradePlanTarget } from '../utils/tradePlanMarket';
import type { TradePlan } from '../types/tradePlan';

export interface TradePlanPlannerPrefill {
  watchItemId?: string;
  ticker?: string;
  exchange?: string;
  name?: string;
}

export interface TradePlanPlannerQuote {
  priceOriginal: number;
  currency: Currency;
  /** 표시용 기준일(YYYY-MM-DD) — `buildTradePlanMarket`의 priceAsOf(장중이면 오늘, 아니면 최근 확정 세션일) */
  priceDate: string;
  isIntraday: boolean;
  name: string;
}

export interface UseTradePlanPlannerResult {
  // 종목 검색
  query: string;
  setQuery: (q: string) => void;
  results: SymbolSearchResult[];
  isSearching: boolean;
  searchError: string | null;
  // 선택
  selected: SymbolSearchResult | null;
  selectSymbol: (r: SymbolSearchResult) => void;
  /** 선택 해제 + 시세/매수가 초기화. nextQuery(기본 '')가 새 검색어가 된다 — 타이핑 중 해제 시 입력값 보존 */
  clearSelection: (nextQuery?: string) => void;
  // 현재가 조회
  quote: TradePlanPlannerQuote | null;
  isQuoteLoading: boolean;
  quoteError: string | null;
  // 매수가 (기본 현재가, 직접 수정)
  buyPrice: string;
  setBuyPrice: (v: string) => void;
  // 편집기 target — 선택 + 시세 조회 완료 전에는 null
  target: TradePlanTarget | null;
  // 이미 관심종목에 있는 종목이면 그 항목/활성 계획(있으면 수정 모드로 이어감)
  existingWatchItem: WatchlistItem | null;
  existingPlan: TradePlan | undefined;
  // 저장
  saveToWatchlist: (plan: TradePlan) => void;
  buyNowWithPlan: (plan: TradePlan, quantity: number) => void;
}

export function useTradePlanPlanner(prefill: TradePlanPlannerPrefill | null): UseTradePlanPlannerResult {
  const { data, actions } = usePortfolio();
  const categories = data.categoryStore.categories;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selected, setSelected] = useState<SymbolSearchResult | null>(null);

  const [quote, setQuote] = useState<TradePlanPlannerQuote | null>(null);
  const [isQuoteLoading, setIsQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [buyPrice, setBuyPrice] = useState('');

  // 진입 프리필 — "렌더 중 조정" 패턴(React 공식 권장: 프롭 변화에 맞춰 state 리셋,
  // `TradePlanBulkWizard`의 열림 전환 처리와 동일 관례 — effect+setState 대신 렌더 중 비교라
  // `react-hooks/set-state-in-effect`(cascading render 방지) 위반이 아니다).
  // 마지막으로 적용한 키를 state로 기억해, openTradePlanPlanner가 매 클릭마다 새 객체를 만들어도
  // 같은 프리필에는 재반응하지 않는다(열려 있는 동안 사용자의 재선택을 덮어쓰지 않음).
  const [lastPrefillKey, setLastPrefillKey] = useState<string | null>(null);
  const prefillKey = prefill ? `${prefill.watchItemId ?? ''}|${prefill.ticker ?? ''}|${prefill.exchange ?? ''}` : null;
  if (prefillKey !== null && prefillKey !== lastPrefillKey) {
    setLastPrefillKey(prefillKey);
    if (prefill && prefill.ticker && prefill.exchange) {
      const r: SymbolSearchResult = { ticker: prefill.ticker, exchange: prefill.exchange, name: prefill.name ?? prefill.ticker };
      setSelected(r);
      setQuery(r.name);
      setResults([]);
      setQuote(null);
      setQuoteError(null);
      setBuyPrice('');
    }
  }

  // 종목 검색 (디바운스, AddNewAssetModal과 동일 패턴).
  // 짧은 검색어/이미 선택된 종목명과 같을 때는 state를 지우지 않는다 — 아래 반환값에서
  // query/selected로부터 그때그때 파생시킨다(effect 안에서 setState하지 않기 위함).
  const queryTooShortOrSelected = query.length < 2 || (selected !== null && query === selected.name);
  useEffect(() => {
    if (query.length < 2 || (selected && query === selected.name)) return;
    let alive = true;
    const handle = setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);
      try {
        const r = await searchSymbols(query);
        if (alive) setResults(r);
      } catch (e) {
        if (alive) {
          setResults([]);
          setSearchError(e instanceof Error ? e.message : '검색 중 오류가 발생했습니다.');
        }
      } finally {
        if (alive) setIsSearching(false);
      }
    }, 300);
    return () => { alive = false; clearTimeout(handle); };
  }, [query, selected]);

  const selectSymbol = useCallback((r: SymbolSearchResult) => {
    setSelected(r);
    setQuery(r.name);
    setResults([]);
    // 이전 선택의 시세/매수가가 새 종목 로딩 중 잠깐 보이지 않도록 함께 지운다.
    setQuote(null);
    setQuoteError(null);
    setBuyPrice('');
  }, []);

  // nextQuery: 선택된 상태에서 사용자가 입력칸에 타이핑하면 그 값을 검색어로 남긴다(생략 = 빈 검색어, '변경' 버튼).
  const clearSelection = useCallback((nextQuery: string = '') => {
    setSelected(null);
    setQuote(null);
    setQuoteError(null);
    setBuyPrice('');
    setQuery(nextQuery);
  }, []);

  // 현재가 조회 — 종목을 선택할 때마다 1회. selected===null 경로는 setState가 필요 없다
  // (quote/quoteError는 초기값이거나 clearSelection()이 이미 지웠다 — 이벤트 핸들러라 이 규칙과 무관).
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    (async () => {
      setIsQuoteLoading(true);
      setQuoteError(null);
      try {
        const categoryId = inferCategoryIdFromExchange(normalizeExchange(selected.exchange), categories);
        const d = await fetchAssetData({ ticker: selected.ticker, exchange: selected.exchange, categoryId });
        if (!alive) return;
        if (!d || !(d.priceOriginal > 0)) {
          setQuoteError(`'${selected.ticker}' 현재가를 확인할 수 없습니다.`);
          setQuote(null);
          return;
        }
        const nowIso = new Date().toISOString();
        const market = buildTradePlanMarket({
          priceOriginal: d.priceOriginal, exchange: selected.exchange, enriched: undefined,
          priceDataAsOf: nowIso, now: nowIso,
        });
        setQuote({
          priceOriginal: d.priceOriginal,
          currency: d.currency,
          priceDate: market.priceAsOf,
          isIntraday: market.isIntraday,
          name: d.name || selected.name,
        });
        setBuyPrice(String(d.priceOriginal));
      } catch (e) {
        if (!alive) return;
        setQuoteError(e instanceof Error ? e.message : '시세 조회 중 오류가 발생했습니다.');
        setQuote(null);
      } finally {
        if (alive) setIsQuoteLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [selected, categories]);

  const existingWatchItem = useMemo<WatchlistItem | null>(() => {
    if (!selected) return null;
    const ticker = selected.ticker.toUpperCase();
    const exchange = normalizeExchange(selected.exchange);
    return data.watchlist.find(w => w.ticker.toUpperCase() === ticker && normalizeExchange(w.exchange) === exchange) ?? null;
  }, [selected, data.watchlist]);

  const existingPlan: TradePlan | undefined =
    existingWatchItem?.tradePlan && existingWatchItem.tradePlan.status === 'active' ? existingWatchItem.tradePlan : undefined;

  const target: TradePlanTarget | null = useMemo(() => {
    if (!selected || !quote) return null;
    const categoryId = inferCategoryIdFromExchange(normalizeExchange(selected.exchange), categories);
    const priceOriginal = parseFloat(buyPrice) || quote.priceOriginal;
    const pseudoItem: WatchlistItem = {
      id: existingWatchItem?.id ?? 'planner-pseudo-item',
      ticker: selected.ticker,
      exchange: normalizeExchange(selected.exchange),
      name: quote.name,
      categoryId,
      currency: quote.currency,
      priceOriginal,
      currentPrice: priceOriginal,
    };
    return { kind: 'watch', item: pseudoItem };
  }, [selected, quote, buyPrice, categories, existingWatchItem]);

  const saveToWatchlist = useCallback((plan: TradePlan) => {
    if (!selected) return;
    if (existingWatchItem) {
      actions.saveWatchTradePlan(existingWatchItem.id, plan);
      return;
    }
    const categoryId = inferCategoryIdFromExchange(normalizeExchange(selected.exchange), categories);
    actions.addWatchItemWithPlan(
      { ticker: selected.ticker, exchange: normalizeExchange(selected.exchange), name: quote?.name ?? selected.name, categoryId },
      plan
    );
  }, [selected, existingWatchItem, actions, categories, quote]);

  const buyNowWithPlan = useCallback((plan: TradePlan, quantity: number) => {
    if (!selected || !quote) return;
    const categoryId = inferCategoryIdFromExchange(normalizeExchange(selected.exchange), categories);
    actions.openAddAssetWithPrefill({
      ticker: selected.ticker,
      exchange: normalizeExchange(selected.exchange),
      name: quote.name,
      currency: quote.currency,
      categoryId,
      quantity,
      purchasePrice: parseFloat(buyPrice) || quote.priceOriginal,
      plan,
    });
    actions.closeTradePlanPlanner();
  }, [selected, quote, actions, categories, buyPrice]);

  return {
    query, setQuery,
    results: queryTooShortOrSelected ? [] : results,
    isSearching,
    searchError: queryTooShortOrSelected ? null : searchError,
    selected, selectSymbol, clearSelection,
    quote, isQuoteLoading, quoteError,
    buyPrice, setBuyPrice,
    target,
    existingWatchItem, existingPlan,
    saveToWatchlist, buyNowWithPlan,
  };
}
