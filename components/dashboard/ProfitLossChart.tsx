import React, { useMemo } from 'react';
import { Asset, PortfolioSnapshot } from '../../types';
import { GlobalPeriod } from '../../types/store';
import type { PLBasis } from '../../types/valuation';
import { deriveSnapshotPurchaseValue } from '../../utils/portfolioMetrics';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import PeriodSelector from '../common/PeriodSelector';
import Card from '../common/Card';
import { CHART_TOOLTIP_STYLE, SERIES_COLORS } from '../../utils/chartFormat';

// 축·격자 — surface 토큰과 같은 계열의 중립색 (시리즈 색은 SERIES_COLORS)
const AXIS_COLOR = '#9CA3AF';
const GRID_COLOR = '#3A3A3A';
const PL_LINE_COLOR = '#E5E7EB';

interface ProfitLossChartProps {
  history: PortfolioSnapshot[];
  assetsToDisplay: Asset[];
  title: string;
  globalPeriod: GlobalPeriod;
  onPeriodChange: (period: GlobalPeriod) => void;
  /** 수익률 기준 — 투자 원금 선이 표·대시보드와 같은 규약을 쓰도록 한다(설정 전환 시 즉시 반영). */
  plBasis: PLBasis;
  /** 접이식으로 렌더할지 (Phase 5 UX). 미지정 시 기존처럼 항상 펼침 — 계산/차트 로직 불변, 렌더 상태만 */
  collapsible?: boolean;
  /** 접힘/펼침 영속 localStorage 키 (collapsible일 때만) */
  storageKey?: string;
  /** 최초 접힘 여부 (collapsible이고 저장값 없을 때) */
  defaultCollapsed?: boolean;
  /** 헤더 보조 슬롯 — 홈에서 자산 구분 필터 + 범위 칩을 둔다. 접혀 있어도 보인다 */
  headerActions?: React.ReactNode;
}

const ProfitLossChart: React.FC<ProfitLossChartProps> = ({ history, assetsToDisplay, title, globalPeriod, onPeriodChange, plBasis, collapsible = false, storageKey, defaultCollapsed = false, headerActions }) => {
  const chartData = useMemo(() => {
    if (!history || history.length === 0) {
      return [];
    }
    
    const assetIdsToDisplay = new Set(assetsToDisplay.map(a => a.id));

    const data = history.map(snapshot => {
      const dateEntry: Record<string, number | string> = {
        date: new Date(snapshot.date).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }),
      };
      
      const relevantAssets = snapshot.assets.filter(asset => assetIdsToDisplay.has(asset.id));

      let totalPurchase = 0;
      let totalCurrent = 0;
      relevantAssets.forEach(asset => {
        // 스냅샷은 원화 기준으로 저장된다 — 달러 모드면 그날 환율을 약분해 파생(순수 함수).
        // `purchaseUnitOriginal`이 없는 구 스냅샷은 저장값(원화 기준)으로 폴백하므로
        // 설정을 바꿔도 과거 구간은 당분간 원화 기준으로 남는다(365일 캡으로 자연 소멸).
        totalPurchase += deriveSnapshotPurchaseValue(asset, plBasis);
        totalCurrent += asset.currentValue;
      });
      const totalProfitLoss = totalCurrent - totalPurchase;
      const totalReturn = totalPurchase === 0 ? 0 : (totalProfitLoss / totalPurchase) * 100;
      dateEntry['투자 원금'] = totalPurchase;
      dateEntry['총 평가액'] = totalCurrent;
      dateEntry['손익'] = totalProfitLoss;
      dateEntry['수익률'] = totalReturn;
      return dateEntry;
    });

    return data;
  }, [history, assetsToDisplay, plBasis]);

  const formatCurrency = (value: number) => {
    return value.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  };
  const formatPercent = (value: number) => `${(Number(value) || 0).toFixed(2)}%`;
  
  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey?: string; value?: number }>; label?: string }) => {
    if (!active || !payload || payload.length === 0) return null;
    const datum = (payload ?? []).reduce<Record<string, number>>((acc, p) => {
      const key = (p as any).dataKey as string;
      const val = (p as any).value as number;
      if (key) acc[key] = val;
      return acc;
    }, {});
    const principal = datum['투자 원금'];
    const total = datum['총 평가액'];
    const profit = datum['손익'];
    const returnPct = datum['수익률'];
    return (
      <div style={{ ...CHART_TOOLTIP_STYLE.contentStyle, padding: '0.5rem 0.75rem' }}>
        <div style={{ ...CHART_TOOLTIP_STYLE.labelStyle, marginBottom: 4 }}>{label}</div>
        <div style={CHART_TOOLTIP_STYLE.itemStyle}>투자 원금: <span style={{ color: SERIES_COLORS.principal, fontWeight: 700 }}>{formatCurrency(principal)} 원</span></div>
        <div style={CHART_TOOLTIP_STYLE.itemStyle}>총 평가액: <span style={{ color: SERIES_COLORS.valuation, fontWeight: 700 }}>{formatCurrency(total)} 원</span></div>
        <div style={CHART_TOOLTIP_STYLE.itemStyle}>손익: <span style={{ color: PL_LINE_COLOR, fontWeight: 700 }}>{formatCurrency(profit)} 원</span></div>
        <div style={CHART_TOOLTIP_STYLE.itemStyle}>수익률: <span style={{ color: SERIES_COLORS.returnPct, fontWeight: 700 }}>{formatPercent(returnPct)}</span></div>
      </div>
    );
  };
  
  return (
    // 레이아웃: 헤더(제목·보조 슬롯·기간 선택 — 좁으면 줄바꿈) + 고정 높이 차트 영역.
    // 과거 고정 h-96 + 차트 90% 구조는 헤더가 줄바꿈되면 차트가 카드 밖으로 넘쳤다.
    // 기간 선택은 홈의 유일한 기간 컨트롤이라 접혀 있어도 보인다.
    // Stage C: 공용 Card(collapsible) — 기간 선택·보조 슬롯은 Card `actions`라 접혀 있어도 보인다.
    // actions 묶음은 헤더 폭의 75%까지만 차지하고 그 안에서 줄바꿈한다(좁은 폭에서 제목이 0폭으로 눌리지 않게).
    <Card
      collapsible={collapsible}
      defaultCollapsed={defaultCollapsed}
      storageKey={storageKey}
      clip={false}
      title={title}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 max-w-[75%] sm:max-w-none">
          {headerActions}
          <div className="max-w-full overflow-x-auto">
            <PeriodSelector value={globalPeriod} onChange={onPeriodChange} />
          </div>
        </div>
      }
    >
      {chartData.length > 1 ? (
        <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
            <XAxis dataKey="date" stroke={AXIS_COLOR} fontSize={12} />
            <YAxis yAxisId="left" stroke={AXIS_COLOR} fontSize={12} tickFormatter={formatCurrency} width={80} />
            <YAxis yAxisId="right" orientation="right" stroke={SERIES_COLORS.returnPct} fontSize={12} tickFormatter={formatPercent} width={60} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{fontSize: "12px", bottom: -10}}/>
            <Line yAxisId="left" type="monotone" dataKey="투자 원금" name="투자 원금" stroke={SERIES_COLORS.principal} strokeWidth={2} strokeDasharray="6 4" dot={false} />
            <Line yAxisId="left" type="monotone" dataKey="총 평가액" name="총 평가액" stroke={SERIES_COLORS.valuation} strokeWidth={3} dot={false} />
            <Line yAxisId="left" type="monotone" dataKey="손익" name="손익" stroke={PL_LINE_COLOR} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
            <Line yAxisId="right" type="monotone" dataKey="수익률" name="수익률(%)" stroke={SERIES_COLORS.returnPct} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex items-center justify-center h-40">
          <p className="text-gray-500">손익 추이를 표시하려면 데이터가 2일 이상 필요합니다.</p>
        </div>
      )}
    </Card>
  );
};

export default ProfitLossChart;
