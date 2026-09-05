// utils/sellRecords.ts
// ---------------------------------------------------------------------------
// 매도 이력의 **단일 병합 지점** (순수). React 없음·부수효과 없음.
//
// 매도 기록은 두 곳에 나뉘어 있다:
//   ① `sellHistory[]`            — 전량 매도로 자산이 사라진 건 포함, 전체 이력
//   ② `asset.sellTransactions[]` — 부분 매도로 자산이 아직 남아 있는 건(자산에 인라인)
// 화면마다 따로 병합하다 보니 대청소 탭만 ②를 빠뜨려 세금 추정이 대시보드와 어긋나 있었다.
// 소비처: `SellAnalyticsPage`(수익통계) · `DashboardView`(수익통계 카드) · `CleanupView`(양도세 추정).
// ---------------------------------------------------------------------------

import { Asset, SellRecord } from '../types';

/**
 * `sellHistory` + 자산 인라인 `sellTransactions`를 하나의 목록으로 병합한다.
 *
 * 규약(기존 두 사본의 동작을 그대로 보존):
 *   · **`sellHistory`가 우선** — 같은 id가 양쪽에 있으면 `sellHistory` 쪽만 남는다.
 *   · 인라인 레코드는 소속 자산에서 `assetId/ticker/name/categoryId`를 채운 뒤
 *     트랜잭션 필드로 덮어쓴다(스프레드 순서 유지).
 *   · 중복 판정은 **`sellHistory`의 id 집합으로만** 한다. 서로 다른 자산이 같은 트랜잭션 id를
 *     들고 있는 비정상 데이터는 기존과 동일하게 둘 다 통과한다(여기서 조용히 지우지 않는다).
 *   · 반환 순서: `sellHistory` 전부 → 인라인(자산 순서 → 트랜잭션 순서).
 */
export const mergeSellRecords = (sellHistory: SellRecord[], assets: Asset[]): SellRecord[] => {
  const sellHistoryIds = new Set(sellHistory.map(r => r.id));
  const inlineRecords: SellRecord[] = [];

  for (const a of assets) {
    if (!a.sellTransactions || a.sellTransactions.length === 0) continue;
    for (const t of a.sellTransactions) {
      if (sellHistoryIds.has(t.id)) continue;
      inlineRecords.push({
        assetId: a.id,
        ticker: a.ticker,
        name: a.name,
        categoryId: a.categoryId,
        ...t,
      });
    }
  }

  return [...sellHistory, ...inlineRecords];
};
