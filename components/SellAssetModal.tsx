// components/SellAssetModal.tsx
// 수정된 버전: 매도 통화를 자산 통화로 고정

import React, { useState, useEffect, useRef } from 'react';
import { Asset, Currency, CURRENCY_SYMBOLS, SellTransaction } from '../types';
import { isBaseType } from '../types/category';
import { formatQuantity } from './portfolio-table/utils';
import { usePortfolio } from '../contexts/PortfolioContext';
import { defaultSellOutcome, sellPrefillFor } from '../utils/tradePlanLink';
import type { SellOutcome } from '../types/tradePlan';
import Segmented from './common/Segmented';

/** 매도 효과 선택지 (P2b) — 라벨과 아래 설명이 1:1로 대응한다. */
const SELL_OUTCOME_OPTIONS: { value: SellOutcome; label: string; hint: string }[] = [
  { value: 'half', label: '익절 절반', hint: '익절 절반: 계획 수량의 절반만 팔고 익절선은 완료 처리됩니다' },
  { value: 'stop', label: '손절 전량', hint: '손절 전량: 보유 수량 전부를 팔고 계획을 종료합니다' },
  { value: 'exit', label: '추세이탈 전량', hint: '추세이탈 전량: 나머지 전량을 팔고 계획을 종료합니다' },
  { value: 'none', label: '계획과 무관', hint: '계획과 무관: 매도 기록만 남기고 계획 상태는 바꾸지 않습니다' },
];

const SellAssetModal: React.FC = () => {
  const { modal, actions, status, derived } = usePortfolio();
  const asset = modal.sellingAsset;
  const isOpen = !!modal.sellingAsset;
  const onClose = actions.closeSellModal;
  const onSell = (assetId: string, sellDate: string, sellPrice: number, sellQuantity: number, currency: Currency) =>
    actions.confirmSell(assetId, sellDate, sellPrice, sellQuantity, currency);
  const isLoading = status.isLoading;
  const [sellDate, setSellDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [sellPrice, setSellPrice] = useState<string>('');
  const [sellQuantity, setSellQuantity] = useState<string>('');
  const [sellOutcome, setSellOutcome] = useState<SellOutcome>('none');

  // 최신 평가 행은 ref로 미러링한다(usePriceFreshnessRefresh와 동일 접근) —
  // derived.tradePlanRows는 배경 시세 갱신마다 참조가 바뀌므로 아래 리셋 effect의 의존성에 넣으면
  // 모달이 열린 채 재발화해 **사용자가 입력한 값을 지운다**. ref는 반응형 의존성이 아니라서
  // effect가 실제로 실행되는 순간의 최신값만 읽게 된다.
  // ⚠ 렌더 중 ref 대입은 금지(react-hooks/refs) — 반드시 effect에서, 그리고 아래 리셋 effect보다
  //   **먼저** 선언해 같은 커밋에서 미러가 먼저 갱신되게 한다.
  const tradePlanRowsRef = useRef(derived.tradePlanRows);
  useEffect(() => { tradePlanRowsRef.current = derived.tradePlanRows; }, [derived.tradePlanRows]);

  useEffect(() => {
    if (asset && isOpen) {
      setSellDate(new Date().toISOString().slice(0, 10));
      const activePlan = asset.tradePlan && asset.tradePlan.status === 'active' ? asset.tradePlan : null;
      if (activePlan) {
        // 계획 카드에서 열었으면 그쪽 프리필이 우선, 아니면 현재 신호로 기본 효과를 고른다.
        const row = tradePlanRowsRef.current.find(r => r.asset.id === asset.id);
        const outcome = modal.sellPrefill?.outcome ?? defaultSellOutcome(row?.evaluation ?? null);
        const prefill = sellPrefillFor(activePlan, asset, outcome);
        setSellOutcome(outcome);
        setSellQuantity(String(modal.sellPrefill?.quantity ?? prefill.quantity));
        setSellPrice(String(modal.sellPrefill?.price ?? prefill.priceOriginal));
      } else {
        setSellOutcome('none');
        // 현재가를 자산 통화 기준으로 표시
        setSellPrice(asset.currentPrice.toString());
        setSellQuantity(asset.quantity.toString());
      }
    }
  }, [asset, isOpen, modal.sellPrefill]);

  if (!isOpen || !asset) return null;

  const isCrypto = isBaseType(asset.categoryId, 'CRYPTOCURRENCY');
  const activePlan = asset.tradePlan && asset.tradePlan.status === 'active' ? asset.tradePlan : null;

  /** 효과를 바꾸면 수량·가격도 그 효과의 기본값으로 다시 채운다(사용자는 이후 자유 수정). */
  const handleOutcomeChange = (outcome: SellOutcome) => {
    setSellOutcome(outcome);
    if (!activePlan) return;
    const prefill = sellPrefillFor(activePlan, asset, outcome);
    setSellQuantity(String(prefill.quantity));
    setSellPrice(String(prefill.priceOriginal));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!sellDate || !sellPrice || !sellQuantity) {
      alert('모든 필드를 입력해주세요.');
      return;
    }

    const quantity = parseFloat(sellQuantity);
    const price = parseFloat(sellPrice);

    if (quantity <= 0 || quantity > asset.quantity) {
      alert(`매도 수량은 0보다 크고 보유 수량(${asset.quantity}) 이하여야 합니다.`);
      return;
    }

    if (price <= 0) {
      alert('매도가는 0보다 커야 합니다.');
      return;
    }

    // 자산의 원래 통화로 매도 처리
    const result = await onSell(
      asset.id,
      sellDate,
      price,           // 자산 통화 기준 매도가
      quantity,
      asset.currency   // 자산의 통화
    );

    // 매매 계획 상태 전이(P2b) — 돈 기록이 성공하고 자산이 남아 있을 때만.
    // 전량 매도로 자산이 사라졌으면(assetClosed) 계획을 얹을 대상이 없다.
    if (result.ok && !result.assetClosed && activePlan && sellOutcome !== 'none') {
      actions.applyTradePlanSellOutcome(asset.id, sellOutcome, {
        date: sellDate, price, quantity, sellRecordId: result.sellRecordId,
      });
    }
  };

  const inputClasses = "w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition";
  const labelClasses = "block text-sm font-medium text-gray-300 mb-1";

  const formatCurrency = (num: number, currency: Currency): string => {
    if (currency === Currency.KRW) {
      return new Intl.NumberFormat('ko-KR', { 
        style: 'currency', 
        currency: 'KRW', 
        maximumFractionDigits: 0 
      }).format(num);
    }
    if (currency === Currency.JPY) {
      return `${CURRENCY_SYMBOLS[currency]}${new Intl.NumberFormat('ja-JP', { 
        maximumFractionDigits: 0 
      }).format(num)}`;
    }
    return `${CURRENCY_SYMBOLS[currency]}${new Intl.NumberFormat('en-US', { 
      minimumFractionDigits: 2,
      maximumFractionDigits: 2 
    }).format(num)}`;
  };

  const currencySymbol = CURRENCY_SYMBOLS[asset.currency];
  const currencyLabel = asset.currency;

  // 예상 매도금액 계산
  const estimatedTotal = parseFloat(sellPrice || '0') * parseFloat(sellQuantity || '0');

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-gray-800 p-4 sm:p-6 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-4 sm:mb-6">
          매도: {asset.customName?.trim() || asset.name}
        </h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 보유 정보 */}
          <div className="bg-gray-700 p-4 rounded-md">
            <div className={labelClasses}>보유정보</div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-gray-400">보유 수량</div>
                <div className="text-white font-semibold">
                  {formatQuantity(asset.quantity, isCrypto)}
                </div>
              </div>
              <div>
                <div className="text-gray-400">현재가</div>
                <div className="text-white font-semibold">
                  {formatCurrency(asset.currentPrice, asset.currency)}
                </div>
              </div>
              <div>
                <div className="text-gray-400">평가금액</div>
                <div className="text-white font-semibold">
                  {formatCurrency(asset.currentPrice * asset.quantity, asset.currency)}
                </div>
              </div>
            </div>
          </div>

          {/* 매매 계획 연동 (P2b) — 활성 계획이 있을 때만. 선택에 따라 수량·가격이 다시 채워진다 */}
          {activePlan && (
            <div className="bg-gray-700/50 p-3 rounded-md">
              <div className={labelClasses}>이 매도가 계획에 미치는 효과</div>
              <Segmented<SellOutcome>
                bordered={false}
                className="grid grid-cols-2 sm:grid-cols-4 gap-1.5"
                options={SELL_OUTCOME_OPTIONS.map(opt => ({ value: opt.value, label: opt.label }))}
                value={sellOutcome}
                onChange={handleOutcomeChange}
              />
              <p className="text-[11px] text-gray-500 mt-2">
                {SELL_OUTCOME_OPTIONS.find(o => o.value === sellOutcome)?.hint}
              </p>
            </div>
          )}

          {/* 통화 표시 (변경 불가) */}
          <div className="bg-gray-700/50 p-3 rounded-md">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">매도 통화</span>
              <span className="text-white font-medium flex items-center gap-2">
                {asset.currency === Currency.USD && '🇺🇸'}
                {asset.currency === Currency.JPY && '🇯🇵'}
                {asset.currency === Currency.KRW && '🇰🇷'}
                {currencyLabel}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              * 매수 통화와 동일한 통화로만 매도할 수 있습니다.
            </p>
          </div>

          {/* 매도일자 */}
          <div>
            <label htmlFor="sellDate" className={labelClasses}>매도일자</label>
            <input
              id="sellDate"
              type="date"
              value={sellDate}
              onChange={(e) => setSellDate(e.target.value)}
              className={inputClasses}
              required
            />
          </div>

          {/* 매도가 */}
          <div>
            <label htmlFor="sellPrice" className={labelClasses}>
              매도가 ({currencySymbol})
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                {currencySymbol}
              </span>
              <input
                id="sellPrice"
                type="number"
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
                className={`${inputClasses} pl-8`}
                required
                min="0"
                step="any"
                placeholder="매도가를 입력하세요"
              />
            </div>
          </div>

          {/* 매도 수량 */}
          <div>
            <label htmlFor="sellQuantity" className={labelClasses}>매도 수량</label>
            <input
              id="sellQuantity"
              type="number"
              value={sellQuantity}
              onChange={(e) => setSellQuantity(e.target.value)}
              className={inputClasses}
              required
              min={isCrypto ? "0.00000001" : "1"}
              max={asset.quantity}
              step="any"
              placeholder="매도할 수량을 입력하세요"
            />
            <div className="flex justify-between mt-1">
              <button
                type="button"
                onClick={() => setSellQuantity(asset.quantity.toString())}
                className="text-xs text-primary hover:text-primary-light"
              >
                전량 매도
              </button>
              <span className="text-xs text-gray-500">
                최대: {formatQuantity(asset.quantity, isCrypto)}
              </span>
            </div>
          </div>

          {/* 예상 매도금액 */}
          {estimatedTotal > 0 && (
            <div className="bg-gray-900 p-4 rounded-md">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">예상 매도금액</span>
                <span className="text-xl font-bold text-white">
                  {formatCurrency(estimatedTotal, asset.currency)}
                </span>
              </div>
            </div>
          )}

          {/* 버튼 */}
          <div className="pt-4 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-600 hover:bg-gray-500 text-white font-medium py-2.5 px-4 rounded-md transition duration-300"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 bg-danger hover:bg-red-600 text-white font-bold py-2.5 px-4 rounded-md disabled:bg-gray-600 disabled:cursor-not-allowed transition duration-300 flex items-center justify-center"
            >
              {isLoading ? (
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : '매도 확인'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SellAssetModal;
