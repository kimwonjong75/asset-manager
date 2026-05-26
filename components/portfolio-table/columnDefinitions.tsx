import React from 'react';
import { Currency } from '../../types';
import { isBaseType } from '../../types/category';
import { ColumnKey, COLUMN_LABELS, EnrichedAsset, SortKey, SortDirection } from '../../types/ui';
import { formatQuantity, formatOriginalCurrency, formatKRW, formatProfitLoss, getChangeColor } from './utils';
import Tooltip from '../common/Tooltip';
import { COLUMN_DESCRIPTIONS } from '../../constants/columnDescriptions';
import CrossDaysBadge from '../common/CrossDaysBadge';

const RSIIndicator = ({ rsi, status }: { rsi?: number, status?: string }) => {
  if (typeof rsi !== 'number') return null;
  let colorClass = 'text-gray-400';
  if (status === 'OVERBOUGHT' || rsi >= 70) colorClass = 'text-red-400';
  else if (status === 'OVERSOLD' || rsi <= 30) colorClass = 'text-blue-400';
  return (
    <div className="text-[10px] mt-0.5">
      <span className="text-gray-500">RSI:</span> <span className={colorClass}>{rsi.toFixed(1)}</span>
    </div>
  );
};

const VolumeIndicator = ({ ratio }: { ratio?: number }) => {
  if (typeof ratio !== 'number') return null;
  let colorClass = 'text-gray-400';
  let label = '';
  if (ratio >= 2.0) { colorClass = 'text-orange-400'; label = '!!'; }
  else if (ratio >= 1.5) { colorClass = 'text-yellow-400'; label = '!'; }
  else if (ratio < 0.5) { colorClass = 'text-gray-500'; label = '~'; }
  return (
    <div className="text-[10px] mt-0.5">
      <span className="text-gray-500">VOL:</span>{' '}
      <span className={colorClass}>{ratio.toFixed(1)}x{label && ` ${label}`}</span>
    </div>
  );
};

export type HeaderAlign = 'left' | 'right' | 'center';

export interface HeaderRenderContext {
  sortConfig: { key: SortKey; direction: SortDirection } | null;
  requestSort: (key: SortKey) => void;
  toggleReturnSort: () => void;
  badgePairs: {
    gcEnabled: boolean; gcShort: number; gcLong: number;
    dcEnabled: boolean; dcShort: number; dcLong: number;
  };
  thClasses: string;
  thContentClasses: string;
  SortIcon: React.FC<{ sortKey: SortKey }>;
  getReturnHeaderLabel: () => string;
}

export interface CellRenderContext {
  asset: EnrichedAsset;
  gcCrossDays?: number | null;
  dcCrossDays?: number | null;
}

export interface ColumnDefinition {
  key: ColumnKey;
  align: HeaderAlign;
  renderHeader: (ctx: HeaderRenderContext) => React.ReactNode;
  renderCell: (ctx: CellRenderContext) => React.ReactNode;
}

const alignToTd = (align: HeaderAlign) =>
  align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';

const alignToHeaderContent = (align: HeaderAlign) =>
  align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : '';

export const COLUMN_DEFINITIONS: Record<ColumnKey, ColumnDefinition> = {
  maCrossDays: {
    key: 'maCrossDays',
    align: 'center',
    renderHeader: ({ thClasses, thContentClasses, requestSort, SortIcon, badgePairs }) => (
      <th scope="col" className={`${thClasses} text-center`} onClick={() => requestSort('maCrossDays')}>
        <Tooltip content={`알림 규칙 기준: GC=MA${badgePairs.gcShort}/${badgePairs.gcLong}, DC=MA${badgePairs.dcShort}/${badgePairs.dcLong} (환경설정에서 변경)`} position="bottom" wrap>
          <div className={`${thContentClasses} justify-center`}><span>GC/DC</span> <SortIcon sortKey="maCrossDays" /></div>
        </Tooltip>
      </th>
    ),
    renderCell: ({ gcCrossDays, dcCrossDays }) => (
      <td className="px-4 py-4 text-center">
        <div className="inline-flex items-center gap-1">
          <CrossDaysBadge crossDays={gcCrossDays} />
          <CrossDaysBadge crossDays={dcCrossDays} />
        </div>
      </td>
    ),
  },
  quantity: {
    key: 'quantity',
    align: 'right',
    renderHeader: ({ thClasses, thContentClasses, requestSort, SortIcon }) => (
      <th scope="col" className={`${thClasses} text-right`} onClick={() => requestSort('quantity')}>
        <Tooltip content={COLUMN_DESCRIPTIONS.quantity} position="bottom" wrap>
          <div className={`${thContentClasses} justify-end`}><span>보유수량</span> <SortIcon sortKey="quantity" /></div>
        </Tooltip>
      </th>
    ),
    renderCell: ({ asset }) => (
      <td className="px-4 py-4 text-right">
        <Tooltip content={COLUMN_DESCRIPTIONS.quantity} position="top" wrap>
          <span>{formatQuantity(asset.quantity, isBaseType(asset.categoryId, 'CRYPTOCURRENCY'))}</span>
        </Tooltip>
      </td>
    ),
  },
  purchasePrice: {
    key: 'purchasePrice',
    align: 'right',
    renderHeader: ({ thClasses, thContentClasses, requestSort, SortIcon }) => (
      <th scope="col" className={`${thClasses} text-right`} onClick={() => requestSort('purchasePrice')}>
        <Tooltip content={COLUMN_DESCRIPTIONS.purchasePrice} position="bottom" wrap>
          <div className={`${thContentClasses} justify-end`}><span>매수평균가</span> <SortIcon sortKey="purchasePrice" /></div>
        </Tooltip>
      </th>
    ),
    renderCell: ({ asset }) => {
      const isNonKRW = asset.currency !== Currency.KRW;
      return (
        <td className="px-4 py-4 text-right">
          <Tooltip content={COLUMN_DESCRIPTIONS.purchasePrice} position="top" wrap>
            <div>
              <div>{formatOriginalCurrency(asset.purchasePrice, asset.currency)}</div>
              {isNonKRW && <div className="text-xs text-gray-500">≈ {formatKRW(asset.metrics.purchasePriceKRW)}</div>}
            </div>
          </Tooltip>
        </td>
      );
    },
  },
  currentPrice: {
    key: 'currentPrice',
    align: 'right',
    renderHeader: ({ thClasses, thContentClasses, requestSort, SortIcon }) => (
      <th scope="col" className={`${thClasses} text-right`} onClick={() => requestSort('currentPrice')}>
        <Tooltip content={COLUMN_DESCRIPTIONS.currentPrice} position="bottom" wrap>
          <div className={`${thContentClasses} justify-end`}><span>현재가</span> <SortIcon sortKey="currentPrice" /></div>
        </Tooltip>
      </th>
    ),
    renderCell: ({ asset }) => {
      const isNonKRW = asset.currency !== Currency.KRW;
      return (
        <td className="px-4 py-4">
          <Tooltip content={COLUMN_DESCRIPTIONS.currentPrice} position="top" wrap>
            <div className="flex items-start justify-between gap-3">
              <div className="text-right">
                <div className="font-semibold text-white">{formatOriginalCurrency(asset.currentPrice, asset.currency)}</div>
                {isNonKRW && <div className="text-xs text-gray-500">≈ {formatKRW(asset.metrics.currentPriceKRW)}</div>}
              </div>
              {(asset.indicators?.rsi != null || asset.indicators?.volume_ratio != null) && (
                <div className="text-right shrink-0">
                  <RSIIndicator rsi={asset.indicators?.rsi} status={asset.indicators?.rsi_status} />
                  <VolumeIndicator ratio={asset.indicators?.volume_ratio} />
                </div>
              )}
            </div>
          </Tooltip>
        </td>
      );
    },
  },
  returnPercentage: {
    key: 'returnPercentage',
    align: 'right',
    renderHeader: ({ thClasses, thContentClasses, toggleReturnSort, getReturnHeaderLabel, sortConfig }) => (
      <th scope="col" className={`${thClasses} justify-end`} onClick={toggleReturnSort}>
        <Tooltip content={sortConfig?.key === 'profitLossKRW' ? COLUMN_DESCRIPTIONS.profitLossKRW : COLUMN_DESCRIPTIONS.returnPercentage} position="bottom" wrap>
          <div className={`${thContentClasses} justify-end`}><span>{getReturnHeaderLabel()}</span></div>
        </Tooltip>
      </th>
    ),
    renderCell: ({ asset }) => {
      const { returnPercentage, profitLoss } = asset.metrics;
      return (
        <td className={`px-4 py-4 font-medium text-right ${getChangeColor(returnPercentage)}`}>
          <Tooltip content={COLUMN_DESCRIPTIONS.returnPercentage} position="top" wrap>
            <div>
              <div>{returnPercentage.toFixed(2)}%</div>
              <div className="text-xs opacity-80">{formatProfitLoss(profitLoss, asset.currency)}</div>
            </div>
          </Tooltip>
        </td>
      );
    },
  },
  purchaseValue: {
    key: 'purchaseValue',
    align: 'right',
    renderHeader: ({ thClasses, thContentClasses, requestSort, SortIcon }) => (
      <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('purchaseValue')}>
        <Tooltip content={COLUMN_DESCRIPTIONS.purchaseValue} position="bottom" wrap>
          <div className={`${thContentClasses} justify-end`}><span>투자원금</span> <SortIcon sortKey="purchaseValue" /></div>
        </Tooltip>
      </th>
    ),
    renderCell: ({ asset }) => {
      const isNonKRW = asset.currency !== Currency.KRW;
      const { purchaseValue, purchaseValueKRW, returnPercentage } = asset.metrics;
      const investmentColor = getChangeColor(returnPercentage);
      return (
        <td className="px-4 py-4 text-right">
          <Tooltip content={COLUMN_DESCRIPTIONS.purchaseValue} position="top" wrap>
            <div>
              <div className={investmentColor}>{formatOriginalCurrency(purchaseValue, asset.currency)}</div>
              {isNonKRW && <div className="text-xs text-gray-500">≈ {formatKRW(purchaseValueKRW)}</div>}
            </div>
          </Tooltip>
        </td>
      );
    },
  },
  currentValue: {
    key: 'currentValue',
    align: 'right',
    renderHeader: ({ thClasses, thContentClasses, requestSort, SortIcon }) => (
      <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('currentValue')}>
        <Tooltip content={COLUMN_DESCRIPTIONS.currentValue} position="bottom" wrap>
          <div className={`${thContentClasses} justify-end`}><span>평가총액</span> <SortIcon sortKey="currentValue" /></div>
        </Tooltip>
      </th>
    ),
    renderCell: ({ asset }) => {
      const isNonKRW = asset.currency !== Currency.KRW;
      const { currentValue, currentValueKRW } = asset.metrics;
      return (
        <td className="px-4 py-4 text-right">
          <Tooltip content={COLUMN_DESCRIPTIONS.currentValue} position="top" wrap>
            <div>
              <div className="font-semibold text-white">{formatOriginalCurrency(currentValue, asset.currency)}</div>
              {isNonKRW && <div className="text-xs text-gray-500">≈ {formatKRW(currentValueKRW)}</div>}
            </div>
          </Tooltip>
        </td>
      );
    },
  },
  purchaseDate: {
    key: 'purchaseDate',
    align: 'center',
    renderHeader: ({ thClasses, thContentClasses, requestSort, SortIcon }) => (
      <th scope="col" className={`${thClasses} text-center`} onClick={() => requestSort('purchaseDate')}>
        <Tooltip content={COLUMN_DESCRIPTIONS.purchaseDate} position="bottom" wrap>
          <div className={`${thContentClasses} justify-center`}><span>매수일</span> <SortIcon sortKey="purchaseDate" /></div>
        </Tooltip>
      </th>
    ),
    renderCell: ({ asset }) => (
      <td className="px-4 py-4 text-center">
        <Tooltip content={COLUMN_DESCRIPTIONS.purchaseDate} position="top" wrap>
          <span>{asset.purchaseDate}</span>
        </Tooltip>
      </td>
    ),
  },
  allocation: {
    key: 'allocation',
    align: 'right',
    renderHeader: ({ thClasses, thContentClasses, requestSort, SortIcon }) => (
      <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('allocation')}>
        <Tooltip content={COLUMN_DESCRIPTIONS.allocation} position="bottom" wrap>
          <div className={`${thContentClasses} justify-end`}><span>비중</span> <SortIcon sortKey="allocation" /></div>
        </Tooltip>
      </th>
    ),
    renderCell: ({ asset }) => (
      <td className="px-4 py-4 text-right">
        <Tooltip content={COLUMN_DESCRIPTIONS.allocation} position="top" wrap>
          <span>{asset.metrics.allocation.toFixed(2)}%</span>
        </Tooltip>
      </td>
    ),
  },
  dropFromHigh: {
    key: 'dropFromHigh',
    align: 'right',
    renderHeader: ({ thClasses, thContentClasses, requestSort, SortIcon }) => (
      <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('dropFromHigh')}>
        <Tooltip content={COLUMN_DESCRIPTIONS.dropFromHigh} position="bottom" wrap>
          <div className={`${thContentClasses} justify-end`}><span>최고가 대비</span> <SortIcon sortKey="dropFromHigh" /></div>
        </Tooltip>
      </th>
    ),
    renderCell: ({ asset }) => {
      const { dropFromHigh, diffFromHigh } = asset.metrics;
      return (
        <td className={`px-4 py-4 font-medium text-right ${getChangeColor(dropFromHigh)}`}>
          <Tooltip content={COLUMN_DESCRIPTIONS.dropFromHigh} position="top" wrap>
            <div>
              <div>{dropFromHigh.toFixed(2)}%</div>
              <div className="text-xs opacity-80">{formatProfitLoss(diffFromHigh, asset.currency)}</div>
            </div>
          </Tooltip>
        </td>
      );
    },
  },
  yesterdayChange: {
    key: 'yesterdayChange',
    align: 'right',
    renderHeader: ({ thClasses, thContentClasses, requestSort, SortIcon }) => (
      <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('yesterdayChange')}>
        <Tooltip content={COLUMN_DESCRIPTIONS.yesterdayChange} position="bottom" wrap>
          <div className={`${thContentClasses} justify-end`}><span>어제대비</span> <SortIcon sortKey="yesterdayChange" /></div>
        </Tooltip>
      </th>
    ),
    renderCell: ({ asset }) => {
      const { yesterdayChange, diffFromYesterday } = asset.metrics;
      return (
        <td className={`px-4 py-4 font-medium text-right ${getChangeColor(yesterdayChange)}`}>
          <Tooltip content={COLUMN_DESCRIPTIONS.yesterdayChange} position="top" wrap>
            <div>
              <div>{yesterdayChange.toFixed(2)}%</div>
              <div className="text-xs opacity-80">{formatProfitLoss(diffFromYesterday, Currency.KRW)}</div>
            </div>
          </Tooltip>
        </td>
      );
    },
  },
};

export { COLUMN_LABELS };
