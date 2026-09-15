import React, { useState, useEffect, useCallback, useRef, useId } from 'react';
import { Asset, Currency, SymbolSearchResult, normalizeExchange } from '../types';
import { getAllowedCategories, inferCategoryIdFromExchange, getCategoryBaseType, getCategoryName } from '../types/category';
import { BucketId, ALL_BUCKETS, BUCKET_LABELS, BUCKET_DESCRIPTIONS } from '../types/bucket';
import { OwnerId, ALL_OWNERS, OWNER_LABELS, OWNER_DESCRIPTIONS, getAssetOwner } from '../types/owner';
import { searchSymbols, validateTicker, clearSymbolIndexCache, loadSymbolList } from '../services/symbolListService';
import { searchSymbolsAI } from '../services/geminiService';
import { getGeminiApiKey } from '../services/geminiSettings';
import { usePortfolio } from '../contexts/PortfolioContext';
import { useConfirm } from '../hooks/useConfirm';
import ConfirmDialog from './common/ConfirmDialog';
import Modal from './common/Modal';
import Button from './common/Button';
import Combobox, { type ComboboxAction } from './common/Combobox';
import FieldError from './common/FieldError';
import { ClipboardList, Loader2, Pencil, RefreshCw, Shield, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import PositionSizingCalculator from './common/PositionSizingCalculator';
import TradePlanEditor, { type TradePlanEditorHandle } from './trade-plan/TradePlanEditor';
import { buildTradePlan } from '../utils/tradePlan';
import { defaultEditorInput, fxRateToKRWFor } from '../utils/tradePlanMarket';
import { transferWatchPlanToAsset, findWatchItemForAsset } from '../utils/tradePlanTransfer';
import { DEFAULT_TRADE_PLAN_TEMPLATE, type TradePlan } from '../types/tradePlan';

const AddNewAssetModal: React.FC = () => {
  const { modal, actions, status, data, derived } = usePortfolio();
  const categories = data.categoryStore.categories;
  const isOpen = modal.addAssetOpen;
  const onClose = actions.closeAddAsset;
  const onAddAsset = actions.addAsset;
  const isLoading = status.isLoading;
  const assets = data.assets;
  const { confirm, confirmRequest } = useConfirm();
  const [ticker, setTicker] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  // [추가] 검색에서 선택한 종목명을 별도로 저장
  const [selectedName, setSelectedName] = useState('');
  const [searchResults, setSearchResults] = useState<SymbolSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  // 목록 프리페치가 '체감될 만큼' 오래 걸리는 중인지 — 안내 문구 노출 + 오해 유발 '결과 없음' 억제용
  const [isListLoading, setIsListLoading] = useState(false);
  
  const [quantity, setQuantity] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<number>(2);
  const [exchange, setExchange] = useState<string>('NASDAQ');
  const [currency, setCurrency] = useState<Currency>(Currency.USD);
  const [bucket, setBucket] = useState<BucketId>('CORE');
  const [owner, setOwner] = useState<OwnerId>('WONJONG');
  // 투더문 선택 시 자산 구분은 자동 인식 값으로 접어둠(배분에 미사용) — '변경'으로 펼쳐 수정 가능
  const [showCategoryDetail, setShowCategoryDetail] = useState(false);
  // 제출 시도 후에만 인라인 검증 문구를 보인다(브라우저 alert 대체 — RULES.md §7 사용자 알림)
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // 매매 계획 이 계획으로 저장(P2a) — 기본 ON. "자세히"를 열면 전체 편집기(embedded)로 커스터마이즈.
  const [saveTradePlanOnAdd, setSaveTradePlanOnAdd] = useState(true);
  const [showTradePlanDetail, setShowTradePlanDetail] = useState(false);
  const tradePlanEditorRef = useRef<TradePlanEditorHandle>(null);
  // 인라인 오류 문구 id(FieldError ↔ aria-describedby)
  const tickerErrorId = useId();
  const duplicateErrorId = useId();
  const searchErrorId = useId();
  const fieldsErrorId = useId();

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
    setOwner('WONJONG');
    setShowCategoryDetail(false);
    setDuplicateError(null);
    setSubmitAttempted(false);
    setSaveTradePlanOnAdd(true);
    setShowTradePlanDetail(false);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      clearForm();
    }
  }, [isOpen, clearForm]);

  // 플래너 프리필(P2c, TradePlanPlanner "지금 매수 기록하며 저장") 소비 — "렌더 중 조정" 패턴
  // (TradePlanBulkWizard와 동일 관례). effect+setState 대신 렌더 중 prop 비교라
  // react-hooks/set-state-in-effect 위반이 아니다(이 파일은 기존 위반 5건이 기준선 — 새로 늘리지 않는다).
  // 닫힘 시 clearForm이 필드를 초기화하고, modal.addAssetPrefill 자체는 closeAddAsset이 지운다.
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen && modal.addAssetPrefill) {
      const p = modal.addAssetPrefill;
      setTicker(p.ticker);
      setSearchQuery(p.name);
      setSelectedName(p.name);
      setExchange(p.exchange);
      if (p.currency) setCurrency(p.currency);
      if (p.categoryId !== undefined) setCategory(p.categoryId);
      if (p.quantity !== undefined) setQuantity(String(p.quantity));
      if (p.purchasePrice !== undefined) setPurchasePrice(String(p.purchasePrice));
    }
  }

  // 모달이 열리는 순간 종목 목록(약 1.3MB, 백엔드 gzip 미적용)을 미리 받아 둔다.
  // 사용자가 거래소/수량을 고르고 2글자 이상 입력하는 동안 다운로드가 겹쳐 첫 검색의 체감 대기가 사라진다.
  // 캐시(메모리/localStorage)가 있으면 네트워크를 타지 않고 즉시 끝난다(loadSymbolList가 inflight 공유·중복 fetch 방지).
  // 실패는 여기서 무시 — 실제 검색 시 searchError로 사유를 표시한다.
  useEffect(() => {
    if (!isOpen) { setIsListLoading(false); return; }

    let alive = true;
    // 400ms 넘게 걸릴 때만 안내를 띄운다(캐시 히트 시 문구가 번쩍이지 않도록).
    const hintTimer = setTimeout(() => { if (alive) setIsListLoading(true); }, 400);

    loadSymbolList()
      .catch(() => { /* 사유 표시는 검색 경로에서 */ })
      .finally(() => {
        if (!alive) return;
        clearTimeout(hintTimer);
        setIsListLoading(false);
      });

    return () => { alive = false; clearTimeout(hintTimer); };
  }, [isOpen]);

  const handleSearchChange = useCallback((newQuery: string) => {
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

  const handleSelectSymbol = async (result: SymbolSearchResult) => {
    // 중복 검사는 계정(owner)까지 반영해 아래 useEffect가 처리 — 여기서는 티커/거래소만 확정
    setSearchResults([]);
    const current = (ticker || '').trim();
    let nextTicker = current;
    // 참고: 검색 목록은 티커 미확정(!ticker)일 때만 열리므로 선택 시점의 current 는 사실상 항상 빈 값이다.
    // 아래 confirm 분기는 사실상 도달하지 않지만 기존 동작 보존을 위해 남겨 둔다(Stage D2).
    if (!current) {
      nextTicker = result.ticker;
    } else {
      const ok = await confirm(`티커를 '${current}'에서 '${result.ticker}'로 변경하시겠습니까?`);
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

  // 목록 캐시(24h TTL)가 오래됐거나(신규상장 미포함) 서버 오류로 못 받았을 때의 수동 복구.
  // 캐시를 비우고 서버에서 다시 받아 같은 쿼리로 재검색한다.
  const handleReloadSymbols = async () => {
    clearSymbolIndexCache();
    setIsSearching(true);
    setIsListLoading(true); // 캐시를 비웠으므로 반드시 네트워크 — 안내를 바로 띄운다
    setSearchError(null);
    try {
      const results = await searchSymbols(searchQuery);
      setSearchResults(results);
    } catch (error) {
      setSearchResults([]);
      setSearchError(error instanceof Error ? error.message : '검색 중 오류가 발생했습니다.');
    } finally {
      setIsSearching(false);
      setIsListLoading(false);
    }
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
      // 중복 검사는 계정(owner)까지 반영해 아래 useEffect가 처리
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

  // 중복 검사는 계정(owner)까지 함께 봄 — 같은 종목이라도 원종/유선처럼 계정이 다르면 중복 아님(각자 별도 보유).
  // ticker/exchange/owner 중 하나라도 바뀌면 재평가(선택 후 계정을 바꿔도 최신 상태 반영).
  useEffect(() => {
    if (!ticker) { setDuplicateError(null); return; }
    const isDuplicate = assets.some(
      asset => asset.ticker.toUpperCase() === ticker.toUpperCase() &&
               normalizeExchange(asset.exchange) === normalizeExchange(exchange) &&
               getAssetOwner(asset) === owner
    );
    setDuplicateError(isDuplicate ? `이미 ${OWNER_LABELS[owner]} 계정에 존재하는 자산입니다.` : null);
  }, [ticker, exchange, owner, assets]);

  const tickerError = !ticker ? '종목 검색을 통해 유효한 자산을 선택해주세요.' : null;
  const fieldsError = (!quantity || !purchasePrice || !purchaseDate || !exchange || !currency || !category)
    ? '모든 필드를 입력해주세요.'
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // 검증 실패 → 인라인 문구(티커 칸 아래·버튼 위)로 보여주고 중단. 중복은 duplicateError 가 즉시 표시.
    if (tickerError || fieldsError || duplicateError) {
      setSubmitAttempted(true);
      return;
    }
    const isDuplicateSubmit = assets.some(
      asset => asset.ticker.toUpperCase() === ticker.toUpperCase() &&
               normalizeExchange(asset.exchange) === normalizeExchange(exchange) &&
               getAssetOwner(asset) === owner
    );
    if (isDuplicateSubmit) {
      setDuplicateError(`이미 ${OWNER_LABELS[owner]} 계정에 존재하는 자산입니다.`);
      return;
    }
    // [핵심 수정] selectedName을 name으로 전달
    // P2a: 자산 추가 결과(AddAssetResult)를 받아 성공 시에만 매매 계획을 별도 커밋한다(자산 추가 로직 무변경).
    const result = await onAddAsset({
      ticker,
      quantity: parseFloat(quantity),
      purchasePrice: parseFloat(purchasePrice),
      purchaseDate,
      categoryId: category,
      exchange,
      currency,
      bucket, // 전략 버킷 (코어/투더문)
      owner, // 계정 (원종/유선)
      name: selectedName || undefined, // [추가] 검색에서 선택한 이름 전달
    });

    // 매매 계획 저장 — 자산 추가 성공 후 별도 커밋(자산 추가 로직 자체는 변경하지 않음, P2a/P2c).
    if (result.ok) {
      // 우선순위 1(P2c): 매칭되는 관심종목에 활성 "매수 전 계획"이 있으면 체크박스와 무관하게
      // 그 계획을 그대로 이전한다 — 이미 세워둔 계획을 실제 매수 순간 자산으로 넘기는 것이
      // 매수 전 계획 기능의 핵심 약속이다(계획서 §3.1).
      const matchedWatch = findWatchItemForAsset(data.watchlist, result.asset);
      const hasActiveWatchPlan = !!(matchedWatch?.tradePlan && matchedWatch.tradePlan.status === 'active');

      if (hasActiveWatchPlan) {
        actions.adoptWatchPlanForAsset(result.assetId);
      } else if (saveTradePlanOnAdd) {
        let plan: TradePlan | null = null;
        if (modal.addAssetPrefill?.plan) {
          // 우선순위 2(P2c): 플래너 [지금 매수 기록하며 저장] — 이미 만든 계획을 실제 체결값
          // (purchasePrice/quantity)으로 재구축한다(기본 템플릿 대신 이 계획을 쓴다).
          plan = transferWatchPlanToAsset(modal.addAssetPrefill.plan, result.asset, {
            fxRateToKRW: fxRateToKRWFor(result.asset.currency, data.exchangeRates),
            now: new Date().toISOString(),
            totalEquityKRW: derived.totalValue,
          });
        } else if (showTradePlanDetail && tradePlanEditorRef.current) {
          const r = tradePlanEditorRef.current.getResult();
          if (r.ok) plan = r.plan;
        } else {
          const input = defaultEditorInput(
            { kind: 'asset', asset: result.asset },
            // 신규 매수는 실제 매수가가 기준가(강의: 매수 전 계획) — 시세 재조회값(priceOriginal)이 아니라 purchasePrice
            { totalEquityKRW: derived.totalValue, rates: data.exchangeRates, enriched: undefined, now: new Date().toISOString(), anchor: 'purchase' },
          );
          const r = buildTradePlan(input);
          if (r.ok) plan = r.plan;
        }
        if (plan) actions.saveTradePlan(result.assetId, plan);
      }
    }
  };
  
  // P2c: 검색 중인 종목이 관심종목에 활성 "매수 전 계획"을 갖고 있으면 체크박스 대신 안내만 보여준다
  // (아래 handleSubmit에서 체크박스와 무관하게 그 계획을 그대로 이전하므로 — adoptWatchPlanForAsset).
  const matchedWatchItem = ticker ? findWatchItemForAsset(data.watchlist, { ticker, exchange }) : undefined;
  const hasMatchedWatchPlan = !!(matchedWatchItem?.tradePlan && matchedWatchItem.tradePlan.status === 'active');

  const inputClasses = "w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition";
  const labelClasses = "block text-sm font-medium text-gray-300 mb-1";
  const hasGeminiKey = !!getGeminiApiKey();
  // 검색어가 2자 이상이고 아직 종목을 확정하지 않은 동안 검색 패널(결과/직접추가/AI) 노출.
  // 포커스 조건은 Combobox 가 소유(입력칸 포커스 중에만 보임 — 예전 onBlur 150ms 지연 해킹 제거).
  const searchPanelOpen = !ticker && searchQuery.trim().length >= 2;
  const trimmedQueryUpper = searchQuery.trim().toUpperCase();
  const searchActions: ComboboxAction[] = [
    {
      key: 'manual-add',
      icon: <Pencil />,
      label: <>'<span className="font-mono">{trimmedQueryUpper}</span>' 티커로 직접 추가</>,
      onSelect: () => { void handleManualAdd(); },
      disabled: isSearching,
    },
    {
      key: 'reload-symbols',
      icon: <RefreshCw className="text-gray-300" />,
      label: <span className="text-gray-300" title="종목 목록을 서버에서 다시 받아옵니다 (검색이 안 되거나 신규상장 종목이 없을 때)">종목 목록 새로 받기</span>,
      onSelect: () => { void handleReloadSymbols(); },
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

  // 인라인 오류 ↔ 입력칸 접근성 연결(FieldError 패턴: 오류일 때만 aria-invalid, 문구가 보이는 동안만 describedby)
  const showTickerError = submitAttempted && !!tickerError;
  const showFieldsError = submitAttempted && !tickerError && !!fieldsError;
  const searchDescribedBy = [
    showTickerError ? tickerErrorId : null,
    duplicateError ? duplicateErrorId : null,
    searchError ? searchErrorId : null,
  ].filter(Boolean).join(' ') || undefined;
  const fieldsDescribedBy = showFieldsError ? fieldsErrorId : undefined;

  if (!isOpen) return null;

  return (
    <>
    <Modal
      open={isOpen}
      onClose={onClose}
      title="신규 자산 추가"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button
            type="submit"
            form="add-new-asset-form"
            variant="primary"
            loading={isLoading}
            disabled={!!duplicateError}
            title="입력한 정보로 새 자산을 포트폴리오에 추가합니다."
          >
            자산 추가
          </Button>
        </>
      }
    >
        <form id="add-new-asset-form" onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label htmlFor="category" className={labelClasses}>자산 구분</label>
                {bucket === 'SATELLITE' && !showCategoryDetail ? (
                  // 투더문: 자산 구분은 배분에 쓰이지 않으므로 자동 인식 값으로 접어둠
                  // (값 자체는 정확히 저장 — 나중에 코어 편입 시 배분 축으로 쓰임)
                  <div className="flex items-center justify-between bg-gray-700/50 border border-gray-600 rounded-md py-2 px-3">
                    <span className="text-sm text-gray-300">
                      자동 인식: <span className="text-white font-medium">{getCategoryName(category, categories)}</span>
                      <span className="text-xs text-gray-500 ml-2">투더문은 배분에 미사용</span>
                    </span>
                    <button type="button" onClick={() => setShowCategoryDetail(true)} className="text-xs text-primary hover:underline flex-shrink-0">변경</button>
                  </div>
                ) : (
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
                )}
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
                <p className="text-xs text-gray-400 mt-1">{BUCKET_DESCRIPTIONS[bucket]} · 시세·거래소는 종목 검색에서 자동 결정되며 버킷은 배분 집계에만 영향.</p>
            </div>
            <div>
                <label className={labelClasses}>계정</label>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_OWNERS.map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setOwner(o)}
                      className={`py-2 px-3 rounded-md border text-sm font-medium transition ${
                        owner === o
                          ? 'bg-primary border-primary text-white'
                          : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500'
                      }`}
                      title={OWNER_DESCRIPTIONS[o]}
                    >
                      {OWNER_LABELS[o]}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">{OWNER_DESCRIPTIONS[owner]}</p>
            </div>
            <div>
                <label className={labelClasses}>거래소/시장</label>
                <input value={exchange} readOnly className="w-full bg-gray-600 border border-gray-500 rounded-md py-2 px-3 text-gray-300 cursor-not-allowed" title="자산구분 또는 종목 검색에 따라 자동으로 결정됩니다." />
            </div>
            
            <div>
            <label htmlFor="ticker-search" className={labelClasses}>티커 (종목 검색)</label>
            <Combobox<SymbolSearchResult>
                inputId="ticker-search"
                inputValue={searchQuery}
                onInputChange={handleSearchChange}
                placeholder="예: Apple, 삼성전자"
                aria-invalid={showTickerError || !!duplicateError ? true : undefined}
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
                onSelect={(result) => { void handleSelectSymbol(result); }}
                open={searchPanelOpen}
                notice={isListLoading
                    ? <><Loader2 className="inline h-3.5 w-3.5 mr-1 animate-spin align-[-2px]" aria-hidden="true" />종목 목록을 받고 있습니다 — 곧 결과가 나타납니다 <span className="text-gray-500">(약 1.3MB · 기기당 하루 1회)</span></>
                    : undefined}
                // 목록은 입력칸 바로 아래에 겹쳐 열려 아래 FieldError 를 가리므로, 검색 오류는 목록 안에도 보여 준다
                error={searchError}
                // 목록 수신 중에는 '결과 없음'을 띄우지 않는다 — 아직 검색할 목록이 없는 상태라 오해를 준다
                emptyText={!isSearching && !isListLoading ? '검색 결과가 없습니다.' : undefined}
                actions={searchActions}
                listboxLabel="종목 검색 결과"
            />
            {showTickerError && <FieldError id={tickerErrorId} className="mt-1">{tickerError}</FieldError>}
            {duplicateError && <FieldError id={duplicateErrorId} className="mt-1">{duplicateError}</FieldError>}
            {searchError && <FieldError id={searchErrorId} className="mt-1">{searchError}</FieldError>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
                <label htmlFor="quantity" className={labelClasses}>수량</label>
                <input id="quantity" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="10" className={inputClasses} required min="0" step="any" title="보유하고 있는 자산의 수량을 입력하세요." aria-invalid={showFieldsError && !quantity ? true : undefined} aria-describedby={fieldsDescribedBy}/>
            </div>
            <div>
                <label htmlFor="purchasePrice" className={labelClasses}>매수가</label>
                <input id="purchasePrice" type="number" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} placeholder="150.00" className={inputClasses} required min="0" step="any" title="자산을 매수한 평균 단가를 선택한 통화 기준으로 입력하세요." aria-invalid={showFieldsError && !purchasePrice ? true : undefined} aria-describedby={fieldsDescribedBy} />
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
            <input id="purchaseDate" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className={inputClasses} required title="자산을 매수했거나 보유하기 시작한 날짜를 선택하세요." aria-invalid={showFieldsError && !purchaseDate ? true : undefined} aria-describedby={fieldsDescribedBy}/>
            </div>

            {/* 리스크 기반 권장 수량 (선택) */}
            <div className="bg-gray-700/40 p-3 rounded-md">
                <div className={`${labelClasses} flex items-center gap-1.5`}>
                    <Shield className="h-4 w-4 text-gray-400" aria-hidden="true" /><span>리스크 기반 권장 수량</span>
                    <span className="text-xs text-gray-500 font-normal">(위 매수가 기준)</span>
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

            {/* 매매 계획으로 저장 (P2a) — 손절선·익절선·추세선을 자산 추가와 함께 만든다 */}
            {ticker && quantity && purchasePrice && (
              <div className="bg-gray-700/40 p-3 rounded-md space-y-2">
                {hasMatchedWatchPlan ? (
                  <p className="text-xs text-info">
                    <ClipboardList className="inline h-3.5 w-3.5 mr-1 align-[-2px]" aria-hidden="true" />관심종목에 세워둔 매매 계획이 있습니다 — 저장하면 실제 매수가·수량으로 자동 이어집니다.
                  </p>
                ) : (
                <>
                <label className="flex items-center gap-2 text-sm text-gray-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveTradePlanOnAdd}
                    onChange={(e) => setSaveTradePlanOnAdd(e.target.checked)}
                    className="cursor-pointer"
                  />
                  이 계획으로 저장 (손절선·익절선·추세선)
                </label>
                {saveTradePlanOnAdd && (
                  <>
                    <p className="text-xs text-gray-400">
                      기본값: 손절 {DEFAULT_TRADE_PLAN_TEMPLATE.stopPct}% · 익절 {DEFAULT_TRADE_PLAN_TEMPLATE.profitMultiple}배
                      {DEFAULT_TRADE_PLAN_TEMPLATE.exitLine.kind === 'ma' && ` · ${DEFAULT_TRADE_PLAN_TEMPLATE.exitLine.period}일선`} · 불타기 안 함
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowTradePlanDetail(v => !v)}
                      className="text-xs text-primary-light hover:underline"
                    >
                      {showTradePlanDetail
                        ? <>자세히 접기 <ChevronUp className="inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" /></>
                        : <>자세히 <ChevronDown className="inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" /></>}
                    </button>
                    {showTradePlanDetail && (
                      <TradePlanEditor
                        ref={tradePlanEditorRef}
                        embedded
                        target={{
                          kind: 'asset',
                          asset: {
                            id: 'pending-new-asset', categoryId: category, ticker, exchange,
                            name: selectedName || ticker, quantity: parseFloat(quantity) || 0,
                            purchasePrice: parseFloat(purchasePrice) || 0, purchaseDate, currency,
                            currentPrice: parseFloat(purchasePrice) || 0, priceOriginal: parseFloat(purchasePrice) || 0,
                            highestPrice: parseFloat(purchasePrice) || 0, bucket, owner,
                          } as Asset,
                        }}
                      />
                    )}
                  </>
                )}
                </>
                )}
              </div>
            )}

            {showFieldsError && <FieldError id={fieldsErrorId}>{fieldsError}</FieldError>}
        </form>
    </Modal>
    {confirmRequest && <ConfirmDialog {...confirmRequest} />}
    </>
  );
};

export default AddNewAssetModal;