import { directionTextClass } from '../../utils/directionTone';
import React, { useRef, useState } from 'react';
import { Currency, CURRENCY_SYMBOLS, ExchangeRates, WatchlistItem } from '../../types';
import { getCategoryName, type CategoryDefinition } from '../../types/category';
import ActionMenu from '../common/ActionMenu';
import MemoTooltip from '../common/MemoTooltip';
import { ClipboardList, MoreHorizontal, Star, StickyNote } from 'lucide-react';
import ConfirmDialog from '../common/ConfirmDialog';
import { useConfirm } from '../../hooks/useConfirm';
import AssetTrendChart from '../AssetTrendChart';
import ChartViewerModal from '../common/ChartViewerModal';
import StockReviewAccordion from '../stock-review/StockReviewAccordion';
import TradePlanSection from '../trade-plan/TradePlanSection';
import { watchlistToPseudoAsset } from '../../utils/alertChecker';
import { usePortfolio } from '../../contexts/PortfolioContext';

interface WatchlistMobileCardProps {
  item: WatchlistItem & { dropFromHigh: number | null; yesterdayChange: number };
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenEditModal: (item: WatchlistItem) => void;
  onTogglePin?: (id: string) => void;
  onToggleTurtle?: (id: string) => void;
  onMemoEdit?: (item: WatchlistItem) => void;
  categories: CategoryDefinition[];
  exchangeRates: ExchangeRates;
  isPortfolioHeld: boolean;
}

const formatKRW = (num: number) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(num);
const formatOriginalCurrency = (num: number, currency: Currency) => `${CURRENCY_SYMBOLS[currency]}${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num)}`;
const getChangeColor = directionTextClass;

const WatchlistMobileCard: React.FC<WatchlistMobileCardProps> = ({
  item,
  isSelected,
  onToggleSelect,
  onDelete,
  onOpenEditModal,
  onTogglePin,
  onToggleTurtle,
  onMemoEdit,
  categories,
  exchangeRates,
  isPortfolioHeld,
}) => {
  const { actions } = usePortfolio();
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const menuAnchorRef = useRef<HTMLButtonElement>(null);
  const { confirm, confirmRequest } = useConfirm();

  const isNonKRW = item.currency !== undefined && item.currency !== Currency.KRW;
  const getExchangeRate = (): number => {
    if (!item.currency || item.currency === Currency.KRW) return 1;
    if (item.currency === Currency.USD) return exchangeRates.USD || 1;
    if (item.currency === Currency.JPY) return exchangeRates.JPY || 1;
    return 1;
  };

  return (
    <div className="border-b border-gray-700">
      {confirmRequest && <ConfirmDialog {...confirmRequest} />}
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
                className={`transition-colors flex-shrink-0 ${item.pinned ? 'text-yellow-400' : 'text-gray-500 hover:text-yellow-400/60'}`}
                aria-label={item.pinned ? '중요 해제' : '중요 표시'}
                aria-pressed={!!item.pinned}
              >
                <Star className="h-5 w-5" fill={item.pinned ? 'currentColor' : 'none'} aria-hidden="true" />
              </button>
            )}
            {isPortfolioHeld && (
              <span className="text-xs px-1 py-0.5 rounded bg-sky-500/20 text-sky-300 flex-shrink-0">보유</span>
            )}
            {item.isTurtleCandidate && (
              <span className="text-xs px-1 py-0.5 rounded bg-ok-soft text-ok flex-shrink-0" role="img" aria-label="터틀 후보" title="터틀 후보">🐢</span>
            )}
            <MemoTooltip memo={item.notes}>
              <span className="font-bold text-primary-light text-sm truncate max-w-[160px]">
                {item.name}
              </span>
            </MemoTooltip>
            <button
              type="button"
              className={`text-gray-300 cursor-pointer transition-opacity flex-shrink-0 ${
                item.notes ? 'opacity-60 hover:opacity-100' : 'opacity-20 hover:opacity-50'
              }`}
              onClick={(e) => { e.stopPropagation(); onMemoEdit?.(item); }}
              aria-label={item.notes ? '메모 수정' : '메모 추가'}
            >
              <StickyNote className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
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
          <div className="flex items-center gap-4 mt-1 text-xs text-gray-400">
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
              {
                label: '매매 계획',
                icon: <ClipboardList />,
                onClick: () => actions.openTradePlanPlanner({ watchItemId: item.id, ticker: item.ticker, exchange: item.exchange, name: item.name }),
                colorClass: 'text-gray-200',
              },
              ...(onToggleTurtle ? [{ label: item.isTurtleCandidate ? '🐢 터틀 후보 해제' : '🐢 터틀 후보 지정', onClick: () => onToggleTurtle(item.id), colorClass: 'text-gray-200' }] : []),
              { label: '차트 보기', onClick: () => setExpanded(!expanded), colorClass: 'text-gray-200' },
              { label: '차트 확대', onClick: () => setFullscreen(true), colorClass: 'text-gray-200' },
              { label: '삭제', onClick: () => {
                void confirm(`'${item.name}' 종목을 삭제하시겠습니까?`, { title: '관심종목 삭제', confirmLabel: '삭제', tone: 'danger' })
                  .then(ok => { if (ok) onDelete(item.id); });
              }, colorClass: 'text-danger' },
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
            onExpand={() => setFullscreen(true)}
          />
          <TradePlanSection
            source="watchlist"
            watchItem={item}
            displayName={item.name}
            className="px-4"
          />
          <StockReviewAccordion
            asset={watchlistToPseudoAsset(item)}
            source="watchlist"
            displayName={item.name}
            className="px-4"
          />
        </div>
      )}

      {fullscreen && (
        <ChartViewerModal
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
          onClose={() => setFullscreen(false)}
        />
      )}
    </div>
  );
};

export default WatchlistMobileCard;
