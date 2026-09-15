import { directionTextClass } from '../../utils/directionTone';
import React, { useState } from 'react';
import { Currency, CURRENCY_SYMBOLS, ExchangeRates, WatchlistItem } from '../../types';
import { getCategoryName, type CategoryDefinition } from '../../types/category';
import type { BuyReadiness } from '../../types/stockReview';
import MemoTooltip from '../common/MemoTooltip';
import { Star, StickyNote } from 'lucide-react';
import ConfirmDialog from '../common/ConfirmDialog';
import Badge from '../common/Badge';
import RowActionMenuButton from '../common/RowActionMenuButton';
import { clickableProps } from '../common/a11yKeys';
import { useConfirm } from '../../hooks/useConfirm';
import AssetTrendChart from '../AssetTrendChart';
import ChartViewerModal from '../common/ChartViewerModal';
import StockReviewAccordion from '../stock-review/StockReviewAccordion';
import TradePlanSection from '../trade-plan/TradePlanSection';
import BuyReadinessMarks from './BuyReadinessMarks';
import { buildWatchlistRowMenuItems } from './watchlistRowMenu';
import { watchlistToPseudoAsset } from '../../utils/alertChecker';
import { usePortfolio } from '../../contexts/PortfolioContext';

interface WatchlistMobileCardProps {
  item: WatchlistItem & { dropFromHigh: number | null; yesterdayChange: number; buyReadiness: BuyReadiness | null };
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
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // 메뉴 '종목 검토' 요청 번호 — 0 = 요청 없음. 바뀔 때마다 아코디언을 key 로 리마운트해 initialOpen 으로 연다.
  const [reviewNonce, setReviewNonce] = useState(0);
  const { confirm, confirmRequest } = useConfirm();

  const isNonKRW = item.currency !== undefined && item.currency !== Currency.KRW;
  const getExchangeRate = (): number => {
    if (!item.currency || item.currency === Currency.KRW) return 1;
    if (item.currency === Currency.USD) return exchangeRates.USD || 1;
    if (item.currency === Currency.JPY) return exchangeRates.JPY || 1;
    return 1;
  };

  const toggleExpanded = () => {
    if (expanded) setReviewNonce(0);
    setExpanded(!expanded);
  };

  const menuItems = buildWatchlistRowMenuItems({
    isTurtleCandidate: !!item.isTurtleCandidate,
    onTradePlan: () => actions.openTradePlanPlanner({ watchItemId: item.id, ticker: item.ticker, exchange: item.exchange, name: item.name }),
    onReview: () => {
      setExpanded(true);
      setReviewNonce(n => n + 1);
    },
    onEdit: () => onOpenEditModal(item),
    onToggleTurtle: onToggleTurtle ? () => onToggleTurtle(item.id) : undefined,
    onChartView: toggleExpanded,
    onChartExpand: () => setFullscreen(true),
    onDelete: () => {
      void confirm(`'${item.name}' 종목을 삭제하시겠습니까?`, { title: '관심종목 삭제', confirmLabel: '삭제', tone: 'danger' })
        .then(ok => { if (ok) onDelete(item.id); });
    },
  });

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
          aria-label={`${item.name} 선택`}
        />

        {/* 종목 정보 — 탭하면 차트·매매 계획·종목 검토 펼침 */}
        <div
          className="flex-1 min-w-0 focus-ring rounded-sm"
          {...clickableProps(toggleExpanded)}
          aria-expanded={expanded}
          aria-label={`${item.name} 상세 ${expanded ? '접기' : '펼치기'}`}
        >
          <div className="flex items-center gap-2 flex-wrap">
            {onTogglePin && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onTogglePin(item.id); }}
                className={`transition-colors flex-shrink-0 ${item.pinned ? 'text-yellow-400' : 'text-gray-500 hover:text-yellow-400/60'}`}
                aria-label={item.pinned ? '중요 해제' : '중요 표시'}
                aria-pressed={!!item.pinned}
              >
                <Star className="h-5 w-5" fill={item.pinned ? 'currentColor' : 'none'} aria-hidden="true" />
              </button>
            )}
            {isPortfolioHeld && (
              <Badge tone="info" className="flex-shrink-0" title="보유중">보유</Badge>
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

          {/* 매수 점검 — 데스크탑 '매수 점검' 컬럼과 동일 표시(설명 툴팁은 페이지 모바일 정렬 바) */}
          <div className="mt-1 text-xs">
            <BuyReadinessMarks readiness={item.buyReadiness} showLabel />
          </div>
        </div>

        {/* 관리 메뉴 — 데스크탑 행 메뉴와 같은 buildWatchlistRowMenuItems */}
        <RowActionMenuButton
          items={menuItems}
          label={`${item.name} 관리 메뉴`}
          header={item.name}
          className="flex-shrink-0 mt-1"
        />
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
            key={`review-${reviewNonce}`}
            asset={watchlistToPseudoAsset(item)}
            source="watchlist"
            displayName={item.name}
            className="px-4"
            initialOpen={reviewNonce > 0}
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
