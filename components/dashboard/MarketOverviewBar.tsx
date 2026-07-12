import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import {
  intlGoldKRWPerG,
  goldPremiumPct,
  effectiveUsdKrw,
} from '../../utils/marketOverviewCalculations';
import { OverviewChartPeriod } from '../../hooks/useMarketOverviewHistory';
import MarketOverviewCharts from './MarketOverviewCharts';

const OPEN_KEY = 'asset-manager-market-overview-open';
const PERIOD_KEY = 'asset-manager-market-overview-period';

function fmtKRWg(v: number | null): string {
  return v && v > 0 ? `${Math.round(v).toLocaleString('ko-KR')}/g` : '-';
}
function fmtPremium(v: number | null): string {
  if (v === null) return '-';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}
function fmtRate(v: number, digits: number): string {
  return v > 0 ? v.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '-';
}
function mmdd(iso: string | null): string | null {
  if (!iso) return null;
  const [, m, d] = iso.split('-');
  return m && d ? `${Number(m)}/${Number(d)}` : null;
}
function hhmm(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/** 인라인 편집 가능한 환율 셀 (클릭 → 입력 → 커밋). 사용자 액션이므로 저장 허용. */
const EditableRate: React.FC<{
  label: string;
  value: number;
  digits: number;
  onCommit: (v: number) => void;
}> = ({ label, value, digits, onCommit }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const start = () => {
    setDraft(value > 0 ? String(value) : '');
    setEditing(true);
  };
  const commit = () => {
    const n = parseFloat(draft);
    if (isFinite(n) && n > 0) onCommit(n);
    setEditing(false);
  };

  return (
    <div className="flex flex-col justify-center px-4 py-3">
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      {editing ? (
        <input
          type="number"
          step={digits > 0 ? '0.01' : '1'}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="bg-gray-700 border border-gray-600 rounded px-2 py-0.5 text-white text-sm w-24"
        />
      ) : (
        <button
          type="button"
          onClick={start}
          title="클릭하여 환율 수정"
          className="text-sm font-semibold text-white text-left hover:text-primary transition-colors"
        >
          {fmtRate(value, digits)}
        </button>
      )}
    </div>
  );
};

/**
 * 시장 요약 한 줄 바 — 금 김치 프리미엄 + 환율을 같은 줄에 표시.
 * (기존 GoldPremiumWidget + DashboardControls 환율 입력을 통합)
 *
 * 프리미엄은 저장값이 아니라 렌더 시 파생: 국제금 환산에 **시장 환율(스냅샷)**을
 * 우선 사용하고, 없으면 앱 환율로 폴백 — "앱을 연 순간"에도 최신 환율로 정확히 계산.
 * 상단 배지는 시세 기준일(sourceDate)과 확인 시각(fetchedAt)을 분리 표기.
 */
const MarketOverviewBar: React.FC = () => {
  const { data, derived, actions, status: portfolioStatus } = usePortfolio();
  const snapshot = derived.marketOverview;
  const status = derived.marketOverviewStatus;
  const error = derived.marketOverviewError;
  const exchangeRates = data.exchangeRates;
  const showRateWarning = portfolioStatus.showExchangeRateWarning;

  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(OPEN_KEY) === 'true'; } catch { return false; }
  });
  const [period, setPeriod] = useState<OverviewChartPeriod>(() => {
    try {
      const p = localStorage.getItem(PERIOD_KEY);
      if (p === '1M' || p === '3M' || p === '6M' || p === '1Y') return p;
    } catch { /* ignore */ }
    return '3M';
  });

  const toggleOpen = () => setOpen((prev) => {
    const next = !prev;
    try { localStorage.setItem(OPEN_KEY, String(next)); } catch { /* ignore */ }
    return next;
  });
  const changePeriod = (p: OverviewChartPeriod) => {
    setPeriod(p);
    try { localStorage.setItem(PERIOD_KEY, p); } catch { /* ignore */ }
  };

  // 프리미엄 파생 — 시장 환율 우선, 앱 환율 폴백
  const { domestic, intlKRW, premium } = useMemo(() => {
    if (!snapshot) return { domestic: null as number | null, intlKRW: null as number | null, premium: null as number | null };
    const rate = effectiveUsdKrw(snapshot.usdKrw, exchangeRates.USD);
    const dom = snapshot.domesticGoldKRWPerG > 0 ? snapshot.domesticGoldKRWPerG : null;
    const intl = rate ? intlGoldKRWPerG(snapshot.intlGoldUSDPerOz, rate) : 0;
    const intlOrNull = intl > 0 ? intl : null;
    return {
      domestic: dom,
      intlKRW: intlOrNull,
      premium: dom && intlOrNull ? goldPremiumPct(dom, intlOrNull) : null,
    };
  }, [snapshot, exchangeRates.USD]);

  const isInitialLoading = status === 'loading' && !snapshot;
  const premiumColor = premium === null ? 'text-gray-500' : premium >= 0 ? 'text-red-400' : 'text-blue-400';

  // 기준일/확인 배지
  const badge = useMemo(() => {
    if (isInitialLoading) return { text: '불러오는 중…', tone: 'text-gray-500' };
    if (status === 'error' && !snapshot) return null;
    if (!snapshot) return null;
    const src = mmdd(snapshot.goldSourceDate);
    const time = hhmm(snapshot.fetchedAt);
    if (status === 'stale-fallback' || status === 'error') {
      return { text: `${src ? `${src} 종가 · ` : ''}갱신 실패`, tone: 'text-yellow-400' };
    }
    return { text: `${src ? `${src} 종가 · ` : ''}${time} 확인`, tone: 'text-gray-600' };
  }, [snapshot, status, isInitialLoading]);

  const showValue = (fmt: string) => (isInitialLoading ? '…' : fmt);

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg overflow-hidden">
      {/* 상단 한 줄 — 모바일에서는 wrap */}
      <div className="flex flex-wrap items-stretch">
        {/* 타이틀 */}
        <div className="flex items-center px-4 py-3 shrink-0">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-400 whitespace-nowrap">
            금 김치 프리미엄
          </span>
        </div>

        {error && !snapshot ? (
          <div className="flex items-center px-4 py-3 flex-1">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col justify-center px-4 py-3">
              <p className="text-xs text-gray-500 mb-0.5">국내금 (KRX)</p>
              <p className="text-sm font-semibold text-white">{showValue(fmtKRWg(domestic))}</p>
            </div>
            <div className="flex flex-col justify-center px-4 py-3">
              <p className="text-xs text-gray-500 mb-0.5">국제금 환산</p>
              <p className="text-sm font-semibold text-white">{showValue(fmtKRWg(intlKRW))}</p>
            </div>
            <div className="flex flex-col justify-center px-4 py-3">
              <p className="text-xs text-gray-500 mb-0.5">프리미엄</p>
              <p className={`text-lg font-bold ${premiumColor}`}>{isInitialLoading ? '…' : fmtPremium(premium)}</p>
            </div>

            {/* 구분선 후 환율 — 같은 줄 */}
            <div className="hidden sm:block w-px bg-gray-700 my-2" />
            <EditableRate
              label="USD/KRW"
              value={exchangeRates.USD}
              digits={2}
              onCommit={(v) => actions.setExchangeRates({ ...exchangeRates, USD: v })}
            />
            <EditableRate
              label="JPY/KRW"
              value={exchangeRates.JPY}
              digits={2}
              onCommit={(v) => actions.setExchangeRates({ ...exchangeRates, JPY: v })}
            />
            {showRateWarning && (
              <div className="flex items-center px-3 py-3">
                <span className="text-xs text-yellow-400" title="보유 외화 자산의 원화 환산을 위해 환율을 입력하세요.">
                  환율 확인 필요
                </span>
              </div>
            )}
          </>
        )}

        {/* 우측 — 배지 + 새로고침 + 펼침 */}
        <div className="flex items-center gap-3 px-4 py-3 ml-auto">
          {badge && (
            <span className={`text-xs whitespace-nowrap ${badge.tone}`}>{badge.text}</span>
          )}
          <button
            onClick={() => actions.refreshMarketOverview()}
            disabled={status === 'loading'}
            className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 rounded transition-colors whitespace-nowrap"
          >
            {status === 'loading' ? '조회 중...' : '새로고침'}
          </button>
          <button
            type="button"
            onClick={toggleOpen}
            aria-expanded={open}
            title="일별 차트 펼치기/접기"
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-300 hover:text-white transition-colors"
          >
            차트
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
          </button>
        </div>
      </div>

      {/* 펼침 시 차트 — 접혀 있으면 /history 요청 0건 */}
      {open && (
        <div className="px-4 pb-4">
          <MarketOverviewCharts enabled={open} period={period} onPeriodChange={changePeriod} />
        </div>
      )}
    </div>
  );
};

export default MarketOverviewBar;
