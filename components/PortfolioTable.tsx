import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import { PortfolioTableProps, SortKey, SortDirection } from '../types/ui';
import { usePortfolioData } from './portfolio-table/usePortfolioData';
import PortfolioTableRow from './portfolio-table/PortfolioTableRow';
import PortfolioMobileCard from './portfolio-table/PortfolioMobileCard';
import Tooltip from './common/Tooltip';
import { COLUMN_DESCRIPTIONS } from '../constants/columnDescriptions';
import type { SmartFilterState, SmartFilterKey } from '../types/smartFilter';
import { EMPTY_SMART_FILTER } from '../types/smartFilter';
import { matchesSmartFilter } from '../utils/smartFilterLogic';
import SmartFilterPanel from './portfolio-table/SmartFilterPanel';
import { usePortfolio } from '../contexts/PortfolioContext';
import type { AlertRule } from '../types/alertRules';

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
  onBuy,
  isLoading,
  sellAlertDropRate,
  onSellAlertDropRateChange,
  filterCategory,
  onFilterChange,
  filterAlerts,
  onFilterAlertsChange,
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
  const [smartFilter, setSmartFilter] = useState<SmartFilterState>({ ...EMPTY_SMART_FILTER, activeFilters: new Set() });

  useOnClickOutside(menuRef, () => setOpenMenuId(null), !!openMenuId);

  // Context에서 가져오기
  const { derived, ui, actions, data } = usePortfolio();
  const { enrichedMap, isEnrichedLoading } = derived;

  const {
    enrichedAndSortedAssets,
    sortConfig,
    requestSort,
    toggleReturnSort,
    categoryOptions
  } = usePortfolioData({
    assets,
    exchangeRates,
    categories: data.categoryStore.categories,
    filterAlerts,
    sellAlertDropRate,
    showFailedOnly,
    failedIds
  });
  const [presetOpen, setPresetOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const presetRef = useRef<HTMLDivElement | null>(null);
  useOnClickOutside(presetRef, () => setPresetOpen(false), presetOpen);

  // 프리셋 적용
  const handleApplyPreset = (rule: AlertRule) => {
    const newFilters = new Set<SmartFilterKey>(rule.filters);
    setSmartFilter({
      ...EMPTY_SMART_FILTER,
      activeFilters: newFilters,
      maShortPeriod: rule.filterConfig.maShortPeriod ?? 20,
      maLongPeriod: rule.filterConfig.maLongPeriod ?? 60,
      dropFromHighThreshold: rule.filterConfig.dropFromHighThreshold ?? 20,
      lossThreshold: rule.filterConfig.lossThreshold ?? 5,
    });
    setActivePreset(rule.id);
    setPresetOpen(false);
  };

  const handleClearPreset = () => {
    handleClearAllFilters();
    setActivePreset(null);
    setPresetOpen(false);
  };

  // 스마트 필터 적용 (usePortfolioData 미수정, 별도 useMemo)
  const filteredAssets = useMemo(() => {
    if (smartFilter.activeFilters.size === 0) return enrichedAndSortedAssets;
    return enrichedAndSortedAssets.filter(a => matchesSmartFilter(a, smartFilter, enrichedMap));
  }, [enrichedAndSortedAssets, smartFilter, enrichedMap]);

  const handleToggleFilter = (key: SmartFilterKey, deactivateKey?: SmartFilterKey) => {
    setSmartFilter(prev => {
      const next = new Set(prev.activeFilters);
      if (deactivateKey) next.delete(deactivateKey);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, activeFilters: next };
    });
  };

  const handleClearAllFilters = () => {
    setSmartFilter({ ...EMPTY_SMART_FILTER, activeFilters: new Set() });
  };

  const handleDropThresholdChange = (value: number) => {
    setSmartFilter(prev => ({ ...prev, dropFromHighThreshold: value }));
  };

  const handleMaShortPeriodChange = (period: number) => {
    setSmartFilter(prev => ({ ...prev, maShortPeriod: period }));
  };

  const handleMaLongPeriodChange = (period: number) => {
    setSmartFilter(prev => ({ ...prev, maLongPeriod: period }));
  };

  const handleLossThresholdChange = (value: number) => {
    setSmartFilter(prev => ({ ...prev, lossThreshold: value }));
  };

  const allSelected = filteredAssets.length > 0 && filteredAssets.every(a => selectedIds.has(a.id));

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

  const emptyMessage = smartFilter.activeFilters.size > 0
    ? '필터 조건에 맞는 자산이 없습니다.'
    : filterAlerts
      ? '알림 기준을 초과한 자산이 없습니다.'
      : '자산이 없습니다.';

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

          {/* 프리셋 드롭다운 */}
          <div className="relative" ref={presetRef}>
            <button
              onClick={() => setPresetOpen(!presetOpen)}
              className={`py-2 px-3 rounded-md text-sm font-medium transition flex items-center gap-1 ${
                activePreset
                  ? 'bg-primary text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <span className="hidden sm:inline">
                {activePreset
                  ? ui.alertSettings.rules.find(r => r.id === activePreset)?.name ?? '프리셋'
                  : '프리셋'}
              </span>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {presetOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-30 py-1">
                {/* 매도 감지 */}
                <div className="px-3 py-1.5 text-[10px] text-red-400 font-semibold uppercase tracking-wider">매도 감지</div>
                {ui.alertSettings.rules.filter(r => r.action === 'sell' && r.enabled).map(rule => (
                  <button
                    key={rule.id}
                    onClick={() => handleApplyPreset(rule)}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 transition flex items-center gap-2 ${
                      activePreset === rule.id ? 'text-primary' : 'text-gray-300'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      rule.severity === 'critical' ? 'bg-red-500' : 'bg-amber-500'
                    }`} />
                    {rule.name}
                  </button>
                ))}
                {/* 매수 기회 */}
                <div className="px-3 py-1.5 text-[10px] text-blue-400 font-semibold uppercase tracking-wider mt-1 border-t border-gray-700">매수 기회</div>
                {ui.alertSettings.rules.filter(r => r.action === 'buy' && r.enabled).map(rule => (
                  <button
                    key={rule.id}
                    onClick={() => handleApplyPreset(rule)}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 transition flex items-center gap-2 ${
                      activePreset === rule.id ? 'text-primary' : 'text-gray-300'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                    {rule.name}
                  </button>
                ))}
                {/* 구분선 + 추가 메뉴 */}
                <div className="border-t border-gray-700 mt-1 pt-1">
                  <button
                    onClick={() => { actions.setActiveTab('settings'); setPresetOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-700 hover:text-white transition flex items-center gap-2"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    알림 설정
                  </button>
                  <button
                    onClick={() => { actions.showBriefingPopup(); setPresetOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-700 hover:text-white transition flex items-center gap-2"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                    브리핑 다시 보기
                  </button>
                  {activePreset && (
                    <button
                      onClick={handleClearPreset}
                      className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-700 hover:text-white transition flex items-center gap-2"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      필터 초기화
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

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
                onChange={(e) => { const v = e.target.value; onFilterChange(v === 'ALL' ? 'ALL' : Number(v)); }}
                className="appearance-none bg-gray-700 border border-gray-600 text-white text-sm rounded-md py-2 pl-3 pr-8 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="ALL">전체 자산</option>
                {categoryOptions.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
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

      {/* 스마트 필터 패널 */}
      <SmartFilterPanel
        filter={smartFilter}
        onToggleFilter={handleToggleFilter}
        onClearAll={handleClearAllFilters}
        onDropThresholdChange={handleDropThresholdChange}
        onLossThresholdChange={handleLossThresholdChange}
        onMaShortPeriodChange={handleMaShortPeriodChange}
        onMaLongPeriodChange={handleMaLongPeriodChange}
        matchCount={filteredAssets.length}
        totalCount={enrichedAndSortedAssets.length}
        sellAlertDropRate={sellAlertDropRate}
        onSellAlertDropRateChange={onSellAlertDropRateChange || (() => {})}
        filterAlerts={filterAlerts}
        onFilterAlertsChange={onFilterAlertsChange}
        isEnrichedLoading={isEnrichedLoading}
      />

      {/* 데스크탑: 테이블 — overflow 없음, thead가 main 스크롤 기준 sticky */}
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-gray-700 text-gray-300 uppercase text-xs">
            <tr>
              <th scope="col" className="px-4 py-3 text-center sticky top-0 bg-gray-700 z-20">
                <input type="checkbox" checked={allSelected} onChange={(e) => {
                  if (e.target.checked) setSelectedIds(new Set(filteredAssets.map(a => a.id)));
                  else setSelectedIds(new Set());
                }} />
              </th>
              <th scope="col" className={`${thClasses} z-20`} onClick={() => requestSort('name')}>
                <Tooltip content={COLUMN_DESCRIPTIONS.name} position="bottom" wrap>
                  <div className={thContentClasses}><span>종목명</span> <SortIcon sortKey='name' sortConfig={sortConfig}/></div>
                </Tooltip>
              </th>
              {showHiddenColumns && <th scope="col" className={`${thClasses} text-right`} onClick={() => requestSort('quantity')}>
                <Tooltip content={COLUMN_DESCRIPTIONS.quantity} position="bottom" wrap>
                  <div className={`${thContentClasses} justify-end`}><span>보유수량</span> <SortIcon sortKey='quantity' sortConfig={sortConfig}/></div>
                </Tooltip>
              </th>}
              {showHiddenColumns && <th scope="col" className={`${thClasses} text-right`} onClick={() => requestSort('purchasePrice')}>
                <Tooltip content={COLUMN_DESCRIPTIONS.purchasePrice} position="bottom" wrap>
                  <div className={`${thContentClasses} justify-end`}><span>매수평균가</span> <SortIcon sortKey='purchasePrice' sortConfig={sortConfig}/></div>
                </Tooltip>
              </th>}
              <th scope="col" className={`${thClasses} text-right`} onClick={() => requestSort('currentPrice')}>
                <Tooltip content={COLUMN_DESCRIPTIONS.currentPrice} position="bottom" wrap>
                  <div className={`${thContentClasses} justify-end`}><span>현재가</span> <SortIcon sortKey='currentPrice' sortConfig={sortConfig}/></div>
                </Tooltip>
              </th>
              <th scope="col" className={`${thClasses} justify-end`} onClick={toggleReturnSort}>
                <Tooltip content={sortConfig?.key === 'profitLossKRW' ? COLUMN_DESCRIPTIONS.profitLossKRW : COLUMN_DESCRIPTIONS.returnPercentage} position="bottom" wrap>
                  <div className={`${thContentClasses} justify-end`}><span>{getReturnHeaderLabel()}</span></div>
                </Tooltip>
              </th>
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('purchaseValue')}>
                <Tooltip content={COLUMN_DESCRIPTIONS.purchaseValue} position="bottom" wrap>
                  <div className={`${thContentClasses} justify-end`}><span>투자원금</span> <SortIcon sortKey='purchaseValue' sortConfig={sortConfig}/></div>
                </Tooltip>
              </th>
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('currentValue')}>
                <Tooltip content={COLUMN_DESCRIPTIONS.currentValue} position="bottom" wrap>
                  <div className={`${thContentClasses} justify-end`}><span>평가총액</span> <SortIcon sortKey='currentValue' sortConfig={sortConfig}/></div>
                </Tooltip>
              </th>
              {showHiddenColumns && <th scope="col" className={`${thClasses} text-center`} onClick={() => requestSort('purchaseDate')}>
                <Tooltip content={COLUMN_DESCRIPTIONS.purchaseDate} position="bottom" wrap>
                  <div className={`${thContentClasses} justify-center`}><span>매수일</span> <SortIcon sortKey='purchaseDate' sortConfig={sortConfig}/></div>
                </Tooltip>
              </th>}
              {showHiddenColumns && <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('allocation')}>
                <Tooltip content={COLUMN_DESCRIPTIONS.allocation} position="bottom" wrap>
                  <div className={`${thContentClasses} justify-end`}><span>비중</span> <SortIcon sortKey='allocation' sortConfig={sortConfig}/></div>
                </Tooltip>
              </th>}
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('dropFromHigh')}>
                <Tooltip content={COLUMN_DESCRIPTIONS.dropFromHigh} position="bottom" wrap>
                  <div className={`${thContentClasses} justify-end`}><span>최고가 대비</span> <SortIcon sortKey='dropFromHigh' sortConfig={sortConfig}/></div>
                </Tooltip>
              </th>
              <th scope="col" className={`${thClasses} justify-end`} onClick={() => requestSort('yesterdayChange')}>
                <Tooltip content={COLUMN_DESCRIPTIONS.yesterdayChange} position="bottom" wrap>
                  <div className={`${thContentClasses} justify-end`}><span>어제대비</span> <SortIcon sortKey='yesterdayChange' sortConfig={sortConfig}/></div>
                </Tooltip>
              </th>
              <th scope="col" className="px-4 py-3 text-center sticky top-0 bg-gray-700 z-20">관리</th>
            </tr>
          </thead>
          <tbody>
            {filteredAssets.length > 0 ? filteredAssets.map(asset => (
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
                onBuy={onBuy}
                filterAlerts={filterAlerts}
                exchangeRates={exchangeRates}
              />
            )) : (
              <tr><td colSpan={13} className="text-center py-8 text-gray-500">
                  {emptyMessage}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 모바일: 카드 뷰 */}
      <div className="block md:hidden">
        {filteredAssets.length > 0 ? filteredAssets.map(asset => (
          <PortfolioMobileCard
            key={asset.id}
            asset={asset}
            history={history}
            onEdit={onEdit}
            onSell={onSell}
            onBuy={onBuy}
            exchangeRates={exchangeRates}
          />
        )) : (
          <div className="text-center py-8 text-gray-500">{emptyMessage}</div>
        )}
      </div>
    </div>
  );
};

export default PortfolioTable;
