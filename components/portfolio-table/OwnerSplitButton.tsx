import React from 'react';
import { useOwnerSplit } from '../../hooks/useOwnerSplit';
import { ALL_OWNERS, OWNER_LABELS } from '../../types/owner';
import type { OwnerAssetProps } from '../../types/ownerTransactions';
import Button from '../common/Button';
import Modal from '../common/Modal';
import ConfirmDialog from '../common/ConfirmDialog';

const fields = 'w-full rounded-md border border-gray-600 bg-gray-800 p-2 text-sm text-white focus-ring';
const quantityFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 12 });
const wonFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });

export default function OwnerSplitButton({ asset }: OwnerAssetProps): React.ReactElement {
  const form = useOwnerSplit(asset);
  return <span onClick={event => event.stopPropagation()}>
    <Button variant="warning" onClick={form.open}>보유자 분할</Button>
    {form.source && <Modal open onClose={() => { void form.close(); }} title="보유자별 시작 잔고" size="lg"
      description={form.source.name + ' · 기존 수량 ' + quantityFormat.format(form.source.quantity)}
      footer={<Button onClick={form.submit} disabled={!form.complete}>확인한 잔고로 분할</Button>}>
      <p className="mb-3 text-sm text-gray-300">같은 기준일의 보유 수량과 평균 매입가를 입력하세요. 보유하지 않은 사람의 수량은 0으로 입력합니다.</p>
      <div className="grid gap-3 sm:grid-cols-2">{ALL_OWNERS.map(owner =>
        <fieldset key={owner} className="min-w-0 space-y-2 rounded-md border border-gray-700 p-3">
          <legend className="px-1 font-semibold text-white">{OWNER_LABELS[owner]}</legend>
          <label className="block text-xs text-gray-300">보유 수량
            <input aria-label={OWNER_LABELS[owner] + ' 보유 수량'} className={fields} type="number" min="0" step="any"
              value={form.draft[owner].quantity} onChange={e => form.edit(owner, 'quantity', e.target.value)} /></label>
          <label className="block text-xs text-gray-300">평균 매입가 ({asset.currency})
            <input aria-label={OWNER_LABELS[owner] + ' 평균 매입가'} className={fields} type="number" min="0" step="any"
              value={form.draft[owner].price} onChange={e => form.edit(owner, 'price', e.target.value)} /></label>
          {form.foreign && <label className="block text-xs text-gray-300">평균 매입환율 (원/{asset.currency})
            <input aria-label={OWNER_LABELS[owner] + ' 평균 매입환율'} className={fields} type="number" min="0" step="any"
              value={form.draft[owner].rate} onChange={e => form.edit(owner, 'rate', e.target.value)} /></label>}
        </fieldset>)}</div>
      <div className="my-3 text-sm text-gray-200 tabular-nums" aria-live="polite">
        <p>수량 합계 {Number.isFinite(form.allocated) ? quantityFormat.format(form.allocated) : '—'} / {quantityFormat.format(form.source.quantity)}</p>
        <p>합산 매입원금 {form.originalCost === null ? '미확인' : wonFormat.format(form.originalCost) + '원'} → {form.complete ? wonFormat.format(form.totalCost) + '원' : '—'}</p>
      </div>
      <p className="text-xs text-gray-400">확정하면 입력한 원가로 개인별 잔고가 생깁니다. 과거 매수·매도와 차트 기록은 기존 자산에 보존됩니다.</p>
      {form.error && <p role="alert" className="mt-2 text-sm text-warning">{form.error}</p>}
    </Modal>}
    {form.confirmRequest && <ConfirmDialog {...form.confirmRequest} />}
  </span>;
}
