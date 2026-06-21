// 대시보드 "리스크 계산기" 카드 (배치 C)
// ---------------------------------------------------------------------------
// 매수 전 평소에도 리스크 기준 적정 포지션을 가늠할 수 있는 standalone 계산기.
// 계산/렌더는 공용 PositionSizingCalculator에 위임. 총자산은 포트폴리오 총평가액 자동주입(수정 가능).
// 진입가 통화는 사용자가 선택(원화/달러/엔). 지식 근거: rule-position-sizing-calc.

import React, { useState } from 'react';
import { Currency } from '../../types';
import { usePortfolio } from '../../contexts/PortfolioContext';
import PositionSizingCalculator from '../common/PositionSizingCalculator';

const CALC_CURRENCIES: Currency[] = [Currency.KRW, Currency.USD, Currency.JPY];

const RiskCalculatorCard: React.FC = () => {
  const { data, derived } = usePortfolio();
  const [currency, setCurrency] = useState<Currency>(Currency.KRW);

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-1.5">
            🛡️ 리스크 계산기
          </h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            손절폭과 허용손실에서 적정 매수 수량을 역산합니다
          </p>
        </div>
        <div className="flex items-center gap-1">
          {CALC_CURRENCIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCurrency(c)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                currency === c ? 'bg-primary text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <PositionSizingCalculator
        totalEquityKRW={derived.totalValue}
        currency={currency}
        exchangeRates={data.exchangeRates}
        entryPrice={null}
        editableEquity
      />
    </div>
  );
};

export default RiskCalculatorCard;
