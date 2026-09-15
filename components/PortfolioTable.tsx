import React, { Fragment, useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { Asset } from '../types';
import { PortfolioTableProps, ColumnKey } from '../types/ui';
import { COLUMN_DEFINITIONS, toSortableDirection } from './portfolio-table/columnDefinitions';
import ColumnSettingsDropdown from './portfolio-table/ColumnSettingsDropdown';
import { usePortfolioData } from './portfolio-table/usePortfolioData';
import PortfolioTableRow from './portfolio-table/PortfolioTableRow';
import PortfolioMobileCard from './portfolio-table/PortfolioMobileCard';
import ColumnResizeHandle from './portfolio-table/ColumnResizeHandle';
import MemoEditPopup from './common/MemoEditPopup';
import SortableTh from './common/SortableTh';
import { COLUMN_DESCRIPTIONS } from '../constants/columnDescriptions';
import type { SmartFilterState, SmartFilterKey } from '../types/smartFilter';
import { EMPTY_SMART_FILTER } from '../types/smartFilter';
import { matchesSmartFilter } from '../utils/smartFilterLogic';
import SmartFilterPanel from './portfolio-table/SmartFilterPanel';
import { usePortfolio } from '../contexts/PortfolioContext';
import type { AlertRule } from '../types/alertRules';
import { hasResolvableRates } from '../utils/exchangeRateCache';
import { Currency } from '../types';
import { buildTurtlePositionViews, computeTurtleRiskGauge } from '../utils/turtlePositionView';
import TurtleRiskGauge from './portfolio-table/TurtleRiskGauge';
import ActionMenu, { type ActionMenuEntry, type ActionMenuItem } from './common/ActionMenu';
import { applyBulkAssetPatch, buildTurtleCandidateRegistration, type BulkAssetPatch } from '../utils/bulkAssetOps';
import { BUCKET_LABELS } from '../types/bucket';
import { OWNER_LABELS, OWNER_FILTER_LABELS } from '../types/owner';
import { useConfirm } from '../hooks/useConfirm';
import ConfirmDialog from './common/ConfirmDialog';
import Button from './common/Button';
import { isSortKeyOfColumn } from '../utils/columnConfig';
import {
  TABLE_PRESETS,
  detectActiveTablePreset,
  matchesPlanlessSatellite,
  toggleTablePreset,
  type TableFilterSnapshot,
  type TablePresetId,
} from '../utils/smartFilterPresets';
import { describePortfolioEmptyState, type PortfolioEmptyActionKind } from '../utils/portfolioEmptyState';
import {
  Bell,
  ChevronDown,
  CircleAlert,
  ClipboardList,
  Columns3,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
  TriangleAlert,
  X,
} from 'lucide-react';

const sameKeySet = (a: Set<SmartFilterKey>, b: readonly SmartFilterKey[]): boolean =>
  a.size === b.length && b.every(k => a.has(k));

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
  const prevLoadingRef = useRef<boolean>(false);
  const [smartFilter, setSmartFilter] = useState<SmartFilterState>({ ...EMPTY_SMART_FILTER, activeFilters: new Set() });
  // 빠른 보기 '계획 없는 투더문' 축 (세션 필터) — 판정은 utils/tradePlan.isEligibleForBulkPlan
  const [planlessOnly, setPlanlessOnly] = useState(false);
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const [memoEditAsset, setMemoEditAsset] = useState<Asset | null>(null);
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false);
  const bulkMenuRef = useRef<HTMLButtonElement>(null);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef<HTMLButtonElement>(null);
  const [columnSettingsOpen, setColumnSettingsOpen] = useState(false);

  // 실패 목록이 비면 '실패만 보기' 해제 — 렌더 중 상태 조정(수렴 조건부, effect 안 setState 금지 규칙 준수)
  const failedCount = failedIds?.size ?? 0;
  if (showFailedOnly && failedCount === 0) setShowFailedOnly(false);
  const failedOnlyActive = showFailedOnly && failedCount > 0;

  const handleSetHideLowValue = (v: boolean) => {
    setHideLowValue(v);
    try { localStorage.setItem('asset-manager-hide-low-value', v ? '1' : '0'); } catch { /* ignore */ }
  };

  // Context에서 가져오기
  const { derived, ui, actions, data } = usePortfolio();
  const { enrichedMap, isEnrichedLoading } = derived;
  const { confirm, notify, confirmRequest } = useConfirm();

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
    clearSort,
    categoryOptions
  } = usePortfolioData({
    assets,
    exchangeRates,
    categories: data.categoryStore.categories,
    filterAlerts,
    sellAlertDropRate,
    showFailedOnly: failedOnlyActive,
    failedIds,
    enrichedMap,
    badgePairs,
    plBasis: data.valuationSettings.plBasis,
  });

  // ── 필터 스냅샷(스마트 필터 + 경보 종목만 + 계획 없는 투더문) — 빠른 보기 프리셋은 이 3축을 **대체** ──
  const filterSnapshot: TableFilterSnapshot = { smartFilter, filterAlerts, planlessSatellite: planlessOnly };
  const activeTablePreset = detectActiveTablePreset(filterSnapshot);
  const applyFilterSnapshot = (next: TableFilterSnapshot) => {
    setSmartFilter(next.smartFilter);
    setPlanlessOnly(next.planlessSatellite);
    if (next.filterAlerts !== filterAlerts) onFilterAlertsChange(next.filterAlerts);
  };
  const handleTablePresetClick = (id: TablePresetId) => applyFilterSnapshot(toggleTablePreset(filterSnapshot, id));
  const appliedFilterCount = smartFilter.activeFilters.size + (filterAlerts ? 1 : 0) + (planlessOnly ? 1 : 0);

  // 알림 규칙 → 스마트 필터(보기 메뉴 '알림 규칙' 섹션). 빠른 보기와 같은 대체 규약.
  const isRulePresetActive = (rule: AlertRule) =>
    !filterAlerts && !planlessOnly && rule.filters.length > 0 && sameKeySet(smartFilter.activeFilters, rule.filters);
  const handleApplyRulePreset = (rule: AlertRule) => {
    if (isRulePresetActive(rule)) {
      handleClearAllFilters();
      return;
    }
    applyFilterSnapshot({
      smartFilter: {
        ...EMPTY_SMART_FILTER,
        activeFilters: new Set<SmartFilterKey>(rule.filters),
        maShortPeriod: rule.filterConfig.maShortPeriod ?? 20,
        maLongPeriod: rule.filterConfig.maLongPeriod ?? 60,
        dropFromHighThreshold: rule.filterConfig.dropFromHighThreshold ?? 20,
        lossThreshold: rule.filterConfig.lossThreshold ?? 5,
      },
      filterAlerts: false,
      planlessSatellite: false,
    });
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
  const lowValueActive = hideLowValue && ui.lowValueThreshold > 0 && lowValueFilterReady;
  const lowValueWaiting = hideLowValue && !lowValueFilterReady;

  // 터틀 오픈 포지션 표시 모델(assetId 키) + KRW 리스크 게이지 (Phase 2b-5, 읽기 전용)
  // 매칭은 assetId만 신뢰(ticker fallback 없음), 리스크는 per-position fxRate로 KRW 환산 + fail-safe
  const turtleViews = useMemo(
    () => buildTurtlePositionViews(data.turtlePositions, data.assets, exchangeRates, data.turtleSettings),
    [data.turtlePositions, data.assets, exchangeRates, data.turtleSettings],
  );
  const turtleGauge = useMemo(
    () => computeTurtleRiskGauge(data.turtlePositions, data.assets, exchangeRates, data.turtleSettings),
    [data.turtlePositions, data.assets, exchangeRates, data.turtleSettings],
  );

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

  // 스마트 필터 + 핀 필터 + 계획 없는 투더문 + 소액 숨김 적용
  const filteredAssets = useMemo(() => {
    let result = enrichedAndSortedAssets;
    if (showPinnedOnly) {
      result = result.filter(a => a.pinned);
    }
    if (planlessOnly) {
      result = result.filter(a => matchesPlanlessSatellite(a));
    }
    if (lowValueActive) {
      // 핀 고정 자산은 소액이어도 항상 표시 (사용자가 명시적으로 중요 표시한 자산 보호)
      result = result.filter(a => a.pinned || a.metrics.currentValueKRW >= ui.lowValueThreshold);
    }
    if (smartFilter.activeFilters.size > 0) {
      result = result.filter(a => matchesSmartFilter(a, smartFilter, enrichedMap));
    }
    return result;
  }, [enrichedAndSortedAssets, smartFilter, enrichedMap, showPinnedOnly, planlessOnly, lowValueActive, ui.lowValueThreshold]);

  const handleToggleFilter = (key: SmartFilterKey, deactivateKey?: SmartFilterKey) => {
    setSmartFilter(prev => {
      const next = new Set(prev.activeFilters);
      if (deactivateKey) next.delete(deactivateKey);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, activeFilters: next };
    });
  };

  /** 필터 초기화 — 스마트 필터 + 경보 종목만 + 계획 없는 투더문 */
  function handleClearAllFilters() {
    setSmartFilter({ ...EMPTY_SMART_FILTER, activeFilters: new Set() });
    setPlanlessOnly(false);
    if (filterAlerts) onFilterAlertsChange(false);
  }

  /** 빈 상태 '필터 해제' — 세션 필터만(저장 설정인 소액 숨김·계정 뷰는 건드리지 않음) */
  const handleClearSessionFilters = () => {
    handleClearAllFilters();
    setShowPinnedOnly(false);
    setShowFailedOnly(false);
    onSearchChange?.('');
    if (filterCategory !== 'ALL') onFilterChange('ALL');
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

  const handleSelect = (id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  // 정렬 기준 컬럼을 숨기면 정렬 해제(보이지 않는 기준으로 정렬된 채 남지 않도록)
  const handleColumnHidden = (key: ColumnKey) => {
    if (isSortKeyOfColumn(sortConfig?.key, key)) clearSort();
  };

  const allSelected = filteredAssets.length > 0 && filteredAssets.every(a => selectedIds.has(a.id));

  // ── 일괄 변경 (계정/버킷/터틀 후보) — 순수 계산은 utils/bulkAssetOps, 저장은 단일 commitPortfolioPatch ──
  // 패치 대상은 화면 필터와 무관하게 원본 data.assets 기준 (선택 업데이트와 동일 규약: selectedIds 그대로 사용)
  const handleBulkPatch = async (patch: BulkAssetPatch, label: string) => {
    const { assets: nextAssets, changedCount } = applyBulkAssetPatch(data.assets, selectedIds, patch);
    if (changedCount === 0) {
      await notify('선택한 자산이 이미 모두 해당 값입니다.');
      return;
    }
    if (!(await confirm(`선택한 ${selectedIds.size}개 자산 중 ${changedCount}개를 '${label}'(으)로 변경합니다.`))) return;
    actions.commitPortfolioPatch({ assets: nextAssets });
    setSelectedIds(new Set());
  };

  const handleBulkTurtleRegister = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const seqBase = Date.now().toString(36);
    const result = buildTurtleCandidateRegistration(
      data.assets, selectedIds, { makeId: (seq) => `bt-${today}-${seqBase}-${seq}` }, data.watchlist,
    );
    if (result.registeredCount === 0) {
      await notify(
        result.skippedFamily.length > 0
          ? `유선 계정 자산은 터틀 후보로 등록하지 않습니다 (${result.skippedFamily.length}건 제외).`
          : '터틀 후보로 등록할 자산이 없습니다.',
      );
      return;
    }
    const skipNote = result.skippedFamily.length > 0 ? `\n(유선 계정 ${result.skippedFamily.length}건은 제외됩니다: ${result.skippedFamily.join(', ')})` : '';
    if (!(await confirm(`선택한 자산 ${result.registeredCount}개를 투더문(위성) 버킷으로 전환하고 관심종목 터틀 후보로 등록합니다.${skipNote}`))) return;
    actions.commitPortfolioPatch({ assets: result.assets, watchlist: result.watchlist });
    setSelectedIds(new Set());
  };

  // 수익률 헤더 라벨 — 방향 화살표는 SortableTh 아이콘이 담당
  const getReturnHeaderLabel = () => (sortConfig?.key === 'profitLossKRW' ? '평가손익' : '수익률');

  useEffect(() => {
    if (!isLoading && prevLoadingRef.current && failedIds && failedIds.size > 0) {
      void confirm('업데이트에 실패한 항목이 있습니다. 실패한 리스트만 보시겠습니까?').then(ok => {
        if (ok) setShowFailedOnly(true);
      });
    }
    prevLoadingRef.current = isLoading;
  }, [isLoading, failedIds, confirm]);

  // ── 빈 상태 — 원인·버튼은 utils/portfolioEmptyState ──
  const emptyState = describePortfolioEmptyState({
    visibleCount: filteredAssets.length,
    totalAssetCount: data.assets.length,
    failedOnly: failedOnlyActive,
    searchActive: searchQuery.trim().length > 0,
    categoryActive: filterCategory !== 'ALL',
    smartFilterCount: smartFilter.activeFilters.size,
    planlessSatellite: planlessOnly,
    pinnedOnly: showPinnedOnly,
    alertsOnly: filterAlerts,
    lowValueActive,
    lowValueThreshold: ui.lowValueThreshold,
    accountViewActive: ui.accountView !== 'ALL',
    accountLabel: OWNER_FILTER_LABELS[ui.accountView],
  });
  const handleEmptyAction = (kind: PortfolioEmptyActionKind) => {
    switch (kind) {
      case 'clearSessionFilters': handleClearSessionFilters(); break;
      case 'disableLowValue': handleSetHideLowValue(false); break;
      case 'accountAll': actions.setAccountView('ALL'); break;
      case 'showAllFailed': setShowFailedOnly(false); break;
    }
  };
  const emptyContent = emptyState && (
    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center" role="status">
      <p className="text-sm text-gray-400">{emptyState.message}</p>
      {emptyState.actions.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {emptyState.actions.map((a, i) => (
            <Button key={a.kind} variant={i === 0 ? 'secondary' : 'ghost'} onClick={() => handleEmptyAction(a.kind)}>
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );

  // ── 보기 메뉴 ──
  const ruleItems = (action: 'sell' | 'buy'): ActionMenuItem[] =>
    ui.alertSettings.rules.filter(r => r.action === action && r.enabled).map(rule => ({
      label: rule.name,
      checked: isRulePresetActive(rule),
      icon: (
        <span
          className={`block h-2 w-2 rounded-full ${action === 'buy' ? 'bg-up' : rule.severity === 'critical' ? 'bg-warning' : 'bg-warning/50'}`}
        />
      ),
      onClick: () => handleApplyRulePreset(rule),
    }));
  // 컬럼 설정은 데스크탑 표 전용(모바일 카드는 컬럼 개념 없음)
  const isDesktop = typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 768px)').matches;
  const viewActiveCount = (showPinnedOnly ? 1 : 0) + (hideLowValue ? 1 : 0) + (filterAlerts ? 1 : 0);
  const viewMenuItems: ActionMenuEntry[] = [
    { type: 'section', label: '표시' },
    { label: '중요 종목만', checked: showPinnedOnly, keepOpen: true, onClick: () => setShowPinnedOnly(v => !v) },
    {
      label: lowValueWaiting
        ? '소액 숨김 (환율 대기 — 일시 정지)'
        : `소액 숨김 (${ui.lowValueThreshold.toLocaleString('ko-KR')}원 미만)`,
      checked: hideLowValue,
      keepOpen: true,
      colorClass: lowValueWaiting ? 'text-warning' : undefined,
      onClick: () => handleSetHideLowValue(!hideLowValue),
    },
    { label: '경보 종목만', checked: filterAlerts, keepOpen: true, onClick: () => onFilterAlertsChange(!filterAlerts) },
    ...(isDesktop ? [{ label: '컬럼 설정…', icon: <Columns3 />, onClick: () => setColumnSettingsOpen(true) }] : []),
    { type: 'section', label: '알림 규칙 · 매도' },
    ...ruleItems('sell'),
    { type: 'section', label: '알림 규칙 · 매수' },
    ...ruleItems('buy'),
    { type: 'separator' },
    { label: '알림 설정', icon: <Settings />, onClick: () => actions.setActiveTab('settings') },
    { label: '브리핑 다시 보기', icon: <Bell />, onClick: () => actions.showBriefingPopup() },
    ...(appliedFilterCount > 0 ? [{ label: '필터 초기화', icon: <RotateCcw />, onClick: handleClearAllFilters }] : []),
  ];

  const thClasses = "relative px-4 py-3 sticky top-0 bg-gray-700 z-10 whitespace-nowrap";

  return (
    <div className="bg-gray-800 rounded-lg border border-border-subtle">
      {confirmRequest && <ConfirmDialog {...confirmRequest} />}
      {/* 툴바 — 선택 중이면 선택 작업 바, 아니면 검색 · 카테고리 · 보기 */}
      <div className="bg-gray-800 px-3 sm:px-6 pt-3 sm:pt-5 pb-2 sm:pb-3 border-b border-gray-700">
        {selectedIds.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="선택한 자산 작업">
            <span className="text-sm font-semibold text-white whitespace-nowrap">{selectedIds.size}개 선택</span>
            <Button
              ref={bulkMenuRef}
              variant="primary"
              iconRight={<ChevronDown />}
              onClick={() => setBulkMenuOpen(prev => !prev)}
              disabled={isLoading}
              className="whitespace-nowrap"
              title="선택한 자산의 계정/버킷을 한 번에 변경하거나 터틀 후보로 등록합니다"
              aria-haspopup="menu"
              aria-expanded={bulkMenuOpen}
            >
              일괄 변경
            </Button>
            {bulkMenuOpen && (
              <ActionMenu
                anchorRef={bulkMenuRef}
                header={`${selectedIds.size}개 자산 일괄 변경`}
                items={[
                  { label: `계정 → ${OWNER_LABELS.WONJONG}`, onClick: () => handleBulkPatch({ owner: 'WONJONG' }, `계정: ${OWNER_LABELS.WONJONG}`) },
                  { label: `계정 → ${OWNER_LABELS.YUSEON}`, onClick: () => handleBulkPatch({ owner: 'YUSEON' }, `계정: ${OWNER_LABELS.YUSEON}`) },
                  { label: `버킷 → ${BUCKET_LABELS.CORE}`, onClick: () => handleBulkPatch({ bucket: 'CORE' }, `버킷: ${BUCKET_LABELS.CORE}`) },
                  { label: `버킷 → ${BUCKET_LABELS.SATELLITE}`, onClick: () => handleBulkPatch({ bucket: 'SATELLITE' }, `버킷: ${BUCKET_LABELS.SATELLITE}`) },
                  { label: '🐢 터틀 후보 등록', onClick: handleBulkTurtleRegister, colorClass: 'text-purple-300' },
                  { label: '투더문 일괄 계획 만들기', icon: <ClipboardList className="h-4 w-4" />, onClick: actions.openTradePlanBulk, colorClass: 'text-primary-light' },
                ]}
                onClose={() => setBulkMenuOpen(false)}
              />
            )}
            {onRefreshSelected && (
              <Button
                variant="secondary"
                icon={<RefreshCw />}
                onClick={() => onRefreshSelected(Array.from(selectedIds))}
                loading={isLoading}
                className="whitespace-nowrap"
              >
                {isLoading ? '업데이트 중...' : '선택 업데이트'}
              </Button>
            )}
            <Button variant="ghost" icon={<X />} onClick={() => setSelectedIds(new Set())} className="whitespace-nowrap">
              선택 해제
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h2 className="hidden lg:block text-xl font-bold text-white whitespace-nowrap mr-2">포트폴리오 현황</h2>
            {onSearchChange && (
              <div className="relative min-w-0 flex-1 sm:flex-none">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="종목 검색"
                  aria-label="포트폴리오 검색"
                  className="w-full sm:w-64 min-h-9 bg-gray-700 border border-gray-600 rounded-md py-1.5 pl-9 pr-9 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => onSearchChange('')}
                    aria-label="검색어 지우기"
                    className="focus-ring absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-gray-400 hover:text-white"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
            <div className="relative shrink-0">
              <select
                value={filterCategory}
                aria-label="카테고리"
                onChange={(e) => { const v = e.target.value; onFilterChange(v === 'ALL' || v === 'SATELLITE' ? v : Number(v)); }}
                className="appearance-none min-h-9 max-w-[7.5rem] sm:max-w-none bg-gray-700 border border-gray-600 text-white text-sm rounded-md py-1.5 pl-3 pr-8 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="ALL">전체 자산</option>
                {categoryOptions.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
                <option value="SATELLITE">{BUCKET_LABELS.SATELLITE} (위성)</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            </div>
            <div className="ml-auto shrink-0">
              <Button
                ref={viewMenuRef}
                variant="secondary"
                icon={<SlidersHorizontal />}
                iconRight={<ChevronDown />}
                onClick={() => {
                  // 컬럼 설정 팝오버가 열려 있으면 앵커 재클릭 = 그것만 닫기(앵커 클릭은 Popover 바깥 클릭이 아님)
                  if (columnSettingsOpen) {
                    setColumnSettingsOpen(false);
                    return;
                  }
                  setViewMenuOpen(prev => !prev);
                }}
                aria-haspopup="menu"
                aria-expanded={viewMenuOpen || columnSettingsOpen}
                className="whitespace-nowrap"
              >
                보기{viewActiveCount > 0 ? ` · ${viewActiveCount}` : ''}
              </Button>
              {/* '컬럼 설정…' 패널 — 공용 Popover(포털) 안에 렌더, '보기' 버튼에 끝 정렬 */}
              <ColumnSettingsDropdown
                anchorRef={viewMenuRef}
                open={columnSettingsOpen}
                onClose={() => setColumnSettingsOpen(false)}
                onColumnHidden={handleColumnHidden}
              />
            </div>
            {viewMenuOpen && (
              <ActionMenu
                anchorRef={viewMenuRef}
                header="표 보기 설정"
                width="md"
                items={viewMenuItems}
                onClose={() => setViewMenuOpen(false)}
              />
            )}
          </div>
        )}

        {/* 빠른 보기 프리셋 — 패널 접힘과 무관하게 항상 노출. 활성 칩 재클릭 = 해제 */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="빠른 보기">
          {TABLE_PRESETS.map(p => {
            const active = activeTablePreset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={active}
                title={p.description}
                onClick={() => handleTablePresetClick(p.id)}
                className={`focus-ring inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors ${
                  active
                    ? 'border-primary bg-primary-dark text-white'
                    : 'border-border-subtle bg-surface-muted text-gray-300 hover:bg-gray-600 hover:text-white'
                }`}
              >
                {p.label}
              </button>
            );
          })}
          {lowValueWaiting && (
            <span className="inline-flex items-center gap-1 text-xs text-warning" title="외화 자산 환율을 아직 못 받아 원화 환산이 불가합니다. 시세 갱신 후 자동으로 다시 적용됩니다.">
              <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
              환율 대기 — 소액 숨김 일시 정지
            </span>
          )}
        </div>
      </div>

      {/* 스마트 필터 패널 (기본 접힘) */}
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
        appliedCount={appliedFilterCount}
      />

      {/* 터틀 오픈 리스크 게이지 (KRW) — 오픈 포지션 있을 때만. 테이블 위 sibling(overflow wrapper 아님) */}
      <TurtleRiskGauge gauge={turtleGauge} />

      {/* 실패만 보기 상태 바 — 목록이 비면 플래그 자동 해제 */}
      {failedOnlyActive && (
        <div role="status" className="flex flex-wrap items-center gap-2 border-b border-gray-700 bg-warning-soft px-3 py-1.5 text-sm text-warning sm:px-6">
          <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>업데이트 실패 {failedCount}개만 보는 중</span>
          <Button variant="ghost" onClick={() => setShowFailedOnly(false)}>전체 보기</Button>
        </div>
      )}

      {/* 데스크탑: 테이블 — overflow 없음, thead가 main 스크롤 기준 sticky */}
      {/* table-layout: fixed — 사용자가 지정한 컬럼 너비를 엄격히 적용해 콘텐츠 크기와 무관하게 가로 스크롤 방지 */}
      <div className="hidden md:block">
        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
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
                <input
                  type="checkbox"
                  aria-label="보이는 자산 전체 선택"
                  checked={allSelected}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedIds(new Set(filteredAssets.map(a => a.id)));
                    else setSelectedIds(new Set());
                  }}
                />
              </th>
              <SortableTh
                label={<span>종목명</span>}
                sortKey="name"
                activeKey={sortConfig?.key ?? null}
                direction={toSortableDirection(sortConfig)}
                onSort={() => requestSort('name')}
                className={`${thClasses} z-20`}
                tooltip={COLUMN_DESCRIPTIONS.name}
                style={getThStyle('name')}
              >
                <ColumnResizeHandle
                  columnKey="name"
                  onResize={(w) => actions.setFixedColumnWidth('name', w)}
                  onDragPreview={(w) => setDragOverride(w !== null ? { key: 'name', width: w } : null)}
                />
              </SortableTh>
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
                onSelect={handleSelect}
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
                turtle={turtleViews.get(asset.id)}
              />
              );
            }) : (
              <tr><td colSpan={totalColSpan}>{emptyContent}</td></tr>
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
            selected={selectedIds.has(asset.id)}
            onSelect={handleSelect}
            onEdit={onEdit}
            onSell={onSell}
            onBuy={onBuy}
            onRefreshOne={onRefreshOne}
            exchangeRates={exchangeRates}
            onTogglePin={actions.togglePinAsset}
            onMemoEdit={(asset) => setMemoEditAsset(asset)}
            gcCrossDays={gcRaw != null && gcRaw >= 0 ? gcRaw : null}
            dcCrossDays={dcRaw != null && dcRaw < 0 ? dcRaw : null}
            turtle={turtleViews.get(asset.id)}
          />
          );
        }) : emptyContent}
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
