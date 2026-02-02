export const COLUMN_DESCRIPTIONS: Record<string, string> = {
  name: '사용자 지정 이름 또는 API 제공 종목명',
  quantity: '현재 보유 수량',
  purchasePrice: '평균 매수 단가 (매수 당시 환율 적용)',
  currentPrice: 'API에서 받아온 실시간 현재가',
  returnPercentage: '(평가총액 - 투자원금) / 투자원금 × 100',
  profitLossKRW: '평가총액 - 투자원금 (KRW)',
  purchaseValue: '매수평균가 × 보유수량',
  currentValue: '현재가 × 보유수량',
  purchaseDate: '최초 매수 일자',
  allocation: '해당 종목 평가금액 / 전체 포트폴리오 × 100',
  dropFromHigh: '(현재가 - 52주 최고가) / 52주 최고가 × 100',
  yesterdayChange: '(현재가 - 전일종가) / 전일종가 × 100',
};
