
import React, { useMemo, useState, Fragment, useRef, useEffect } from 'react';
 
import { Asset, Currency, CURRENCY_SYMBOLS, AssetCategory, PortfolioSnapshot, ALLOWED_CATEGORIES } from '../types';
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
}

type SortKey = 'name' | 'purchaseDate' | 'quantity' | 'purchasePrice' | 'currentPrice' | 'returnPercentage' | 'dropFromHigh' | 'yesterdayChange' | 'purchaseValueKRW' | 'currentValue' | 'allocation';
type SortDirection = 'ascending' | 'descending';

const PortfolioTable: React.FC<PortfolioTableProps> = ({ assets, history, onRefreshAll, onRefreshSelected, onRefreshOne, onEdit, onSell, isLoading, sellAlertDropRate, filterCategory, onFilterChange, filterAlerts, onFilterAlertsChange, searchQuery = '', onSearchChange, onAddSelectedToWatchlist, failedIds }) => {
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

  const totalValue = useMemo(() => assets.reduce((sum, asset) => sum + asset.currentPrice * asset.quantity, 0), [assets]);

  const handleToggleExpand = (assetId: string) => {
    setExpandedAssetId(prevId => (prevId === assetId ? null : assetId));
  };
  
  const categoryOptions = useMemo(() => {
    const extras = Array.from(new Set(assets.map(asset => asset.category))).filter(
      (cat) => !ALLOWED_CATEGORIES.includes(cat) && cat !== AssetCategory.FOREIGN_STOCK  // FOREIGN_STOCK 명시적 제외
    );
    return [...ALLOWED_CATEGORIES, ...extras];
  }, [assets]);

  const enrichedAndSortedAssets = useMemo(() => {
    let enriched = assets.map(asset => {
      const currentValue = asset.currentPrice * asset.quantity;
      
      let purchaseValueKRW;
      if (asset.currency === Currency.KRW) {
          purchaseValueKRW = asset.purchasePrice * asset.quantity;
      } else if (asset.purchaseExchangeRate) {
          purchaseValueKRW = asset.purchasePrice * asset.purchaseExchangeRate * asset.quantity;
      } else if (asset.priceOriginal > 0) {
          const exchangeRate = asset.currentPrice / asset.priceOriginal;
          purchaseValueKRW = asset.purchasePrice * exchangeRate * asset.quantity;
      } else {
          purchaseValueKRW = asset.purchasePrice * asset.quantity;
      }

      const profitLoss = currentValue - purchaseValueKRW;
      const returnPercentage = purchaseValueKRW === 0 ? 0 : (profitLoss / purchaseValueKRW) * 100;
      const allocation = totalValue === 0 ? 0 : (currentValue / totalValue) * 100;
      const dropFromHigh = asset.highestPrice === 0 ? 0 : ((asset.currentPrice - asset.highestPrice) / asset.highestPrice) * 100;
      const diffFromHigh = asset.currentPrice - asset.highestPrice;
      let yesterdayPriceKRW = asset.yesterdayPrice || 0;
      if (asset.currency !== Currency.KRW && asset.priceOriginal > 0 && asset.currentPrice > 0 && asset.yesterdayPrice && asset.yesterdayPrice > 0) {
        const impliedRate = asset.currentPrice / asset.priceOriginal;
        yesterdayPriceKRW = asset.yesterdayPrice * impliedRate;
      }
      const yesterdayChange = yesterdayPriceKRW > 0 
        ? ((asset.currentPrice - yesterdayPriceKRW) / yesterdayPriceKRW) * 100 
        : 0;
      let originalChange = 0;
      if (asset.currency !== Currency.KRW && asset.priceOriginal > 0 && asset.yesterdayPrice && asset.yesterdayPrice > 0) {
        originalChange = ((asset.priceOriginal - asset.yesterdayPrice) / asset.yesterdayPrice) * 100;
      }
      const diffFromYesterday = yesterdayPriceKRW > 0 ? asset.currentPrice - yesterdayPriceKRW : 0;
      
      return {
        ...asset,
        metrics: {
          purchasePrice: asset.purchasePrice,
          currentPrice: asset.currentPrice,
          purchaseValueKRW,
          currentValue,
          returnPercentage,
          allocation,
          dropFromHigh,
          profitLoss,
          diffFromHigh,
          yesterdayChange,
          originalChange,
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
          aValue = a.metrics[key as Exclude<SortKey, 'name' | 'purchaseDate' | 'quantity'>];
          bValue = b.metrics[key as Exclude<SortKey, 'name' | 'purchaseDate' | 'quantity'>];
        }

        if (aValue < bValue) {
          return direction === 'ascending' ? -1 : 1;
        }
        if (aValue > bValue) {
          return direction === 'ascending' ? 1 : -1;
        }
        return 0;
      });
    }

    return enriched;
  }, [assets, sortConfig, totalValue, filterAlerts, sellAlertDropRate, showFailedOnly, failedIds]);

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

  const formatOriginalCurrency = (num: number, currency: Currency) => {
    return `${CURRENCY_SYMBOLS[currency]}${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num)}`;
  }
  
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
                className="bg-gray-700 border border-gray-600 rounded-md py-2 pl-3 pr-8 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent appearance-none w-40"
                title="자산 구분에 따라 필터링합니다."
              >
                <option value="ALL">모든 자산</option>
                {categoryOptions.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => setShowHiddenColumns(prev => !prev)}
              className={`text-gray-300 hover:bg-gray-700 hover:text-white font-medium py-2 px-3 rounded-md transition duration-300 ${showHiddenColumns ? 'bg-gray-700 text-white' : ''}`}
              title="숨김 컬럼 표시"
            >
              숨김 컬럼 표시
            </button>
            <button
              onClick={() => setShowFailedOnly(prev => !prev)}
              className={`text-gray-300 hover:bg-gray-700 hover:text-white font-medium py-2 px-3 rounded-md transition duration-300 ${showFailedOnly ? 'bg-gray-700 text-white' : ''}`}
              title="업데이트 실패만 보기"
            >
              업데이트 실패만 보기
            </button>
          </div>
        </div>
      </div>
      <div className="w-full px-4 sm:px-6 pb-4 sm:pb-6 pt-4">
        <table className="w-full text-sm text-left text-gray-400 table-auto">
          <thead className="text-xs text-gray-300 uppercase bg-gray-700 select-none sticky top-0 z-10">
            <tr>
              <th scope="col" className="px-4 py-3 text-center">
                <input type="checkbox" checked={allSelected} onChange={() => {
                  const ids = enrichedAndSortedAssets.map(a => a.id);
                  const next = new Set<string>(selectedIds);
                  const selectAll = !(enrichedAndSortedAssets.every(a => selectedIds.has(a.id)));
                  if (selectAll) ids.forEach(id => next.add(id)); else ids.forEach(id => next.delete(id));
                  setSelectedIds(next);
                }} />
              </th>
              <th scope="col" className={`${thClasses}`} onClick={() => requestSort('name')} title="자산의 공식 명칭, 티커, 거래소 정보입니다.">
                <div className={thContentClasses}><span>종목명</span> <SortIcon sortKey='name'/></div>
              </th>
              {showHiddenColumns && (
                <th scope="col" className={`${thClasses} text-right`} onClick={() => requestSort('quantity')} title="보유하고 있는 자산의 수량입니다.">
                  <div className={`${thContentClasses} justify-end`}><span>보유수량</span> <SortIcon sortKey='quantity'/></div>
                </th>
              )}
              {showHiddenColumns && (
                <th scope="col" className={`${thClasses} text-right`} onClick={() => requestSort('purchasePrice')} title="자산을 매수한 시점의 평균 단가입니다 (자국 통화 기준). 해외 자산의 경우, 원화 환산 가격이 함께 표시됩니다.">
                  <div className={`${thContentClasses} justify-end`}><span>매수평균가</span> <SortIcon sortKey='purchasePrice'/></div>
                </th>
              )}
              <th scope="col" className={`${thClasses} text-right`} onClick={() => requestSort('currentPrice')} title="현재 시장가를 원화로 환산한 가격입니다.">
                <div className={`${thContentClasses} justify-end`}><span>현재가</span> <SortIcon sortKey='currentPrice'/></div>
              </th>
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('returnPercentage')} title="총 손익을 총 매수금액(원화)으로 나눈 백분율입니다. ((현재 평가금액 - 총 매수금액) / 총 매수금액) * 100">
                <div className={`${thContentClasses} justify-end`}><span>수익률</span> <SortIcon sortKey='returnPercentage'/></div>
              </th>
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('purchaseValueKRW')} title="총 투자 원금을 원화로 환산한 값입니다. (매수 평균가 * 수량 * 매수시 환율)">
                 <div className={`${thContentClasses} justify-end`}><span>투자원금</span> <SortIcon sortKey='purchaseValueKRW'/></div>
              </th>
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('currentValue')} title="현재 보유 자산의 총 가치를 원화로 환산한 값입니다. (현재가 * 수량)">
                 <div className={`${thContentClasses} justify-end`}><span>평가총액</span> <SortIcon sortKey='currentValue'/></div>
              </th>
              {showHiddenColumns && (
                <th scope="col" className={`${thClasses} text-center`} onClick={() => requestSort('purchaseDate')} title="자산을 매수한 날짜입니다.">
                  <div className={`${thContentClasses} justify-center`}><span>매수일</span> <SortIcon sortKey='purchaseDate'/></div>
                </th>
              )}
              {showHiddenColumns && (
                <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('allocation')} title="해당 자산의 평가금액이 전체 포트폴리오에서 차지하는 비율입니다. (개별 자산 평가금액 / 총 자산) * 100">
                  <div className={`${thContentClasses} justify-end`}><span>비중</span> <SortIcon sortKey='allocation'/></div>
                </th>
              )}
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('dropFromHigh')} title="자산의 현재가가 기록된 최고가 대비 얼마나 하락했는지를 나타내는 비율입니다. ((현재가 - 최고가) / 최고가) * 100">
                <div className={`${thContentClasses} justify-end`}><span>최고가 대비</span> <SortIcon sortKey='dropFromHigh'/></div>
              </th>
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('yesterdayChange')} title="어제 종가 대비 현재가의 변동률입니다. ((현재가 - 어제가) / 어제가) * 100">
                <div className={`${thContentClasses} justify-end`}><span>어제대비</span> <SortIcon sortKey='yesterdayChange'/></div>
              </th>
              <th scope="col" className="px-4 py-3 text-center" title="자산 관리">관리</th>
            </tr>
          </thead>
          <tbody>
            {enrichedAndSortedAssets.length > 0 ? enrichedAndSortedAssets.map(asset => {
              const { purchaseValueKRW, currentValue, returnPercentage, allocation, dropFromHigh, profitLoss, diffFromHigh, yesterdayChange, diffFromYesterday } = asset.metrics;
              const alertRate = asset.sellAlertDropRate ?? sellAlertDropRate;
              const isAlertTriggered = dropFromHigh <= -alertRate;
              const isNonKRW = asset.currency !== Currency.KRW;
              
              // 투자원금 색상 가져오기 (수익률과 동일한 색상 사용)
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
                        <div>{formatKRW(asset.purchasePrice * (asset.purchaseExchangeRate || 1))}</div>
                        {isNonKRW && <div className="text-xs text-gray-500">{formatOriginalCurrency(asset.purchasePrice, asset.currency)}</div>}
                      </td>
                    )}
                    <td className="px-4 py-4 text-right">
                      <div className="font-semibold text-white">{formatKRW(asset.currentPrice)}</div>
                      {isNonKRW && <div className="text-xs text-gray-500">{formatOriginalCurrency(asset.priceOriginal, asset.currency)}</div>}
                    </td>
                    <td className={`px-4 py-4 font-medium text-right ${getChangeColor(returnPercentage)}`}>
                        {isNonKRW ? (
                          <div className="group relative inline-block">
                            <div>
                              <div>{returnPercentage.toFixed(2)}%</div>
                              <div className="text-xs opacity-80">{formatKRW(profitLoss)}</div>
                            </div>
                            <div className="absolute left-0 top-full mt-2 w-64 p-3 bg-gray-800 text-white text-xs rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-[100] whitespace-pre-wrap break-words border border-gray-600 pointer-events-none">
                              <div className="font-semibold mb-1.5 text-primary-light border-b border-gray-600 pb-1">외화기준 수익률</div>
                              <div className="text-gray-200 mb-2">
                                {asset.priceOriginal > 0 && asset.purchasePrice > 0
                                  ? (((asset.priceOriginal - asset.purchasePrice) / asset.purchasePrice) * 100).toFixed(2) + '%'
                                  : '-'}
                              </div>
                              <div className="font-semibold mb-1.5 text-primary-light border-b border-gray-600 pb-1">외화기준 수익금</div>
                              <div className="text-gray-200">
                                {asset.priceOriginal > 0 && asset.purchasePrice > 0
                                  ? formatOriginalCurrency((asset.priceOriginal - asset.purchasePrice) * asset.quantity, asset.currency)
                                  : '-'}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div>{returnPercentage.toFixed(2)}%</div>
                            <div className="text-xs opacity-80">{formatKRW(profitLoss)}</div>
                          </>
                        )}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className={investmentColor}>{formatKRW(purchaseValueKRW)}</div>
                      {isNonKRW && <div className="text-xs text-gray-500">{formatOriginalCurrency(asset.purchasePrice * asset.quantity, asset.currency)}</div>}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="font-semibold text-white">{formatKRW(currentValue)}</div>
                      {isNonKRW && <div className="text-xs text-gray-500">{formatOriginalCurrency(asset.priceOriginal * asset.quantity, asset.currency)}</div>}
                    </td>
                    {showHiddenColumns && (
                      <td className="px-4 py-4 text-center">
                        {asset.purchaseDate}
                      </td>
                    )}
                    {showHiddenColumns && (
                      <td className="px-4 py-4 text-right">{allocation.toFixed(2)}%</td>
                    )}
                    <td className={`px-4 py-4 font-medium text-right ${getChangeColor(dropFromHigh)}`} title={`기준 최고가: ${formatKRW(asset.highestPrice)}\n알림 기준: -${alertRate}%`}>
                        <div className="flex justify-end items-center">
                          {isAlertTriggered && <span className="mr-1 text-base" aria-label="경고">⚠️</span>}
                          <div>
                            <div>{dropFromHigh.toFixed(2)}%</div>
                            <div className="text-xs opacity-80">{formatKRW(diffFromHigh)}</div>
                          </div>
                        </div>
                    </td>
                    <td
                      className={`px-4 py-4 font-medium text-right ${investmentColor}`}
                      title={`환율 변동 포함(원화 기준): ${yesterdayChange.toFixed(2)}%\n순수 주가 변동(외화 기준): ${isNonKRW && asset.metrics.originalChange !== undefined ? asset.metrics.originalChange.toFixed(2) + '%' : '-'}`}
                    >
                        {asset.yesterdayPrice && asset.yesterdayPrice > 0 ? (
                          <>
                            <div>{yesterdayChange.toFixed(2)}%</div>
                            <div className="text-xs opacity-80">{formatKRW(diffFromYesterday)}</div>
                            {isNonKRW && asset.metrics.originalChange !== undefined ? (
                              <div className="text-xs text-gray-500">{`$ ${asset.metrics.originalChange >= 0 ? '+' : ''}${asset.metrics.originalChange.toFixed(2)}%`}</div>
                            ) : null}
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
                            <div className="text-white font-semibold">{formatKRW(asset.purchasePrice * (asset.purchaseExchangeRate || 1))}</div>
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
