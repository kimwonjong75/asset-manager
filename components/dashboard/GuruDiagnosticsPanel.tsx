// 구루 신호 진단 패널 (5A-⑤) — "왜 신호가 안 뜨나요?"
// ---------------------------------------------------------------------------
// 선택 종목의 모든 신호 규칙을 3축(자격/평가/준비도)으로 진단해 사용자용 단일 상태로 보여준다.
// 상태/선택/정렬은 useGuruDiagnostics(훅)에 위임 — 이 컴포넌트는 렌더만 담당(프로젝트 규칙).
// 신호 0건이어도 보이며(왜 0건인지 설명이 목적), 포트폴리오+관심종목 전체를 선택 대상으로 노출한다.

import React, { useState } from 'react';
import { useGuruDiagnostics } from '../../hooks/useGuruDiagnostics';
import type { DiagnosticRow } from '../../types/guruDiagnostics';
import { RULE_ACTION_LABELS, type StatusTone, type LeafExplain } from '../../types/knowledge';

const TONE_CLASS: Record<StatusTone, string> = {
  positive: 'text-emerald-300',
  neutral: 'text-gray-300',
  caution: 'text-amber-300',
  muted: 'text-gray-500',
};

// 조건 leaf별 실제값 vs 기준 — GuruSignalCard의 ExplainBlock과 같은 표기 규약(✓/✗/—).
const LeafRow: React.FC<{ leaf: LeafExplain }> = ({ leaf }) => (
  <div className="flex items-center gap-1.5 flex-wrap">
    <span className={leaf.passed === true ? 'text-emerald-400' : leaf.passed === false ? 'text-rose-400' : 'text-gray-500'}>
      {leaf.passed === true ? '✓' : leaf.passed === false ? '✗' : '—'}
    </span>
    <span className="text-gray-300">{leaf.label}</span>
    <span className="text-white font-mono">{leaf.actual}</span>
    <span className="text-gray-500">(기준 {leaf.condition})</span>
  </div>
);

const RuleDiagnosticRow: React.FC<{ row: DiagnosticRow }> = ({ row }) => {
  const { diagnostic: d, status } = row;
  const [open, setOpen] = useState(false);
  return (
    <li className="bg-gray-900/50 rounded px-2.5 py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-gray-300 bg-gray-700/60 rounded px-1.5 py-0.5 shrink-0">
          {RULE_ACTION_LABELS[d.action]}
        </span>
        <span className="text-sm text-gray-200 truncate min-w-0">{d.ruleTitle}</span>
      </div>
      <div className={`text-xs mt-1 ${TONE_CLASS[status.tone]}`}>
        {status.label}
        {status.detail && <span className="text-gray-500"> · {status.detail}</span>}
      </div>
      {d.leaves.length > 0 && (
        <>
          <button
            onClick={() => setOpen(o => !o)}
            className="text-[11px] text-cyan-400/80 hover:text-cyan-300 mt-1"
          >
            {open ? '조건 접기 ▴' : '조건별 보기 ▾'}
          </button>
          {open && (
            <div className="mt-1.5 space-y-1 text-[11px] border-t border-gray-700/50 pt-1.5">
              {d.leaves.map((lf, i) => <LeafRow key={i} leaf={lf} />)}
            </div>
          )}
        </>
      )}
    </li>
  );
};

const GuruDiagnosticsPanel: React.FC = () => {
  const { targets, selectedId, selectTarget, rows, summary } = useGuruDiagnostics();

  if (targets.length === 0) {
    return (
      <div className="mt-3 border-t border-gray-700/60 pt-3 text-xs text-gray-400">
        진단할 종목이 없습니다. 보유 종목·관심종목을 추가하거나 시세를 갱신해 주세요.
      </div>
    );
  }

  const portfolioTargets = targets.filter(t => t.source === 'portfolio');
  const watchlistTargets = targets.filter(t => t.source === 'watchlist');

  return (
    <div className="mt-3 border-t border-gray-700/60 pt-3">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <label htmlFor="guru-diag-target" className="text-xs text-gray-400 shrink-0">진단 종목</label>
        <select
          id="guru-diag-target"
          value={selectedId ?? ''}
          onChange={(e) => selectTarget(e.target.value)}
          className="bg-gray-900 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1 max-w-full min-w-0 flex-1"
        >
          {portfolioTargets.length > 0 && (
            <optgroup label="보유 종목">
              {portfolioTargets.map(t => (
                <option key={t.assetId} value={t.assetId}>{t.name} ({t.ticker})</option>
              ))}
            </optgroup>
          )}
          {watchlistTargets.length > 0 && (
            <optgroup label="관심 종목">
              {watchlistTargets.map(t => (
                <option key={t.assetId} value={t.assetId}>{t.name} ({t.ticker})</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {summary && (
        <div className="text-[11px] text-gray-500 mb-2 flex flex-wrap gap-x-3 gap-y-0.5">
          <span>활성 {summary.eligibility.eligible} · 비활성 {summary.eligibility.inactive}</span>
          <span className="text-gray-600">|</span>
          <span>충족 {summary.evaluation.matched} · 미충족 {summary.evaluation.unmatched} · 판정불가 {summary.evaluation.unknown}</span>
          {(summary.readiness.partial > 0 || summary.readiness.missing > 0 || summary.readiness.unsupported > 0) && (
            <>
              <span className="text-gray-600">|</span>
              <span className="text-amber-400/70">
                데이터: 일부 {summary.readiness.partial} · 없음 {summary.readiness.missing} · 미지원 {summary.readiness.unsupported}
              </span>
            </>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="text-xs text-gray-400 bg-gray-900/50 rounded px-3 py-2">
          이 종목에 적용할 신호 규칙이 없습니다.
        </div>
      ) : (
        <ul className="space-y-2 lg:max-h-[360px] lg:overflow-y-auto lg:pr-1">
          {rows.map(row => <RuleDiagnosticRow key={row.diagnostic.ruleId} row={row} />)}
        </ul>
      )}

      <p className="text-[11px] text-gray-600 mt-2">
        '미충족'은 현재 계산 기준 조건 불일치, '일부 데이터 누락'은 OHLC 등 일부 지표 미수신으로 완전히 따지지 못한 상태,
        '데이터 부족'은 해당 종목 지표 미수신, '미지원'은 앱이 아직 계산하지 못하는 지표입니다.
      </p>
    </div>
  );
};

export default GuruDiagnosticsPanel;
