import React, { useState } from 'react';
import type { AlertResult, AlertMatchedAsset } from '../../types/alertRules';

interface AlertPopupProps {
  results: AlertResult[];
  onClose: () => void;
  onAssetClick: (assetId: string, source?: 'portfolio' | 'watchlist') => void;
}

const SEVERITY_STYLES: Record<string, { bg: string; border: string; badge: string }> = {
  critical: { bg: 'bg-red-950/50', border: 'border-red-800/60', badge: 'bg-red-600' },
  warning: { bg: 'bg-amber-950/30', border: 'border-amber-800/40', badge: 'bg-amber-600' },
  info: { bg: 'bg-blue-950/30', border: 'border-blue-800/40', badge: 'bg-blue-600' },
};

const fmtPct = (v: number | undefined): string => {
  if (v == null) return '-';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
};

const pctColor = (v: number | undefined): string => {
  if (v == null) return 'text-gray-500';
  if (v > 0) return 'text-red-400';
  if (v < 0) return 'text-blue-400';
  return 'text-gray-400';
};

const AlertPopup: React.FC<AlertPopupProps> = ({ results, onClose, onAssetClick }) => {
  const [isMinimized, setIsMinimized] = useState(false);

  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
  });

  const sellResults = results.filter(r => r.rule.action === 'sell');
  const buyResults = results.filter(r => r.rule.action === 'buy');
  const hasResults = results.length > 0;
  const totalCount = results.reduce((sum, r) => sum + r.matchedAssets.length, 0);

  const renderAssetRow = (asset: AlertMatchedAsset) => {
    const isWatchlist = asset.source === 'watchlist';
    return (
      <tr
        key={`${asset.assetId}-${asset.source || 'p'}`}
        className="border-b border-gray-800/30 last:border-b-0 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => onAssetClick(asset.assetId, asset.source)}
        title={isWatchlist ? '클릭하면 관심종목으로 이동합니다' : '클릭하면 포트폴리오에서 해당 종목으로 이동합니다'}
      >
        <td className="py-1.5 pr-2">
          <div className="flex items-center gap-1.5">
            {isWatchlist && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-teal-600/30 text-teal-400 font-medium shrink-0">
                관심
              </span>
            )}
            <span className="text-white font-medium truncate max-w-[140px]">{asset.assetName}</span>
            <span className="text-gray-600 text-[10px] shrink-0">{asset.ticker}</span>
          </div>
        </td>
        <td className={`text-right py-1.5 px-2 tabular-nums ${pctColor(asset.dailyChange)}`}>
          {fmtPct(asset.dailyChange)}
        </td>
        <td className={`text-right py-1.5 px-2 tabular-nums ${pctColor(asset.returnPct)}`}>
          {fmtPct(asset.returnPct)}
        </td>
        <td className={`text-right py-1.5 pl-2 tabular-nums ${
          asset.rsi != null
            ? asset.rsi < 30 ? 'text-blue-400' : asset.rsi > 70 ? 'text-red-400' : 'text-gray-300'
            : 'text-gray-500'
        }`}>
          {asset.rsi != null ? asset.rsi.toFixed(1) : '-'}
        </td>
        <td className="py-1.5 pl-2 w-5">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </td>
      </tr>
    );
  };

  const renderSection = (sectionResults: AlertResult[], title: string, icon: React.ReactNode, titleColor: string) => {
    if (sectionResults.length === 0) return null;
    return (
      <div>
        <h3 className={`text-xs font-semibold ${titleColor} mb-2 flex items-center gap-1.5`}>
          {icon}
          {title}
          <span className="text-gray-500 font-normal">
            ({sectionResults.reduce((sum, r) => sum + r.matchedAssets.length, 0)}종목)
          </span>
        </h3>
        <div className="space-y-2">
          {sectionResults.map(({ rule, matchedAssets }) => {
            const styles = SEVERITY_STYLES[rule.severity];
            return (
              <div key={rule.id} className={`${styles.bg} border ${styles.border} rounded-lg p-2.5`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${styles.badge} text-white font-medium`}>
                    {rule.name}
                  </span>
                  <span className="text-gray-400 text-[11px]">{rule.description}</span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-700/50">
                      <th className="text-left py-1 pr-2 font-medium">종목</th>
                      <th className="text-right py-1 px-2 font-medium w-14">당일</th>
                      <th className="text-right py-1 px-2 font-medium w-14">수익률</th>
                      <th className="text-right py-1 pl-2 font-medium w-12">RSI</th>
                      <th className="w-5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {matchedAssets.map(renderAssetRow)}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 z-[60] w-auto sm:w-96 flex flex-col shadow-2xl rounded-xl border border-gray-700 overflow-hidden">
      {/* 헤더 — 클릭으로 최소화/복원 토글 */}
      <div
        className="bg-gray-900 px-4 py-3 flex items-center justify-between border-b border-gray-700 shrink-0 cursor-pointer select-none hover:bg-gray-800/60 transition-colors"
        onClick={() => setIsMinimized(v => !v)}
        title={isMinimized ? '펼치기' : '최소화'}
      >
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <div>
            <span className="text-sm font-semibold text-white">오늘의 투자 브리핑</span>
            {hasResults && (
              <span className="ml-2 text-xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-medium">
                {totalCount}건
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* 접기/펼치기 화살표 */}
          <span className="text-gray-400 p-1">
            {isMinimized ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </span>
          {/* 닫기 — 버블링 방지 */}
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="text-gray-400 hover:text-white transition p-1 rounded"
            title="닫기"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* 본문 (최소화 시 숨김) */}
      {!isMinimized && (
        <div className="bg-gray-900 flex flex-col" style={{ maxHeight: '70vh' }}>
          <p className="text-gray-500 text-[11px] px-4 pt-2">{today}</p>
          <div className="px-4 py-3 overflow-y-auto space-y-4 flex-1">
            {hasResults ? (
              <>
                {renderSection(
                  sellResults,
                  '매도 감지',
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>,
                  'text-red-400'
                )}
                {renderSection(
                  buyResults,
                  '매수 기회',
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>,
                  'text-blue-400'
                )}
                <p className="text-gray-600 text-[10px] text-center pb-1">종목을 클릭하면 해당 탭으로 이동합니다</p>
              </>
            ) : (
              <div className="text-center py-6">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mx-auto text-gray-600 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-gray-400 text-sm">현재 특이 시그널이 없습니다.</p>
                <p className="text-gray-500 text-xs mt-1">모든 보유 종목이 정상 범위 내에 있습니다.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AlertPopup;
