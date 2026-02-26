import React from 'react';
import { useGoldPremium } from '../hooks/useGoldPremium';

function formatKRW(value: number): string {
  return value > 0
    ? `₩${value.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}/g`
    : '-';
}

function formatPremium(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

const GoldPremiumWidget: React.FC = () => {
  const { data, loading, error, refresh } = useGoldPremium();

  const hasData = data && data.domesticPriceKRW > 0 && data.internationalPriceKRW > 0;

  const premiumColor = hasData
    ? data.premium >= 0
      ? 'text-red-400'
      : 'text-blue-400'
    : 'text-gray-500';

  const displayValue = (v: number | undefined) =>
    loading && !data ? '...' : formatKRW(v ?? 0);

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg overflow-hidden">
      <div className="flex items-stretch divide-x divide-gray-700">

        {/* 타이틀 */}
        <div className="flex items-center px-4 py-3 shrink-0">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-400 whitespace-nowrap">
            금 김치 프리미엄
          </span>
        </div>

        {error ? (
          <div className="flex items-center px-4 py-3 flex-1">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        ) : (
          <>
            {/* 국내금 */}
            <div className="flex flex-col justify-center px-5 py-3 flex-1">
              <p className="text-xs text-gray-500 mb-0.5">국내금 (KRX)</p>
              <p className="text-sm font-semibold text-white">
                {displayValue(data?.domesticPriceKRW)}
              </p>
            </div>

            {/* 국제금 */}
            <div className="flex flex-col justify-center px-5 py-3 flex-1">
              <p className="text-xs text-gray-500 mb-0.5">국제금 환산</p>
              <p className="text-sm font-semibold text-white">
                {displayValue(data?.internationalPriceKRW)}
              </p>
            </div>

            {/* 프리미엄 */}
            <div className="flex flex-col justify-center px-5 py-3 flex-1">
              <p className="text-xs text-gray-500 mb-0.5">프리미엄</p>
              <p className={`text-lg font-bold ${premiumColor}`}>
                {loading && !data
                  ? '...'
                  : hasData
                  ? formatPremium(data.premium)
                  : '-'}
              </p>
            </div>
          </>
        )}

        {/* 기준시간 + 새로고침 버튼 */}
        <div className="flex items-center gap-3 px-4 py-3 shrink-0 ml-auto">
          {data && hasData && (
            <span className="text-xs text-gray-600 whitespace-nowrap">
              {formatTime(data.fetchedAt)} 기준
            </span>
          )}
          {data && !hasData && !loading && !error && (
            <span className="text-xs text-gray-600 whitespace-nowrap">조회 실패</span>
          )}
          <button
            onClick={refresh}
            disabled={loading}
            className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 rounded transition-colors whitespace-nowrap"
          >
            {loading ? '조회 중...' : '새로고침'}
          </button>
        </div>

      </div>
    </div>
  );
};

export default GoldPremiumWidget;
