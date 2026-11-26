import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { ALL_OWNERS, getAssetOwner } from '../../types/owner';
import type { PortfolioOwnerGroupRowProps } from '../../types/portfolioOwnerGroup';
import type { ColumnKey } from '../../types/ui';
import { formatOwnerQuantity } from '../../utils/ownerQuantity';
import { commonHoldingValue } from '../../utils/portfolioOwnerGroups';
import RowActionMenuButton from '../common/RowActionMenuButton';
import OwnerPositionBadge from './OwnerPositionBadge';
import { formatKRW, formatOriginalCurrency, getChangeColor } from './utils';

export default function PortfolioOwnerGroupRow({ group, mobile, visibleColumns, onBuy, onSell, children }: PortfolioOwnerGroupRowProps) {
  const { ui, data } = usePortfolio();
  const [expanded, setExpanded] = useState(false);
  const [lastFocus, setLastFocus] = useState<string | null>(null);
  if (ui.focusedAssetId !== lastFocus) {
    setLastFocus(ui.focusedAssetId);
    if (group.holdings.some(a => a.id === ui.focusedAssetId)) setExpanded(true);
  }
  const first = group.holdings[0];
  const title = commonHoldingValue(group.holdings, a => a.name) ?? first.ticker;
  const total = formatOwnerQuantity(first, group.quantity, data.categoryStore.categories);
  const badges = ALL_OWNERS.map(owner => {
    const holding = group.holdings.find(a => getAssetOwner(a) === owner);
    return holding && <OwnerPositionBadge key={owner} asset={holding} quantity={group.quantities[owner]} />;
  });
  const toggle = (
    <button type="button" aria-expanded={expanded} aria-label={`${title} 보유자별 상세 ${expanded ? '접기' : '펼치기'}`}
      onClick={() => setExpanded(!expanded)} className="focus-ring inline-flex min-h-10 min-w-0 items-center gap-1.5 text-left font-bold text-white">
      {expanded ? <ChevronDown size={16} className="shrink-0" /> : <ChevronRight size={16} className="shrink-0" />}
      <span className="break-words">{title}</span>
    </button>
  );
  const tradeMenu = (onBuy || onSell) && (
    <RowActionMenuButton label={`${title} 거래 메뉴`} header={title} items={[
      ...(onBuy ? [{ label: '매수', onClick: () => onBuy(first, true) }] : []),
      ...(onSell ? [{ label: '매도', onClick: () => onSell(first, true) }] : []),
    ]} />
  );
  const returns = group.returnPercentage === null ? '—' : group.returnPercentage.toFixed(2) + '%';
  const pnl = formatKRW(group.profitLossKRW);
  const pnlClass = getChangeColor(group.profitLossKRW);
  const cell = (key: ColumnKey): ReactNode => {
    switch (key) {
      case 'quantity': return total;
      case 'currentValue': return formatKRW(group.currentValueKRW);
      case 'purchaseValue': return formatKRW(group.purchaseValueKRW);
      case 'returnPercentage': return <div className={pnlClass}>{returns}<div className="text-xs">{pnl}</div></div>;
      case 'allocation': return group.allocation.toFixed(2) + '%';
      case 'purchasePrice': return group.quantity > 0 ? formatOriginalCurrency(
        group.holdings.reduce((sum, a) => sum + a.metrics.purchaseValue, 0) / group.quantity, first.currency,
      ) : '—';
      case 'currentPrice': {
        const price = commonHoldingValue(group.holdings, a => a.priceOriginal);
        return price !== null && Number.isFinite(price) && price > 0 ? formatOriginalCurrency(price, first.currency) : '—';
      }
      case 'purchaseDate': return commonHoldingValue(group.holdings, a => a.purchaseDate) ?? '—';
      case 'yesterdayChange':
      case 'dropFromHigh': {
        const percent = commonHoldingValue(group.holdings, a => a.metrics[key]);
        return percent === null ? '—' : <span className={getChangeColor(percent)}>{percent.toFixed(2)}%</span>;
      }
      default: return <span className="text-gray-500" title="보유자별 상세에서 확인">—</span>;
    }
  };
  if (mobile) return (
    <div className="border-b border-gray-700">
      <div className="px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">{toggle}<span className="ml-auto whitespace-nowrap font-semibold">합계 {total}</span>{tradeMenu}</div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-400"><span>{first.ticker}</span>{badges}</div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-gray-300">
          <span>평가 {formatKRW(group.currentValueKRW)}</span><span className={pnlClass}>손익 {pnl} · {returns}</span>
        </div>
      </div>
      {expanded && <div className="border-l-2 border-primary/50">{children}</div>}
    </div>
  );
  return <>
    <tr className="border-b border-gray-700 bg-surface-muted/40">
      <td />
      <td className="px-4 py-2">
        {toggle}
        <div className="mb-1 text-xs text-gray-400">{first.ticker} · 합계 {total}</div>
        <div className="flex flex-wrap gap-1">{badges}</div>
      </td>
      {visibleColumns.filter(c => c.visible).map(c => (
        <td key={c.key} className="break-words px-3 py-2 text-right tabular-nums">{cell(c.key)}</td>
      ))}
      <td className="text-center">{tradeMenu}</td>
    </tr>
    {expanded && children}
  </>;
}
