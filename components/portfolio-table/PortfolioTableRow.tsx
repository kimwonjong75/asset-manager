import React from 'react';
import { Asset, Currency, CURRENCY_SYMBOLS } from '../../types';
import { PortfolioSnapshot, SellRecord } from '../../types';

interface PortfolioTableRowProps {
  asset: Asset & {
    currentValue: number;
    purchaseValue: number;
    returnPercentage: number;
    profitLossKRW: number;
    allocation: number;
    dropFromHigh: number;
    yesterdayChange: number; // 원화 기준 변동액
    yesterdayChangeRate: number; // 퍼센트
  };
  history: PortfolioSnapshot[];
  selectedIds: Set<string>;
  onSelect: (id: string, checked: boolean) => void;
  showHiddenColumns: boolean;
  sellAlertDropRate?: number;
  onEdit?: (asset: Asset) => void;
  onSell?: (asset: Asset) => void;
  filterAlerts?: boolean;
}

// 퀀트 신호 배지 컴포넌트
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
    <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded font-bold ${bgClass}`}>
      {text}
    </span>
  );
};

// RSI 상태 표시 컴포넌트
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

const PortfolioTableRow: React.FC<PortfolioTableRowProps> = ({
  asset,
  selectedIds,
  onSelect,
  showHiddenColumns,
  sellAlertDropRate = 5,
  onEdit,
  onSell
}) => {
  const isSelected = selectedIds.has(asset.id);
  const symbol = CURRENCY_SYMBOLS[asset.currency] || asset.currency;
  
  // 색상 유틸리티
  const getColor = (val: number) => {
    if (val > 0) return 'text-red-400';
    if (val < 0) return 'text-blue-400';
    return 'text-gray-400';
  };

  // 알림 조건 스타일
  const isDropAlert = asset.dropFromHigh <= -(asset.sellAlertDropRate || sellAlertDropRate);
  const rowBgClass = isSelected ? 'bg-gray-700' : (isDropAlert ? 'bg-red-900/10' : 'hover:bg-gray-750');

  // 숫자를 로케일 문자열로 변환 (소수점 처리)
  const fmt = (num: number, currency: Currency) => {
    return num.toLocaleString(undefined, {
        minimumFractionDigits: currency === Currency.KRW ? 0 : 2,
        maximumFractionDigits: currency === Currency.KRW ? 0 : 2
    });
  };

  return (
    <tr className={`border-b border-gray-700 transition-colors ${rowBgClass}`}>
      {/* 체크박스 */}
      <td className="px-4 py-3 text-center">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => onSelect(asset.id, e.target.checked)}
          className="rounded border-gray-600 text-primary focus:ring-primary bg-gray-700"
        />
      </td>

      {/* 종목명 & 신호 */}
      <td className="px-4 py-3">
        <div className="flex flex-col">
          <div className="flex items-center">
            <span className="font-bold text-white">{asset.name}</span>
            {/* 여기에 퀀트 신호 표시 */}
            <SignalBadge signal={asset.indicators?.signal} />
          </div>
          <div className="text-xs text-gray-500 flex gap-2">
            <span>{asset.ticker}</span>
            <span className="text-gray-600">|</span>
            <span>{asset.exchange}</span>
          </div>
        </div>
      </td>

      {/* 보유수량 (숨김 가능) */}
      {showHiddenColumns && (
        <td className="px-4 py-3 text-right font-mono text-gray-300">
          {asset.quantity.toLocaleString()}
        </td>
      )}

      {/* 매수평균가 (숨김 가능) */}
      {showHiddenColumns && (
        <td className="px-4 py-3 text-right font-mono text-gray-300">
          {symbol}{fmt(asset.purchasePrice, asset.currency)}
        </td>
      )}

      {/* 현재가 & RSI */}
      <td className="px-4 py-3 text-right font-mono">
        <div className="text-white font-medium">
            {symbol}{fmt(asset.currentPrice, asset.currency)}
        </div>
        {/* 여기에 RSI 표시 */}
        <RSIIndicator rsi={asset.indicators?.rsi} status={asset.indicators?.rsi_status} />
      </td>

      {/* 수익률 */}
      <td className={`px-4 py-3 text-right font-mono font-bold ${getColor(asset.returnPercentage)}`}>
        {asset.returnPercentage > 0 ? '+' : ''}{asset.returnPercentage.toFixed(2)}%
        <div className="text-xs font-normal opacity-75">
            {asset.profitLossKRW > 0 ? '+' : ''}{Math.round(asset.profitLossKRW).toLocaleString()}원
        </div>
      </td>

      {/* 투자원금 */}
      <td className="px-4 py-3 text-right font-mono text-gray-300">
        {Math.round(asset.purchaseValue).toLocaleString()}
      </td>

      {/* 평가총액 */}
      <td className="px-4 py-3 text-right font-mono text-white font-bold">
        {Math.round(asset.currentValue).toLocaleString()}
      </td>

      {/* 매수일 (숨김 가능) */}
      {showHiddenColumns && (
        <td className="px-4 py-3 text-center text-gray-400 text-xs">
          {asset.purchaseDate}
        </td>
      )}

      {/* 비중 (숨김 가능) */}
      {showHiddenColumns && (
        <td className="px-4 py-3 text-right text-gray-300 font-mono">
          {asset.allocation.toFixed(1)}%
        </td>
      )}

      {/* 최고가 대비 하락률 (MDD) */}
      <td className={`px-4 py-3 text-right font-mono ${isDropAlert ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
        {asset.dropFromHigh.toFixed(2)}%
      </td>

      {/* 전일 대비 등락 (Yesterday Change) */}
      <td className={`px-4 py-3 text-right font-mono ${getColor(asset.yesterdayChangeRate)}`}>
         {/* 서버에서 받은 changeRate 우선 사용, 없으면 계산된 값 */}
         {(asset.changeRate !== undefined ? asset.changeRate * 100 : asset.yesterdayChangeRate).toFixed(2)}%
      </td>

      {/* 관리 버튼 */}
      <td className="px-4 py-3 text-center">
        <div className="flex justify-center gap-2">
            {onEdit && (
                <button onClick={() => onEdit(asset)} className="text-gray-400 hover:text-white transition">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                </button>
            )}
            {onSell && (
                <button onClick={() => onSell(asset)} className="text-gray-400 hover:text-red-400 transition">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </button>
            )}
        </div>
      </td>
    </tr>
  );
};

export default PortfolioTableRow;