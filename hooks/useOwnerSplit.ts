import { useState } from 'react';
import { Currency, type Asset } from '../types';
import { ALL_OWNERS, type OwnerId } from '../types/owner';
import type { OwnerSplitFields } from '../types/ownerTransactions';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useConfirm } from './useConfirm';

const empty: OwnerSplitFields = { quantity: '', price: '', rate: '' };
const emptyDraft = () => ({ WONJONG: { ...empty }, YUSEON: { ...empty } });

export function useOwnerSplit(asset: Asset) {
  const { actions } = usePortfolio();
  const { confirm, confirmRequest } = useConfirm();
  const [source, setSource] = useState<Asset | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [error, setError] = useState('');
  const foreign = (source ?? asset).currency !== Currency.KRW;
  const read = (owner: OwnerId) => {
    const fields = draft[owner];
    return { quantity: fields.quantity.trim() ? Number(fields.quantity) : NaN, price: Number(fields.price), rate: foreign ? Number(fields.rate) : 1 };
  };
  const balances = { WONJONG: read('WONJONG'), YUSEON: read('YUSEON') };
  const complete = ALL_OWNERS.every(owner => {
    const b = balances[owner];
    return Number.isFinite(b.quantity) && b.quantity >= 0 && (b.quantity === 0 || (b.price > 0 && b.rate > 0 && Number.isFinite(b.price * b.rate * b.quantity)));
  });
  const allocated = balances.WONJONG.quantity + balances.YUSEON.quantity;
  const totalCost = ALL_OWNERS.reduce((sum, owner) => {
    const b = balances[owner];
    return sum + b.quantity * b.price * b.rate;
  }, 0);
  const originalRate = foreign ? source?.purchaseExchangeRate : 1;
  const originalCost = source && originalRate && originalRate > 0 ? source.quantity * source.purchasePrice * originalRate : null;
  const open = () => { setDraft(emptyDraft()); setError(''); setSource(asset); };
  const close = async () => {
    const dirty = ALL_OWNERS.some(owner => Object.values(draft[owner]).some(Boolean));
    if (!dirty || await confirm('입력한 잔고 분할 내용을 닫을까요?', { confirmLabel: '닫기', cancelLabel: '계속 입력' })) setSource(null);
  };
  const edit = (owner: OwnerId, key: keyof OwnerSplitFields, value: string) => {
    setDraft(prev => ({ ...prev, [owner]: { ...prev[owner], [key]: value } }));
    setError('');
  };
  const submit = () => {
    if (!source || !complete) return;
    const problem = actions.splitOwnerBalance({ assetId: source.id, expectedQuantity: source.quantity, balances });
    if (problem) setError(problem);
    else setSource(null);
  };
  return { source, draft, foreign, complete, allocated, totalCost, originalCost, open, close, edit, submit, error, confirmRequest };
}
