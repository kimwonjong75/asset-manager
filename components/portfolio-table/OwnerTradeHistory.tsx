import React, { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { OWNER_FILTER_LABELS, OWNER_FILTER_OPTIONS, OWNER_LABELS, type OwnerFilter } from '../../types/owner';
import { ownerTradeEntries } from '../../utils/ownerTransactions';
import Button from '../common/Button';
import Modal from '../common/Modal';
import Segmented from '../common/Segmented';

const options = OWNER_FILTER_OPTIONS.map(value => ({ value, label: OWNER_FILTER_LABELS[value] }));
const numbers = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 12 });

export default function OwnerTradeHistory(): React.ReactElement {
  const { data, ui } = usePortfolio();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<OwnerFilter>('ALL');
  const records = useMemo(() => open ? ownerTradeEntries(data.buyHistory, data.sellHistory, data.assets)
    .filter(row => filter === 'ALL' || row.owner === filter) : [], [open, filter, data.buyHistory, data.sellHistory, data.assets]);
  return <>
    <Button variant="secondary" icon={<History />} onClick={() => { setFilter(ui.accountView); setOpen(true); }}>거래내역</Button>
    <Modal open={open} onClose={() => setOpen(false)} title="보유자별 거래내역" size="lg">
      <Segmented options={options} value={filter} onChange={setFilter} />
      <p className="my-3 text-xs text-gray-400">새로 기록한 매수와 기존 매도 내역을 표시합니다. 이전 매수 메모는 각 자산에서 확인할 수 있습니다.</p>
      {records.length ? <ul className="divide-y divide-gray-700">{records.map(row =>
        <li key={row.key} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
          <div><strong className="text-white">{row.name}</strong> <span className="text-xs text-gray-400">{row.ticker}</span>
            <p className="text-xs text-gray-400">{row.date} · {row.owner ? OWNER_LABELS[row.owner] : '보유자 미확인'}</p></div>
          <div className="text-right tabular-nums"><span className={row.side === '매수' ? 'text-up' : 'text-down'}>{row.side}</span> {numbers.format(row.quantity)}{row.quantityUnit && ' ' + row.quantityUnit}
            <p className="text-xs text-gray-400">단가 {numbers.format(row.price)} {row.currency}</p></div>
        </li>)}</ul> : <p className="py-6 text-sm text-gray-400">표시할 거래가 없습니다.</p>}
    </Modal>
  </>;
}
