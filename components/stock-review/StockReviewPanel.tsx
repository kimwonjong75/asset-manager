import React from 'react';
import type {
  StockReviewCondition,
  StockReviewConditionStatus,
  StockReviewDataStatus,
  StockReviewEvaluation,
  StockReviewSideSummary,
  StockReviewViewModel,
} from '../../types/stockReview';
import { STOCK_REVIEW_SUBTITLE } from '../../types/stockReview';
import type { StockReviewState } from '../../hooks/useStockReview';

/** evaluation → 칩 표시 상태 ('판정불가'는 사용자 라벨 '데이터 부족'). */
function chipStatus(e: StockReviewEvaluation): StockReviewConditionStatus {
  return e === '판정불가' ? '데이터 부족' : e;
}

// StockReviewPanel — "종목 검토" 아코디언 본문. 전달된 상태(StockReviewState)만 렌더링(로직/API 없음).
//   loading      → 스켈레톤(준비 중)
//   unavailable  → 영구 결측 종결 메시지(스피너 아님, muted)
//   ready        → ViewModel 렌더

interface StockReviewPanelProps {
  state: StockReviewState;
}

const STATUS_STYLE: Record<StockReviewConditionStatus, string> = {
  '충족': 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40',
  '미충족': 'bg-gray-600/30 text-gray-300 border border-gray-500/40',
  '데이터 부족': 'bg-amber-500/20 text-amber-300 border border-amber-500/40',
  '해당 없음': 'bg-gray-700/40 text-gray-500 border border-gray-600/40',
};

const DATA_STATUS_STYLE: Record<StockReviewDataStatus, string> = {
  '정상': 'bg-emerald-500/15 text-emerald-300',
  '부분': 'bg-amber-500/15 text-amber-300',
  '없음': 'bg-red-500/15 text-red-300',
};

const StatusChip: React.FC<{ status: StockReviewConditionStatus }> = ({ status }) => (
  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded whitespace-nowrap ${STATUS_STYLE[status]}`}>
    {status}
  </span>
);

const ConditionRow: React.FC<{ c: StockReviewCondition }> = ({ c }) => (
  <li className="flex flex-col gap-1 py-2 border-b border-gray-700/60 last:border-b-0">
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-gray-200">{c.label}</span>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <StatusChip status={chipStatus(c.evaluation)} />
        {/* 축B 품질 캐비엇(앰버) — 평가는 유지하고 데이터 저하만 별도 표기 (충족을 숨기지 않음) */}
        {c.qualityNote && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300/90 border border-amber-500/30 whitespace-nowrap">
            {c.qualityNote}
          </span>
        )}
        {/* 축C 시장 상태(중립 회색) — 품질 아님, 정보만 */}
        {c.stateNote && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-600/20 text-gray-400 border border-gray-600/40 whitespace-nowrap">
            {c.stateNote}
          </span>
        )}
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-400">
      {(c.actualDisplay !== null || c.thresholdDisplay !== null) && (
        <span>
          실제 <span className="text-gray-200">{c.actualDisplay ?? '—'}</span>
          <span className="mx-1 text-gray-600">/</span>
          기준 <span className="text-gray-200">{c.thresholdDisplay ?? '—'}</span>
        </span>
      )}
      <span className="text-gray-500">{c.rationale}</span>
    </div>
  </li>
);

/** 충족 조건 수 요약 — "발화"가 아니라 "충족 조건 수"임을 명시. 품질 캐비엇 수는 별도 표기. */
const SummaryLine: React.FC<{ label: string; s: StockReviewSideSummary; tone: string }> = ({ label, s, tone }) => {
  const extras: string[] = [];
  if (s.qualityCaveats > 0) extras.push(`부분 데이터 ${s.qualityCaveats}`);
  if (s.dataMissing > 0) extras.push(`데이터 부족 ${s.dataMissing}`);
  if (s.notApplicable > 0) extras.push(`해당 없음 ${s.notApplicable}`);
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
      <span className={`font-semibold ${tone}`}>{label}</span>
      <span className="text-gray-200">{s.met}/{s.evaluated} 조건 충족</span>
      {extras.length > 0 && <span className="text-gray-500">({extras.join(' · ')})</span>}
    </div>
  );
};

const ReadyBody: React.FC<{ vm: StockReviewViewModel }> = ({ vm }) => (
  <div className="mt-2 rounded-lg bg-gray-800/60 border border-gray-700 p-3 sm:p-4 text-left">
    {/* 헤더: 제목 + 부제(성격 명시) + 검토일 + 데이터 상태 */}
    <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
      <h4 className="text-sm font-semibold text-gray-200">종목 검토 · {vm.name}</h4>
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-gray-500">검토일 {vm.asOfLabel}</span>
        <span className={`px-2 py-0.5 rounded font-semibold ${DATA_STATUS_STYLE[vm.dataStatus]}`}>
          데이터 {vm.dataStatus}
        </span>
      </div>
    </div>
    <p className="text-[11px] text-gray-500 mb-2">
      {STOCK_REVIEW_SUBTITLE}
      {vm.source === 'watchlist' && vm.holdingEvaluated && (
        <span className="ml-2 text-blue-300/80">
          · 보유 정보로 매도 조건 평가{vm.holdingNote ? ` (${vm.holdingNote})` : ''}
        </span>
      )}
    </p>
    {vm.dataStatusNote && (
      <p className="text-[11px] text-amber-300/80 mb-3">{vm.dataStatusNote}</p>
    )}

    {/* 상단 요약 (충족 조건 수) */}
    <div className="grid gap-1 mb-4 rounded-md bg-gray-900/50 px-3 py-2">
      <SummaryLine label="매수 지지" s={vm.summary.buy} tone="text-emerald-300/90" />
      <SummaryLine label="매도·리스크" s={vm.summary.sell} tone="text-red-300/90" />
    </div>

    {/* 지표 요약 */}
    <div className="mb-4">
      <div className="text-xs font-semibold text-gray-400 mb-2">기술 지표 요약</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {vm.indicators.map(ind => (
          <div key={ind.key} className="rounded-md bg-gray-900/50 px-2.5 py-1.5 min-w-0">
            <div className="text-[10px] text-gray-500 truncate" title={ind.label}>{ind.label}</div>
            <div className="text-sm text-gray-100 font-medium truncate">{ind.display}</div>
          </div>
        ))}
      </div>
    </div>

    {/* 매수 지지 조건 */}
    <div className="mb-4">
      <div className="text-xs font-semibold text-emerald-300/90 mb-1">매수 지지 조건 (관찰)</div>
      <ul className="overflow-x-auto">
        {vm.buyConditions.map(c => <ConditionRow key={c.key} c={c} />)}
      </ul>
    </div>

    {/* 매도/리스크 조건 */}
    <div className="mb-3">
      <div className="text-xs font-semibold text-red-300/90 mb-1">매도·리스크 조건 (관찰)</div>
      <ul className="overflow-x-auto">
        {vm.sellConditions.map(c => <ConditionRow key={c.key} c={c} />)}
      </ul>
    </div>

    {/* 면책 문구 (필수) */}
    <p className="text-[11px] text-gray-500 border-t border-gray-700 pt-2">{vm.disclaimer}</p>
  </div>
);

const StockReviewPanel: React.FC<StockReviewPanelProps> = ({ state }) => {
  if (state.kind === 'idle') return null;
  if (state.kind === 'loading') {
    return (
      <div className="mt-2 rounded-lg bg-gray-800/60 border border-gray-700 p-4 text-sm text-gray-400">
        분석 데이터 준비 중…
      </div>
    );
  }
  if (state.kind === 'unavailable') {
    return (
      <div className="mt-2 rounded-lg bg-gray-800/40 border border-gray-700 p-4 text-sm text-gray-500">
        이 종목은 기술 지표를 제공하지 않습니다 (현금/미지원/조회 실패).
      </div>
    );
  }
  return <ReadyBody vm={state.vm} />;
};

export default StockReviewPanel;
