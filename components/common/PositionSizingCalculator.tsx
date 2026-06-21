// 리스크 기반 포지션 사이징 계산기 (공용 프레젠테이션 컴포넌트)
// ---------------------------------------------------------------------------
// 계산 로직은 utils/positionSizing.ts(순수 함수)에 위임. 이 컴포넌트는 입력/결과 렌더만 담당.
// 재사용처:
//   · 배치 B — 매수 모달(BuyMoreAssetModal/AddNewAssetModal) 내부에 끼워 권장 수량 자동 추천.
//   · 배치 C — 대시보드 "리스크 계산기" 카드(RiskCalculatorCard).
// 통화: 총자산은 KRW 기준(포트폴리오 총평가액), 진입가/손절가/투자금액은 prop `currency` 기준.
//       내부에서 resolveRate로 환산해 계산.
// 지식 근거: constants/knowledgeBase.getPositionSizingBasis() (rule-position-sizing-calc).

import React, { useMemo, useState } from 'react';
import { Currency, CURRENCY_SYMBOLS, ExchangeRates } from '../../types';
import { resolveRate } from '../../utils/exchangeRateCache';
import {
  calculatePositionSize,
  stopPriceFromPercent,
  POSITION_SIZING_ERROR_LABELS,
} from '../../utils/positionSizing';
import { getPositionSizingBasis } from '../../constants/knowledgeBase';

const BASIS = getPositionSizingBasis();
const RISK_PRESETS = [0.5, 1, 2];
const STOP_PRESETS = [5, 8, 10]; // 진입가 대비 손절폭 %

interface PositionSizingCalculatorProps {
  totalEquityKRW: number;           // 총자산 (KRW) — 포트폴리오 총평가액
  currency: Currency;               // 진입가/손절가/투자금액 통화
  exchangeRates: ExchangeRates;
  entryPrice: number | null;        // 값이면 외부(매수가)와 동기 표시, null이면 자체 입력(대시보드)
  allowFractional?: boolean;        // 암호화폐 등 소수 수량 허용
  editableEquity?: boolean;         // 총자산 직접 수정 허용 (대시보드용)
  onApplyQuantity?: (qty: number) => void; // 권장 수량 적용 버튼 (모달용)
  className?: string;
}

function formatMoney(value: number, currency: Currency): string {
  const symbol = CURRENCY_SYMBOLS[currency];
  const digits = currency === Currency.USD ? 2 : 0;
  return `${symbol}${value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function formatQty(q: number, fractional: boolean): string {
  return q.toLocaleString('en-US', { maximumFractionDigits: fractional ? 8 : 0 });
}

const PositionSizingCalculator: React.FC<PositionSizingCalculatorProps> = ({
  totalEquityKRW,
  currency,
  exchangeRates,
  entryPrice,
  allowFractional = false,
  editableEquity = false,
  onApplyQuantity,
  className = '',
}) => {
  const [riskPercent, setRiskPercent] = useState('1');
  const [stopPriceInput, setStopPriceInput] = useState('');
  const [entryInput, setEntryInput] = useState('');
  const [equityInput, setEquityInput] = useState('');

  const rate = resolveRate(currency, exchangeRates);
  const symbol = CURRENCY_SYMBOLS[currency];

  const equityKRW = editableEquity
    ? (parseFloat(equityInput) || (equityInput === '' ? totalEquityKRW : 0))
    : totalEquityKRW;

  const entry = entryPrice !== null ? entryPrice : (parseFloat(entryInput) || 0);
  const stop = parseFloat(stopPriceInput) || 0;
  const risk = parseFloat(riskPercent) || 0;

  const totalEquityNative = rate > 0 ? equityKRW / rate : 0;

  const result = useMemo(
    () =>
      calculatePositionSize({
        totalEquity: totalEquityNative,
        riskPercentPerTrade: risk,
        entryPrice: entry,
        stopPrice: stop,
        allowFractional,
      }),
    [totalEquityNative, risk, entry, stop, allowFractional]
  );

  // 입력 미완료 상태 구분 (에러가 아니라 안내로 처리)
  const noRate = rate <= 0;
  const noEquity = equityKRW <= 0;
  const needsEntry = entry <= 0;
  const needsStop = stop <= 0;
  const ready = !noRate && !noEquity && !needsEntry && !needsStop;

  const inputClasses =
    'w-full bg-gray-700 border border-gray-600 rounded-md py-1.5 px-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition';
  const labelClasses = 'block text-xs font-medium text-gray-400 mb-1';

  const applyStopPreset = (pct: number) => {
    if (entry > 0) setStopPriceInput(stopPriceFromPercent(entry, pct).toFixed(currency === Currency.USD ? 2 : 0));
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {/* 입력부 */}
      <div className="grid grid-cols-2 gap-2.5">
        {editableEquity && (
          <div className="col-span-2">
            <label className={labelClasses}>총자산 (₩)</label>
            <input
              type="number"
              value={equityInput}
              onChange={(e) => setEquityInput(e.target.value)}
              placeholder={totalEquityKRW > 0 ? Math.round(totalEquityKRW).toLocaleString() : '예: 100000000'}
              className={inputClasses}
              min="0"
              step="any"
            />
          </div>
        )}

        {entryPrice === null && (
          <div>
            <label className={labelClasses}>현재가 ({symbol})</label>
            <input
              type="number"
              value={entryInput}
              onChange={(e) => setEntryInput(e.target.value)}
              placeholder="진입가"
              className={inputClasses}
              min="0"
              step="any"
            />
          </div>
        )}

        <div>
          <label className={labelClasses}>손절가 ({symbol})</label>
          <input
            type="number"
            value={stopPriceInput}
            onChange={(e) => setStopPriceInput(e.target.value)}
            placeholder="손절 기준가"
            className={inputClasses}
            min="0"
            step="any"
          />
        </div>

        <div className={entryPrice === null ? 'col-span-2' : ''}>
          <label className={labelClasses}>1회 허용손실 (%)</label>
          <input
            type="number"
            value={riskPercent}
            onChange={(e) => setRiskPercent(e.target.value)}
            className={inputClasses}
            min="0"
            max="100"
            step="0.5"
          />
        </div>
      </div>

      {/* 빠른 설정 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-gray-500">허용손실</span>
        {RISK_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setRiskPercent(String(p))}
            className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
              risk === p ? 'bg-primary text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {p}%
          </button>
        ))}
        {entry > 0 && (
          <>
            <span className="ml-2 text-[11px] text-gray-500">손절폭</span>
            {STOP_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => applyStopPreset(p)}
                className="px-2 py-0.5 text-[11px] rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
              >
                −{p}%
              </button>
            ))}
          </>
        )}
      </div>

      {/* 결과부 */}
      {!ready ? (
        <div className="bg-gray-900/60 rounded-md px-3 py-2.5 text-xs text-gray-400">
          {noRate
            ? '환율 정보가 없어 권장 수량을 계산할 수 없습니다.'
            : noEquity
            ? '총자산이 0보다 커야 권장 수량을 계산할 수 있습니다.'
            : '현재가와 손절가를 입력하면 리스크 기준 권장 수량이 계산됩니다.'}
        </div>
      ) : !result.valid ? (
        <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2.5 text-xs text-danger">
          {result.reason ? POSITION_SIZING_ERROR_LABELS[result.reason] : '입력값을 확인하세요.'}
        </div>
      ) : (
        <div className="bg-gray-900 rounded-md px-3 py-3 space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-gray-400">권장 수량</span>
            <span className="text-xl font-bold text-primary-light">
              {formatQty(result.maxQuantity, allowFractional)}
              <span className="text-sm text-gray-400 ml-1">주</span>
            </span>
          </div>
          <div className="flex items-baseline justify-between border-t border-gray-700 pt-2">
            <span className="text-xs text-gray-400">권장 투자금액</span>
            <span className="text-sm font-semibold text-white">
              {formatMoney(result.maxInvestment, currency)}
              {currency !== Currency.KRW && (
                <span className="text-xs text-gray-500 ml-1">
                  (≈{formatMoney(result.maxInvestment * rate, Currency.KRW)})
                </span>
              )}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center pt-1">
            <div>
              <div className="text-[11px] text-gray-500">손절폭</div>
              <div className="text-xs font-medium text-gray-200">{result.stopLossPercent.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-[11px] text-gray-500">예상 손실</div>
              <div className="text-xs font-medium text-gray-200">{formatMoney(result.actualRiskAmount, currency)}</div>
            </div>
            <div>
              <div className="text-[11px] text-gray-500">자산 비중</div>
              <div className="text-xs font-medium text-gray-200">{result.investmentRatio.toFixed(1)}%</div>
            </div>
          </div>

          {result.capped && (
            <div className="text-[11px] text-amber-400 bg-amber-950/30 rounded px-2 py-1.5">
              손절폭이 좁아 리스크 한도 기준 투자금액이 총자산을 초과합니다 → 총자산 100%로 제한했습니다.
              손절폭을 넓히거나 허용손실을 낮추세요.
            </div>
          )}

          {onApplyQuantity && (
            <button
              type="button"
              onClick={() => onApplyQuantity(result.maxQuantity)}
              disabled={result.maxQuantity <= 0}
              className="w-full mt-1 bg-primary/80 hover:bg-primary text-white text-sm font-medium py-1.5 rounded-md disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
            >
              이 수량 적용
            </button>
          )}
        </div>
      )}

      {/* 지식 근거 */}
      <details className="text-[11px] text-gray-500">
        <summary className="cursor-pointer hover:text-gray-400 select-none">📚 근거: {BASIS.title}</summary>
        <div className="mt-1.5 pl-2 border-l-2 border-gray-700 space-y-1">
          {BASIS.riskPolicy && <p className="text-gray-400">{BASIS.riskPolicy}</p>}
          {BASIS.claims.map((c, i) => (
            <p key={i} className="text-gray-500">· {c}</p>
          ))}
          <p className="text-gray-600 pt-0.5">참고용 계산이며 투자자문이 아닙니다.</p>
        </div>
      </details>
    </div>
  );
};

export default PositionSizingCalculator;
