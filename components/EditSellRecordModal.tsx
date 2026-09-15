import React, { useState, useEffect } from 'react';
import { Currency, CURRENCY_SYMBOLS } from '../types';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useConfirm } from '../hooks/useConfirm';
import ConfirmDialog from './common/ConfirmDialog';
import Modal from './common/Modal';
import Button from './common/Button';
import { CircleAlert, TriangleAlert, Trash2 } from 'lucide-react';

const EditSellRecordModal: React.FC = () => {
  const { modal, actions, data, status } = usePortfolio();
  const record = modal.editingSellRecord;
  const isOpen = !!record;
  const isLoading = status.isLoading;

  const [sellDate, setSellDate] = useState<string>('');
  const [sellPriceSettlement, setSellPriceSettlement] = useState<string>('');
  const [sellQuantity, setSellQuantity] = useState<string>('');
  // 제출 시도 후에만 인라인 검증 문구 노출(브라우저 alert 대체 — RULES.md §7)
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const { confirm, confirmRequest } = useConfirm();

  useEffect(() => {
    if (record && isOpen) {
      setSubmitAttempted(false);
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

  const parsedPrice = parseFloat(sellPriceSettlement);
  const parsedQty = parseFloat(sellQuantity);
  const formError = (!sellDate || !Number.isFinite(parsedPrice) || !Number.isFinite(parsedQty))
    ? '모든 필드를 올바르게 입력해주세요.'
    : parsedPrice <= 0
      ? '매도가는 0보다 커야 합니다.'
      : parsedQty <= 0
        ? '매도 수량은 0보다 커야 합니다.'
        : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseFloat(sellPriceSettlement);
    const quantity = parseFloat(sellQuantity);
    if (formError) {
      setSubmitAttempted(true);
      return;
    }
    await actions.editSellRecord(record.id, {
      sellDate,
      sellPriceSettlement: price,
      sellQuantity: quantity,
    });
    actions.closeEditSellRecord();
  };

  const handleDelete = async () => {
    const ok = await confirm(
      `${record.name} 매도 기록을 삭제하시겠습니까?\n\n주의: 매도 기록만 삭제되며 보유 수량은 자동 복구되지 않습니다.`,
      { title: '매도 기록 삭제', confirmLabel: '삭제', tone: 'danger' },
    );
    if (!ok) return;
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
    <>
    <Modal
      open={isOpen}
      onClose={onClose}
      title={`매도 기록 수정: ${record.name}`}
      size="md"
      footer={
        <>
          <Button variant="danger" icon={<Trash2 />} onClick={handleDelete} disabled={isLoading} className="mr-auto">
            삭제
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>취소</Button>
          <Button type="submit" form="edit-sell-record-form" variant="primary" loading={isLoading}>저장</Button>
        </>
      }
    >
        <form id="edit-sell-record-form" onSubmit={handleSubmit} className="space-y-4">
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
              매도 수량 {!assetStillExists && <span className="inline-flex items-center gap-1 text-amber-400 text-xs"><TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />(원본 자산이 삭제되어 수량 변경 시 보유수량 복구 불가)</span>}
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

          {submitAttempted && formError && (
            <p className="flex items-center gap-1.5 text-danger text-sm" role="alert"><CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />{formError}</p>
          )}
        </form>
    </Modal>
    {confirmRequest && <ConfirmDialog {...confirmRequest} />}
    </>
  );
};

export default EditSellRecordModal;
