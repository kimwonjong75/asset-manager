import React, { useState, useRef, useEffect } from 'react';
import { AssetCategory } from '../types';
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import { PortfolioTableProps, SortKey, SortDirection } from '../types/ui';
import { usePortfolioData } from './portfolio-table/usePortfolioData';
import PortfolioTableRow from './portfolio-table/PortfolioTableRow';

const SortIcon = ({ sortKey, sortConfig }: { sortKey: SortKey, sortConfig: { key: SortKey; direction: SortDirection } | null }) => {
  if (!sortConfig || sortConfig.key !== sortKey) return <span className="opacity-30">↕</span>;
  return sortConfig.direction === 'descending' ? <span>▼</span> : <span>▲</span>;
};

const RefreshIcon: React.FC<{className?: string}> = ({className}) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M4 4l1.5 1.5A9 9 0 0120.5 10M20 20l-1.5-1.5A9 9 0 003.5 14" />
  </svg>
);

const PortfolioTable: React.FC<PortfolioTableProps> = ({ 
  assets, 
  history, 
  onRefreshAll, 
  onRefreshSelected, 
  onEdit, 
  onSell, 
  isLoading, 
  sellAlertDropRate, 
  filterCategory, 
  onFilterChange, 
  filterAlerts, 
  searchQuery = '', 
  onSearchChange, 
  failedIds,
  exchangeRates 
}) => {
  const [showHiddenColumns, setShowHiddenColumns] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showFailedOnly, setShowFailedOnly] = useState<boolean>(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const prevLoadingRef = useRef<boolean>(false);
  const [lastRunWasFullUpdate, setLastRunWasFullUpdate] = useState<boolean>(false);

  useOnClickOutside(menuRef, () => setOpenMenuId(null), !!openMenuId);

  const {
    enrichedAndSortedAssets,
    sortConfig,
    requestSort,
    toggleReturnSort,
    categoryOptions
  } = usePortfolioData({
    assets,
    exchangeRates,
    filterAlerts,
    sellAlertDropRate,
    showFailedOnly,
    failedIds
  });

  const allSelected = enrichedAndSortedAssets.length > 0 && enrichedAndSortedAssets.every(a => selectedIds.has(a.id));

  const getReturnHeaderLabel = () => {
    if (!sortConfig) return '수익률';
    if (sortConfig.key === 'returnPercentage') return `수익률 ${sortConfig.direction === 'descending' ? '▼' : '▲'}`;
    if (sortConfig.key === 'profitLossKRW') return `평가손익 ${sortConfig.direction === 'descending' ? '▼' : '▲'}`;
    return '수익률';
  };

  useEffect(() => {
    if (!isLoading && prevLoadingRef.current && lastRunWasFullUpdate && failedIds && failedIds.size > 0) {
      const ok = window.confirm('업데이트에 실패한 항목이 있습니다. 실패한 리스트만 보시겠습니까?');
      if (ok) setShowFailedOnly(true);
    }
    prevLoadingRef.current = isLoading;
  }, [isLoading, lastRunWasFullUpdate, failedIds]);

  const thClasses = "px-4 py-3 cursor-pointer hover:bg-gray-600 transition-colors sticky top-0 bg-gray-700 z-10 whitespace-nowrap";
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

      {/* 테이블 영역 */}
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
                <div className={thContentClasses}><span>종목명</span> <SortIcon sortKey='name' sortConfig={sortConfig}/></div>
              </th>
              {showHiddenColumns && <th scope="col" className={`${thClasses} text-right`} onClick={() => requestSort('quantity')}><div className={`${thContentClasses} justify-end`}><span>보유수량</span> <SortIcon sortKey='quantity' sortConfig={sortConfig}/></div></th>}
              {showHiddenColumns && <th scope="col" className={`${thClasses} text-right`} onClick={() => requestSort('purchasePrice')}><div className={`${thContentClasses} justify-end`}><span>매수평균가</span> <SortIcon sortKey='purchasePrice' sortConfig={sortConfig}/></div></th>}
              <th scope="col" className={`${thClasses} text-right`} onClick={() => requestSort('currentPrice')}><div className={`${thContentClasses} justify-end`}><span>현재가</span> <SortIcon sortKey='currentPrice' sortConfig={sortConfig}/></div></th>
              <th scope="col" className={`${thClasses} justify-end`} onClick={toggleReturnSort}><div className={`${thContentClasses} justify-end`}><span>{getReturnHeaderLabel()}</span></div></th>
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('purchaseValue')}><div className={`${thContentClasses} justify-end`}><span>투자원금</span> <SortIcon sortKey='purchaseValue' sortConfig={sortConfig}/></div></th>
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('currentValue')}><div className={`${thContentClasses} justify-end`}><span>평가총액</span> <SortIcon sortKey='currentValue' sortConfig={sortConfig}/></div></th>
              {showHiddenColumns && <th scope="col" className={`${thClasses} text-center`} onClick={() => requestSort('purchaseDate')}><div className={`${thContentClasses} justify-center`}><span>매수일</span> <SortIcon sortKey='purchaseDate' sortConfig={sortConfig}/></div></th>}
              {showHiddenColumns && <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('allocation')}><div className={`${thContentClasses} justify-end`}><span>비중</span> <SortIcon sortKey='allocation' sortConfig={sortConfig}/></div></th>}
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('dropFromHigh')}><div className={`${thContentClasses} justify-end`}><span>최고가 대비</span> <SortIcon sortKey='dropFromHigh' sortConfig={sortConfig}/></div></th>
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('yesterdayChange')}><div className={`${thContentClasses} justify-end`}><span>어제대비</span> <SortIcon sortKey='yesterdayChange' sortConfig={sortConfig}/></div></th>
              <th scope="col" className="px-4 py-3 text-center sticky top-0 bg-gray-700 z-20">관리</th>
            </tr>
          </thead>
          <tbody>
            {enrichedAndSortedAssets.length > 0 ? enrichedAndSortedAssets.map(asset => (
              <PortfolioTableRow
                key={asset.id}
                asset={asset}
                history={history}
                selectedIds={selectedIds}
                onSelect={(id, checked) => {
                  const next = new Set(selectedIds);
                  checked ? next.add(id) : next.delete(id);
                  setSelectedIds(next);
                }}
                showHiddenColumns={showHiddenColumns}
                sellAlertDropRate={sellAlertDropRate}
                onEdit={onEdit}
                onSell={onSell}
                filterAlerts={filterAlerts}
              />
            )) : (
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
