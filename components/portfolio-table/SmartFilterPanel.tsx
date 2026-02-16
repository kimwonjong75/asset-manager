import React from 'react';
import type { SmartFilterState, SmartFilterKey } from '../../types/smartFilter';
import { SMART_FILTER_CHIPS, SMART_FILTER_GROUP_LABELS } from '../../constants/smartFilterChips';
import { usePortfolio } from '../../contexts/PortfolioContext';

interface SmartFilterPanelProps {
  filter: SmartFilterState;
  onToggleFilter: (key: SmartFilterKey) => void;
  onClearAll: () => void;
  onDropThresholdChange: (value: number) => void;
  onMaShortPeriodChange: (period: number) => void;
  onMaLongPeriodChange: (period: number) => void;
  matchCount: number;
  totalCount: number;
  sellAlertDropRate: number;
  onSellAlertDropRateChange: (value: number) => void;
  filterAlerts: boolean;
  onFilterAlertsChange: (isActive: boolean) => void;
  isEnrichedLoading?: boolean;
}

const GROUPS = ['ma', 'rsi', 'signal', 'portfolio'] as const;

const MA_SHORT_OPTIONS = [10, 20, 60];
const MA_LONG_OPTIONS = [60, 120, 200];


const SmartFilterPanel: React.FC<SmartFilterPanelProps> = ({
  filter,
  onToggleFilter,
  onClearAll,
  onDropThresholdChange,
  onMaShortPeriodChange,
  onMaLongPeriodChange,
  matchCount,
  totalCount,
  sellAlertDropRate,
  onSellAlertDropRateChange,
  filterAlerts,
  onFilterAlertsChange,
  isEnrichedLoading = false,
}) => {
  const { actions } = usePortfolio();
  const hasActiveFilters = filter.activeFilters.size > 0;

  const handleSellAlertRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value === '' ? 0 : parseInt(e.target.value, 10);
    if (!isNaN(newValue) && newValue >= 0) {
      onSellAlertDropRateChange(newValue);
    }
  };

  // 단기 MA 변경 시 장기보다 작게 유지
  const handleShortPeriodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    const newShort = parseInt(e.target.value, 10);
    onMaShortPeriodChange(newShort);
    if (newShort >= filter.maLongPeriod) {
      const nextLong = MA_LONG_OPTIONS.find(v => v > newShort);
      if (nextLong) onMaLongPeriodChange(nextLong);
    }
  };

  // 장기 MA 변경 시 단기보다 크게 유지
  const handleLongPeriodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    const newLong = parseInt(e.target.value, 10);
    onMaLongPeriodChange(newLong);
    if (newLong <= filter.maShortPeriod) {
      const prevShort = [...MA_SHORT_OPTIONS].reverse().find(v => v < newLong);
      if (prevShort) onMaShortPeriodChange(prevShort);
    }
  };

  const renderChip = (chip: typeof SMART_FILTER_CHIPS[number]) => {
    const isActive = filter.activeFilters.has(chip.key);
    const isLoadingChip = chip.needsEnriched && isEnrichedLoading;
    const isMaPeriodChip = chip.key === 'PRICE_ABOVE_SHORT_MA' || chip.key === 'PRICE_ABOVE_LONG_MA';

    return (
      <button
        key={chip.key}
        onClick={() => onToggleFilter(chip.key)}
        className={`
          px-2 py-0.5 rounded-full text-xs font-medium transition-all flex items-center gap-0.5
          ${isActive
            ? `${chip.colorClass} text-white shadow-sm`
            : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'}
          ${isLoadingChip && isActive ? 'opacity-60' : ''}
        `}
      >
        {isLoadingChip && isActive && (
          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {isMaPeriodChip ? (
          <>
            <span>현재가&gt;</span>
            <select
              value={chip.key === 'PRICE_ABOVE_SHORT_MA' ? filter.maShortPeriod : filter.maLongPeriod}
              onChange={chip.key === 'PRICE_ABOVE_SHORT_MA' ? handleShortPeriodChange : handleLongPeriodChange}
              onClick={(e) => e.stopPropagation()}
              className={`bg-transparent text-xs font-bold focus:outline-none cursor-pointer
                ${isActive ? 'text-white' : 'text-gray-300'}`}
            >
              {(chip.key === 'PRICE_ABOVE_SHORT_MA' ? MA_SHORT_OPTIONS : MA_LONG_OPTIONS).map(p => (
                <option
                  key={p}
                  value={p}
                  disabled={
                    chip.key === 'PRICE_ABOVE_SHORT_MA'
                      ? p >= filter.maLongPeriod
                      : p <= filter.maShortPeriod
                  }
                  className="bg-gray-800 text-gray-200"
                >
                  MA{p}
                </option>
              ))}
            </select>
          </>
        ) : (
          chip.labelFn ? chip.labelFn(filter) : chip.label
        )}
        {chip.key === 'DROP_FROM_HIGH' && isActive && (
          <>
            <input
              type="number"
              value={filter.dropFromHighThreshold}
              onChange={(e) => onDropThresholdChange(
                Math.max(0, parseInt(e.target.value) || 0)
              )}
              onClick={(e) => e.stopPropagation()}
              className="w-10 bg-gray-900 border border-gray-600 rounded px-1 text-white text-xs text-center"
              min="0"
            />
            <span>%</span>
          </>
        )}
      </button>
    );
  };

  return (
    <div className="px-4 sm:px-6 py-2.5 border-b border-gray-700 bg-gray-800/50">
      {/* 필터 그리드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {GROUPS.map(group => {
          const chips = SMART_FILTER_CHIPS.filter(c => c.group === group);
          return (
            <div key={group} className="bg-gray-900 border border-gray-600/50 rounded-lg shadow-md px-2.5 py-2">
              {/* 그룹 헤더 */}
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[11px] text-gray-400 font-medium">
                  {SMART_FILTER_GROUP_LABELS[group]}
                </span>
              </div>
              {/* 칩 목록 */}
              <div className="flex flex-wrap gap-1.5">
                {chips.map(renderChip)}
              </div>
              {/* 포트폴리오 그룹: 매도알림 섹션 */}
              {group === 'portfolio' && (
                <div className="mt-2 pt-1.5 border-t border-gray-600/30">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => onFilterAlertsChange(!filterAlerts)}
                      className={`
                        px-2 py-0.5 rounded-full text-xs font-medium transition-all flex items-center gap-1
                        ${filterAlerts
                          ? 'bg-yellow-600 text-white shadow-sm'
                          : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'}
                      `}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      알림만
                    </button>
                    <div className="flex items-center gap-1 text-[10px] text-gray-400">
                      <span>최고가</span>
                      <input
                        type="number"
                        value={sellAlertDropRate}
                        onChange={handleSellAlertRateChange}
                        min="0"
                        className="w-10 bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-white text-[10px] text-center font-bold focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <span>% 이하</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer: 매칭 수 + 초기화 + 도움말 */}
      <div className="flex items-center justify-end gap-3 mt-2">
        {hasActiveFilters && (
          <>
            <span className="text-xs text-gray-400">
              {matchCount}/{totalCount}개 매칭
            </span>
            <button
              onClick={onClearAll}
              className="text-xs text-gray-400 hover:text-white transition"
            >
              초기화
            </button>
          </>
        )}
        <button
          onClick={() => actions.setActiveTab('guide')}
          className="text-gray-500 hover:text-gray-300 transition flex items-center gap-1"
          title="투자 가이드 보기"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-[10px]">가이드</span>
        </button>
      </div>
    </div>
  );
};

export default SmartFilterPanel;
