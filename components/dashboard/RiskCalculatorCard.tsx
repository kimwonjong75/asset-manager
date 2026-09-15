// 대시보드 "리스크 계산기" 카드 (배치 C)
// ---------------------------------------------------------------------------
// 매수 전 평소에도 리스크 기준 적정 포지션을 가늠할 수 있는 standalone 계산기.
// 계산/렌더는 공용 PositionSizingCalculator에 위임. 총자산은 포트폴리오 총평가액 자동주입(수정 가능).
// 진입가 통화는 사용자가 선택(원화/달러/엔). 지식 근거: rule-position-sizing-calc.
// 자주 쓰지 않는 도구라 기본 접힘 — Stage C: 공용 Card(collapsible)로 전환, 키 문자열 불변.
// 접힌 헤더에도 한 줄 설명(description)과 현재 통화(summary)를 항상 표시한다. 면책 문구는 홈 하단 한 줄로 통합(showDisclaimer=false).

import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Currency } from '../../types';
import { usePortfolio } from '../../contexts/PortfolioContext';
import Card from '../common/Card';
import PositionSizingCalculator from '../common/PositionSizingCalculator';

const CALC_CURRENCIES: Currency[] = [Currency.KRW, Currency.USD, Currency.JPY];

// 펼침/접힘 영속 키 (AssetTrendChart의 localStorage 패턴 동일)
const RISK_CALC_OPEN_KEY = 'asset-manager-risk-calc-open';

const RiskCalculatorCard: React.FC = () => {
  const { data, derived } = usePortfolio();
  const [currency, setCurrency] = useState<Currency>(Currency.KRW);

  return (
    <Card
      collapsible
      defaultCollapsed
      storageKey={RISK_CALC_OPEN_KEY}
      title={
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4 text-gray-300" aria-hidden="true" />
          리스크 계산기
        </span>
      }
      description="손절폭과 허용손실에서 적정 매수 수량을 역산합니다"
      summary={<span className="whitespace-nowrap">통화 {currency}</span>}
    >
      <div className="flex items-center gap-1 mb-3" role="group" aria-label="진입가 통화">
        {CALC_CURRENCIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCurrency(c)}
            aria-pressed={currency === c}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              currency === c ? 'bg-primary text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      <PositionSizingCalculator
        totalEquityKRW={derived.totalValue}
        currency={currency}
        exchangeRates={data.exchangeRates}
        entryPrice={null}
        editableEquity
        showDisclaimer={false}
      />
    </Card>
  );
};

export default RiskCalculatorCard;
