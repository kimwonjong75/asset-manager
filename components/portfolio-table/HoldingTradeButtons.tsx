import type { HoldingTradeButtonsProps } from '../../types/portfolioOwnerGroup';
import { getAssetOwner, OWNER_LABELS } from '../../types/owner';
import { formatKRW, formatOriginalCurrency } from './utils';

export default function HoldingTradeButtons({ asset, onBuy, onSell }: HoldingTradeButtonsProps) {
  const label = OWNER_LABELS[getAssetOwner(asset)] + ' ' + asset.name;
  const classes = 'focus-ring inline-flex min-h-9 items-center rounded-md px-2 text-xs font-semibold hover:bg-gray-700';
  return <div className="mt-1">
    <div className="flex flex-wrap gap-x-2 text-xs text-gray-300">
      <span>평단 {formatOriginalCurrency(asset.purchasePrice, asset.currency)}</span>
      <span>평가 {formatKRW(asset.metrics.currentValueKRW)}</span>
      <span>손익 {formatKRW(asset.metrics.profitLossKRW)}</span>
    </div>
    <div className="flex flex-wrap gap-1">
      {onBuy && <button type="button" className={classes + ' text-up'} aria-label={label + ' 매수'} onClick={() => onBuy(asset)}>매수</button>}
      {onSell && <button type="button" className={classes + ' text-down'} aria-label={label + ' 매도'} onClick={() => onSell(asset)}>매도</button>}
    </div>
  </div>;
}
