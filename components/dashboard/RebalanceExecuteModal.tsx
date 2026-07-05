// components/dashboard/RebalanceExecuteModal.tsx
// ---------------------------------------------------------------------------
// 리밸런싱 실행 전용 모달 (Phase 4c-2, 렌더 전용).
//
// 도메인 분리: 터틀(포지션)·대청소(청산)와 별개 — 코어 카테고리 목표 조정 매수/매도.
//   · `executeRebalanceAction`은 ExecutionView에서 prop 주입(useActionQueue 1회 인스턴스화).
//   · 3모드: SELL(부분매도)·BUY 추가(보유)·BUY 신규(미보유). 수량 편집 가능(리밸런싱=목표 조정분).
//   · **미보유 BUY의 통화는 저장본 값만 표시**(없으면 "실행 시 통화 확인 필요") — **최종 resolve/차단은 submit 시
//     executeRebalanceAction(4c-1 코어)이 판단**. UI가 미리 똑똑하게 굴지 않는다(Codex).
//   · submit → executeRebalanceAction. ok면 닫기, ok:false면 reason 표시 + pending 유지. 취소=닫기만.
//   · 기존 TurtleExecuteModal/CleanupExecuteModal 무접촉.

import React, { useEffect, useMemo, useState } from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { ActionItem } from '../../types/actionQueue';
import { Currency } from '../../types';
import { TurtleFill } from '../../utils/turtleExecution';
import { formatOriginalCurrency } from '../portfolio-table/utils';

interface Props {
  executeRebalanceAction: (action: ActionItem, fill: TurtleFill) => Promise<{ ok: boolean; reason?: string }>;
}

const todayISO = (): string => new Date().toISOString().slice(0, 10);

const REASON_LABEL: Record<string, string> = {
  'asset-missing': '대상 자산을 찾을 수 없거나 보유수량이 0입니다.',
  'over-sell': '매도 수량이 보유수량을 초과합니다.',
  'no-currency': '대표 종목의 통화를 확인할 수 없습니다 — 리밸런싱 표의 종목 지정에서 통화를 확정하세요.',
  'instrument-missing': '대표 매수 종목 정보를 찾을 수 없습니다 — 리밸런싱 표에서 먼저 지정하세요.',
  'invalid-price': '체결가를 입력하세요.',
  'invalid-qty': '수량을 입력하세요.',
  'unsupported-kind': '이 모달에서 실행할 수 없는 주문입니다.',
  'fetch-failed': '종목 정보를 가져오지 못했습니다 — 티커·거래소를 확인하세요.',
  'not-signed-in': '로그인 후 실행할 수 있습니다.',
  exception: '실행 중 오류가 발생했습니다. 다시 시도해 주세요.',
};

const RebalanceExecuteModal: React.FC<Props> = ({ executeRebalanceAction }) => {
  const { modal, data, actions } = usePortfolio();
  const action = modal.rebalanceExecAction;
  const onClose = actions.closeRebalanceExecution;

  const [fillDate, setFillDate] = useState<string>(todayISO());
  const [fillPrice, setFillPrice] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!action) return;
    setFillDate(todayISO());
    setFillPrice(String(action.refPrice ?? ''));
    setQuantity(String(action.quantity ?? ''));
    setIsSubmitting(false);
    setError(null);
  }, [action?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const resolution = useMemo(() => {
    if (!action) return null;
    const isSell = action.kind === 'REBALANCE_SELL';
    const held = action.assetId ? data.assets.find(a => a.id === action.assetId) : undefined;
    const categoryId = action.ruleSnapshot.categoryId;
    const inst = (!action.assetId && !isSell && typeof categoryId === 'number')
      ? data.allocationTargets.categoryInstruments?.[String(categoryId)]
      : undefined;

    if (isSell) {
      if (!held || !(held.quantity > 0)) return { blocked: true, blockReason: '매도 대상 자산을 찾을 수 없거나 보유수량이 0입니다.', mode: 'sell' as const };
      return {
        blocked: false, blockReason: null, mode: 'sell' as const,
        title: '리밸런싱 매도 (부분)', name: held.customName?.trim() || held.name, ticker: held.ticker,
        currencyLabel: held.currency as string, currentPrice: held.currentPrice, maxQty: held.quantity,
      };
    }
    if (action.assetId) {
      if (!held) return { blocked: true, blockReason: '추가매수 대상 자산을 찾을 수 없습니다.', mode: 'buy-add' as const };
      return {
        blocked: false, blockReason: null, mode: 'buy-add' as const,
        title: '리밸런싱 매수 (추가)', name: held.customName?.trim() || held.name, ticker: held.ticker,
        currencyLabel: held.currency as string, currentPrice: held.currentPrice, maxQty: undefined,
      };
    }
    // 미보유 신규 — 저장본 매핑 표시(통화는 있으면 표시, 없으면 안내). 최종 판단은 submit(코어).
    if (!inst || !inst.exchange) return { blocked: true, blockReason: '대표 매수 종목이 지정되지 않았습니다 — 리밸런싱 표에서 지정하세요.', mode: 'buy-new' as const };
    return {
      blocked: false, blockReason: null, mode: 'buy-new' as const,
      title: '리밸런싱 매수 (신규)', name: inst.name ?? inst.ticker, ticker: inst.ticker,
      exchangeLabel: inst.exchange, currencyLabel: (inst.currency as string) ?? null, currentPrice: undefined, maxQty: undefined,
    };
  }, [action, data.assets, data.allocationTargets]);

  if (!action || !resolution) return null;

  const priceNum = parseFloat(fillPrice);
  const qtyNum = parseFloat(quantity);
  const overSell = resolution.mode === 'sell' && resolution.maxQty != null && qtyNum > resolution.maxQty;
  const canSubmit = !resolution.blocked && !!fillDate && priceNum > 0 && qtyNum > 0 && !overSell && !isSubmitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);
    const res = await executeRebalanceAction(action, { fillDate, fillPrice: priceNum, quantity: qtyNum });
    if (res.ok) {
      onClose();
    } else {
      setError(REASON_LABEL[res.reason ?? ''] ?? `실행에 실패했습니다${res.reason ? ` (${res.reason})` : ''}. 다시 시도해 주세요.`);
      setIsSubmitting(false);
    }
  };

  const ccy = resolution.currencyLabel;
  const isSell = resolution.mode === 'sell';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="bg-gray-800 p-4 sm:p-6 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-white truncate">{resolution.title}</h2>
            <p className="text-sm text-gray-400 mt-0.5">
              <span className="text-gray-200 font-medium">{resolution.name}</span>
              <span className="text-gray-500 ml-2">{resolution.ticker}</span>
              {resolution.mode === 'buy-new' && 'exchangeLabel' in resolution && <span className="text-gray-500 ml-1">· {resolution.exchangeLabel}</span>}
            </p>
          </div>
          <button type="button" onClick={onClose} className="flex-shrink-0 text-gray-400 hover:text-white text-xl leading-none px-1" aria-label="닫기">×</button>
        </div>

        <div className="bg-gray-700/60 rounded-md p-3.5 mb-4 text-xs">
          <p className="text-gray-200">{action.reasonText}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-2.5">
            {resolution.currentPrice != null && ccy && (
              <div className="flex justify-between"><span className="text-gray-400">현재가</span><span className="text-gray-100">{formatOriginalCurrency(resolution.currentPrice, ccy as Currency)}</span></div>
            )}
            {resolution.maxQty != null && (
              <div className="flex justify-between"><span className="text-gray-400">보유수량</span><span className="text-gray-100">{resolution.maxQty}</span></div>
            )}
            <div className="flex justify-between"><span className="text-gray-400">통화</span><span className="text-gray-100">{ccy ?? '실행 시 통화 확인 필요'}</span></div>
          </div>
        </div>

        {resolution.blocked && (
          <div className="mb-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">{resolution.blockReason}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">체결일</label>
            <input type="date" value={fillDate} max={todayISO()} onChange={e => setFillDate(e.target.value)} disabled={isSubmitting || resolution.blocked}
              className="w-full text-sm bg-gray-900 border border-gray-600 rounded-md px-2.5 py-2 text-gray-100 focus:outline-none focus:border-primary disabled:opacity-50" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">체결가{ccy ? ` (${ccy})` : ''}</label>
              <input type="number" step="any" min="0" value={fillPrice} onChange={e => setFillPrice(e.target.value)} disabled={isSubmitting || resolution.blocked}
                className="w-full text-sm bg-gray-900 border border-gray-600 rounded-md px-2.5 py-2 text-gray-100 focus:outline-none focus:border-primary disabled:opacity-50" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">수량{resolution.maxQty != null ? ` (최대 ${resolution.maxQty})` : ''}</label>
              <input type="number" step="any" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} disabled={isSubmitting || resolution.blocked}
                className="w-full text-sm bg-gray-900 border border-gray-600 rounded-md px-2.5 py-2 text-gray-100 focus:outline-none focus:border-primary disabled:opacity-50" />
            </div>
          </div>
          {overSell && <p className="text-[11px] text-red-300">매도 수량이 보유수량({resolution.maxQty})을 초과했습니다.</p>}

          {error && <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">{error}</div>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={isSubmitting} className="text-sm text-gray-300 hover:text-white px-4 py-2 rounded-md transition-colors disabled:opacity-50">취소</button>
            <button type="submit" disabled={!canSubmit} className={`text-sm font-medium text-white px-4 py-2 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isSell ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-700'}`}>
              {isSubmitting ? '실행 중...' : isSell ? '매도 실행' : '매수 실행'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RebalanceExecuteModal;
