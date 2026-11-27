import { normalizeExchange } from '../types';
import type { ActionItem } from '../types/actionQueue';
import { isActiveAction } from '../types/actionQueue';
import { getAssetOwner } from '../types/owner';
import type { PortfolioSaveSnapshot } from '../types/portfolioSave';

/** 구 실행 큐는 원종 전용이다. 종목 ID가 없는 주문은 저장된 대표 종목의 거래소를 우선한다. */
export function allowsLegacyOrder(item: ActionItem, data: Pick<PortfolioSaveSnapshot,
  'assets' | 'watchlist' | 'sellHistory' | 'turtlePositions' | 'allocationTargets'>): boolean {
  if (!isActiveAction(item.status)) return true;
  const assetId = item.assetId ?? (item.positionId && data.turtlePositions.find(p => p.id === item.positionId)?.assetId);
  if (assetId) {
    const live = data.assets.find(a => a.id === assetId);
    if (live) return !live.holdingPolicy;
    return !data.sellHistory.some(r => r.assetId === assetId && r.closedHolding?.policy);
  }
  const instrument = data.allocationTargets.categoryInstruments?.[String(item.ruleSnapshot.categoryId)];
  const market = instrument?.exchange && normalizeExchange(instrument.exchange);
  const ticker = item.ticker.trim().toUpperCase();
  const matches = (symbol: string, exchange: string) =>
    symbol.trim().toUpperCase() === ticker && (!market || market === normalizeExchange(exchange));
  const held = data.assets.filter(a => getAssetOwner(a) === 'WONJONG' && matches(a.ticker, a.exchange));
  if (held.length) return !held.some(a => a.holdingPolicy);
  if (data.watchlist.some(w => getAssetOwner(w) === 'WONJONG' && w.holdingPolicy && matches(w.ticker, w.exchange))) return false;
  const latest = data.sellHistory.reduce<(typeof data.sellHistory)[number] | undefined>((last, row) =>
    row.owner === 'WONJONG' && row.closedHolding && matches(row.ticker, row.closedHolding.exchange)
      && (!last || row.sellDate >= last.sellDate) ? row : last, undefined);
  return !latest?.closedHolding?.policy;
}
