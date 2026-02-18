import React, { useState, useEffect, useCallback } from 'react';
import { AssetCategory, SymbolSearchResult, ALLOWED_CATEGORIES, inferCategoryFromExchange, normalizeExchange } from '../types';
import { searchSymbols } from '../services/geminiService';
import { usePortfolio } from '../contexts/PortfolioContext';

const WatchlistAddModal: React.FC = () => {
  const { modal, actions, data } = usePortfolio();
  const isOpen = modal.addWatchItemOpen;
  const onClose = actions.closeAddWatchItem;

  const [ticker, setTicker] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedName, setSelectedName] = useState('');
  const [searchResults, setSearchResults] = useState<SymbolSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  const [category, setCategory] = useState<AssetCategory>(AssetCategory.US_STOCK);
  const [exchange, setExchange] = useState<string>('NASDAQ');
  const [notes, setNotes] = useState('');

  const clearForm = useCallback(() => {
    setTicker('');
    setSearchQuery('');
    setSelectedName('');
    setSearchResults([]);
    setCategory(AssetCategory.US_STOCK);
    setExchange('NASDAQ');
    setNotes('');
    setDuplicateError(null);
  }, []);

  useEffect(() => {
    if (!isOpen) clearForm();
  }, [isOpen, clearForm]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    setSearchQuery(newQuery);
    if (ticker) {
      setTicker('');
      setSelectedName('');
    }
    setDuplicateError(null);
  }, [ticker]);

  useEffect(() => {
    if (searchQuery.length < 2 || searchQuery === ticker) {
      setSearchResults([]);
      return;
    }
    const handler = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchSymbols(searchQuery);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery, ticker]);

  const handleSelectSymbol = (result: SymbolSearchResult) => {
    const isDuplicate = data.watchlist.some(
      w => w.ticker.toUpperCase() === result.ticker.toUpperCase() &&
           normalizeExchange(w.exchange) === normalizeExchange(result.exchange)
    );
    setDuplicateError(isDuplicate ? '이미 관심종목에 존재하는 종목입니다.' : null);
    setTicker(result.ticker);
    setSearchQuery(result.name);
    setSelectedName(result.name);
    const ex = normalizeExchange(result.exchange);
    setExchange(ex);
    setCategory(inferCategoryFromExchange(ex));
    setSearchResults([]);
  };

  useEffect(() => {
    if (category === AssetCategory.KOREAN_STOCK) setExchange('KRX (코스피/코스닥)');
    else if (category === AssetCategory.US_STOCK) setExchange('NASDAQ');
    else if (category === AssetCategory.CRYPTOCURRENCY) setExchange('주요 거래소 (종합)');
  }, [category]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker) {
      alert('종목 검색을 통해 유효한 종목을 선택해주세요.');
      return;
    }
    if (duplicateError) return;

    actions.addWatchItem({
      ticker,
      exchange,
      name: selectedName || ticker,
      category,
      notes: notes || undefined,
    });
    onClose();
  };

  const inputClasses = "w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition";
  const labelClasses = "block text-sm font-medium text-gray-300 mb-1";
  const showResults = isFocused && searchResults.length > 0;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50" onClick={onClose} role="dialog" aria-modal="true">
      <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-white">관심종목 추가</h2>
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
          <div>
            <label className={labelClasses}>거래소/시장</label>
            <input value={exchange} readOnly className="w-full bg-gray-600 border border-gray-500 rounded-md py-2 px-3 text-gray-300 cursor-not-allowed" />
          </div>
          <div className="relative">
            <label className={labelClasses}>종목 검색</label>
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setTimeout(() => setIsFocused(false), 150)}
              placeholder="예: Apple, 삼성전자"
              className={inputClasses}
              autoComplete="off"
            />
            {duplicateError && <p className="text-danger text-sm mt-1">{duplicateError}</p>}
            {isSearching && (
              <div className="absolute top-9 right-3">
                <svg className="animate-spin h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            )}
            {showResults && (
              <ul className="absolute z-10 w-full bg-gray-700 border border-gray-600 rounded-md mt-1 max-h-60 overflow-y-auto shadow-lg">
                {searchResults.map((result) => (
                  <li
                    key={`${result.ticker}-${result.exchange}`}
                    onMouseDown={() => handleSelectSymbol(result)}
                    className="px-3 py-2 cursor-pointer hover:bg-primary-dark transition-colors"
                  >
                    <div className="font-bold text-white">{result.name} ({result.ticker})</div>
                    <div className="text-sm text-gray-400">{result.exchange}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <label className={labelClasses}>메모</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClasses} rows={2} placeholder="종목에 대한 메모..." />
          </div>
          <div className="pt-4 flex justify-end">
            <button type="submit" disabled={!!duplicateError} className="w-full bg-primary hover:bg-primary-dark text-white font-bold py-2.5 px-4 rounded-md disabled:bg-gray-600 disabled:cursor-not-allowed transition duration-300">
              종목 추가
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default WatchlistAddModal;
