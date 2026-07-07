// hooks/useTurtleActionReview.ts
// ---------------------------------------------------------------------------
// 터틀 자동 검토 훅 (자동 검토 Phase B) + opt-in 자동 생성 (Phase C).
//
// 설계 원칙:
//   · **평가는 자동, 저장은 명시 정책**: 검토는 읽기 전용(diagnoseTurtleActions, 저장 없음).
//     실제 큐 생성·저장은 ① 실행 큐의 "오늘 주문 생성" 버튼, ② turtleSettings.autoGenerateQueue
//     opt-in(기본 OFF, 하루 1회)일 때만 — "보이지 않는 쓰기 금지" 원칙과 양립.
//   · **경로 공유**: fetch→조립은 refreshActionQueue와 동일한 loadTurtleMarketSnapshot 사용.
//     프리뷰 건수 ≠ 실제 생성 건수 drift 차단 (generatedCount ≡ build 길이는 기존 테스트 앵커).
//   · PortfolioProvider 내부에서 호출되므로 usePortfolio() 대신 props 주입 (useAutoAlert 패턴).
//   · 검토는 세션 1회, 시세 준비 후(자동 업데이트 완료 or 오늘 이미 업데이트됨) 실행.
//     진단은 스냅샷 위에서 useMemo — actionQueue/설정 변경 시 재fetch 없이 즉시 재계산
//     (주문 생성/실행 직후 previewCount가 duplicate-pending으로 자동 감소).
//   · fail-closed: fetch 실패 시 프리뷰 0 + reviewFailed (실행 큐 수동 경로는 영향 없음).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Asset, ExchangeRates, WatchlistItem } from '../types';
import { TurtlePosition, TurtleSettings } from '../types/turtle';
import { ActionItem, TurtleActionDiagnostics } from '../types/actionQueue';
import {
  loadTurtleMarketSnapshot,
  turtleCandidateItems,
  TurtleMarketSnapshot,
} from './turtleMarketSnapshot';
import {
  buildTurtleActions,
  diagnoseTurtleActions,
  reconcileActionQueue,
  isSnoozeExpired,
  TurtleCandidateRef,
} from '../utils/actionQueueGenerator';
import { computeDeployedBudgetKRW } from '../utils/turtleMarketData';
import { buildTurtleReviewSummary, TurtleReviewSummary } from '../utils/turtleReview';
import { createLogger } from '../utils/logger';

const log = createLogger('TurtleReview');

/** 자동 생성(Phase C) 하루 1회 게이트 — 마지막 자동 생성 일자 (기기 로컬 정책) */
export const TURTLE_AUTOGEN_DATE_KEY = 'asset-manager-turtle-autogen-date';
/** 앱 자동 시세 업데이트 일자 키 (usePortfolioData/PortfolioContext와 동일 키) */
const LAST_AUTO_UPDATE_KEY = 'lastAutoUpdateDate';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface UseTurtleActionReviewProps {
  assets: Asset[];
  watchlist: WatchlistItem[];
  exchangeRates: ExchangeRates;
  turtlePositions: TurtlePosition[];
  turtleSettings: TurtleSettings;
  actionQueue: ActionItem[];
  hasAutoUpdated: boolean;
  isMarketLoading: boolean;
  /** 자동 생성(opt-in) 저장 경로 — context의 updateActionQueue와 동일 함수 주입 */
  updateActionQueue: (queue: ActionItem[]) => void;
}

export function useTurtleActionReview({
  assets,
  watchlist,
  exchangeRates,
  turtlePositions,
  turtleSettings,
  actionQueue,
  hasAutoUpdated,
  isMarketLoading,
  updateActionQueue,
}: UseTurtleActionReviewProps): {
  summary: TurtleReviewSummary;
  reviewDiagnostics: TurtleActionDiagnostics | null;
} {
  const [snapshot, setSnapshot] = useState<TurtleMarketSnapshot | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [reviewDone, setReviewDone] = useState(false);
  const [reviewFailed, setReviewFailed] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const hasReviewedRef = useRef(false); // 세션 1회 (StrictMode 이중 실행 방지 포함)
  const autoGenAttemptedRef = useRef(false);

  const today = todayISO();

  const openPositions = useMemo(
    () => turtlePositions.filter(p => p.status === 'open'),
    [turtlePositions],
  );
  const turtleCandidateCount = useMemo(
    () => watchlist.filter(w => w.isTurtleCandidate).length,
    [watchlist],
  );
  const hasTargets = turtleCandidateCount > 0 || openPositions.length > 0;

  // 시세 준비: 이 세션에서 자동 업데이트 완료 or 오늘 이미 업데이트됨(새로고침 재진입 — hasAutoUpdated는 false로 남음)
  const alreadyUpdatedToday = (() => {
    try { return localStorage.getItem(LAST_AUTO_UPDATE_KEY) === today; } catch { return false; }
  })();
  const pricesReady = (hasAutoUpdated || alreadyUpdatedToday) && !isMarketLoading;

  // ── 자동 검토 (세션 1회, 읽기 전용 — 저장 없음) ──
  useEffect(() => {
    if (hasReviewedRef.current || !pricesReady) return;
    if (!hasTargets) {
      // 대상 없음 — fetch 없이 검토 완료 처리 (프리뷰 0)
      hasReviewedRef.current = true;
      setReviewDone(true);
      return;
    }
    hasReviewedRef.current = true;
    setIsChecking(true);
    (async () => {
      try {
        const snap = await loadTurtleMarketSnapshot({
          assets, watchlist, turtlePositions, turtleSettings, exchangeRates, today,
        });
        setSnapshot(snap);
        setCheckedAt(nowHHMM());
      } catch (e) {
        log.error('터틀 자동 검토 실패:', e);
        setReviewFailed(true);
      } finally {
        setIsChecking(false);
        setReviewDone(true);
      }
    })();
  }, [pricesReady, hasTargets, assets, watchlist, turtlePositions, turtleSettings, exchangeRates, today]);

  // ── 진단 (순수 — 스냅샷 재사용, actionQueue/설정 변경 시 즉시 재계산) ──
  const reviewDiagnostics = useMemo<TurtleActionDiagnostics | null>(() => {
    if (!snapshot || snapshot.targetCount === 0) return null;
    const candidates: TurtleCandidateRef[] = turtleCandidateItems(watchlist)
      .map(w => ({ ticker: w.ticker, name: w.name }));
    const remainingBudgetKRW = Math.max(0, turtleSettings.satelliteBudgetKRW - computeDeployedBudgetKRW(openPositions));
    return diagnoseTurtleActions({
      positions: turtlePositions,
      candidates,
      marketByTicker: snapshot.marketByTicker,
      settings: turtleSettings,
      existingQueue: actionQueue,
      remainingBudgetKRW,
      today,
    });
  }, [snapshot, watchlist, turtlePositions, turtleSettings, actionQueue, openPositions, today]);

  // ── Phase C: 오늘 주문 자동 생성 (opt-in, 기본 OFF, 하루 1회) ──
  // refreshActionQueue의 생성 tail과 동일 입력·동일 순수 함수(buildTurtleActions/reconcileActionQueue).
  // 저장은 updateActionQueue(Drive autosave) — 사용자가 설정으로 명시 동의한 "보이는 정책"일 때만.
  useEffect(() => {
    if (!snapshot || snapshot.targetCount === 0 || autoGenAttemptedRef.current) return;
    if (!turtleSettings.autoGenerateQueue) return; // opt-in 아님 — ref 미설정(세션 중 켜면 즉시 동작)
    let lastGenDate: string | null = null;
    try { lastGenDate = localStorage.getItem(TURTLE_AUTOGEN_DATE_KEY); } catch { /* ignore */ }
    if (lastGenDate === today) { autoGenAttemptedRef.current = true; return; }
    autoGenAttemptedRef.current = true;

    const candidates: TurtleCandidateRef[] = turtleCandidateItems(watchlist)
      .map(w => ({ ticker: w.ticker, name: w.name }));
    const remainingBudgetKRW = Math.max(0, turtleSettings.satelliteBudgetKRW - computeDeployedBudgetKRW(openPositions));
    const generated = buildTurtleActions({
      positions: turtlePositions,
      candidates,
      marketByTicker: snapshot.marketByTicker,
      settings: turtleSettings,
      existingQueue: actionQueue,
      remainingBudgetKRW,
      today,
      makeId: (seq) => `aq-${today}-${Date.now().toString(36)}-${seq}`,
    });
    const hasRevival = actionQueue.some(it => isSnoozeExpired(it, today));
    if (generated.length > 0 || hasRevival) {
      updateActionQueue(reconcileActionQueue(actionQueue, generated, today));
    }
    try { localStorage.setItem(TURTLE_AUTOGEN_DATE_KEY, today); } catch { /* ignore */ }
    log.info(`오늘 주문 자동 생성 완료: ${generated.length}건 (opt-in)`);
  }, [snapshot, turtleSettings, watchlist, turtlePositions, openPositions, actionQueue, updateActionQueue, today]);

  // ── 통합 요약 (배지·브리핑 소비) ──
  const summary = useMemo<TurtleReviewSummary>(() => buildTurtleReviewSummary({
    queue: actionQueue,
    today,
    diagnostics: reviewDiagnostics,
    turtleCandidateCount,
    budgetMissing: !(turtleSettings.satelliteBudgetKRW > 0),
    isChecking,
    reviewPending: !reviewDone,
    reviewFailed,
    checkedAt,
  }), [actionQueue, today, reviewDiagnostics, turtleCandidateCount, turtleSettings.satelliteBudgetKRW, isChecking, reviewDone, reviewFailed, checkedAt]);

  return { summary, reviewDiagnostics };
}
