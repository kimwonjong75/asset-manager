import { directionTextClass } from '../utils/directionTone';
import React, { useMemo, useState, useEffect, Fragment, useRef } from 'react';
import {
  ArrowDown, ArrowUp, ArrowUpDown, ChartColumn, ChevronDown, Info, Plus, RefreshCw, Search,
  SlidersHorizontal, Star, StickyNote, Trash2,
} from 'lucide-react';
import ActionMenu, { type ActionMenuEntry } from './common/ActionMenu';
import Badge from './common/Badge';
import Button from './common/Button';
import ConfirmDialog from './common/ConfirmDialog';
import RowActionMenuButton from './common/RowActionMenuButton';
import SortableTh from './common/SortableTh';
import Tooltip from './common/Tooltip';
import { useConfirm } from '../hooks/useConfirm';
import { useWatchlistBuyReadiness } from '../hooks/useWatchlistBuyReadiness';
import MemoTooltip from './common/MemoTooltip';
import MemoEditPopup from './common/MemoEditPopup';
import { Asset, Currency, CURRENCY_SYMBOLS, WatchlistItem, ExchangeRates } from '../types';
import { getAllowedCategories, getCategoryName, type CategoryDefinition } from '../types/category';
import { BUY_READINESS_LABEL, BUY_READINESS_TOOLTIP } from '../types/stockReview';
import AssetTrendChart from './AssetTrendChart';
import ChartViewerModal from './common/ChartViewerModal';
import StockReviewAccordion from './stock-review/StockReviewAccordion';
import TradePlanSection from './trade-plan/TradePlanSection';
import WatchlistMobileCard from './watchlist/WatchlistMobileCard';
import BuyReadinessMarks from './watchlist/BuyReadinessMarks';
import { buildWatchlistRowMenuItems } from './watchlist/watchlistRowMenu';
import { usePortfolio } from '../contexts/PortfolioContext';
import { watchlistToPseudoAsset } from '../utils/alertChecker';
import {
  nextWatchlistSort,
  sortWatchlistRows,
  type WatchlistSortConfig,
  type WatchlistSortKey,
} from '../utils/watchlistSort';
import { getWatchlistEmptyState, type WatchlistEmptyState } from '../utils/watchlistEmptyState';

interface WatchlistPageProps {
  watchlist: WatchlistItem[];
  portfolioAssets: Asset[];
  onDelete: (id: string) => void;
  onOpenAddModal: () => void;
  onOpenEditModal: (item: WatchlistItem) => void;
  isLoading: boolean;
  onBulkDelete?: (ids: string[]) => void;
  exchangeRates: ExchangeRates;
  onRefresh?: () => Promise<void>;
  categories: CategoryDefinition[];
  onTogglePin?: (id: string) => void;
}

// 모바일 정렬 바 아이콘 (SortableTh 와 같은 관례: 비활성 ArrowUpDown, 오름 ArrowUp, 내림 ArrowDown)
const SortIcon: React.FC<{ sortKey: WatchlistSortKey; sortConfig: WatchlistSortConfig | null }> = ({ sortKey, sortConfig }) => {
  if (!sortConfig || sortConfig.key !== sortKey) return <ArrowUpDown className="h-3.5 w-3.5 opacity-30" aria-hidden="true" />;
  return sortConfig.direction === 'descending'
    ? <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
    : <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />;
};

// 빈 목록 안내 — 원인·문구·행동은 순수 utils/watchlistEmptyState 가 결정(데스크탑 표·모바일 목록 공용)
const EmptyStateBlock: React.FC<{ state: WatchlistEmptyState; onClearFilters: () => void; onAddItem: () => void }> = ({ state, onClearFilters, onAddItem }) => (
  <div className="flex flex-col items-center gap-3 py-8 text-center">
    <p className="text-sm text-gray-400">{state.message}</p>
    {state.actions.length > 0 && (
      <div className="flex flex-wrap items-center justify-center gap-2">
        {state.actions.includes('clearFilters') && (
          <Button variant="secondary" onClick={onClearFilters}>필터 해제</Button>
        )}
        {state.actions.includes('addItem') && (
          <Button variant="secondary" icon={<Plus />} onClick={onAddItem}>종목 추가</Button>
        )}
      </div>
    )}
  </div>
);

const SORT_TITLE = '정렬 (한 번 더 누르면 역순)';

const WatchlistPage: React.FC<WatchlistPageProps> = ({ watchlist, portfolioAssets, onDelete, onOpenAddModal, onOpenEditModal, isLoading, onBulkDelete, exchangeRates, onRefresh, categories, onTogglePin }) => {
  const { actions, ui } = usePortfolio();
  const [filterCategory, setFilterCategory] = useState<number | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [fullscreenItemId, setFullscreenItemId] = useState<string | null>(null);
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const [memoEditItem, setMemoEditItem] = useState<WatchlistItem | null>(null);
  // 정렬 상태는 로컬(영속 없음) — 데스크탑 헤더·모바일 정렬 바 공유
  const [sortConfig, setSortConfig] = useState<WatchlistSortConfig | null>(null);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  // 행 메뉴 '종목 검토' 요청 — nonce 가 바뀔 때마다 그 행 아코디언을 key 로 리마운트해 initialOpen 으로 연다
  const [reviewTarget, setReviewTarget] = useState<{ id: string; nonce: number } | null>(null);
  const viewMenuAnchorRef = useRef<HTMLButtonElement>(null);
  const { confirm, confirmRequest } = useConfirm();
  const readinessMap = useWatchlistBuyReadiness(watchlist);

  const requestSort = (key: WatchlistSortKey) => setSortConfig(prev => nextWatchlistSort(prev, key));
  const onSortHeader = (key: string) => requestSort(key as WatchlistSortKey);

  // 브리핑에서 관심종목 클릭 시 차트 자동 확장 + 해당 행으로 스크롤
  useEffect(() => {
    if (ui.focusedWatchItemId) {
      const targetId = ui.focusedWatchItemId;
      setExpandedItemId(targetId);
      actions.setFocusedWatchItemId(null);
      setTimeout(() => {
        const elements = document.querySelectorAll<HTMLElement>(`[data-watch-id="${targetId}"]`);
        elements.forEach(el => {
          if (el.offsetParent !== null) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });
      }, 150);
    }
  }, [ui.focusedWatchItemId]);

  const categoryOptions = useMemo(() => {
    const allowed = getAllowedCategories(categories);
    const allowedIds = new Set(allowed.map(c => c.id));
    const watchCatIds = new Set(watchlist.map(w => w.categoryId));
    const extras = categories.filter(c => watchCatIds.has(c.id) && !allowedIds.has(c.id));
    return [...allowed, ...extras];
  }, [watchlist, categories]);

  const portfolioTickers = useMemo(() => {
    return new Set(portfolioAssets.map(a => a.ticker.toUpperCase()));
  }, [portfolioAssets]);

  // 필터 → 파생값 부착(매수 점검 포함) → 헤더 정렬(순수 util). 데스크탑 테이블과 모바일 카드가 같은 목록을 공유한다.
  const filtered = useMemo(() => {
    const rows = watchlist
      .filter(w => !showPinnedOnly || w.pinned)
      .filter(w => (filterCategory === 'ALL' ? true : w.categoryId === filterCategory))
      .filter(w => {
        if (!search) return true;
        const s = search.toLowerCase();
        return w.name.toLowerCase().includes(s) || w.ticker.toLowerCase().includes(s) || (w.notes || '').toLowerCase().includes(s);
      })
      .map(w => ({
        ...w,
        dropFromHigh: (w.highestPrice && w.highestPrice > 0 && w.currentPrice) ? ((w.currentPrice - w.highestPrice) / w.highestPrice) * 100 : null,
        yesterdayChange: w.yesterdayChange ?? (w.previousClosePrice && w.currentPrice ? ((w.currentPrice - w.previousClosePrice) / w.previousClosePrice) * 100 : 0),
        buyReadiness: readinessMap.get(w.id) ?? null,
      }));
    return sortWatchlistRows(rows, sortConfig);
  }, [watchlist, filterCategory, search, showPinnedOnly, sortConfig, readinessMap]);

  useEffect(() => {
    setSelectedIds(prev => {
      const next = new Set<string>();
      filtered.forEach(w => {
        if (prev.has(w.id)) next.add(w.id);
      });
      return next;
    });
  }, [filtered]);

  const emptyState = getWatchlistEmptyState({
    totalCount: watchlist.length,
    visibleCount: filtered.length,
    search,
    categoryName: filterCategory === 'ALL' ? null : getCategoryName(filterCategory, categories),
    pinnedOnly: showPinnedOnly,
  });
  const activeFilterCount = (showPinnedOnly ? 1 : 0) + (filterCategory !== 'ALL' ? 1 : 0);

  const formatKRW = (num: number) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(num);
  const formatOriginalCurrency = (num: number, currency: Currency) => `${CURRENCY_SYMBOLS[currency]}${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num)}`;
  const getChangeColor = directionTextClass;
  const allSelected = filtered.length > 0 && filtered.every(w => selectedIds.has(w.id));

  const toggleSelectAll = () => {
    const next = new Set<string>(selectedIds);
    if (allSelected) filtered.forEach(w => next.delete(w.id)); else filtered.forEach(w => next.add(w.id));
    setSelectedIds(next);
  };

  const clearFilters = () => {
    setSearch('');
    setFilterCategory('ALL');
    setShowPinnedOnly(false);
  };

  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    void confirm(`선택한 관심종목 ${ids.length}개를 삭제하시겠습니까?`, { title: '관심종목 삭제', confirmLabel: '삭제', tone: 'danger' })
      .then(ok => {
        if (!ok) return;
        if (onBulkDelete) onBulkDelete(ids); else ids.forEach(id => onDelete(id));
        setSelectedIds(new Set());
      });
  };

  const handleToggleExpand = (itemId: string) => {
    setReviewTarget(null);
    setExpandedItemId(prev => (prev === itemId ? null : itemId));
  };

  const openReview = (itemId: string) => {
    setExpandedItemId(itemId);
    setReviewTarget(prev => ({ id: itemId, nonce: (prev?.nonce ?? 0) + 1 }));
  };

  // 터틀 후보 토글 — 시세/카테고리와 독립된 boolean 플래그만 변경 (원본 항목 기준)
  const toggleTurtle = (id: string) => {
    const orig = watchlist.find(x => x.id === id);
    if (orig) actions.updateWatchItem({ ...orig, isTurtleCandidate: !orig.isTurtleCandidate });
  };

  // [보기 ▾] — 중요 종목만(연속 토글) + 카테고리 단일 선택
  const viewMenuItems: ActionMenuEntry[] = [];
  if (onTogglePin) {
    viewMenuItems.push({ label: '중요 종목만', checked: showPinnedOnly, keepOpen: true, onClick: () => setShowPinnedOnly(v => !v) });
  }
  viewMenuItems.push(
    { type: 'section', label: '카테고리' },
    { label: '전체', checked: filterCategory === 'ALL', onClick: () => setFilterCategory('ALL') },
    ...categoryOptions.map((cat): ActionMenuEntry => ({
      label: cat.name,
      checked: filterCategory === cat.id,
      onClick: () => setFilterCategory(cat.id),
    })),
  );

  const sortDirection = sortConfig ? (sortConfig.direction === 'ascending' ? 'asc' : 'desc') : null;
  const thSortClass = 'px-4 py-3 whitespace-nowrap hover:bg-gray-600 transition-colors';

  const getExchangeRate = (currency?: Currency): number => {
    if (!currency || currency === Currency.KRW) return 1;
    if (currency === Currency.USD) return exchangeRates.USD || 1;
    if (currency === Currency.JPY) return exchangeRates.JPY || 1;
    return 1;
  };

  const COLUMN_COUNT = 7;

  return (
    <div className="space-y-6">
      {confirmRequest && <ConfirmDialog {...confirmRequest} />}
      {/* 툴바 — 검색 · [보기 ▾] · 업데이트(아이콘) · 종목 추가(primary) */}
      <div className="bg-gray-800 p-3 sm:p-4 rounded-lg border border-border-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="relative flex-1 sm:flex-none">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="이름/티커/메모 검색"
            aria-label="관심종목 검색"
            className="bg-gray-700 border border-gray-600 rounded-md py-2 pl-10 pr-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary w-full sm:w-64"
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" aria-hidden="true" />
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button
            ref={viewMenuAnchorRef}
            variant="secondary"
            icon={<SlidersHorizontal />}
            iconRight={<ChevronDown />}
            aria-haspopup="menu"
            aria-expanded={viewMenuOpen}
            onClick={() => setViewMenuOpen(o => !o)}
          >
            보기
            {activeFilterCount > 0 && (
              <>
                <span aria-hidden="true"><Badge tone="info">{activeFilterCount}</Badge></span>
                <span className="sr-only">(필터 {activeFilterCount}개 적용 중)</span>
              </>
            )}
          </Button>
          {viewMenuOpen && (
            <ActionMenu
              anchorRef={viewMenuAnchorRef}
              items={viewMenuItems}
              onClose={() => setViewMenuOpen(false)}
              header="보기"
              width="md"
            />
          )}
          <Button
            variant="secondary"
            icon={<RefreshCw />}
            loading={isLoading}
            disabled={!onRefresh}
            onClick={() => { void onRefresh?.(); }}
            aria-label="시세 업데이트"
            title="시세 업데이트"
          />
          <Button variant="primary" icon={<Plus />} onClick={onOpenAddModal}>종목 추가</Button>
        </div>
      </div>

      {/* 선택 바 — 행을 고르면 나타난다 */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-surface-muted px-3 py-2">
          <span className="text-sm text-gray-200" aria-live="polite">{selectedIds.size}개 선택</span>
          <Button variant="danger" icon={<Trash2 />} onClick={handleBulkDelete}>선택 삭제</Button>
          <Button variant="ghost" onClick={() => setSelectedIds(new Set())}>선택 해제</Button>
        </div>
      )}

      {/* 데스크톱 테이블 — sticky thead 보존: 이 사이에 overflow 래퍼 금지 */}
      <div className="hidden md:block w-full">
        <table className="w-full text-sm text-left text-gray-400 table-auto">
          <thead className="text-xs text-gray-300 uppercase bg-gray-700 select-none sticky top-0 z-10">
            <tr>
              <th scope="col" className="px-4 py-3 text-center">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  disabled={filtered.length === 0}
                  aria-label="표시된 관심종목 전체 선택"
                />
              </th>
              <SortableTh
                label="종목명" sortKey="name" activeKey={sortConfig?.key ?? null} direction={sortDirection}
                onSort={onSortHeader} className={thSortClass} title={`종목명 ${SORT_TITLE}`}
              />
              <SortableTh
                label="현재가" sortKey="currentPrice" activeKey={sortConfig?.key ?? null} direction={sortDirection}
                onSort={onSortHeader} className={thSortClass} align="right" title={`현재가 ${SORT_TITLE}`}
              />
              <SortableTh
                label="어제대비" sortKey="yesterdayChange" activeKey={sortConfig?.key ?? null} direction={sortDirection}
                onSort={onSortHeader} className={thSortClass} align="right" title={`어제대비 ${SORT_TITLE}`}
              />
              <SortableTh
                label="최고가대비" sortKey="dropFromHigh" activeKey={sortConfig?.key ?? null} direction={sortDirection}
                onSort={onSortHeader} className={thSortClass} align="right" title={`최고가대비 ${SORT_TITLE}`}
              />
              <SortableTh
                label={BUY_READINESS_LABEL} sortKey="buyReadiness" activeKey={sortConfig?.key ?? null} direction={sortDirection}
                onSort={onSortHeader} className={thSortClass} align="right"
                tooltip={BUY_READINESS_TOOLTIP} tooltipPosition="bottom"
                title="매수 점검 정렬 (처음엔 충족 많은 순, 한 번 더 누르면 역순)"
              />
              <th scope="col" className="px-4 py-3 text-center">관리</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length > 0 ? filtered.map(w => {
              const isNonKRW = w.currency !== undefined && w.currency !== Currency.KRW;
              const derivedExchangeRate = getExchangeRate(w.currency);
              const isExpanded = expandedItemId === w.id;
              const reviewRequested = reviewTarget?.id === w.id;
              const menuItems = buildWatchlistRowMenuItems({
                isTurtleCandidate: !!w.isTurtleCandidate,
                onTradePlan: () => actions.openTradePlanPlanner({ watchItemId: w.id, ticker: w.ticker, exchange: w.exchange, name: w.name }),
                onReview: () => openReview(w.id),
                onEdit: () => onOpenEditModal(w),
                onToggleTurtle: () => toggleTurtle(w.id),
                onChartView: () => handleToggleExpand(w.id),
                onChartExpand: () => setFullscreenItemId(w.id),
                onDelete: () => {
                  void confirm(`'${w.name}' 종목을 삭제하시겠습니까?`, { title: '관심종목 삭제', confirmLabel: '삭제', tone: 'danger' })
                    .then(ok => { if (ok) onDelete(w.id); });
                },
              });
              return (
                <Fragment key={w.id}>
                  <tr data-watch-id={w.id} className="border-b border-gray-700 transition-colors duration-200 hover:bg-gray-700/50">
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(w.id)}
                        aria-label={`${w.name} 선택`}
                        onChange={(e) => {
                          const next = new Set<string>(selectedIds);
                          if (e.target.checked) next.add(w.id); else next.delete(w.id);
                          setSelectedIds(next);
                        }}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-1">
                        {onTogglePin && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onTogglePin(w.id); }}
                            className={`transition-colors flex-shrink-0 mt-0.5 ${
                              w.pinned ? 'text-yellow-400' : 'text-gray-500 hover:text-yellow-400/60'
                            }`}
                            title={w.pinned ? '중요 해제' : '중요 표시'}
                            aria-label={w.pinned ? '중요 해제' : '중요 표시'}
                            aria-pressed={!!w.pinned}
                          >
                            <Star className="h-4 w-4" fill={w.pinned ? 'currentColor' : 'none'} aria-hidden="true" />
                          </button>
                        )}
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1">
                            <MemoTooltip memo={w.notes}>
                              <span className="flex items-center gap-1">
                                {portfolioTickers.has(w.ticker.toUpperCase()) && (
                                  <Badge tone="info" className="flex-shrink-0" title="보유중">보유</Badge>
                                )}
                                {w.isTurtleCandidate && (
                                  <span className="text-xs px-1 py-0.5 rounded bg-ok-soft text-ok flex-shrink-0" role="img" aria-label="터틀 후보" title="터틀 후보">🐢</span>
                                )}
                                <a
                                  href={`https://www.google.com/search?q=${encodeURIComponent(w.ticker + ' 주가')}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-bold hover:underline text-primary-light cursor-pointer"
                                >
                                  {w.name}
                                </a>
                              </span>
                            </MemoTooltip>
                            <button
                              type="button"
                              className={`text-gray-300 cursor-pointer transition-opacity flex-shrink-0 ${
                                w.notes ? 'opacity-60 hover:opacity-100' : 'opacity-20 hover:opacity-50'
                              }`}
                              onClick={(e) => { e.stopPropagation(); setMemoEditItem(w); }}
                              title={w.notes ? '메모 수정' : '메모 추가'}
                              aria-label={w.notes ? '메모 수정' : '메모 추가'}
                            >
                              <StickyNote className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                          <span className="text-xs text-gray-500">{w.ticker} | {w.exchange} | {getCategoryName(w.categoryId, categories)}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {w.currentPrice !== undefined ? formatKRW(w.currentPrice) : '-'}
                      {isNonKRW && w.priceOriginal !== undefined && w.currency !== undefined && (
                        <div className="text-xs text-gray-500">{formatOriginalCurrency(w.priceOriginal, w.currency)}</div>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-right ${getChangeColor(w.yesterdayChange || 0)}`}>{w.yesterdayChange !== undefined ? `${(w.yesterdayChange || 0).toFixed(2)}%` : '-'}</td>
                    <td className={`px-4 py-3 text-right ${w.dropFromHigh != null ? getChangeColor(w.dropFromHigh) : 'text-gray-400'}`}>{w.dropFromHigh != null ? `${w.dropFromHigh.toFixed(2)}%` : '-'}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <BuyReadinessMarks readiness={w.buyReadiness} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleToggleExpand(w.id)}
                          className="focus-ring inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-gray-300 hover:bg-gray-700 hover:text-white"
                          title={isExpanded ? '차트 접기' : '차트 펼치기'}
                          aria-label={`${w.name} 차트 ${isExpanded ? '접기' : '펼치기'}`}
                          aria-expanded={isExpanded}
                        >
                          <ChartColumn className="h-4 w-4" aria-hidden="true" />
                        </button>
                        {/* 관리 메뉴 — WatchlistMobileCard 와 같은 buildWatchlistRowMenuItems */}
                        <RowActionMenuButton items={menuItems} label={`${w.name} 관리 메뉴`} header={w.name} />
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-gray-900/50">
                      <td colSpan={COLUMN_COUNT} className="p-0 sm:p-2">
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
                          categoryId={w.categoryId}
                          onExpand={() => setFullscreenItemId(w.id)}
                        />
                        <TradePlanSection
                          source="watchlist"
                          watchItem={w}
                          displayName={w.name}
                          className="px-2 sm:px-0"
                        />
                        <StockReviewAccordion
                          key={reviewRequested ? `review-${reviewTarget?.nonce ?? 0}` : 'review'}
                          asset={watchlistToPseudoAsset(w)}
                          source="watchlist"
                          displayName={w.name}
                          className="px-2 sm:px-0"
                          initialOpen={reviewRequested}
                        />
                      </td>
                    </tr>
                  )}
                  {fullscreenItemId === w.id && (
                    <ChartViewerModal
                      history={[]}
                      assetId={w.id}
                      assetName={w.name}
                      currentQuantity={1}
                      currentPrice={w.priceOriginal || w.currentPrice || 0}
                      currency={w.currency}
                      exchangeRate={derivedExchangeRate}
                      ticker={w.ticker}
                      exchange={w.exchange}
                      categoryId={w.categoryId}
                      onClose={() => setFullscreenItemId(null)}
                    />
                  )}
                </Fragment>
              );
            }) : emptyState && (
              <tr>
                <td colSpan={COLUMN_COUNT}>
                  <EmptyStateBlock state={emptyState} onClearFilters={clearFilters} onAddItem={onOpenAddModal} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 모바일 정렬 바 — 전체 선택 + 데스크탑 헤더와 동일 정렬 상태(sortConfig) 공유 + 매수 점검 설명 */}
      <div className="flex md:hidden items-center gap-1.5 overflow-x-auto scrollbar-hide">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleSelectAll}
          disabled={filtered.length === 0}
          aria-label="표시된 관심종목 전체 선택"
          className="flex-shrink-0 mr-1"
        />
        <span className="text-xs text-gray-500 flex-shrink-0">정렬</span>
        {([
          { key: 'name', label: '종목명' },
          { key: 'currentPrice', label: '현재가' },
          { key: 'yesterdayChange', label: '어제대비' },
          { key: 'dropFromHigh', label: '최고가대비' },
          { key: 'buyReadiness', label: BUY_READINESS_LABEL },
        ] as { key: WatchlistSortKey; label: string }[]).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => requestSort(key)}
            aria-pressed={sortConfig?.key === key}
            className={`text-xs px-2 py-1 rounded-md border transition-colors whitespace-nowrap flex items-center gap-1 ${
              sortConfig?.key === key
                ? 'bg-primary/20 border-primary/50 text-primary-light'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
            }`}
          >
            {label} <SortIcon sortKey={key} sortConfig={sortConfig} />
          </button>
        ))}
        <Tooltip content={BUY_READINESS_TOOLTIP} position="bottom" wrap maxWidth={280} className="flex-shrink-0">
          <button
            type="button"
            className="focus-ring inline-flex min-h-8 min-w-8 items-center justify-center rounded-md text-gray-400 hover:text-white"
            aria-label="매수 점검이란?"
          >
            <Info className="h-4 w-4" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>

      {/* 모바일 카드 뷰 */}
      <div className="block md:hidden bg-gray-800 rounded-lg border border-border-subtle overflow-hidden">
        {filtered.length > 0 ? filtered.map(w => (
          <div key={w.id} data-watch-id={w.id}>
          <WatchlistMobileCard
            item={w}
            isSelected={selectedIds.has(w.id)}
            onToggleSelect={(id) => {
              const next = new Set<string>(selectedIds);
              if (next.has(id)) next.delete(id); else next.add(id);
              setSelectedIds(next);
            }}
            onDelete={onDelete}
            onOpenEditModal={onOpenEditModal}
            onTogglePin={onTogglePin}
            onToggleTurtle={toggleTurtle}
            onMemoEdit={(item) => setMemoEditItem(item)}
            categories={categories}
            exchangeRates={exchangeRates}
            isPortfolioHeld={portfolioTickers.has(w.ticker.toUpperCase())}
          />
          </div>
        )) : emptyState && (
          <EmptyStateBlock state={emptyState} onClearFilters={clearFilters} onAddItem={onOpenAddModal} />
        )}
      </div>

      {/* 메모 편집 팝업 */}
      {memoEditItem && (
        <MemoEditPopup
          title={memoEditItem.name}
          memo={memoEditItem.notes || ''}
          onSave={(memo) => actions.updateWatchItem({ ...memoEditItem, notes: memo || undefined })}
          onClose={() => setMemoEditItem(null)}
        />
      )}
    </div>
  );
};

export default WatchlistPage;
