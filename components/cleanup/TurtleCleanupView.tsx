// components/cleanup/TurtleCleanupView.tsx
// ---------------------------------------------------------------------------
// "터틀 정리" 화면 — 기존 '대청소'(cleanup 탭) 자리를 대체한다(계획서 PLAN_터틀중심_앱재정비_260925 §4.2,
// 2026-09-26 승인 P2). 옛 CleanupView 코드는 보존한다(App.tsx의 'cleanup' 탭 렌더만 이 화면으로 교체 —
// 메뉴 이름 정리는 P3).
//
// 매도 기준에 닿은 모든 종목은 보유자별 체결 입력 또는 보류를 선택한다.
// 실제 체결가·날짜·수량을 현재 시세로 대체하지 않는다.
// 계산은 hooks/useTurtleHoldings + utils/turtleHoldingsView·cleanupPlan, 이 컴포넌트는 표시 + 액션 호출만.

import React, { useMemo, useState } from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { useTurtleHoldings } from '../../hooks/useTurtleHoldings';
import { TurtleHoldingsRow, describeReentryBaseline, REENTRY_BASELINE_CAPTION } from '../../utils/turtleHoldingsView';
import { consecutiveHoldCount } from '../../utils/turtleHoldingsState';
import {
  realizedForeignGainYTD, plannedForeignGainKRW, estimateForeignCapGainsTax,
} from '../../utils/cleanupPlan';
import { mergeSellRecords } from '../../utils/sellRecords';
import { computeAssetMetrics } from '../../utils/portfolioMetrics';
import { EnrichedAsset } from '../../types/ui';
import { Currency } from '../../types';
import { getOwnerLabel } from '../../types/owner';
import { formatKRW } from '../portfolio-table/utils';
import Button from '../common/Button';
import Badge from '../common/Badge';
import ManualHelpLink from '../common/ManualHelpLink';
import { ChevronDown, ChevronUp } from 'lucide-react';

const DUST_ALLOCATION_PCT = 1; // 총자산 1% 미만 — cleanupPlan.ts DEFAULT_DUST_PCT과 동일 기준

const pct = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

interface CandidateRow {
  row: TurtleHoldingsRow;
  asset: EnrichedAsset;
  isSmall: boolean;
  consecutiveHolds: number;
}

const TurtleCleanupView: React.FC = () => {
  const { data, derived, actions } = usePortfolio();
  const holdings = useTurtleHoldings();
  const [holdDrafts, setHoldDrafts] = useState<Record<string, string>>({});
  const [openHoldFor, setOpenHoldFor] = useState<string | null>(null);
  const [taxOpen, setTaxOpen] = useState(false);

  const enrichedById = useMemo(() => {
    const m = new Map<string, EnrichedAsset>();
    for (const a of derived.enrichedAssets) m.set(a.id, a);
    return m;
  }, [derived.enrichedAssets]);

  const candidates = useMemo<CandidateRow[]>(() => {
    const out: CandidateRow[] = [];
    for (const row of holdings.rows) {
      if (row.status !== 'sell' || !row.assetId) continue;
      const asset = enrichedById.get(row.assetId);
      if (!asset) continue;
      out.push({
        row, asset, isSmall: asset.metrics.allocation < DUST_ALLOCATION_PCT,
        consecutiveHolds: consecutiveHoldCount(asset.turtleDecisions),
      });
    }
    return out.sort((a, b) => a.asset.metrics.returnPercentage - b.asset.metrics.returnPercentage);
  }, [holdings.rows, enrichedById]);

  const handleHoldSubmit = (assetId: string) => {
    const reason = (holdDrafts[assetId] ?? '').trim();
    if (!reason) return;
    actions.recordTurtleHold(assetId, reason);
    setHoldDrafts(prev => ({ ...prev, [assetId]: '' }));
    setOpenHoldFor(null);
  };

  // ── 해외주식 세금 참고(cleanupPlan.ts 재사용 — 참고용, 세무조언 아님) ──
  const mergedSellRecords = useMemo(() => mergeSellRecords(data.sellHistory, data.assets), [data.sellHistory, data.assets]);
  const taxPLKRWById = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of data.assets) {
      if (a.currency === Currency.KRW) continue;
      m.set(a.id, computeAssetMetrics(a, data.exchangeRates, 0, { plBasis: 'krw' }).metrics.profitLossKRW);
    }
    return m;
  }, [data.assets, data.exchangeRates]);
  const taxYear = useMemo(() => new Date().getFullYear(), []);
  const taxEstimate = useMemo(() => {
    const realized = realizedForeignGainYTD(mergedSellRecords, data.assets, data.exchangeRates, taxYear);
    const plannedIds = new Set(candidates.filter(c => c.asset.currency !== Currency.KRW).map(c => c.asset.id));
    const planned = plannedForeignGainKRW(
      candidates.map(c => ({
        assetId: c.asset.id, ticker: c.asset.ticker, name: c.asset.name, categoryId: c.asset.categoryId,
        currency: c.asset.currency, bucket: 'CORE', quantity: c.asset.quantity,
        currentValueKRW: c.asset.metrics.currentValueKRW, profitLossKRW: c.asset.metrics.profitLossKRW,
        returnPercentage: c.asset.metrics.returnPercentage, allocationPct: c.asset.metrics.allocation,
        flags: { loss: c.asset.metrics.returnPercentage < 0, deepLoss: false, dust: c.isSmall, foreign: c.asset.currency !== Currency.KRW },
        suggestedTag: 'keep', suggestReason: '',
      })),
      plannedIds,
      taxPLKRWById,
    );
    return estimateForeignCapGainsTax({ realizedForeignGainKRW: realized, plannedForeignGainKRW: planned, year: taxYear });
  }, [mergedSellRecords, data.assets, data.exchangeRates, taxYear, candidates, taxPLKRWById]);

  return (
    <div className="max-w-3xl mx-auto px-1 sm:px-0 pb-24">
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-lg sm:text-xl font-bold text-white">터틀 정리</h1>
          <ManualHelpLink anchor="cleanup" />
        </div>
        <p className="text-xs sm:text-sm text-gray-400 mt-1">
          설정한 매도 기준에 닿은 종목입니다. 증권사에서 체결한 뒤 이곳에 기록하세요.
        </p>
        {candidates.some(c => c.row.reentryBaseline) && (
          <p className="text-xs text-gray-500 mt-1">{REENTRY_BASELINE_CAPTION}</p>
        )}
      </div>

      {holdings.isLoading && <p className="text-xs text-gray-500 mb-3">시세를 불러오는 중입니다…</p>}

      {/* 세금 참고 패널 */}
      <div className="mb-4 rounded-md border border-gray-700 bg-gray-800/60">
        <button onClick={() => setTaxOpen(o => !o)} aria-expanded={taxOpen} className="w-full flex items-center justify-between px-3 py-2.5 text-left">
          <span className="text-xs sm:text-sm font-medium text-gray-200">
            해외주식 양도세 통산 <span className="text-xs text-warning border border-warning/40 rounded px-1 py-0.5 ml-1">추정 · 세무조언 아님</span>
          </span>
          {taxOpen ? <ChevronUp className="h-4 w-4 text-gray-500" aria-hidden="true" /> : <ChevronDown className="h-4 w-4 text-gray-500" aria-hidden="true" />}
        </button>
        {taxOpen && (
          <div className="px-3 pb-3 text-xs text-gray-300 space-y-1.5">
            <div className="flex justify-between"><span className="text-gray-400">{taxYear}년 실현 해외손익</span><span>{formatKRW(taxEstimate.realizedForeignGainKRW)}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">청산 예정(터틀 '팔 때') 해외 미실현손익</span><span>{formatKRW(taxEstimate.plannedForeignGainKRW)}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">합산 − 기본공제({formatKRW(taxEstimate.basicDeductionKRW)})</span><span>과세표준 {formatKRW(taxEstimate.taxableKRW)}</span></div>
            <div className="flex justify-between font-medium"><span className="text-gray-200">추정 세금 (×{Math.round(taxEstimate.rate * 100)}%)</span><span className="text-warning">{formatKRW(taxEstimate.estimatedTaxKRW)}</span></div>
            {taxEstimate.offsetSavingsKRW > 0 && (
              <div className="flex justify-between text-ok"><span>손실 통산 절감(추정)</span><span>−{formatKRW(taxEstimate.offsetSavingsKRW)}</span></div>
            )}
            <p className="text-xs text-gray-500 pt-1">확정 판단은 세무 전문가와 상의하세요.</p>
          </div>
        )}
      </div>

      {candidates.length === 0 ? (
        <div className="text-center text-gray-500 bg-gray-800/50 border border-gray-700 rounded-lg py-12 px-4 text-sm">
          {holdings.isLoading ? '확인 중입니다…' : '현재 매도 기준 도달로 확인된 종목이 없습니다.'}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {candidates.map(c => (
            <li key={c.asset.id} className="bg-gray-800 border border-gray-700 rounded-lg p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-semibold truncate">{c.asset.customName?.trim() || c.asset.name}</span>
                    <span className="text-xs text-gray-500">{getOwnerLabel(c.asset.owner)} · {c.asset.ticker}</span>
                    {c.consecutiveHolds >= 2 && <Badge tone="warning">최근 {c.consecutiveHolds}번 보류</Badge>}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
                    <span className={c.asset.metrics.returnPercentage < 0 ? 'text-down' : 'text-up'}>{pct(c.asset.metrics.returnPercentage)}</span>
                    <span>평가 {formatKRW(c.asset.metrics.currentValueKRW)}</span>
                    <span>비중 {c.asset.metrics.allocation.toFixed(2)}%</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{c.row.reasonText}</p>
                  {c.row.reentryBaseline && (
                    <p className="text-xs text-gray-400 mt-1">{describeReentryBaseline(c.row)}</p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                <Button variant="primary" size="md" onClick={() => actions.openSellModal(c.asset)}>팔았음 기록</Button>
                <Button variant="secondary" size="md" onClick={() => setOpenHoldFor(v => (v === c.asset.id ? null : c.asset.id))}>
                  이번엔 보류
                </Button>
              </div>
              {openHoldFor === c.asset.id && (
                <div className="mt-2 flex gap-2">
                  <input
                    type="text"
                    value={holdDrafts[c.asset.id] ?? ''}
                    onChange={e => setHoldDrafts(prev => ({ ...prev, [c.asset.id]: e.target.value }))}
                    placeholder="보류 사유(필수)"
                    className="flex-1 text-sm bg-gray-900 border border-gray-600 rounded-md px-2.5 py-1.5 text-gray-100 focus:outline-none focus:border-primary"
                  />
                  <Button variant="secondary" size="md" onClick={() => handleHoldSubmit(c.asset.id)} disabled={!(holdDrafts[c.asset.id] ?? '').trim()}>
                    기록
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default TurtleCleanupView;
