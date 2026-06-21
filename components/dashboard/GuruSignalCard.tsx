// 대시보드 "구루 신호 엔진" 카드 (⑤ Guru Signal Engine 가시화)
// ---------------------------------------------------------------------------
// 지식 DB의 활성 규칙(typed condition)을 종목별 평가한 결과(derived.guruSignals)를 노출.
// 평가·그룹핑은 utils/guruSignalEngine(순수)에 위임 — 이 컴포넌트는 렌더만 담당.
// 같은 종목이 여러 규칙에 걸리면 groupGuruSignals가 한 줄로 묶어 중복 표시를 막는다.
// 표시 수준은 "관찰 후보"이지 매수 추천이 아니다(문구·면책 명시).

import React from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { getActiveSignalRules, groupGuruSignals } from '../../utils/guruSignalEngine';
import type { RuleAction } from '../../types/knowledge';

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

const GuruSignalCard: React.FC = () => {
  const { data, derived } = usePortfolio();
  const signals = derived.guruSignals;
  const activeRuleCount = getActiveSignalRules(
    data.knowledgeBase.rules,
    data.knowledgeBase.claims,
    new Date(),
  ).length;

  const groups = groupGuruSignals(signals);
  const distinctAssets = new Set(signals.map(s => s.assetId)).size;

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-white flex items-center gap-1.5">
            🧭 구루 신호 엔진
          </h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            지식 규칙 기반 <span className="text-gray-400">관찰 후보</span> · 매수 추천이 아닙니다
          </p>
        </div>
        <span className="text-[11px] text-gray-500 whitespace-nowrap bg-gray-700/60 px-2 py-1 rounded shrink-0">
          활성 규칙 {activeRuleCount}개 평가
        </span>
      </div>

      {signals.length === 0 ? (
        <div className="bg-gray-900/60 rounded-md px-3 py-3 text-xs text-gray-400">
          {activeRuleCount === 0
            ? '평가 가능한 활성 규칙이 아직 없습니다. 지표·규칙 검증이 진행되면 여기에 신호가 표시됩니다.'
            : '현재 매칭된 신호가 없습니다. 조건을 충족하는 종목이 나타나면 표시됩니다.'}
        </div>
      ) : (
        <>
          <div className="text-[11px] text-gray-500 mb-2">
            {distinctAssets}개 종목 · {signals.length}개 신호
          </div>
          <div className="space-y-3">
            {groups.map((group) => {
              const style = ACTION_STYLES[group.action];
              return (
                <div key={group.action}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${style.badge}`}>
                      {style.label}
                    </span>
                    <span className="text-[11px] text-gray-500">
                      {group.assets.length}개 종목
                      {group.signalCount > group.assets.length && ` · ${group.signalCount}개 신호`}
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {group.assets.map((asset) => {
                      const invalidations = Array.from(
                        new Set(asset.rules.map(r => r.riskPolicy).filter((p): p is string => !!p)),
                      );
                      return (
                        <li key={asset.assetId} className="bg-gray-900/50 rounded px-2.5 py-1.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm text-white truncate max-w-[55%]">{asset.name}</span>
                            <span className="text-xs text-gray-500">{asset.ticker}</span>
                            {asset.source === 'watchlist' && (
                              <span className="text-[10px] text-blue-400">관심</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-wrap mt-1">
                            {asset.rules.map((r) => (
                              <span
                                key={r.ruleId}
                                className="text-[10px] text-gray-300 bg-gray-700/70 rounded px-1.5 py-0.5"
                              >
                                {RULE_SHORT_LABELS[r.ruleId] ?? r.ruleTitle}
                              </span>
                            ))}
                          </div>
                          {invalidations.length > 0 && (
                            <div className="text-[10px] text-gray-500 mt-1">
                              ⓘ 무효화: {invalidations.join(' / ')}
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
        </>
      )}

      <p className="text-[11px] text-gray-600 mt-3 pt-2 border-t border-gray-700/60">
        지식 규칙 기반 참고 신호이며 투자자문이 아닙니다. 미검증·미구현 지표 규칙은 자동 발화되지 않습니다.
      </p>
    </div>
  );
};

export default GuruSignalCard;
