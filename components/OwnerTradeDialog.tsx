import React from 'react';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useOwnerTrade } from '../hooks/useOwnerTrade';
import { ALL_OWNERS, OWNER_LABELS } from '../types/owner';
import type { OwnerTradeBalanceProps, OwnerTradeDialogProps } from '../types/ownerTrade';
import { formatOwnerQuantity } from '../utils/ownerQuantity';
import Button from './common/Button';
import Modal from './common/Modal';

export function OwnerTradeBalance({ target, change }: OwnerTradeBalanceProps) {
  const { data } = usePortfolio();
  const previous = target.position?.quantity ?? 0;
  if (!Number.isFinite(change) || !change || previous + change < 0) return null;
  const quantity = (n: number) => formatOwnerQuantity(target.source, n, data.categoryStore.categories);
  return <div aria-live="polite" className="space-y-1 rounded-md bg-gray-900 px-4 py-3 text-sm tabular-nums">
    <div className="flex justify-between gap-3"><span>{OWNER_LABELS[target.owner]} 잔고</span><strong>{quantity(previous)} → {quantity(previous + change)}</strong></div>
    <div className="flex justify-between gap-3 text-gray-300"><span>두 사람 합계</span><span>{quantity(target.totalQuantity)} → {quantity(target.totalQuantity + change)}</span></div>
  </div>;
}

export default function OwnerTradeDialog({ source, side, children }: OwnerTradeDialogProps) {
  const { data, actions, status } = usePortfolio();
  const selection = useOwnerTrade(source, side);
  const buy = side === 'buy';
  const verb = buy ? '매수' : '매도';
  const close = buy ? actions.closeBuyModal : actions.closeSellModal;
  const formId = buy ? 'buy-more-asset-form' : 'sell-asset-form';
  return <Modal open onClose={close} title={`${verb} · ${source.customName?.trim() || source.name}`} size="md" footer={<>
    <Button variant="secondary" onClick={close}>취소</Button>
    <Button type="submit" form={formId} variant="primary" loading={status.isLoading} disabled={!selection.target}>
      {selection.target && OWNER_LABELS[selection.target.owner] + ' '}{verb} 기록
    </Button>
  </>}>
    {selection.canChoose && <fieldset className="mb-4" disabled={status.isLoading}>
      <legend className="mb-2 text-sm font-medium text-gray-300">{verb}할 보유자</legend>
      <div className="grid grid-cols-2 gap-2">{ALL_OWNERS.map(id => {
        const selected = selection.owner === id;
        const quantity = selection.byOwner[id].reduce((sum, a) => sum + a.quantity, 0);
        const balanceLabel = quantity || !buy ? '보유 ' + formatOwnerQuantity(source, quantity, data.categoryStore.categories) : '첫 매수';
        return <button key={id} type="button" aria-pressed={selected} aria-label={OWNER_LABELS[id] + ' ' + balanceLabel} disabled={!buy && quantity <= 0}
          onClick={() => selection.choose(id)}
          className={`focus-ring rounded-md border px-3 py-2 text-left disabled:opacity-50 ${selected ? 'border-primary-light bg-primary/15 text-white' : 'border-gray-600 text-gray-300'}`}>
          <span className="block font-semibold">{OWNER_LABELS[id]}</span>
          <span className="text-xs">{balanceLabel}</span>
        </button>;
      })}</div>
    </fieldset>}
    {!selection.canChoose && selection.target && <p className="mb-3 text-sm font-semibold text-gray-200">거래 보유자 · {OWNER_LABELS[selection.target.owner]}</p>}
    {selection.target
      ? <React.Fragment key={selection.target.owner + (selection.target.position?.id ?? '-new')}>{children(selection.target)}</React.Fragment>
      : <p role="status" className="py-2 text-sm text-gray-300">{selection.issue ?? `${verb}를 기록할 보유자를 선택하세요.`}</p>}
  </Modal>;
}
