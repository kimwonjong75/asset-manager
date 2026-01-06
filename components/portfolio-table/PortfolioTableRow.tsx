import React, { Fragment, useRef, useState } from 'react';
import { Asset, Currency, PortfolioSnapshot } from '../../types';
import { EnrichedAsset } from '../../types/ui';
import AssetTrendChart from '../AssetTrendChart';
import { MoreHorizontal } from 'lucide-react';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';
import { formatNumber, formatOriginalCurrency, formatKRW, formatProfitLoss, getChangeColor } from './utils';

// ----------------------------------------------------------------------
// [추가된 컴포넌트] 퀀트 신호 배지
// ----------------------------------------------------------------------
const SignalBadge = ({ signal }: { signal?: string }) => {
  if (!signal || signal === 'NEUTRAL') return null;

  let bgClass = 'bg-gray-500';
  let text = signal;

  if (signal === 'STRONG_BUY') {
    bgClass = 'bg-red-600 text-white animate-pulse';
    text = '강력매수';
  } else if (signal === 'BUY') {
    bgClass = 'bg-red-500 text-white';
    text = '매수';
  } else if (signal === 'SELL') {
    bgClass = 'bg-blue-500 text-white';
    text = '매도';
  } else if (signal === 'STRONG_SELL') {
    bgClass = 'bg-blue-600 text-white';
    text = '강력매도';
  }

  return (
    <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded font-bold ${bgClass} whitespace-nowrap`}>
      {text}
    </span>
  );
};

// ----------------------------------------------------------------------
// [추가된 컴포넌트] RSI 지표
// ----------------------------------------------------------------------
const RSIIndicator = ({ rsi, status }: { rsi?: number, status?: string }) => {
  if (typeof rsi !== 'number') return null;
  
  let colorClass = 'text-gray-400';
  if (status === 'OVERBOUGHT' || rsi >= 70) colorClass = 'text-red-400'; // 과매수
  else if (status === 'OVERSOLD' || rsi <= 30) colorClass = 'text-blue-400'; // 과매도

  return (
    <div className="text-[10px] mt-0.5">
      <span className="text-gray-500">RSI:</span> <span className={colorClass}>{rsi.toFixed(1)}</span>
    </div>
  );
};

// ----------------------------------------------------------------------
// Main Component
// ----------------------------------------------------------------------

interface PortfolioTableRowProps {
  asset: EnrichedAsset; // 원본 타입(EnrichedAsset) 유지
  history: PortfolioSnapshot[];
  selectedIds: Set<string>;
  onSelect: (id: string, checked: boolean) => void;
  showHiddenColumns: boolean;
  sellAlertDropRate: number;
  onEdit: (asset: Asset) => void;
  onSell?: (asset: Asset) => void;
  filterAlerts: boolean;
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
  showHiddenColumns,
  sellAlertDropRate,
  onEdit,
  onSell,
  filterAlerts
}) => {
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useOnClickOutside(menuRef, () => setOpenMenuId(null), !!openMenuId);

  const handleToggleExpand = (assetId: string) => {
    setExpandedAssetId(prevId => (prevId === assetId ? null : assetId));
  };

  // 원본 구조(asset.metrics) 사용
  const { purchaseValue, currentValue, purchaseValueKRW, currentValueKRW, returnPercentage, allocation, dropFromHigh, profitLoss, profitLossKRW, diffFromHigh, yesterdayChange, diffFromYesterday } = asset.metrics;
  
  const alertRate = asset.sellAlertDropRate ?? sellAlertDropRate;
  const isAlertTriggered = dropFromHigh <= -alertRate;
  const isNonKRW = asset.currency !== Currency.KRW;
  const investmentColor = getChangeColor(returnPercentage);

  // [수정] 서버에서 받아온 changeRate가 있다면 그것을 우선 사용 (API는 Ratio로 주므로 * 100, 기존 yesterdayChange는 %단위)
  const finalYesterdayChangeRate = asset.changeRate !== undefined 
    ? asset.changeRate * 100 
    : yesterdayChange;

  return (
    <Fragment>
      <tr className={`border-b border-gray-700 transition-colors duration-200 hover:bg-gray-700/50`}>
        <td className="px-4 py-4 text-center">
          <input type="checkbox" checked={selectedIds.has(asset.id)} onChange={(e) => onSelect(asset.id, e.target.checked)} />
        </td>
        <td className="px-4 py-4 font-medium text-white break-words">
          <div className="flex flex-col">
             <div className="flex items-center gap-2">
               <a 
                 href={`https://www.google.com/search?q=${encodeURIComponent(asset.ticker + ' 주가')}`}
                 target="_blank" 
                 rel="noopener noreferrer"
                 className="font-bold hover:underline text-primary-light cursor-pointer"
               >
                 {(asset.customName?.trim() || asset.name)}
               </a>
               {/* [추가] 퀀트 신호 배지 */}
               <SignalBadge signal={asset.indicators?.signal} />
               {isAlertTriggered && <span className="text-xs" title="알림 조건 도달">⚠️</span>}
             </div>
            <span className="text-xs text-gray-500 break-all">{asset.ticker} | {asset.exchange}</span>
          </div>
        </td>
        {showHiddenColumns && <td className="px-4 py-4 text-right">{formatNumber(asset.quantity)}</td>}
        {showHiddenColumns && (
          <td className="px-4 py-4 text-right">
            <div>{formatOriginalCurrency(asset.purchasePrice, asset.currency)}</div>
            {isNonKRW && <div className="text-xs text-gray-500">≈ {formatKRW(asset.metrics.purchasePriceKRW)}</div>}
          </td>
        )}
        {/* 현재가 및 RSI */}
        <td className="px-4 py-4 text-right">
          <div className="font-semibold text-white">{formatOriginalCurrency(asset.currentPrice, asset.currency)}</div>
          {isNonKRW && <div className="text-xs text-gray-500">≈ {formatKRW(asset.metrics.currentPriceKRW)}</div>}
          {/* [추가] RSI 표시 */}
          <RSIIndicator rsi={asset.indicators?.rsi} status={asset.indicators?.rsi_status} />
        </td>
        <td className={`px-4 py-4 font-medium text-right ${getChangeColor(returnPercentage)}`}>
          <div>{returnPercentage.toFixed(2)}%</div>
          <div className="text-xs opacity-80">{formatProfitLoss(profitLoss, asset.currency)}</div>
        </td>
        <td className="px-4 py-4 text-right">
          <div className={investmentColor}>{formatOriginalCurrency(purchaseValue, asset.currency)}</div>
          {isNonKRW && <div className="text-xs text-gray-500">≈ {formatKRW(purchaseValueKRW)}</div>}
        </td>
        <td className="px-4 py-4 text-right">
          <div className="font-semibold text-white">{formatOriginalCurrency(currentValue, asset.currency)}</div>
          {isNonKRW && <div className="text-xs text-gray-500">≈ {formatKRW(currentValueKRW)}</div>}
        </td>
        {showHiddenColumns && <td className="px-4 py-4 text-center">{asset.purchaseDate}</td>}
        {showHiddenColumns && <td className="px-4 py-4 text-right">{allocation.toFixed(2)}%</td>}
        <td className={`px-4 py-4 font-medium text-right ${getChangeColor(dropFromHigh)}`}>
            <div>{dropFromHigh.toFixed(2)}%</div>
            <div className="text-xs opacity-80">{formatProfitLoss(diffFromHigh, asset.currency)}</div>
        </td>
        {/* 전일 대비 등락률 (API 값 우선 적용) */}
        <td className={`px-4 py-4 font-medium text-right ${getChangeColor(finalYesterdayChangeRate)}`}>
          <div>{finalYesterdayChangeRate.toFixed(2)}%</div>
          <div className="text-xs opacity-80">{formatProfitLoss(diffFromYesterday, Currency.KRW)}</div>
        </td>
        <td className="px-4 py-4 text-center relative">
          <div className="flex items-center justify-center gap-1">
            <button onClick={() => handleToggleExpand(asset.id)} className="p-2 text-gray-300 hover:text-white" title="차트">
                <ChartBarIcon />
            </button>
            <button onClick={() => setOpenMenuId(openMenuId === asset.id ? null : asset.id)} className="p-2 text-gray-300 hover:text-white">
                <MoreHorizontal className="h-5 w-5" />
            </button>
          </div>
          {openMenuId === asset.id && (
            <div ref={menuRef} className="absolute right-0 mt-2 w-44 bg-gray-800 border border-gray-700 rounded-md shadow-lg z-30 text-sm">
               <button onClick={() => { setOpenMenuId(null); onEdit(asset); }} className="block w-full text-left px-3 py-2 hover:bg-gray-700 text-white">수정</button>
               {onSell && <button onClick={() => { setOpenMenuId(null); onSell(asset); }} className="block w-full text-left px-3 py-2 text-red-400 hover:bg-gray-700">매도</button>}
               <button onClick={() => { setOpenMenuId(null); handleToggleExpand(asset.id); }} className="block w-full text-left px-3 py-2 text-gray-200 hover:bg-gray-700">차트 보기</button>
            </div>
          )}
        </td>
      </tr>
      {expandedAssetId === asset.id && (
        <tr className="bg-gray-900/50">
          <td colSpan={showHiddenColumns ? 13 : 9} className="p-0 sm:p-2">
            <AssetTrendChart
              history={history}
              assetId={asset.id}
              assetName={(asset.customName?.trim() || asset.name)}
              // @ts-ignore: AssetTrendChart가 currentQuantity를 prop으로 받도록 수정되었는지 확인 필요
              currentQuantity={asset.quantity} 
              currentPrice={asset.currentPrice}  
            />
          </td>
        </tr>
      )}
    </Fragment>
  );
};

export default PortfolioTableRow;