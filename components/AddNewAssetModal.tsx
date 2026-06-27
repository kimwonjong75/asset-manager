import React, { useState, useEffect, useCallback } from 'react';
import { Currency, SymbolSearchResult, normalizeExchange } from '../types';
import { getAllowedCategories, inferCategoryIdFromExchange, getCategoryBaseType } from '../types/category';
import { BucketId, ALL_BUCKETS, BUCKET_LABELS, BUCKET_DESCRIPTIONS } from '../types/bucket';
import { searchSymbols, validateTicker } from '../services/symbolListService';
import { searchSymbolsAI } from '../services/geminiService';
import { getGeminiApiKey } from '../services/geminiSettings';
import { usePortfolio } from '../contexts/PortfolioContext';
import PositionSizingCalculator from './common/PositionSizingCalculator';

const AddNewAssetModal: React.FC = () => {
  const { modal, actions, status, data, derived } = usePortfolio();
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
  const [searchError, setSearchError] = useState<string | null>(null);
  
  const [quantity, setQuantity] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<number>(2);
  const [exchange, setExchange] = useState<string>('NASDAQ');
  const [currency, setCurrency] = useState<Currency>(Currency.USD);
  const [bucket, setBucket] = useState<BucketId>('CORE');

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
    setBucket('CORE');
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
      setSearchError(null);
      return;
    }

    const handler = setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);
      try {
        const results = await searchSymbols(searchQuery);
        setSearchResults(results);
      } catch (error) {
        setSearchResults([]);
        setSearchError(error instanceof Error ? error.message : '검색 중 오류가 발생했습니다.');
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

  // 키 있을 때만 노출되는 "AI로 더 찾기" — 자연어/별칭 검색을 Gemini로 보강해 기존 결과에 병합
  const handleAiSearch = async () => {
    if (searchQuery.trim().length < 2) return;
    setIsSearching(true);
    setSearchError(null);
    try {
      const aiResults = await searchSymbolsAI(searchQuery);
      setSearchResults(prev => {
        const seen = new Set(prev.map(r => `${r.ticker}-${r.exchange}`));
        return [...prev, ...aiResults.filter(r => !seen.has(`${r.ticker}-${r.exchange}`))];
      });
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'AI 검색 중 오류가 발생했습니다.');
    } finally {
      setIsSearching(false);
    }
  };

  // 검색에 안 나오는 종목(신규상장 등)을 입력한 티커로 직접 추가 (현재 선택한 자산구분/거래소 유지)
  // 잘못된 티커(종목명 입력 등) 방지를 위해 실제 시세 조회로 검증 후에만 확정한다.
  const handleManualAdd = async () => {
    const t = searchQuery.trim().toUpperCase();
    if (!t) return;
    setIsSearching(true);
    setSearchError(null);
    try {
      const isCrypto = getCategoryBaseType(category, categories) === 'CRYPTOCURRENCY';
      const v = await validateTicker(t, exchange, isCrypto);
      if (!v.valid) {
        setSearchError(`'${t}' 시세를 확인할 수 없습니다. 티커가 정확한지, 자산구분이 맞는지 확인해 주세요.`);
        return;
      }
      const isDuplicate = assets.some(
        asset => asset.ticker.toUpperCase() === t &&
                 normalizeExchange(asset.exchange) === normalizeExchange(exchange)
      );
      setDuplicateError(isDuplicate ? '이미 포트폴리오에 존재하는 자산입니다.' : null);
      setTicker(t);
      setSelectedName(v.name || searchQuery.trim());
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
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
      bucket, // 전략 버킷 (코어/투더문)
      name: selectedName || undefined, // [추가] 검색에서 선택한 이름 전달
    });
  };
  
  const inputClasses = "w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition";
  const labelClasses = "block text-sm font-medium text-gray-300 mb-1";
  const hasGeminiKey = !!getGeminiApiKey();
  // 검색어가 2자 이상이고 아직 종목을 확정하지 않은 동안 검색 패널(결과/직접추가/AI) 노출
  const showSearchPanel = isFocused && !ticker && searchQuery.trim().length >= 2;

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
                <label className={labelClasses}>전략 버킷</label>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_BUCKETS.map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setBucket(b)}
                      className={`py-2 px-3 rounded-md border text-sm font-medium transition ${
                        bucket === b
                          ? 'bg-primary border-primary text-white'
                          : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500'
                      }`}
                      title={BUCKET_DESCRIPTIONS[b]}
                    >
                      {BUCKET_LABELS[b]}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">{BUCKET_DESCRIPTIONS[bucket]} · 시세/환율은 자산 구분이 결정하며 버킷은 배분 집계에만 영향.</p>
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
            {searchError && <p className="text-danger text-sm mt-1">{searchError}</p>}
            {isSearching && (
                <div className="absolute top-9 right-3">
                    <svg className="animate-spin h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                </div>
            )}
            {showSearchPanel && (
                <div className="absolute z-10 w-full bg-gray-700 border border-gray-600 rounded-md mt-1 max-h-72 overflow-y-auto shadow-lg">
                {searchResults.length > 0 && (
                    <ul>
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
                {!isSearching && !searchError && searchResults.length === 0 && (
                    <div className="px-3 py-2 text-sm text-gray-400">검색 결과가 없습니다.</div>
                )}
                <div className="border-t border-gray-600">
                    <button type="button" onMouseDown={(e) => { e.preventDefault(); handleManualAdd(); }} disabled={isSearching} className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-primary-dark transition-colors disabled:opacity-50">
                        ✏ '<span className="font-mono">{searchQuery.trim().toUpperCase()}</span>' 티커로 직접 추가
                    </button>
                    {hasGeminiKey && (
                        <button type="button" onMouseDown={(e) => { e.preventDefault(); handleAiSearch(); }} disabled={isSearching} className="w-full text-left px-3 py-2 text-sm text-primary hover:bg-primary-dark transition-colors disabled:opacity-50">
                            ✨ AI로 더 찾기
                        </button>
                    )}
                </div>
                </div>
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

            {/* 리스크 기반 권장 수량 (선택) */}
            <div className="bg-gray-700/40 p-3 rounded-md">
                <div className={`${labelClasses} flex items-center gap-1.5`}>
                    <span>🛡️ 리스크 기반 권장 수량</span>
                    <span className="text-[11px] text-gray-500 font-normal">(위 매수가 기준)</span>
                </div>
                <PositionSizingCalculator
                    totalEquityKRW={derived.totalValue}
                    currency={currency}
                    exchangeRates={data.exchangeRates}
                    entryPrice={parseFloat(purchasePrice) || 0}
                    allowFractional={getCategoryBaseType(category, categories) === 'CRYPTOCURRENCY'}
                    onApplyQuantity={(qty) => setQuantity(String(qty))}
                />
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