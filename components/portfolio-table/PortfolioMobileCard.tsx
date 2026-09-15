import React, { useState } from 'react';
import { Asset, Currency, PortfolioSnapshot, ExchangeRates } from '../../types';
import { EnrichedAsset } from '../../types/ui';
import StockReviewAccordion from '../stock-review/StockReviewAccordion';
import TradePlanSection from '../trade-plan/TradePlanSection';
import { formatOriginalCurrency, formatKRW, formatProfitLoss, getChangeColor } from './utils';
import RowActionMenuButton from '../common/RowActionMenuButton';
import { clickableProps } from '../common/a11yKeys';
import { buildAssetRowMenuItems } from './rowMenuItems';
import CrossDaysBadge from '../common/CrossDaysBadge';
import { Star, StickyNote } from 'lucide-react';
import AssetTrendChart from '../AssetTrendChart';
import ChartViewerModal from '../common/ChartViewerModal';
import TurtlePositionInfo from './TurtlePositionInfo';
import type { TurtlePositionView } from '../../utils/turtlePositionView';
import { PIN_STAR, YUSEON_ACCOUNT_BADGE } from '../../constants/stateColorLadders';


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
  /** 골든크로스 신호 (`golden-cross` 알림 룰의 MA 페어 기준 — 양수만, 그 외 null) */
  gcCrossDays?: number | null;
  /** 데드크로스 신호 (`dead-cross` 알림 룰의 MA 페어 기준 — 음수만, 그 외 null) */
  dcCrossDays?: number | null;
  /** 터틀 오픈 포지션 표시 모델 (있으면 읽기 전용 스트립, Phase 2b-5) */
  turtle?: TurtlePositionView;
  /** 선택 상태 (일괄 변경/선택 업데이트용) — onSelect와 함께 전달 시 체크박스 표시 */
  selected?: boolean;
  onSelect?: (id: string, checked: boolean) => void;
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
  gcCrossDays,
  dcCrossDays,
  turtle,
  selected,
  onSelect,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // 행 메뉴 '매매 계획'/'종목 검토' 진입 — PortfolioTableRow 와 동일 규약(nonce key 리마운트 + 초기 열림 + 스크롤)
  const [entry, setEntry] = useState<'plan' | 'review' | null>(null);
  const [planNonce, setPlanNonce] = useState(0);
  const [reviewNonce, setReviewNonce] = useState(0);
  const displayName = asset.customName?.trim() || asset.name;

  const handleToggleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (!next) setEntry(null);
  };
  const openTradePlan = () => {
    setExpanded(true);
    setEntry('plan');
    setPlanNonce(n => n + 1);
  };
  const openStockReview = () => {
    setExpanded(true);
    setEntry('review');
    setReviewNonce(n => n + 1);
  };

  const { returnPercentage, currentValue, currentValueKRW, profitLoss, dropFromHigh, yesterdayChange } = asset.metrics;
  const isNonKRW = asset.currency !== Currency.KRW;

  let derivedExchangeRate = 1;
  if (isNonKRW) {
    // 키 존재(`in`)가 아니라 **실제 숫자인지**로 판정한다. ExchangeRates 는 KRW/CNY 가
    // 선택 필드라 키가 있어도 값이 undefined 일 수 있고, 그때는 평가액에서 역산해야 한다.
    const rate = exchangeRates?.[asset.currency as keyof ExchangeRates];
    if (typeof rate === 'number') {
      derivedExchangeRate = rate;
    } else if (currentValue > 0) {
      derivedExchangeRate = currentValueKRW / currentValue;
    }
  }

  return (
    <div className="border-b border-gray-700">
      <div className="px-4 py-3 flex items-start gap-3">
        {/* Left: selection checkbox (일괄 변경/선택 업데이트) */}
        {onSelect && (
          <input
            type="checkbox"
            aria-label={`${displayName} 선택`}
            checked={!!selected}
            onChange={(e) => onSelect(asset.id, e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            className="mt-1.5 flex-shrink-0"
          />
        )}
        {/* Left: name + info */}
        <div
          className="flex-1 min-w-0 cursor-pointer rounded-md focus-ring"
          {...clickableProps(handleToggleExpand)}
          aria-expanded={expanded}
          aria-label={`${displayName} 차트 ${expanded ? '접기' : '펼치기'}`}
        >
          <div className="flex items-center gap-2 flex-wrap">
            {onTogglePin && (
              <button
                onClick={(e) => { e.stopPropagation(); onTogglePin(asset.id); }}
                className={`transition-colors flex-shrink-0 ${asset.pinned ? PIN_STAR.pinned : PIN_STAR.unpinned}`}
                aria-label={asset.pinned ? '중요 해제' : '중요 표시'}
                aria-pressed={!!asset.pinned}
              >
                <Star className="h-5 w-5" fill={asset.pinned ? 'currentColor' : 'none'} aria-hidden="true" />
              </button>
            )}
            <span className="font-bold text-primary-light text-sm truncate max-w-[160px]">
              {asset.customName?.trim() || asset.name}
            </span>
            <button
              type="button"
              className={`text-gray-300 cursor-pointer transition-opacity flex-shrink-0 ${asset.memo ? 'opacity-60 hover:opacity-100' : 'opacity-20 hover:opacity-50'}`}
              onClick={(e) => { e.stopPropagation(); onMemoEdit?.(asset); }}
              aria-label={asset.memo ? '메모 수정' : '메모 추가'}
            >
              <StickyNote className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-xs text-gray-500">{asset.ticker} | {asset.exchange}</span>
            {asset.bucket === 'SATELLITE' && (
              <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 whitespace-nowrap" title="투더문(위성) 종목">투더문</span>
            )}
            {asset.owner === 'YUSEON' && (
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${YUSEON_ACCOUNT_BADGE} whitespace-nowrap`} title="유선(가족) 계정 자산 — 리밸런싱·터틀 대상에서 제외">유선</span>
            )}
            <CrossDaysBadge crossDays={gcCrossDays} />
            <CrossDaysBadge crossDays={dcCrossDays} />
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
          <div className="flex items-center gap-4 mt-1 text-xs text-gray-400">
            <span>평가 {isNonKRW ? formatKRW(currentValueKRW) : formatOriginalCurrency(currentValue, asset.currency)}</span>
            <span className={getChangeColor(dropFromHigh)}>고가대비 {dropFromHigh.toFixed(1)}%</span>
            <span className={getChangeColor(yesterdayChange)}>전일 {yesterdayChange >= 0 ? '+' : ''}{yesterdayChange.toFixed(1)}%</span>
          </div>
        </div>

        {/* Right: menu button — PortfolioTableRow 와 같은 항목·순서(rowMenuItems) */}
        <RowActionMenuButton
          className="flex-shrink-0 mt-0.5"
          label={`${displayName} 관리 메뉴`}
          header={displayName}
          items={buildAssetRowMenuItems({
            onTradePlan: openTradePlan,
            onStockReview: openStockReview,
            onBuy: onBuy ? () => onBuy(asset) : undefined,
            onSell: onSell ? () => onSell(asset) : undefined,
            onRefresh: onRefreshOne ? () => { void onRefreshOne(asset.id); } : undefined,
            onEdit: () => onEdit(asset),
            onToggleChart: handleToggleExpand,
            chartExpanded: expanded,
            onFullscreen: () => setFullscreen(true),
          })}
        />
      </div>

      {/* 터틀 오픈 포지션 스트립 (읽기 전용) — 전폭, flex-wrap으로 모바일 넘침 방지 */}
      {turtle && (
        <div className="px-4 pb-2.5 -mt-1">
          <div className="bg-purple-900/10 border border-purple-500/20 rounded-md px-2.5 py-1.5">
            <TurtlePositionInfo view={turtle} />
          </div>
        </div>
      )}

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
            onExpand={() => setFullscreen(true)}
          />
          <TradePlanSection
            key={`plan-${planNonce}`}
            source="portfolio"
            asset={asset}
            displayName={displayName}
            className="px-4"
            initialEditing={entry === 'plan'}
          />
          <StockReviewAccordion
            key={`review-${reviewNonce}`}
            asset={asset}
            source="portfolio"
            displayName={displayName}
            className="px-4"
            initialOpen={entry === 'review'}
          />
        </div>
      )}

      {fullscreen && (
        <ChartViewerModal
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
          onClose={() => setFullscreen(false)}
        />
      )}
    </div>
  );
};

export default PortfolioMobileCard;
