// components/BuyMoreAssetModal.tsx
// 보유 종목 추가매수 모달

import React, { useState, useEffect } from 'react';
import { Asset, Currency, CURRENCY_SYMBOLS } from '../types';
import { usePortfolio } from '../contexts/PortfolioContext';

const BuyMoreAssetModal: React.FC = () => {
  const { modal, actions, status } = usePortfolio();
  const asset = modal.buyingAsset;
  const isOpen = !!modal.buyingAsset;
  const onClose = actions.closeBuyModal;
  const isLoading = status.isLoading;

  const [buyDate, setBuyDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [buyPrice, setBuyPrice] = useState<string>('');
  const [buyQuantity, setBuyQuantity] = useState<string>('');

  useEffect(() => {
    if (asset && isOpen) {
      setBuyDate(new Date().toISOString().slice(0, 10));
      setBuyPrice(asset.currentPrice.toString());
      setBuyQuantity('');
    }
  }, [asset, isOpen]);

  if (!isOpen || !asset) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!buyDate || !buyPrice || !buyQuantity) {
      alert('모든 필드를 입력해주세요.');
      return;
    }

    const quantity = parseFloat(buyQuantity);
    const price = parseFloat(buyPrice);

    if (quantity <= 0) {
      alert('매수 수량은 0보다 커야 합니다.');
      return;
    }

    if (price <= 0) {
      alert('매수가는 0보다 커야 합니다.');
      return;
    }

    actions.confirmBuyMore(asset.id, buyDate, price, quantity);
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

  // 예상 매수금액 계산
  const estimatedTotal = parseFloat(buyPrice || '0') * parseFloat(buyQuantity || '0');

  // 매수 후 예상 평균단가
  const newQuantity = asset.quantity + (parseFloat(buyQuantity || '0') || 0);
  const newAvgPrice = newQuantity > 0
    ? (asset.quantity * asset.purchasePrice + (parseFloat(buyQuantity || '0') || 0) * (parseFloat(buyPrice || '0') || 0)) / newQuantity
    : 0;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-2xl font-bold text-white mb-6">
          추가매수: {asset.customName?.trim() || asset.name}
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
                <div className="text-gray-400">매수평균가</div>
                <div className="text-white font-semibold">
                  {formatCurrency(asset.purchasePrice, asset.currency)}
                </div>
              </div>
              <div>
                <div className="text-gray-400">현재가</div>
                <div className="text-white font-semibold">
                  {formatCurrency(asset.currentPrice, asset.currency)}
                </div>
              </div>
            </div>
          </div>

          {/* 통화 표시 (변경 불가) */}
          <div className="bg-gray-700/50 p-3 rounded-md">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">매수 통화</span>
              <span className="text-white font-medium flex items-center gap-2">
                {asset.currency === Currency.USD && '🇺🇸'}
                {asset.currency === Currency.JPY && '🇯🇵'}
                {asset.currency === Currency.KRW && '🇰🇷'}
                {currencyLabel}
              </span>
            </div>
          </div>

          {/* 매수일자 */}
          <div>
            <label htmlFor="buyDate" className={labelClasses}>매수일자</label>
            <input
              id="buyDate"
              type="date"
              value={buyDate}
              onChange={(e) => setBuyDate(e.target.value)}
              className={inputClasses}
              required
            />
          </div>

          {/* 매수가 */}
          <div>
            <label htmlFor="buyPrice" className={labelClasses}>
              매수가 ({currencySymbol})
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                {currencySymbol}
              </span>
              <input
                id="buyPrice"
                type="number"
                value={buyPrice}
                onChange={(e) => setBuyPrice(e.target.value)}
                className={`${inputClasses} pl-8`}
                required
                min="0"
                step="any"
                placeholder="매수가를 입력하세요"
              />
            </div>
          </div>

          {/* 매수 수량 */}
          <div>
            <label htmlFor="buyQuantity" className={labelClasses}>매수 수량</label>
            <input
              id="buyQuantity"
              type="number"
              value={buyQuantity}
              onChange={(e) => setBuyQuantity(e.target.value)}
              className={inputClasses}
              required
              min="1"
              step="any"
              placeholder="추가 매수할 수량을 입력하세요"
            />
          </div>

          {/* 예상 매수금액 & 변경 후 평균단가 */}
          {estimatedTotal > 0 && (
            <div className="bg-gray-900 p-4 rounded-md space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">예상 매수금액</span>
                <span className="text-xl font-bold text-white">
                  {formatCurrency(estimatedTotal, asset.currency)}
                </span>
              </div>
              <div className="flex justify-between items-center border-t border-gray-700 pt-2">
                <span className="text-gray-400">변경 후 평균단가</span>
                <span className="text-sm font-semibold text-primary-light">
                  {formatCurrency(newAvgPrice, asset.currency)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">변경 후 총 수량</span>
                <span className="text-sm font-semibold text-white">
                  {newQuantity.toLocaleString()}
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
              className="flex-1 bg-primary hover:bg-primary-dark text-white font-bold py-2.5 px-4 rounded-md disabled:bg-gray-600 disabled:cursor-not-allowed transition duration-300 flex items-center justify-center"
            >
              {isLoading ? (
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : '추가매수 확인'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default BuyMoreAssetModal;
