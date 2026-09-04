// hooks/usePriceFreshnessRefresh.ts
// 탭 복귀(visibilitychange→visible) 시 시세 신선도 재확인 — 앱을 켜 둔 채 오래 방치했다가
// 돌아왔을 때도 "보유 시장이 개장 중인데 30분 넘게 안 받았거나, 마감됐는데 확정 종가를
// 아직 못 받았으면" 갱신한다(P4 계획서 §5). `hooks/useMarketOverview.ts`의 동일 패턴(모듈이 아닌
// ref 기반 쿨다운 — 이 훅은 PortfolioContext 안에서 단 1회만 마운트되므로 컴포넌트 스코프
// ref로 충분하다)을 따른다.
//
// **보이지 않는 쓰기 아님**: 판정은 순수(`shouldRefreshPrices`)이고, 실제 갱신은 사용자가 이미
// 켜 둔 앱이 스스로 "오래된 값"을 새로고침하는 것뿐 — 데이터 삭제/변경 없음, 시세 갱신은
// 기존에도 자동 실행되던 동작(하루 1회 게이트)의 연장이다.
import { useEffect, useRef } from 'react';
import type { Asset, WatchlistItem } from '../types';
import { shouldRefreshPrices, LAST_PRICE_REFRESH_AT_KEY } from '../utils/priceFreshness';
import { classifyHoldingMarkets } from '../utils/holdingMarkets';

const COOLDOWN_MS = 10 * 60 * 1000; // 10분 — 연속 탭 전환에 매번 재요청하지 않도록

interface UsePriceFreshnessRefreshProps {
  isSignedIn: boolean;
  /** 시세 갱신 진행 중이면 재확인을 건너뛴다(중복 요청 방지) */
  isLoading: boolean;
  assets: Asset[];
  watchlist: WatchlistItem[];
  /** 게이트 통과 시 실제 갱신을 실행하는 콜백(PortfolioContext의 공용 실행자 주입) */
  refreshAllPrices: () => void;
}

export function usePriceFreshnessRefresh({
  isSignedIn,
  isLoading,
  assets,
  watchlist,
  refreshAllPrices,
}: UsePriceFreshnessRefreshProps): void {
  const lastAttemptRef = useRef<number>(0);

  // 리스너를 매 렌더 재등록하지 않도록 최신 값을 ref로 미러링(useMarketOverview와 동일 접근).
  const isSignedInRef = useRef(isSignedIn);
  const isLoadingRef = useRef(isLoading);
  const assetsRef = useRef(assets);
  const watchlistRef = useRef(watchlist);
  const refreshRef = useRef(refreshAllPrices);
  useEffect(() => { isSignedInRef.current = isSignedIn; }, [isSignedIn]);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);
  useEffect(() => { assetsRef.current = assets; }, [assets]);
  useEffect(() => { watchlistRef.current = watchlist; }, [watchlist]);
  useEffect(() => { refreshRef.current = refreshAllPrices; }, [refreshAllPrices]);

  useEffect(() => {
    const handleVisibilityChange = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (!isSignedInRef.current || isLoadingRef.current) return;

      const now = Date.now();
      if (now - lastAttemptRef.current < COOLDOWN_MS) return;

      let lastRefreshAt: string | null = null;
      try { lastRefreshAt = localStorage.getItem(LAST_PRICE_REFRESH_AT_KEY); } catch { /* ignore */ }

      const holdings = classifyHoldingMarkets(assetsRef.current, watchlistRef.current);
      const decision = shouldRefreshPrices({ lastRefreshAt, now: new Date(now).toISOString(), holdings });
      if (!decision.refresh) return;

      lastAttemptRef.current = now;
      refreshRef.current();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);
}
