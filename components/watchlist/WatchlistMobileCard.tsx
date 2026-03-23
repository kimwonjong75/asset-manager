import React, { useRef, useState } from 'react';
import { Currency, CURRENCY_SYMBOLS, ExchangeRates, WatchlistItem } from '../../types';
import { getCategoryName, type CategoryDefinition } from '../../types/category';
import ActionMenu from '../common/ActionMenu';
import MemoTooltip from '../common/MemoTooltip';
import { MoreHorizontal } from 'lucide-react';
import AssetTrendChart from '../AssetTrendChart';

interface WatchlistMobileCardProps {
  item: WatchlistItem & { dropFromHigh: number | null; yesterdayChange: number };
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenEditModal: (item: WatchlistItem) => void;
  onTogglePin?: (id: string) => void;
  onMemoEdit?: (item: WatchlistItem) => void;
  categories: CategoryDefinition[];
  exchangeRates: ExchangeRates;
  isPortfolioHeld: boolean;
}

const formatKRW = (num: number) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(num);
const formatOriginalCurrency = (num: number, currency: Currency) => `${CURRENCY_SYMBOLS[currency]}${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num)}`;
const getChangeColor = (value: number) => (value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-gray-400');

const WatchlistMobileCard: React.FC<WatchlistMobileCardProps> = ({
  item,
  isSelected,
  onToggleSelect,
  onDelete,
  onOpenEditModal,
  onTogglePin,
  onMemoEdit,
  categories,
  exchangeRates,
  isPortfolioHeld,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const menuAnchorRef = useRef<HTMLButtonElement>(null);

  const isNonKRW = item.currency !== undefined && item.currency !== Currency.KRW;
  const getExchangeRate = (): number => {
    if (!item.currency || item.currency === Currency.KRW) return 1;
    if (item.currency === Currency.USD) return exchangeRates.USD || 1;
    if (item.currency === Currency.JPY) return exchangeRates.JPY || 1;
    return 1;
  };

  return (
    <div className="border-b border-gray-700">
      <div className="px-4 py-3 flex items-start gap-3">
        {/* 체크박스 */}
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(item.id)}
          className="mt-2 flex-shrink-0"
        />

        {/* 종목 정보 */}
        <div className="flex-1 min-w-0" onClick={() => setExpanded(!expanded)}>
          <div className="flex items-center gap-2 flex-wrap">
            {onTogglePin && (
              <button
                onClick={(e) => { e.stopPropagation(); onTogglePin(item.id); }}
                className={`text-lg leading-none transition-colors flex-shrink-0 ${item.pinned ? 'text-yellow-400' : 'text-gray-600 hover:text-yellow-400/60'}`}
              >
                {item.pinned ? '★' : '☆'}
              </button>
            )}
            {isPortfolioHeld && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-400 flex-shrink-0">보유</span>
            )}
            <MemoTooltip memo={item.notes}>
              <span className="font-bold text-primary-light text-sm truncate max-w-[160px]">
                {item.name}
              </span>
            </MemoTooltip>
            <span
              className={`text-lg leading-none cursor-pointer transition-opacity flex-shrink-0 ${
                item.notes ? 'opacity-60 hover:opacity-100' : 'opacity-20 hover:opacity-50'
              }`}
              onClick={(e) => { e.stopPropagation(); onMemoEdit?.(item); }}
            >📝</span>
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            {item.ticker} | {item.exchange} | {getCategoryName(item.categoryId, categories)}
          </div>

          {/* 가격 행 */}
          <div className="flex items-baseline gap-3 mt-2">
            <span className="text-white font-semibold text-sm">
              {item.currentPrice !== undefined ? formatKRW(item.currentPrice) : '-'}
            </span>
            {isNonKRW && item.priceOriginal !== undefined && item.currency !== undefined && (
              <span className="text-xs text-gray-500">
                {formatOriginalCurrency(item.priceOriginal, item.currency)}
              </span>
            )}
          </div>

          {/* 보조 정보 행 */}
          <div className="flex items-center gap-4 mt-1 text-[11px] text-gray-400">
            <span className={getChangeColor(item.yesterdayChange)}>
              전일 {item.yesterdayChange >= 0 ? '+' : ''}{item.yesterdayChange.toFixed(2)}%
            </span>
            {item.dropFromHigh != null && (
              <span className={getChangeColor(item.dropFromHigh)}>
                고가대비 {item.dropFromHigh.toFixed(1)}%
              </span>
            )}
          </div>
        </div>

        {/* 메뉴 버튼 */}
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
              { label: '수정', onClick: () => onOpenEditModal(item) },
              { label: '차트 보기', onClick: () => setExpanded(!expanded), colorClass: 'text-gray-200' },
              { label: '삭제', onClick: () => {
                if (window.confirm(`'${item.name}' 종목을 삭제하시겠습니까?`)) onDelete(item.id);
              }, colorClass: 'text-red-400' },
            ]}
          />
        )}
      </div>

      {/* 차트 확장 */}
      {expanded && (
        <div className="pb-2">
          <AssetTrendChart
            history={[]}
            assetId={item.id}
            assetName={item.name}
            currentQuantity={1}
            currentPrice={item.priceOriginal || item.currentPrice || 0}
            currency={item.currency}
            exchangeRate={getExchangeRate()}
            ticker={item.ticker}
            exchange={item.exchange}
            categoryId={item.categoryId}
          />
        </div>
      )}
    </div>
  );
};

export default WatchlistMobileCard;
