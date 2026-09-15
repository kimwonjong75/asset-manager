// components/replay/ReplayCasesPanel.tsx
// 검증 사례(P2) — 현재 화면을 사례로 저장 / 목록 / 재실행 / 이전결과 diff.
// UI 렌더링 전용(저장·재실행·diff 로직은 useSignalReplay 훅 + utils/replayCases).
// caseRole(research|holdout): 검증용(holdout)은 P3 과적합 방지 게이트에서 규칙 튜닝 대상에서 제외.
// Stage C: 신호일 추가/사라짐은 오류·성공이 아닌 "변화"라 중립색 + Plus/Minus 아이콘. 삭제=Button danger.

import React, { useState } from 'react';
import { Check, FolderOpen, Minus, Plus, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import Button from '../common/Button';
import type { VerificationCase, ReplayCaseRole } from '../../types/signalReplay';
import type { CaseDiff } from '../../utils/replayCases';

const WINDOW_LABELS: Record<number, string> = { 126: '6개월', 252: '1년', 504: '2년', 756: '3년' };
const ROLE_LABELS: Record<ReplayCaseRole, string> = { research: '연구용', holdout: '검증용(holdout)' };
const ROLE_TONE: Record<ReplayCaseRole, string> = {
  research: 'text-gray-300 border-border-subtle bg-surface-muted',
  holdout: 'text-primary-light border-primary/40 bg-primary/10',
};

const fmtPct = (v: number | null | undefined): string =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

const DiffList: React.FC<{ label: string; dates: string[]; icon: React.ReactNode }> = ({ label, dates, icon }) =>
  dates.length === 0 ? null : (
    <div className="text-xs">
      <span className="inline-flex items-center gap-1 text-gray-200 font-medium">{icon}{label} {dates.length}일</span>
      <span className="text-gray-500 ml-1 font-mono break-all">{dates.join(', ')}</span>
    </div>
  );

export interface ReplayCasesPanelProps {
  cases: VerificationCase[];
  currentTicker: string | null;
  canSave: boolean;
  onSave: (role: ReplayCaseRole, memo: string) => void;
  onLoad: (c: VerificationCase) => void;
  onDelete: (id: string) => void;
  comparingCase: VerificationCase | null;
  caseDiff: CaseDiff | null;
  onEndComparison: () => void;
}

const ReplayCasesPanel: React.FC<ReplayCasesPanelProps> = ({
  cases, currentTicker, canSave, onSave, onLoad, onDelete, comparingCase, caseDiff, onEndComparison,
}) => {
  const [role, setRole] = useState<ReplayCaseRole>('research');
  const [memo, setMemo] = useState('');

  const handleSave = (): void => {
    onSave(role, memo);
    setMemo('');
  };

  return (
    <div className="bg-surface-elevated border border-border-subtle rounded-card p-3 space-y-3">
      <h3 className="text-base font-semibold text-white flex items-center gap-1.5 flex-wrap">
        <FolderOpen className="h-4 w-4 text-gray-400" aria-hidden="true" />
        검증 사례 <span className="text-xs text-gray-500 font-normal">— 현재 화면을 저장하고 나중에 재실행·비교</span>
      </h3>

      {/* 저장 폼 */}
      <div className="space-y-2 bg-surface-muted rounded-lg p-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          {(['research', 'holdout'] as const).map(r => (
            <button
              key={r}
              onClick={() => setRole(r)}
              aria-pressed={role === r}
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                role === r ? ROLE_TONE[r] : 'bg-surface-elevated text-gray-400 border-border-subtle hover:bg-gray-600'
              }`}
            >
              {ROLE_LABELS[r]}
            </button>
          ))}
          <span className="text-xs text-gray-500">검증용은 규칙 튜닝 대상에서 빠집니다(과적합 방지)</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={memo}
            onChange={e => setMemo(e.target.value)}
            placeholder="사례 메모 (선택)"
            className="flex-1 min-w-0 bg-surface-elevated text-xs text-white rounded px-2.5 py-1.5 border border-border-subtle focus:border-primary outline-none"
          />
          <Button variant="primary" onClick={handleSave} disabled={!canSave} className="whitespace-nowrap">
            현재 화면 저장
          </Button>
        </div>
      </div>

      {/* 재실행 비교 diff */}
      {comparingCase && (
        <div className="bg-surface-muted rounded-lg p-2.5 space-y-1.5 border border-primary/30">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs text-primary-light font-medium flex items-center gap-1.5 flex-wrap">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              재실행 비교 중 — {comparingCase.name} ({comparingCase.ticker})
              <span className={`text-xs px-1.5 py-0.5 rounded border ${ROLE_TONE[comparingCase.caseRole]}`}>{ROLE_LABELS[comparingCase.caseRole]}</span>
            </span>
            <Button variant="ghost" onClick={onEndComparison}>비교 종료</Button>
          </div>
          {/* P3-④ 과적합 경고 — holdout 사례에서 신호가 바뀌면 규칙을 거기 맞추지 말 것 */}
          {comparingCase.caseRole === 'holdout' && caseDiff && (caseDiff.overall.added.length > 0 || caseDiff.overall.removed.length > 0) && (
            <p className="text-xs text-amber-300 bg-warning-soft border border-warning/30 rounded px-2 py-1 flex items-start gap-1.5">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden="true" />
              <span>검증용(holdout) 사례입니다. 신호가 바뀌었습니다 — 이 사례에 <span className="font-medium">규칙을 맞추지 마세요</span>(과적합). 조정은 연구용 사례로 하고, holdout에서는 유지/개선되는지만 확인하세요.</span>
            </p>
          )}
          {!caseDiff ? (
            <p className="text-xs text-gray-500">재계산 중… (또는 종목/기간이 사례와 달라 비교 불가)</p>
          ) : caseDiff.overall.added.length === 0 && caseDiff.overall.removed.length === 0 ? (
            <p className="text-xs text-ok flex items-center gap-1">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />신호일 변화 없음 — 저장 당시와 동일하게 재현됨.
            </p>
          ) : (
            <div className="space-y-1">
              <DiffList label="추가된 신호일" dates={caseDiff.overall.added} icon={<Plus className="h-3 w-3" aria-hidden="true" />} />
              <DiffList label="사라진 신호일" dates={caseDiff.overall.removed} icon={<Minus className="h-3 w-3" aria-hidden="true" />} />
              {caseDiff.perRule.length > 0 && (
                <div className="pt-1 mt-1 border-t border-border-subtle space-y-1">
                  {caseDiff.perRule.map(r => (
                    <div key={r.ruleId} className="text-xs">
                      <span className="text-gray-400">{r.ruleId}</span>
                      {r.added.length > 0 && <span className="text-gray-200 ml-1">+{r.added.length}</span>}
                      {r.removed.length > 0 && <span className="text-gray-200 ml-1">−{r.removed.length}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 사례 목록 */}
      {cases.length === 0 ? (
        <p className="text-xs text-gray-500">저장된 사례가 없습니다.</p>
      ) : (
        <ul className="space-y-1.5 max-h-72 overflow-y-auto">
          {cases.map(c => (
            <li key={c.id} className={`rounded-lg px-2.5 py-2 ${c.ticker === currentTicker ? 'bg-gray-600/60' : 'bg-surface-muted'}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm text-white truncate">{c.name}</span>
                  <span className="text-xs text-gray-500">{c.ticker}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded border ${ROLE_TONE[c.caseRole]}`}>{ROLE_LABELS[c.caseRole]}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => onLoad(c)}>재실행</Button>
                  <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(c.id)}>삭제</Button>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500 mt-0.5">
                <span className="font-mono">~{c.anchorDate}</span>
                <span>{WINDOW_LABELS[c.windowTradingDays] ?? `${c.windowTradingDays}일`}</span>
                <span>신호 {c.resultMetrics?.signalCount ?? c.perRuleResults.reduce((n, r) => n + r.signalDates.length, 0)}일</span>
                {c.resultMetrics?.avgRet20 != null && <span>평균 20일후 {fmtPct(c.resultMetrics.avgRet20)}</span>}
                {c.verdicts.length > 0 && <span className="text-gray-300">판정 {c.verdicts.length}</span>}
              </div>
              {c.memo && <p className="text-xs text-gray-400 mt-0.5 truncate">{c.memo}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ReplayCasesPanel;
