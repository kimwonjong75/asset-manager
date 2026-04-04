import React, { useState, useEffect, useCallback } from 'react';
import { Currency, SymbolSearchResult, normalizeExchange } from '../types';
import { getAllowedCategories, inferCategoryIdFromExchange, getCategoryBaseType } from '../types/category';
import { searchSymbols } from '../services/geminiService';
import { usePortfolio } from '../contexts/PortfolioContext';

const AddNewAssetModal: React.FC = () => {
  const { modal, actions, status, data } = usePortfolio();
  const categories = data.categoryStore.categories;
  const isOpen = modal.addAssetOpen;
  const onClose = actions.closeAddAsset;
  const onAddAsset = actions.addAsset as unknown as (asset: any) => void;
  const isLoading = status.isLoading;
  const assets = data.assets;
  const [ticker, setTicker] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  // [추가] 검색에서 선택한 종목명을 별도로 저장
  const [selectedName, setSelectedName] = useState('');
  const [searchResults, setSearchResults] = useState<SymbolSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  
  const [quantity, setQuantity] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<number>(2);
  const [exchange, setExchange] = useState<string>('NASDAQ');
  const [currency, setCurrency] = useState<Currency>(Currency.USD);

  const clearForm = useCallback(() => {
    setTicker('');
    setSearchQuery('');
    setSelectedName(''); // [추가] 초기화
    setQuantity('');
    setPurchasePrice('');
    setSearchResults([]);
    setCategory(2);
    setExchange('NASDAQ');
    setPurchaseDate(new Date().toISOString().slice(0, 10));
    setCurrency(Currency.USD);
    setDuplicateError(null);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      clearForm();
    }
  }, [isOpen, clearForm]);


  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    setSearchQuery(newQuery);
    if (ticker) {
      setTicker('');
      setSelectedName(''); // [추가] 티커 초기화 시 이름도 초기화
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
      } catch (error) {
        console.error("Search failed:", error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => { clearTimeout(handler); };
  }, [searchQuery, ticker]);

  const handleSelectSymbol = (result: SymbolSearchResult) => {
     const isDuplicate = assets.some(
      asset => asset.ticker.toUpperCase() === result.ticker.toUpperCase() &&
               normalizeExchange(asset.exchange) === normalizeExchange(result.exchange)
    );

    if (isDuplicate) {
      setDuplicateError('이미 포트폴리오에 존재하는 자산입니다.');
    } else {
      setDuplicateError(null);
    }
    setSearchResults([]);
    const current = (ticker || '').trim();
    let nextTicker = current;
    if (!current) {
      nextTicker = result.ticker;
    } else {
      const ok = window.confirm(`티커를 '${current}'에서 '${result.ticker}'로 변경하시겠습니까?`);
      if (ok) nextTicker = result.ticker;
    }
    setTicker(nextTicker);
    setSearchQuery(result.name);
    // [핵심 수정] 검색에서 선택한 종목명을 별도로 저장
    setSelectedName(result.name);
    setExchange(normalizeExchange(result.exchange));

    // 거래소에서 자산구분 자동 추론
    const inferredCategoryId = inferCategoryIdFromExchange(normalizeExchange(result.exchange), categories);
    setCategory(inferredCategoryId);
    
    setSearchResults([]);
  };

  useEffect(() => {
    const baseType = getCategoryBaseType(category, categories);
    if (baseType === 'KOREAN_STOCK') setExchange('KRX (코스피/코스닥)');
    else if (baseType === 'US_STOCK') setExchange('NASDAQ');
    else if (baseType === 'CRYPTOCURRENCY') setExchange('주요 거래소 (종합)');
  }, [category, categories]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker) {
      alert('종목 검색을 통해 유효한 자산을 선택해주세요.');
      return;
    }
    if (!quantity || !purchasePrice || !purchaseDate || !exchange || !currency || !category) {
      alert('모든 필드를 입력해주세요.');
      return;
    }
    const isDuplicateSubmit = assets.some(
      asset => asset.ticker.toUpperCase() === ticker.toUpperCase() &&
               normalizeExchange(asset.exchange) === normalizeExchange(exchange)
    );
    if (isDuplicateSubmit) {
      alert('이미 포트폴리오에 존재하는 자산입니다.');
      return;
    }
    // [핵심 수정] selectedName을 name으로 전달
    onAddAsset({
      ticker,
      quantity: parseFloat(quantity),
      purchasePrice: parseFloat(purchasePrice),
      purchaseDate,
      categoryId: category,
      exchange,
      currency,
      name: selectedName || undefined, // [추가] 검색에서 선택한 이름 전달
    });
  };
  
  const inputClasses = "w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition";
  const labelClasses = "block text-sm font-medium text-gray-300 mb-1";
  const showResults = isFocused && searchResults.length > 0;

  if (!isOpen) return null;

  return (
     <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="bg-gray-800 p-4 sm:p-6 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4 sm:mb-6">
            <h2 className="text-xl sm:text-2xl font-bold text-white">신규 자산 추가</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label htmlFor="category" className={labelClasses}>자산 구분</label>
                <select 
                  id="category" 
                  value={category} 
                  onChange={(e) => setCategory(Number(e.target.value))}
                  className={inputClasses} 
                  title="자산의 구분을 선택하세요. 거래소 선택 시 자동으로 설정되며 수동으로 변경할 수 있습니다."
                >
                  {getAllowedCategories(categories).map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
            </div>
            <div>
                <label className={labelClasses}>거래소/시장</label>
                <input value={exchange} readOnly className="w-full bg-gray-600 border border-gray-500 rounded-md py-2 px-3 text-gray-300 cursor-not-allowed" title="자산구분 또는 종목 검색에 따라 자동으로 결정됩니다." />
            </div>
            
            <div className="relative">
            <label htmlFor="ticker-search" className={labelClasses}>티커 (종목 검색)</label>
            <input 
                id="ticker-search" 
                type="text" 
                value={searchQuery} 
                onChange={handleSearchChange} 
                onFocus={() => setIsFocused(true)}
                onBlur={() => setTimeout(() => setIsFocused(false), 150)} // Delay to allow click on results
                placeholder="예: Apple, 삼성전자"
                className={inputClasses}
                required 
                autoComplete="off"
                title="자산의 이름 또는 티커를 입력하여 검색하세요."
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
                    role="option"
                    aria-selected="false"
                    >
                    <div className="font-bold text-white">{result.name} ({result.ticker})</div>
                    <div className="text-sm text-gray-400">{result.exchange}</div>
                    </li>
                ))}
                </ul>
            )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
                <label htmlFor="quantity" className={labelClasses}>수량</label>
                <input id="quantity" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="10" className={inputClasses} required min="0" step="any" title="보유하고 있는 자산의 수량을 입력하세요."/>
            </div>
            <div>
                <label htmlFor="purchasePrice" className={labelClasses}>매수가</label>
                <input id="purchasePrice" type="number" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} placeholder="150.00" className={inputClasses} required min="0" step="any" title="자산을 매수한 평균 단가를 선택한 통화 기준으로 입력하세요." />
            </div>
            <div>
                <label htmlFor="currency" className={labelClasses}>통화</label>
                <select id="currency" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} className={inputClasses} title="매수 가격의 통화 단위를 선택하세요.">
                    {Object.values(Currency).map((cur) => (
                    <option key={cur} value={cur}>{cur}</option>
                    ))}
                </select>
            </div>
            </div>
            <div>
            <label htmlFor="purchaseDate" className={labelClasses}>매수/보유 시작일</label>
            <input id="purchaseDate" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className={inputClasses} required title="자산을 매수했거나 보유하기 시작한 날짜를 선택하세요."/>
            </div>
            <div className="pt-4 flex justify-end">
                <button type="submit" disabled={isLoading || !!duplicateError} className="w-full bg-primary hover:bg-primary-dark text-white font-bold py-2.5 px-4 rounded-md disabled:bg-gray-600 disabled:cursor-not-allowed transition duration-300 flex items-center justify-center" title="입력한 정보로 새 자산을 포트폴리오에 추가합니다.">
                {isLoading ? (
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                ) : '자산 추가'}
                </button>
            </div>
        </form>
      </div>
    </div>
  );
};

export default AddNewAssetModal;