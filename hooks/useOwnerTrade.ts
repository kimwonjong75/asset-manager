import { useState } from 'react';
import { usePortfolio } from '../contexts/PortfolioContext';
import type { Asset } from '../types';
import type { BuyMoreResult } from '../types/assetActionResult';
import type { OwnerTradeTarget } from '../types/ownerTrade';
import { ALL_OWNERS, getAssetOwner, type OwnerId } from '../types/owner';
import { hasUnresolvedOwners, sameOwnerInstrument } from '../utils/ownerHoldings';

export function useOwnerTrade(source: Asset, side: 'buy' | 'sell') {
  const { data, modal } = usePortfolio();
  const [choice, choose] = useState<OwnerId | null>(null);
  const live = data.assets.find(a => a.id === source.id);
  const positions = data.assets.filter(a =>
    (a.id === source.id || sameOwnerInstrument(source, a)) && !hasUnresolvedOwners(a),
  );
  const byOwner = {
    WONJONG: positions.filter(a => getAssetOwner(a) === 'WONJONG'),
    YUSEON: positions.filter(a => getAssetOwner(a) === 'YUSEON'),
  };
  const canChoose = !!modal.pickTradeOwner;
  const held = ALL_OWNERS.filter(id => byOwner[id].some(a => a.quantity > 0));
  const defaultOwner = held.length === 1 ? held[0] : null;
  const owner = canChoose ? choice ?? defaultOwner : live ? getAssetOwner(live) : null;
  const matches = owner ? byOwner[owner] : [];
  const position = canChoose ? (matches.length === 1 ? matches[0] : null) : live ?? null;
  let issue: string | null = null;
  if (!live || (!canChoose && getAssetOwner(live) !== getAssetOwner(source))) issue = '선택한 보유 잔고가 변경됐습니다. 목록에서 다시 열어주세요.';
  else if (hasUnresolvedOwners(live)) issue = '두 사람의 수량을 먼저 확인하고 분할한 뒤 거래를 기록해주세요.';
  else if (canChoose && matches.length > 1) issue = '이 보유자에게 여러 잔고가 있습니다. 개별 보유 행에서 거래를 열어주세요.';
  else if (owner && side === 'sell' && (!position || position.quantity <= 0)) issue = '선택한 보유자의 매도 가능 수량이 없습니다.';
  const totalQuantity = positions.reduce((sum, a) => sum + a.quantity, 0);
  const target = live && owner && !issue ? { source: live, position, owner, totalQuantity } : null;
  return { byOwner, canChoose, choose, owner, issue, target };
}

export function useRecordOwnerBuy(target: OwnerTradeTarget) {
  const { actions } = usePortfolio();
  return async (date: string, price: number, quantity: number): Promise<BuyMoreResult> => {
    if (target.position) return actions.confirmBuyMore(target.position.id, date, price, quantity);
    const { ticker, exchange, name, currency, categoryId } = target.source;
    const result = await actions.addAsset({
      ticker, exchange, name, currency, categoryId, owner: target.owner,
      purchaseDate: date, purchasePrice: price, quantity,
    }, target.source.id);
    if (!result.ok) return result;
    actions.closeBuyModal();
    return { ok: true, assetId: result.assetId, updatedAsset: result.asset, nextAssets: result.nextAssets };
  };
}
