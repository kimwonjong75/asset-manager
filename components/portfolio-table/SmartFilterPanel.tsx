import React, { useState } from 'react';
import type { SmartFilterState, SmartFilterKey } from '../../types/smartFilter';
import { SMART_FILTER_CHIPS, SMART_FILTER_GROUP_LABELS } from '../../constants/smartFilterChips';

interface SmartFilterPanelProps {
  filter: SmartFilterState;
  onToggleFilter: (key: SmartFilterKey) => void;
  onClearAll: () => void;
  onDropThresholdChange: (value: number) => void;
  matchCount: number;
  totalCount: number;
  sellAlertDropRate: number;
  onSellAlertDropRateChange: (value: number) => void;
  filterAlerts: boolean;
  onFilterAlertsChange: (isActive: boolean) => void;
}

const GROUPS = ['ma', 'rsi', 'signal', 'portfolio'] as const;

const FILTER_HELP_SECTIONS = [
  {
    title: '필터 조합 규칙',
    items: [
      '같은 그룹 내: OR (하나라도 해당되면 표시)',
      '다른 그룹 간: AND (모든 그룹 조건 충족 시 표시)',
      '예: [정배열] + [매수] → 정배열이면서 매수 신호인 종목만 표시',
    ],
  },
  {
    title: '이동평균',
    items: [
      '현재 종가와 20일/60일 이동평균선 비교',
      '정배열: 가격 > MA20 > MA60 (상승 추세)',
      '역배열: 가격 < MA20 < MA60 (하락 추세)',
    ],
  },
  {
    title: 'RSI',
    items: [
      '14일 RSI 기준',
      '과매수 (RSI ≥ 70): 과열 구간, 조정 가능성',
      '과매도 (RSI ≤ 30): 침체 구간, 반등 가능성',
    ],
  },
  {
    title: '매매신호',
    items: ['기술적 분석 기반 매수/매도 추천 강도'],
  },
  {
    title: '포트폴리오',
    items: ['현재 수익/손실 상태, 고점 대비 하락폭 기준 필터링'],
  },
  {
    title: '매도알림',
    items: ['52주 최고가 대비 설정 비율(%) 이상 하락 시 경고 표시'],
  },
];

const SmartFilterPanel: React.FC<SmartFilterPanelProps> = ({
  filter,
  onToggleFilter,
  onClearAll,
  onDropThresholdChange,
  matchCount,
  totalCount,
  sellAlertDropRate,
  onSellAlertDropRateChange,
  filterAlerts,
  onFilterAlertsChange,
}) => {
  const hasActiveFilters = filter.activeFilters.size > 0;
  const [showHelp, setShowHelp] = useState(false);

  const handleSellAlertRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value === '' ? 0 : parseInt(e.target.value, 10);
    if (!isNaN(newValue) && newValue >= 0) {
      onSellAlertDropRateChange(newValue);
    }
  };

  return (
    <div className="px-4 sm:px-6 py-2.5 border-b border-gray-700 bg-gray-800/50">
      {/* 필터 그리드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {GROUPS.map(group => {
          const chips = SMART_FILTER_CHIPS.filter(c => c.group === group);
          return (
            <div key={group} className="bg-gray-700/30 rounded-lg px-2.5 py-2">
              <span className="text-[11px] text-gray-500 block mb-1.5">
                {SMART_FILTER_GROUP_LABELS[group]}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {chips.map(chip => {
                  const isActive = filter.activeFilters.has(chip.key);
                  return (
                    <button
                      key={chip.key}
                      onClick={() => onToggleFilter(chip.key)}
                      className={`
                        px-2 py-0.5 rounded-full text-xs font-medium transition-all flex items-center gap-1
                        ${isActive
                          ? `${chip.colorClass} text-white shadow-sm`
                          : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'}
                      `}
                    >
                      {chip.label}
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
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* 매도알림 Footer + 필터 도움말 */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-700/50">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onFilterAlertsChange(!filterAlerts)}
            className={`
              px-2.5 py-1 rounded-full text-xs font-medium transition-all flex items-center gap-1
              ${filterAlerts
                ? 'bg-yellow-600 text-white shadow-sm'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'}
            `}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            알림만 보기
          </button>
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <span>최고가 대비</span>
            <input
              type="number"
              value={sellAlertDropRate}
              onChange={handleSellAlertRateChange}
              min="0"
              className="w-12 bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-white text-xs text-center font-bold focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span>% 이하 하락 시 알림</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
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
            onClick={() => setShowHelp(true)}
            className="text-gray-500 hover:text-gray-300 transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* 필터 도움말 모달 */}
      {showHelp && (
        <div
          className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50"
          onClick={() => setShowHelp(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white">스마트 필터 사용법</h3>
              <button
                onClick={() => setShowHelp(false)}
                className="text-gray-400 hover:text-white transition"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="space-y-3 text-sm">
              {FILTER_HELP_SECTIONS.map((section, i) => (
                <div key={i}>
                  <h4 className="text-xs font-semibold text-gray-300 mb-1">{section.title}</h4>
                  <ul className="space-y-0.5">
                    {section.items.map((item, j) => (
                      <li key={j} className="text-xs text-gray-400 pl-2">· {item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SmartFilterPanel;
