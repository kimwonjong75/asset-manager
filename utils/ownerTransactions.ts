import { Currency } from '../types';
import type { Asset, BuyRecord, SellRecord } from '../types';
import { isActiveAction } from '../types/actionQueue';
import { ALL_OWNERS, getAssetOwner, OWNER_LABELS, withoutJointLabel } from '../types/owner';
import type { OwnerId } from '../types/owner';
import type { OwnerSplitInput, OwnerSplitResult, OwnerTradeEntry } from '../types/ownerTransactions';
import type { PortfolioSaveSnapshot } from '../types/portfolioSave';
import { hasUnresolvedOwners, sameOwnerInstrument } from './ownerHoldings';
import { mergeSellRecords } from './sellRecords';

export function ownerTradeEntries(buys: BuyRecord[], sells: SellRecord[], assets: Asset[]): OwnerTradeEntry[] {
  const entries: OwnerTradeEntry[] = buys.map(buy => ({
    key: 'buy-' + buy.id, owner: buy.owner, name: buy.name, ticker: buy.ticker,
    date: buy.buyDate, side: '매수', quantity: buy.buyQuantity, quantityUnit: buy.quantityUnit, price: buy.buyPrice, currency: buy.currency,
  }));
  for (const sell of mergeSellRecords(sells, assets)) {
    const settled = sell.sellPriceSettlement != null && sell.settlementCurrency != null;
    const native = sell.sellPriceOriginal != null && sell.originalCurrency != null;
    entries.push({
      key: 'sell-' + sell.assetId + '-' + sell.id, owner: sell.owner, name: sell.name, ticker: sell.ticker,
      date: sell.sellDate, side: '매도', quantity: sell.sellQuantity, quantityUnit: sell.quantityUnit,
      price: (settled ? sell.sellPriceSettlement : native ? sell.sellPriceOriginal : sell.sellPrice) ?? sell.sellPrice,
      currency: (settled ? sell.settlementCurrency : native ? sell.originalCurrency : Currency.KRW) ?? Currency.KRW,
    });
  }
  return entries.reverse().sort((a,b) => b.date.localeCompare(a.date));
}

/** 시작 잔고 재분류. 연결된 과거 매도에는 당시 확인된 보유자만 남기고 거래 자체는 새로 만들지 않는다. */
export function splitOwnerHolding(
  snapshot: Pick<PortfolioSaveSnapshot, 'assets' | 'sellHistory' | 'actionQueue' | 'turtlePositions'>,
  input: OwnerSplitInput,
  newIds: Record<OwnerId, string>,
  date: string,
): OwnerSplitResult {
  const source = snapshot.assets.find(a => a.id === input.assetId);
  if (!source || !hasUnresolvedOwners(source) || source.quantity !== input.expectedQuantity) {
    return { ok: false, error: '원래 잔고가 변경되었습니다. 목록을 다시 열어 수량을 확인해주세요.' };
  }
  const total = input.balances.WONJONG.quantity + input.balances.YUSEON.quantity;
  const epsilon = 8 * Number.EPSILON * Math.max(source.quantity, total);
  if (!Number.isFinite(total) || total <= 0 || Math.abs(total - source.quantity) > epsilon) {
    return { ok: false, error: '두 사람의 수량 합계를 기존 보유 수량과 맞춰주세요.' };
  }
  if (snapshot.turtlePositions.some(p => p.assetId === source.id && p.status === 'open') ||
      snapshot.actionQueue.some(a => a.assetId === source.id && isActiveAction(a.status))) {
    return { ok: false, error: '기존 잔고에 연결된 터틀 포지션 또는 대기 주문이 있습니다. 해당 수량을 먼저 대조해주세요.' };
  }
  const children: Asset[] = [];
  for (const owner of ALL_OWNERS) {
    const { quantity, price, rate } = input.balances[owner];
    if (quantity === 0) continue;
    if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(price) || price <= 0 ||
        (source.currency !== Currency.KRW && (!Number.isFinite(rate) || rate <= 0))) {
      return { ok: false, error: OWNER_LABELS[owner] + '의 수량과 매입 단가·환율을 확인해주세요.' };
    }
    if (snapshot.assets.some(a => a.id !== source.id && !hasUnresolvedOwners(a) && getAssetOwner(a) === owner && sameOwnerInstrument(a,source))) {
      return { ok: false, error: OWNER_LABELS[owner] + '의 같은 종목이 이미 별도 등록되어 있습니다. 이 잔고와 중복되는지 먼저 확인해주세요.' };
    }
    const retainsPlan = owner === 'WONJONG' || input.balances.WONJONG.quantity === 0;
    children.push({
      ...source, id: newIds[owner], owner, quantity, purchasePrice: price, purchaseExchangeRate: source.currency === Currency.KRW ? 1 : rate,
      name: withoutJointLabel(source.name) || source.ticker || source.name,
      customName: source.customName ? withoutJointLabel(source.customName) || undefined : undefined,
      ownerAllocation: { sourceId: source.id, date }, sellTransactions: undefined,
      holdingPolicy: undefined,
      tradePlan: retainsPlan ? source.tradePlan : undefined, turtleDecisions: retainsPlan ? source.turtleDecisions : undefined,
    });
  }
  // 구 매도 중 원가가 보유 자산에서 조회되던 경우에만 기존 표시의 근거를 보관한다.
  const previousRate = source.purchaseExchangeRate ??
    (source.priceOriginal > 0 ? source.currentPrice / source.priceOriginal : 1);
  const sellHistory = mergeSellRecords(snapshot.sellHistory, [source]).map(sell => {
    if (sell.assetId !== source.id || sell.originalPurchasePrice != null) return sell;
    return { ...sell, originalPurchasePrice: source.purchasePrice,
      originalPurchaseExchangeRate: sell.originalPurchaseExchangeRate ?? previousRate,
      originalCurrency: sell.originalCurrency ?? source.currency };
  });
  return { ok: true, assets: snapshot.assets.flatMap(a => a.id === source.id ? children : [a]), sellHistory };
}
