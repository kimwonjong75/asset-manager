import type { Asset } from '../types';
import { getAssetOwner, type OwnerFilter } from '../types/owner';
import type { PortfolioOwnerGroup } from '../types/portfolioOwnerGroup';
import type { EnrichedAsset, SortDirection, SortKey } from '../types/ui';
import { hasUnresolvedOwners, sameOwnerInstrument } from './ownerHoldings';

/** 동일인·미확정 수량은 공동 보유 판정에 쓰지 않는다. */
export function sharedPortfolioHoldingIds(assets: Asset[]): Set<string> {
  const confirmed = assets.filter(a => a.quantity > 0 && !hasUnresolvedOwners(a));
  return new Set(confirmed.filter(a => confirmed.some(b =>
    getAssetOwner(a) !== getAssetOwner(b) && sameOwnerInstrument(a, b),
  )).map(a => a.id));
}

function summarize(holdings: EnrichedAsset[]): PortfolioOwnerGroup {
  const quantities: PortfolioOwnerGroup['quantities'] = {};
  let quantity = 0, currentValueKRW = 0, purchaseValueKRW = 0, profitLossKRW = 0, allocation = 0;
  for (const a of holdings) {
    if (!hasUnresolvedOwners(a)) {
      const owner = getAssetOwner(a);
      quantities[owner] = (quantities[owner] ?? 0) + a.quantity;
    }
    quantity += a.quantity;
    currentValueKRW += a.metrics.currentValueKRW;
    purchaseValueKRW += a.metrics.purchaseValueKRW;
    profitLossKRW += a.metrics.profitLossKRW;
    allocation += a.metrics.allocation;
  }
  return {
    key: JSON.stringify(holdings.map(a => a.id).sort()), holdings, quantities, quantity,
    currentValueKRW, purchaseValueKRW, profitLossKRW, allocation,
    returnPercentage: purchaseValueKRW > 0 ? 100 * profitLossKRW / purchaseValueKRW : null,
  };
}

/** 매수일·시세 등이 서로 다를 때 임의 한 사람의 값을 종목 값처럼 제시하지 않는다. */
export function commonHoldingValue<T extends string | number>(holdings: EnrichedAsset[], get: (a: EnrichedAsset) => T): T | null {
  if (holdings.length === 0) return null;
  const value = get(holdings[0]);
  return holdings.every(a => get(a) === value) ? value : null;
}

function sortValue(g: PortfolioOwnerGroup, key: Exclude<SortKey, 'maCrossDays'>): number | string | null {
  const items = g.holdings;
  switch (key) {
    case 'name': return (items.length === 1 ? items[0].customName?.trim() || items[0].name : commonHoldingValue(items, a => a.name) ?? items[0].ticker).toLowerCase();
    case 'quantity': return g.quantity;
    case 'allocation': return g.allocation;
    case 'profitLoss': case 'profitLossKRW': return g.profitLossKRW;
    case 'returnPercentage': return g.returnPercentage;
    case 'currentValue': return g.currentValueKRW;
    case 'purchaseValue': return g.purchaseValueKRW;
    case 'purchasePrice': return g.quantity > 0 ? g.purchaseValueKRW / g.quantity : null;
    case 'currentPrice': return commonHoldingValue(items, a => a.metrics.currentPriceKRW);
    case 'dropFromHigh': return commonHoldingValue(items, a => a.metrics.dropFromHigh);
    case 'purchaseDate': return commonHoldingValue(items, a => a.purchaseDate);
    case 'yesterdayChange': return commonHoldingValue(items, a => a.metrics.yesterdayChange);
  }
}

/** 필터를 통과한 실제 보유분만 집계한다. 개인 보기·동일인 중복·공동 표기 미확정은 개별 행으로 유지한다. */
export function buildPortfolioOwnerGroups(
  visible: EnrichedAsset[], view: OwnerFilter,
  sort: { key: SortKey; direction: SortDirection } | null,
): PortfolioOwnerGroup[] {
  const buckets: EnrichedAsset[][] = [];
  for (const a of visible) {
    const matches = view === 'ALL' && a.quantity > 0 && !hasUnresolvedOwners(a)
      ? buckets.find(([b]) => b.quantity > 0 && !hasUnresolvedOwners(b) && sameOwnerInstrument(a, b))
      : undefined;
    if (matches) matches.push(a);
    else buckets.push([a]);
  }
  const groups = buckets.flatMap(items => {
    const shared = items.some(a => getAssetOwner(a) !== getAssetOwner(items[0]));
    return shared ? [summarize(items)] : items.map(a => summarize([a]));
  }).sort((a, b) => visible.indexOf(a.holdings[0]) - visible.indexOf(b.holdings[0]));
  // GC/DC는 기존 교차일·신호 정렬 기준을 그대로 따른다. 개인 보기는 기존 정렬을 보존한다.
  if (view !== 'ALL' || !sort || sort.key === 'maCrossDays' || !groups.some(g => g.holdings.length > 1)) return groups;
  const key = sort.key;
  return groups.sort((a, b) => {
    const first = sortValue(a, key), second = sortValue(b, key);
    if (first === second) return 0;
    if (first === null) return 1;
    if (second === null) return -1;
    return (first < second ? -1 : 1) * (sort.direction === 'ascending' ? 1 : -1);
  });
}
