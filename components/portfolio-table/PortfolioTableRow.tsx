import React, { Fragment, useRef, useState } from 'react';
import { Asset, Currency, PortfolioSnapshot, ExchangeRates } from '../../types';
import { EnrichedAsset } from '../../types/ui';
import AssetTrendChart from '../AssetTrendChart';
import { MoreHorizontal } from 'lucide-react';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';
import { formatNumber, formatOriginalCurrency, formatKRW, formatProfitLoss, getChangeColor } from './utils';
import Tooltip from '../common/Tooltip';
import { COLUMN_DESCRIPTIONS } from '../../constants/columnDescriptions';

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
  asset: EnrichedAsset;
  history: PortfolioSnapshot[];
  selectedIds: Set<string>;
  onSelect: (id: string, checked: boolean) => void;
  showHiddenColumns: boolean;
  sellAlertDropRate: number;
  onEdit: (asset: Asset) => void;
  onSell?: (asset: Asset) => void;
  onBuy?: (asset: Asset) => void;
  filterAlerts: boolean;
  exchangeRates?: ExchangeRates; // [추가] 환율 정보
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
  onBuy,
  filterAlerts,
  exchangeRates
}) => {
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useOnClickOutside(menuRef, () => setOpenMenuId(null), !!openMenuId);

  const handleToggleExpand = (assetId: string) => {
    setExpandedAssetId(prevId => (prevId === assetId ? null : assetId));
  };

  const { purchaseValue, currentValue, purchaseValueKRW, currentValueKRW, returnPercentage, allocation, dropFromHigh, profitLoss, profitLossKRW, diffFromHigh, yesterdayChange, diffFromYesterday } = asset.metrics;
  
  const alertRate = asset.sellAlertDropRate ?? sellAlertDropRate;
  const isAlertTriggered = dropFromHigh <= -alertRate;
  const isNonKRW = asset.currency !== Currency.KRW;
  const investmentColor = getChangeColor(returnPercentage);

  // API changeRate 우선 사용
  const finalYesterdayChangeRate = asset.changeRate !== undefined 
    ? asset.changeRate * 100 
    : yesterdayChange;

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

  return (
    <Fragment>
      <tr className={`border-b border-gray-700 transition-colors duration-200 hover:bg-gray-700/50`}>
        <td className="px-4 py-4 text-center">
          <input type="checkbox" checked={selectedIds.has(asset.id)} onChange={(e) => onSelect(asset.id, e.target.checked)} />
        </td>
        <td className="px-4 py-4 font-medium text-white break-words">
          <div className="flex flex-col">
             <div className="flex items-center gap-2">
               <Tooltip content={asset.memo} position="right" wrap>
                 <a
                   href={`https://www.google.com/search?q=${encodeURIComponent(asset.ticker + ' 주가')}`}
                   target="_blank"
                   rel="noopener noreferrer"
                   className="font-bold hover:underline text-primary-light cursor-pointer"
                 >
                   {(asset.customName?.trim() || asset.name)}
                 </a>
               </Tooltip>
               <SignalBadge signal={asset.indicators?.signal} />
               {isAlertTriggered && (
                 <Tooltip content="알림 조건 도달" position="right">
                   <span className="text-xs">⚠️</span>
                 </Tooltip>
               )}
             </div>
            <span className="text-xs text-gray-500 break-all">{asset.ticker} | {asset.exchange}</span>
          </div>
        </td>
        {showHiddenColumns && (
          <td className="px-4 py-4 text-right">
            <Tooltip content={COLUMN_DESCRIPTIONS.quantity} position="top">
              <span>{formatNumber(asset.quantity)}</span>
            </Tooltip>
          </td>
        )}
        {showHiddenColumns && (
          <td className="px-4 py-4 text-right">
            <Tooltip content={COLUMN_DESCRIPTIONS.purchasePrice} position="top">
              <div>
                <div>{formatOriginalCurrency(asset.purchasePrice, asset.currency)}</div>
                {isNonKRW && <div className="text-xs text-gray-500">≈ {formatKRW(asset.metrics.purchasePriceKRW)}</div>}
              </div>
            </Tooltip>
          </td>
        )}
        <td className="px-4 py-4 text-right">
          <Tooltip content={COLUMN_DESCRIPTIONS.currentPrice} position="top">
            <div>
              <div className="font-semibold text-white">{formatOriginalCurrency(asset.currentPrice, asset.currency)}</div>
              {isNonKRW && <div className="text-xs text-gray-500">≈ {formatKRW(asset.metrics.currentPriceKRW)}</div>}
              <RSIIndicator rsi={asset.indicators?.rsi} status={asset.indicators?.rsi_status} />
            </div>
          </Tooltip>
        </td>
        <td className={`px-4 py-4 font-medium text-right ${getChangeColor(returnPercentage)}`}>
          <Tooltip content={COLUMN_DESCRIPTIONS.returnPercentage} position="top">
            <div>
              <div>{returnPercentage.toFixed(2)}%</div>
              <div className="text-xs opacity-80">{formatProfitLoss(profitLoss, asset.currency)}</div>
            </div>
          </Tooltip>
        </td>
        <td className="px-4 py-4 text-right">
          <Tooltip content={COLUMN_DESCRIPTIONS.purchaseValue} position="top">
            <div>
              <div className={investmentColor}>{formatOriginalCurrency(purchaseValue, asset.currency)}</div>
              {isNonKRW && <div className="text-xs text-gray-500">≈ {formatKRW(purchaseValueKRW)}</div>}
            </div>
          </Tooltip>
        </td>
        <td className="px-4 py-4 text-right">
          <Tooltip content={COLUMN_DESCRIPTIONS.currentValue} position="top">
            <div>
              <div className="font-semibold text-white">{formatOriginalCurrency(currentValue, asset.currency)}</div>
              {isNonKRW && <div className="text-xs text-gray-500">≈ {formatKRW(currentValueKRW)}</div>}
            </div>
          </Tooltip>
        </td>
        {showHiddenColumns && (
          <td className="px-4 py-4 text-center">
            <Tooltip content={COLUMN_DESCRIPTIONS.purchaseDate} position="top">
              <span>{asset.purchaseDate}</span>
            </Tooltip>
          </td>
        )}
        {showHiddenColumns && (
          <td className="px-4 py-4 text-right">
            <Tooltip content={COLUMN_DESCRIPTIONS.allocation} position="top">
              <span>{allocation.toFixed(2)}%</span>
            </Tooltip>
          </td>
        )}
        <td className={`px-4 py-4 font-medium text-right ${getChangeColor(dropFromHigh)}`}>
          <Tooltip content={COLUMN_DESCRIPTIONS.dropFromHigh} position="top">
            <div>
              <div>{dropFromHigh.toFixed(2)}%</div>
              <div className="text-xs opacity-80">{formatProfitLoss(diffFromHigh, asset.currency)}</div>
            </div>
          </Tooltip>
        </td>
        <td className={`px-4 py-4 font-medium text-right ${getChangeColor(finalYesterdayChangeRate)}`}>
          <Tooltip content={COLUMN_DESCRIPTIONS.yesterdayChange} position="top">
            <div>
              <div>{finalYesterdayChangeRate.toFixed(2)}%</div>
              <div className="text-xs opacity-80">{formatProfitLoss(diffFromYesterday, Currency.KRW)}</div>
            </div>
          </Tooltip>
        </td>
        <td className="px-4 py-4 text-center relative">
          <div className="flex items-center justify-center gap-1">
            <Tooltip content="차트" position="left">
              <button onClick={() => handleToggleExpand(asset.id)} className="p-2 text-gray-300 hover:text-white">
                  <ChartBarIcon />
              </button>
            </Tooltip>
            <button onClick={() => setOpenMenuId(openMenuId === asset.id ? null : asset.id)} className="p-2 text-gray-300 hover:text-white">
                <MoreHorizontal className="h-5 w-5" />
            </button>
          </div>
          {openMenuId === asset.id && (
            <div ref={menuRef} className="absolute right-0 mt-2 w-44 bg-gray-800 border border-gray-700 rounded-md shadow-lg z-30 text-sm">
               <button onClick={() => { setOpenMenuId(null); onEdit(asset); }} className="block w-full text-left px-3 py-2 hover:bg-gray-700 text-white">수정</button>
               {onBuy && <button onClick={() => { setOpenMenuId(null); onBuy(asset); }} className="block w-full text-left px-3 py-2 text-green-400 hover:bg-gray-700">매수</button>}
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
              currentQuantity={asset.quantity}
              currentPrice={asset.currentPrice}
              currency={asset.currency}
              exchangeRate={derivedExchangeRate}
              ticker={asset.ticker}
              exchange={asset.exchange}
              category={asset.category}
            />
          </td>
        </tr>
      )}
    </Fragment>
  );
};

export default PortfolioTableRow;