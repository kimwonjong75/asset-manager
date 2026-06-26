// 알림 진단 패널 (5B-①) — "왜 이 알림이 떴나/안 떴나"
// ---------------------------------------------------------------------------
// 선택 종목의 모든(적용) 알림 규칙을 발화(evaluation)·데이터 품질(dataQuality) 직교 2축으로 진단.
// 팝업 전달 상태는 또 다른 직교 축으로 상단에 별도 표시(규칙 미충족과 "팝업 꺼짐/오늘 자동 확인 완료" 혼동 방지).
// 상태/선택/정렬/판정은 useAlertDiagnostics(훅)에 위임 — 이 컴포넌트는 렌더만(프로젝트 규칙).

import React, { useState } from 'react';
import { useAlertDiagnostics } from '../hooks/useAlertDiagnostics';
import type {
  AlertDiagnosticRow, AlertStatusTone, FilterDiagnostic, PopupDeliveryReason,
} from '../types/alertDiagnostics';

const TONE_CLASS: Record<AlertStatusTone, string> = {
  positive: 'text-emerald-300',
  neutral: 'text-gray-300',
  caution: 'text-amber-300',
  muted: 'text-gray-500',
};

const POPUP_REASON_TEXT: Record<PopupDeliveryReason, string> = {
  'will-show': '다음 접속 시 자동 브리핑에 표시됩니다',
  'auto-popup-disabled': '자동 브리핑 팝업이 꺼져 있습니다',
  'not-ready': '시세 업데이트/로딩 대기 중입니다',
  'already-checked-today': '오늘 자동 확인을 완료했습니다 (하루 1회)',
  'no-matches': '현재 발화 중인 규칙이 없습니다',
};

// 필터 leaf 행 — 실제값 vs 기준 + ✓/✗/—. 데이터 품질 저하(partial/missing)는 별도 색으로 캐비엇.
const FilterRow: React.FC<{ f: FilterDiagnostic }> = ({ f }) => (
  <div className="flex items-center gap-1.5 flex-wrap">
    <span className={f.result === true ? 'text-emerald-400' : f.result === false ? 'text-rose-400' : 'text-gray-500'}>
      {f.result === true ? '✓' : f.result === false ? '✗' : '—'}
    </span>
    <span className="text-gray-300">{f.label}</span>
    {f.actual !== undefined && <span className="text-white font-mono">{f.actual}</span>}
    {f.threshold !== undefined && <span className="text-gray-500">(기준 {f.threshold})</span>}
    {f.quality === 'partial' && <span className="text-amber-400/80">데이터 일부</span>}
    {f.quality === 'missing' && <span className="text-gray-500">데이터 없음</span>}
  </div>
);

const RuleRow: React.FC<{ row: AlertDiagnosticRow }> = ({ row }) => {
  const { diagnostic: d, status } = row;
  const [open, setOpen] = useState(false);
  return (
    <li className="bg-gray-900/50 rounded px-2.5 py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[11px] px-1.5 py-0.5 rounded shrink-0 ${
          d.action === 'sell' ? 'bg-red-500/15 text-red-300' : 'bg-blue-500/15 text-blue-300'
        }`}>
          {d.action === 'sell' ? '매도' : '매수'}
        </span>
        <span className="text-sm text-gray-200 truncate min-w-0">{d.ruleName}</span>
      </div>
      <div className={`text-xs mt-1 ${TONE_CLASS[status.tone]}`}>
        {status.label}
        {status.detail && <span className="text-gray-500"> · {status.detail}</span>}
      </div>
      <button
        onClick={() => setOpen(o => !o)}
        className="text-[11px] text-cyan-400/80 hover:text-cyan-300 mt-1"
      >
        {open ? '조건 접기 ▴' : '조건별 보기 ▾'}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 text-[11px] border-t border-gray-700/50 pt-1.5">
          {d.filters.map((f, i) => <FilterRow key={i} f={f} />)}
        </div>
      )}
    </li>
  );
};

const AlertDiagnosticsPanel: React.FC = () => {
  const { targets, selectedId, selectTarget, rows, popupDelivery } = useAlertDiagnostics();

  if (targets.length === 0) {
    return (
      <div className="bg-gray-900 rounded-lg p-4 text-xs text-gray-400">
        진단할 종목이 없습니다. 보유 종목·관심종목을 추가하거나 시세를 갱신해 주세요.
      </div>
    );
  }

  const portfolioTargets = targets.filter(t => t.source === 'portfolio');
  const watchlistTargets = targets.filter(t => t.source === 'watchlist');

  return (
    <div className="bg-gray-900 rounded-lg p-4 space-y-3">
      {/* 팝업 전달 상태 — 규칙 발화와 직교 축(별도 표시) */}
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <span className={`px-1.5 py-0.5 rounded ${popupDelivery.willAutoShow ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-700 text-gray-400'}`}>
          자동 브리핑: {popupDelivery.willAutoShow ? '표시 예정' : '미표시'}
        </span>
        <span className="text-gray-500">{POPUP_REASON_TEXT[popupDelivery.reason]}</span>
        <span className="text-gray-600">· 발화 규칙 {popupDelivery.matchedRuleCount}개</span>
      </div>

      {/* 종목 선택 */}
      <div className="flex items-center gap-2 flex-wrap">
        <label htmlFor="alert-diag-target" className="text-xs text-gray-400 shrink-0">진단 종목</label>
        <select
          id="alert-diag-target"
          value={selectedId ?? ''}
          onChange={(e) => selectTarget(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded px-2 py-1 max-w-full min-w-0 flex-1"
        >
          {portfolioTargets.length > 0 && (
            <optgroup label="보유 종목">
              {portfolioTargets.map(t => <option key={t.assetId} value={t.assetId}>{t.name} ({t.ticker})</option>)}
            </optgroup>
          )}
          {watchlistTargets.length > 0 && (
            <optgroup label="관심 종목(매수 규칙만)">
              {watchlistTargets.map(t => <option key={t.assetId} value={t.assetId}>{t.name} ({t.ticker})</option>)}
            </optgroup>
          )}
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="text-xs text-gray-400">이 종목에 적용할 알림 규칙이 없습니다.</div>
      ) : (
        <ul className="space-y-2 lg:max-h-[380px] lg:overflow-y-auto lg:pr-1">
          {rows.map(row => <RuleRow key={row.diagnostic.ruleId} row={row} />)}
        </ul>
      )}

      <p className="text-[11px] text-gray-600">
        '미충족'은 현재 계산 기준 조건 불일치, '일부 데이터 누락'은 OHLC 등 일부 지표 미수신으로 완전히 따지지 못한 상태,
        '데이터 부족'은 지표 미수신, '규칙 꺼짐'은 설정에서 비활성. 자동 브리핑 표시 여부는 규칙 충족과 별개입니다.
      </p>
    </div>
  );
};

export default AlertDiagnosticsPanel;
