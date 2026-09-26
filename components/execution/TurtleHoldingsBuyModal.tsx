// components/execution/TurtleHoldingsBuyModal.tsx
// ---------------------------------------------------------------------------
// "보유종목 터틀" 재매수 계산기 모달 (계획서 PLAN_터틀중심_앱재정비_260925 §4.3, 2026-09-26 승인 P2).
//
// 대상 행(TurtleHoldingsRow) = kind='watch'(신규/재진입) 또는 kind='reentry-position'(불타기).
// 폼 기본값 = 계산된 값(수량·체결가). 체결가를 바꾸면 손절가·다음 불타기가는 **같은 N으로 재계산**해
// 보여준다(라이브 재조회 없음 — 계산 근거는 모달을 연 시점의 N에 고정, TurtleExecuteModal과 동일 관례).
// [샀음 기록] → actions.recordTurtleBuy. 성공하면 닫힘, 실패하면 사유 표시 + pending 유지(커밋 없음).

import React, { useMemo, useState } from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import {
  resolveHoldingsSettings, computeCommonStopPrice, computePyramidTriggerPrice,
  describeStopExplanation, formatMoney,
} from '../../utils/turtleHoldings';
import { resolvePositionFxRate } from '../../utils/turtleHoldingsView';
import { VOLATILITY_LABELS } from '../../types/turtleHoldings';
import Modal from '../common/Modal';
import Button from '../common/Button';
import { CircleAlert } from 'lucide-react';

const todayISO = (): string => new Date().toISOString().slice(0, 10);
// 원통화 표기(KRW 정수+원, USD $소수2 — utils/turtleHoldings.formatMoney 재사용). currency 없으면 '—'.
const fmt = (n: number | null | undefined, currency?: string): string =>
  typeof n === 'number' && Number.isFinite(n) ? formatMoney(n, currency) : '—';

const SKIP_REASON_LABEL: Record<string, string> = {
  'below-min-order': '매수 금액이 최소 주문 금액 미만입니다.',
  'max-units-reached': '이 종목의 유닛 한도(불타기 횟수)에 도달했습니다.',
  'no-n': '변동성(N)을 계산할 자료가 부족합니다.',
  'no-fx': '환율 정보가 없어 계산을 보류합니다.',
  'no-cash': '배정 가능한 관리자산이 없습니다.',
};

const BUY_REASON_LABEL: Record<string, string> = {
  'asset-not-found': '자산 정보를 찾을 수 없습니다.',
  'position-missing': '연결된 포지션을 찾을 수 없습니다. 이미 종료됐을 수 있습니다.',
  'invalid-fill': '체결가·수량을 확인해 주세요(0보다 커야 합니다).',
  'invalid-n': '변동성(N) 값을 확인할 수 없어 손절가를 계산할 수 없습니다.',
  'max-units-reached': '유닛 한도에 도달해 더 매수할 수 없습니다.',
};

const TurtleHoldingsBuyModal: React.FC = () => {
  const { modal, data, actions } = usePortfolio();
  const row = modal.turtleHoldingsBuyTarget;
  const onClose = actions.closeTurtleHoldingsBuy;
  const settings = resolveHoldingsSettings(data.turtleSettings.holdings);

  const [fillDate, setFillDate] = useState<string>(todayISO());
  const [fillPrice, setFillPrice] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 대상이 바뀔 때 폼을 리셋 — 렌더 중 비교 후 setState(React 공식 패턴: "prop이 바뀔 때 state 조정",
  // effect가 아니라 렌더 바디에서 처리해 effect 안 setState 캐스케이드를 피한다).
  const rowKey = row ? `${row.kind}:${row.assetId ?? row.watchItemId ?? row.ticker}` : null;
  const [resetKey, setResetKey] = useState<string | null>(null);
  if (rowKey !== resetKey) {
    setResetKey(rowKey);
    setFillDate(todayISO());
    setFillPrice(String(row?.lastClose ?? ''));
    setQuantity(String(row?.rebuy?.qty ?? ''));
    setIsSubmitting(false);
    setError(null);
  }

  const watchItem = useMemo(
    () => (row?.kind === 'watch' ? data.watchlist.find(w => w.id === row.watchItemId) : undefined),
    [row, data.watchlist],
  );
  const position = useMemo(
    () => (row?.kind === 'reentry-position' ? data.turtlePositions.find(p => p.id === row.positionId) : undefined),
    [row, data.turtlePositions],
  );

  if (!row) return null;

  const priceNum = parseFloat(fillPrice);
  const qtyNum = parseFloat(quantity);
  const inputValid = !!fillDate && priceNum > 0 && qtyNum > 0;
  const canBuild = row.kind === 'watch' ? !!watchItem : !!position;
  const canSubmit = inputValid && canBuild && !isSubmitting;

  // 손절가·다음 불타기가 — 편집된 체결가 기준, 같은 N(모달을 연 시점 값)으로 재계산.
  const n = row.n;
  const projectedStop = n != null && priceNum > 0 ? computeCommonStopPrice(priceNum, n, settings) : null;
  const projectedNextTrigger = n != null && priceNum > 0 && settings.maxUnitsPerPosition > 1
    ? computePyramidTriggerPrice(priceNum, n, settings) : null;
  // "왜 이 손절가인지" 설명 — 계획서 §4.3, 체결가를 바꾸면 같이 갱신된다(같은 N 고정).
  const stopExplanation = n != null && priceNum > 0 && projectedStop != null
    ? describeStopExplanation({ priceLocal: priceNum, n, stopMultipleN: settings.stopMultipleN, stopPrice: projectedStop, currency: row.currency })
    : null;
  const estimatedLocalTotal = priceNum > 0 && qtyNum > 0 ? priceNum * qtyNum : 0;
  // 예상 매수금액은 KRW로 표기(외화 종목도 통일) — 환율 미확보면 값을 지어내지 않고 안내만 한다.
  const displayFxRate = resolvePositionFxRate(row.currency, data.exchangeRates);
  const estimatedTotalKRW = estimatedLocalTotal > 0 && displayFxRate != null ? estimatedLocalTotal * displayFxRate : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);

    if (row.kind === 'watch') {
      if (!watchItem) { setIsSubmitting(false); return; }
      const fxRate = resolvePositionFxRate(watchItem.currency ?? row.currency, data.exchangeRates) ?? undefined;
      const res = await actions.recordTurtleBuy({
        mode: 'reentry',
        ticker: watchItem.ticker, exchange: watchItem.exchange, name: watchItem.name,
        categoryId: watchItem.categoryId, currency: watchItem.currency ?? row.currency,
        fillDate, fillPrice: priceNum, quantity: qtyNum, nAtFill: n ?? 0, fxRate,
        donchianHigh: row.reentryLine ?? priceNum,
      });
      if (res.ok) onClose();
      else { setError(BUY_REASON_LABEL[res.reason ?? ''] ?? '기록에 실패했습니다. 다시 시도해 주세요.'); setIsSubmitting(false); }
      return;
    }

    if (!position || !row.assetId) { setIsSubmitting(false); return; }
    const fxRate = resolvePositionFxRate(row.currency, data.exchangeRates) ?? undefined;
    const res = await actions.recordTurtleBuy({
      mode: 'pyramid', assetId: row.assetId, positionId: position.id,
      fillDate, fillPrice: priceNum, quantity: qtyNum, nAtFill: n ?? 0, fxRate,
    });
    if (res.ok) onClose();
    else { setError(BUY_REASON_LABEL[res.reason ?? ''] ?? '기록에 실패했습니다. 다시 시도해 주세요.'); setIsSubmitting(false); }
  };

  const title = row.kind === 'watch' ? '재매수 — 다시 살 때' : '재매수 — 추가 매수(불타기)';
  const volatilityLabel = row.volatilityLabel ? VOLATILITY_LABELS[row.volatilityLabel] : '—';

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={<><span className="text-gray-200 font-medium">{row.name}</span><span className="text-gray-500 ml-2">{row.ticker}</span></>}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>취소</Button>
          <Button type="submit" form="turtle-holdings-buy-form" variant="primary" disabled={!canSubmit} loading={isSubmitting}>
            {isSubmitting ? '기록 중...' : '샀음 기록'}
          </Button>
        </>
      }
    >
      {/* 계산 근거 */}
      <div className="bg-gray-700/60 rounded-md p-3.5 mb-4">
        <p className="text-sm text-gray-200">{row.reasonText}</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-400">N (20일 ATR)</span>
            <span className="text-gray-100 font-medium">{fmt(n, row.currency)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-400">변동성</span>
            <span className="text-gray-100 font-medium">{volatilityLabel}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-400">손절 예약가(증권사)</span>
            <span className="text-gray-100 font-medium">{fmt(projectedStop, row.currency)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-gray-400">다음 불타기가</span>
            <span className="text-gray-100 font-medium">{fmt(projectedNextTrigger, row.currency)}</span>
          </div>
        </div>
        {stopExplanation && <p className="mt-2.5 text-xs text-gray-400">{stopExplanation}</p>}
        {row.rebuy?.skipReason && (
          <p className="mt-2 text-xs text-warning">{SKIP_REASON_LABEL[row.rebuy.skipReason] ?? row.rebuy.skipReason}</p>
        )}
      </div>

      {!canBuild && (
        <div className="mb-4 flex items-start gap-1.5 text-sm text-danger bg-danger-soft border border-danger/30 rounded-md px-3 py-2" role="alert">
          <CircleAlert className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          {row.kind === 'watch' ? '관심종목 정보를 찾을 수 없습니다.' : '연결된 포지션을 찾을 수 없습니다(이미 종료됐을 수 있습니다).'}
        </div>
      )}

      <form id="turtle-holdings-buy-form" onSubmit={handleSubmit} className="space-y-3.5">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">체결일</label>
          <input
            type="date" value={fillDate} max={todayISO()} onChange={e => setFillDate(e.target.value)}
            disabled={isSubmitting}
            className="w-full text-sm bg-gray-900 border border-gray-600 rounded-md px-2.5 py-2 text-gray-100 focus:outline-none focus:border-primary disabled:opacity-50"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">체결가</label>
            <input
              type="number" step="any" min="0" value={fillPrice} onChange={e => setFillPrice(e.target.value)}
              disabled={isSubmitting}
              className="w-full text-sm bg-gray-900 border border-gray-600 rounded-md px-2.5 py-2 text-gray-100 focus:outline-none focus:border-primary disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">수량</label>
            <input
              type="number" step="any" min="0" value={quantity} onChange={e => setQuantity(e.target.value)}
              disabled={isSubmitting}
              className="w-full text-sm bg-gray-900 border border-gray-600 rounded-md px-2.5 py-2 text-gray-100 focus:outline-none focus:border-primary disabled:opacity-50"
            />
          </div>
        </div>

        {estimatedLocalTotal > 0 && (
          <div className="bg-gray-900 p-3 rounded-md flex justify-between items-center">
            <span className="text-xs text-gray-400">예상 매수금액</span>
            <span className="text-base font-bold text-white">
              {estimatedTotalKRW != null ? formatMoney(estimatedTotalKRW, 'KRW') : '환율 정보 없음'}
            </span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-1.5 text-sm text-danger bg-danger-soft border border-danger/30 rounded-md px-3 py-2" role="alert">
            <CircleAlert className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />{error}
          </div>
        )}
      </form>
    </Modal>
  );
};

export default TurtleHoldingsBuyModal;
