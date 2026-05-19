import React, { useState, useEffect } from 'react';
import { Currency, CURRENCY_SYMBOLS } from '../types';
import { usePortfolio } from '../contexts/PortfolioContext';

const EditSellRecordModal: React.FC = () => {
  const { modal, actions, data, status } = usePortfolio();
  const record = modal.editingSellRecord;
  const isOpen = !!record;
  const isLoading = status.isLoading;

  const [sellDate, setSellDate] = useState<string>('');
  const [sellPriceSettlement, setSellPriceSettlement] = useState<string>('');
  const [sellQuantity, setSellQuantity] = useState<string>('');

  useEffect(() => {
    if (record && isOpen) {
      setSellDate(record.sellDate);
      const initialPrice = record.sellPriceSettlement ?? record.sellPriceOriginal ?? 0;
      setSellPriceSettlement(String(initialPrice));
      setSellQuantity(String(record.sellQuantity));
    }
  }, [record, isOpen]);

  if (!isOpen || !record) return null;

  const settlementCurrency = record.settlementCurrency || record.originalCurrency || Currency.KRW;
  const currencySymbol = CURRENCY_SYMBOLS[settlementCurrency];
  const assetStillExists = data.assets.some(a => a.id === record.assetId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseFloat(sellPriceSettlement);
    const quantity = parseFloat(sellQuantity);
    if (!sellDate || !Number.isFinite(price) || !Number.isFinite(quantity)) {
      alert('모든 필드를 올바르게 입력해주세요.');
      return;
    }
    if (price <= 0) {
      alert('매도가는 0보다 커야 합니다.');
      return;
    }
    if (quantity <= 0) {
      alert('매도 수량은 0보다 커야 합니다.');
      return;
    }
    await actions.editSellRecord(record.id, {
      sellDate,
      sellPriceSettlement: price,
      sellQuantity: quantity,
    });
    actions.closeEditSellRecord();
  };

  const handleDelete = () => {
    if (!confirm(`${record.name} 매도 기록을 삭제하시겠습니까?\n\n주의: 매도 기록만 삭제되며 보유 수량은 자동 복구되지 않습니다.`)) return;
    actions.deleteSellRecord(record.id);
    actions.closeEditSellRecord();
  };

  const onClose = actions.closeEditSellRecord;
  const inputClasses = "w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition";
  const labelClasses = "block text-sm font-medium text-gray-300 mb-1";

  const estimatedTotal = (parseFloat(sellPriceSettlement || '0') || 0) * (parseFloat(sellQuantity || '0') || 0);
  const formatSettlement = (n: number) =>
    settlementCurrency === Currency.KRW
      ? new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(n)
      : `${currencySymbol}${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

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
          매도 기록 수정: {record.name}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-gray-700/50 p-3 rounded-md grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-gray-400">티커</div>
              <div className="text-white font-semibold">{record.ticker}</div>
            </div>
            <div>
              <div className="text-gray-400">정산 통화</div>
              <div className="text-white font-semibold">{settlementCurrency}</div>
            </div>
            <div className="col-span-2">
              <div className="text-gray-400">매도 시 환율</div>
              <div className="text-white font-semibold">
                {record.sellExchangeRate ? `${record.sellExchangeRate.toLocaleString('ko-KR', { maximumFractionDigits: 4 })} KRW / ${settlementCurrency}` : '-'}
              </div>
              <p className="text-xs text-gray-500 mt-1">* 매도일자를 변경하면 해당 일자의 환율로 재조회됩니다.</p>
            </div>
          </div>

          <div>
            <label htmlFor="edit-sell-date" className={labelClasses}>매도일자</label>
            <input
              id="edit-sell-date"
              type="date"
              value={sellDate}
              onChange={(e) => setSellDate(e.target.value)}
              className={inputClasses}
              required
            />
          </div>

          <div>
            <label htmlFor="edit-sell-price" className={labelClasses}>
              매도가 ({currencySymbol})
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{currencySymbol}</span>
              <input
                id="edit-sell-price"
                type="number"
                value={sellPriceSettlement}
                onChange={(e) => setSellPriceSettlement(e.target.value)}
                className={`${inputClasses} pl-8`}
                required
                min="0"
                step="any"
              />
            </div>
          </div>

          <div>
            <label htmlFor="edit-sell-quantity" className={labelClasses}>
              매도 수량 {!assetStillExists && <span className="text-yellow-400 text-xs">(원본 자산이 삭제되어 수량 변경 시 보유수량 복구 불가)</span>}
            </label>
            <input
              id="edit-sell-quantity"
              type="number"
              value={sellQuantity}
              onChange={(e) => setSellQuantity(e.target.value)}
              className={inputClasses}
              required
              min="0"
              step="any"
            />
          </div>

          {estimatedTotal > 0 && (
            <div className="bg-gray-900 p-4 rounded-md">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">예상 매도금액</span>
                <span className="text-xl font-bold text-white">{formatSettlement(estimatedTotal)}</span>
              </div>
            </div>
          )}

          <div className="pt-4 flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={handleDelete}
              disabled={isLoading}
              className="sm:w-32 bg-danger hover:bg-red-600 text-white font-medium py-2.5 px-4 rounded-md disabled:bg-gray-600 disabled:cursor-not-allowed transition duration-300"
            >
              삭제
            </button>
            <div className="flex-1 flex gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="flex-1 bg-gray-600 hover:bg-gray-500 text-white font-medium py-2.5 px-4 rounded-md disabled:cursor-not-allowed transition duration-300"
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
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : '저장'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditSellRecordModal;
