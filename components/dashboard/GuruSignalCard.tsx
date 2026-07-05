// 대시보드 "구루 신호 엔진" 카드 (⑤ Guru Signal Engine 가시화)
// ---------------------------------------------------------------------------
// 지식 DB의 활성 규칙(typed condition)을 종목별 평가한 결과(derived.guruSignals)를 노출.
// 평가·그룹핑은 utils/guruSignalEngine(순수)에 위임 — 이 컴포넌트는 렌더만 담당.
// 같은 종목이 여러 규칙에 걸리면 groupGuruSignals가 한 줄로 묶어 중복 표시를 막는다.
// 좌측 신호 리스트에서 종목을 선택하면 우측에 그 종목 차트를 인라인 표시(검증용).
//   · 차트 props(source 분기 룩업)는 derived.guruSignalChartTargets(컨텍스트/순수)에서 가져온다.
//   · ⤢ 전체화면은 공용 ChartViewerModal 재사용.
// 표시 수준은 "관찰 후보"이지 매수 추천이 아니다(문구·면책 명시).

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { getActiveSignalRules, groupGuruSignals } from '../../utils/guruSignalEngine';
import { buildSignalExplanation, type SignalExplanation } from '../../utils/conditionDescribe';
import type { RuleAction } from '../../types/knowledge';
import AssetTrendChart from '../AssetTrendChart';
import ChartViewerModal from '../common/ChartViewerModal';
import GuruDiagnosticsPanel from './GuruDiagnosticsPanel';

interface ActionStyle {
  label: string;
  badge: string;
}

const ACTION_STYLES: Record<RuleAction, ActionStyle> = {
  'sell-warning': { label: '매도 경고', badge: 'bg-red-500/15 text-red-300 border-red-500/30' },
  'buy-setup': { label: '진입 검토', badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  'buy-watch': { label: '관찰 후보', badge: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  'risk-sizing': { label: '리스크', badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  'regime-filter': { label: '시장 국면', badge: 'bg-purple-500/15 text-purple-300 border-purple-500/30' },
  'review': { label: '복기', badge: 'bg-gray-500/15 text-gray-300 border-gray-500/30' },
};

// 규칙별 짧은 라벨(칩) — 긴 제목 대신 간결 표시. 미정의 시 ruleTitle로 폴백.
const RULE_SHORT_LABELS: Record<string, string> = {
  'rule-climax-top-sell': '과열(클라이맥스)',
  'rule-ma20-pullback-watch': 'MA20 눌림목',
  'rule-near-high-breakout-watch': '신고가 돌파',
  'rule-ma20-reclaim-watch': 'MA20 재돌파',
};

// 신호 설명 블록 — 근거(claim) + 종목별 충족 조건(실제값) + 무효. 렌더 전용.
const ExplainBlock: React.FC<{ title: string; exp: SignalExplanation }> = ({ title, exp }) => (
  <div className="bg-gray-900/70 rounded-md p-2.5 text-[11px]">
    <p className="text-gray-200 font-medium mb-1.5">{title}</p>
    {exp.basis.length > 0 && (
      <p className="mb-1.5 text-gray-400">
        <span className="text-gray-500">📚 근거 </span>{exp.basis.join(' · ')}
      </p>
    )}
    {exp.leaves.length > 0 ? (
      <div className="space-y-1">
        <p className="text-gray-500">🟢 이 종목이 충족한 조건</p>
        {exp.leaves.map((lf, i) => (
          <div key={i} className="flex items-center gap-1.5 flex-wrap">
            <span className={lf.passed === true ? 'text-emerald-400' : lf.passed === false ? 'text-rose-400' : 'text-gray-500'}>
              {lf.passed === true ? '✓' : lf.passed === false ? '✗' : '—'}
            </span>
            <span className="text-gray-300">{lf.label}</span>
            <span className="text-white font-mono">{lf.actual}</span>
            <span className="text-gray-500">(기준 {lf.condition})</span>
          </div>
        ))}
      </div>
    ) : exp.conditions.length > 0 ? (
      <p className="text-gray-400">
        <span className="text-gray-500">📋 언제 뜨나 </span>{exp.conditions.join(' · ')}
      </p>
    ) : null}
    {exp.riskPolicy && <p className="mt-1.5 text-gray-500">⚠️ 무효: {exp.riskPolicy}</p>}
  </div>
);

interface GuruSignalCardProps {
  /** 접이식으로 렌더할지 (Phase 5 UX). 미지정 시 기존처럼 항상 펼침 — 평가/렌더 로직 불변, 표시 상태만 */
  collapsible?: boolean;
  /** 최초 접힘 여부 (collapsible이고 저장값 없을 때) */
  defaultCollapsed?: boolean;
  /** 접힘/펼침 영속 localStorage 키 (collapsible일 때만) */
  storageKey?: string;
}

const GuruSignalCard: React.FC<GuruSignalCardProps> = ({ collapsible = false, defaultCollapsed = false, storageKey }) => {
  const { data, derived } = usePortfolio();
  const signals = derived.guruSignals;
  const chartTargets = derived.guruSignalChartTargets;
  const caveats = derived.guruSignalCaveats; // 발화 신호의 데이터 품질(firing-partial) — 표시용, 발화 불변
  const history = data.portfolioHistory;
  const activeRuleCount = getActiveSignalRules(
    data.knowledgeBase.rules,
    data.knowledgeBase.claims,
    new Date(),
  ).length;

  const groups = groupGuruSignals(signals);
  const distinctAssets = new Set(signals.map(s => s.assetId)).size;

  // 선택 종목(우측 차트). 미선택/사라진 종목이면 우선순위 최상위(첫 그룹·첫 종목)로 폴백.
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [explainAssetId, setExplainAssetId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
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
  const firstAssetId = groups[0]?.assets[0]?.assetId ?? null;
  const effectiveSelectedId =
    selectedAssetId && chartTargets[selectedAssetId] ? selectedAssetId : firstAssetId;
  const chartTarget = effectiveSelectedId ? chartTargets[effectiveSelectedId] ?? null : null;

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg p-4 sm:p-5">
      <div className={`flex items-start justify-between gap-2 ${bodyVisible ? 'mb-3' : ''}`}>
        <div className="min-w-0">
          {collapsible ? (
            <button
              type="button"
              onClick={toggleOpen}
              aria-expanded={open}
              className="flex items-center gap-1.5 min-w-0 text-left"
            >
              <ChevronDown className={`h-4 w-4 text-gray-400 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
              <h3 className="text-base font-bold text-white">🧭 구루 신호 엔진</h3>
            </button>
          ) : (
            <h3 className="text-base font-bold text-white flex items-center gap-1.5">
              🧭 구루 신호 엔진
            </h3>
          )}
          {bodyVisible && (
            <p className="text-xs text-gray-500 mt-0.5">
              지식 규칙 기반 <span className="text-gray-400">관찰 후보</span> · 매수 추천이 아닙니다
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-xs text-gray-500 whitespace-nowrap bg-gray-700/60 px-2 py-1 rounded">
            활성 규칙 {activeRuleCount}개 평가
          </span>
          {bodyVisible ? (
            <button
              onClick={() => setShowDiagnostics(v => !v)}
              aria-expanded={showDiagnostics}
              className="text-[11px] text-cyan-400/80 hover:text-cyan-300 whitespace-nowrap"
            >
              {showDiagnostics ? '진단 닫기 ▴' : '왜 신호가 안 뜨나요? ▾'}
            </button>
          ) : (
            <span className="text-[11px] text-gray-500 whitespace-nowrap">
              {signals.length > 0 ? `신호 ${distinctAssets}종목` : '신호 없음'}
            </span>
          )}
        </div>
      </div>

      {bodyVisible && showDiagnostics && <GuruDiagnosticsPanel />}

      {bodyVisible && (signals.length === 0 ? (
        <div className="bg-gray-900/60 rounded-md px-3 py-3 text-xs text-gray-400">
          {activeRuleCount === 0
            ? '평가 가능한 활성 규칙이 아직 없습니다. 지표·규칙 검증이 진행되면 여기에 신호가 표시됩니다.'
            : '현재 매칭된 신호가 없습니다. 조건을 충족하는 종목이 나타나면 표시됩니다.'}
        </div>
      ) : (
        <div className="lg:flex lg:gap-4">
          {/* 좌측: 신호 리스트 */}
          <div className="lg:w-[42%] lg:shrink-0 lg:max-h-[460px] lg:overflow-y-auto lg:pr-1">
            {/* 전체 요약 — 액션 그룹이 2개 이상일 때만(단일 그룹이면 아래 그룹 카운트와 중복) */}
            {groups.length > 1 && (
              <div className="text-xs text-gray-500 mb-2">
                총 {distinctAssets}개 종목 · {signals.length}개 신호
              </div>
            )}
            <div className="space-y-3">
              {groups.map((group) => {
                const style = ACTION_STYLES[group.action];
                return (
                  <div key={group.action}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${style.badge}`}>
                        {style.label}
                      </span>
                      <span className="text-xs text-gray-500">
                        {group.assets.length}개 종목
                        {group.signalCount > group.assets.length && ` · ${group.signalCount}개 신호`}
                      </span>
                    </div>
                    <ul className="space-y-1.5">
                      {group.assets.map((asset) => {
                        const invalidations = Array.from(
                          new Set(asset.rules.map(r => r.riskPolicy).filter((p): p is string => !!p)),
                        );
                        const isSelected = effectiveSelectedId === asset.assetId;
                        return (
                          <li
                            key={asset.assetId}
                            onClick={() => setSelectedAssetId(asset.assetId)}
                            className={`rounded px-2.5 py-1.5 cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-gray-900/80 ring-1 ring-primary/60'
                                : 'bg-gray-900/50 hover:bg-gray-900/80'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm text-white truncate max-w-[55%]">{asset.name}</span>
                              <span className="text-xs text-gray-500">{asset.ticker}</span>
                              {asset.source === 'watchlist' && (
                                <span className="text-[11px] text-blue-400">관심</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 flex-wrap mt-1">
                              {asset.rules.map((r) => (
                                <span
                                  key={r.ruleId}
                                  className="text-[11px] text-gray-300 bg-gray-700/70 rounded px-1.5 py-0.5"
                                >
                                  {RULE_SHORT_LABELS[r.ruleId] ?? r.ruleTitle}
                                </span>
                              ))}
                            </div>
                            {asset.rules.some(r => caveats.get(`${r.ruleId}__${asset.assetId}`)?.kind === 'firing-partial') && (
                              <div className="text-[11px] text-amber-300 mt-1">⚠ 일부 데이터 기준 발화 · 수동 확인 필요</div>
                            )}
                            {invalidations.length > 0 && (
                              <div className="text-[11px] text-gray-500 mt-1">
                                ⓘ 무효화: {invalidations.join(' / ')}
                              </div>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setExplainAssetId(prev => (prev === asset.assetId ? null : asset.assetId));
                              }}
                              className="text-[11px] text-cyan-400/80 hover:text-cyan-300 mt-1"
                            >
                              {explainAssetId === asset.assetId ? '설명 접기 ▴' : '왜 떴나 ▾'}
                            </button>
                            {explainAssetId === asset.assetId && (
                              <div className="mt-2 space-y-2 border-t border-gray-700/60 pt-2" onClick={(e) => e.stopPropagation()}>
                                {asset.rules.map((r) => {
                                  const rule = data.knowledgeBase.rules.find(x => x.id === r.ruleId);
                                  const enriched = derived.enrichedMap.get(asset.ticker);
                                  const currentPrice = chartTargets[asset.assetId]?.currentPrice ?? 0;
                                  const exp = buildSignalExplanation({
                                    rule,
                                    claims: data.knowledgeBase.claims,
                                    enriched,
                                    currentPrice,
                                  });
                                  return <ExplainBlock key={r.ruleId} title={RULE_SHORT_LABELS[r.ruleId] ?? r.ruleTitle} exp={exp} />;
                                })}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 우측: 선택 종목 차트 (모바일에선 리스트 아래로 쌓임) */}
          <div className="mt-3 lg:mt-0 lg:flex-1 lg:min-w-0">
            {chartTarget ? (
              <AssetTrendChart
                key={chartTarget.assetId}
                history={history}
                assetId={chartTarget.assetId}
                assetName={chartTarget.assetName}
                currentQuantity={chartTarget.currentQuantity}
                currentPrice={chartTarget.currentPrice}
                currency={chartTarget.currency}
                exchangeRate={chartTarget.exchangeRate}
                ticker={chartTarget.ticker}
                exchange={chartTarget.exchange}
                categoryId={chartTarget.categoryId}
                purchasePrice={chartTarget.purchasePrice}
                onExpand={() => setFullscreen(true)}
              />
            ) : (
              <div className="bg-gray-900/50 rounded-lg h-[220px] flex items-center justify-center text-xs text-gray-500">
                신호 종목을 선택하면 차트가 표시됩니다.
              </div>
            )}
          </div>
        </div>
      ))}

      {bodyVisible && (
        <p className="text-xs text-gray-600 mt-3 pt-2 border-t border-gray-700/60">
          지식 규칙 기반 참고 신호이며 투자자문이 아닙니다. 미검증·미구현 지표 규칙은 자동 발화되지 않습니다.
        </p>
      )}

      {fullscreen && chartTarget && (
        <ChartViewerModal
          history={history}
          assetId={chartTarget.assetId}
          assetName={chartTarget.assetName}
          currentQuantity={chartTarget.currentQuantity}
          currentPrice={chartTarget.currentPrice}
          currency={chartTarget.currency}
          exchangeRate={chartTarget.exchangeRate}
          ticker={chartTarget.ticker}
          exchange={chartTarget.exchange}
          categoryId={chartTarget.categoryId}
          purchasePrice={chartTarget.purchasePrice}
          onClose={() => setFullscreen(false)}
        />
      )}
    </div>
  );
};

export default GuruSignalCard;
