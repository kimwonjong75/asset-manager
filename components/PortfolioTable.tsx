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
  exchangeRates: ExchangeRates;
}

type SortKey = 'name' | 'purchaseDate' | 'quantity' | 'purchasePrice' | 'currentPrice' | 'returnPercentage' | 'dropFromHigh' | 'yesterdayChange' | 'purchaseValue' | 'currentValue' | 'allocation';
type SortDirection = 'ascending' | 'descending';

// [헬퍼] 원화 환산 함수
const getValueInKRW = (
  value: number, 
  currency: Currency, 
  exchangeRates: ExchangeRates
): number => {
  switch (currency) {
    case Currency.USD: return value * (exchangeRates.USD || 0);
    case Currency.JPY: return value * (exchangeRates.JPY || 0);
    case Currency.KRW: default: return value;
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
  exchangeRates 
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

  // 총 자산 가치 계산 (비중 계산용)
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

  // [핵심] 데이터 가공 및 정렬 로직 (원화 환산 정렬 포함)
  const enrichedAndSortedAssets = useMemo(() => {
    let enriched = assets.map(asset => {
      const currentValue = asset.currentPrice * asset.quantity;
      const purchaseValue = asset.purchasePrice * asset.quantity;
      
      const profitLoss = currentValue - purchaseValue;
      const returnPercentage = purchaseValue === 0 ? 0 : (profitLoss / purchaseValue) * 100;
      
      const currentValueKRW = getValueInKRW(currentValue, asset.currency, exchangeRates);
      const purchaseValueKRW = getValueInKRW(purchaseValue, asset.currency, exchangeRates);
      const profitLossKRW = currentValueKRW - purchaseValueKRW;
      
      // [정렬용] 원화 환산 단가
      const currentPriceKRW = getValueInKRW(asset.currentPrice, asset.currency, exchangeRates);
      const purchasePriceKRW = getValueInKRW(asset.purchasePrice, asset.currency, exchangeRates);

      const allocation = totalValueKRW === 0 ? 0 : (currentValueKRW / totalValueKRW) * 100;
      const dropFromHigh = asset.highestPrice === 0 ? 0 : ((asset.currentPrice - asset.highestPrice) / asset.highestPrice) * 100;
      const diffFromHigh = asset.currentPrice - asset.highestPrice;
      
      const yesterdayPrice = asset.yesterdayPrice || 0;
      const yesterdayChange = yesterdayPrice > 0 ? ((asset.currentPrice - yesterdayPrice) / yesterdayPrice) * 100 : 0;
      const diffFromYesterday = yesterdayPrice > 0 ? asset.currentPrice - yesterdayPrice : 0;
      
      return {
        ...asset,
        metrics: {
          purchasePrice: asset.purchasePrice,
          currentPrice: asset.currentPrice,
          // 정렬을 위해 KRW 환산가 추가
          currentPriceKRW,
          purchasePriceKRW,
          purchaseValue, currentValue, purchaseValueKRW, currentValueKRW,
          returnPercentage, allocation, dropFromHigh, profitLoss, profitLossKRW,
          diffFromHigh, yesterdayChange, diffFromYesterday,
        }
      };
    });

    // 필터링
    if (filterAlerts) {
      enriched = enriched.filter(asset => {
        const alertRate = asset.sellAlertDropRate ?? sellAlertDropRate;
        return asset.metrics.dropFromHigh <= -alertRate;
      });
    }

    if (showFailedOnly && failedIds && failedIds.size > 0) {
      enriched = enriched.filter(asset => failedIds.has(asset.id));
    }

    // 정렬 로직
    if (sortConfig !== null) {
      enriched.sort((a, b) => {
        const { key, direction } = sortConfig;
        let aValue: any, bValue: any;

        if (key === 'name') {
          aValue = (a.customName?.toLowerCase() || a.name.toLowerCase());
          bValue = (b.customName?.toLowerCase() || b.name.toLowerCase());
        } else if (key === 'purchaseDate') {
          aValue = a.purchaseDate; bValue = b.purchaseDate;
        } else if (key === 'quantity') {
          aValue = a.quantity; bValue = b.quantity;
        } else if (key === 'currentPrice') {
          // [수정] 원화 기준 정렬
          aValue = a.metrics.currentPriceKRW;
          bValue = b.metrics.currentPriceKRW;
        } else if (key === 'purchasePrice') {
          // [수정] 원화 기준 정렬
          aValue = a.metrics.purchasePriceKRW;
          bValue = b.metrics.purchasePriceKRW;
        } else if (key === 'currentValue') {
           aValue = a.metrics.currentValueKRW;
           bValue = b.metrics.currentValueKRW;
        } else if (key === 'purchaseValue') {
           aValue = a.metrics.purchaseValueKRW;
           bValue = b.metrics.purchaseValueKRW;
        } else {
          aValue = a.metrics[key as keyof typeof a.metrics];
          bValue = b.metrics[key as keyof typeof b.metrics];
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
  
  // [수정] 포맷팅 함수들 (소수점 제거)
  const formatNumber = (num: number) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(num);
  const formatKRW = (num: number) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(num);

  const formatOriginalCurrency = (num: number, currency: Currency) => {
    // 외화 표시 시에도 리스트에서는 깔끔하게 정수로 표현하거나, 필요시 소수점 유지 (여기서는 사용자 요청대로 소수점 제거 적용)
    const symbol = CURRENCY_SYMBOLS[currency];
    if (currency === Currency.KRW || currency === Currency.JPY) {
         return `${symbol}${formatNumber(num)}`;
    }
    // 달러 등은 소수점 2자리가 일반적이나, 요청에 따라 리스트에서는 간소화 가능. 일단 2자리 유지하되 .00은 제거
    return `${symbol}${new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(num)}`;
  };

  const formatProfitLoss = (num: number, currency: Currency) => {
    const sign = num >= 0 ? '+' : '';
    if (currency === Currency.KRW) {
      return `${sign}${formatKRW(num)}`;
    }
    return `${sign}${formatOriginalCurrency(num, currency)}`;
  };
  
  const getChangeColor = (value: number) => (value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-gray-400');
  
  // 내부 아이콘 컴포넌트들
  const SortIcon = ({ sortKey }: { sortKey: SortKey }) => {
    if (!sortConfig || sortConfig.key !== sortKey) return <span className="opacity-30">↕</span>;
    return sortConfig.direction === 'descending' ? <span>▼</span> : <span>▲</span>;
  };
  
  const RefreshIcon: React.FC<{className?: string}> = ({className}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M4 4l1.5 1.5A9 9 0 0120.5 10M20 20l-1.5-1.5A9 9 0 003.5 14" />
    </svg>
  );

  const ChartBarIcon: React.FC = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );

  useEffect(() => {
    if (!isLoading && prevLoadingRef.current && lastRunWasFullUpdate && failedIds && failedIds.size > 0) {
      const ok = window.confirm('업데이트에 실패한 항목이 있습니다. 실패한 리스트만 보시겠습니까?');
      if (ok) setShowFailedOnly(true);
    }
    prevLoadingRef.current = isLoading;
  }, [isLoading, lastRunWasFullUpdate, failedIds]);

  const thClasses = "px-4 py-3 cursor-pointer hover:bg-gray-600 transition-colors sticky top-0 bg-gray-700 z-10 whitespace-nowrap"; // sticky 적용
  const thContentClasses = "flex items-center gap-2";

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg">
      {/* 헤더 영역 */}
      <div className="bg-gray-800 px-4 sm:px-6 pt-4 sm:pt-6 pb-4 flex justify-between items-center gap-4 border-b border-gray-700">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-white">포트폴리오 현황</h2>
          {onSearchChange && (
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="검색..."
                className="bg-gray-700 border border-gray-600 rounded-md py-2 pl-10 pr-10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary w-48 sm:w-64"
              />
              <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {searchQuery && (
                <button onClick={() => onSearchChange('')} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* [추가] 선택 개수 배지 */}
          {selectedIds.size > 0 && (
            <span className="bg-primary/20 text-primary px-2 py-1 rounded text-xs font-bold hidden sm:inline-block">
              {selectedIds.size}개 선택됨
            </span>
          )}

          <button
            onClick={() => {
              const ids = Array.from(selectedIds);
              if (ids.length > 0) {
                setLastRunWasFullUpdate(false);
                onRefreshSelected ? onRefreshSelected(ids) : onRefreshAll();
              } else {
                if (window.confirm('전체 종목을 업데이트 하시겠습니까?')) {
                  setLastRunWasFullUpdate(true);
                  onRefreshAll();
                }
              }
            }}
            disabled={isLoading}
            className="bg-primary hover:bg-primary-dark text-white font-medium py-2 px-3 sm:px-4 rounded-md transition duration-300 flex items-center disabled:bg-gray-600"
          >
            {isLoading ? (
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : <RefreshIcon className="-ml-1 mr-2 h-4 w-4"/>}
            <span>{isLoading ? '중...' : '업데이트'}</span>
          </button>
          
          <div className="flex items-center gap-2">
            <div className="relative hidden sm:block">
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
              onClick={() => setShowHiddenColumns(!showHiddenColumns)}
              className={`py-2 px-3 rounded-md text-sm font-medium transition whitespace-nowrap ${showHiddenColumns ? 'bg-primary text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            >
              {showHiddenColumns ? '간소화' : '더보기'}
            </button>
          </div>
        </div>
      </div>

      {/* [수정] 스크롤 영역: 헤더 고정 및 세로/가로 스크롤 */}
      <div className="overflow-x-auto overflow-y-auto max-h-[70vh] relative">
        <table className="w-full text-sm">
          <thead className="bg-gray-700 text-gray-300 uppercase text-xs">
            <tr>
              <th scope="col" className="px-4 py-3 text-center sticky top-0 bg-gray-700 z-20">
                <input type="checkbox" checked={allSelected} onChange={(e) => {
                  if (e.target.checked) setSelectedIds(new Set(enrichedAndSortedAssets.map(a => a.id)));
                  else setSelectedIds(new Set());
                }} />
              </th>
              <th scope="col" className={`${thClasses} z-20`} onClick={() => requestSort('name')}>
                <div className={thContentClasses}><span>종목명</span> <SortIcon sortKey='name'/></div>
              </th>
              {showHiddenColumns && <th scope="col" className={`${thClasses} text-right`} onClick={() => requestSort('quantity')}><div className={`${thContentClasses} justify-end`}><span>보유수량</span> <SortIcon sortKey='quantity'/></div></th>}
              {showHiddenColumns && <th scope="col" className={`${thClasses} text-right`} onClick={() => requestSort('purchasePrice')}><div className={`${thContentClasses} justify-end`}><span>매수평균가</span> <SortIcon sortKey='purchasePrice'/></div></th>}
              <th scope="col" className={`${thClasses} text-right`} onClick={() => requestSort('currentPrice')}><div className={`${thContentClasses} justify-end`}><span>현재가</span> <SortIcon sortKey='currentPrice'/></div></th>
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('returnPercentage')}><div className={`${thContentClasses} justify-end`}><span>수익률</span> <SortIcon sortKey='returnPercentage'/></div></th>
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('purchaseValue')}><div className={`${thContentClasses} justify-end`}><span>투자원금</span> <SortIcon sortKey='purchaseValue'/></div></th>
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('currentValue')}><div className={`${thContentClasses} justify-end`}><span>평가총액</span> <SortIcon sortKey='currentValue'/></div></th>
              {showHiddenColumns && <th scope="col" className={`${thClasses} text-center`} onClick={() => requestSort('purchaseDate')}><div className={`${thContentClasses} justify-center`}><span>매수일</span> <SortIcon sortKey='purchaseDate'/></div></th>}
              {showHiddenColumns && <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('allocation')}><div className={`${thContentClasses} justify-end`}><span>비중</span> <SortIcon sortKey='allocation'/></div></th>}
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('dropFromHigh')}><div className={`${thContentClasses} justify-end`}><span>최고가 대비</span> <SortIcon sortKey='dropFromHigh'/></div></th>
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('yesterdayChange')}><div className={`${thContentClasses} justify-end`}><span>어제대비</span> <SortIcon sortKey='yesterdayChange'/></div></th>
              <th scope="col" className="px-4 py-3 text-center sticky top-0 bg-gray-700 z-20">관리</th>
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
                        const next = new Set(selectedIds);
                        e.target.checked ? next.add(asset.id) : next.delete(asset.id);
                        setSelectedIds(next);
                      }} />
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
                    <td className="px-4 py-4 text-right">
                      <div className="font-semibold text-white">{formatOriginalCurrency(asset.currentPrice, asset.currency)}</div>
                      {isNonKRW && <div className="text-xs text-gray-500">≈ {formatKRW(asset.metrics.currentPriceKRW)}</div>}
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
                    <td className={`px-4 py-4 font-medium text-right ${getChangeColor(yesterdayChange)}`}>
                        <div>{yesterdayChange.toFixed(2)}%</div>
                        <div className="text-xs opacity-80">{formatProfitLoss(diffFromYesterday, asset.currency)}</div>
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
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            }) : (
              <tr><td colSpan={13} className="text-center py-8 text-gray-500">
                  {filterAlerts ? '알림 기준을 초과한 자산이 없습니다.' : '자산이 없습니다.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PortfolioTable;