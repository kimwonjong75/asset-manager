// components/replay/ReplaySandboxPanel.tsx
// 신호 리플레이 샌드박스(P3, 렌더 전용) — 구루 규칙 leaf를 "값 + on/off"로 즉석 조정 → 마커/신호 즉시 재계산.
// **라이브 구루 신호·KnowledgeBase·시드 규칙은 절대 안 바뀜**(이 화면 state 한정). operator/value 형태 변경은 P4.
// 계산/가드 로직은 utils/ruleSandbox(순수), 저장은 useSignalReplay. 컴포넌트는 렌더 + 콜백만.

import React from 'react';
import { describeRuleLeaves, wouldKeepActiveLeaf, type SandboxLeaf } from '../../utils/ruleSandbox';
import { metricLabel } from '../../utils/conditionDescribe';
import type { KnowledgeRule, RequiredMetric, ConditionOperator } from '../../types/knowledge';
import type { RuleOverride } from '../../types/signalReplay';
import type { CaseDiff } from '../../utils/replayCases';

const OP_LABEL: Record<ConditionOperator, string> = {
  '>=': '이상', '<=': '이하', '>': '초과', '<': '미만', '=': '=',
  'between': '범위', 'in': '포함', 'crossesAbove': '상향돌파', 'crossesBelow': '하향돌파',
};

const num = (v: SandboxLeaf['value'], i = 0): number => {
  if (typeof v === 'number') return v;
  if (Array.isArray(v) && typeof v[i] === 'number') return v[i] as number;
  return 0;
};

export interface ReplaySandboxPanelProps {
  rules: KnowledgeRule[];                 // 시드 signal 규칙(조정 대상)
  overrides: RuleOverride[];              // 현재 샌드박스 오버라이드
  diff: CaseDiff | null;                  // 기준(샌드박스 적용 전) 대비 변화
  onSetValue: (ruleId: string, leafId: string, value: number) => void;
  onSetBetween: (ruleId: string, leafId: string, which: 'min' | 'max', n: number) => void;
  onSetEnabled: (ruleId: string, leafId: string, enabled: boolean) => void;
  onResetLeaf: (ruleId: string, leafId: string) => void;
  onResetRule: (ruleId: string) => void;
  onResetAll: () => void;
}

const numberInputCls = 'w-20 bg-gray-900 text-xs text-white text-right rounded px-1.5 py-1 border border-gray-700 focus:border-primary outline-none';

const LeafRow: React.FC<{
  rule: KnowledgeRule;
  leaf: SandboxLeaf;
  overrides: RuleOverride[];
  props: ReplaySandboxPanelProps;
}> = ({ rule, leaf, overrides, props }) => {
  const label = metricLabel(leaf.metric as RequiredMetric);
  // 켜져 있는데 끄면 활성 leaf가 0이 되는 경우(마지막 조건) → off 차단(원본 유지 착시 예방).
  const offBlocked = leaf.enabled && !wouldKeepActiveLeaf(rule, overrides, leaf.leafId, false);

  return (
    <div className={`rounded px-2 py-1.5 ${leaf.enabled ? 'bg-gray-900/40' : 'bg-gray-900/20 opacity-60'}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs text-gray-200 truncate">{label}</span>
          <span className="text-[10px] text-gray-500">{OP_LABEL[leaf.operator]}</span>
          {leaf.overridden && <span className="text-[10px] text-amber-400" title="기준값에서 변경됨">●</span>}
        </div>
        <div className="flex items-center gap-1">
          {/* 값 편집 — kind별 분기. value 형태는 절대 바꾸지 않음. */}
          {leaf.kind === 'single' && (
            <input
              type="number" step="any" value={num(leaf.value)} disabled={!leaf.enabled}
              onChange={e => { const n = parseFloat(e.target.value); if (!Number.isNaN(n)) props.onSetValue(rule.id, leaf.leafId, n); }}
              className={numberInputCls}
            />
          )}
          {leaf.kind === 'between' && (
            <div className="flex items-center gap-1">
              <input
                type="number" step="any" value={num(leaf.value, 0)} disabled={!leaf.enabled}
                onChange={e => { const n = parseFloat(e.target.value); if (!Number.isNaN(n)) props.onSetBetween(rule.id, leaf.leafId, 'min', n); }}
                className={numberInputCls}
              />
              <span className="text-[10px] text-gray-500">~</span>
              <input
                type="number" step="any" value={num(leaf.value, 1)} disabled={!leaf.enabled}
                onChange={e => { const n = parseFloat(e.target.value); if (!Number.isNaN(n)) props.onSetBetween(rule.id, leaf.leafId, 'max', n); }}
                className={numberInputCls}
              />
            </div>
          )}
          {leaf.kind === 'fixed' && (
            <span className="text-[11px] text-gray-400 font-mono px-1" title="값 편집은 P4(문자열/범위형은 on/off만)">
              {Array.isArray(leaf.value) ? leaf.value.join(', ') : String(leaf.value)}
            </span>
          )}
          {/* on/off */}
          <button
            onClick={() => props.onSetEnabled(rule.id, leaf.leafId, !leaf.enabled)}
            disabled={offBlocked}
            title={offBlocked ? '최소 1개 조건은 유지해야 합니다' : (leaf.enabled ? '이 조건 끄기' : '이 조건 켜기')}
            className={`text-[10px] px-1.5 py-1 rounded border ${
              leaf.enabled
                ? `border-emerald-600/50 text-emerald-300 ${offBlocked ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-700'}`
                : 'border-gray-700 text-gray-500 hover:bg-gray-700'
            }`}
          >
            {leaf.enabled ? '켜짐' : '꺼짐'}
          </button>
          {leaf.overridden && (
            <button
              onClick={() => props.onResetLeaf(rule.id, leaf.leafId)}
              title="이 조건 기준값으로 복원"
              className="text-[10px] px-1 py-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-700"
            >
              ↺
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const ReplaySandboxPanel: React.FC<ReplaySandboxPanelProps> = (props) => {
  const { rules, overrides, diff, onResetRule, onResetAll } = props;
  const hasAny = overrides.length > 0;
  const changed = !!diff && (diff.overall.added.length > 0 || diff.overall.removed.length > 0);

  return (
    <div className="bg-gray-800 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-white">🧪 규칙 샌드박스 <span className="text-[11px] text-gray-500 font-normal">— 임계값·on/off 조정(이 화면만, 라이브 미반영)</span></h3>
        {hasAny && (
          <button onClick={onResetAll} className="text-[11px] px-2 py-1 rounded bg-gray-900 text-gray-400 hover:bg-gray-700">전체 초기화</button>
        )}
      </div>
      <p className="text-[11px] text-gray-600">
        값을 바꾸면 차트 마커와 신호가 즉시 다시 계산됩니다. <span className="text-gray-500">실제 구루 신호·알림·저장된 규칙은 바뀌지 않습니다.</span>
        문자열/범주형 조건은 켜기/끄기만, 방향(부등호) 변경은 추후 지원합니다.
      </p>

      {/* 기준 대비 변화 */}
      {hasAny && (
        <div className={`rounded p-2 text-[11px] border ${changed ? 'border-amber-500/30 bg-amber-500/5' : 'border-gray-700 bg-gray-900/40'}`}>
          {!diff ? (
            <span className="text-gray-500">기준 대비 계산 중…</span>
          ) : !changed ? (
            <span className="text-gray-400">기준(조정 전) 대비 신호일 변화 없음.</span>
          ) : (
            <div className="space-y-0.5">
              <span className="text-amber-300 font-medium">기준 대비 변화</span>
              {diff.overall.added.length > 0 && <div><span className="text-emerald-400">➕ {diff.overall.added.length}일 추가</span> <span className="text-gray-500 font-mono break-all">{diff.overall.added.join(', ')}</span></div>}
              {diff.overall.removed.length > 0 && <div><span className="text-rose-400">➖ {diff.overall.removed.length}일 사라짐</span> <span className="text-gray-500 font-mono break-all">{diff.overall.removed.join(', ')}</span></div>}
            </div>
          )}
        </div>
      )}

      {/* 규칙별 leaf 편집 */}
      {rules.length === 0 ? (
        <p className="text-xs text-gray-500">조정할 구루 규칙이 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {rules.map(rule => {
            const leaves = describeRuleLeaves(rule, overrides);
            const ruleOverridden = leaves.some(l => l.overridden);
            return (
              <li key={rule.id} className="bg-gray-900/30 rounded p-2">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-medium text-white truncate">{rule.title}</span>
                  {ruleOverridden && (
                    <button onClick={() => onResetRule(rule.id)} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700">규칙 초기화</button>
                  )}
                </div>
                <div className="space-y-1">
                  {leaves.map(leaf => (
                    <LeafRow key={leaf.leafId} rule={rule} leaf={leaf} overrides={overrides} props={props} />
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default ReplaySandboxPanel;
