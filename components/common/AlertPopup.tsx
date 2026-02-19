import React from 'react';
import type { AlertResult, AlertMatchedAsset } from '../../types/alertRules';

interface AlertPopupProps {
  results: AlertResult[];
  onClose: () => void;
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

const AlertPopup: React.FC<AlertPopupProps> = ({ results, onClose }) => {
  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
  });

  const sellResults = results.filter(r => r.rule.action === 'sell');
  const buyResults = results.filter(r => r.rule.action === 'buy');
  const hasResults = results.length > 0;

  const renderAssetTable = (assets: AlertMatchedAsset[]) => (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-gray-500 border-b border-gray-700/50">
          <th className="text-left py-1.5 pr-2 font-medium">종목</th>
          <th className="text-right py-1.5 px-2 font-medium w-16">당일</th>
          <th className="text-right py-1.5 px-2 font-medium w-16">수익률</th>
          <th className="text-right py-1.5 px-2 font-medium w-16">고점대비</th>
          <th className="text-right py-1.5 pl-2 font-medium w-14">RSI</th>
        </tr>
      </thead>
      <tbody>
        {assets.map(asset => (
          <tr key={asset.assetId} className="border-b border-gray-800/30 last:border-b-0">
            <td className="py-1.5 pr-2">
              <div className="flex items-center gap-1.5">
                <span className="text-white font-medium truncate max-w-[120px]">{asset.assetName}</span>
                <span className="text-gray-600 text-[10px] shrink-0">{asset.ticker}</span>
              </div>
            </td>
            <td className={`text-right py-1.5 px-2 tabular-nums ${pctColor(asset.dailyChange)}`}>
              {fmtPct(asset.dailyChange)}
            </td>
            <td className={`text-right py-1.5 px-2 tabular-nums ${pctColor(asset.returnPct)}`}>
              {fmtPct(asset.returnPct)}
            </td>
            <td className={`text-right py-1.5 px-2 tabular-nums ${asset.dropFromHigh != null ? 'text-blue-400' : 'text-gray-500'}`}>
              {asset.dropFromHigh != null ? `${asset.dropFromHigh.toFixed(1)}%` : '-'}
            </td>
            <td className={`text-right py-1.5 pl-2 tabular-nums ${
              asset.rsi != null
                ? asset.rsi < 30 ? 'text-blue-400' : asset.rsi > 70 ? 'text-red-400' : 'text-gray-300'
                : 'text-gray-500'
            }`}>
              {asset.rsi != null ? asset.rsi.toFixed(1) : '-'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const renderSection = (sectionResults: AlertResult[], title: string, icon: React.ReactNode, titleColor: string) => {
    if (sectionResults.length === 0) return null;
    return (
      <div>
        <h3 className={`text-sm font-semibold ${titleColor} mb-2.5 flex items-center gap-2`}>
          {icon}
          {title}
          <span className="text-gray-500 text-xs font-normal">
            ({sectionResults.reduce((sum, r) => sum + r.matchedAssets.length, 0)}종목)
          </span>
        </h3>
        <div className="space-y-3">
          {sectionResults.map(({ rule, matchedAssets }) => {
            const styles = SEVERITY_STYLES[rule.severity];
            return (
              <div key={rule.id} className={`${styles.bg} border ${styles.border} rounded-lg p-3`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${styles.badge} text-white font-medium`}>
                    {rule.name}
                  </span>
                  <span className="text-gray-400 text-xs">{rule.description}</span>
                </div>
                {renderAssetTable(matchedAssets)}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[95%] max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">오늘의 투자 브리핑</h2>
            <p className="text-gray-400 text-xs mt-0.5">{today}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition p-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 본문 */}
        <div className="px-6 py-4 overflow-y-auto space-y-5 flex-1">
          {hasResults ? (
            <>
              {renderSection(
                sellResults,
                '매도 감지',
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>,
                'text-red-400'
              )}
              {renderSection(
                buyResults,
                '매수 기회',
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>,
                'text-blue-400'
              )}
            </>
          ) : (
            <div className="text-center py-8">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-gray-600 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-gray-400 text-sm">현재 특이 시그널이 없습니다.</p>
              <p className="text-gray-500 text-xs mt-1">모든 보유 종목이 정상 범위 내에 있습니다.</p>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-6 py-3 border-t border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="bg-primary hover:bg-primary-dark text-white text-sm font-medium px-4 py-2 rounded-md transition"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
};

export default AlertPopup;
