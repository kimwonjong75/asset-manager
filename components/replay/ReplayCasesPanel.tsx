// components/replay/ReplayCasesPanel.tsx
// 검증 사례(P2) — 현재 화면을 사례로 저장 / 목록 / 재실행 / 이전결과 diff.
// UI 렌더링 전용(저장·재실행·diff 로직은 useSignalReplay 훅 + utils/replayCases).
// caseRole(research|holdout): 검증용(holdout)은 P3 과적합 방지 게이트에서 규칙 튜닝 대상에서 제외.

import React, { useState } from 'react';
import type { VerificationCase, ReplayCaseRole } from '../../types/signalReplay';
import type { CaseDiff } from '../../utils/replayCases';

const WINDOW_LABELS: Record<number, string> = { 126: '6개월', 252: '1년', 504: '2년', 756: '3년' };
const ROLE_LABELS: Record<ReplayCaseRole, string> = { research: '연구용', holdout: '검증용(holdout)' };
const ROLE_TONE: Record<ReplayCaseRole, string> = {
  research: 'text-gray-300 border-gray-600 bg-gray-700/40',
  holdout: 'text-violet-300 border-violet-500/50 bg-violet-500/10',
};

const fmtPct = (v: number | null | undefined): string =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

const DiffList: React.FC<{ label: string; dates: string[]; tone: string }> = ({ label, dates, tone }) =>
  dates.length === 0 ? null : (
    <div className="text-[11px]">
      <span className={tone}>{label} {dates.length}일</span>
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
    <div className="bg-gray-800 rounded-lg p-3 space-y-3">
      <h3 className="text-sm font-bold text-white">🗂️ 검증 사례 <span className="text-[11px] text-gray-500 font-normal">— 현재 화면을 저장하고 나중에 재실행·비교</span></h3>

      {/* 저장 폼 */}
      <div className="space-y-2 bg-gray-900/50 rounded p-2.5">
        <div className="flex items-center gap-1.5">
          {(['research', 'holdout'] as const).map(r => (
            <button
              key={r}
              onClick={() => setRole(r)}
              className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                role === r ? ROLE_TONE[r] : 'bg-gray-900/60 text-gray-400 border-gray-700 hover:bg-gray-700'
              }`}
            >
              {ROLE_LABELS[r]}
            </button>
          ))}
          <span className="text-[10px] text-gray-600">검증용은 규칙 튜닝 대상에서 빠집니다(과적합 방지)</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={memo}
            onChange={e => setMemo(e.target.value)}
            placeholder="사례 메모 (선택)"
            className="flex-1 bg-gray-900 text-xs text-white rounded px-2.5 py-1.5 border border-gray-700 focus:border-primary outline-none"
          />
          <button
            onClick={handleSave}
            disabled={!canSave}
            className={`text-xs px-3 py-1.5 rounded whitespace-nowrap ${
              canSave ? 'bg-primary/20 text-primary hover:bg-primary/30' : 'bg-gray-800 text-gray-600 cursor-not-allowed'
            }`}
          >
            현재 화면 저장
          </button>
        </div>
      </div>

      {/* 재실행 비교 diff */}
      {comparingCase && (
        <div className="bg-gray-900/50 rounded p-2.5 space-y-1.5 border border-primary/30">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-primary font-medium">🔁 재실행 비교 중 — {comparingCase.name} ({comparingCase.ticker})</span>
            <button onClick={onEndComparison} className="text-[11px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700">비교 종료</button>
          </div>
          {!caseDiff ? (
            <p className="text-[11px] text-gray-500">재계산 중… (또는 종목/기간이 사례와 달라 비교 불가)</p>
          ) : caseDiff.overall.added.length === 0 && caseDiff.overall.removed.length === 0 ? (
            <p className="text-[11px] text-emerald-400">신호일 변화 없음 — 저장 당시와 동일하게 재현됨.</p>
          ) : (
            <div className="space-y-1">
              <DiffList label="➕ 추가된 신호일" dates={caseDiff.overall.added} tone="text-emerald-400" />
              <DiffList label="➖ 사라진 신호일" dates={caseDiff.overall.removed} tone="text-rose-400" />
              {caseDiff.perRule.length > 0 && (
                <div className="pt-1 mt-1 border-t border-gray-700/60 space-y-1">
                  {caseDiff.perRule.map(r => (
                    <div key={r.ruleId} className="text-[11px]">
                      <span className="text-gray-400">{r.ruleId}</span>
                      {r.added.length > 0 && <span className="text-emerald-400 ml-1">+{r.added.length}</span>}
                      {r.removed.length > 0 && <span className="text-rose-400 ml-1">−{r.removed.length}</span>}
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
            <li key={c.id} className={`rounded px-2.5 py-2 ${c.ticker === currentTicker ? 'bg-gray-700/40' : 'bg-gray-900/50'}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm text-white truncate">{c.name}</span>
                  <span className="text-[10px] text-gray-500">{c.ticker}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${ROLE_TONE[c.caseRole]}`}>{ROLE_LABELS[c.caseRole]}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => onLoad(c)} className="text-[11px] px-2 py-0.5 rounded bg-gray-800 text-primary hover:bg-gray-700">재실행</button>
                  <button onClick={() => onDelete(c.id)} className="text-[11px] px-2 py-0.5 rounded bg-gray-800 text-gray-500 hover:bg-rose-500/20 hover:text-rose-300">삭제</button>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap text-[10px] text-gray-500 mt-0.5">
                <span className="font-mono">~{c.anchorDate}</span>
                <span>{WINDOW_LABELS[c.windowTradingDays] ?? `${c.windowTradingDays}일`}</span>
                <span>신호 {c.resultMetrics?.signalCount ?? c.perRuleResults.reduce((n, r) => n + r.signalDates.length, 0)}일</span>
                {c.resultMetrics?.avgRet20 != null && <span>평균 20일후 {fmtPct(c.resultMetrics.avgRet20)}</span>}
                {c.verdicts.length > 0 && <span className="text-amber-500/80">판정 {c.verdicts.length}</span>}
              </div>
              {c.memo && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{c.memo}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ReplayCasesPanel;
