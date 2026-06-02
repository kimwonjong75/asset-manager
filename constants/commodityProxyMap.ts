// constants/commodityProxyMap.ts
// 원자재/현물 자산의 거래량 프록시 매핑
//
// 배경: 은·금 등 현물(KRX-GOLD)이나 지수(SPX)는 거래량이 무의미하거나 0으로 보고됨.
// 클라이맥스/디스트리뷰션 규칙은 거래량 비교에 의존하므로, 본 자산의 가격은 그대로 쓰되
// 거래량만 대표 ETF/선물의 시계열로 대체한다.
//
// 가격(가격 기반 조건: 52주 신고가, 음봉 등) → 본 자산 사용
// 거래량(거래량 비교: 52주 최대 거래량, 평균 대비 1.5배 등) → 프록시 사용
//
// 새 자산 매핑이 필요하면 이 테이블만 수정. fetch 시 프록시 ticker는 자동으로 배치에 포함됨.

/** 자산 ticker → 거래량 프록시 ticker */
export const VOLUME_PROXY_MAP: Record<string, string> = {
  'KRX-GOLD': 'GLD',   // 한국 금시장 → SPDR Gold Shares (NYSE)
  'GC=F': 'GLD',       // 금 선물 → GLD ETF
  'SI=F': 'SLV',       // 은 선물 → iShares Silver Trust ETF
};

/** dedup된 프록시 ticker 목록 (fetch 배치 추가용) */
export const COMMODITY_PROXY_LIST: string[] = Array.from(new Set(Object.values(VOLUME_PROXY_MAP)));

/** 주어진 ticker가 거래량 프록시를 가지는지 */
export function hasVolumeProxy(ticker: string): boolean {
  return ticker in VOLUME_PROXY_MAP;
}

/** 주어진 ticker의 거래량 프록시 ticker (없으면 자기 자신 반환) */
export function resolveVolumeProxy(ticker: string): string {
  return VOLUME_PROXY_MAP[ticker] ?? ticker;
}
