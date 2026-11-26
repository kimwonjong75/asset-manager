import { normalizeExchange, type Asset } from '../types';
import { DEFAULT_CATEGORIES, getCategoryBaseType, inferBaseTypeFromExchange, type CategoryDefinition } from '../types/category';
import { isCryptoExchange } from '../services/historicalPriceService';
import { resolveMarketTz } from './todayTurtle';

const quantities = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 12 });

export function getOwnerQuantityUnit(asset: Asset, categories: CategoryDefinition[] = DEFAULT_CATEGORIES): string {
  const base = getCategoryBaseType(asset.categoryId, categories);
  // 수량 1 × 금액 단가로 입력한 현금·RP를 통화 액면수량으로 오표시하지 않는다.
  if (base === 'CASH' || /(?:\bRP\b|환매조건)/i.test(asset.name)) {
    return asset.purchasePrice === 1 && (asset.priceOriginal === 1 || asset.currentPrice === 1)
      ? (asset.currency === 'KRW' ? '원' : asset.currency)
      : '단위';
  }
  const exchange = normalizeExchange(asset.exchange ?? '').toUpperCase();
  if (exchange.includes('금시장') || asset.ticker?.trim().toUpperCase() === 'KRX-GOLD') return 'g';
  if (isCryptoExchange(exchange)) return '개';
  // 테마는 여러 거래 상품을 담을 수 있다. 시장이 확인된 상장 주식·ETF는 주 단위를 쓴다.
  if (resolveMarketTz(exchange, false) !== 'UNKNOWN' || inferBaseTypeFromExchange(exchange) === 'FOREIGN_STOCK') return '주';
  if (base?.endsWith('_STOCK')) return '주';
  if (base === 'CRYPTOCURRENCY') return '개';
  return '단위';
}

export function formatOwnerQuantity(asset: Asset, quantity = asset.quantity, categories = DEFAULT_CATEGORIES): string {
  const unit = getOwnerQuantityUnit(asset, categories);
  return quantities.format(quantity) + (/^[A-Z]+$/.test(unit) ? ' ' : '') + unit;
}
