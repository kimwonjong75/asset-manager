// components/replay/ReplayVerdictPanel.tsx
// 신호 사용자 판정(P2) — 선택 시점에 대한 good/too-early/.../missed-buy/missed-sell 입력 + 메모.
// UI 렌더링 전용(저장 로직은 useSignalReplay 훅). 놓친 매수/매도는 신호가 안 뜬 날에도 태깅 가능.
// 판정 대상: "날짜 전체"(ruleId 없음) 또는 그 날 평가된 특정 구루 규칙(ruleId) — 같은 날 여러 규칙에
//   "이 규칙은 너무 늦다" 식의 규칙별 피드백을 남길 수 있다.

import React, { useEffect, useMemo, useState } from 'react';
import type { SignalVerdict, SignalVerdictKind } from '../../types/signalReplay';

export const VERDICT_KIND_LABELS: Record<SignalVerdictKind, string> = {
  'good': '적절함',
  'too-early': '너무 빠름',
  'too-late': '너무 늦음',
  'false': '잘못된 신호',
  'missed-buy': '놓친 매수',
  'missed-sell': '놓친 매도',
};

const VERDICT_KIND_TONE: Record<SignalVerdictKind, string> = {
  'good': 'text-emerald-300 border-emerald-500/50 bg-emerald-500/10',
  'too-early': 'text-amber-300 border-amber-500/50 bg-amber-500/10',
  'too-late': 'text-amber-300 border-amber-500/50 bg-amber-500/10',
  'false': 'text-rose-300 border-rose-500/50 bg-rose-500/10',
  'missed-buy': 'text-sky-300 border-sky-500/50 bg-sky-500/10',
  'missed-sell': 'text-sky-300 border-sky-500/50 bg-sky-500/10',
};

const KIND_ORDER: SignalVerdictKind[] = ['good', 'too-early', 'too-late', 'false', 'missed-buy', 'missed-sell'];

const DAY_SCOPE = '__day__'; // <select> value 로 "날짜 전체"(ruleId 없음)를 표현

export interface ReplayVerdictPanelProps {
  date: string | null;
  ruleOptions: { ruleId: string; title: string }[]; // 그 날 평가된 구루 규칙(대상 선택지)
  ruleTitleById: Record<string, string>;            // 목록의 규칙 라벨 해석용
  hasSignal: boolean;                               // 선택일에 구루 신호 마커가 있는지(라벨 힌트용)
  tickerVerdicts: SignalVerdict[];                  // 이 종목 판정 전체(목록 + current 해석)
  onSet: (kind: SignalVerdictKind, memo: string, ruleId?: string) => void;
  onClear: (date: string, ruleId?: string) => void;
  onJump: (date: string) => void;
}

const ReplayVerdictPanel: React.FC<ReplayVerdictPanelProps> = ({
  date, ruleOptions, ruleTitleById, hasSignal, tickerVerdicts, onSet, onClear, onJump,
}) => {
  const [targetRuleId, setTargetRuleId] = useState<string | undefined>(undefined); // undefined = 날짜 전체
  const [kind, setKind] = useState<SignalVerdictKind | null>(null);
  const [memo, setMemo] = useState('');

  // 날짜가 바뀌면 대상을 "날짜 전체"로 초기화(이전 규칙이 새 날엔 평가 안 됐을 수 있음).
  useEffect(() => { setTargetRuleId(undefined); }, [date]);

  // 현재 (date, targetRuleId) 의 기존 판정.
  const current = useMemo(
    () => (date
      ? tickerVerdicts.find(v => v.date === date && (v.ruleId ?? '') === (targetRuleId ?? ''))
      : undefined),
    [tickerVerdicts, date, targetRuleId],
  );

  // 선택일/대상/기존 판정이 바뀌면 입력 폼을 동기화.
  useEffect(() => {
    setKind(current?.kind ?? null);
    setMemo(current?.memo ?? '');
  }, [date, targetRuleId, current]);

  if (!date) return null;

  return (
    <div className="bg-gray-800 rounded-lg p-3 space-y-2">
      <h3 className="text-sm font-bold text-white">📝 내 판정 <span className="text-[11px] text-gray-500 font-normal">— {date}</span></h3>
      <p className="text-[11px] text-gray-600">
        이 시점의 신호 타이밍을 평가해 두면, 나중에 규칙을 보완할 학습 데이터가 됩니다.
        {!hasSignal && <span className="text-gray-500"> 신호가 안 뜬 날도 <span className="text-sky-400">놓친 매수/매도</span>로 기록할 수 있습니다.</span>}
      </p>

      {/* 판정 대상: 날짜 전체 / 특정 구루 규칙 */}
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-gray-500 whitespace-nowrap">대상</label>
        <select
          value={targetRuleId ?? DAY_SCOPE}
          onChange={e => setTargetRuleId(e.target.value === DAY_SCOPE ? undefined : e.target.value)}
          className="flex-1 min-w-0 bg-gray-900 text-xs text-white rounded px-2 py-1.5 border border-gray-700 focus:border-primary outline-none"
        >
          <option value={DAY_SCOPE}>날짜 전체</option>
          {ruleOptions.map(r => (
            <option key={r.ruleId} value={r.ruleId}>규칙: {r.title}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {KIND_ORDER.map(k => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`text-[11px] px-2 py-1 rounded border transition-colors ${
              kind === k ? VERDICT_KIND_TONE[k] : 'bg-gray-900/60 text-gray-400 border-gray-700 hover:bg-gray-700'
            }`}
          >
            {VERDICT_KIND_LABELS[k]}
          </button>
        ))}
      </div>

      <textarea
        value={memo}
        onChange={e => setMemo(e.target.value)}
        placeholder="메모 (선택) — 예: 거래량 동반 안 됨, 며칠 더 기다렸어야"
        rows={2}
        className="w-full bg-gray-900 text-xs text-white rounded px-2.5 py-1.5 border border-gray-700 focus:border-primary outline-none resize-none"
      />

      <div className="flex items-center gap-2">
        <button
          onClick={() => kind && onSet(kind, memo, targetRuleId)}
          disabled={!kind}
          className={`text-xs px-3 py-1.5 rounded ${
            kind ? 'bg-primary/20 text-primary hover:bg-primary/30' : 'bg-gray-800 text-gray-600 cursor-not-allowed'
          }`}
        >
          {current ? '판정 수정' : '판정 저장'}
        </button>
        {current && (
          <button
            onClick={() => onClear(date, targetRuleId)}
            className="text-xs px-3 py-1.5 rounded bg-gray-900 text-gray-400 hover:bg-gray-700"
          >
            삭제
          </button>
        )}
        {current && (
          <span className="text-[11px] text-gray-500">
            현재: {VERDICT_KIND_LABELS[current.kind]}{targetRuleId ? ' (규칙별)' : ''}
          </span>
        )}
      </div>

      {tickerVerdicts.length > 0 && (
        <div className="pt-2 border-t border-gray-700/60">
          <div className="text-[11px] text-gray-500 mb-1">이 종목 판정 {tickerVerdicts.length}개</div>
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {tickerVerdicts.map(v => (
              <li
                key={`${v.date}-${v.ruleId ?? ''}`}
                className={`flex items-center justify-between gap-2 text-[11px] rounded px-2 py-1 cursor-pointer hover:bg-gray-700/40 ${
                  v.date === date ? 'bg-gray-700/40' : 'bg-gray-900/40'
                }`}
                onClick={() => onJump(v.date)}
              >
                <span className="font-mono text-gray-300 whitespace-nowrap">{v.date}</span>
                <span className={`whitespace-nowrap ${VERDICT_KIND_TONE[v.kind].split(' ')[0]}`}>{VERDICT_KIND_LABELS[v.kind]}</span>
                {v.ruleId && (
                  <span className="text-[10px] text-violet-300/80 truncate" title={ruleTitleById[v.ruleId] ?? v.ruleId}>
                    · {ruleTitleById[v.ruleId] ?? v.ruleId}
                  </span>
                )}
                {v.memo && <span className="text-gray-500 truncate flex-1 text-right">{v.memo}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default ReplayVerdictPanel;
