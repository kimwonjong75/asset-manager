import React, { Fragment, useEffect, useRef, useState } from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { Asset, Currency, PortfolioSnapshot, ExchangeRates } from '../../types';
import { EnrichedAsset, ColumnConfig, ColumnKey } from '../../types/ui';
import AssetTrendChart from '../AssetTrendChart';
import ChartViewerModal from '../common/ChartViewerModal';
import { MoreHorizontal } from 'lucide-react';
import MemoTooltip from '../common/MemoTooltip';
import Tooltip from '../common/Tooltip';
import ActionMenu from '../common/ActionMenu';
import { COLUMN_DEFINITIONS } from './columnDefinitions';
import TurtlePositionInfo from './TurtlePositionInfo';
import type { TurtlePositionView } from '../../utils/turtlePositionView';

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

const ChartBarIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

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
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchorRef = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLTableRowElement>(null);

  const { ui, actions } = usePortfolio();
  const isFocused = ui.focusedAssetId === asset.id;

  useEffect(() => {
    if (isFocused) {
      setExpandedAssetId(asset.id);
      setTimeout(() => rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
      setTimeout(() => actions.setFocusedAssetId(null), 2500);
    }
  }, [isFocused]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleExpand = (assetId: string) => {
    setExpandedAssetId(prevId => (prevId === assetId ? null : assetId));
  };

  const { currentValue, currentValueKRW } = asset.metrics;
  const isNonKRW = asset.currency !== Currency.KRW;

  // [수정] 차트에 전달할 환율 계산
  // 1순위: exchangeRates prop 사용 (가장 정확)
  // 2순위: 현재가치 역산 (currentValueKRW / currentValue)
  // 3순위: 1 (KRW이거나 정보 없음)
  let derivedExchangeRate = 1;
  if (isNonKRW) {
      if (exchangeRates && asset.currency in exchangeRates) {
          derivedExchangeRate = exchangeRates[asset.currency as keyof ExchangeRates];
      } else if (currentValue > 0) {
          derivedExchangeRate = currentValueKRW / currentValue;
      }
  }

  // 양끝 고정 컬럼(체크박스/종목명/액션) 3 + 가시 컬럼 수 = 차트 expand row colSpan
  const totalColSpan = 3 + visibleColumns.filter(c => c.visible).length;

  return (
    <Fragment>
      <tr ref={rowRef} className={`border-b border-gray-700 transition-colors duration-200 hover:bg-gray-700/50 ${isFocused ? 'ring-2 ring-inset ring-blue-500 bg-blue-900/20' : ''}`}>
        <td className="px-4 py-4 text-center">
          <input type="checkbox" checked={selectedIds.has(asset.id)} onChange={(e) => onSelect(asset.id, e.target.checked)} />
        </td>
        <td className="px-4 py-4 font-medium text-white break-words overflow-hidden" style={getTdStyle?.('name')}>
          <div className="flex flex-col">
             <div className="flex items-center gap-2">
               {onTogglePin && (
                 <button
                   onClick={(e) => { e.stopPropagation(); onTogglePin(asset.id); }}
                   className={`text-lg leading-none transition-colors flex-shrink-0 ${asset.pinned ? 'text-yellow-400' : 'text-gray-600 hover:text-yellow-400/60'}`}
                   title={asset.pinned ? '중요 해제' : '중요 표시'}
                 >
                   {asset.pinned ? '★' : '☆'}
                 </button>
               )}
               <MemoTooltip memo={asset.memo}>
                 <a
                   href={`https://www.google.com/search?q=${encodeURIComponent(asset.ticker + ' 주가')}`}
                   target="_blank"
                   rel="noopener noreferrer"
                   className="font-bold hover:underline text-primary-light cursor-pointer"
                 >
                   {(asset.customName?.trim() || asset.name)}
                 </a>
               </MemoTooltip>
               <span
                 className={`text-xs leading-none cursor-pointer transition-opacity flex-shrink-0 ${asset.memo ? 'opacity-60 hover:opacity-100' : 'opacity-20 hover:opacity-50'}`}
                 onClick={(e) => { e.stopPropagation(); onMemoEdit?.(asset); }}
                 title={asset.memo ? '메모 수정' : '메모 추가'}
               >📝</span>
             </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500 break-all">{asset.ticker} | {asset.exchange}</span>
              {asset.bucket === 'SATELLITE' && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 whitespace-nowrap" title="투더문(위성) 종목">투더문</span>
              )}
              {asset.owner === 'YUSEON' && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 whitespace-nowrap" title="유선(가족) 계정 자산 — 리밸런싱·터틀 대상에서 제외">유선</span>
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
            <Tooltip content="차트" position="left">
              <button onClick={() => handleToggleExpand(asset.id)} className="p-2 text-gray-300 hover:text-white">
                  <ChartBarIcon />
              </button>
            </Tooltip>
            <button ref={menuAnchorRef} onClick={() => setMenuOpen(!menuOpen)} className="p-2 text-gray-300 hover:text-white">
                <MoreHorizontal className="h-5 w-5" />
            </button>
          </div>
          {menuOpen && (
            <ActionMenu
              anchorRef={menuAnchorRef}
              onClose={() => setMenuOpen(false)}
              items={[
                ...(onRefreshOne ? [{ label: '가격 업데이트', onClick: () => onRefreshOne(asset.id), colorClass: 'text-blue-400' }] : []),
                { label: '수정', onClick: () => onEdit(asset) },
                ...(onBuy ? [{ label: '매수', onClick: () => onBuy(asset), colorClass: 'text-green-400' }] : []),
                ...(onSell ? [{ label: '매도', onClick: () => onSell(asset), colorClass: 'text-red-400' }] : []),
                { label: '차트 보기', onClick: () => handleToggleExpand(asset.id), colorClass: 'text-gray-200' },
                { label: '차트 확대', onClick: () => setFullscreen(true), colorClass: 'text-gray-200' },
              ]}
            />
          )}
        </td>
      </tr>
      {turtle && (
        <tr className="bg-purple-900/10 border-b border-gray-700">
          <td colSpan={totalColSpan} className="px-4 py-1.5">
            <TurtlePositionInfo view={turtle} />
          </td>
        </tr>
      )}
      {expandedAssetId === asset.id && (
        <tr className="bg-gray-900/50">
          <td colSpan={totalColSpan} className="p-0 sm:p-2">
            <AssetTrendChart
              history={history}
              assetId={asset.id}
              assetName={(asset.customName?.trim() || asset.name)}
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
          </td>
        </tr>
      )}
      {fullscreen && (
        <ChartViewerModal
          history={history}
          assetId={asset.id}
          assetName={(asset.customName?.trim() || asset.name)}
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