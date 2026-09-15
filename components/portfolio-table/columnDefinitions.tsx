import React from 'react';
import { Currency } from '../../types';
import { isBaseType } from '../../types/category';
import { ColumnKey, COLUMN_LABELS, EnrichedAsset, SortKey, SortDirection } from '../../types/ui';
import { formatQuantity, formatOriginalCurrency, formatKRW, formatProfitLoss, getChangeColor } from './utils';
import Tooltip from '../common/Tooltip';
import SortableTh from '../common/SortableTh';
import { COLUMN_DESCRIPTIONS } from '../../constants/columnDescriptions';
import CrossDaysBadge from '../common/CrossDaysBadge';
import { VOLUME_INTENSITY_TEXT } from '../../constants/stateColorLadders';

const RSIIndicator = ({ rsi, status }: { rsi?: number, status?: string }) => {
  if (typeof rsi !== 'number') return null;
  let colorClass = 'text-gray-400';
  if (status === 'OVERBOUGHT' || rsi >= 70) colorClass = 'text-up';
  else if (status === 'OVERSOLD' || rsi <= 30) colorClass = 'text-down';
  return (
    <div className="text-xs mt-0.5">
      <span className="text-gray-500">RSI:</span> <span className={colorClass}>{rsi.toFixed(1)}</span>
    </div>
  );
};

const VolumeIndicator = ({ ratio }: { ratio?: number }) => {
  if (typeof ratio !== 'number') return null;
  // 강도 식별 색(매수/매도·위험 판정 아님) — constants/stateColorLadders.VOLUME_INTENSITY_TEXT
  let colorClass: string = VOLUME_INTENSITY_TEXT.normal;
  let label = '';
  if (ratio >= 2.0) { colorClass = VOLUME_INTENSITY_TEXT.surge; label = '!!'; }
  else if (ratio >= 1.5) { colorClass = VOLUME_INTENSITY_TEXT.high; label = '!'; }
  else if (ratio < 0.5) { colorClass = VOLUME_INTENSITY_TEXT.low; label = '~'; }
  return (
    <div className="text-xs mt-0.5">
      <span className="text-gray-500">VOL:</span>{' '}
      <span className={colorClass}>{ratio.toFixed(1)}x{label && ` ${label}`}</span>
    </div>
  );
};

export type HeaderAlign = 'left' | 'right' | 'center';

export interface HeaderRenderContext {
  sortConfig: { key: SortKey; direction: SortDirection } | null;
  requestSort: (key: SortKey) => void;
  /** 수익률 헤더 4상태 정렬(수익률↓ → 수익률↑ → 평가손익↓ → 평가손익↑ → 해제) */
  toggleReturnSort: () => void;
  badgePairs: {
    gcEnabled: boolean; gcShort: number; gcLong: number;
    dcEnabled: boolean; dcShort: number; dcLong: number;
  };
  /** <th> 공통 클래스(sticky top-0·배경·z 포함) — SortableTh className 으로 전달 */
  thClasses: string;
  /** 수익률 헤더 라벨('수익률' | '평가손익') — 방향은 SortableTh 아이콘이 표시 */
  getReturnHeaderLabel: () => string;
  /** <th> 우측 가장자리에 렌더링하는 리사이즈 핸들. 컬럼별로 columnKey를 넘겨 사용 */
  ResizeHandle: React.FC<{ columnKey: ColumnKey }>;
  /** <th>에 적용할 inline 너비 스타일. table-layout:auto에서는 <col>만으로 강제되지 않으므로 <th>에 직접 적용 필수 */
  getThStyle: (columnKey: ColumnKey) => React.CSSProperties | undefined;
}

export interface CellRenderContext {
  asset: EnrichedAsset;
  gcCrossDays?: number | null;
  dcCrossDays?: number | null;
  /** <td>에 적용할 inline 너비 스타일. 미정의 시 자동 너비 */
  getTdStyle?: (columnKey: ColumnKey) => React.CSSProperties | undefined;
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

/** 표 정렬 상태(ascending/descending) → SortableTh 방향(asc/desc) */
export const toSortableDirection = (
  sortConfig: { key: SortKey; direction: SortDirection } | null,
): 'asc' | 'desc' | null => (sortConfig ? (sortConfig.direction === 'ascending' ? 'asc' : 'desc') : null);

/** 단일 정렬키 헤더 — th 에 onClick 없음(버튼이 정렬), 리사이즈 핸들은 th 직계 자식 */
const sortableHeader = (
  ctx: HeaderRenderContext,
  key: ColumnKey,
  label: string,
  align: HeaderAlign,
  tooltip: React.ReactNode,
) => {
  const { ResizeHandle } = ctx;
  return (
    <SortableTh
      label={<span>{label}</span>}
      sortKey={key}
      activeKey={ctx.sortConfig?.key ?? null}
      direction={toSortableDirection(ctx.sortConfig)}
      onSort={() => ctx.requestSort(key)}
      className={ctx.thClasses}
      align={align}
      tooltip={tooltip}
      style={ctx.getThStyle(key)}
    >
      <ResizeHandle columnKey={key} />
    </SortableTh>
  );
};

export const COLUMN_DEFINITIONS: Record<ColumnKey, ColumnDefinition> = {
  maCrossDays: {
    key: 'maCrossDays',
    align: 'center',
    renderHeader: (ctx) => sortableHeader(
      ctx, 'maCrossDays', 'GC/DC', 'center',
      `알림 규칙 기준: GC=MA${ctx.badgePairs.gcShort}/${ctx.badgePairs.gcLong}, DC=MA${ctx.badgePairs.dcShort}/${ctx.badgePairs.dcLong} (환경설정에서 변경)`,
    ),
    renderCell: ({ gcCrossDays, dcCrossDays, getTdStyle }) => (
      <td className="px-4 py-4 text-center overflow-hidden" style={getTdStyle?.('maCrossDays')}>
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
    renderHeader: (ctx) => sortableHeader(ctx, 'quantity', '보유수량', 'right', COLUMN_DESCRIPTIONS.quantity),
    renderCell: ({ asset, getTdStyle }) => (
      <td className="px-4 py-4 text-right overflow-hidden" style={getTdStyle?.('quantity')}>
        <Tooltip content={COLUMN_DESCRIPTIONS.quantity} position="top" wrap>
          <span>{formatQuantity(asset.quantity, isBaseType(asset.categoryId, 'CRYPTOCURRENCY'))}</span>
        </Tooltip>
      </td>
    ),
  },
  purchasePrice: {
    key: 'purchasePrice',
    align: 'right',
    renderHeader: (ctx) => sortableHeader(ctx, 'purchasePrice', '매수평균가', 'right', COLUMN_DESCRIPTIONS.purchasePrice),
    renderCell: ({ asset, getTdStyle }) => {
      const isNonKRW = asset.currency !== Currency.KRW;
      return (
        <td className="px-4 py-4 text-right overflow-hidden" style={getTdStyle?.('purchasePrice')}>
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
    renderHeader: (ctx) => sortableHeader(ctx, 'currentPrice', '현재가', 'right', COLUMN_DESCRIPTIONS.currentPrice),
    renderCell: ({ asset, getTdStyle }) => {
      const isNonKRW = asset.currency !== Currency.KRW;
      return (
        <td className="px-4 py-4 overflow-hidden" style={getTdStyle?.('currentPrice')}>
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
    // 한 헤더가 수익률/평가손익 2개 정렬키를 4상태로 돈다 → ariaSortKeys 로 둘 다 활성 판정
    renderHeader: ({ thClasses, toggleReturnSort, getReturnHeaderLabel, sortConfig, ResizeHandle, getThStyle }) => (
      <SortableTh
        label={<span>{getReturnHeaderLabel()}</span>}
        sortKey="returnPercentage"
        ariaSortKeys={['profitLossKRW']}
        activeKey={sortConfig?.key ?? null}
        direction={toSortableDirection(sortConfig)}
        onSort={toggleReturnSort}
        className={thClasses}
        align="right"
        title="누를 때마다 수익률↓ → 수익률↑ → 평가손익↓ → 평가손익↑ → 정렬 해제"
        tooltip={sortConfig?.key === 'profitLossKRW' ? COLUMN_DESCRIPTIONS.profitLossKRW : COLUMN_DESCRIPTIONS.returnPercentage}
        style={getThStyle('returnPercentage')}
      >
        <ResizeHandle columnKey="returnPercentage" />
      </SortableTh>
    ),
    renderCell: ({ asset, getTdStyle }) => {
      const { returnPercentage, profitLoss } = asset.metrics;
      return (
        <td className={`px-4 py-4 font-medium text-right overflow-hidden ${getChangeColor(returnPercentage)}`} style={getTdStyle?.('returnPercentage')}>
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
    renderHeader: (ctx) => sortableHeader(ctx, 'purchaseValue', '투자원금', 'right', COLUMN_DESCRIPTIONS.purchaseValue),
    renderCell: ({ asset, getTdStyle }) => {
      const isNonKRW = asset.currency !== Currency.KRW;
      const { purchaseValue, purchaseValueKRW, returnPercentage } = asset.metrics;
      const investmentColor = getChangeColor(returnPercentage);
      return (
        <td className="px-4 py-4 text-right overflow-hidden" style={getTdStyle?.('purchaseValue')}>
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
    renderHeader: (ctx) => sortableHeader(ctx, 'currentValue', '평가총액', 'right', COLUMN_DESCRIPTIONS.currentValue),
    renderCell: ({ asset, getTdStyle }) => {
      const isNonKRW = asset.currency !== Currency.KRW;
      const { currentValue, currentValueKRW } = asset.metrics;
      return (
        <td className="px-4 py-4 text-right overflow-hidden" style={getTdStyle?.('currentValue')}>
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
    renderHeader: (ctx) => sortableHeader(ctx, 'purchaseDate', '매수일', 'center', COLUMN_DESCRIPTIONS.purchaseDate),
    renderCell: ({ asset, getTdStyle }) => (
      <td className="px-4 py-4 text-center overflow-hidden" style={getTdStyle?.('purchaseDate')}>
        <Tooltip content={COLUMN_DESCRIPTIONS.purchaseDate} position="top" wrap>
          <span>{asset.purchaseDate}</span>
        </Tooltip>
      </td>
    ),
  },
  allocation: {
    key: 'allocation',
    align: 'right',
    renderHeader: (ctx) => sortableHeader(ctx, 'allocation', '비중', 'right', COLUMN_DESCRIPTIONS.allocation),
    renderCell: ({ asset, getTdStyle }) => (
      <td className="px-4 py-4 text-right overflow-hidden" style={getTdStyle?.('allocation')}>
        <Tooltip content={COLUMN_DESCRIPTIONS.allocation} position="top" wrap>
          <span>{asset.metrics.allocation.toFixed(2)}%</span>
        </Tooltip>
      </td>
    ),
  },
  dropFromHigh: {
    key: 'dropFromHigh',
    align: 'right',
    renderHeader: (ctx) => sortableHeader(ctx, 'dropFromHigh', '최고가 대비', 'right', COLUMN_DESCRIPTIONS.dropFromHigh),
    renderCell: ({ asset, getTdStyle }) => {
      const { dropFromHigh, diffFromHigh } = asset.metrics;
      return (
        <td className={`px-4 py-4 font-medium text-right overflow-hidden ${getChangeColor(dropFromHigh)}`} style={getTdStyle?.('dropFromHigh')}>
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
    renderHeader: (ctx) => sortableHeader(ctx, 'yesterdayChange', '어제대비', 'right', COLUMN_DESCRIPTIONS.yesterdayChange),
    renderCell: ({ asset, getTdStyle }) => {
      const { yesterdayChange, diffFromYesterday } = asset.metrics;
      return (
        <td className={`px-4 py-4 font-medium text-right overflow-hidden ${getChangeColor(yesterdayChange)}`} style={getTdStyle?.('yesterdayChange')}>
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
