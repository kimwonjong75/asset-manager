import React, { useId, useState } from 'react';
import { ChevronDown, Info, Loader2, RotateCcw, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import type { SmartFilterState, SmartFilterKey } from '../../types/smartFilter';
import { SMART_FILTER_CHIPS, SMART_FILTER_GROUP_LABELS } from '../../constants/smartFilterChips';
import { usePortfolio } from '../../contexts/PortfolioContext';
import Tooltip from '../common/Tooltip';
import Button from '../common/Button';

// SmartFilterPanel — 스마트 필터 칩 패널 (Stage D1)
//   · 모든 화면 폭에서 기본 접힘. 펼침 여부는 localStorage('asset-manager-smart-filter-open', 'true'/'false')에 기억.
//   · 접힌 헤더: "필터 · 적용 N개" 토글 버튼과 [초기화] 버튼은 **형제**(버튼 안 버튼 금지).
//   · 칩: 토글 <button aria-pressed> 와 그 옆 기간 <select>/임계 <input> 을 형제로 둔다(인터랙티브 중첩 금지).
//   · '최고가 N% 이하' 입력은 필터가 아니라 Drive 에 저장되는 설정(sellAlertDropRate) — 펼친 패널 안에 명시 라벨로.

const OPEN_STORAGE_KEY = 'asset-manager-smart-filter-open';

interface SmartFilterPanelProps {
  filter: SmartFilterState;
  onToggleFilter: (key: SmartFilterKey, deactivateKey?: SmartFilterKey) => void;
  /** 필터 전부 해제(스마트 필터 + 경보 종목만 + 빠른 보기 축) */
  onClearAll: () => void;
  onDropThresholdChange: (value: number) => void;
  onLossThresholdChange: (value: number) => void;
  onMaShortPeriodChange: (period: number) => void;
  onMaLongPeriodChange: (period: number) => void;
  matchCount: number;
  totalCount: number;
  sellAlertDropRate: number;
  onSellAlertDropRateChange: (value: number) => void;
  filterAlerts: boolean;
  onFilterAlertsChange: (isActive: boolean) => void;
  isEnrichedLoading?: boolean;
  /** 접힌 헤더에 표시할 적용 중 필터 수(스마트 필터 키 + 경보 종목만 + 빠른 보기 축) */
  appliedCount: number;
}

const GROUPS = ['ma', 'rsi', 'signal', 'portfolio'] as const;

const MA_SHORT_OPTIONS = [5, 10, 20, 60];
const MA_LONG_OPTIONS = [60, 120, 200];

const readOpen = (): boolean => {
  try { return localStorage.getItem(OPEN_STORAGE_KEY) === 'true'; } catch { return false; }
};

const SmartFilterPanel: React.FC<SmartFilterPanelProps> = ({
  filter,
  onToggleFilter,
  onClearAll,
  onDropThresholdChange,
  onLossThresholdChange,
  onMaShortPeriodChange,
  onMaLongPeriodChange,
  matchCount,
  totalCount,
  sellAlertDropRate,
  onSellAlertDropRateChange,
  filterAlerts,
  onFilterAlertsChange,
  isEnrichedLoading = false,
  appliedCount,
}) => {
  const { actions } = usePortfolio();
  const [open, setOpen] = useState<boolean>(readOpen);
  const panelId = useId();

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(OPEN_STORAGE_KEY, next ? 'true' : 'false'); } catch { /* ignore */ }
  };

  const handleSellAlertRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value === '' ? 0 : parseInt(e.target.value, 10);
    if (!isNaN(newValue) && newValue >= 0) {
      onSellAlertDropRateChange(newValue);
    }
  };

  // 단기 MA 변경 시 장기보다 작게 유지
  const handleShortPeriodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newShort = parseInt(e.target.value, 10);
    onMaShortPeriodChange(newShort);
    if (newShort >= filter.maLongPeriod) {
      const nextLong = MA_LONG_OPTIONS.find(v => v > newShort);
      if (nextLong) onMaLongPeriodChange(nextLong);
    }
  };

  // 장기 MA 변경 시 단기보다 크게 유지
  const handleLongPeriodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newLong = parseInt(e.target.value, 10);
    onMaLongPeriodChange(newLong);
    if (newLong <= filter.maShortPeriod) {
      const prevShort = [...MA_SHORT_OPTIONS].reverse().find(v => v < newLong);
      if (prevShort) onMaShortPeriodChange(prevShort);
    }
  };

  const renderChip = (chip: typeof SMART_FILTER_CHIPS[number]) => {
    const isActive = filter.activeFilters.has(chip.key);
    const isPairActive = chip.pairKey ? filter.activeFilters.has(chip.pairKey) : false;
    const isAnyActive = isActive || isPairActive;
    const isLoadingChip = chip.needsEnriched && isEnrichedLoading;
    const isMaPeriodChip = chip.key === 'PRICE_ABOVE_SHORT_MA' || chip.key === 'PRICE_ABOVE_LONG_MA';

    // tri-state 칩: 클릭 시 off → above(>) → below(<) → off 순환
    const handleTriStateClick = () => {
      if (!chip.pairKey) return;
      if (!isActive && !isPairActive) onToggleFilter(chip.key);
      else if (isActive) onToggleFilter(chip.pairKey, chip.key);
      else onToggleFilter(chip.pairKey);
    };

    const activeColorClass = isPairActive ? chip.pairColorClass ?? chip.colorClass : chip.colorClass;
    const directionSymbol = isActive ? '>' : isPairActive ? '<' : '↕';
    const label = isMaPeriodChip ? `현재가${directionSymbol}` : (chip.labelFn ? chip.labelFn(filter) : chip.label);

    return (
      <Tooltip key={chip.key} content={chip.description} position="bottom" wrap>
        <span
          className={`inline-flex items-center gap-0.5 rounded-full text-xs font-medium transition-all
            ${isAnyActive ? `${activeColorClass} text-white` : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'}
            ${isLoadingChip && isAnyActive ? 'opacity-60' : ''}`}
        >
          <button
            type="button"
            aria-pressed={isAnyActive}
            onClick={isMaPeriodChip ? handleTriStateClick : () => onToggleFilter(chip.key)}
            className={`focus-ring inline-flex items-center gap-0.5 rounded-full py-0.5 pl-2 ${isMaPeriodChip || (isActive && (chip.key === 'DROP_FROM_HIGH' || chip.key === 'LOSS_THRESHOLD')) ? 'pr-0.5' : 'pr-2'}`}
          >
            {isLoadingChip && isAnyActive && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
            {label}
          </button>
          {isMaPeriodChip && (
            <select
              aria-label={chip.key === 'PRICE_ABOVE_SHORT_MA' ? '단기 이동평균 기간' : '장기 이동평균 기간'}
              value={chip.key === 'PRICE_ABOVE_SHORT_MA' ? filter.maShortPeriod : filter.maLongPeriod}
              onChange={chip.key === 'PRICE_ABOVE_SHORT_MA' ? handleShortPeriodChange : handleLongPeriodChange}
              className={`focus-ring mr-1 cursor-pointer rounded bg-transparent text-xs font-bold ${isAnyActive ? 'text-white' : 'text-gray-300'}`}
            >
              {(chip.key === 'PRICE_ABOVE_SHORT_MA' ? MA_SHORT_OPTIONS : MA_LONG_OPTIONS).map(p => (
                <option
                  key={p}
                  value={p}
                  disabled={chip.key === 'PRICE_ABOVE_SHORT_MA' ? p >= filter.maLongPeriod : p <= filter.maShortPeriod}
                  className="bg-gray-800 text-gray-200"
                >
                  MA{p}
                </option>
              ))}
            </select>
          )}
          {chip.key === 'DROP_FROM_HIGH' && isActive && (
            <span className="inline-flex items-center gap-0.5 pr-2">
              <input
                type="number"
                aria-label="고점 대비 하락 기준(%)"
                value={filter.dropFromHighThreshold}
                onChange={(e) => onDropThresholdChange(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-10 bg-gray-900 border border-gray-600 rounded px-1 text-white text-xs text-center"
                min="0"
              />
              <span>%</span>
            </span>
          )}
          {chip.key === 'LOSS_THRESHOLD' && isActive && (
            <span className="inline-flex items-center gap-0.5 pr-2">
              <input
                type="number"
                aria-label="손실 기준(%)"
                value={filter.lossThreshold}
                onChange={(e) => onLossThresholdChange(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-10 bg-gray-900 border border-gray-600 rounded px-1 text-white text-xs text-center"
                min="0"
              />
              <span>%</span>
            </span>
          )}
        </span>
      </Tooltip>
    );
  };

  const filterGrid = (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
      {GROUPS.map(group => {
        const chips = SMART_FILTER_CHIPS.filter(c => c.group === group);
        return (
          <div key={group} className="bg-gray-900 border border-gray-600/50 rounded-lg px-2.5 py-2">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-xs text-gray-400 font-medium">{SMART_FILTER_GROUP_LABELS[group]}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {chips.map(renderChip)}
            </div>
            {/* 매매신호 그룹: 거래량 칩 병합 */}
            {group === 'signal' && (
              <div className="mt-1.5 pt-1.5 border-t border-gray-600/30">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-xs text-gray-400 font-medium">{SMART_FILTER_GROUP_LABELS['volume']}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SMART_FILTER_CHIPS.filter(c => c.group === 'volume').map(renderChip)}
                </div>
              </div>
            )}
            {/* 포트폴리오 그룹: 경보 종목만 필터 + 경보 기준(저장되는 설정) */}
            {group === 'portfolio' && (
              <div className="mt-2 pt-1.5 border-t border-gray-600/30 space-y-1.5">
                <button
                  type="button"
                  aria-pressed={filterAlerts}
                  onClick={() => onFilterAlertsChange(!filterAlerts)}
                  className={`focus-ring inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-all ${
                    filterAlerts
                      ? 'border-warning/40 bg-warning-soft text-warning'
                      : 'border-transparent bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'
                  }`}
                >
                  <TriangleAlert className="h-3 w-3" aria-hidden="true" />
                  경보 종목만
                </button>
                <label className="flex flex-wrap items-center gap-1 text-xs text-gray-400">
                  <span>경보 기준: 최고가 대비</span>
                  <input
                    type="number"
                    value={sellAlertDropRate}
                    onChange={handleSellAlertRateChange}
                    min="0"
                    className="w-10 bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-white text-xs text-center font-bold focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span>% 이하 <span className="text-gray-500">(저장되는 설정)</span></span>
                </label>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="px-3 sm:px-6 py-1.5 border-b border-gray-700 bg-gray-800/50">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={open}
          aria-controls={panelId}
          className="focus-ring inline-flex min-h-9 items-center gap-2 rounded-md px-1 text-sm text-gray-300 hover:text-white"
        >
          <SlidersHorizontal className="h-4 w-4 text-gray-400" aria-hidden="true" />
          <span className="font-medium">필터{appliedCount > 0 ? ` · 적용 ${appliedCount}개` : ''}</span>
          {appliedCount > 0 && <span className="text-xs text-gray-400">{matchCount}/{totalCount}개</span>}
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        <div className="flex items-center gap-1">
          {appliedCount > 0 && (
            <Button variant="ghost" icon={<RotateCcw />} onClick={onClearAll}>
              초기화
            </Button>
          )}
          <Button variant="ghost" icon={<Info />} onClick={() => actions.setActiveTab('guide')} title="투자 가이드 보기">
            가이드
          </Button>
        </div>
      </div>
      {open && (
        <div id={panelId} className="mt-1 pb-1">
          {filterGrid}
        </div>
      )}
    </div>
  );
};

export default SmartFilterPanel;
