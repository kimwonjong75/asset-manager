
import React, { useState, useEffect } from 'react';
import { Asset, Currency, CURRENCY_SYMBOLS } from '../types';
import { fetchHistoricalExchangeRate } from '../services/geminiService';

interface SellAssetModalProps {
  asset: Asset | null;
  isOpen: boolean;
  onClose: () => void;
  onSell: (assetId: string, sellDate: string, sellPrice: number, sellPriceOriginal: number, sellQuantity: number, sellExchangeRate?: number, settlementCurrency?: Currency, sellPriceSettlement?: number) => void;
  isLoading: boolean;
}

const SellAssetModal: React.FC<SellAssetModalProps> = ({ asset, isOpen, onClose, onSell, isLoading }) => {
  const [sellDate, setSellDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [sellPrice, setSellPrice] = useState<string>('');
  const [sellQuantity, setSellQuantity] = useState<string>('');
  const [isFetchingRate, setIsFetchingRate] = useState<boolean>(false);
  const [settlementCurrency, setSettlementCurrency] = useState<Currency>(Currency.KRW);

  useEffect(() => {
    if (asset && isOpen) {
      setSellDate(new Date().toISOString().slice(0, 10));
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

    // 환산 로직: 사용자가 입력한 금액은 선택한 정산 통화 기준
    // KRW 환산, 원화 외 자산의 원화가 계산, 매도 시점 환율 기록
    setIsFetchingRate(true);
    try {
      const [rateSettleToKRW, rateAssetToKRW, rateSettleToAsset] = await Promise.all([
        settlementCurrency !== Currency.KRW ? fetchHistoricalExchangeRate(sellDate, settlementCurrency, Currency.KRW) : Promise.resolve(1),
        asset.currency !== Currency.KRW ? fetchHistoricalExchangeRate(sellDate, asset.currency, Currency.KRW) : Promise.resolve(1),
        settlementCurrency !== asset.currency ? fetchHistoricalExchangeRate(sellDate, settlementCurrency, asset.currency) : Promise.resolve(1),
      ]);

      const sellPriceKRW = price * rateSettleToKRW;
      const sellExchangeRate = asset.currency !== Currency.KRW ? rateAssetToKRW : undefined;
      const sellPriceOriginal = asset.currency === Currency.KRW ? sellPriceKRW : price * rateSettleToAsset;

      onSell(
        asset.id,
        sellDate,
        sellPriceKRW,
        sellPriceOriginal,
        quantity,
        sellExchangeRate,
        settlementCurrency,
        price
      );
    } catch (error) {
      console.error('Failed to compute settlement/FX:', error);
      alert('환율 정보를 가져오지 못했습니다. 다시 시도해주세요.');
      return;
    } finally {
      setIsFetchingRate(false);
    }
  };

  const inputClasses = "w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition";
  const labelClasses = "block text-sm font-medium text-gray-300 mb-1";

  const formatKRW = (num: number) => {
    return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(num);
  };

  const formatOriginalCurrency = (num: number, currency: Currency) => {
    return `${CURRENCY_SYMBOLS[currency]}${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num)}`;
  };

  const isNonKRW = asset.currency !== Currency.KRW;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50" onClick={onClose} role="dialog" aria-modal="true">
      <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-2xl font-bold text-white mb-6">매도: {(asset.customName?.trim() || asset.name)}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-gray-700 p-4 rounded-md">
            <div className={labelClasses}>보유정보</div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-gray-400">보유 수량</div>
                <div className="text-white font-semibold">{asset.quantity.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-gray-400">현재가</div>
                <div className="text-white font-semibold">{formatKRW(asset.currentPrice)}</div>
                {isNonKRW && (
                  <div className="text-xs text-gray-500">{formatOriginalCurrency(asset.priceOriginal, asset.currency)}</div>
                )}
              </div>
            </div>
          </div>

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

          <div>
            <label htmlFor="sellPrice" className={labelClasses}>매도가 (정산 통화)</label>
            <input
              id="sellPrice"
              type="number"
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value)}
              className={inputClasses}
              required
              min="0"
              step="any"
              placeholder="매도가를 입력하세요"
            />
            <div className="mt-2">
              <label htmlFor="settlementCurrency" className={labelClasses}>정산 통화 선택</label>
              <select
                id="settlementCurrency"
                value={settlementCurrency}
                onChange={(e) => setSettlementCurrency(e.target.value as Currency)}
                className={inputClasses}
              >
                {Object.values(Currency).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <div className="text-xs text-gray-500 mt-1">
                입력 금액은 선택한 통화({settlementCurrency}) 기준입니다.
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="sellQuantity" className={labelClasses}>매도 수량</label>
            <input
              id="sellQuantity"
              type="number"
              value={sellQuantity}
              onChange={(e) => setSellQuantity(e.target.value)}
              className={inputClasses}
              required
              min="0"
              max={asset.quantity}
              step="any"
              placeholder={`최대 ${asset.quantity.toLocaleString()}`}
            />
            <div className="text-xs text-gray-500 mt-1">
              매도 후 남은 수량: {sellQuantity && !isNaN(parseFloat(sellQuantity)) 
                ? Math.max(0, asset.quantity - parseFloat(sellQuantity)).toLocaleString()
                : asset.quantity.toLocaleString()}
            </div>
          </div>

          <div className="mt-8 flex justify-end space-x-4 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading || isFetchingRate}
              className="bg-gray-600 hover:bg-gray-500 text-white font-medium py-2 px-4 rounded-md transition duration-300 disabled:bg-gray-700 disabled:cursor-not-allowed"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={isLoading || isFetchingRate}
              className="bg-primary hover:bg-primary-dark text-white font-bold py-2 px-4 rounded-md disabled:bg-gray-600 disabled:cursor-not-allowed transition duration-300 flex items-center justify-center"
            >
              {isLoading || isFetchingRate ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {isFetchingRate ? '환율 조회 중...' : '처리 중...'}
                </>
              ) : '매도'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SellAssetModal;

