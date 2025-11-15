
import React, { useState, useEffect } from 'react';
import { Asset, AssetCategory, EXCHANGE_MAP, Currency } from '../types';

interface EditAssetModalProps {
  asset: Asset | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (asset: Asset) => void;
  onDelete: (assetId: string) => void;
  isLoading: boolean;
}

const EditAssetModal: React.FC<EditAssetModalProps> = ({ asset, isOpen, onClose, onSave, onDelete, isLoading }) => {
  const [formData, setFormData] = useState<Asset | null>(null);

  useEffect(() => {
    if (asset) {
        setFormData({
            ...asset,
            purchaseDate: new Date(asset.purchaseDate).toISOString().slice(0, 10)
        });
    }
  }, [asset]);

  useEffect(() => {
    if (formData) {
        const currentExchanges = EXCHANGE_MAP[formData.category] || [];
        if (!currentExchanges.includes(formData.exchange)) {
            setFormData(prev => prev ? { ...prev, exchange: currentExchanges[0] || '' } : null);
        }
    }
  }, [formData?.category]);


  if (!isOpen || !formData) return null;
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => {
        if (!prev) return null;

        let newValue: any = value;
        if (name === 'quantity' || name === 'purchasePrice') {
            newValue = parseFloat(value) || 0;
        } else if (name === 'sellAlertDropRate') {
            newValue = value === '' ? undefined : parseFloat(value);
            if (isNaN(newValue as number)) newValue = undefined;
        }

        return { ...prev, [name]: newValue };
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData) {
      onSave(formData);
    }
  };

  const handleDelete = () => {
    if (asset && window.confirm(`'${asset.name}' 자산을 정말 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
      onDelete(asset.id);
    }
  };

  const inputClasses = "w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition";
  const labelClasses = "block text-sm font-medium text-gray-300 mb-1";
  const exchangesForCategory = EXCHANGE_MAP[formData.category] || [];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50" onClick={onClose} role="dialog" aria-modal="true">
      <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-2xl font-bold text-white mb-6">자산 수정: {asset?.name}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="category-edit" className={labelClasses}>자산 구분</label>
            <select id="category-edit" name="category" value={formData.category} onChange={handleChange} className={inputClasses}>
              {Object.values(AssetCategory).map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
           <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="exchange-edit" className={labelClasses}>거래소/시장</label>
              <select id="exchange-edit" name="exchange" value={formData.exchange} onChange={handleChange} className={inputClasses} disabled={exchangesForCategory.length === 0}>
                {exchangesForCategory.map((ex) => (
                  <option key={ex} value={ex}>{ex}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ticker-edit" className={labelClasses}>티커 (종목코드)</label>
              <input id="ticker-edit" name="ticker" type="text" value={formData.ticker} onChange={handleChange} className={inputClasses} required />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="quantity-edit" className={labelClasses}>수량</label>
              <input id="quantity-edit" name="quantity" type="number" value={formData.quantity} onChange={handleChange} className={inputClasses} required min="0" step="any" />
            </div>
            <div>
              <label htmlFor="purchasePrice-edit" className={labelClasses}>매수가</label>
              <input id="purchasePrice-edit" name="purchasePrice" type="number" value={formData.purchasePrice} onChange={handleChange} className={inputClasses} required min="0" step="any" />
            </div>
            <div>
              <label htmlFor="currency-edit" className={labelClasses}>매수 통화</label>
              <select id="currency-edit" name="currency" value={formData.currency} onChange={handleChange} className={inputClasses}>
                  {Object.values(Currency).map((cur) => (
                    <option key={cur} value={cur}>{cur}</option>
                  ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="purchaseDate-edit" className={labelClasses}>매수일</label>
              <input id="purchaseDate-edit" name="purchaseDate" type="date" value={formData.purchaseDate} onChange={handleChange} className={inputClasses} required />
            </div>
            <div>
                <label htmlFor="sellAlertDropRate-edit" className={labelClasses}>
                    개별 매도 알림률 (%)
                </label>
                <input
                    id="sellAlertDropRate-edit"
                    name="sellAlertDropRate"
                    type="number"
                    placeholder="기본값 사용"
                    value={formData.sellAlertDropRate ?? ''}
                    onChange={handleChange}
                    className={inputClasses}
                    min="0"
                    step="1"
                    title="비워두면 전역 설정을 따릅니다."
                />
            </div>
          </div>
          
          <div className="mt-8 flex justify-between items-center pt-4">
            <button
              type="button"
              onClick={handleDelete}
              disabled={isLoading}
              className="bg-danger hover:bg-red-600 text-white font-medium py-2 px-4 rounded-md transition duration-300 disabled:bg-gray-600 disabled:cursor-not-allowed"
            >
              삭제
            </button>
            <div className="flex space-x-4">
              <button type="button" onClick={onClose} className="bg-gray-600 hover:bg-gray-500 text-white font-medium py-2 px-4 rounded-md transition duration-300">
                취소
              </button>
              <button type="submit" disabled={isLoading} className="bg-primary hover:bg-primary-dark text-white font-bold py-2 px-4 rounded-md disabled:bg-gray-600 disabled:cursor-not-allowed transition duration-300 flex items-center justify-center">
                {isLoading ? (
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
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

export default EditAssetModal;