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
import {
  loadVerdicts, saveVerdicts, upsertVerdict, removeVerdict, findVerdict,
  verdictsForTicker, datesWithVerdict,
} from '../utils/replayVerdicts';
import {
  loadCases, saveCases, buildVerificationCase, upsertCase, removeCase,
  collectPerRuleResults, diffCaseResults, type CaseDiff,
} from '../utils/replayCases';
import {
  setLeafValue, setBetweenBound, setLeafEnabled, clearLeafOverride, clearRuleOverrides,
  describeRuleLeaves,
} from '../utils/ruleSandbox';
import { computeSignalPerformance, type SignalPerformance } from '../utils/replayPerformance';
import { computeWinRateDiagnostics, type WinRateDiagnostics, type VerdictReturn } from '../utils/winRateDiagnostics';
import { buildReplayExport, serializeReplayExport, parseReplayExport } from '../utils/replayExport';
import { partitionReplayRecordsByAge } from '../utils/replayRecordsCompaction';
import type { SymbolSearchResult } from '../types';
import type { KnowledgeRule } from '../types/knowledge';
import type {
  ReplayMode, ReplayTimeline, RuleOverride, SignalVerdict, SignalVerdictKind,
  VerificationCase, ReplayCaseRole,
} from '../types/signalReplay';

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
  selectSymbolAtDate: (sym: ReplaySymbol, date: string) => void; // 모아보기에서 종목+as-of 동시 점프(④)
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
  // 샌드박스(P3) — 구루 leaf "값 + on/off" 비파괴 조정. 라이브/시드 불변, 리플레이 화면 state 한정.
  sandboxOverrides: RuleOverride[];
  setSandboxOverrides: (o: RuleOverride[]) => void;
  sandboxRules: KnowledgeRule[];                    // 조정 대상(시드 signal 규칙) — 패널이 describeRuleLeaves 로 렌더
  sandboxSetValue: (ruleId: string, leafId: string, value: number) => void;
  sandboxSetBetween: (ruleId: string, leafId: string, which: 'min' | 'max', n: number) => void;
  sandboxSetEnabled: (ruleId: string, leafId: string, enabled: boolean) => void;
  sandboxResetLeaf: (ruleId: string, leafId: string) => void;
  sandboxResetRule: (ruleId: string) => void;
  sandboxResetAll: () => void;
  sandboxDiff: CaseDiff | null;                     // 기준(샌드박스 적용 전) 대비 현재 신호일 변화
  // 신호 사용자 판정(P2) — localStorage `asset-manager-replay-verdicts-v1`
  verdictFor: (date: string, ruleId?: string) => SignalVerdict | undefined;
  setVerdict: (date: string, kind: SignalVerdictKind, memo?: string, ruleId?: string) => void;
  clearVerdict: (date: string, ruleId?: string) => void;
  verdictDates: Set<string>;            // 현재 종목 중 판정 존재 날짜(구분 표시용)
  tickerVerdicts: SignalVerdict[];      // 현재 종목 판정 목록(최신 날짜 우선)
  // 검증 사례(P2) — localStorage `asset-manager-replay-cases-v1`
  cases: VerificationCase[];
  saveCurrentCase: (caseRole: ReplayCaseRole, memo: string) => VerificationCase | null;
  deleteCase: (id: string) => void;
  loadCase: (c: VerificationCase) => void;
  comparingCase: VerificationCase | null;
  caseDiff: CaseDiff | null;            // 저장 당시 vs 재실행 신호일 diff
  endComparison: () => void;
  // 규칙별 성과 집계(③) — 현재 윈도 신호의 복기 성과(미래 종가 기반)
  performance: SignalPerformance[];
  // 손익비×승률 진단 — 현재 종목·기간 판정(verdict)을 승/패로 분류 + 신호 후 수익률로 손익비/손익분기
  winRateDiagnostics: WinRateDiagnostics;
  // 놓친 매수/매도 모아보기(④) — 전 종목 누적(최신 날짜 우선)
  missedVerdicts: SignalVerdict[];
  // 검증 기록 백업(⑤) — JSON 파일 내보내기/병합 가져오기
  exportReplayRecords: () => void;
  importReplayRecords: (file: File) => Promise<{ verdicts: number; cases: number }>;
  // 오래된 기록 정리(P6) — createdAt 1년(365일) 경과분만 명시적 확인 후 삭제(자동 캡 없음)
  replayCompactablePreview: { verdicts: number; cases: number }; // 정리 대상 미리보기 카운트
  clearOldReplayRecords: (opts?: { olderThanDays?: number }) => { removedVerdicts: number; removedCases: number };
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
  const [windowTradingDays, setWindowTradingDaysState] = useState<number>(252);
  const [anchorDate, setAnchorDate] = useState<string | undefined>(undefined);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [timeline, setTimeline] = useState<ReplayTimeline | null>(null);
  const [baselineTimeline, setBaselineTimeline] = useState<ReplayTimeline | null>(null);
  const [isComputing, setIsComputing] = useState(false);
  const [sandboxOverrides, setSandboxOverrides] = useState<RuleOverride[]>([]);
  const [verdicts, setVerdicts] = useState<SignalVerdict[]>([]);
  const [cases, setCases] = useState<VerificationCase[]>([]);
  const [comparingCase, setComparingCase] = useState<VerificationCase | null>(null);

  const fetchReqId = useRef(0);
  const caseSeq = useRef(0);
  const structuralKeyRef = useRef('');   // 종목/윈도/기간/데이터 변경 감지(샌드박스 tweak 시 as-of 보존용)
  const pendingDateRef = useRef<string | null>(null); // 모아보기 점프(④): 새 종목 타임라인 준비 시 이 날짜로 이동

  const hasSandbox = sandboxOverrides.length > 0;

  // ── 판정/사례 localStorage 로드(마운트 시 1회 — 탭 재진입마다 최신 반영) ──
  useEffect(() => {
    setVerdicts(loadVerdicts());
    setCases(loadCases());
  }, []);

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
        // 종목/윈도/기간/데이터가 바뀌면 최신일로, 샌드박스 tweak(규칙만 변경)이면 as-of 위치 보존(클램프).
        const key = `${selected.ticker}|${windowTradingDays}|${anchorDate ?? ''}|${Object.keys(history.data ?? {}).length}`;
        const lastIdx = tl.days.length > 0 ? tl.days.length - 1 : 0;
        if (structuralKeyRef.current !== key) {
          structuralKeyRef.current = key;
          // 모아보기 점프로 들어온 경우(pendingDate) 그 날짜 이하 가장 가까운 거래일로, 아니면 최신일.
          const pending = pendingDateRef.current;
          pendingDateRef.current = null;
          if (pending && tl.days.length > 0) {
            let idx = -1;
            for (let i = 0; i < tl.days.length; i++) { if (tl.days[i].date <= pending) idx = i; else break; }
            setSelectedIndex(idx >= 0 ? idx : lastIdx);
          } else {
            setSelectedIndex(lastIdx);
          }
        } else {
          setSelectedIndex(prev => Math.max(0, Math.min(prev, lastIdx)));
        }
      } catch (err) {
        log.error('replay timeline build error', err);
        setTimeline(null);
      } finally {
        setIsComputing(false);
      }
    }, 0);
    return () => clearTimeout(id);
  }, [enabled, selected, history, effectiveGuruRules, knowledgeBase.claims, alertRules, anchorDate, windowTradingDays]);

  // ── 기준(baseline) 타임라인 = 샌드박스 적용 *전*(시드 규칙) 결과. 샌드박스 활성일 때만 계산(diff 비교용). ──
  // 시드/윈도/종목/기간에만 의존 → 샌드박스 값 tweak마다 재계산되지 않음(override 값은 deps 아님).
  useEffect(() => {
    if (!enabled || !selected || !history || !history.data || !hasSandbox) { setBaselineTimeline(null); return; }
    const id = setTimeout(() => {
      try {
        setBaselineTimeline(buildReplayTimeline({
          ticker: selected.ticker, name: selected.name, history,
          guruRules: knowledgeBase.rules, claims: knowledgeBase.claims, alertRules,
          now: new Date(), anchorDate, windowTradingDays,
        }));
      } catch (err) {
        log.error('replay baseline build error', err);
        setBaselineTimeline(null);
      }
    }, 0);
    return () => clearTimeout(id);
  }, [enabled, selected, history, hasSandbox, knowledgeBase.rules, knowledgeBase.claims, alertRules, anchorDate, windowTradingDays]);

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
    pendingDateRef.current = null; // 일반 선택은 최신일로(점프 아님)
    setSelected(sym);
    setSearchQuery('');
    setSearchResults([]);
    setTimeline(null);
    setSandboxOverrides([]);
    setAnchorDate(undefined);   // 최신 윈도로 복귀
    setComparingCase(null);     // 사례 비교 컨텍스트 종료
  }, []);

  // 모아보기(④)에서 종목+as-of 동시 점프 — 새 종목이면 fetch 후 타임라인 준비 시 pendingDate로 이동,
  // 같은 종목이면 곧장 selectDate(타임라인 이미 로드됨).
  const selectSymbolAtDate = useCallback((sym: ReplaySymbol, date: string) => {
    if (selected?.ticker === sym.ticker) { selectDate(date); return; }
    pendingDateRef.current = date;
    setSelected(sym);
    setSearchQuery('');
    setSearchResults([]);
    setTimeline(null);
    setSandboxOverrides([]);
    setAnchorDate(undefined);
    setComparingCase(null);
  }, [selected, selectDate]);

  // 윈도 변경은 사례 비교 컨텍스트를 깨므로 비교 종료(같은 종목·다른 기간 = 비교 불가).
  const setWindowTradingDays = useCallback((d: number) => {
    setWindowTradingDaysState(d);
    setComparingCase(null);
  }, []);

  // ── 신호 사용자 판정(P2) ──
  const verdictFor = useCallback(
    (date: string, ruleId?: string) =>
      (selected ? findVerdict(verdicts, selected.ticker, date, ruleId) : undefined),
    [verdicts, selected],
  );

  const setVerdict = useCallback(
    (date: string, kind: SignalVerdictKind, memo?: string, ruleId?: string) => {
      if (!selected) return;
      const v: SignalVerdict = {
        ticker: selected.ticker, date, ruleId,
        kind, memo: memo?.trim() ? memo.trim() : undefined,
        createdAt: new Date().toISOString(),
      };
      setVerdicts(prev => { const next = upsertVerdict(prev, v); saveVerdicts(next); return next; });
    },
    [selected],
  );

  const clearVerdict = useCallback((date: string, ruleId?: string) => {
    if (!selected) return;
    setVerdicts(prev => {
      const next = removeVerdict(prev, selected.ticker, date, ruleId);
      saveVerdicts(next);
      return next;
    });
  }, [selected]);

  const verdictDates = useMemo(
    () => (selected ? datesWithVerdict(verdicts, selected.ticker) : new Set<string>()),
    [verdicts, selected],
  );
  const tickerVerdicts = useMemo(
    () => (selected ? verdictsForTicker(verdicts, selected.ticker) : []),
    [verdicts, selected],
  );

  // ── 검증 사례(P2) ──
  const saveCurrentCase = useCallback(
    (caseRole: ReplayCaseRole, memo: string): VerificationCase | null => {
      if (!selected || !timeline || timeline.days.length === 0) return null;
      const anchor = timeline.days[timeline.days.length - 1].date; // 실제 윈도 종료 거래일
      const id = `case-${Date.now().toString(36)}-${caseSeq.current++}`;
      const c = buildVerificationCase({
        id, createdAt: new Date().toISOString(),
        ticker: selected.ticker, name: selected.name, exchange: selected.exchange, categoryId: selected.categoryId,
        caseRole, anchorDate: anchor, windowTradingDays,
        effectiveRules: effectiveGuruRules,
        overridesSnapshot: mergeOverrides([], sandboxOverrides), // P2: []
        timeline,
        verdicts: verdictsForTicker(verdicts, selected.ticker),
        memo,
      });
      setCases(prev => { const next = upsertCase(prev, c); saveCases(next); return next; });
      return c;
    },
    [selected, timeline, windowTradingDays, effectiveGuruRules, sandboxOverrides, verdicts],
  );

  const deleteCase = useCallback((id: string) => {
    setCases(prev => { const next = removeCase(prev, id); saveCases(next); return next; });
    setComparingCase(prev => (prev?.id === id ? null : prev));
  }, []);

  const loadCase = useCallback((c: VerificationCase) => {
    setSelected({ ticker: c.ticker, name: c.name, exchange: c.exchange, categoryId: c.categoryId });
    setWindowTradingDaysState(c.windowTradingDays);
    setAnchorDate(c.anchorDate);
    setComparingCase(c);
    setSearchQuery('');
    setSearchResults([]);
    setTimeline(null);
    setSandboxOverrides(c.overridesSnapshot ?? []); // 튜닝 사례면 그 오버라이드 복원(P2 사례는 [])
  }, []);

  const endComparison = useCallback(() => {
    setComparingCase(null);
    setAnchorDate(undefined); // 최신 윈도로 복귀
  }, []);

  // 재실행 결과(현재 타임라인)와 저장 당시(comparingCase) 신호일 diff — 종목·윈도가 일치할 때만.
  const caseDiff = useMemo<CaseDiff | null>(() => {
    if (!comparingCase || !timeline) return null;
    if (comparingCase.ticker !== timeline.ticker) return null;
    if (comparingCase.windowTradingDays !== windowTradingDays) return null;
    return diffCaseResults(comparingCase.perRuleResults, collectPerRuleResults(timeline.days));
  }, [comparingCase, timeline, windowTradingDays]);

  // ── 샌드박스(P3) — 조정 대상 = 시드 signal 규칙(조건 있음). 패널이 describeRuleLeaves(rule, sandboxOverrides)로 렌더 ──
  const sandboxRules = useMemo(
    () => knowledgeBase.rules.filter(r => r.computability === 'signal' && r.condition),
    [knowledgeBase.rules],
  );

  const sandboxSetValue = useCallback((ruleId: string, leafId: string, value: number) => {
    setSandboxOverrides(prev => setLeafValue(prev, ruleId, leafId, value));
  }, []);
  // between 은 prev(최신 override)에서 현재 leaf 를 다시 읽어 반대쪽 bound 를 보존(스냅샷 stale 방지).
  const sandboxSetBetween = useCallback((ruleId: string, leafId: string, which: 'min' | 'max', n: number) => {
    setSandboxOverrides(prev => {
      const rule = sandboxRules.find(r => r.id === ruleId);
      if (!rule) return prev;
      const leaf = describeRuleLeaves(rule, prev).find(l => l.leafId === leafId);
      if (!leaf) return prev;
      return setBetweenBound(prev, ruleId, leaf, which, n);
    });
  }, [sandboxRules]);
  const sandboxSetEnabled = useCallback((ruleId: string, leafId: string, enabled: boolean) => {
    setSandboxOverrides(prev => setLeafEnabled(prev, ruleId, leafId, enabled));
  }, []);
  const sandboxResetLeaf = useCallback((ruleId: string, leafId: string) => {
    setSandboxOverrides(prev => clearLeafOverride(prev, ruleId, leafId));
  }, []);
  const sandboxResetRule = useCallback((ruleId: string) => {
    setSandboxOverrides(prev => clearRuleOverrides(prev, ruleId));
  }, []);
  const sandboxResetAll = useCallback(() => setSandboxOverrides([]), []);

  // 기준(샌드박스 적용 전) 대비 현재 신호일 변화 — 샌드박스 활성 + 두 타임라인 준비 시.
  const sandboxDiff = useMemo<CaseDiff | null>(() => {
    if (!hasSandbox || !timeline || !baselineTimeline) return null;
    return diffCaseResults(collectPerRuleResults(baselineTimeline.days), collectPerRuleResults(timeline.days));
  }, [hasSandbox, timeline, baselineTimeline]);

  // ── 규칙별 성과 집계(③) — 현재 윈도 신호의 복기 성과(미래 종가 기반, 신호 계산 무관) ──
  const performance = useMemo(() => (timeline ? computeSignalPerformance(timeline) : []), [timeline]);

  // ── 손익비×승률 진단 — 현재 종목·기간(timeline 윈도) 내 판정을 신호 후 실현 수익률(ret20)과 조인 ──
  // 윈도 거래일에 한정(win-rate 분모와 크기 평균의 표본 정합) — 윈도 밖 판정은 forward-return 이 없어 제외.
  // 절대값 손익비/손익분기 수학은 utils/winRateDiagnostics(순수)에 위임. 판정 없으면 빈 진단(패널이 안내).
  const winRateDiagnostics = useMemo<WinRateDiagnostics>(() => {
    if (!timeline) return computeWinRateDiagnostics([]);
    const ret20ByDate = new Map<string, number | null>();
    for (const d of timeline.days) ret20ByDate.set(d.date, d.outcome.ret20);
    const samples: VerdictReturn[] = tickerVerdicts
      .filter(v => ret20ByDate.has(v.date))
      .map(v => ({ kind: v.kind, ret: ret20ByDate.get(v.date) ?? null }));
    return computeWinRateDiagnostics(samples);
  }, [timeline, tickerVerdicts]);

  // ── 놓친 매수/매도 모아보기(④) — 전 종목 누적(최신 날짜 우선) ──
  const missedVerdicts = useMemo(
    () => verdicts
      .filter(v => v.kind === 'missed-buy' || v.kind === 'missed-sell')
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date)),
    [verdicts],
  );

  // ── 검증 기록 백업(⑤) — JSON 파일 내보내기 / 병합 가져오기(localStorage 유실 대비) ──
  const exportReplayRecords = useCallback(() => {
    const text = serializeReplayExport(buildReplayExport(verdicts, cases, new Date().toISOString()));
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `replay-records-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [verdicts, cases]);

  const importReplayRecords = useCallback(async (file: File): Promise<{ verdicts: number; cases: number }> => {
    const text = await file.text();
    const { verdicts: vs, cases: cs } = parseReplayExport(text);
    if (vs.length) {
      setVerdicts(prev => {
        let next = prev;
        for (const v of vs) next = upsertVerdict(next, v);
        saveVerdicts(next);
        return next;
      });
    }
    if (cs.length) {
      setCases(prev => {
        let next = prev;
        for (const c of cs) next = upsertCase(next, c);
        saveCases(next);
        return next;
      });
    }
    return { verdicts: vs.length, cases: cs.length };
  }, []);

  // ── 오래된 기록 정리(P6) — createdAt 1년 경과분만 명시적 확인 후 삭제 ──
  // 정책: 자동 캡/삭제 금지(사용자 연구 데이터). 미리보기 카운트는 훅에서 파생(컴포넌트는 UI-only 유지).
  const replayCompactablePreview = useMemo(() => {
    const r = partitionReplayRecordsByAge(verdicts, cases, { nowISO: new Date().toISOString() });
    return { verdicts: r.removedVerdicts.length, cases: r.removedCases.length };
  }, [verdicts, cases]);

  const clearOldReplayRecords = useCallback(
    (opts?: { olderThanDays?: number }): { removedVerdicts: number; removedCases: number } => {
      const r = partitionReplayRecordsByAge(verdicts, cases, {
        nowISO: new Date().toISOString(),
        olderThanDays: opts?.olderThanDays,
      });
      if (r.removedVerdicts.length === 0 && r.removedCases.length === 0) {
        return { removedVerdicts: 0, removedCases: 0 };
      }
      if (r.removedVerdicts.length > 0) {
        setVerdicts(r.keptVerdicts);
        saveVerdicts(r.keptVerdicts);
      }
      if (r.removedCases.length > 0) {
        setCases(r.keptCases);
        saveCases(r.keptCases);
      }
      return { removedVerdicts: r.removedVerdicts.length, removedCases: r.removedCases.length };
    },
    [verdicts, cases],
  );

  return {
    selected, selectSymbol, selectSymbolAtDate,
    searchQuery, setSearchQuery, searchResults, isSearching,
    isFetching, isComputing, timeline, fetchFailed,
    mode, setMode, windowTradingDays, setWindowTradingDays, windowOptions: WINDOW_OPTIONS,
    selectedIndex, selectedDate, selectIndex, selectDate,
    goPrevDay, goNextDay, goPrevSignal, goNextSignal, goLatest,
    sandboxOverrides, setSandboxOverrides,
    sandboxRules, sandboxSetValue, sandboxSetBetween, sandboxSetEnabled,
    sandboxResetLeaf, sandboxResetRule, sandboxResetAll, sandboxDiff,
    verdictFor, setVerdict, clearVerdict, verdictDates, tickerVerdicts,
    cases, saveCurrentCase, deleteCase, loadCase, comparingCase, caseDiff, endComparison,
    performance, winRateDiagnostics, missedVerdicts, exportReplayRecords, importReplayRecords,
    replayCompactablePreview, clearOldReplayRecords,
  };
}
