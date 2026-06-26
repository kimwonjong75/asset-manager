// hooks/useSignalReplay.ts
// 신호 리플레이 오케스트레이션 — OHLCV fetch + 타임라인 계산 + as-of 네비 + 종목 검색.
// 순수 계산은 utils/signalReplay(buildReplayTimeline)·utils/replayEval 에 위임(이 훅은 데이터/상태/IO 담당).
// 1차(P1~P3): 라이브 구루 신호/KnowledgeBase 불변. 샌드박스 오버라이드는 이 화면 state 안에서만 적용.

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createLogger } from '../utils/logger';
import { usePortfolio } from '../contexts/PortfolioContext';
import {
  fetchStockHistoricalPrices, fetchCryptoHistoricalPrices,
  convertTickerForAPI, isCryptoExchange, type HistoricalPriceResult,
} from '../services/historicalPriceService';
import { searchSymbols } from '../services/symbolListService';
import { buildReplayTimeline } from '../utils/signalReplay';
import { applyRuleOverrides, mergeOverrides } from '../utils/ruleOverrides';
import type { SymbolSearchResult } from '../types';
import type { ReplayMode, ReplayTimeline, RuleOverride } from '../types/signalReplay';

const log = createLogger('SignalReplay');

export interface ReplaySymbol {
  ticker: string;
  name: string;
  exchange: string;
  categoryId: number;
}

const FETCH_START = '2015-01-01'; // ~10년
const WINDOW_OPTIONS = [126, 252, 504, 756] as const; // 6M / 1Y / 2Y / 3Y

interface UseSignalReplayParams {
  enabled: boolean;
}

export interface SignalReplayController {
  // 종목 선택/검색
  selected: ReplaySymbol | null;
  selectSymbol: (sym: ReplaySymbol) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchResults: SymbolSearchResult[];
  isSearching: boolean;
  // 데이터/계산 상태
  isFetching: boolean;
  isComputing: boolean;
  timeline: ReplayTimeline | null;
  fetchFailed: boolean;
  // 모드/윈도
  mode: ReplayMode;
  setMode: (m: ReplayMode) => void;
  windowTradingDays: number;
  setWindowTradingDays: (d: number) => void;
  windowOptions: readonly number[];
  // as-of 네비
  selectedIndex: number;
  selectedDate: string | null;
  selectIndex: (i: number) => void;
  selectDate: (date: string) => void;
  goPrevDay: () => void;
  goNextDay: () => void;
  goPrevSignal: () => void;
  goNextSignal: () => void;
  goLatest: () => void;
  // 샌드박스(P3에서 UI 연결) — 1차는 빈 상태 유지
  sandboxOverrides: RuleOverride[];
  setSandboxOverrides: (o: RuleOverride[]) => void;
}

export function useSignalReplay({ enabled }: UseSignalReplayParams): SignalReplayController {
  const { data, ui } = usePortfolio();
  const knowledgeBase = data.knowledgeBase;
  const alertRules = ui.alertSettings.rules;

  const [selected, setSelected] = useState<ReplaySymbol | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SymbolSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [history, setHistory] = useState<HistoricalPriceResult | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [mode, setMode] = useState<ReplayMode>('replay');
  const [windowTradingDays, setWindowTradingDays] = useState<number>(252);
  const [anchorDate] = useState<string | undefined>(undefined);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [timeline, setTimeline] = useState<ReplayTimeline | null>(null);
  const [isComputing, setIsComputing] = useState(false);
  const [sandboxOverrides, setSandboxOverrides] = useState<RuleOverride[]>([]);

  const fetchReqId = useRef(0);

  // ── 종목 검색 (debounce 250ms) ──
  useEffect(() => {
    if (!enabled) return;
    const q = searchQuery.trim();
    if (!q) { setSearchResults([]); setIsSearching(false); return; }
    setIsSearching(true);
    let cancelled = false;
    const id = setTimeout(() => {
      searchSymbols(q)
        .then(r => { if (!cancelled) { setSearchResults(r); setIsSearching(false); } })
        .catch(() => { if (!cancelled) { setSearchResults([]); setIsSearching(false); } });
    }, 250);
    return () => { cancelled = true; clearTimeout(id); };
  }, [searchQuery, enabled]);

  // ── OHLCV fetch (선택 종목 변경 시, 10년) ──
  useEffect(() => {
    if (!enabled || !selected) { setHistory(null); return; }
    const reqId = ++fetchReqId.current;
    setIsFetching(true);
    setFetchFailed(false);
    const crypto = isCryptoExchange(selected.exchange);
    const apiTicker = crypto ? selected.ticker : convertTickerForAPI(selected.ticker, selected.exchange);
    const endDate = new Date().toISOString().slice(0, 10);
    const fetcher = crypto ? fetchCryptoHistoricalPrices : fetchStockHistoricalPrices;
    fetcher([apiTicker], FETCH_START, endDate)
      .then(res => {
        if (reqId !== fetchReqId.current) return; // 레이스 가드
        const h = res[apiTicker] ?? Object.values(res)[0] ?? null;
        const ok = !!(h && h.data && Object.keys(h.data).length > 0);
        setHistory(ok ? h : null);
        setFetchFailed(!ok);
        setIsFetching(false);
      })
      .catch(err => {
        if (reqId !== fetchReqId.current) return;
        log.error('replay fetch error', err);
        setHistory(null); setFetchFailed(true); setIsFetching(false);
      });
  }, [enabled, selected]);

  // ── 유효 규칙(시드 ⊕ 샌드박스 오버라이드) — 1차엔 영구 오버라이드 없음 ──
  const effectiveGuruRules = useMemo(
    () => applyRuleOverrides(knowledgeBase.rules, mergeOverrides([], sandboxOverrides)),
    [knowledgeBase.rules, sandboxOverrides],
  );

  // ── 타임라인 계산 (한 틱 양보 후 동기 빌드 — 252일/단일 종목 기준 충분; 느리면 후속 청크화) ──
  useEffect(() => {
    if (!enabled || !selected || !history || !history.data) { setTimeline(null); return; }
    setIsComputing(true);
    const id = setTimeout(() => {
      try {
        const tl = buildReplayTimeline({
          ticker: selected.ticker, name: selected.name, history,
          guruRules: effectiveGuruRules, claims: knowledgeBase.claims, alertRules,
          now: new Date(), anchorDate, windowTradingDays,
        });
        setTimeline(tl);
        setSelectedIndex(tl.days.length > 0 ? tl.days.length - 1 : 0); // 기본 최신일
      } catch (err) {
        log.error('replay timeline build error', err);
        setTimeline(null);
      } finally {
        setIsComputing(false);
      }
    }, 0);
    return () => clearTimeout(id);
  }, [enabled, selected, history, effectiveGuruRules, knowledgeBase.claims, alertRules, anchorDate, windowTradingDays]);

  // ── 네비 ──
  const days = timeline?.days ?? [];
  const selectedDate = days[selectedIndex]?.date ?? null;

  const selectIndex = useCallback((i: number) => {
    setSelectedIndex(prev => {
      const max = (timeline?.days.length ?? 1) - 1;
      return Math.max(0, Math.min(max, i));
    });
  }, [timeline]);

  const selectDate = useCallback((date: string) => {
    const ds = timeline?.days;
    if (!ds || ds.length === 0) return;
    // 정확 일치 우선, 없으면 date 이하의 가장 가까운 날.
    let idx = ds.findIndex(d => d.date === date);
    if (idx < 0) { for (let i = 0; i < ds.length; i++) { if (ds[i].date <= date) idx = i; else break; } }
    if (idx >= 0) setSelectedIndex(idx);
  }, [timeline]);

  const goPrevDay = useCallback(() => selectIndex(selectedIndex - 1), [selectIndex, selectedIndex]);
  const goNextDay = useCallback(() => selectIndex(selectedIndex + 1), [selectIndex, selectedIndex]);
  const goLatest = useCallback(() => selectIndex((timeline?.days.length ?? 1) - 1), [selectIndex, timeline]);

  const goPrevSignal = useCallback(() => {
    const ds = timeline?.days; const sig = timeline?.signalDates;
    if (!ds || !sig || !selectedDate) return;
    const prev = [...sig].reverse().find(d => d < selectedDate);
    if (prev) selectDate(prev);
  }, [timeline, selectedDate, selectDate]);

  const goNextSignal = useCallback(() => {
    const sig = timeline?.signalDates;
    if (!sig || !selectedDate) return;
    const next = sig.find(d => d > selectedDate);
    if (next) selectDate(next);
  }, [timeline, selectedDate, selectDate]);

  const selectSymbol = useCallback((sym: ReplaySymbol) => {
    setSelected(sym);
    setSearchQuery('');
    setSearchResults([]);
    setTimeline(null);
    setSandboxOverrides([]);
  }, []);

  return {
    selected, selectSymbol,
    searchQuery, setSearchQuery, searchResults, isSearching,
    isFetching, isComputing, timeline, fetchFailed,
    mode, setMode, windowTradingDays, setWindowTradingDays, windowOptions: WINDOW_OPTIONS,
    selectedIndex, selectedDate, selectIndex, selectDate,
    goPrevDay, goNextDay, goPrevSignal, goNextSignal, goLatest,
    sandboxOverrides, setSandboxOverrides,
  };
}
