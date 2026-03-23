// components/SellAssetModal.tsx
// 수정된 버전: 매도 통화를 자산 통화로 고정

import React, { useState, useEffect } from 'react';
import { Asset, Currency, CURRENCY_SYMBOLS, SellTransaction } from '../types';
import { usePortfolio } from '../contexts/PortfolioContext';

const SellAssetModal: React.FC = () => {
  const { modal, actions, status } = usePortfolio();
  const asset = modal.sellingAsset;
  const isOpen = !!modal.sellingAsset;
  const onClose = actions.closeSellModal;
  const onSell = (assetId: string, sellDate: string, sellPrice: number, sellQuantity: number, currency: Currency) =>
    actions.confirmSell(assetId, sellDate, sellPrice, sellQuantity, currency);
  const isLoading = status.isLoading;
  const [sellDate, setSellDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [sellPrice, setSellPrice] = useState<string>('');
  const [sellQuantity, setSellQuantity] = useState<string>('');

  useEffect(() => {
    if (asset && isOpen) {
      setSellDate(new Date().toISOString().slice(0, 10));
      // 현재가를 자산 통화 기준으로 표시
      setSellPrice(asset.currentPrice.toString());
      setSellQuantity(asset.quantity.toString());
    }
  }, [asset, isOpen]);

  if (!isOpen || !asset) return null;

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
    onSell(
      asset.id,
      sellDate,
      price,           // 자산 통화 기준 매도가
      quantity,
      asset.currency   // 자산의 통화
    );
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
                  {asset.quantity.toLocaleString()}
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
              min="1"
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
                최대: {asset.quantity.toLocaleString()}
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
