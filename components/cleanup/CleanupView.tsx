// components/cleanup/CleanupView.tsx
// ---------------------------------------------------------------------------
// 대청소(정리) 위저드 — "대청소" 탭 (Phase 3c-1).
//
// 범위(3c-1): 후보 리스트 + 분류(core/turtle/liquidate/keep)·제외 UI + 저장(saveCleanupDecisions)까지만.
//   · CLEANUP_SELL 주문 생성 / turtle→관심종목 등록은 3c-2 (여기서 하지 않음).
//   · 자동 제안은 "추천"일 뿐 — 자동 저장하지 않는다(사용자가 명시 선택 후 저장).
//   · 프레이밍: "이 손실은 이미 발생했습니다" — 지금 결정은 앞으로 자금을 어디 둘지.
// 계산은 순수 util(cleanupPlan), 이 컴포넌트는 표시 + 로컬 편집 + 저장 액션 호출만.

import React, { useMemo, useState } from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { CleanupCandidate, CleanupDecision, CleanupTag } from '../../types/cleanup';
import {
  selectCleanupCandidates,
  realizedForeignGainYTD,
  plannedForeignGainKRW,
  estimateForeignCapGainsTax,
  buildCleanupCommit,
} from '../../utils/cleanupPlan';
import { formatKRW } from '../portfolio-table/utils';

const TAG_META: Record<CleanupTag, { label: string; active: string; idle: string }> = {
  core:      { label: '코어 편입', active: 'bg-emerald-600 text-white border-emerald-600', idle: 'text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/10' },
  turtle:    { label: '터틀 후보', active: 'bg-purple-600 text-white border-purple-600', idle: 'text-purple-300 border-purple-500/40 hover:bg-purple-500/10' },
  liquidate: { label: '청산',     active: 'bg-red-600 text-white border-red-600',       idle: 'text-red-300 border-red-500/40 hover:bg-red-500/10' },
  keep:      { label: '보류',     active: 'bg-gray-600 text-white border-gray-600',     idle: 'text-gray-300 border-gray-500/40 hover:bg-gray-600/40' },
};
const TAG_ORDER: CleanupTag[] = ['core', 'turtle', 'liquidate', 'keep'];
const pct = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

const CleanupView: React.FC = () => {
  const { data, derived, actions } = usePortfolio();
  const { assets, watchlist, actionQueue, sellHistory, exchangeRates } = data;

  const assetById = useMemo(() => {
    const m = new Map(assets.map(a => [a.id, a]));
    return m;
  }, [assets]);

  const [decisions, setDecisions] = useState<Record<string, CleanupDecision>>({});
  const [showExcluded, setShowExcluded] = useState(false);
  const [taxOpen, setTaxOpen] = useState(false);

  // 후보 선정 — showExcluded면 제외 자산도 포함(다시 해제 가능하도록)
  const candidates = useMemo(() => {
    const isExcluded = showExcluded ? () => false : (a: { excludedFromCleanup?: boolean }) => !!a.excludedFromCleanup;
    const list = selectCleanupCandidates(derived.enrichedAssets, {}, isExcluded);
    return [...list].sort((a, b) => a.returnPercentage - b.returnPercentage); // 큰 손실 먼저
  }, [derived.enrichedAssets, showExcluded]);

  // effective(=로컬 편집 우선, 없으면 저장값)
  const effTag = (id: string): CleanupTag | undefined => decisions[id]?.cleanupTag ?? assetById.get(id)?.cleanupTag;
  const effExcluded = (id: string): boolean => decisions[id]?.excludedFromCleanup ?? assetById.get(id)?.excludedFromCleanup ?? false;

  const setTag = (id: string, tag: CleanupTag) => {
    setDecisions(prev => ({ ...prev, [id]: { ...prev[id], cleanupTag: tag } }));
  };
  const toggleExcluded = (id: string) => {
    const next = !effExcluded(id);
    setDecisions(prev => ({ ...prev, [id]: { ...prev[id], excludedFromCleanup: next } }));
  };

  // 자동 제안을 미검토 후보에 채우기(저장은 별도 — 추천일 뿐)
  const applySuggestions = () => {
    setDecisions(prev => {
      const next = { ...prev };
      for (const c of candidates) {
        if (effTag(c.assetId) === undefined) next[c.assetId] = { ...next[c.assetId], cleanupTag: c.suggestedTag };
      }
      return next;
    });
  };

  // 실제 변경분만 집계(저장값과 다른 것)
  const pendingChanges = useMemo(() => {
    const changes: { id: string; tag?: CleanupTag; excluded?: boolean }[] = [];
    for (const [id, d] of Object.entries(decisions)) {
      const a = assetById.get(id);
      const tagChanged = d.cleanupTag !== undefined && d.cleanupTag !== a?.cleanupTag;
      const exclChanged = d.excludedFromCleanup !== undefined && d.excludedFromCleanup !== (a?.excludedFromCleanup ?? false);
      if (tagChanged || exclChanged) changes.push({ id, tag: tagChanged ? d.cleanupTag : undefined, excluded: exclChanged ? d.excludedFromCleanup : undefined });
    }
    return changes;
  }, [decisions, assetById]);

  const tagChangeCounts = useMemo(() => {
    const c: Record<CleanupTag, number> = { core: 0, turtle: 0, liquidate: 0, keep: 0 };
    for (const ch of pendingChanges) if (ch.tag) c[ch.tag] += 1;
    return c;
  }, [pendingChanges]);
  const excludeChangeCount = pendingChanges.filter(ch => ch.excluded !== undefined).length;

  // 저장 시 발생할 부수효과 미리보기(동일 빌더로 정확 산출 — 배열은 버리고 summary만 사용)
  const sideEffects = useMemo(
    () => buildCleanupCommit(decisions, { assets, watchlist, actionQueue }, { today: '', makeId: (s) => `preview-${s}` }).summary,
    [decisions, assets, watchlist, actionQueue],
  );

  const taxYear = useMemo(() => new Date().getFullYear(), []);
  const taxEstimate = useMemo(() => {
    const realized = realizedForeignGainYTD(sellHistory, assets, exchangeRates, taxYear);
    const plannedIds = new Set(candidates.filter(c => effTag(c.assetId) === 'liquidate').map(c => c.assetId));
    const planned = plannedForeignGainKRW(candidates, plannedIds);
    return estimateForeignCapGainsTax({ realizedForeignGainKRW: realized, plannedForeignGainKRW: planned, year: taxYear });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sellHistory, assets, exchangeRates, taxYear, candidates, decisions]);

  const handleSave = () => {
    if (pendingChanges.length === 0) return;
    actions.saveCleanupDecisions(decisions);
    setDecisions({});
  };

  return (
    <div className="max-w-3xl mx-auto px-1 sm:px-0 pb-24">
      {/* 헤더 + 매몰비용 프레이밍 */}
      <div className="mb-4">
        <h1 className="text-lg sm:text-xl font-bold text-white">대청소</h1>
        <p className="text-xs sm:text-sm text-gray-400 mt-1">
          손실·먼지 종목을 <span className="text-gray-200">코어 편입 · 터틀 후보 · 청산 · 보류</span>로 분류합니다.
        </p>
        <div className="mt-2 text-xs sm:text-sm text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-2">
          이 손실은 <span className="font-semibold">이미 발생</span>했습니다. 지금 결정은 "손실을 되돌리는 것"이 아니라
          <span className="font-semibold"> 앞으로 이 자금을 어디에 둘지</span>입니다.
        </div>
      </div>

      {/* 터틀 후보 설명 */}
      <div className="mb-3 text-[11px] sm:text-xs text-gray-400 bg-gray-800/60 border border-gray-700 rounded-md px-3 py-2">
        <span className="text-purple-300 font-medium">터틀 후보</span>로 분류해도 <span className="text-gray-200">기존 보유분이 터틀 포지션이 되는 것은 아닙니다.</span>
        정리 후 <span className="text-gray-200">55일 신고가 돌파 시 재진입 감시 대상</span>으로 등록됩니다(등록 연결은 다음 단계).
      </div>

      {/* 세금 참고 패널 */}
      <div className="mb-4 rounded-md border border-gray-700 bg-gray-800/60">
        <button onClick={() => setTaxOpen(o => !o)} className="w-full flex items-center justify-between px-3 py-2.5 text-left">
          <span className="text-xs sm:text-sm font-medium text-gray-200">
            해외주식 양도세 통산 <span className="text-[10px] text-amber-300 border border-amber-500/40 rounded px-1 py-0.5 ml-1">추정 · 세무조언 아님</span>
          </span>
          <span className="text-gray-500 text-xs">{taxOpen ? '▲' : '▼'}</span>
        </button>
        {taxOpen && (
          <div className="px-3 pb-3 text-xs text-gray-300 space-y-1.5">
            <div className="flex justify-between"><span className="text-gray-400">{taxYear}년 실현 해외손익</span><span>{formatKRW(taxEstimate.realizedForeignGainKRW)}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">청산 예정 해외 미실현손익</span><span>{formatKRW(taxEstimate.plannedForeignGainKRW)}</span></div>
            <div className="flex justify-between"><span className="text-gray-400">합산 − 기본공제({formatKRW(taxEstimate.basicDeductionKRW)})</span><span>과세표준 {formatKRW(taxEstimate.taxableKRW)}</span></div>
            <div className="flex justify-between font-medium"><span className="text-gray-200">추정 세금 (×{Math.round(taxEstimate.rate * 100)}%)</span><span className="text-amber-200">{formatKRW(taxEstimate.estimatedTaxKRW)}</span></div>
            {taxEstimate.offsetSavingsKRW > 0 && (
              <div className="flex justify-between text-emerald-300"><span>손실 통산 절감(추정)</span><span>−{formatKRW(taxEstimate.offsetSavingsKRW)}</span></div>
            )}
            <p className="text-[10px] text-gray-500 pt-1">
              해외 판정은 통화(≠KRW) 기준 추정입니다. 실제 세액은 취득가·환율·보유기간·인별 상황에 따라 다르며, 확정 판단은 세무 전문가와 상의하세요.
            </p>
          </div>
        )}
      </div>

      {/* 컨트롤 바 */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span>후보 <span className="text-gray-100 font-semibold">{candidates.length}</span>건</span>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={showExcluded} onChange={e => setShowExcluded(e.target.checked)} className="accent-primary" />
            <span>제외 자산도 표시</span>
          </label>
        </div>
        <button onClick={applySuggestions} className="text-xs text-gray-200 bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-md transition-colors" title="미검토 후보에 자동 제안을 채웁니다(저장은 별도)">제안대로 채우기</button>
      </div>

      {/* 후보 리스트 */}
      {candidates.length === 0 ? (
        <div className="text-center text-gray-500 bg-gray-800/50 border border-gray-700 rounded-lg py-12 px-4 text-sm">
          정리할 손실·먼지 종목이 없습니다.
        </div>
      ) : (
        <ul className="space-y-2.5">
          {candidates.map(c => (
            <CandidateCard
              key={c.assetId}
              c={c}
              tag={effTag(c.assetId)}
              excluded={effExcluded(c.assetId)}
              onTag={t => setTag(c.assetId, t)}
              onToggleExcluded={() => toggleExcluded(c.assetId)}
            />
          ))}
        </ul>
      )}

      {/* 변경 요약 + 저장 (하단 고정) */}
      {pendingChanges.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-gray-900/95 border-t border-gray-700 px-3 py-2.5">
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
            <div className="text-xs text-gray-300 min-w-0">
              <span className="text-gray-400">변경 </span>
              {TAG_ORDER.map(t => tagChangeCounts[t] > 0 && (
                <span key={t} className="mr-2">{TAG_META[t].label} <span className="text-gray-100 font-semibold">{tagChangeCounts[t]}</span></span>
              ))}
              {excludeChangeCount > 0 && <span className="mr-2">제외변경 <span className="text-gray-100 font-semibold">{excludeChangeCount}</span></span>}
              {(sideEffects.watchRegistered > 0 || sideEffects.cleanupGenerated > 0 || sideEffects.cleanupSkippedNoPrice.length > 0) && (
                <div className="text-[11px] text-gray-500 mt-0.5">
                  {sideEffects.watchRegistered > 0 && <span className="mr-2">관심종목 등록 {sideEffects.watchRegistered}</span>}
                  {sideEffects.cleanupGenerated > 0 && <span className="mr-2">청산 주문 {sideEffects.cleanupGenerated}</span>}
                  {sideEffects.cleanupSkippedNoPrice.length > 0 && <span className="text-amber-400">시세 갱신 필요 {sideEffects.cleanupSkippedNoPrice.length}</span>}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => setDecisions({})} className="text-xs text-gray-400 hover:text-white px-3 py-1.5">초기화</button>
              <button onClick={handleSave} className="text-xs font-medium text-white bg-primary hover:bg-primary-dark px-4 py-1.5 rounded-md transition-colors">분류 저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface CardProps {
  c: CleanupCandidate;
  tag: CleanupTag | undefined;
  excluded: boolean;
  onTag: (t: CleanupTag) => void;
  onToggleExcluded: () => void;
}

const CandidateCard: React.FC<CardProps> = ({ c, tag, excluded, onTag, onToggleExcluded }) => {
  const lossColor = c.returnPercentage < 0 ? 'text-red-400' : 'text-emerald-400';
  return (
    <li className={`bg-gray-800 border rounded-lg p-3 ${excluded ? 'border-gray-700 opacity-60' : 'border-gray-700'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-semibold truncate">{c.name}</span>
            <span className="text-[11px] text-gray-500">{c.ticker}</span>
            {c.flags.deepLoss && <Badge tone="red">깊은손실</Badge>}
            {c.flags.dust && <Badge tone="gray">먼지</Badge>}
            {c.flags.foreign && <Badge tone="blue">해외</Badge>}
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
            <span className={lossColor}>{pct(c.returnPercentage)}</span>
            <span>평가 {formatKRW(c.currentValueKRW)}</span>
            <span>비중 {c.allocationPct.toFixed(2)}%</span>
          </div>
          <div className="text-[11px] text-gray-500 mt-1">추천: <span className="text-gray-300">{TAG_META[c.suggestedTag].label}</span> · {c.suggestReason}</div>
        </div>
        <button
          onClick={onToggleExcluded}
          className={`flex-shrink-0 text-[11px] px-2 py-1 rounded border transition-colors ${excluded ? 'bg-gray-600 text-white border-gray-600' : 'text-gray-400 border-gray-600 hover:bg-gray-700'}`}
          title="가족(유선) 등 의사결정 밖 자산 — 대청소 후보에서 제외"
        >{excluded ? '제외됨' : '제외'}</button>
      </div>

      {!excluded && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {TAG_ORDER.map(t => (
            <button
              key={t}
              onClick={() => onTag(t)}
              className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${tag === t ? TAG_META[t].active : TAG_META[t].idle}`}
            >{TAG_META[t].label}</button>
          ))}
        </div>
      )}
    </li>
  );
};

const Badge: React.FC<{ tone: 'red' | 'gray' | 'blue'; children: React.ReactNode }> = ({ tone, children }) => {
  const cls = tone === 'red' ? 'text-red-300 bg-red-500/10 border-red-500/30'
    : tone === 'blue' ? 'text-sky-300 bg-sky-500/10 border-sky-500/30'
    : 'text-gray-300 bg-gray-500/10 border-gray-500/30';
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border ${cls}`}>{children}</span>;
};

export default CleanupView;
