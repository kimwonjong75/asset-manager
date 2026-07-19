// hooks/useStockReview.ts
// "종목 검토" 패널의 상태/계산 담당 훅 — 메모이제이션 + 로딩/영구결측 판정 + 보유 매칭.
// ---------------------------------------------------------------------------
// 컴포넌트(StockReviewPanel)는 완성된 상태만 받아 렌더링만 한다("components는 UI 렌더링만" 규칙).
// enrichedMap/isEnrichedLoading/enrichedAssets는 PortfolioContext에서 읽고, ViewModel은 buildStockReviewViewModel(순수)로 산출.
// v1은 신규 fetch를 트리거하지 않는다 — enriched 미도착 시 로딩(준비 중) vs 영구결측(미지원)을 분리한다.
// Q6: source='watchlist'라도 동일 티커(+exchange)를 실제 보유 중이면 그 보유 자산을 holdingAsset으로 넘겨
//     DROP_FROM_HIGH·LOSS_THRESHOLD를 '해당 없음' 대신 실제 평가한다.

import { useMemo } from 'react';
import { usePortfolio } from '../contexts/PortfolioContext';
import type { EnrichedAsset } from '../types/ui';
import type { StockReviewViewModel } from '../types/stockReview';
import {
  buildStockReviewViewModel,
  formatLocalAsOfLabel,
  matchHoldings,
  consolidateHoldingAsset,
} from '../utils/stockReview';

export type StockReviewState =
  /** enabled=false (아코디언 접힘) — 계산 스킵 */
  | { kind: 'idle' }
  /** enriched 미도착 + 로딩 중 → 스켈레톤 */
  | { kind: 'loading' }
  /** enriched 미도착 + 로딩 아님 → 영구 결측(현금/미지원/조회 실패). 스피너 아님 */
  | { kind: 'unavailable' }
  /** 준비 완료 */
  | { kind: 'ready'; vm: StockReviewViewModel };

/**
 * @param enabled 아코디언이 펼쳐졌을 때만 true — 접혀 있으면 ViewModel 계산을 건너뛴다(불필요한 연산 방지).
 */
export function useStockReview(params: {
  asset: EnrichedAsset;
  source: 'portfolio' | 'watchlist';
  displayName: string;
  enabled: boolean;
}): StockReviewState {
  const { asset, source, displayName, enabled } = params;
  const { derived } = usePortfolio();
  const enriched = derived.enrichedMap.get(asset.ticker);
  const isEnrichedLoading = derived.isEnrichedLoading;
  const enrichedAssets = derived.enrichedAssets;

  // 보유 매칭(Q6·복수계정): 포트폴리오면 자기 자신(그 계정 포지션), 관심종목이면 정규화 ticker+exchange로
  // **매칭 보유 전체를 통합**(consolidateHoldingAsset — 결정론적, 임의 첫 선택 금지). 복수 계정이면 holdingNote 부여.
  const holding = useMemo<{ asset: EnrichedAsset | undefined; note: string | null }>(() => {
    if (source === 'portfolio') return { asset, note: null };
    const consolidated = consolidateHoldingAsset(matchHoldings(asset.ticker, asset.exchange, enrichedAssets));
    return { asset: consolidated?.asset, note: consolidated?.note ?? null };
  }, [source, asset, enrichedAssets]);

  return useMemo<StockReviewState>(() => {
    if (!enabled) return { kind: 'idle' };
    if (!enriched) return isEnrichedLoading ? { kind: 'loading' } : { kind: 'unavailable' };
    return {
      kind: 'ready',
      vm: buildStockReviewViewModel({
        asset,
        enriched,
        source,
        name: displayName,
        asOfLabel: formatLocalAsOfLabel(new Date()),
        holdingAsset: holding.asset,
        holdingNote: holding.note,
      }),
    };
  }, [enabled, enriched, isEnrichedLoading, asset, source, displayName, holding]);
}
