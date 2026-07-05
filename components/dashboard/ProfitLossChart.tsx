import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Asset, PortfolioSnapshot } from '../../types';
import { GlobalPeriod } from '../../types/store';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import PeriodSelector from '../common/PeriodSelector';

interface ProfitLossChartProps {
  history: PortfolioSnapshot[];
  assetsToDisplay: Asset[];
  title: string;
  globalPeriod: GlobalPeriod;
  onPeriodChange: (period: GlobalPeriod) => void;
  /** 접이식으로 렌더할지 (Phase 5 UX). 미지정 시 기존처럼 항상 펼침 — 계산/차트 로직 불변, 렌더 상태만 */
  collapsible?: boolean;
  /** 접힘/펼침 영속 localStorage 키 (collapsible일 때만) */
  storageKey?: string;
  /** 최초 접힘 여부 (collapsible이고 저장값 없을 때) */
  defaultCollapsed?: boolean;
}

const ProfitLossChart: React.FC<ProfitLossChartProps> = ({ history, assetsToDisplay, title, globalPeriod, onPeriodChange, collapsible = false, storageKey, defaultCollapsed = false }) => {
  const [open, setOpen] = useState<boolean>(() => {
    if (!collapsible) return true;
    try {
      const stored = storageKey ? localStorage.getItem(storageKey) : null;
      if (stored === 'true') return true;
      if (stored === 'false') return false;
    } catch { /* ignore */ }
    return !defaultCollapsed;
  });
  const toggleOpen = () => setOpen(prev => {
    const next = !prev;
    if (storageKey) { try { localStorage.setItem(storageKey, String(next)); } catch { /* ignore */ } }
    return next;
  });
  const bodyVisible = !collapsible || open;
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
        totalPurchase += asset.purchaseValue;
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
  }, [history, assetsToDisplay]);

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
      <div style={{ backgroundColor: '#2D3748', border: '1px solid #4A5568', borderRadius: '0.5rem', padding: '0.5rem 0.75rem' }}>
        <div style={{ color: '#E2E8F0', marginBottom: 4 }}>{label}</div>
        <div style={{ color: '#A0AEC0' }}>투자 원금: <span style={{ color: '#E2E8F0', fontWeight: 700 }}>{formatCurrency(principal)} 원</span></div>
        <div style={{ color: '#A0AEC0' }}>총 평가액: <span style={{ color: '#E2E8F0', fontWeight: 700 }}>{formatCurrency(total)} 원</span></div>
        <div style={{ color: '#A0AEC0' }}>손익: <span style={{ color: '#E2E8F0', fontWeight: 700 }}>{formatCurrency(profit)} 원</span></div>
        <div style={{ color: '#D69E2E' }}>수익률: <span style={{ color: '#F6E05E', fontWeight: 700 }}>{formatPercent(returnPct)}</span></div>
      </div>
    );
  };
  
  return (
    <div className={`bg-gray-800 p-6 rounded-lg shadow-lg mb-6 ${bodyVisible ? 'h-96' : ''}`} title="포트폴리오의 평가 손익 추이를 보여줍니다.">
      <div className={`flex items-center justify-between ${bodyVisible ? 'mb-4' : ''}`}>
        {collapsible ? (
          <button
            type="button"
            onClick={toggleOpen}
            className="flex items-center gap-2 min-w-0 text-left"
            aria-expanded={open}
          >
            <ChevronDown className={`h-4 w-4 text-gray-400 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
            <h2 className="text-xl font-bold text-white truncate">{title}</h2>
          </button>
        ) : (
          <h2 className="text-xl font-bold text-white">{title}</h2>
        )}
        {bodyVisible && <PeriodSelector value={globalPeriod} onChange={onPeriodChange} />}
      </div>
      {bodyVisible && (chartData.length > 1 ? (
        <ResponsiveContainer width="100%" height="90%">
          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#4A5568" />
            <XAxis dataKey="date" stroke="#A0AEC0" fontSize={12} />
            <YAxis yAxisId="left" stroke="#A0AEC0" fontSize={12} tickFormatter={formatCurrency} width={80} />
            <YAxis yAxisId="right" orientation="right" stroke="#D69E2E" fontSize={12} tickFormatter={formatPercent} width={60} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{fontSize: "12px", bottom: -10}}/>
            <Line yAxisId="left" type="monotone" dataKey="투자 원금" name="투자 원금" stroke="#63B3ED" strokeWidth={3} dot={false} />
            <Line yAxisId="left" type="monotone" dataKey="총 평가액" name="총 평가액" stroke="#48BB78" strokeWidth={3} dot={false} />
            <Line yAxisId="left" type="monotone" dataKey="손익" name="손익" stroke="#FFFFFF" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 6 }} />
            <Line yAxisId="right" type="monotone" dataKey="수익률" name="수익률(%)" stroke="#F6E05E" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-full">
          <p className="text-gray-500">손익 추이를 표시하려면 데이터가 2일 이상 필요합니다.</p>
        </div>
      ))}
    </div>
  );
};

export default ProfitLossChart;
