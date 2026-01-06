import { AssetCategory, Currency, LegacyAssetShape, Asset } from '../types';

const DEFAULT_EXCHANGE_MAP: { [key in AssetCategory]?: string[] } = {
  [AssetCategory.KOREAN_STOCK]: ['KRX', 'KONEX'],
  [AssetCategory.US_STOCK]: ['NASDAQ', 'NYSE', 'AMEX'],
  [AssetCategory.OTHER_FOREIGN_STOCK]: ['TSE', 'HKEX', 'LSE'],
  [AssetCategory.CRYPTOCURRENCY]: ['Upbit', 'Bithumb', 'Binance'],
  [AssetCategory.KOREAN_BOND]: ['KRX'],
  [AssetCategory.US_BOND]: ['US Bond'],
  [AssetCategory.PHYSICAL_ASSET]: ['Gold', 'Silver'],
  [AssetCategory.CASH]: ['KRW', 'USD', 'JPY'],
};

export const mapToNewAssetStructure = (asset: LegacyAssetShape): Asset => {
  let newAsset = { ...asset };

  if (!newAsset.exchange) newAsset.exchange = DEFAULT_EXCHANGE_MAP[newAsset.category as AssetCategory]?.[0] || '';
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

  const oldCategory = newAsset.category;
  if (['주식', 'ETF'].includes(oldCategory)) {
    if (newAsset.exchange?.startsWith('KRX')) {
      newAsset.category = AssetCategory.KOREAN_STOCK;
    } else if (['NASDAQ', 'NYSE', 'AMEX'].includes(newAsset.exchange)) {
      newAsset.category = AssetCategory.US_STOCK;
    } else {
      newAsset.category = AssetCategory.OTHER_FOREIGN_STOCK;
    }
  } else if (['KRX금현물', '금', '실물자산'].includes(oldCategory)) {
    newAsset.category = AssetCategory.PHYSICAL_ASSET;
  } else {
    const categoryMap: { [key: string]: AssetCategory } = {
      '국내주식': AssetCategory.KOREAN_STOCK,
      '해외주식': AssetCategory.US_STOCK,
      '국내국채': AssetCategory.KOREAN_BOND,
      '해외국채': AssetCategory.US_BOND,
    };
    if (categoryMap[oldCategory]) {
      newAsset.category = categoryMap[oldCategory];
    }
  }

  if (!Object.values(AssetCategory).includes(newAsset.category as AssetCategory)) {
    newAsset.category = AssetCategory.OTHER_FOREIGN_STOCK;
  }

  const { region, ...cleaned } = newAsset as any;
  return cleaned as Asset;
};