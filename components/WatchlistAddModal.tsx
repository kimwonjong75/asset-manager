import React, { useState, useEffect, useCallback, useId } from 'react';
import { SymbolSearchResult, normalizeExchange } from '../types';
import { getAllowedCategories, inferCategoryIdFromExchange, getCategoryBaseType } from '../types/category';
import { searchSymbols, validateTicker } from '../services/symbolListService';
import { searchSymbolsAI } from '../services/geminiService';
import { getGeminiApiKey } from '../services/geminiSettings';
import { usePortfolio } from '../contexts/PortfolioContext';
import Modal from './common/Modal';
import Button from './common/Button';
import Combobox, { type ComboboxAction } from './common/Combobox';
import FieldError from './common/FieldError';
import { Loader2, Pencil, Sparkles } from 'lucide-react';

const WatchlistAddModal: React.FC = () => {
  const { modal, actions, data } = usePortfolio();
  const categories = data.categoryStore.categories;
  const isOpen = modal.addWatchItemOpen;
  const onClose = actions.closeAddWatchItem;

  const [ticker, setTicker] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedName, setSelectedName] = useState('');
  const [searchResults, setSearchResults] = useState<SymbolSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [category, setCategory] = useState<number>(2);
  const [exchange, setExchange] = useState<string>('NASDAQ');
  const [notes, setNotes] = useState('');
  // 제출 시도 후에만 인라인 검증 문구 노출(브라우저 alert 대체 — RULES.md §7)
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // 검색 입력칸 id + 인라인 오류 문구 id(FieldError ↔ aria-describedby)
  const searchInputId = useId();
  const noTickerErrorId = useId();
  const duplicateErrorId = useId();
  const searchErrorId = useId();

  const clearForm = useCallback(() => {
    setTicker('');
    setSearchQuery('');
    setSelectedName('');
    setSearchResults([]);
    setCategory(2);
    setExchange('NASDAQ');
    setNotes('');
    setDuplicateError(null);
    setSubmitAttempted(false);
  }, []);

  useEffect(() => {
    if (!isOpen) clearForm();
  }, [isOpen, clearForm]);

  const handleSearchChange = useCallback((newQuery: string) => {
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
    setCategory(inferCategoryIdFromExchange(ex, categories));
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

  // 검색에 안 나오는 종목을 입력한 티커로 직접 추가 (현재 선택한 자산구분/거래소 유지)
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
      const isDuplicate = data.watchlist.some(
        w => w.ticker.toUpperCase() === t &&
             normalizeExchange(w.exchange) === normalizeExchange(exchange)
      );
      setDuplicateError(isDuplicate ? '이미 관심종목에 존재하는 종목입니다.' : null);
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
      setSubmitAttempted(true);
      return;
    }
    if (duplicateError) return;

    actions.addWatchItem({
      ticker,
      exchange,
      name: selectedName || ticker,
      categoryId: category,
      notes: notes || undefined,
    });
    onClose();
  };

  const inputClasses = "w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition";
  const labelClasses = "block text-sm font-medium text-gray-300 mb-1";
  const hasGeminiKey = !!getGeminiApiKey();
  // 검색어 2자 이상 && 종목 미확정 동안 검색 패널 노출. 포커스 조건은 Combobox 가 소유(onBlur 150ms 지연 해킹 제거).
  const searchPanelOpen = !ticker && searchQuery.trim().length >= 2;
  const searchActions: ComboboxAction[] = [
    {
      key: 'manual-add',
      icon: <Pencil />,
      label: <>'<span className="font-mono">{searchQuery.trim().toUpperCase()}</span>' 티커로 직접 추가</>,
      onSelect: () => { void handleManualAdd(); },
      disabled: isSearching,
    },
    ...(hasGeminiKey
      ? [{
          key: 'ai-search',
          icon: <Sparkles className="text-primary" />,
          label: <span className="text-primary">AI로 더 찾기</span>,
          onSelect: () => { void handleAiSearch(); },
          disabled: isSearching,
        }]
      : []),
  ];

  // 인라인 오류 ↔ 입력칸 접근성 연결(오류일 때만 aria-invalid, 문구가 보이는 동안만 describedby)
  const showNoTickerError = submitAttempted && !ticker;
  const searchDescribedBy = [
    showNoTickerError ? noTickerErrorId : null,
    duplicateError ? duplicateErrorId : null,
    searchError ? searchErrorId : null,
  ].filter(Boolean).join(' ') || undefined;

  if (!isOpen) return null;

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="관심종목 추가"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button type="submit" form="watchlist-add-form" variant="primary" disabled={!!duplicateError}>종목 추가</Button>
        </>
      }
    >
        <form id="watchlist-add-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelClasses}>자산 구분</label>
            <select value={category} onChange={(e) => setCategory(Number(e.target.value))} className={inputClasses}>
              {getAllowedCategories(categories).map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClasses}>거래소/시장</label>
            <input value={exchange} readOnly className="w-full bg-gray-600 border border-gray-500 rounded-md py-2 px-3 text-gray-300 cursor-not-allowed" />
          </div>
          <div>
            <label htmlFor={searchInputId} className={labelClasses}>종목 검색</label>
            <Combobox<SymbolSearchResult>
              inputId={searchInputId}
              inputValue={searchQuery}
              onInputChange={handleSearchChange}
              placeholder="예: Apple, 삼성전자"
              aria-invalid={showNoTickerError || !!duplicateError ? true : undefined}
              aria-describedby={searchDescribedBy}
              endAdornment={isSearching ? <Loader2 className="animate-spin h-5 w-5 text-gray-400" aria-hidden="true" /> : undefined}
              options={searchResults}
              getOptionKey={(result) => `${result.ticker}-${result.exchange}`}
              renderOption={(result) => (
                <>
                  <div className="font-bold text-white">{result.name} ({result.ticker})</div>
                  <div className="text-sm text-gray-400">{result.exchange}</div>
                </>
              )}
              onSelect={handleSelectSymbol}
              open={searchPanelOpen}
              // 목록이 입력칸 바로 아래에 겹쳐 열려 아래 FieldError 를 가리므로, 검색 오류는 목록 안에도 보여 준다
              error={searchError}
              emptyText={!isSearching ? '검색 결과가 없습니다.' : undefined}
              actions={searchActions}
              listboxLabel="종목 검색 결과"
            />
            {showNoTickerError && <FieldError id={noTickerErrorId} className="mt-1">종목 검색을 통해 유효한 종목을 선택해주세요.</FieldError>}
            {duplicateError && <FieldError id={duplicateErrorId} className="mt-1">{duplicateError}</FieldError>}
            {searchError && <FieldError id={searchErrorId} className="mt-1">{searchError}</FieldError>}
          </div>
          <div>
            <label className={labelClasses}>메모</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClasses} rows={2} placeholder="종목에 대한 메모..." />
          </div>
        </form>
    </Modal>
  );
};

export default WatchlistAddModal;
