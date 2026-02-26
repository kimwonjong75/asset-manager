export const COLUMN_DESCRIPTIONS: Record<string, string> = {
  name: '종목명 (클릭 시 Google 검색)\n메모가 있으면 마우스 오버 시 표시',
  quantity: '현재 보유 수량',
  purchasePrice: '평균 매수 단가\n추가매수 시 가중평균으로 자동 계산',
  currentPrice: 'API 기준 현재가\n해외 종목: 원화 환산액 함께 표시\n\n[RSI] 최근 14일간 주가 흐름의 강도 (0~100)\n  70 이상(빨강): 과매수 — 많이 올라 쉬어갈 수 있음\n  30 이하(파랑): 과매도 — 많이 내려 반등 가능성\n\n[VOL] 오늘 거래량 ÷ 최근 20일 평균 거래량\n  2.0x↑(주황): 거래 폭증 — 큰 이슈 발생 가능\n  1.5x↑(노랑): 거래 증가 — 관심 상승 중\n  0.5x↓(회색): 거래 부진 — 관심도 낮음',
  returnPercentage: '(평가총액 - 투자원금) ÷ 투자원금 × 100\n클릭 시 수익률 ↔ 평가손익(원) 전환',
  profitLossKRW: '평가총액 - 투자원금 (KRW 기준)\n클릭 시 평가손익 ↔ 수익률(%) 전환',
  purchaseValue: '매수평균가 × 보유수량 (KRW 환산)',
  currentValue: '현재가 × 보유수량\n해외 종목: 원화 환산액 함께 표시',
  purchaseDate: '최초 매수 일자',
  allocation: '해당 종목 평가금액 ÷ 전체 포트폴리오 × 100',
  dropFromHigh: '(현재 종가 - 52주최고가) ÷ 52주최고가 × 100\n매도알림 기준값으로 사용됩니다',
  yesterdayChange: '(종가 - 전일종가) ÷ 전일종가 × 100\n※ 주말·공휴일에는 마지막 거래일 기준\n(업데이트 시점에 따라 0%로 표시될 수 있음)',
};
