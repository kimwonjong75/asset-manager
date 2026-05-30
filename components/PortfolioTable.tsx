import React, { Fragment, useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useOnClickOutside } from '../hooks/useOnClickOutside';
import type { Asset } from '../types';
import { PortfolioTableProps, SortKey, SortDirection, ColumnKey } from '../types/ui';
import { COLUMN_DEFINITIONS } from './portfolio-table/columnDefinitions';
import ColumnSettingsDropdown from './portfolio-table/ColumnSettingsDropdown';
import { usePortfolioData } from './portfolio-table/usePortfolioData';
import PortfolioTableRow from './portfolio-table/PortfolioTableRow';
import PortfolioMobileCard from './portfolio-table/PortfolioMobileCard';
import ColumnResizeHandle from './portfolio-table/ColumnResizeHandle';
import MemoEditPopup from './common/MemoEditPopup';
import Tooltip from './common/Tooltip';
import { COLUMN_DESCRIPTIONS } from '../constants/columnDescriptions';
import type { SmartFilterState, SmartFilterKey } from '../types/smartFilter';
import { EMPTY_SMART_FILTER } from '../types/smartFilter';
import { matchesSmartFilter } from '../utils/smartFilterLogic';
import SmartFilterPanel from './portfolio-table/SmartFilterPanel';
import { usePortfolio } from '../contexts/PortfolioContext';
import type { AlertRule } from '../types/alertRules';
import { hasResolvableRates } from '../utils/exchangeRateCache';
import { Currency } from '../types';

const SortIcon = ({ sortKey, sortConfig }: { sortKey: SortKey, sortConfig: { key: SortKey; direction: SortDirection } | null }) => {
  if (!sortConfig || sortConfig.key !== sortKey) return <span className="opacity-30">↕</span>;
  return sortConfig.direction === 'descending' ? <span>▼</span> : <span>▲</span>;
};

const PortfolioTable: React.FC<PortfolioTableProps> = ({
  assets,
  history,
  onEdit,
  onSell,
  onBuy,
  isLoading,
  onRefreshSelected,
  onRefreshOne,
  sellAlertDropRate,
  onSellAlertDropRateChange,
  filterCategory,
  onFilterChange,
  filterAlerts,
  onFilterAlertsChange,
  searchQuery = '',
  onSearchChange,
  failedIds,
  exchangeRates
}) => {
  const [hideLowValue, setHideLowValue] = useState<boolean>(() => {
    try { return localStorage.getItem('asset-manager-hide-low-value') === '1'; }
    catch { return false; }
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showFailedOnly, setShowFailedOnly] = useState<boolean>(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const prevLoadingRef = useRef<boolean>(false);
  const [smartFilter, setSmartFilter] = useState<SmartFilterState>({ ...EMPTY_SMART_FILTER, activeFilters: new Set() });
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const [memoEditAsset, setMemoEditAsset] = useState<Asset | null>(null);

  const handleSetHideLowValue = (v: boolean) => {
    setHideLowValue(v);
    try { localStorage.setItem('asset-manager-hide-low-value', v ? '1' : '0'); } catch { /* ignore */ }
  };

  useOnClickOutside(menuRef, () => setOpenMenuId(null), !!openMenuId);

  // Context에서 가져오기
  const { derived, ui, actions, data } = usePortfolio();
  const { enrichedMap, isEnrichedLoading } = derived;

  // GC/DC 뱃지: 알림 규칙(`golden-cross`, `dead-cross`)의 MA 페어를 직접 참조
  // 사용자가 알림 설정에서 변경한 페어가 즉시 뱃지에 반영됨
  const badgePairs = useMemo(() => {
    const gc = ui.alertSettings.rules.find(r => r.id === 'golden-cross');
    const dc = ui.alertSettings.rules.find(r => r.id === 'dead-cross');
    return {
      gcEnabled: gc?.enabled ?? false,
      gcShort: gc?.filterConfig?.maShortPeriod ?? 5,
      gcLong: gc?.filterConfig?.maLongPeriod ?? 20,
      dcEnabled: dc?.enabled ?? false,
      dcShort: dc?.filterConfig?.maShortPeriod ?? 5,
      dcLong: dc?.filterConfig?.maLongPeriod ?? 20,
    };
  }, [ui.alertSettings.rules]);

  const {
    enrichedAndSortedAssets,
    sortConfig,
    requestSort,
    toggleReturnSort,
    categoryOptions
  } = usePortfolioData({
    assets,
    exchangeRates,
    categories: data.categoryStore.categories,
    filterAlerts,
    sellAlertDropRate,
    showFailedOnly,
    failedIds,
    enrichedMap,
    badgePairs,
  });
  const [presetOpen, setPresetOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const presetRef = useRef<HTMLDivElement | null>(null);
  useOnClickOutside(presetRef, () => setPresetOpen(false), presetOpen);

  // 프리셋 적용
  const handleApplyPreset = (rule: AlertRule) => {
    const newFilters = new Set<SmartFilterKey>(rule.filters);
    setSmartFilter({
      ...EMPTY_SMART_FILTER,
      activeFilters: newFilters,
      maShortPeriod: rule.filterConfig.maShortPeriod ?? 20,
      maLongPeriod: rule.filterConfig.maLongPeriod ?? 60,
      dropFromHighThreshold: rule.filterConfig.dropFromHighThreshold ?? 20,
      lossThreshold: rule.filterConfig.lossThreshold ?? 5,
    });
    setActivePreset(rule.id);
    setPresetOpen(false);
  };

  const handleClearPreset = () => {
    handleClearAllFilters();
    setActivePreset(null);
    setPresetOpen(false);
  };

  // 외화 자산이 있는데 환율(현재 + 캐시)이 모두 미확보면 소액 숨김을 자동 우회
  // — 잘못 변환된 0값으로 자산이 사라지는 것을 방지
  const lowValueFilterReady = useMemo(() => {
    const foreignCurrencies = assets
      .map(a => a.currency)
      .filter(c => c !== Currency.KRW);
    if (foreignCurrencies.length === 0) return true;
    return hasResolvableRates(foreignCurrencies, exchangeRates);
  }, [assets, exchangeRates]);

  // 현재 가시 컬럼 (Context의 columnConfig 사용)
  const visibleColumns = ui.columnConfig;

  // 컬럼 리사이즈 — 드래그 중 미리보기는 로컬 state, mouseup 시점에 Context로 커밋
  // (드래그 중 Context 갱신 시 행 전체 재렌더되어 성능/UX 저하)
  const [dragOverride, setDragOverride] = useState<{ key: string; width: number } | null>(null);
  const getColWidth = useCallback((key: string): number | undefined => {
    if (dragOverride && dragOverride.key === key) return dragOverride.width;
    if (key === 'name') return ui.fixedColumnWidths.name;
    const cfg = ui.columnConfig.find(c => c.key === key);
    return cfg?.width;
  }, [dragOverride, ui.fixedColumnWidths, ui.columnConfig]);

  // <th>에 강제 적용할 너비 스타일.
  // table-layout: auto + width:100% 환경에서는 <col width>가 hint로만 동작하므로
  // <th>에 직접 width + minWidth를 inline으로 주어 콘텐츠 측정을 우회 강제함.
  const getThStyle = useCallback((key: string): React.CSSProperties | undefined => {
    const w = getColWidth(key);
    if (!w) return undefined;
    return { width: `${w}px`, minWidth: `${w}px`, maxWidth: `${w}px` };
  }, [getColWidth]);

  // 중간 컬럼 헤더에 주입할 ResizeHandle 컴포넌트
  // actions가 Context 갱신마다 새 객체가 되므로 ref로 안정화 — 드래그 중 ColumnResizeHandle 리마운트 방지
  const actionsRef = useRef(actions);
  useEffect(() => { actionsRef.current = actions; }, [actions]);
  const MiddleColumnResizeHandle = useMemo(() => {
    const Component: React.FC<{ columnKey: ColumnKey }> = ({ columnKey }) => (
      <ColumnResizeHandle
        columnKey={columnKey}
        onResize={(w) => actionsRef.current.setColumnWidth(columnKey, w)}
        onDragPreview={(w) => setDragOverride(w !== null ? { key: columnKey, width: w } : null)}
      />
    );
    return Component;
  }, []);

  // 콜스팬 계산 — 양끝 고정(체크박스+종목명+관리) 3 + 가시 컬럼 수
  const totalColSpan = useMemo(
    () => 3 + visibleColumns.filter(c => c.visible).length,
    [visibleColumns],
  );

  // 스마트 필터 + 핀 필터 + 소액 숨김 적용
  const filteredAssets = useMemo(() => {
    let result = enrichedAndSortedAssets;
    if (showPinnedOnly) {
      result = result.filter(a => a.pinned);
    }
    if (hideLowValue && ui.lowValueThreshold > 0 && lowValueFilterReady) {
      // 핀 고정 자산은 소액이어도 항상 표시 (사용자가 명시적으로 중요 표시한 자산 보호)
      result = result.filter(a => a.pinned || a.metrics.currentValueKRW >= ui.lowValueThreshold);
    }
    if (smartFilter.activeFilters.size > 0) {
      result = result.filter(a => matchesSmartFilter(a, smartFilter, enrichedMap));
    }
    return result;
  }, [enrichedAndSortedAssets, smartFilter, enrichedMap, showPinnedOnly, hideLowValue, ui.lowValueThreshold, lowValueFilterReady]);

  const handleToggleFilter = (key: SmartFilterKey, deactivateKey?: SmartFilterKey) => {
    setSmartFilter(prev => {
      const next = new Set(prev.activeFilters);
      if (deactivateKey) next.delete(deactivateKey);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, activeFilters: next };
    });
  };

  const handleClearAllFilters = () => {
    setSmartFilter({ ...EMPTY_SMART_FILTER, activeFilters: new Set() });
  };

  const handleDropThresholdChange = (value: number) => {
    setSmartFilter(prev => ({ ...prev, dropFromHighThreshold: value }));
  };

  const handleMaShortPeriodChange = (period: number) => {
    setSmartFilter(prev => ({ ...prev, maShortPeriod: period }));
  };

  const handleMaLongPeriodChange = (period: number) => {
    setSmartFilter(prev => ({ ...prev, maLongPeriod: period }));
  };

  const handleLossThresholdChange = (value: number) => {
    setSmartFilter(prev => ({ ...prev, lossThreshold: value }));
  };

  const allSelected = filteredAssets.length > 0 && filteredAssets.every(a => selectedIds.has(a.id));

  const getReturnHeaderLabel = () => {
    if (!sortConfig) return '수익률';
    if (sortConfig.key === 'returnPercentage') return `수익률 ${sortConfig.direction === 'descending' ? '▼' : '▲'}`;
    if (sortConfig.key === 'profitLossKRW') return `평가손익 ${sortConfig.direction === 'descending' ? '▼' : '▲'}`;
    return '수익률';
  };

  useEffect(() => {
    if (!isLoading && prevLoadingRef.current && failedIds && failedIds.size > 0) {
      const ok = window.confirm('업데이트에 실패한 항목이 있습니다. 실패한 리스트만 보시겠습니까?');
      if (ok) setShowFailedOnly(true);
    }
    prevLoadingRef.current = isLoading;
  }, [isLoading, failedIds]);

  const emptyMessage = smartFilter.activeFilters.size > 0
    ? '필터 조건에 맞는 자산이 없습니다.'
    : filterAlerts
      ? '알림 기준을 초과한 자산이 없습니다.'
      : '자산이 없습니다.';

  const thClasses = "relative px-4 py-3 cursor-pointer hover:bg-gray-600 transition-colors sticky top-0 bg-gray-700 z-10 whitespace-nowrap";
  const thContentClasses = "flex items-center gap-2";

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg">
      {/* 헤더 영역 */}
      <div className="bg-gray-800 px-3 sm:px-6 pt-2 sm:pt-6 pb-2 sm:pb-4 border-b border-gray-700">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
            <h2 className="text-base sm:text-xl font-bold text-white whitespace-nowrap hidden sm:block">포트폴리오 현황</h2>
            {onSearchChange && (
              <div className="relative flex-1 sm:flex-none">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="포트폴리오 검색..."
                  className="bg-gray-700 border border-gray-600 rounded-md py-2 pl-10 pr-10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary w-full sm:w-64"
                />
                <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                {searchQuery && (
                  <button onClick={() => onSearchChange('')} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
            )}
            <button
              onClick={() => setShowPinnedOnly(!showPinnedOnly)}
              className={`text-xl leading-none py-2 px-2 rounded-md transition-colors flex-shrink-0 ${
                showPinnedOnly
                  ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50'
                  : 'text-gray-500 hover:text-yellow-400/60 border border-transparent'
              }`}
              title={showPinnedOnly ? '전체 보기' : '중요 종목만 보기'}
            >
              {showPinnedOnly ? '★' : '☆'}
            </button>
          </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="bg-primary/20 text-primary px-2 py-1 rounded text-xs font-bold hidden sm:inline-block">
                {selectedIds.size}개 선택됨
              </span>
              {onRefreshSelected && (
                <button
                  onClick={() => onRefreshSelected(Array.from(selectedIds))}
                  disabled={isLoading}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1 rounded text-xs font-medium transition"
                >
                  {isLoading ? '업데이트 중...' : '선택 업데이트'}
                </button>
              )}
            </div>
          )}

          {/* 표시 토글 — 소액 숨김 + 더보기 (프리셋 왼쪽) */}
          <label
            className="flex items-center cursor-pointer gap-1.5 sm:gap-2"
            title={
              hideLowValue && !lowValueFilterReady
                ? '환율 미확보 — 외화 자산 KRW 환산이 불가하여 소액 숨김이 일시 정지됩니다. 시세 갱신 후 자동으로 재적용됩니다.'
                : `평가총액 ${ui.lowValueThreshold.toLocaleString('ko-KR')}원 미만 자산 숨김 (★ 핀 고정 자산은 항상 표시 / 환경설정에서 임계값 변경)`
            }
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={hideLowValue}
              onChange={(e) => handleSetHideLowValue(e.target.checked)}
            />
            <div className="relative">
              <div className={`block w-9 h-5 rounded-full transition-colors ${hideLowValue ? (lowValueFilterReady ? 'bg-primary' : 'bg-amber-600') : 'bg-gray-600'}`} />
              <div className={`absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${hideLowValue ? 'translate-x-4' : ''}`} />
            </div>
            <span className={`text-xs whitespace-nowrap hidden sm:inline ${hideLowValue && !lowValueFilterReady ? 'text-amber-400' : 'text-gray-300'}`}>
              소액 숨김{hideLowValue && !lowValueFilterReady ? ' (환율 대기)' : ''}
            </span>
          </label>

          <ColumnSettingsDropdown />

          {/* 프리셋 드롭다운 */}
          <div className="relative" ref={presetRef}>
            <button
              onClick={() => setPresetOpen(!presetOpen)}
              className={`py-2 px-3 rounded-md text-sm font-medium transition flex items-center gap-1 ${
                activePreset
                  ? 'bg-primary text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <span className="hidden sm:inline">
                {activePreset
                  ? ui.alertSettings.rules.find(r => r.id === activePreset)?.name ?? '프리셋'
                  : '프리셋'}
              </span>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {presetOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-30 py-1">
                {/* 매도 감지 */}
                <div className="px-3 py-1.5 text-[10px] text-red-400 font-semibold uppercase tracking-wider">매도 감지</div>
                {ui.alertSettings.rules.filter(r => r.action === 'sell' && r.enabled).map(rule => (
                  <button
                    key={rule.id}
                    onClick={() => handleApplyPreset(rule)}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 transition flex items-center gap-2 ${
                      activePreset === rule.id ? 'text-primary' : 'text-gray-300'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      rule.severity === 'critical' ? 'bg-red-500' : 'bg-amber-500'
                    }`} />
                    {rule.name}
                  </button>
                ))}
                {/* 매수 기회 */}
                <div className="px-3 py-1.5 text-[10px] text-blue-400 font-semibold uppercase tracking-wider mt-1 border-t border-gray-700">매수 기회</div>
                {ui.alertSettings.rules.filter(r => r.action === 'buy' && r.enabled).map(rule => (
                  <button
                    key={rule.id}
                    onClick={() => handleApplyPreset(rule)}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 transition flex items-center gap-2 ${
                      activePreset === rule.id ? 'text-primary' : 'text-gray-300'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                    {rule.name}
                  </button>
                ))}
                {/* 구분선 + 추가 메뉴 */}
                <div className="border-t border-gray-700 mt-1 pt-1">
                  <button
                    onClick={() => { actions.setActiveTab('settings'); setPresetOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-700 hover:text-white transition flex items-center gap-2"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    알림 설정
                  </button>
                  <button
                    onClick={() => { actions.showBriefingPopup(); setPresetOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-700 hover:text-white transition flex items-center gap-2"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                    브리핑 다시 보기
                  </button>
                  {activePreset && (
                    <button
                      onClick={handleClearPreset}
                      className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-700 hover:text-white transition flex items-center gap-2"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      필터 초기화
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="relative hidden sm:block">
            <select
              value={filterCategory}
              onChange={(e) => { const v = e.target.value; onFilterChange(v === 'ALL' ? 'ALL' : Number(v)); }}
              className="appearance-none bg-gray-700 border border-gray-600 text-white text-sm rounded-md py-2 pl-3 pr-8 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="ALL">전체 자산</option>
              {categoryOptions.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
            <svg className="absolute right-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
        </div>
      </div>

      {/* 스마트 필터 패널 */}
      <SmartFilterPanel
        filter={smartFilter}
        onToggleFilter={handleToggleFilter}
        onClearAll={handleClearAllFilters}
        onDropThresholdChange={handleDropThresholdChange}
        onLossThresholdChange={handleLossThresholdChange}
        onMaShortPeriodChange={handleMaShortPeriodChange}
        onMaLongPeriodChange={handleMaLongPeriodChange}
        matchCount={filteredAssets.length}
        totalCount={enrichedAndSortedAssets.length}
        sellAlertDropRate={sellAlertDropRate}
        onSellAlertDropRateChange={onSellAlertDropRateChange || (() => {})}
        filterAlerts={filterAlerts}
        onFilterAlertsChange={onFilterAlertsChange}
        isEnrichedLoading={isEnrichedLoading}
      />

      {/* 데스크탑: 테이블 — overflow 없음, thead가 main 스크롤 기준 sticky */}
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <colgroup>
            <col />
            <col style={getColWidth('name') ? { width: `${getColWidth('name')}px` } : undefined} />
            {visibleColumns.filter(c => c.visible).map(c => {
              const w = getColWidth(c.key);
              return <col key={c.key} style={w ? { width: `${w}px` } : undefined} />;
            })}
            <col />
          </colgroup>
          <thead className="bg-gray-700 text-gray-300 uppercase text-xs">
            <tr>
              <th scope="col" className="px-4 py-3 text-center sticky top-0 bg-gray-700 z-20">
                <input type="checkbox" checked={allSelected} onChange={(e) => {
                  if (e.target.checked) setSelectedIds(new Set(filteredAssets.map(a => a.id)));
                  else setSelectedIds(new Set());
                }} />
              </th>
              <th scope="col" className={`${thClasses} z-20`} style={getThStyle('name')} onClick={() => requestSort('name')}>
                <Tooltip content={COLUMN_DESCRIPTIONS.name} position="bottom" wrap>
                  <div className={thContentClasses}><span>종목명</span> <SortIcon sortKey='name' sortConfig={sortConfig}/></div>
                </Tooltip>
                <ColumnResizeHandle
                  columnKey="name"
                  onResize={(w) => actions.setFixedColumnWidth('name', w)}
                  onDragPreview={(w) => setDragOverride(w !== null ? { key: 'name', width: w } : null)}
                />
              </th>
              {visibleColumns.filter(c => c.visible).map(c => {
                const def = COLUMN_DEFINITIONS[c.key];
                if (!def) return null;
                return (
                  <Fragment key={c.key}>
                    {def.renderHeader({
                      sortConfig,
                      requestSort,
                      toggleReturnSort,
                      badgePairs,
                      thClasses,
                      thContentClasses,
                      SortIcon: ({ sortKey }) => <SortIcon sortKey={sortKey} sortConfig={sortConfig} />,
                      getReturnHeaderLabel,
                      ResizeHandle: MiddleColumnResizeHandle,
                      getThStyle,
                    })}
                  </Fragment>
                );
              })}
              <th scope="col" className="px-4 py-3 text-center sticky top-0 bg-gray-700 z-20">관리</th>
            </tr>
          </thead>
          <tbody>
            {filteredAssets.length > 0 ? filteredAssets.map(asset => {
              const enriched = enrichedMap.get(asset.ticker);
              const gcRaw = badgePairs.gcEnabled
                ? enriched?.maCrossDays?.[badgePairs.gcShort]?.[badgePairs.gcLong]
                : null;
              const dcRaw = badgePairs.dcEnabled
                ? enriched?.maCrossDays?.[badgePairs.dcShort]?.[badgePairs.dcLong]
                : null;
              return (
              <PortfolioTableRow
                key={asset.id}
                asset={asset}
                history={history}
                selectedIds={selectedIds}
                onSelect={(id, checked) => {
                  const next = new Set(selectedIds);
                  checked ? next.add(id) : next.delete(id);
                  setSelectedIds(next);
                }}
                visibleColumns={visibleColumns}
                onEdit={onEdit}
                onSell={onSell}
                onBuy={onBuy}
                onRefreshOne={onRefreshOne}
                exchangeRates={exchangeRates}
                onTogglePin={actions.togglePinAsset}
                onMemoEdit={(asset) => setMemoEditAsset(asset)}
                gcCrossDays={gcRaw != null && gcRaw >= 0 ? gcRaw : null}
                dcCrossDays={dcRaw != null && dcRaw < 0 ? dcRaw : null}
                getTdStyle={getThStyle}
              />
              );
            }) : (
              <tr><td colSpan={totalColSpan} className="text-center py-8 text-gray-500">
                  {emptyMessage}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 모바일: 카드 뷰 */}
      <div className="block md:hidden">
        {filteredAssets.length > 0 ? filteredAssets.map(asset => {
          const enriched = enrichedMap.get(asset.ticker);
          const gcRaw = badgePairs.gcEnabled
            ? enriched?.maCrossDays?.[badgePairs.gcShort]?.[badgePairs.gcLong]
            : null;
          const dcRaw = badgePairs.dcEnabled
            ? enriched?.maCrossDays?.[badgePairs.dcShort]?.[badgePairs.dcLong]
            : null;
          return (
          <PortfolioMobileCard
            key={asset.id}
            asset={asset}
            history={history}
            onEdit={onEdit}
            onSell={onSell}
            onBuy={onBuy}
            onRefreshOne={onRefreshOne}
            exchangeRates={exchangeRates}
            onTogglePin={actions.togglePinAsset}
            onMemoEdit={(asset) => setMemoEditAsset(asset)}
            gcCrossDays={gcRaw != null && gcRaw >= 0 ? gcRaw : null}
            dcCrossDays={dcRaw != null && dcRaw < 0 ? dcRaw : null}
          />
          );
        }) : (
          <div className="text-center py-8 text-gray-500">{emptyMessage}</div>
        )}
      </div>

      {/* 메모 편집 팝업 */}
      {memoEditAsset && (
        <MemoEditPopup
          title={memoEditAsset.customName?.trim() || memoEditAsset.name}
          memo={memoEditAsset.memo || ''}
          onSave={(memo) => actions.updateAsset({ ...memoEditAsset, memo: memo || undefined })}
          onClose={() => setMemoEditAsset(null)}
        />
      )}
    </div>
  );
};

export default PortfolioTable;
