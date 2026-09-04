// utils/holdingMarkets.ts
// 보유(포트폴리오+관심종목) 종목이 어떤 시장(KR/US/CRYPTO)에 걸쳐 있는지 분류 —
// `utils/priceFreshness.shouldRefreshPrices`의 holdings 입력을 만드는 공용 헬퍼.
// `hooks/usePortfolioData`(로드 직후 게이트)와 `hooks/usePriceFreshnessRefresh`(탭 복귀 재확인)가
// 서로 다른 시점의 자산 스냅샷에 대해 동일 분류 규칙을 공유하기 위해 분리했다(중복 로직 금지).
//
// 분류 규칙(기존 갱신 경로와 동일 소스 재사용, 새로 만들지 않음):
//   · 암호화폐: `services/historicalPriceService.isCryptoExchange` (hooks/useMarketData의
//     `shouldUseUpbitAPI`와 동일 판정 문자열 집합)
//   · 한국/미국: `utils/todayTurtle.resolveMarketTz` — KR/US/UNKNOWN 중 KR만 한국으로,
//     나머지(US·UNKNOWN)는 미국 시장 규약(가장 흔한 폴백)으로 취급
//   · 현금성 자산(categoryId CASH)은 시세 API 대상이 아니므로 분류에서 제외
//     (`hooks/useMarketData.handleRefreshAllPrices`와 동일하게 제외)
import type { Asset, WatchlistItem } from '../types';
import { isBaseType } from '../types/category';
import { isCryptoExchange } from '../services/historicalPriceService';
import { resolveMarketTz } from './todayTurtle';
import type { PriceFreshnessHoldings } from './priceFreshness';
import type { MarketId } from './marketHours';

/**
 * 단일 종목의 시장(KR/US/CRYPTO) 판정 — `classifyHoldingMarkets`와 동일한 분류 규칙
 * (`isCryptoExchange` → `resolveMarketTz`)을 단일 거래소 문자열에 적용한다.
 * US·UNKNOWN은 동일하게 미국 시장 규약으로 취급(가장 흔한 폴백) — `TradePlanMarket` 산출
 * (`utils/tradePlanMarket.buildTradePlanMarket`)이 사용한다.
 */
export function marketIdForExchange(exchange: string): MarketId {
  if (isCryptoExchange(exchange)) return 'CRYPTO';
  const tz = resolveMarketTz(exchange, false);
  return tz === 'KR' ? 'KR' : 'US';
}

export function classifyHoldingMarkets(
  assets: Asset[],
  watchlist: WatchlistItem[],
): PriceFreshnessHoldings {
  const holdings: PriceFreshnessHoldings = { hasKR: false, hasUS: false, hasCrypto: false };

  const visit = (exchange: string): void => {
    if (holdings.hasKR && holdings.hasUS && holdings.hasCrypto) return; // 조기 종료
    const crypto = isCryptoExchange(exchange);
    if (crypto) {
      holdings.hasCrypto = true;
      return;
    }
    const tz = resolveMarketTz(exchange, false);
    if (tz === 'KR') holdings.hasKR = true;
    else holdings.hasUS = true; // US·UNKNOWN → 미국 시장 규약으로 취급(폴백)
  };

  for (const a of assets) {
    if (isBaseType(a.categoryId, 'CASH')) continue;
    visit(a.exchange);
  }
  for (const w of watchlist) {
    visit(w.exchange);
  }

  return holdings;
}
