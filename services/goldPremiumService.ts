import { Currency } from '../types';
import { fetchBatchAssetPrices } from './priceService';

const TROY_OZ_TO_GRAM = 31.1035;

export interface GoldPremiumResult {
  domesticPriceKRW: number;      // KRX 국내금 KRW/g
  internationalPriceUSD: number; // COMEX GC=F USD/oz
  internationalPriceKRW: number; // 환산 KRW/g
  premium: number;               // % (양수=프리미엄, 음수=역프리미엄)
  fetchedAt: string;
}

/**
 * 금 김치 프리미엄 조회
 * - 국내금: KRX 금시장 (KRW/g)
 * - 국제금: COMEX GC=F (USD/oz) → KRW/g 환산
 * - 프리미엄 = (국내 - 국제환산) / 국제환산 × 100
 */
export async function fetchGoldPremium(usdKrwRate: number): Promise<GoldPremiumResult> {
  const assets = [
    { id: 'krx-gold', ticker: 'KRX-GOLD', exchange: 'KRX 금시장', currency: Currency.KRW },
    { id: 'comex-gold', ticker: 'GC=F', exchange: 'COMEX', currency: Currency.USD },
  ];

  const results = await fetchBatchAssetPrices(assets);

  const krxResult = results.get('krx-gold');
  const comexResult = results.get('comex-gold');

  const domesticPriceKRW = (krxResult && !krxResult.isMocked) ? krxResult.priceOriginal : 0;
  const internationalPriceUSD = (comexResult && !comexResult.isMocked) ? comexResult.priceOriginal : 0;
  const internationalPriceKRW =
    internationalPriceUSD > 0 ? (internationalPriceUSD * usdKrwRate) / TROY_OZ_TO_GRAM : 0;

  const premium =
    domesticPriceKRW > 0 && internationalPriceKRW > 0
      ? ((domesticPriceKRW - internationalPriceKRW) / internationalPriceKRW) * 100
      : 0;

  return {
    domesticPriceKRW,
    internationalPriceUSD,
    internationalPriceKRW,
    premium,
    fetchedAt: new Date().toISOString(),
  };
}
