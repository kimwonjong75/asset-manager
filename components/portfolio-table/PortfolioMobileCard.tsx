import React, { useRef, useState } from 'react';
import { Asset, Currency, PortfolioSnapshot, ExchangeRates } from '../../types';
import { EnrichedAsset } from '../../types/ui';
import { formatOriginalCurrency, formatKRW, formatProfitLoss, getChangeColor } from './utils';
import ActionMenu from '../common/ActionMenu';
import CrossDaysBadge from '../common/CrossDaysBadge';
import { MoreHorizontal } from 'lucide-react';
import AssetTrendChart from '../AssetTrendChart';


interface PortfolioMobileCardProps {
  asset: EnrichedAsset;
  history: PortfolioSnapshot[];
  onEdit: (asset: Asset) => void;
  onSell?: (asset: Asset) => void;
  onBuy?: (asset: Asset) => void;
  onRefreshOne?: (id: string) => void | Promise<void>;
  exchangeRates?: ExchangeRates;
  onTogglePin?: (id: string) => void;
  onMemoEdit?: (asset: Asset) => void;
  crossDays?: number | null;
}


const PortfolioMobileCard: React.FC<PortfolioMobileCardProps> = ({
  asset,
  history,
  onEdit,
  onSell,
  onBuy,
  onRefreshOne,
  exchangeRates,
  onTogglePin,
  onMemoEdit,
  crossDays,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const menuAnchorRef = useRef<HTMLButtonElement>(null);

  const { returnPercentage, currentValue, currentValueKRW, profitLoss, dropFromHigh, yesterdayChange } = asset.metrics;
  const isNonKRW = asset.currency !== Currency.KRW;

  let derivedExchangeRate = 1;
  if (isNonKRW) {
    if (exchangeRates && asset.currency in exchangeRates) {
      derivedExchangeRate = exchangeRates[asset.currency as keyof ExchangeRates];
    } else if (currentValue > 0) {
      derivedExchangeRate = currentValueKRW / currentValue;
    }
  }

  return (
    <div className="border-b border-gray-700">
      <div className="px-4 py-3 flex items-start gap-3">
        {/* Left: name + info */}
        <div className="flex-1 min-w-0" onClick={() => setExpanded(!expanded)}>
          <div className="flex items-center gap-2 flex-wrap">
            {onTogglePin && (
              <button
                onClick={(e) => { e.stopPropagation(); onTogglePin(asset.id); }}
                className={`text-lg leading-none transition-colors flex-shrink-0 ${asset.pinned ? 'text-yellow-400' : 'text-gray-600 hover:text-yellow-400/60'}`}
              >
                {asset.pinned ? '★' : '☆'}
              </button>
            )}
            <span className="font-bold text-primary-light text-sm truncate max-w-[160px]">
              {asset.customName?.trim() || asset.name}
            </span>
            <span
              className={`text-[11px] leading-none cursor-pointer transition-opacity flex-shrink-0 ${asset.memo ? 'opacity-60 hover:opacity-100' : 'opacity-20 hover:opacity-50'}`}
              onClick={(e) => { e.stopPropagation(); onMemoEdit?.(asset); }}
            >📝</span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[11px] text-gray-500">{asset.ticker} | {asset.exchange}</span>
            <CrossDaysBadge crossDays={crossDays} />
          </div>

          {/* Price + Return row */}
          <div className="flex items-baseline gap-3 mt-2">
            <span className="text-white font-semibold text-sm">
              {formatOriginalCurrency(asset.currentPrice, asset.currency)}
            </span>
            <span className={`text-sm font-medium ${getChangeColor(returnPercentage)}`}>
              {returnPercentage >= 0 ? '+' : ''}{returnPercentage.toFixed(2)}%
            </span>
          </div>

          {/* Secondary info row */}
          <div className="flex items-center gap-4 mt-1 text-[11px] text-gray-400">
            <span>평가 {isNonKRW ? formatKRW(currentValueKRW) : formatOriginalCurrency(currentValue, asset.currency)}</span>
            <span className={getChangeColor(dropFromHigh)}>고가대비 {dropFromHigh.toFixed(1)}%</span>
            <span className={getChangeColor(yesterdayChange)}>전일 {yesterdayChange >= 0 ? '+' : ''}{yesterdayChange.toFixed(1)}%</span>
          </div>
        </div>

        {/* Right: menu button */}
        <button
          ref={menuAnchorRef}
          onClick={() => setMenuOpen(!menuOpen)}
          className="p-2 text-gray-400 hover:text-white flex-shrink-0 mt-1"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>

        {menuOpen && (
          <ActionMenu
            anchorRef={menuAnchorRef}
            onClose={() => setMenuOpen(false)}
            items={[
              ...(onRefreshOne ? [{ label: '가격 업데이트', onClick: () => onRefreshOne(asset.id), colorClass: 'text-blue-400' }] : []),
              { label: '수정', onClick: () => onEdit(asset) },
              ...(onBuy ? [{ label: '매수', onClick: () => onBuy(asset), colorClass: 'text-green-400' }] : []),
              ...(onSell ? [{ label: '매도', onClick: () => onSell(asset), colorClass: 'text-red-400' }] : []),
              { label: '차트 보기', onClick: () => setExpanded(!expanded), colorClass: 'text-gray-200' },
            ]}
          />
        )}
      </div>

      {/* Expanded chart */}
      {expanded && (
        <div className="pb-2">
          <AssetTrendChart
            history={history}
            assetId={asset.id}
            assetName={asset.customName?.trim() || asset.name}
            currentQuantity={asset.quantity}
            currentPrice={asset.currentPrice}
            currency={asset.currency}
            exchangeRate={derivedExchangeRate}
            ticker={asset.ticker}
            exchange={asset.exchange}
            categoryId={asset.categoryId}
            purchasePrice={asset.purchasePrice}
          />
        </div>
      )}
    </div>
  );
};

export default PortfolioMobileCard;
