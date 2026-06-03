// utils/swingPointDetection.ts
// Swing Low(직전 저점) 탐지 유틸 — 와인스타인 매도 트리거 "직전 저점 이탈" 감지용
//
// 정의: 좌우 leftBars/rightBars 거래일 동안 자기보다 낮은 종가가 없는 지점 (동률 허용)
// → 우측 N거래일이 모두 같거나 높은 종가여야 swing low로 "확정" 가능
// → lookback 윈도우 내에서 가장 최근에 확정된 swing low 1개 반환

interface PricePoint {
  date: string;
  price: number;
}

export interface SwingLowResult {
  /** swing low 가격 (종가 기준) */
  price: number;
  /** 형성 일자 */
  date: string;
  /** sortedPrices 내 인덱스 */
  index: number;
}

/**
 * 최근 lookback 거래일 내에서 가장 최근에 확정된 swing low 1개 반환
 * sortedPrices는 날짜 오름차순 정렬된 종가 시계열
 * 우측 rightBars 거래일이 보장돼야 확정 가능 (마지막 rightBars일은 후보에서 제외)
 *
 * 반환 null: 데이터 부족 또는 윈도우 내 swing low 미형성
 */
export function detectRecentSwingLow(
  sortedPrices: PricePoint[],
  lookback: number = 60,
  leftBars: number = 5,
  rightBars: number = 5
): SwingLowResult | null {
  const n = sortedPrices.length;
  if (n < leftBars + rightBars + 1) return null;

  const windowStart = Math.max(leftBars, n - lookback);
  const windowEnd = n - rightBars - 1; // 우측 rightBars개 확보 필요

  let mostRecent: SwingLowResult | null = null;

  for (let i = windowStart; i <= windowEnd; i++) {
    const center = sortedPrices[i].price;
    let isLow = true;
    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (j === i) continue;
      if (sortedPrices[j].price < center) {
        isLow = false;
        break;
      }
    }
    if (isLow) {
      // 정방향 스캔하며 마지막 발견을 유지 → 가장 최근 swing low
      mostRecent = { price: center, date: sortedPrices[i].date, index: i };
    }
  }

  return mostRecent;
}
