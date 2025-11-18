import React, { useState, useEffect, useCallback } from 'react';
import { Asset, AssetCategory, AssetRegion, NewAssetForm, EXCHANGE_MAP, REGION_EXCHANGE_MAP, REGION_TO_CATEGORY, Currency, SymbolSearchResult } from '../types';
import { searchSymbols } from '../services/geminiService';

interface AddNewAssetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddAsset: (asset: NewAssetForm) => void;
  isLoading: boolean;
  assets: Asset[];
}

const AddNewAssetModal: React.FC<AddNewAssetModalProps> = ({ isOpen, onClose, onAddAsset, isLoading, assets }) => {
  const [ticker, setTicker] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SymbolSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  
  const [quantity, setQuantity] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [region, setRegion] = useState<AssetRegion>(AssetRegion.USA);
  const [category, setCategory] = useState<AssetCategory>(AssetCategory.US_STOCK);
  const [exchange, setExchange] = useState<string>(REGION_EXCHANGE_MAP[AssetRegion.USA][0] || '');
  const [currency, setCurrency] = useState<Currency>(Currency.USD);
  const [isCashCategory, setIsCashCategory] = useState(false);

  const clearForm = useCallback(() => {
    setTicker('');
    setSearchQuery('');
    setQuantity('');
    setPurchasePrice('');
    setSearchResults([]);
    setRegion(AssetRegion.USA);
    setCategory(AssetCategory.US_STOCK);
    setPurchaseDate(new Date().toISOString().slice(0, 10));
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
    }
    setDuplicateError(null);
  }, [ticker]);

  useEffect(() => {
    if (isCashCategory || searchQuery.length < 2 || searchQuery === ticker) {
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
  }, [searchQuery, ticker, isCashCategory]);

  // 지역 변경 시 카테고리와 거래소 자동 설정
  useEffect(() => {
    const newCategory = REGION_TO_CATEGORY[region];
    setCategory(newCategory);
    
    const exchangesForRegion = REGION_EXCHANGE_MAP[region] || [];
    if (!exchangesForRegion.includes(exchange)) {
      setExchange(exchangesForRegion[0] || '');
    }
    
    // 지역에 따른 통화 자동 설정
    switch(region) {
        case AssetRegion.KOREA:
            setCurrency(Currency.KRW);
            break;
        case AssetRegion.USA:
            setCurrency(Currency.USD);
            break;
        case AssetRegion.JAPAN:
            setCurrency(Currency.JPY);
            break;
        case AssetRegion.CHINA:
            setCurrency(Currency.CNY);
            break;
        case AssetRegion.GOLD:
        case AssetRegion.COMMODITIES:
            setCurrency(Currency.USD); // 기본값, 변경 가능
            break;
        case AssetRegion.CRYPTOCURRENCY:
            setCurrency(Currency.USD);
            break;
        case AssetRegion.CASH:
            setCurrency(Currency.KRW); // 기본값
            break;
        default:
            break;
    }
  }, [region, exchange]);

  useEffect(() => {
    const isCash = region === AssetRegion.CASH;
    setIsCashCategory(isCash);

    if (isCash) {
      setTicker(currency);
      setExchange('현금');
      setPurchasePrice('1');
      setSearchQuery(`현금 (${currency})`);
      setDuplicateError(null);
    } else {
      setPurchasePrice('');
      if (ticker === currency) { // if switching from cash, clear ticker
          setTicker('');
          setSearchQuery('');
      }
    }
  }, [region, currency, ticker]);

  const handleSelectSymbol = (result: SymbolSearchResult) => {
     const isDuplicate = assets.some(
      asset => asset.ticker.toUpperCase() === result.ticker.toUpperCase() &&
               asset.exchange === result.exchange
    );

    if (isDuplicate) {
      setDuplicateError('이미 포트폴리오에 존재하는 자산입니다.');
      setSearchResults([]);
      return;
    }

    setDuplicateError(null);
    setTicker(result.ticker);
    setSearchQuery(result.name);
    setExchange(result.exchange);

    // 거래소로부터 지역 찾기
    let foundRegion: AssetRegion | null = null;
    for (const reg in REGION_EXCHANGE_MAP) {
      if (REGION_EXCHANGE_MAP[reg as AssetRegion].includes(result.exchange)) {
        foundRegion = reg as AssetRegion;
        break;
      }
    }
    
    if (foundRegion) {
      setRegion(foundRegion);
    }
    setSearchResults([]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCashCategory && !ticker) {
      alert('종목 검색을 통해 유효한 자산을 선택해주세요.');
      return;
    }
    if (!quantity || !purchasePrice || !purchaseDate || !exchange || !currency) {
      alert('모든 필드를 입력해주세요.');
      return;
    }
    onAddAsset({
      ticker: isCashCategory ? currency : ticker,
      quantity: parseFloat(quantity),
      purchasePrice: parseFloat(purchasePrice),
      purchaseDate,
      category,
      region,
      exchange,
      currency
    });
  };
  
  const inputClasses = "w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition";
  const labelClasses = "block text-sm font-medium text-gray-300 mb-1";
  const exchangesForRegion = REGION_EXCHANGE_MAP[region] || [];
  const showResults = isFocused && searchResults.length > 0 && !isCashCategory;

  if (!isOpen) return null;

  return (
     <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50" onClick={onClose} role="dialog" aria-modal="true">
      <div className="bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-white">신규 자산 추가</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label htmlFor="region" className={labelClasses}>자산 구분 (지역/상품)</label>
                <select id="region" value={region} onChange={(e) => setRegion(e.target.value as AssetRegion)} className={inputClasses} title="퀀트 전략 분석을 위한 자산 지역/상품 구분을 선택하세요.">
                {Object.values(AssetRegion).map((reg) => (
                    <option key={reg} value={reg}>{reg}</option>
                ))}
                </select>
            </div>
            <div>
                <label htmlFor="exchange" className={labelClasses}>거래소/시장</label>
                <select id="exchange" value={exchange} onChange={(e) => setExchange(e.target.value)} className={inputClasses} title="자산이 거래되는 시장을 선택하세요." disabled={exchangesForRegion.length === 0 || isCashCategory}>
                {exchangesForRegion.map((ex) => (
                    <option key={ex} value={ex}>{ex}</option>
                ))}
                </select>
            </div>
            
            <div className="relative">
            <label htmlFor="ticker-search" className={labelClasses}>{isCashCategory ? '자산명' : '티커 (종목 검색)'}</label>
            <input 
                id="ticker-search" 
                type="text" 
                value={searchQuery} 
                onChange={handleSearchChange} 
                onFocus={() => setIsFocused(true)}
                onBlur={() => setTimeout(() => setIsFocused(false), 150)} // Delay to allow click on results
                placeholder={isCashCategory ? '' : "예: Apple, 삼성전자"}
                className={`${inputClasses} ${isCashCategory ? 'bg-gray-600' : ''}`} 
                required 
                autoComplete="off"
                title={isCashCategory ? '현금 자산은 통화로 이름이 자동 지정됩니다.' : "자산의 이름 또는 티커를 입력하여 검색하세요."}
                disabled={isCashCategory}
            />
            {duplicateError && <p className="text-danger text-sm mt-1">{duplicateError}</p>}
            {isSearching && (
                <div className="absolute top-9 right-3">
                    <svg className="animate-spin h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8_0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
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

            <div className="grid grid-cols-3 gap-4">
            <div>
                <label htmlFor="quantity" className={labelClasses}>{isCashCategory ? '금액' : '수량'}</label>
                <input id="quantity" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder={isCashCategory ? '1000' : '10'} className={inputClasses} required min="0" step="any" title={isCashCategory ? '보유하고 있는 현금의 금액을 입력하세요.' : '보유하고 있는 자산의 수량을 입력하세요.'}/>
            </div>
            <div>
                <label htmlFor="purchasePrice" className={labelClasses}>{isCashCategory ? '단가' : '매수가'}</label>
                <input id="purchasePrice" type="number" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} placeholder="150.00" className={`${inputClasses} ${isCashCategory ? 'bg-gray-600' : ''}`} required min="0" step="any" title="자산을 매수한 평균 단가를 선택한 통화 기준으로 입력하세요." disabled={isCashCategory} />
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
                <button type="submit" disabled={isLoading} className="w-full bg-primary hover:bg-primary-dark text-white font-bold py-2.5 px-4 rounded-md disabled:bg-gray-600 disabled:cursor-not-allowed transition duration-300 flex items-center justify-center" title="입력한 정보로 새 자산을 포트폴리오에 추가합니다.">
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