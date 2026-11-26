import type { Asset } from '../types';
import { DEFAULT_CATEGORIES, getCategoryBaseType, type CategoryDefinition } from '../types/category';

const quantities = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 12 });

export function getOwnerQuantityUnit(asset: Asset, categories: CategoryDefinition[] = DEFAULT_CATEGORIES): string {
  const base = getCategoryBaseType(asset.categoryId, categories);
  // 수량 1 × 금액 단가로 입력한 현금·RP를 통화 액면수량으로 오표시하지 않는다.
  if (base === 'CASH' || /(?:\bRP\b|환매조건)/i.test(asset.name)) {
    return asset.purchasePrice === 1 && (asset.priceOriginal === 1 || asset.currentPrice === 1)
      ? (asset.currency === 'KRW' ? '원' : asset.currency)
      : '단위';
  }
  if (asset.exchange === 'KRX 금시장' || asset.ticker === 'KRX-GOLD') return 'g';
  if (base?.endsWith('_STOCK')) return '주';
  if (base === 'CRYPTOCURRENCY') return '개';
  return '단위';
}

export function formatOwnerQuantity(asset: Asset, quantity = asset.quantity, categories = DEFAULT_CATEGORIES): string {
  const unit = getOwnerQuantityUnit(asset, categories);
  return quantities.format(quantity) + (/^[A-Z]+$/.test(unit) ? ' ' : '') + unit;
}
