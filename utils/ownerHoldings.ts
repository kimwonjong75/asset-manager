import { normalizeExchange } from '../types';
import type { Asset } from '../types';
import { isBaseType } from '../types/category';
import { withoutJointLabel } from '../types/owner';
import { getOwnerQuantityUnit } from './ownerQuantity';

export { hasUnresolvedOwners } from '../types/owner';

function instrumentMarket(exchange: string): string {
  const market = normalizeExchange(exchange).toUpperCase();
  return market === 'KRX (코스피/코스닥)' ? 'KRX' : market;
}

/** 이름이 같아도 시장·통화가 다르면 별도 보유분. RP는 만기 등 상품명도 일치해야 한다. */
export function sameOwnerInstrument(a: Asset, b: Asset): boolean {
  if (a.id && a.id === b.id) return true;
  const ticker = a.ticker.trim().toUpperCase();
  const market = instrumentMarket(a.exchange);
  if (!ticker || !market || !a.currency || a.currency !== b.currency ||
    ticker !== b.ticker.trim().toUpperCase() || market !== instrumentMarket(b.exchange)) return false;
  if (isBaseType(a.categoryId, 'CASH') || isBaseType(b.categoryId, 'CASH') || /^(CASH|RP|MANUAL|CUSTOM|KRW|USD|JPY|CNY)$/.test(ticker) ||
      /(?:^|[^A-Z])RP(?:[^A-Z]|$)/i.test(a.name + ' ' + b.name)) {
    const product = withoutJointLabel(a.name).replace(/\s/g, '').toUpperCase();
    return a.categoryId === b.categoryId && getOwnerQuantityUnit(a) === getOwnerQuantityUnit(b) &&
      !!product && product === withoutJointLabel(b.name).replace(/\s/g, '').toUpperCase();
  }
  return true;
}
