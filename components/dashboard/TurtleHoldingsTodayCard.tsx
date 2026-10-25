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
import {
  TurtleHoldingsRow, shouldPromptDrawdownReferenceRefresh, describeReentryBaseline, REENTRY_BASELINE_CAPTION,
} from '../../utils/turtleHoldingsView';
import { resolveHoldingsSettings } from '../../utils/turtleHoldings';
import { formatKRW } from '../portfolio-table/utils';
import Badge from '../common/Badge';
import ManualHelpLink from '../common/ManualHelpLink';
import Button from '../common/Button';
import AssetTrendChart from '../AssetTrendChart';
import { buildTurtleHoldingsChartTarget } from '../../utils/turtleHoldingsDetail';
import type { TurtleHoldingsChartTarget } from '../../types/turtleHoldingsDetail';

interface Bucket {
  key: string;
  title: string;
  rows: TurtleHoldingsRow[];
  /** true면 별도 버튼으로 재매수 계산기를 연다(다시 살 때/추가 매수 칸만) */
  clickable: boolean;
  /**
   * 칸에 보여줄 문구 선택자 — 기본은 `reasonText`(판정 사유). "손절선 확인" 칸은 증권사 손절 예약주문
   * 점검 용도라 별도 문구(`stopCheckText`)를 쓴다(같은 문장이 두 칸에 중복 표시되는 것을 막는다,
   * Advisor 지적 2026-09-26). 같은 행 객체가 '추가 매수'·'손절선 확인' 두 칸에 동시에 나올 수 있으므로
   * 행을 복제하지 않고 칸별로 다른 텍스트를 뽑아 쓴다.
   */
  textFor?: (row: TurtleHoldingsRow) => string;
  /**
   * true면 각 줄 판정 사유 아래에 "현재 재진입 기준선" 한 줄을 붙이고 칸 제목 아래에 안내 문구를 한 번 보여 준다
   * ('팔 때' 칸 전용, 표시 전용 — 팔기 전에 다시 사려면 어디를 넘어야 하는지 보여 주기 위함).
   */
  showReentryBaseline?: boolean;
}

function rowIdentity(row: TurtleHoldingsRow): string {
  return `${row.kind}-${row.assetId ?? row.watchItemId ?? row.ticker}`;
}

interface RowLineProps {
  row: TurtleHoldingsRow;
  text: string;
  /** 판정 사유 아래에 덧붙일 보조 한 줄(재진입 기준선 등). 없으면 생략. */
  subText?: string | null;
  target: TurtleHoldingsChartTarget | null;
  expanded: boolean;
  onToggle: () => void;
  onReview: (target: TurtleHoldingsChartTarget) => void;
  onOpenBuy?: (row: TurtleHoldingsRow) => void;
  history: ReturnType<typeof usePortfolio>['data']['portfolioHistory'];
}

const RowLine: React.FC<RowLineProps> = ({ row, text, subText, target, expanded, onToggle, onReview, onOpenBuy, history }) => {
  const body = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-white text-sm">{row.name}</span>
        <span className="text-xs text-gray-500">{row.ticker}</span>
      </div>
      <p className="mt-1 text-xs text-gray-300 leading-relaxed">{text}</p>
      {subText && <p className="mt-1 text-xs text-gray-400 leading-relaxed">{subText}</p>}
    </>
  );
  return (
    <li className={`min-w-0 rounded-md border border-border-subtle bg-surface-elevated ${expanded ? 'col-span-full' : ''}`}>
      {target ? (
        <button
          type="button"
          onClick={onToggle}
          className={`focus-ring flex w-full flex-col items-start rounded-md px-3 py-2 text-left hover:bg-surface-muted transition-colors ${expanded ? '' : 'h-full'}`}
          aria-expanded={expanded}
          aria-label={`${row.name} 차트 ${expanded ? '접기' : '펼치기'}`}
        >
          {body}
          <span className="mt-auto inline-block pt-1 text-xs text-primary-light">차트 {expanded ? '접기' : '펼치기'} →</span>
        </button>
      ) : (
        <div className="h-full px-3 py-2">{body}</div>
      )}
      {onOpenBuy && (
        <div className="px-3 pb-2">
          <Button variant="secondary" onClick={() => onOpenBuy(row)}>재매수 계산기 열기 →</Button>
        </div>
      )}
      {expanded && target && (
        <div className="border-t border-border-subtle pb-2">
          <AssetTrendChart
            history={history}
            assetId={target.assetId}
            assetName={target.assetName}
            currentQuantity={target.currentQuantity}
            currentPrice={target.currentPrice}
            currency={target.currency}
            exchangeRate={target.exchangeRate}
            ticker={target.ticker}
            exchange={target.exchange}
            categoryId={target.categoryId}
            purchasePrice={target.purchasePrice}
          />
          <div className="px-3 pt-2">
            <Button variant="secondary" onClick={() => onReview(target)}>종목 검토</Button>
          </div>
        </div>
      )}
    </li>
  );
};

interface BucketSectionProps {
  bucket: Bucket;
  targetByRow: ReadonlyMap<string, TurtleHoldingsChartTarget | null>;
  expandedKey: string | null;
  onToggle: (key: string) => void;
  onReview: (target: TurtleHoldingsChartTarget) => void;
  onOpenBuy: (row: TurtleHoldingsRow) => void;
  history: ReturnType<typeof usePortfolio>['data']['portfolioHistory'];
}

const BucketSection: React.FC<BucketSectionProps> = ({ bucket, targetByRow, expandedKey, onToggle, onReview, onOpenBuy, history }) => (
  <div>
    <h4 className="text-xs font-semibold text-gray-300 mb-1.5">
      {bucket.title} <span className="text-gray-500">{bucket.rows.length}</span>
    </h4>
    {bucket.showReentryBaseline && bucket.rows.some(r => r.reentryBaseline) && (
      <p className="text-xs text-gray-500 mb-1.5">{REENTRY_BASELINE_CAPTION}</p>
    )}
    {bucket.rows.length === 0 ? (
      <p className="text-xs text-gray-500">해당 없음</p>
    ) : (
      <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2 lg:grid-cols-3">
        {bucket.rows.map(r => {
          const identity = rowIdentity(r);
          const instanceKey = `${bucket.key}:${identity}`;
          return (
          <RowLine
            key={instanceKey}
            row={r}
            target={targetByRow.get(identity) ?? null}
            expanded={expandedKey === instanceKey}
            onToggle={() => onToggle(instanceKey)}
            onReview={onReview}
            onOpenBuy={bucket.clickable ? onOpenBuy : undefined}
            text={bucket.textFor ? bucket.textFor(r) : r.reasonText}
            subText={bucket.showReentryBaseline ? describeReentryBaseline(r) : null}
            history={history}
          />
          );
        })}
      </ul>
    )}
  </div>
);

const TurtleHoldingsTodayCard: React.FC = () => {
  const model = useTurtleHoldings();
  const { data, actions } = usePortfolio();
  const [showAll, setShowAll] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
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
      { key: 'sell', title: '팔 때', rows: sell, clickable: false, showReentryBaseline: true },
      { key: 'reentry', title: '다시 살 때', rows: reentry, clickable: true },
      { key: 'pyramid', title: '추가 매수', rows: pyramid, clickable: true },
      // 증권사 손절 예약주문 점검 용도 — '팔 때'·'추가 매수' 칸의 판정 사유 문구와 겹치지 않도록
      // stopCheckText(없으면 reasonText로 안전하게 대체)를 쓴다.
      { key: 'stopCheck', title: '손절선 확인', rows: stopCheck, clickable: false, textFor: r => r.stopCheckText ?? r.reasonText },
    ];
  }, [model.rows]);

  const totalActionable = model.summary.sellCount + model.summary.reentryCount + model.summary.pyramidCount;
  const unavailableCount = model.rows.filter(r => r.status === 'unavailable').length;
  const targetByRow = useMemo(() => {
    const targets = new Map<string, TurtleHoldingsChartTarget | null>();
    for (const row of model.rows) {
      targets.set(rowIdentity(row), buildTurtleHoldingsChartTarget(row, data.assets, data.watchlist, data.exchangeRates));
    }
    return targets;
  }, [data.assets, data.exchangeRates, data.watchlist, model.rows]);

  const handleReview = (target: TurtleHoldingsChartTarget) => {
    if (target.reviewTarget.source === 'portfolio') {
      actions.focusPortfolioAsset(target.reviewTarget.id, 'review');
    } else {
      actions.focusWatchItem(target.reviewTarget.id, 'review');
    }
  };

  return (
    <div className="rounded-card border border-primary/40 bg-primary/5 p-4 sm:p-5" aria-label="터틀 오늘 할 일">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm sm:text-base font-semibold text-white">터틀 오늘 할 일</h3>
          <ManualHelpLink anchor="today" />
        </div>
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
        {buckets.map(b => (
          <BucketSection
            key={b.key}
            bucket={b}
            targetByRow={targetByRow}
            expandedKey={expandedKey}
            onToggle={(key) => setExpandedKey(current => current === key ? null : key)}
            onReview={handleReview}
            onOpenBuy={actions.openTurtleHoldingsBuy}
            history={data.portfolioHistory}
          />
        ))}
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
            <ul className="mt-2 grid grid-cols-1 gap-1.5 md:grid-cols-2 lg:grid-cols-3">
              {model.rows.filter(r => r.status === 'unavailable').map(r => (
                <RowLine
                  key={`na-${rowIdentity(r)}`}
                  row={r}
                  text={r.reasonText}
                  target={targetByRow.get(rowIdentity(r)) ?? null}
                  expanded={expandedKey === `unavailable:${rowIdentity(r)}`}
                  onToggle={() => setExpandedKey(current => current === `unavailable:${rowIdentity(r)}` ? null : `unavailable:${rowIdentity(r)}`)}
                  onReview={handleReview}
                  history={data.portfolioHistory}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default TurtleHoldingsTodayCard;
