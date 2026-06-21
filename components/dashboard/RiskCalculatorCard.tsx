// 대시보드 "리스크 계산기" 카드 (배치 C)
// ---------------------------------------------------------------------------
// 매수 전 평소에도 리스크 기준 적정 포지션을 가늠할 수 있는 standalone 계산기.
// 계산/렌더는 공용 PositionSizingCalculator에 위임. 총자산은 포트폴리오 총평가액 자동주입(수정 가능).
// 진입가 통화는 사용자가 선택(원화/달러/엔). 지식 근거: rule-position-sizing-calc.
// 자주 쓰지 않는 도구라 기본 접힘(헤더 클릭 시 전개) — 펼침 상태는 localStorage에 기억한다.

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Currency } from '../../types';
import { usePortfolio } from '../../contexts/PortfolioContext';
import PositionSizingCalculator from '../common/PositionSizingCalculator';

const CALC_CURRENCIES: Currency[] = [Currency.KRW, Currency.USD, Currency.JPY];

// 펼침/접힘 영속 키 (AssetTrendChart의 localStorage 패턴 동일)
const RISK_CALC_OPEN_KEY = 'asset-manager-risk-calc-open';

function loadOpen(): boolean {
  try { return localStorage.getItem(RISK_CALC_OPEN_KEY) === 'true'; } catch { return false; }
}
function saveOpen(v: boolean): void {
  try { localStorage.setItem(RISK_CALC_OPEN_KEY, String(v)); } catch { /* ignore */ }
}

const RiskCalculatorCard: React.FC = () => {
  const { data, derived } = usePortfolio();
  const [currency, setCurrency] = useState<Currency>(Currency.KRW);
  const [open, setOpen] = useState<boolean>(loadOpen);

  const toggleOpen = () => setOpen(prev => { const next = !prev; saveOpen(next); return next; });

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg p-4 sm:p-5">
      <div className={`flex items-center justify-between ${open ? 'mb-3' : ''}`}>
        <button
          type="button"
          onClick={toggleOpen}
          className="flex items-center gap-2 text-left min-w-0"
          aria-expanded={open}
        >
          <ChevronDown
            className={`h-4 w-4 text-gray-400 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
          />
          <div className="min-w-0">
            <h3 className="text-base font-bold text-white flex items-center gap-1.5">
              🛡️ 리스크 계산기
            </h3>
            {open && (
              <p className="text-xs text-gray-500 mt-0.5">
                손절폭과 허용손실에서 적정 매수 수량을 역산합니다
              </p>
            )}
          </div>
        </button>
        {open && (
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
        )}
      </div>

      {open && (
        <PositionSizingCalculator
          totalEquityKRW={derived.totalValue}
          currency={currency}
          exchangeRates={data.exchangeRates}
          entryPrice={null}
          editableEquity
        />
      )}
    </div>
  );
};

export default RiskCalculatorCard;
