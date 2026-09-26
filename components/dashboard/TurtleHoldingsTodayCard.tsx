// components/dashboard/TurtleHoldingsTodayCard.tsx
// ---------------------------------------------------------------------------
// "터틀 오늘 할 일" — 홈 맨 위 카드 (계획서 PLAN_터틀중심_앱재정비_260925 §4.1, 2026-09-26 승인 P2).
//
// 네 칸: 팔 때 · 다시 살 때 · 추가 매수 · 손절선 확인. 각 줄에 "왜" 한 줄 + 대기 자금 + 계좌 축소 배지.
// 0건이면 "오늘 할 일 없음 — 규칙상 보유 유지"(빈 화면 금지). 렌더 전용 — 계산은 utils/turtleHoldingsView,
// 데이터는 hooks/useTurtleHoldings(자체 호출, 저장 없음 — 읽기 전용 보장).

import React, { useMemo, useState } from 'react';
import { useTurtleHoldings } from '../../hooks/useTurtleHoldings';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { TurtleHoldingsRow, shouldPromptDrawdownReferenceRefresh } from '../../utils/turtleHoldingsView';
import { resolveHoldingsSettings } from '../../utils/turtleHoldings';
import { formatKRW } from '../portfolio-table/utils';
import Badge from '../common/Badge';

interface Bucket {
  key: string;
  title: string;
  rows: TurtleHoldingsRow[];
  /** true면 행을 눌러 재매수 계산기를 연다(다시 살 때/추가 매수 칸만) */
  clickable: boolean;
  /**
   * 칸에 보여줄 문구 선택자 — 기본은 `reasonText`(판정 사유). "손절선 확인" 칸은 증권사 손절 예약주문
   * 점검 용도라 별도 문구(`stopCheckText`)를 쓴다(같은 문장이 두 칸에 중복 표시되는 것을 막는다,
   * Advisor 지적 2026-09-26). 같은 행 객체가 '추가 매수'·'손절선 확인' 두 칸에 동시에 나올 수 있으므로
   * 행을 복제하지 않고 칸별로 다른 텍스트를 뽑아 쓴다.
   */
  textFor?: (row: TurtleHoldingsRow) => string;
}

const RowLine: React.FC<{ row: TurtleHoldingsRow; onOpenBuy?: (row: TurtleHoldingsRow) => void; text: string }> = ({ row, onOpenBuy, text }) => {
  const body = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-white text-sm">{row.name}</span>
        <span className="text-xs text-gray-500">{row.ticker}</span>
      </div>
      <p className="mt-1 text-xs text-gray-300 leading-relaxed">{text}</p>
    </>
  );
  if (!onOpenBuy) {
    return <li className="rounded-md border border-border-subtle bg-surface-elevated px-3 py-2">{body}</li>;
  }
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpenBuy(row)}
        className="w-full text-left rounded-md border border-border-subtle bg-surface-elevated px-3 py-2 hover:border-primary/60 hover:bg-surface-muted transition-colors"
      >
        {body}
        <span className="mt-1 inline-block text-xs text-primary-light">재매수 계산기 열기 →</span>
      </button>
    </li>
  );
};

const BucketSection: React.FC<{ bucket: Bucket; onOpenBuy: (row: TurtleHoldingsRow) => void }> = ({ bucket, onOpenBuy }) => (
  <div>
    <h4 className="text-xs font-semibold text-gray-300 mb-1.5">
      {bucket.title} <span className="text-gray-500">{bucket.rows.length}</span>
    </h4>
    {bucket.rows.length === 0 ? (
      <p className="text-xs text-gray-500">해당 없음</p>
    ) : (
      <ul className="space-y-1.5">
        {bucket.rows.map(r => (
          <RowLine
            key={`${r.kind}-${r.assetId ?? r.watchItemId ?? r.ticker}`}
            row={r}
            onOpenBuy={bucket.clickable ? onOpenBuy : undefined}
            text={bucket.textFor ? bucket.textFor(r) : r.reasonText}
          />
        ))}
      </ul>
    )}
  </div>
);

const TurtleHoldingsTodayCard: React.FC = () => {
  const model = useTurtleHoldings();
  const { data, actions } = usePortfolio();
  const [showAll, setShowAll] = useState(false);
  // P3(2026-09-26, §4.7): 계좌 축소 기준 자산을 새로 정할 시점 안내(표시 전용 — 자동 저장 없음).
  // 지금 당장 감쇄가 적용 중인지와 무관하게, 계좌 축소를 쓰는 한 기준이 오래됐으면 안내한다.
  const holdingsSettings = resolveHoldingsSettings(data.turtleSettings.holdings);
  const refreshReferencePrompt = holdingsSettings.drawdownScalingEnabled
    && shouldPromptDrawdownReferenceRefresh(holdingsSettings.drawdownReferenceSetAt, new Date());

  const buckets = useMemo<Bucket[]>(() => {
    const sell = model.rows.filter(r => r.status === 'sell');
    const reentry = model.rows.filter(r => r.status === 'reentry');
    const pyramid = model.rows.filter(r => r.status === 'pyramid');
    const stopCheck = model.rows.filter(r => r.kind === 'reentry-position' && (r.status === 'hold' || r.status === 'pyramid'));
    return [
      { key: 'sell', title: '팔 때', rows: sell, clickable: false },
      { key: 'reentry', title: '다시 살 때', rows: reentry, clickable: true },
      { key: 'pyramid', title: '추가 매수', rows: pyramid, clickable: true },
      // 증권사 손절 예약주문 점검 용도 — '팔 때'·'추가 매수' 칸의 판정 사유 문구와 겹치지 않도록
      // stopCheckText(없으면 reasonText로 안전하게 대체)를 쓴다.
      { key: 'stopCheck', title: '손절선 확인', rows: stopCheck, clickable: false, textFor: r => r.stopCheckText ?? r.reasonText },
    ];
  }, [model.rows]);

  const totalActionable = model.summary.sellCount + model.summary.reentryCount + model.summary.pyramidCount;
  const unavailableCount = model.rows.filter(r => r.status === 'unavailable').length;

  return (
    <div className="rounded-card border border-primary/40 bg-primary/5 p-4 sm:p-5" aria-label="터틀 오늘 할 일">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm sm:text-base font-semibold text-white">터틀 오늘 할 일</h3>
        <div className="flex items-center gap-2">
          {model.drawdownApplied && <Badge tone="warning">계좌 축소 적용 중</Badge>}
          <span className="text-xs text-gray-400">대기 자금 {formatKRW(model.parkedCashKRW)}</span>
        </div>
      </div>

      {refreshReferencePrompt && (
        <p className="mt-2 text-xs text-warning">기준 자산을 새로 정하세요 — 1월이거나 정한 지 1년이 넘었습니다(설정 → 터틀 규칙).</p>
      )}

      {model.isLoading && <p className="mt-3 text-xs text-gray-500">시세를 불러오는 중입니다…</p>}
      {model.partialFailure && !model.isLoading && (
        <p className="mt-2 text-xs text-warning">일부 종목의 시세를 불러오지 못했습니다. 해당 종목은 &laquo;확인 불가&raquo;로 표시됩니다.</p>
      )}

      {!model.isLoading && totalActionable === 0 && (
        <p className="mt-3 text-sm text-gray-300">오늘 할 일 없음 — 규칙상 보유 유지</p>
      )}

      <div className="mt-3 space-y-3">
        {buckets.map(b => <BucketSection key={b.key} bucket={b} onOpenBuy={actions.openTurtleHoldingsBuy} />)}
      </div>

      {unavailableCount > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowAll(v => !v)}
            className="text-xs text-gray-400 hover:text-gray-200 underline"
            aria-expanded={showAll}
          >
            확인 필요 {unavailableCount}종목 {showAll ? '접기' : '펼치기'}
          </button>
          {showAll && (
            <ul className="mt-2 space-y-1.5">
              {model.rows.filter(r => r.status === 'unavailable').map(r => (
                <RowLine key={`na-${r.kind}-${r.assetId ?? r.watchItemId ?? r.ticker}`} row={r} text={r.reasonText} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default TurtleHoldingsTodayCard;
