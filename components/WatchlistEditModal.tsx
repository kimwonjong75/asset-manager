import React, { useState, useEffect } from 'react';
import { AssetCategory, WatchlistItem, ALLOWED_CATEGORIES, inferCategoryFromExchange, normalizeExchange } from '../types';
import { searchSymbols } from '../services/geminiService';
import { usePortfolio } from '../contexts/PortfolioContext';

const WatchlistEditModal: React.FC = () => {
  const { modal, actions } = usePortfolio();
  const item = modal.editingWatchItem;
  const isOpen = !!item;
  const onClose = actions.closeEditWatchItem;

  const [ticker, setTicker] = useState('');
  const [exchange, setExchange] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<AssetCategory>(AssetCategory.US_STOCK);
  const [notes, setNotes] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ ticker: string; name: string; exchange: string }[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (item) {
      setTicker(item.ticker);
      setExchange(item.exchange);
      setName(item.name);
      setCategory(item.category);
      setNotes(item.notes || '');
      setSearchQuery('');
      setSearchResults([]);
    }
  }, [item]);

  if (!isOpen || !item) return null;

  const handleSearchChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setSearchQuery(q);
    if (!q || q.length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const results = await searchSymbols(q);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const applySymbol = (r: { ticker: string; name: string; exchange: string }) => {
    const ex = normalizeExchange(r.exchange);
    const cat = inferCategoryFromExchange(ex);
    const ok = window.confirm(`티커를 '${ticker || '(비어있음)'}'에서 '${r.ticker}'로 변경하시겠습니까?`);
    if (ok) {
      setTicker(r.ticker);
      setName(r.name);
      setExchange(ex);
      setCategory(cat);
    }
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker || !name) return;

    const updated: WatchlistItem = {
      ...item,
      ticker,
      exchange,
      name,
      category,
      notes: notes || undefined,
    };
    actions.updateWatchItem(updated);
    onClose();
  };

  const handleDelete = () => {
    if (window.confirm(`'${item.name}' 종목을 관심종목에서 삭제하시겠습니까?`)) {
      actions.deleteWatchItem(item.id);
      onClose();
    }
  };

  const inputClasses = "w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition";
  const labelClasses = "block text-sm font-medium text-gray-300 mb-1";

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50" onClick={onClose} role="dialog" aria-modal="true">
      <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-white">관심종목 수정: {item.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelClasses}>자산 구분</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as AssetCategory)} className={inputClasses}>
              {ALLOWED_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClasses}>거래소/시장</label>
              <input value={exchange} readOnly className="w-full bg-gray-600 border border-gray-500 rounded-md py-2 px-3 text-gray-300 cursor-not-allowed" />
            </div>
            <div>
              <label className={labelClasses}>티커 (종목코드)</label>
              <input type="text" value={ticker} onChange={(e) => setTicker(e.target.value)} className={inputClasses} required />
              <div className="mt-2">
                <label className={labelClasses}>티커/종목 검색</label>
                <input type="text" value={searchQuery} onChange={handleSearchChange} placeholder="예: AAPL 또는 회사명" className={inputClasses} />
                {isSearching && <p className="text-xs text-gray-400 mt-1">검색 중...</p>}
                {searchResults.length > 0 && (
                  <ul className="mt-1 bg-gray-700 border border-gray-600 rounded-md max-h-40 overflow-y-auto">
                    {searchResults.map((r) => (
                      <li key={`${r.ticker}-${r.exchange}`} className="px-3 py-2 cursor-pointer hover:bg-gray-600" onMouseDown={() => applySymbol(r)}>
                        <div className="text-white font-semibold">{r.name} ({r.ticker})</div>
                        <div className="text-xs text-gray-300">{r.exchange}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
          <div>
            <label className={labelClasses}>메모</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClasses} rows={2} placeholder="종목에 대한 메모..." />
          </div>

          <div className="mt-8 flex justify-between items-center pt-4">
            <button type="button" onClick={handleDelete} className="bg-danger hover:bg-red-600 text-white font-medium py-2 px-4 rounded-md transition duration-300">
              삭제
            </button>
            <div className="flex space-x-4">
              <button type="button" onClick={onClose} className="bg-gray-600 hover:bg-gray-500 text-white font-medium py-2 px-4 rounded-md transition duration-300">
                취소
              </button>
              <button type="submit" className="bg-primary hover:bg-primary-dark text-white font-bold py-2 px-4 rounded-md transition duration-300">
                저장
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default WatchlistEditModal;
