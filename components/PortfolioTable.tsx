
import React, { useMemo, useState, Fragment } from 'react';
import { Asset, Currency, CURRENCY_SYMBOLS, AssetCategory, PortfolioSnapshot, ALLOWED_CATEGORIES } from '../types';
import AssetTrendChart from './AssetTrendChart';

interface PortfolioTableProps {
  assets: Asset[];
  history: PortfolioSnapshot[];
  onRefreshAll: () => void;
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
}

type SortKey = 'name' | 'purchaseDate' | 'quantity' | 'purchasePrice' | 'currentPrice' | 'returnPercentage' | 'dropFromHigh' | 'yesterdayChange' | 'purchaseValueKRW' | 'currentValue' | 'allocation';
type SortDirection = 'ascending' | 'descending';

const PortfolioTable: React.FC<PortfolioTableProps> = ({ assets, history, onRefreshAll, onRefreshOne, onEdit, onSell, isLoading, sellAlertDropRate, filterCategory, onFilterChange, filterAlerts, onFilterAlertsChange, searchQuery = '', onSearchChange, onAddSelectedToWatchlist }) => {
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection } | null>(null);
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);
  const [showHiddenColumns, setShowHiddenColumns] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
  }, [assets, sortConfig, totalValue, filterAlerts, sellAlertDropRate]);

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

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg">
       <div className="bg-gray-800 px-4 sm:px-6 pt-4 sm:pt-6 pb-4 flex justify-between items-center flex-wrap gap-4 border-b border-gray-700">
        <div className="flex items-center gap-4 flex-wrap">
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
          <div className="relative">
            <select
                value={filterCategory}
                onChange={(e) => onFilterChange(e.target.value as AssetCategory | 'ALL')}
                className="bg-gray-700 border border-gray-600 rounded-md py-2 pl-3 pr-8 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent appearance-none"
                title="자산 구분에 따라 필터링합니다."
            >
                <option value="ALL">모든 자산</option>
                {categoryOptions.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
                <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
            </div>
          </div>
          <label htmlFor="alert-filter-toggle" className="flex items-center cursor-pointer" title="매도 알림 기준을 초과한 자산만 표시합니다.">
              <div className="relative">
                  <input type="checkbox" id="alert-filter-toggle" className="sr-only" checked={filterAlerts} onChange={() => onFilterAlertsChange(!filterAlerts)} />
                  <div className="block bg-gray-600 w-10 h-6 rounded-full"></div>
                  <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform duration-300 ease-in-out ${filterAlerts ? 'transform translate-x-full bg-primary' : ''}`}></div>
              </div>
              <div className="ml-3 text-sm font-medium text-gray-300">알림 종목만 보기</div>
          </label>
          <label htmlFor="hidden-columns-toggle" className="flex items-center cursor-pointer" title="보유수량·매수일·매수평균가·비중 컬럼을 표시/숨김합니다.">
              <div className="relative ml-2">
                  <input type="checkbox" id="hidden-columns-toggle" className="sr-only" checked={showHiddenColumns} onChange={() => setShowHiddenColumns(!showHiddenColumns)} />
                  <div className="block bg-gray-600 w-10 h-6 rounded-full"></div>
                  <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform duration-300 ease-in-out ${showHiddenColumns ? 'transform translate-x-full bg-primary' : ''}`}></div>
              </div>
              <div className="ml-3 text-sm font-medium text-gray-300">숨김 컬럼 표시</div>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefreshAll}
            disabled={isLoading}
            className="bg-primary hover:bg-primary-dark text-white font-medium py-2 px-4 rounded-md transition duration-300 flex items-center disabled:bg-gray-600 disabled:cursor-not-allowed"
            title="모든 자산의 현재가를 새로고침합니다."
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
          {onAddSelectedToWatchlist && (
            <button
              onClick={() => onAddSelectedToWatchlist(selectedAssets)}
              disabled={selectedIds.size === 0}
              className="bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 px-4 rounded-md transition duration-300 disabled:bg-gray-600 disabled:cursor-not-allowed"
              title="선택한 자산을 관심종목에 추가합니다."
            >
              관심종목에 추가
            </button>
          )}
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
              <th scope="col" className="px-4 py-3 text-center" title="자산 가격 갱신">업데이트</th>
              <th scope="col" className="px-4 py-3 text-center" title="자산 정보 수정">수정</th>
              {onSell && <th scope="col" className="px-4 py-3 text-center" title="자산 매도">매도</th>}
              <th scope="col" className="px-4 py-3 text-center" title="자산 상세 정보 보기">상세</th>
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
                  <tr className={`border-b border-gray-700 transition-colors duration-200 ${isAlertTriggered ? 'bg-danger/10 hover:bg-danger/20' : 'hover:bg-gray-700/50'}`}>
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
                    <td className="px-4 py-4 text-center">
                      <button onClick={() => onRefreshOne && onRefreshOne(asset.id)} disabled={isLoading} className="p-2 text-primary hover:text-primary-light disabled:text-gray-600 disabled:cursor-not-allowed transition" title="이 자산만 현재가를 갱신합니다.">
                        <RefreshIcon className="h-4 w-4" />
                      </button>
                    </td>
                    <td className="px-4 py-4 text-center">
                      <button onClick={() => onEdit(asset)} disabled={isLoading} className="p-2 text-yellow-400 hover:text-yellow-300 disabled:text-gray-600 disabled:cursor-not-allowed transition" title="선택한 자산의 정보를 수정합니다.">
                          <EditIcon />
                      </button>
                    </td>
                    {onSell && (
                      <td className="px-4 py-4 text-center">
                        <button 
                          onClick={() => onSell(asset)} 
                          disabled={isLoading || asset.quantity <= 0} 
                          className="p-2 text-red-400 hover:text-red-300 disabled:text-gray-600 disabled:cursor-not-allowed transition" 
                          title="선택한 자산을 매도합니다."
                        >
                          <SellIcon />
                        </button>
                      </td>
                    )}
                    <td className="px-4 py-4 text-center">
                       <button onClick={() => handleToggleExpand(asset.id)} className="p-2 text-blue-400 hover:text-blue-300 transition" title="개별 손익 추이 보기">
                          <ChartBarIcon />
                        </button>
                    </td>
                  </tr>
                  {expandedAssetId === asset.id && (
                    <tr className="bg-gray-900/50">
                      <td colSpan={(() => {
                        let count = 1;
                        count += showHiddenColumns ? 1 : 0;
                        count += showHiddenColumns ? 1 : 0;
                        count += showHiddenColumns ? 1 : 0;
                        count += 1;
                        count += 1;
                        count += 1;
                        count += 1;
                        count += 1;
                        count += 1;
                        count += showHiddenColumns ? 1 : 0;
                        count += 1;
                        count += onSell ? 1 : 0;
                        count += 1;
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
                  let count = 1;
                  count += showHiddenColumns ? 1 : 0;
                  count += showHiddenColumns ? 1 : 0;
                  count += showHiddenColumns ? 1 : 0;
                  count += 1;
                  count += 1;
                  count += 1;
                  count += 1;
                  count += 1;
                  count += 1;
                  count += showHiddenColumns ? 1 : 0;
                  count += 1;
                  count += onSell ? 1 : 0;
                  count += 1;
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
