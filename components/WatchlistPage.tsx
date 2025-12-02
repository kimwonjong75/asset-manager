import React, { useMemo, useState, useEffect } from 'react';
import Toggle from './common/Toggle';
import { Filter, Trash2 } from 'lucide-react';
import { AssetCategory, Currency, CURRENCY_SYMBOLS, ALLOWED_CATEGORIES, WatchlistItem, inferCategoryFromExchange, normalizeExchange, SymbolSearchResult } from '../types';
import { searchSymbols } from '../services/geminiService';

interface WatchlistPageProps {
  watchlist: WatchlistItem[];
  onAdd: (item: Omit<WatchlistItem, 'id' | 'currentPrice' | 'priceOriginal' | 'currency' | 'yesterdayPrice' | 'highestPrice' | 'lastSignalAt' | 'lastSignalType'>) => void;
  onUpdate: (item: WatchlistItem) => void;
  onDelete: (id: string) => void;
  onToggleMonitoring: (id: string, enabled: boolean) => void;
  onRefreshAll: () => void;
  isLoading: boolean;
  onBulkDelete?: (ids: string[]) => void;
}

const WatchlistPage: React.FC<WatchlistPageProps> = ({ watchlist, onAdd, onUpdate, onDelete, onToggleMonitoring, onRefreshAll, isLoading, onBulkDelete }) => {
  const [filterCategory, setFilterCategory] = useState<AssetCategory | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [monitoringOnly, setMonitoringOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openFilterOptions, setOpenFilterOptions] = useState<boolean>(false);

  const [form, setForm] = useState<{ ticker: string; exchange: string; name: string; category: AssetCategory; buyZoneMin?: string; buyZoneMax?: string; dropFromHighThreshold?: string; notes?: string }>({
    ticker: '',
    exchange: 'KRX (코스피/코스닥)',
    name: '',
    category: AssetCategory.KOREAN_STOCK,
  });
  const [symbolQuery, setSymbolQuery] = useState('');
  const [symbolResults, setSymbolResults] = useState<SymbolSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const DEFAULT_SYMBOLS: SymbolSearchResult[] = [
    { ticker: '005930', name: '삼성전자', exchange: 'KRX (코스피/코스닥)' },
    { ticker: '005380', name: '현대자동차', exchange: 'KRX (코스피/코스닥)' },
    { ticker: '035420', name: 'NAVER', exchange: 'KRX (코스피/코스닥)' },
    { ticker: '035720', name: '카카오', exchange: 'KRX (코스피/코스닥)' },
    { ticker: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' },
    { ticker: 'TSLA', name: 'Tesla, Inc.', exchange: 'NASDAQ' },
    { ticker: 'GOOGL', name: 'Alphabet Inc.', exchange: 'NASDAQ' },
    { ticker: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ' },
    { ticker: 'BTC', name: '비트코인', exchange: '주요 거래소 (종합)' },
    { ticker: 'ETH', name: '이더리움', exchange: '주요 거래소 (종합)' },
  ];

  const categoryOptions = useMemo(() => {
    const extras = Array.from(new Set(watchlist.map(w => w.category))).filter(cat => !ALLOWED_CATEGORIES.includes(cat));
    return [...ALLOWED_CATEGORIES, ...extras];
  }, [watchlist]);

  const filtered = useMemo(() => {
    return watchlist
      .filter(w => (filterCategory === 'ALL' ? true : w.category === filterCategory))
      .filter(w => (monitoringOnly ? w.monitoringEnabled : true))
      .filter(w => {
        if (!search) return true;
        const s = search.toLowerCase();
        return w.name.toLowerCase().includes(s) || w.ticker.toLowerCase().includes(s) || (w.notes || '').toLowerCase().includes(s);
      })
      .map(w => ({
        ...w,
        dropFromHigh: w.highestPrice && w.currentPrice ? ((w.currentPrice - w.highestPrice) / w.highestPrice) * 100 : 0,
        yesterdayChange: w.yesterdayPrice && w.currentPrice ? ((w.currentPrice - w.yesterdayPrice) / w.yesterdayPrice) * 100 : 0,
        inBuyZone: w.buyZoneMin !== undefined && w.buyZoneMax !== undefined && w.currentPrice !== undefined
          ? w.currentPrice >= w.buyZoneMin && w.currentPrice <= w.buyZoneMax
          : false,
      }));
  }, [watchlist, filterCategory, monitoringOnly, search]);

  useEffect(() => {
    if (symbolQuery.length < 2) {
      setSymbolResults([]);
      return;
    }
    const handler = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchSymbols(symbolQuery);
        if (Array.isArray(results) && results.length > 0) {
          setSymbolResults(results);
        } else {
          const q = symbolQuery.toLowerCase();
          const local = DEFAULT_SYMBOLS.filter(r => r.name.toLowerCase().includes(q) || r.ticker.toLowerCase().includes(q)).slice(0, 10);
          setSymbolResults(local);
        }
      } catch {
        const q = symbolQuery.toLowerCase();
        const local = DEFAULT_SYMBOLS.filter(r => r.name.toLowerCase().includes(q) || r.ticker.toLowerCase().includes(q)).slice(0, 10);
        setSymbolResults(local);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => { clearTimeout(handler); };
  }, [symbolQuery]);

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
  const isEditMode = selectedIds.size === 1;

  useEffect(() => {
    if (!isEditMode) return;
    const selectedId = Array.from(selectedIds)[0];
    const selected = watchlist.find(w => w.id === selectedId);
    if (!selected) return;
    setForm({
      ticker: selected.ticker,
      exchange: selected.exchange,
      name: selected.name,
      category: selected.category,
      buyZoneMin: selected.buyZoneMin !== undefined ? String(selected.buyZoneMin) : undefined,
      buyZoneMax: selected.buyZoneMax !== undefined ? String(selected.buyZoneMax) : undefined,
      dropFromHighThreshold: selected.dropFromHighThreshold !== undefined ? String(selected.dropFromHighThreshold) : undefined,
      notes: selected.notes,
    });
    setSymbolQuery(selected.name);
  }, [isEditMode, selectedIds, watchlist]);

  return (
    <div className="space-y-6">
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
          <button onClick={onRefreshAll} disabled={isLoading} className="bg-primary hover:bg-primary-dark text-white font-medium py-2 px-4 rounded-md transition duration-300 flex items-center disabled:bg-gray-600 disabled:cursor-not-allowed">
          {isLoading ? (
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : null}
          <span>{isLoading ? '업데이트 중...' : '가격 새로고침'}</span>
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
                  <Toggle
                    label="모니터링 ON만"
                    checked={monitoringOnly}
                    onChange={(next) => setMonitoringOnly(next)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-gray-800 p-4 rounded-lg shadow-lg">
        <h3 className="text-lg font-semibold text-white mb-3">{isEditMode ? '종목 수정' : '종목 추가'}</h3>
        <div className="mb-3">
          <div className="relative">
            <input 
              id="watchlist-symbol-search" 
              type="text" 
              value={symbolQuery} 
              onChange={(e) => setSymbolQuery(e.target.value)} 
              onFocus={() => setIsFocused(true)}
              onBlur={() => setTimeout(() => setIsFocused(false), 150)}
              placeholder="티커/종목 검색"
              className="bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white text-sm w-full"
              autoComplete="off"
            />
            {isSearching && (
              <div className="absolute top-2 right-3">
                <svg className="animate-spin h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            )}
            {isFocused && symbolResults.length > 0 && (
              <ul className="absolute z-10 w-full bg-gray-700 border border-gray-600 rounded-md mt-1 max-h-60 overflow-y-auto shadow-lg">
                {symbolResults.map((result) => (
                  <li 
                    key={`${result.ticker}-${result.exchange}`} 
                    onMouseDown={() => {
                      const ex = normalizeExchange(result.exchange);
                      const cat = inferCategoryFromExchange(ex);
                      setForm(prev => ({ ...prev, ticker: result.ticker, exchange: ex, name: result.name, category: cat }));
                      setSymbolQuery(`${result.name}`);
                      setSymbolResults([]);
                    }} 
                    className="px-3 py-2 cursor-pointer hover:bg-primary-dark transition-colors"
                  >
                    <div className="font-bold text-white">{result.name} ({result.ticker})</div>
                    <div className="text-sm text-gray-400">{result.exchange}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input className="bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white text-sm" placeholder="티커" value={form.ticker} onChange={e => setForm({ ...form, ticker: e.target.value })} />
          <input className="bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white text-sm" placeholder="거래소" value={form.exchange} onChange={e => setForm({ ...form, exchange: e.target.value })} />
          <input className="bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white text-sm" placeholder="이름" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <div className="relative">
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value as AssetCategory })} className="bg-gray-700 border border-gray-600 rounded-md py-2 pl-3 pr-8 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary appearance-none w-full">
              {ALLOWED_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
            </div>
          </div>
          <input className="bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white text-sm" placeholder="매수존 하한(KRW)" value={form.buyZoneMin || ''} onChange={e => setForm({ ...form, buyZoneMin: e.target.value })} />
          <input className="bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white text-sm" placeholder="매수존 상한(KRW)" value={form.buyZoneMax || ''} onChange={e => setForm({ ...form, buyZoneMax: e.target.value })} />
          <input className="bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white text-sm" placeholder="최고가대비 하락%" value={form.dropFromHighThreshold || ''} onChange={e => setForm({ ...form, dropFromHighThreshold: e.target.value })} />
          <input className="bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white text-sm" placeholder="메모" value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} />
          <div className="sm:col-span-2 lg:col-span-4">
            <button
              onClick={() => {
                if (!form.ticker || !form.exchange || !form.name) return;
                if (selectedIds.size === 1) {
                  const selectedId = Array.from(selectedIds)[0];
                  const original = watchlist.find(w => w.id === selectedId);
                  if (!original) return;
                  const updated: WatchlistItem = {
                    ...original,
                    ticker: form.ticker,
                    exchange: form.exchange,
                    name: form.name,
                    category: form.category,
                    notes: form.notes,
                    buyZoneMin: form.buyZoneMin ? parseFloat(form.buyZoneMin) : undefined,
                    buyZoneMax: form.buyZoneMax ? parseFloat(form.buyZoneMax) : undefined,
                    dropFromHighThreshold: form.dropFromHighThreshold ? parseFloat(form.dropFromHighThreshold) : undefined,
                  };
                  onUpdate(updated);
                } else {
                  onAdd({
                    id: '',
                    ticker: form.ticker,
                    exchange: form.exchange,
                    name: form.name,
                    category: form.category,
                    monitoringEnabled: true,
                    notes: form.notes,
                    buyZoneMin: form.buyZoneMin ? parseFloat(form.buyZoneMin) : undefined,
                    buyZoneMax: form.buyZoneMax ? parseFloat(form.buyZoneMax) : undefined,
                    dropFromHighThreshold: form.dropFromHighThreshold ? parseFloat(form.dropFromHighThreshold) : undefined,
                  } as any);
                }
                setForm({ ticker: '', exchange: 'KRX (코스피/코스닥)', name: '', category: AssetCategory.KOREAN_STOCK });
                setSymbolQuery('');
                setSelectedIds(new Set());
              }}
              className="bg-primary hover:bg-primary-dark text-white font-medium py-2 px-4 rounded-md transition duration-300"
            >
              {selectedIds.size === 1 ? '수정' : '추가'}
            </button>
          </div>
        </div>
      </div>

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
              <th className="px-4 py-3 text-center">매수존</th>
              <th className="px-4 py-3 text-center">신호</th>
              <th className="px-4 py-3 text-center">모니터링</th>
              <th className="px-4 py-3">메모</th>
              <th className="px-4 py-3 text-center">삭제</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length > 0 ? filtered.map(w => {
              const isNonKRW = w.currency !== undefined && w.currency !== Currency.KRW;
              const signalBuyZone = w.inBuyZone;
              const signalDrop = w.dropFromHighThreshold !== undefined && (w.dropFromHigh || 0) <= -(w.dropFromHighThreshold || 0);
              const signalDailyDrop = (w.yesterdayChange || 0) < -2;
              const hasSignal = signalBuyZone || signalDrop || signalDailyDrop;
              return (
                <tr key={w.id} className={`border-b border-gray-700`}>
                  <td className="px-4 py-3 text-center">
                    <input type="checkbox" checked={selectedIds.has(w.id)} onChange={(e) => {
                      const next = new Set<string>(selectedIds);
                      if (e.target.checked) next.add(w.id); else next.delete(w.id);
                      setSelectedIds(next);
                    }} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <div className="font-bold text-white">{w.name}</div>
                      <div className="text-xs text-gray-500">{w.ticker} | {w.exchange} | {w.category}</div>
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
                  <td className="px-4 py-3 text-center">
                    {w.buyZoneMin !== undefined && w.buyZoneMax !== undefined ? (
                      <span className="text-gray-200">{formatKRW(w.buyZoneMin)} ~ {formatKRW(w.buyZoneMax)}</span>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {hasSignal ? (
                      <div className="flex justify-center gap-2">
                        {signalBuyZone && <span className="px-2 py-1 rounded bg-success/20 text-success text-xs">매수존</span>}
                        {signalDrop && <span className="px-2 py-1 rounded bg-blue-500/20 text-blue-400 text-xs">최고가대비</span>}
                        {signalDailyDrop && <span className="px-2 py-1 rounded bg-danger/20 text-danger text-xs">일중하락</span>}
                      </div>
                    ) : <span className="text-gray-500">-</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <label className="inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only" checked={w.monitoringEnabled} onChange={() => onToggleMonitoring(w.id, !w.monitoringEnabled)} />
                      <span className={`w-10 h-6 ${w.monitoringEnabled ? 'bg-green-600' : 'bg-gray-600'} rounded-full relative inline-block`}>
                        <span className={`absolute left-1 top-1 w-4 h-4 rounded-full ${w.monitoringEnabled ? 'bg-green-500 translate-x-full' : 'bg-white'} transition-transform duration-300`}></span>
                      </span>
                    </label>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      value={w.notes || ''}
                      onChange={e => onUpdate({ ...w, notes: e.target.value })}
                      className="w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white text-sm"
                      placeholder="메모"
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => onDelete(w.id)} className="p-2 text-red-400 hover:text-red-300" title="삭제">
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan={10} className="text-center py-8 text-gray-500">관심 종목을 추가해주세요.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default WatchlistPage;
