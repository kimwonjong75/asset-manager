import React, { useMemo } from 'react';
import { CircleAlert } from 'lucide-react';
import { CHART_TOOLTIP_STYLE, SERIES_COLORS } from '../../utils/chartFormat';

const AXIS_COLOR = '#9CA3AF';
const GRID_COLOR = '#3A3A3A';
const TOOLTIP_BOX: React.CSSProperties = { ...CHART_TOOLTIP_STYLE.contentStyle, padding: '0.5rem 0.75rem' };
const TOOLTIP_LABEL: React.CSSProperties = { ...CHART_TOOLTIP_STYLE.labelStyle, marginBottom: 4 };
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { OverviewChartPeriod } from '../../hooks/useMarketOverviewHistory';
import type { MarketOverviewHistory } from '../../types/marketOverview';

/** 'inline' — 바 아래 펼침(차트당 240px 고정) / 'fill' — 부모 높이를 채움(확대 모달, 두 차트가 절반씩) */
export type MarketOverviewChartsSize = 'inline' | 'fill';

interface Props {
  /** 히스토리 — 훅(`useMarketOverviewHistory`)은 MarketOverviewBar가 소유한다(인라인·확대 모달이 캐시 공유, 중복 /history 없음) */
  history: MarketOverviewHistory | null;
  loading: boolean;
  error: string | null;
  period: OverviewChartPeriod;
  onPeriodChange: (p: OverviewChartPeriod) => void;
  size?: MarketOverviewChartsSize;
}

const PERIODS: OverviewChartPeriod[] = ['1M', '3M', '6M', '1Y'];

function fmtDate(iso: string): string {
  // 'YYYY-MM-DD' → 'MM/DD'
  const [, m, d] = iso.split('-');
  return m && d ? `${m}/${d}` : iso;
}
const fmtKRW = (v: number) => Math.round(v).toLocaleString('ko-KR');
const fmtPct = (v: number) => `${(Number(v) || 0).toFixed(2)}%`;
const fmtUsd = (v: number) => Math.round(v).toLocaleString('ko-KR');
const fmtJpy = (v: number) => (Number(v) || 0).toFixed(2);

const PeriodTabs: React.FC<{ value: OverviewChartPeriod; onChange: (p: OverviewChartPeriod) => void }> = ({ value, onChange }) => (
  <div className="flex items-center gap-1">
    {PERIODS.map((p) => (
      <button
        key={p}
        type="button"
        onClick={() => onChange(p)}
        className={`px-2 py-1 text-xs rounded transition-colors ${
          value === p ? 'bg-primary text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
        }`}
      >
        {p}
      </button>
    ))}
  </div>
);

const GoldTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey?: string; value?: number }>; label?: string }) => {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload.reduce<Record<string, number>>((acc, p) => {
    const k = (p as { dataKey?: string }).dataKey;
    if (k) acc[k] = (p as { value?: number }).value ?? 0;
    return acc;
  }, {});
  return (
    <div style={TOOLTIP_BOX}>
      <div style={TOOLTIP_LABEL}>{label}</div>
      <div style={CHART_TOOLTIP_STYLE.itemStyle}>국내금: <span style={{ color: SERIES_COLORS.gold, fontWeight: 700 }}>{fmtKRW(d['국내금'])} 원/g</span></div>
      <div style={CHART_TOOLTIP_STYLE.itemStyle}>국제금 환산: <span style={{ color: SERIES_COLORS.principal, fontWeight: 700 }}>{fmtKRW(d['국제금 환산'])} 원/g</span></div>
      <div style={CHART_TOOLTIP_STYLE.itemStyle}>프리미엄: <span style={{ color: SERIES_COLORS.premium, fontWeight: 700 }}>{fmtPct(d['프리미엄'])}</span></div>
    </div>
  );
};

const FxTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey?: string; value?: number }>; label?: string }) => {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload.reduce<Record<string, number>>((acc, p) => {
    const k = (p as { dataKey?: string }).dataKey;
    if (k) acc[k] = (p as { value?: number }).value ?? 0;
    return acc;
  }, {});
  return (
    <div style={TOOLTIP_BOX}>
      <div style={TOOLTIP_LABEL}>{label}</div>
      <div style={CHART_TOOLTIP_STYLE.itemStyle}>USD/KRW: <span style={{ color: SERIES_COLORS.usd, fontWeight: 700 }}>{fmtKRW(d['USD/KRW'])}</span></div>
      <div style={CHART_TOOLTIP_STYLE.itemStyle}>JPY/KRW: <span style={{ color: SERIES_COLORS.jpy, fontWeight: 700 }}>{fmtJpy(d['JPY/KRW'])}</span></div>
    </div>
  );
};

/**
 * 시장 요약 상세 차트 (렌더 전용). 조회는 MarketOverviewBar의 `useMarketOverviewHistory`가 담당 —
 * 펼침 또는 확대 모달이 열렸을 때만 /history 요청.
 *  · 금/프리미엄: 좌축 KRW/g(국내금·국제금환산) + 우축 %(프리미엄)
 *  · 환율: 좌축 USD/KRW + 우축 JPY/KRW (단위 차이 커 이중축)
 */
const MarketOverviewCharts: React.FC<Props> = ({ history, loading, error, period, onPeriodChange, size = 'inline' }) => {
  const fill = size === 'fill';
  // fill: 섹션이 flex-1로 절반씩 나누고 차트는 남은 높이를 100%로 채운다. inline: 240px 고정(기존과 동일).
  const sectionCls = fill ? 'flex-1 min-h-[12rem] flex flex-col' : '';
  const chartBoxCls = fill ? 'flex-1 min-h-0' : '';
  const chartHeight: number | `${number}%` = fill ? '100%' : 240;

  const goldData = useMemo(
    () =>
      (history?.goldPremium ?? []).map((pt) => ({
        date: fmtDate(pt.date),
        '국내금': pt.domesticKRWPerG,
        '국제금 환산': pt.intlKRWPerG,
        '프리미엄': pt.premiumPct,
      })),
    [history],
  );
  const fxData = useMemo(
    () =>
      (history?.fx ?? []).map((pt) => ({
        date: fmtDate(pt.date),
        'USD/KRW': pt.usdKrw,
        'JPY/KRW': pt.jpyKrw,
      })),
    [history],
  );

  return (
    <div className={fill ? 'h-full flex flex-col gap-6' : 'mt-3 pt-3 border-t border-border-subtle space-y-6'}>
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-300">일별 추이</span>
        <PeriodTabs value={period} onChange={onPeriodChange} />
      </div>

      {error ? (
        <div className="h-40 flex items-center justify-center gap-1.5 text-sm text-danger"><CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />{error}</div>
      ) : loading && !history ? (
        <div className="h-40 flex items-center justify-center text-sm text-gray-500">차트 데이터 불러오는 중…</div>
      ) : (
        <>
          {/* 금 / 프리미엄 */}
          <div className={sectionCls}>
            <p className="shrink-0 text-xs text-gray-400 mb-2">금 시세 · 김치 프리미엄</p>
            {goldData.length > 1 ? (
              <div className={chartBoxCls}>
              <ResponsiveContainer width="100%" height={chartHeight}>
                <LineChart data={goldData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                  <XAxis dataKey="date" stroke={AXIS_COLOR} fontSize={11} minTickGap={24} />
                  <YAxis yAxisId="left" stroke={AXIS_COLOR} fontSize={11} tickFormatter={fmtKRW} width={64} />
                  <YAxis yAxisId="right" orientation="right" stroke={SERIES_COLORS.premium} fontSize={11} tickFormatter={fmtPct} width={52} />
                  <Tooltip content={<GoldTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Line yAxisId="left" type="monotone" dataKey="국내금" stroke={SERIES_COLORS.gold} strokeWidth={2} dot={false} />
                  <Line yAxisId="left" type="monotone" dataKey="국제금 환산" stroke={SERIES_COLORS.principal} strokeWidth={2} strokeDasharray="6 4" dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="프리미엄" stroke={SERIES_COLORS.premium} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-40 flex items-center justify-center text-sm text-gray-500">표시할 데이터가 부족합니다.</div>
            )}
          </div>

          {/* 환율 */}
          <div className={sectionCls}>
            <p className="shrink-0 text-xs text-gray-400 mb-2">환율 (USD/KRW · JPY/KRW)</p>
            {fxData.length > 1 ? (
              <div className={chartBoxCls}>
              <ResponsiveContainer width="100%" height={chartHeight}>
                <LineChart data={fxData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                  <XAxis dataKey="date" stroke={AXIS_COLOR} fontSize={11} minTickGap={24} />
                  <YAxis yAxisId="left" stroke={SERIES_COLORS.usd} fontSize={11} tickFormatter={fmtUsd} width={56} domain={['auto', 'auto']} />
                  <YAxis yAxisId="right" orientation="right" stroke={SERIES_COLORS.jpy} fontSize={11} tickFormatter={fmtJpy} width={44} domain={['auto', 'auto']} />
                  <Tooltip content={<FxTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Line yAxisId="left" type="monotone" dataKey="USD/KRW" stroke={SERIES_COLORS.usd} strokeWidth={2} dot={false} connectNulls />
                  <Line yAxisId="right" type="monotone" dataKey="JPY/KRW" stroke={SERIES_COLORS.jpy} strokeWidth={2} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-40 flex items-center justify-center text-sm text-gray-500">표시할 데이터가 부족합니다.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default MarketOverviewCharts;
