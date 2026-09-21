import React, { useMemo, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { Asset, PortfolioSnapshot } from '../../types';
import { GlobalPeriod } from '../../types/store';
import type { PLBasis } from '../../types/valuation';
import { deriveSnapshotPurchaseValue } from '../../utils/portfolioMetrics';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import PeriodSelector from '../common/PeriodSelector';
import Card from '../common/Card';
import Modal from '../common/Modal';
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
  /** 필터 슬롯 — 홈에서 자산 구분 필터. 제목 아래 toolbar 줄(기간 선택 앞)에 놓이고 확대 모달에도 같은 상태로 다시 렌더된다 */
  filterSlot?: React.ReactNode;
  /** 범위 칩 — 제목 행 우측(짧은 항목만). 접혀 있어도 보인다 */
  scopeChip?: React.ReactNode;
}

type PLChartDatum = Record<string, number | string>;

const formatCurrency = (value: number) => value.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
const formatPercent = (value: number) => `${(Number(value) || 0).toFixed(2)}%`;

interface PLTooltipProps {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number }>;
  label?: string;
}

// 모듈 스코프 — 컴포넌트 본문 안에 두면 매 렌더 새 컴포넌트로 취급된다(react-hooks/static-components)
const PLTooltip: React.FC<PLTooltipProps> = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload.reduce<Record<string, number>>((acc, p) => {
    if (p.dataKey !== undefined && typeof p.value === 'number') acc[String(p.dataKey)] = p.value;
    return acc;
  }, {});
  const principal = datum['투자 원금'] ?? 0;
  const total = datum['총 평가액'] ?? 0;
  const profit = datum['손익'] ?? 0;
  const returnPct = datum['수익률'] ?? 0;
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

/**
 * 차트 본체 — 인라인 카드와 확대 모달이 공유하는 단일 렌더 경로(시리즈 정의 중복 금지).
 * 부모가 높이를 정한다(인라인 h-80 / 모달 flex-1). 손익 선은 점을 찍지 않는다 — 일별 수백 점이
 * 흰 구슬 띠처럼 뭉개졌다. 호버 점(activeDot)만 남긴다.
 */
const PLChartBody: React.FC<{ chartData: PLChartDatum[] }> = ({ chartData }) => (
  <ResponsiveContainer width="100%" height="100%">
    <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
      <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
      <XAxis dataKey="date" stroke={AXIS_COLOR} fontSize={12} minTickGap={16} />
      <YAxis yAxisId="left" stroke={AXIS_COLOR} fontSize={12} tickFormatter={formatCurrency} width={80} />
      <YAxis yAxisId="right" orientation="right" stroke={SERIES_COLORS.returnPct} fontSize={12} tickFormatter={formatPercent} width={60} />
      <Tooltip content={<PLTooltip />} />
      <Legend wrapperStyle={{ fontSize: '12px', bottom: -10 }} />
      <Line yAxisId="left" type="monotone" dataKey="투자 원금" name="투자 원금" stroke={SERIES_COLORS.principal} strokeWidth={2} strokeDasharray="6 4" dot={false} />
      <Line yAxisId="left" type="monotone" dataKey="총 평가액" name="총 평가액" stroke={SERIES_COLORS.valuation} strokeWidth={3} dot={false} />
      <Line yAxisId="left" type="monotone" dataKey="손익" name="손익" stroke={PL_LINE_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      <Line yAxisId="right" type="monotone" dataKey="수익률" name="수익률(%)" stroke={SERIES_COLORS.returnPct} strokeWidth={2} dot={false} />
    </LineChart>
  </ResponsiveContainer>
);

const EmptyState: React.FC = () => (
  <div className="flex items-center justify-center h-40">
    <p className="text-gray-500">손익 추이를 표시하려면 데이터가 2일 이상 필요합니다.</p>
  </div>
);

const ProfitLossChart: React.FC<ProfitLossChartProps> = ({ history, assetsToDisplay, title, globalPeriod, onPeriodChange, plBasis, collapsible = false, storageKey, defaultCollapsed = false, filterSlot, scopeChip }) => {
  const [expanded, setExpanded] = useState(false);
  const chartData = useMemo(() => {
    if (!history || history.length === 0) {
      return [];
    }
    
    const assetIdsToDisplay = new Set(assetsToDisplay.map(a => a.id));

    const data = history.map(snapshot => {
      const dateEntry: PLChartDatum = {
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

  const hasData = chartData.length > 1;
  const controls = (
    <>
      {filterSlot}
      <div className="max-w-full overflow-x-auto">
        <PeriodSelector value={globalPeriod} onChange={onPeriodChange} />
      </div>
    </>
  );

  return (
    // 레이아웃: 제목 행(제목 · 범위 칩 · 확대 버튼 — 짧은 항목만) + toolbar 줄(자산 구분 필터 · 기간 선택, flex-wrap).
    // 과거에는 필터+기간 8버튼을 Card `actions`(shrink-0)에 넣어 xl 7열 폭에서 제목이 0폭으로 눌려
    // 한 글자씩 세로로 쌓이고 기간 버튼이 카드 밖으로 잘렸다 → 넓은 컨트롤은 Card `toolbar`로.
    // 기간 선택은 홈의 유일한 기간 컨트롤이라 접혀 있어도 보인다(toolbar·actions 모두 접힘에서도 표시).
    <>
      <Card
        collapsible={collapsible}
        defaultCollapsed={defaultCollapsed}
        storageKey={storageKey}
        clip={false}
        title={<span className="break-keep">{title}</span>}
        actions={
          <>
            {scopeChip}
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex items-center justify-center min-h-8 min-w-8 rounded-md text-gray-400 hover:text-white hover:bg-gray-700/60 transition-colors focus-ring"
              title="전체화면으로 보기"
              aria-label="손익 추이 전체화면으로 보기"
            >
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </>
        }
        toolbar={controls}
      >
        {hasData ? (
          <div className="h-80">
            <PLChartBody chartData={chartData} />
          </div>
        ) : (
          <EmptyState />
        )}
      </Card>

      <Modal open={expanded} onClose={() => setExpanded(false)} title={title} size="full">
        <div className="h-full flex flex-col gap-3">
          <div className="shrink-0 flex flex-wrap items-center gap-2 min-w-0">{controls}</div>
          {hasData ? (
            <div className="flex-1 min-h-[16rem] pb-3">
              <PLChartBody chartData={chartData} />
            </div>
          ) : (
            <EmptyState />
          )}
        </div>
      </Modal>
    </>
  );
};

export default ProfitLossChart;
