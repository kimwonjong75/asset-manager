import React, { Fragment, useEffect, useRef, useState } from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { Asset, Currency, PortfolioSnapshot, ExchangeRates } from '../../types';
import { EnrichedAsset, ColumnConfig, ColumnKey } from '../../types/ui';
import AssetTrendChart from '../AssetTrendChart';
import ChartViewerModal from '../common/ChartViewerModal';
import StockReviewAccordion from '../stock-review/StockReviewAccordion';
import TradePlanSection from '../trade-plan/TradePlanSection';
import { LineChart, Star, StickyNote } from 'lucide-react';
import MemoTooltip from '../common/MemoTooltip';
import RowActionMenuButton from '../common/RowActionMenuButton';
import { COLUMN_DEFINITIONS } from './columnDefinitions';
import TurtlePositionInfo from './TurtlePositionInfo';
import { buildAssetRowMenuItems } from './rowMenuItems';
import type { TurtlePositionView } from '../../utils/turtlePositionView';
import { PIN_STAR, YUSEON_ACCOUNT_BADGE } from '../../constants/stateColorLadders';

interface PortfolioTableRowProps {
  asset: EnrichedAsset;
  history: PortfolioSnapshot[];
  selectedIds: Set<string>;
  onSelect: (id: string, checked: boolean) => void;
  /** 가시 컬럼 설정 (양끝 name/actions 제외, 순서대로 렌더링) */
  visibleColumns: ColumnConfig[];
  onEdit: (asset: Asset) => void;
  onSell?: (asset: Asset) => void;
  onBuy?: (asset: Asset) => void;
  exchangeRates?: ExchangeRates;
  onRefreshOne?: (id: string) => void | Promise<void>;
  onTogglePin?: (id: string) => void;
  onMemoEdit?: (asset: Asset) => void;
  /** 골든크로스 신호 (`golden-cross` 알림 룰의 MA 페어 기준 — 양수만 전달, 그 외 null) */
  gcCrossDays?: number | null;
  /** 데드크로스 신호 (`dead-cross` 알림 룰의 MA 페어 기준 — 음수만 전달, 그 외 null) */
  dcCrossDays?: number | null;
  /** <td>에 적용할 inline 너비 스타일 (종목명 'name' + 중간 ColumnKey). 컬럼 리사이즈와 연동 */
  getTdStyle?: (columnKey: ColumnKey | 'name') => React.CSSProperties | undefined;
  /** 터틀 오픈 포지션 표시 모델 (있으면 읽기 전용 스트립 행 추가, Phase 2b-5) */
  turtle?: TurtlePositionView;
}

/** 행 메뉴에서 펼침 영역의 어느 섹션으로 들어왔는지 (마운트 시 초기 상태 + 스크롤) */
type ExpandEntry = 'plan' | 'review' | null;

const PortfolioTableRow: React.FC<PortfolioTableRowProps> = ({
  asset,
  history,
  selectedIds,
  onSelect,
  visibleColumns,
  onEdit,
  onSell,
  onBuy,
  onRefreshOne,
  exchangeRates,
  onTogglePin,
  onMemoEdit,
  gcCrossDays,
  dcCrossDays,
  getTdStyle,
  turtle,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // 행 메뉴 '매매 계획'/'종목 검토' — 펼친 뒤 해당 섹션을 열린 상태로 (다시) 마운트. nonce 가 key 라 이미 펼쳐져 있어도 리마운트.
  const [entry, setEntry] = useState<ExpandEntry>(null);
  const [planNonce, setPlanNonce] = useState(0);
  const [reviewNonce, setReviewNonce] = useState(0);
  const rowRef = useRef<HTMLTableRowElement>(null);

  const { ui, actions } = usePortfolio();
  const isFocused = ui.focusedAssetId === asset.id;

  useEffect(() => {
    if (isFocused) {
      setExpanded(true);
      setTimeout(() => rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
      setTimeout(() => actions.setFocusedAssetId(null), 2500);
    }
  }, [isFocused]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const { currentValue, currentValueKRW } = asset.metrics;
  const isNonKRW = asset.currency !== Currency.KRW;
  const displayName = asset.customName?.trim() || asset.name;

  // [수정] 차트에 전달할 환율 계산
  // 1순위: exchangeRates prop 사용 (가장 정확)
  // 2순위: 현재가치 역산 (currentValueKRW / currentValue)
  // 3순위: 1 (KRW이거나 정보 없음)
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

  // 양끝 고정 컬럼(체크박스/종목명/액션) 3 + 가시 컬럼 수 = 차트 expand row colSpan
  const totalColSpan = 3 + visibleColumns.filter(c => c.visible).length;

  const menuItems = buildAssetRowMenuItems({
    onTradePlan: openTradePlan,
    onStockReview: openStockReview,
    onBuy: onBuy ? () => onBuy(asset) : undefined,
    onSell: onSell ? () => onSell(asset) : undefined,
    onRefresh: onRefreshOne ? () => { void onRefreshOne(asset.id); } : undefined,
    onEdit: () => onEdit(asset),
    onToggleChart: handleToggleExpand,
    chartExpanded: expanded,
    onFullscreen: () => setFullscreen(true),
  });

  return (
    <Fragment>
      <tr ref={rowRef} className={`border-b border-gray-700 transition-colors duration-200 hover:bg-gray-700/50 ${isFocused ? 'ring-2 ring-inset ring-blue-500 bg-blue-900/20' : ''}`}>
        <td className="px-4 py-4 text-center">
          <input
            type="checkbox"
            aria-label={`${displayName} 선택`}
            checked={selectedIds.has(asset.id)}
            onChange={(e) => onSelect(asset.id, e.target.checked)}
          />
        </td>
        <td className="px-4 py-4 font-medium text-white break-words overflow-hidden" style={getTdStyle?.('name')}>
          <div className="flex flex-col">
             <div className="flex items-center gap-2">
               {onTogglePin && (
                 <button
                   onClick={(e) => { e.stopPropagation(); onTogglePin(asset.id); }}
                   className={`transition-colors flex-shrink-0 ${asset.pinned ? PIN_STAR.pinned : PIN_STAR.unpinned}`}
                   title={asset.pinned ? '중요 해제' : '중요 표시'}
                   aria-label={asset.pinned ? '중요 해제' : '중요 표시'}
                   aria-pressed={!!asset.pinned}
                 >
                   <Star className="h-4 w-4" fill={asset.pinned ? 'currentColor' : 'none'} aria-hidden="true" />
                 </button>
               )}
               <MemoTooltip memo={asset.memo}>
                 <a
                   href={`https://www.google.com/search?q=${encodeURIComponent(asset.ticker + ' 주가')}`}
                   target="_blank"
                   rel="noopener noreferrer"
                   className="font-bold hover:underline text-primary-light cursor-pointer"
                 >
                   {displayName}
                 </a>
               </MemoTooltip>
               <button
                 type="button"
                 className={`text-gray-300 cursor-pointer transition-opacity flex-shrink-0 ${asset.memo ? 'opacity-60 hover:opacity-100' : 'opacity-20 hover:opacity-50'}`}
                 onClick={(e) => { e.stopPropagation(); onMemoEdit?.(asset); }}
                 title={asset.memo ? '메모 수정' : '메모 추가'}
                 aria-label={asset.memo ? '메모 수정' : '메모 추가'}
               >
                 <StickyNote className="h-4 w-4" aria-hidden="true" />
               </button>
             </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500 break-all">{asset.ticker} | {asset.exchange}</span>
              {asset.bucket === 'SATELLITE' && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 whitespace-nowrap" title="투더문(위성) 종목">투더문</span>
              )}
              {asset.owner === 'YUSEON' && (
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${YUSEON_ACCOUNT_BADGE} whitespace-nowrap`} title="유선(가족) 계정 자산 — 리밸런싱·터틀 대상에서 제외">유선</span>
              )}
            </div>
          </div>
        </td>
        {visibleColumns.filter(c => c.visible).map(c => {
          const def = COLUMN_DEFINITIONS[c.key];
          if (!def) return null;
          return (
            <Fragment key={c.key}>
              {def.renderCell({ asset, gcCrossDays, dcCrossDays, getTdStyle })}
            </Fragment>
          );
        })}
        <td className="px-4 py-4 text-center">
          <div className="flex items-center justify-center gap-1">
            <button
              type="button"
              onClick={handleToggleExpand}
              aria-expanded={expanded}
              aria-label={`${displayName} 차트 ${expanded ? '접기' : '펼치기'}`}
              title={expanded ? '차트 접기' : '차트 펼치기'}
              className="focus-ring inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-gray-300 hover:bg-gray-700 hover:text-white"
            >
              <LineChart className="h-4 w-4" aria-hidden="true" />
            </button>
            <RowActionMenuButton items={menuItems} label={`${displayName} 관리 메뉴`} header={displayName} />
          </div>
        </td>
      </tr>
      {turtle && (
        <tr className="bg-purple-900/10 border-b border-gray-700">
          <td colSpan={totalColSpan} className="px-4 py-1.5">
            <TurtlePositionInfo view={turtle} />
          </td>
        </tr>
      )}
      {expanded && (
        <tr className="bg-gray-900/50">
          <td colSpan={totalColSpan} className="p-0 sm:p-2">
            <AssetTrendChart
              history={history}
              assetId={asset.id}
              assetName={displayName}
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
              className="px-2 sm:px-0"
              initialEditing={entry === 'plan'}
            />
            <StockReviewAccordion
              key={`review-${reviewNonce}`}
              asset={asset}
              source="portfolio"
              displayName={displayName}
              className="px-2 sm:px-0"
              initialOpen={entry === 'review'}
            />
          </td>
        </tr>
      )}
      {fullscreen && (
        <ChartViewerModal
          history={history}
          assetId={asset.id}
          assetName={displayName}
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
    </Fragment>
  );
};

export default PortfolioTableRow;
