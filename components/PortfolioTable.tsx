import React, { useMemo, useState, Fragment, useRef, useEffect } from 'react';
 
import { Asset, Currency, CURRENCY_SYMBOLS, AssetCategory, PortfolioSnapshot, ALLOWED_CATEGORIES, ExchangeRates } from '../types';
import AssetTrendChart from './AssetTrendChart';
import { MoreHorizontal } from 'lucide-react';
import { useOnClickOutside } from '../hooks/useOnClickOutside';

interface PortfolioTableProps {
  assets: Asset[];
  history: PortfolioSnapshot[];
  onRefreshAll: () => void;
  onRefreshSelected?: (ids: string[]) => void | Promise<void>;
  onRefreshOne?: (id: string) => void | Promise<void>;
  onEdit: (asset: Asset) => void;
  onSell?: (asset: Asset) => void;
  isLoading: boolean;
  sellAlertDropRate: number;
  filterCategory: AssetCategory | 'ALL';
  onFilterChange: (category: AssetCategory | 'ALL') => void;
  filterAlerts: boolean;
  onFilterAlertsChange: (isActive: boolean) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  onAddSelectedToWatchlist?: (assets: Asset[]) => void;
  failedIds?: Set<string>;
  exchangeRates: ExchangeRates;  // 추가: 환율 정보
}

type SortKey = 'name' | 'purchaseDate' | 'quantity' | 'purchasePrice' | 'currentPrice' | 'returnPercentage' | 'dropFromHigh' | 'yesterdayChange' | 'purchaseValue' | 'currentValue' | 'allocation';
type SortDirection = 'ascending' | 'descending';

// 원화 환산 헬퍼 함수
const getValueInKRW = (
  value: number, 
  currency: Currency, 
  exchangeRates: ExchangeRates
): number => {
  switch (currency) {
    case Currency.USD:
      return value * (exchangeRates.USD || 0);
    case Currency.JPY:
      return value * (exchangeRates.JPY || 0);
    case Currency.KRW:
    default:
      return value;
  }
};

const PortfolioTable: React.FC<PortfolioTableProps> = ({ 
  assets, 
  history, 
  onRefreshAll, 
  onRefreshSelected, 
  onRefreshOne, 
  onEdit, 
  onSell, 
  isLoading, 
  sellAlertDropRate, 
  filterCategory, 
  onFilterChange, 
  filterAlerts, 
  onFilterAlertsChange, 
  searchQuery = '', 
  onSearchChange, 
  onAddSelectedToWatchlist, 
  failedIds,
  exchangeRates  // 추가
}) => {
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection } | null>(null);
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);
  const [showHiddenColumns, setShowHiddenColumns] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showFailedOnly, setShowFailedOnly] = useState<boolean>(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const prevLoadingRef = useRef<boolean>(false);
  const [lastRunWasFullUpdate, setLastRunWasFullUpdate] = useState<boolean>(false);

  useOnClickOutside(menuRef, () => setOpenMenuId(null), !!openMenuId);

  // 총자산 (원화 환산)
  const totalValueKRW = useMemo(() => {
    return assets.reduce((sum, asset) => {
      const valueInOriginalCurrency = asset.currentPrice * asset.quantity;
      return sum + getValueInKRW(valueInOriginalCurrency, asset.currency, exchangeRates);
    }, 0);
  }, [assets, exchangeRates]);

  const handleToggleExpand = (assetId: string) => {
    setExpandedAssetId(prevId => (prevId === assetId ? null : assetId));
  };
  
  const categoryOptions = useMemo(() => {
    const extras = Array.from(new Set(assets.map(asset => asset.category))).filter(
      (cat) => !ALLOWED_CATEGORIES.includes(cat) && cat !== AssetCategory.FOREIGN_STOCK
    );
    return [...ALLOWED_CATEGORIES, ...extras];
  }, [assets]);

  // 수익률 계산 로직
  const enrichedAndSortedAssets = useMemo(() => {
    let enriched = assets.map(asset => {
      // 같은 통화 기준으로 계산
      const currentValue = asset.currentPrice * asset.quantity;
      const purchaseValue = asset.purchasePrice * asset.quantity;
      
      // 수익률: 같은 통화끼리 비교 (환율 영향 없음!)
      const profitLoss = currentValue - purchaseValue;
      const returnPercentage = purchaseValue === 0 ? 0 : (profitLoss / purchaseValue) * 100;
      
      // 원화 환산 (표시용)
      const currentValueKRW = getValueInKRW(currentValue, asset.currency, exchangeRates);
      const purchaseValueKRW = getValueInKRW(purchaseValue, asset.currency, exchangeRates);
      const profitLossKRW = currentValueKRW - purchaseValueKRW;
      
      // 포트폴리오 비중: 원화 환산 후 계산
      const allocation = totalValueKRW === 0 ? 0 : (currentValueKRW / totalValueKRW) * 100;
      
      // 최고가 대비: 같은 통화 기준
      const dropFromHigh = asset.highestPrice === 0 ? 0 
        : ((asset.currentPrice - asset.highestPrice) / asset.highestPrice) * 100;
      const diffFromHigh = asset.currentPrice - asset.highestPrice;
      
      // 전일 대비: 같은 통화 기준
      const yesterdayPrice = asset.yesterdayPrice || 0;
      const yesterdayChange = yesterdayPrice > 0 
        ? ((asset.currentPrice - yesterdayPrice) / yesterdayPrice) * 100 
        : 0;
      const diffFromYesterday = yesterdayPrice > 0 
        ? asset.currentPrice - yesterdayPrice 
        : 0;
      
      return {
        ...asset,
        metrics: {
          purchasePrice: asset.purchasePrice,
          currentPrice: asset.currentPrice,
          purchaseValue,          // 원래 통화 기준
          currentValue,           // 원래 통화 기준
          purchaseValueKRW,       // 원화 환산 (표시용)
          currentValueKRW,        // 원화 환산 (표시용)
          returnPercentage,
          allocation,
          dropFromHigh,
          profitLoss,             // 원래 통화 기준
          profitLossKRW,          // 원화 환산 (표시용)
          diffFromHigh,
          yesterdayChange,
          diffFromYesterday,
        }
      };
    });

    if (filterAlerts) {
      enriched = enriched.filter(asset => {
        const alertRate = asset.sellAlertDropRate ?? sellAlertDropRate;
        return asset.metrics.dropFromHigh <= -alertRate;
      });
    }

    if (showFailedOnly && failedIds && failedIds.size > 0) {
      enriched = enriched.filter(asset => failedIds.has(asset.id));
    }

    if (sortConfig !== null) {
      enriched.sort((a, b) => {
        const { key, direction } = sortConfig;
        let aValue: string | number;
        let bValue: string | number;

        if (key === 'name') {
          aValue = (a.customName?.toLowerCase() || a.name.toLowerCase());
          bValue = (b.customName?.toLowerCase() || b.name.toLowerCase());
        } else if (key === 'purchaseDate') {
          aValue = a.purchaseDate;
          bValue = b.purchaseDate;
        } else if (key === 'quantity') {
          aValue = a.quantity;
          bValue = b.quantity;
        } else {
          aValue = a.metrics[key as keyof typeof a.metrics] as number;
          bValue = b.metrics[key as keyof typeof b.metrics] as number;
        }

        if (aValue < bValue) return direction === 'ascending' ? -1 : 1;
        if (aValue > bValue) return direction === 'ascending' ? 1 : -1;
        return 0;
      });
    }

    return enriched;
  }, [assets, sortConfig, totalValueKRW, exchangeRates, filterAlerts, sellAlertDropRate, showFailedOnly, failedIds]);

  const allSelected = enrichedAndSortedAssets.length > 0 && enrichedAndSortedAssets.every(a => selectedIds.has(a.id));
  const selectedAssets = useMemo(() => assets.filter(a => selectedIds.has(a.id)), [assets, selectedIds]);

  const requestSort = (key: SortKey) => {
    let direction: SortDirection = 'ascending';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };
  
  const formatKRW = (num: number) => {
    return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(num);
  };

  // 통화별 금액 포맷
  const formatOriginalCurrency = (num: number, currency: Currency) => {
    if (currency === Currency.JPY) {
      return `${CURRENCY_SYMBOLS[currency]}${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 }).format(num)}`;
    }
    return `${CURRENCY_SYMBOLS[currency]}${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num)}`;
  };

  // 손익 포맷 (부호 포함)
  const formatProfitLoss = (num: number, currency: Currency) => {
    const sign = num >= 0 ? '+' : '';
    if (currency === Currency.KRW) {
      return `${sign}${formatKRW(num)}`;
    }
    return `${sign}${formatOriginalCurrency(num, currency)}`;
  };
  
  const getChangeColor = (value: number) => {
    if (value > 0) return 'text-success';
    if (value < 0) return 'text-danger';
    return 'text-gray-400';
  };
  
  const SortIcon = ({ sortKey }: { sortKey: SortKey }) => {
    if (!sortConfig || sortConfig.key !== sortKey) {
      return <span className="opacity-30">↕</span>;
    }
    return sortConfig.direction === 'descending' ? <span>▼</span> : <span>▲</span>;
  };
  
  const RefreshIcon: React.FC<{className?: string}> = ({className}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M4 4l1.5 1.5A9 9 0 0120.5 10M20 20l-1.5-1.5A9 9 0 003.5 14" />
    </svg>
  );

  const EditIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L16.732 3.732z" />
    </svg>
  );

  const ChartBarIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
  
  const SellIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v10m0 0l-4-4m4 4l4-4M4 20h16" />
    </svg>
  );
  
  const thClasses = "px-4 py-3 cursor-pointer hover:bg-gray-600 transition-colors";
  const thContentClasses = "flex items-center gap-2";

  useEffect(() => {
    if (!isLoading && prevLoadingRef.current && lastRunWasFullUpdate && failedIds && failedIds.size > 0) {
      const ok = window.confirm('업데이트에 실패한 항목이 있습니다. 실패한 리스트만 보시겠습니까?');
      if (ok) {
        setShowFailedOnly(true);
      }
    }
    prevLoadingRef.current = isLoading;
  }, [isLoading, lastRunWasFullUpdate, failedIds]);

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg">
      <div className="bg-gray-800 px-4 sm:px-6 pt-4 sm:pt-6 pb-4 flex justify-between items-center gap-4 border-b border-gray-700">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-white">포트폴리오 현황</h2>
          {onSearchChange && (
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="종목명, 티커, 메모 검색..."
                className="bg-gray-700 border border-gray-600 rounded-md py-2 pl-10 pr-10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent w-64"
              />
              <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {searchQuery && (
                <button
                  onClick={() => onSearchChange('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white transition"
                  title="검색어 지우기"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const ids = Array.from(selectedIds);
              if (ids.length > 0) {
                setLastRunWasFullUpdate(false);
                onRefreshSelected ? onRefreshSelected(ids) : onRefreshAll();
              } else {
                const ok = window.confirm('전체 종목을 업데이트 하시겠습니까?');
                if (ok) {
                  setLastRunWasFullUpdate(true);
                  onRefreshAll();
                }
              }
            }}
            disabled={isLoading}
            className="bg-primary hover:bg-primary-dark text-white font-medium py-2 px-4 rounded-md transition duration-300 flex items-center disabled:bg-gray-600 disabled:cursor-not-allowed"
            title="선택 항목이 있으면 선택만, 없으면 전체를 업데이트합니다."
          >
            {isLoading ? (
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
               <RefreshIcon className="-ml-1 mr-2 h-4 w-4"/>
            )}
            <span>{isLoading ? '업데이트 중...' : '업데이트'}</span>
          </button>
          <div className="flex items-center gap-2">
            <div className="relative">
              <select
                value={filterCategory}
                onChange={(e) => onFilterChange(e.target.value as AssetCategory | 'ALL')}
                className="appearance-none bg-gray-700 border border-gray-600 text-white text-sm rounded-md py-2 pl-3 pr-8 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="ALL">전체 자산</option>
                {categoryOptions.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <svg className="absolute right-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            <button
              onClick={() => onFilterAlertsChange(!filterAlerts)}
              className={`py-2 px-3 rounded-md text-sm font-medium transition ${filterAlerts ? 'bg-yellow-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              title="알림 기준 초과 자산만 표시"
            >
              ⚠️ 알림
            </button>
            {failedIds && failedIds.size > 0 && (
              <button
                onClick={() => setShowFailedOnly(!showFailedOnly)}
                className={`py-2 px-3 rounded-md text-sm font-medium transition ${showFailedOnly ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                title="업데이트 실패 항목만 표시"
              >
                ❌ 실패({failedIds.size})
              </button>
            )}
            <button
              onClick={() => setShowHiddenColumns(!showHiddenColumns)}
              className={`py-2 px-3 rounded-md text-sm font-medium transition ${showHiddenColumns ? 'bg-primary text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              title="추가 컬럼 표시/숨기기"
            >
              {showHiddenColumns ? '컬럼 숨기기' : '컬럼 더보기'}
            </button>
            {onAddSelectedToWatchlist && selectedAssets.length > 0 && (
              <button
                onClick={() => onAddSelectedToWatchlist(selectedAssets)}
                className="py-2 px-3 rounded-md text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition"
              >
                관심종목 추가 ({selectedAssets.length})
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-700 text-gray-300 uppercase text-xs">
            <tr>
              <th scope="col" className="px-4 py-3 text-center">
                <input type="checkbox" checked={allSelected} onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedIds(new Set(enrichedAndSortedAssets.map(a => a.id)));
                  } else {
                    setSelectedIds(new Set());
                  }
                }} />
              </th>
              <th scope="col" className={thClasses} onClick={() => requestSort('name')} title="종목명을 클릭하면 구글 검색으로 이동합니다.">
                <div className={thContentClasses}><span>종목명</span> <SortIcon sortKey='name'/></div>
              </th>
              {showHiddenColumns && (
                <th scope="col" className={`${thClasses} text-right`} onClick={() => requestSort('quantity')} title="보유하고 있는 자산의 수량입니다.">
                  <div className={`${thContentClasses} justify-end`}><span>보유수량</span> <SortIcon sortKey='quantity'/></div>
                </th>
              )}
              {showHiddenColumns && (
                <th scope="col" className={`${thClasses} text-right`} onClick={() => requestSort('purchasePrice')} title="자산을 매수한 시점의 평균 단가입니다 (해당 통화 기준).">
                  <div className={`${thContentClasses} justify-end`}><span>매수평균가</span> <SortIcon sortKey='purchasePrice'/></div>
                </th>
              )}
              <th scope="col" className={`${thClasses} text-right`} onClick={() => requestSort('currentPrice')} title="현재 시장가입니다 (해당 통화 기준).">
                <div className={`${thContentClasses} justify-end`}><span>현재가</span> <SortIcon sortKey='currentPrice'/></div>
              </th>
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('returnPercentage')} title="수익률: 해당 통화 기준으로 계산됩니다. (현재가 - 매수가) / 매수가 * 100">
                <div className={`${thContentClasses} justify-end`}><span>수익률</span> <SortIcon sortKey='returnPercentage'/></div>
              </th>
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('purchaseValue')} title="총 투자 원금입니다 (해당 통화 기준).">
                 <div className={`${thContentClasses} justify-end`}><span>투자원금</span> <SortIcon sortKey='purchaseValue'/></div>
              </th>
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('currentValue')} title="현재 보유 자산의 총 가치입니다 (해당 통화 기준).">
                 <div className={`${thContentClasses} justify-end`}><span>평가총액</span> <SortIcon sortKey='currentValue'/></div>
              </th>
              {showHiddenColumns && (
                <th scope="col" className={`${thClasses} text-center`} onClick={() => requestSort('purchaseDate')} title="자산을 매수한 날짜입니다.">
                  <div className={`${thContentClasses} justify-center`}><span>매수일</span> <SortIcon sortKey='purchaseDate'/></div>
                </th>
              )}
              {showHiddenColumns && (
                <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('allocation')} title="해당 자산의 평가금액이 전체 포트폴리오에서 차지하는 비율입니다.">
                  <div className={`${thContentClasses} justify-end`}><span>비중</span> <SortIcon sortKey='allocation'/></div>
                </th>
              )}
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('dropFromHigh')} title="자산의 현재가가 기록된 최고가 대비 얼마나 하락했는지를 나타냅니다.">
                <div className={`${thContentClasses} justify-end`}><span>최고가 대비</span> <SortIcon sortKey='dropFromHigh'/></div>
              </th>
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('yesterdayChange')} title="어제 종가 대비 현재가의 변동률입니다.">
                <div className={`${thContentClasses} justify-end`}><span>어제대비</span> <SortIcon sortKey='yesterdayChange'/></div>
              </th>
              <th scope="col" className="px-4 py-3 text-center" title="자산 관리">관리</th>
            </tr>
          </thead>
          <tbody>
            {enrichedAndSortedAssets.length > 0 ? enrichedAndSortedAssets.map(asset => {
              const { purchaseValue, currentValue, purchaseValueKRW, currentValueKRW, returnPercentage, allocation, dropFromHigh, profitLoss, profitLossKRW, diffFromHigh, yesterdayChange, diffFromYesterday } = asset.metrics;
              const alertRate = asset.sellAlertDropRate ?? sellAlertDropRate;
              const isAlertTriggered = dropFromHigh <= -alertRate;
              const isNonKRW = asset.currency !== Currency.KRW;
              
              const investmentColor = getChangeColor(returnPercentage);

              return (
                <Fragment key={asset.id}>
                  <tr className={`border-b border-gray-700 transition-colors duration-200 hover:bg-gray-700/50`}>
                    <td className="px-4 py-4 text-center">
                      <input type="checkbox" checked={selectedIds.has(asset.id)} onChange={(e) => {
                        const next = new Set<string>(selectedIds);
                        if (e.target.checked) next.add(asset.id); else next.delete(asset.id);
                        setSelectedIds(next);
                      }} />
                    </td>
                    <td className="px-4 py-4 font-medium text-white break-words">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <div className="group relative inline-block">
                            <a 
                              href={`https://www.google.com/search?q=${encodeURIComponent(asset.ticker + ' 주가')}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-bold hover:underline text-primary-light cursor-pointer inline-block"
                            >
                              {(asset.customName?.trim() || asset.name)}
                            </a>
                            {asset.memo && (
                              <div 
                                className="absolute left-0 top-full mt-2 p-3 bg-gray-800 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-[100] whitespace-pre-wrap break-words border border-gray-600 pointer-events-none"
                                style={{ width: '512px', maxWidth: '512px' }}
                              >
                                <div className="font-semibold mb-1.5 text-primary-light border-b border-gray-600 pb-1">메모:</div>
                                <div className="text-gray-200">{asset.memo}</div>
                              </div>
                            )}
                          </div>
                        </div>
                        <span className="text-xs text-gray-500 break-all">{asset.ticker} | {asset.exchange}</span>
                      </div>
                    </td>
                    {showHiddenColumns && (
                      <td className="px-4 py-4 text-right">
                        {asset.quantity.toLocaleString()}
                      </td>
                    )}
                    {showHiddenColumns && (
                      <td className="px-4 py-4 text-right">
                        <div>{formatOriginalCurrency(asset.purchasePrice, asset.currency)}</div>
                        {isNonKRW && exchangeRates[asset.currency] > 0 && (
                          <div className="text-xs text-gray-500">≈ {formatKRW(asset.purchasePrice * exchangeRates[asset.currency])}</div>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-4 text-right">
                      <div className="font-semibold text-white">{formatOriginalCurrency(asset.currentPrice, asset.currency)}</div>
                      {isNonKRW && exchangeRates[asset.currency] > 0 && (
                        <div className="text-xs text-gray-500">≈ {formatKRW(asset.currentPrice * exchangeRates[asset.currency])}</div>
                      )}
                    </td>
                    <td className={`px-4 py-4 font-medium text-right ${getChangeColor(returnPercentage)}`}>
                      <div>{returnPercentage.toFixed(2)}%</div>
                      <div className="text-xs opacity-80">{formatProfitLoss(profitLoss, asset.currency)}</div>
                      {isNonKRW && exchangeRates[asset.currency] > 0 && (
                        <div className="text-xs text-gray-500">{formatProfitLoss(profitLossKRW, Currency.KRW)} (원화)</div>
                      )}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className={investmentColor}>{formatOriginalCurrency(purchaseValue, asset.currency)}</div>
                      {isNonKRW && exchangeRates[asset.currency] > 0 && (
                        <div className="text-xs text-gray-500">≈ {formatKRW(purchaseValueKRW)}</div>
                      )}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="font-semibold text-white">{formatOriginalCurrency(currentValue, asset.currency)}</div>
                      {isNonKRW && exchangeRates[asset.currency] > 0 && (
                        <div className="text-xs text-gray-500">≈ {formatKRW(currentValueKRW)}</div>
                      )}
                    </td>
                    {showHiddenColumns && (
                      <td className="px-4 py-4 text-center">
                        {asset.purchaseDate}
                      </td>
                    )}
                    {showHiddenColumns && (
                      <td className="px-4 py-4 text-right">{allocation.toFixed(2)}%</td>
                    )}
                    <td className={`px-4 py-4 font-medium text-right ${getChangeColor(dropFromHigh)}`} title={`기준 최고가: ${formatOriginalCurrency(asset.highestPrice, asset.currency)}\n알림 기준: -${alertRate}%`}>
                        <div className="flex justify-end items-center">
                          {isAlertTriggered && <span className="mr-1 text-base" aria-label="경고">⚠️</span>}
                          <div>
                            <div>{dropFromHigh.toFixed(2)}%</div>
                            <div className="text-xs opacity-80">{formatProfitLoss(diffFromHigh, asset.currency)}</div>
                          </div>
                        </div>
                    </td>
                    <td className={`px-4 py-4 font-medium text-right ${getChangeColor(yesterdayChange)}`}>
                        {asset.yesterdayPrice && asset.yesterdayPrice > 0 ? (
                          <>
                            <div>{yesterdayChange.toFixed(2)}%</div>
                            <div className="text-xs opacity-80">{formatProfitLoss(diffFromYesterday, asset.currency)}</div>
                          </>
                        ) : (
                          <div className="text-gray-500">-</div>
                        )}
                    </td>
                    <td className="px-4 py-4 text-center relative">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handleToggleExpand(asset.id)}
                          className="p-2 text-gray-300 hover:text-white transition"
                          title="차트"
                        >
                          <ChartBarIcon />
                        </button>
                        <button
                          onClick={() => setOpenMenuId(prev => (prev === asset.id ? null : asset.id))}
                          className="p-2 text-gray-300 hover:text-white transition"
                          title="관리"
                        >
                          <MoreHorizontal className="h-5 w-5" />
                        </button>
                      </div>
                      {openMenuId === asset.id && (
                        <div ref={menuRef} className="absolute right-0 mt-2 w-44 bg-gray-800 border border-gray-700 rounded-md shadow-lg z-20 text-sm">
                          
                          <button
                            onClick={() => { setOpenMenuId(null); onEdit(asset); }}
                            disabled={isLoading}
                            className="block w-full text-left px-3 py-2 text-gray-200 hover:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed"
                          >
                            수정
                          </button>
                          {onSell && (
                            <button
                              onClick={() => { setOpenMenuId(null); onSell(asset); }}
                              disabled={isLoading || asset.quantity <= 0}
                              className="block w-full text-left px-3 py-2 text-red-400 hover:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed"
                            >
                              매도
                            </button>
                          )}
                          <button
                            onClick={() => { setOpenMenuId(null); handleToggleExpand(asset.id); }}
                            className="block w-full text-left px-3 py-2 text-gray-200 hover:bg-gray-700"
                          >
                            차트 보기(상세)
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {expandedAssetId === asset.id && (
                    <tr className="bg-gray-900/50">
                      <td colSpan={(() => {
                        let count = 9;
                        count += showHiddenColumns ? 4 : 0;
                        return count;
                      })()} className="p-0 sm:p-2">
                        <div className="px-4 sm:px-6 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                          <div>
                            <div className="text-gray-400">보유수량</div>
                            <div className="text-white font-semibold">{asset.quantity.toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-gray-400">매수일</div>
                            <div className="text-white font-semibold">{asset.purchaseDate}</div>
                          </div>
                          <div>
                            <div className="text-gray-400">매수평균가</div>
                            <div className="text-white font-semibold">{formatOriginalCurrency(asset.purchasePrice, asset.currency)}</div>
                          </div>
                          <div>
                            <div className="text-gray-400">비중</div>
                            <div className="text-white font-semibold">{allocation.toFixed(2)}%</div>
                          </div>
                        </div>
                        <AssetTrendChart
                          history={history}
                          assetId={asset.id}
                          assetName={(asset.customName?.trim() || asset.name)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            }) : (
              <tr>
                <td colSpan={(() => {
                  let count = 9;
                  count += showHiddenColumns ? 4 : 0;
                  return count;
                })()} className="text-center py-8 text-gray-500">
                  {filterAlerts 
                    ? '알림 기준을 초과한 자산이 없습니다.'
                    : filterCategory === 'ALL' 
                      ? '포트폴리오에 자산을 추가해주세요.' 
                      : '해당 구분의 자산이 없습니다.'
                  }
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PortfolioTable;