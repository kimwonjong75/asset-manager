import { Currency, LegacyAssetShape, Asset } from '../types';
import { DEFAULT_CATEGORIES } from '../types/category';

const DEFAULT_EXCHANGE_MAP: { [key: number]: string[] } = {
  1: ['KRX', 'KONEX'],           // KOREAN_STOCK
  2: ['NASDAQ', 'NYSE', 'AMEX'], // US_STOCK
  3: ['TSE', 'HKEX', 'LSE'],     // FOREIGN_STOCK
  4: ['TSE', 'HKEX', 'LSE'],     // OTHER_FOREIGN_STOCK
  5: ['KRX'],                     // KOREAN_BOND
  6: ['US Bond'],                 // US_BOND
  7: ['Gold', 'Silver'],          // PHYSICAL_ASSET
  8: ['Upbit', 'Bithumb', 'Binance'], // CRYPTOCURRENCY
  9: ['KRW', 'USD', 'JPY'],      // CASH
};

export const mapToNewAssetStructure = (asset: LegacyAssetShape | Asset): Asset => {
  let newAsset = { ...asset };

  if (!newAsset.exchange) newAsset.exchange = DEFAULT_EXCHANGE_MAP[newAsset.categoryId]?.[0] || '';
  if (!newAsset.currency) {
    newAsset.currency = Currency.KRW;
    newAsset.priceOriginal = newAsset.currentPrice;
  }
  if (!newAsset.purchaseExchangeRate) {
    newAsset.purchaseExchangeRate = newAsset.currency === Currency.KRW ? 1 : undefined;
  }

  // [수정] 최고가(Highest Price) 데이터 보정
  // 기존 데이터에 최고가가 없으면 현재가와 매수가 중 큰 값으로 초기화하여 누락 방지
  if (!newAsset.highestPrice) {
    const current = newAsset.currentPrice || 0;
    const purchase = newAsset.purchasePrice || 0;
    newAsset.highestPrice = Math.max(current, purchase);
  }

  // Legacy category string → categoryId migration
  const oldCategory = newAsset.category;
  if (!newAsset.categoryId) {
    if (['주식', 'ETF'].includes(oldCategory)) {
      if (newAsset.exchange?.startsWith('KRX')) {
        newAsset.categoryId = 1; // KOREAN_STOCK
      } else if (['NASDAQ', 'NYSE', 'AMEX'].includes(newAsset.exchange)) {
        newAsset.categoryId = 2; // US_STOCK
      } else {
        newAsset.categoryId = 4; // OTHER_FOREIGN_STOCK
      }
    } else if (['KRX금현물', '금', '실물자산'].includes(oldCategory)) {
      newAsset.categoryId = 7; // PHYSICAL_ASSET
    } else {
      const categoryMap: { [key: string]: number } = {
        '국내주식': 1,
        '한국주식': 1,
        '해외주식': 2,
        '미국주식': 2,
        '기타해외주식': 4,
        '국내국채': 5,
        '한국채권': 5,
        '해외국채': 6,
        '미국채권': 6,
        '실물자산': 7,
        '암호화폐': 8,
        '현금': 9,
      };
      if (categoryMap[oldCategory]) {
        newAsset.categoryId = categoryMap[oldCategory];
      }
    }
  }

  if (!newAsset.categoryId || !DEFAULT_CATEGORIES.some(c => c.id === newAsset.categoryId)) {
    newAsset.categoryId = 4; // fallback: OTHER_FOREIGN_STOCK
  }

  const { region, ...cleaned } = newAsset as any;
  return cleaned as Asset;
};