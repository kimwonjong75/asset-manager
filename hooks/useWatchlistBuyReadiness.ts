// hooks/useWatchlistBuyReadiness.ts
// 관심종목 '매수 점검' 칸 데이터 — watchlist × derived.enrichedMap 을 항목 id → BuyReadiness|null 로 메모이즈.
// ---------------------------------------------------------------------------
// · 신규 fetch 없음: useEnrichedIndicators 가 이미 관심종목 ticker 까지 배치 조회한 enrichedMap 만 읽는다.
// · 계산은 순수 utils/stockReview.computeBuyReadiness(종목 검토 매수 측과 같은 evalSpec 경로) —
//   입력 자산은 종목 검토 아코디언과 같은 watchlistToPseudoAsset(item), enriched 키도 같은 ticker.
// · 매수 추천이 아니다 — 조건 3개의 충족 현황(표시 전용, 저장 없음).

import { useMemo } from 'react';
import { usePortfolio } from '../contexts/PortfolioContext';
import type { WatchlistItem } from '../types';
import type { BuyReadiness } from '../types/stockReview';
import { computeBuyReadiness } from '../utils/stockReview';
import { watchlistToPseudoAsset } from '../utils/alertChecker';

export function useWatchlistBuyReadiness(watchlist: WatchlistItem[]): Map<string, BuyReadiness | null> {
  const { derived } = usePortfolio();
  const enrichedMap = derived.enrichedMap;

  return useMemo(() => {
    const out = new Map<string, BuyReadiness | null>();
    for (const item of watchlist) {
      out.set(item.id, computeBuyReadiness(watchlistToPseudoAsset(item), enrichedMap.get(item.ticker)));
    }
    return out;
  }, [watchlist, enrichedMap]);
}
