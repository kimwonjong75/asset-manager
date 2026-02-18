import React, { useMemo, useState, useEffect, Fragment, useRef } from 'react';
import { Filter, MoreHorizontal } from 'lucide-react';
import Tooltip from './common/Tooltip';
import { AssetCategory, Currency, CURRENCY_SYMBOLS, ALLOWED_CATEGORIES, WatchlistItem, ExchangeRates } from '../types';
import AssetTrendChart from './AssetTrendChart';
import { useOnClickOutside } from '../hooks/useOnClickOutside';

interface WatchlistPageProps {
  watchlist: WatchlistItem[];
  onDelete: (id: string) => void;
  onOpenAddModal: () => void;
  onOpenEditModal: (item: WatchlistItem) => void;
  isLoading: boolean;
  onBulkDelete?: (ids: string[]) => void;
  exchangeRates: ExchangeRates;
}

// 차트 아이콘
const ChartBarIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

const WatchlistPage: React.FC<WatchlistPageProps> = ({ watchlist, onDelete, onOpenAddModal, onOpenEditModal, isLoading, onBulkDelete, exchangeRates }) => {
  const [filterCategory, setFilterCategory] = useState<AssetCategory | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openFilterOptions, setOpenFilterOptions] = useState<boolean>(false);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useOnClickOutside(menuRef, () => setOpenMenuId(null), !!openMenuId);

  const categoryOptions = useMemo(() => {
    const extras = Array.from(new Set(watchlist.map(w => w.category))).filter(cat => !ALLOWED_CATEGORIES.includes(cat));
    return [...ALLOWED_CATEGORIES, ...extras];
  }, [watchlist]);

  const filtered = useMemo(() => {
    return watchlist
      .filter(w => (filterCategory === 'ALL' ? true : w.category === filterCategory))
      .filter(w => {
        if (!search) return true;
        const s = search.toLowerCase();
        return w.name.toLowerCase().includes(s) || w.ticker.toLowerCase().includes(s) || (w.notes || '').toLowerCase().includes(s);
      })
      .map(w => ({
        ...w,
        dropFromHigh: w.highestPrice && w.currentPrice ? ((w.currentPrice - w.highestPrice) / w.highestPrice) * 100 : 0,
        yesterdayChange: w.previousClosePrice && w.currentPrice ? ((w.currentPrice - w.previousClosePrice) / w.previousClosePrice) * 100 : 0,
      }));
  }, [watchlist, filterCategory, search]);

  useEffect(() => {
    setSelectedIds(prev => {
      const next = new Set<string>();
      filtered.forEach(w => {
        if (prev.has(w.id)) next.add(w.id);
      });
      return next;
    });
  }, [filtered]);

  const formatKRW = (num: number) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(num);
  const formatOriginalCurrency = (num: number, currency: Currency) => `${CURRENCY_SYMBOLS[currency]}${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num)}`;
  const getChangeColor = (value: number) => (value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-gray-400');
  const allSelected = filtered.length > 0 && filtered.every(w => selectedIds.has(w.id));

  const handleToggleExpand = (itemId: string) => {
    setExpandedItemId(prev => (prev === itemId ? null : itemId));
  };

  const getExchangeRate = (currency?: Currency): number => {
    if (!currency || currency === Currency.KRW) return 1;
    if (currency === Currency.USD) return exchangeRates.USD || 1;
    if (currency === Currency.JPY) return exchangeRates.JPY || 1;
    return 1;
  };

  return (
    <div className="space-y-6">
      {/* 툴바 */}
      <div className="bg-gray-800 p-4 rounded-lg shadow-lg flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="relative">
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="이름/티커/메모 검색" className="bg-gray-700 border border-gray-600 rounded-md py-2 pl-10 pr-10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary w-64" />
            <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => {
            if (filtered.length === 0) return;
            const ids = filtered.map(w => w.id);
            const next = new Set<string>(selectedIds);
            const selectAll = !(filtered.every(w => selectedIds.has(w.id)));
            if (selectAll) ids.forEach(id => next.add(id)); else ids.forEach(id => next.delete(id));
            setSelectedIds(next);
          }} className="border border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white font-medium py-2 px-3 rounded-md transition duration-300">
            {allSelected ? '전체 해제' : '전체 선택'}
          </button>
          <button onClick={() => {
            const ids = Array.from(selectedIds);
            if (ids.length === 0) return;
            if (onBulkDelete) onBulkDelete(ids); else ids.forEach(id => onDelete(id));
            setSelectedIds(new Set());
          }} disabled={selectedIds.size === 0} className="border border-gray-600 text-red-400 hover:bg-gray-700 font-medium py-2 px-4 rounded-md transition duration-300 disabled:text-gray-500 disabled:border-gray-700 disabled:cursor-not-allowed">
            선택 삭제
          </button>
          <button onClick={onOpenAddModal} className="bg-primary hover:bg-primary-dark text-white font-medium py-2 px-4 rounded-md transition duration-300 flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>종목추가</span>
          </button>
          <div className="relative">
            <button
              onClick={() => setOpenFilterOptions(prev => !prev)}
              className="border border-gray-600 text-gray-300 hover:bg-gray-700 hover:text-white font-medium py-2 px-3 rounded-md transition duration-300 flex items-center gap-2"
              title="필터"
            >
              <Filter className="h-4 w-4" />
              <span className="hidden sm:inline">필터</span>
            </button>
            {openFilterOptions && (
              <div className="absolute right-0 mt-2 w-72 bg-gray-800 border border-gray-700 rounded-md shadow-lg z-20 p-3">
                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-gray-400 mb-1">카테고리</div>
                    <div className="relative">
                      <select value={filterCategory} onChange={e => setFilterCategory(e.target.value as AssetCategory | 'ALL')} className="bg-gray-700 border border-gray-600 rounded-md py-2 pl-3 pr-8 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary appearance-none w-full">
                        <option value="ALL">전체</option>
                        {categoryOptions.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
                        <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 테이블 */}
      <div className="w-full px-0 sm:px-0">
        <table className="w-full text-sm text-left text-gray-400 table-auto">
          <thead className="text-xs text-gray-300 uppercase bg-gray-700 select-none sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 text-center">
                <input type="checkbox" checked={allSelected} onChange={() => {
                  const ids = filtered.map(w => w.id);
                  const next = new Set<string>(selectedIds);
                  const selectAll = !(filtered.every(w => selectedIds.has(w.id)));
                  if (selectAll) ids.forEach(id => next.add(id)); else ids.forEach(id => next.delete(id));
                  setSelectedIds(next);
                }} />
              </th>
              <th className="px-4 py-3">종목명</th>
              <th className="px-4 py-3 text-right">현재가</th>
              <th className="px-4 py-3 text-right">어제대비</th>
              <th className="px-4 py-3 text-right">최고가대비</th>
              <th className="px-4 py-3 text-center">액션</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length > 0 ? filtered.map(w => {
              const isNonKRW = w.currency !== undefined && w.currency !== Currency.KRW;
              const derivedExchangeRate = getExchangeRate(w.currency);
              return (
                <Fragment key={w.id}>
                  <tr className="border-b border-gray-700 transition-colors duration-200 hover:bg-gray-700/50">
                    <td className="px-4 py-3 text-center">
                      <input type="checkbox" checked={selectedIds.has(w.id)} onChange={(e) => {
                        const next = new Set<string>(selectedIds);
                        if (e.target.checked) next.add(w.id); else next.delete(w.id);
                        setSelectedIds(next);
                      }} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <Tooltip
                          content={w.notes ? (
                            <div className="space-y-0.5">
                              {w.notes.split('\n').map((line, i) => (
                                <p key={i} className={line.startsWith('-') || line.startsWith('·') ? 'pl-2 text-gray-300' : ''}>
                                  {line || '\u00A0'}
                                </p>
                              ))}
                            </div>
                          ) : null}
                          position="right"
                          wrap
                        >
                          <a
                            href={`https://www.google.com/search?q=${encodeURIComponent(w.ticker + ' 주가')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-bold hover:underline text-primary-light cursor-pointer"
                          >
                            {w.name}
                          </a>
                        </Tooltip>
                        <span className="text-xs text-gray-500">{w.ticker} | {w.exchange} | {w.category}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {w.currentPrice !== undefined ? formatKRW(w.currentPrice) : '-'}
                      {isNonKRW && w.priceOriginal !== undefined && w.currency !== undefined && (
                        <div className="text-xs text-gray-500">{formatOriginalCurrency(w.priceOriginal, w.currency)}</div>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-right ${getChangeColor(w.yesterdayChange || 0)}`}>{w.yesterdayChange !== undefined ? `${(w.yesterdayChange || 0).toFixed(2)}%` : '-'}</td>
                    <td className={`px-4 py-3 text-right ${getChangeColor(w.dropFromHigh || 0)}`}>{w.dropFromHigh !== undefined ? `${(w.dropFromHigh || 0).toFixed(2)}%` : '-'}</td>
                    <td className="px-4 py-3 text-center relative">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => handleToggleExpand(w.id)} className="p-2 text-gray-300 hover:text-white" title="차트">
                          <ChartBarIcon />
                        </button>
                        <button onClick={() => setOpenMenuId(openMenuId === w.id ? null : w.id)} className="p-2 text-gray-300 hover:text-white">
                          <MoreHorizontal className="h-5 w-5" />
                        </button>
                      </div>
                      {openMenuId === w.id && (
                        <div ref={menuRef} className="absolute right-0 mt-2 w-36 bg-gray-800 border border-gray-700 rounded-md shadow-lg z-30 text-sm">
                          <button onClick={() => { setOpenMenuId(null); onOpenEditModal(w); }} className="block w-full text-left px-3 py-2 hover:bg-gray-700 text-white">수정</button>
                          <button onClick={() => { setOpenMenuId(null); handleToggleExpand(w.id); }} className="block w-full text-left px-3 py-2 text-gray-200 hover:bg-gray-700">차트 보기</button>
                          <button onClick={() => {
                            setOpenMenuId(null);
                            if (window.confirm(`'${w.name}' 종목을 삭제하시겠습니까?`)) onDelete(w.id);
                          }} className="block w-full text-left px-3 py-2 text-red-400 hover:bg-gray-700">삭제</button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {expandedItemId === w.id && (
                    <tr className="bg-gray-900/50">
                      <td colSpan={6} className="p-0 sm:p-2">
                        <AssetTrendChart
                          history={[]}
                          assetId={w.id}
                          assetName={w.name}
                          currentQuantity={1}
                          currentPrice={w.priceOriginal || w.currentPrice || 0}
                          currency={w.currency}
                          exchangeRate={derivedExchangeRate}
                          ticker={w.ticker}
                          exchange={w.exchange}
                          category={w.category}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            }) : (
              <tr>
                <td colSpan={6} className="text-center py-8 text-gray-500">관심 종목을 추가해주세요.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default WatchlistPage;
