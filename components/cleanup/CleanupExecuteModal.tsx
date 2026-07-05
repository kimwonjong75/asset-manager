// components/cleanup/CleanupExecuteModal.tsx
// ---------------------------------------------------------------------------
// 대청소 청산 실행 전용 모달 (Phase 3d-2, 렌더 전용).
//
// 도메인 분리: 터틀 실행(포지션/N/손절)과 별개 — 보유자산 전량 청산.
//   · `executeCleanupAction`은 ExecutionView에서 prop 주입(useActionQueue 1회 인스턴스화).
//   · 수량 = **전량 읽기전용**(실행 시점 asset.quantity, 코어가 사용). 체결가 = currentPrice 프리필+수정 가능.
//   · submit → executeCleanupAction. ok면 닫기, ok:false면 reason 표시 + pending 유지. 취소=닫기만.
//   · 성공 후 자동 refresh 없음. 저장(sellHistory+asset+queue 단일 커밋)·linkedSellRecordId는 코어(3d-1) 담당.
//   · 기존 TurtleExecuteModal 무접촉.

import React, { useEffect, useState } from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { ActionItem } from '../../types/actionQueue';
import { TurtleFill } from '../../utils/turtleExecution';
import { formatKRW, formatOriginalCurrency } from '../portfolio-table/utils';

interface Props {
  executeCleanupAction: (action: ActionItem, fill: TurtleFill) => Promise<{ ok: boolean; reason?: string }>;
}

const todayISO = (): string => new Date().toISOString().slice(0, 10);

const REASON_LABEL: Record<string, string> = {
  'asset-missing': '대상 자산을 찾을 수 없거나 보유수량이 0입니다.',
  'invalid-price': '체결가를 입력하세요.',
  'unsupported-kind': '이 모달에서 실행할 수 없는 주문입니다.',
  exception: '실행 중 오류가 발생했습니다. 다시 시도해 주세요.',
};

const CleanupExecuteModal: React.FC<Props> = ({ executeCleanupAction }) => {
  const { modal, data, derived, actions } = usePortfolio();
  const action = modal.cleanupExecAction;
  const onClose = actions.closeCleanupExecution;

  const asset = action?.assetId ? data.assets.find(a => a.id === action.assetId) : undefined;
  const metrics = asset ? derived.enrichedAssets.find(a => a.id === asset.id)?.metrics : undefined;

  const [fillDate, setFillDate] = useState<string>(todayISO());
  const [fillPrice, setFillPrice] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 주문 변경 시 프리필 (원본 action 읽기만). 체결가=현재가(원통화), 0이면 빈칸(입력 요구).
  useEffect(() => {
    if (!action) return;
    setFillDate(todayISO());
    setFillPrice(asset && asset.currentPrice > 0 ? String(asset.currentPrice) : '');
    setIsSubmitting(false);
    setError(null);
  }, [action?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!action) return null;

  const blocked = !asset || !(asset.quantity > 0);
  const priceNum = parseFloat(fillPrice);
  const canSubmit = !blocked && !!fillDate && priceNum > 0 && !isSubmitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !asset) return; // 중복 클릭·미충족·차단 방지
    setIsSubmitting(true);
    setError(null);
    // 수량은 전량(코어가 실행 시점 asset.quantity를 사용) — 표시/전달값 일치
    const res = await executeCleanupAction(action, { fillDate, fillPrice: priceNum, quantity: asset.quantity });
    if (res.ok) {
      onClose();
    } else {
      setError(REASON_LABEL[res.reason ?? ''] ?? `실행에 실패했습니다${res.reason ? ` (${res.reason})` : ''}. 다시 시도해 주세요.`);
      setIsSubmitting(false);
    }
  };

  const ccy = asset?.currency;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-gray-800 p-4 sm:p-6 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-white truncate">대청소 청산 (전량 매도)</h2>
            <p className="text-sm text-gray-400 mt-0.5">
              <span className="text-gray-200 font-medium">{action.name}</span>
              <span className="text-gray-500 ml-2">{action.ticker}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} className="flex-shrink-0 text-gray-400 hover:text-white text-xl leading-none px-1" aria-label="닫기">×</button>
        </div>

        {/* 보유 정보 */}
        {asset && (
          <div className="bg-gray-700/60 rounded-md p-3.5 mb-4 text-xs">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <Row label="보유수량" value={`${asset.quantity}`} />
              <Row label="현재가" value={ccy ? formatOriginalCurrency(asset.currentPrice, ccy) : '—'} />
              {metrics && <Row label="평가금액" value={formatKRW(metrics.currentValueKRW)} />}
              {metrics && <Row label="평가손익" value={`${metrics.profitLossKRW >= 0 ? '+' : ''}${formatKRW(metrics.profitLossKRW)}`} tone={metrics.profitLossKRW < 0 ? 'text-red-300' : 'text-emerald-300'} />}
              {metrics && <Row label="수익률" value={`${metrics.returnPercentage >= 0 ? '+' : ''}${metrics.returnPercentage.toFixed(1)}%`} tone={metrics.returnPercentage < 0 ? 'text-red-300' : 'text-emerald-300'} />}
            </div>
            <p className="text-[11px] text-gray-500 mt-2.5">{action.reasonText}</p>
          </div>
        )}

        {blocked && (
          <div className="mb-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
            대상 자산을 찾을 수 없거나 보유수량이 0입니다. 이미 매도되었을 수 있습니다.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">체결일</label>
            <input
              type="date" value={fillDate} max={todayISO()} onChange={e => setFillDate(e.target.value)} disabled={isSubmitting || blocked}
              className="w-full text-sm bg-gray-900 border border-gray-600 rounded-md px-2.5 py-2 text-gray-100 focus:outline-none focus:border-primary disabled:opacity-50"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">체결가{ccy ? ` (${ccy})` : ''}</label>
              <input
                type="number" step="any" min="0" value={fillPrice} onChange={e => setFillPrice(e.target.value)} disabled={isSubmitting || blocked}
                placeholder={asset && asset.currentPrice <= 0 ? '현재가 없음 — 입력 필요' : undefined}
                className="w-full text-sm bg-gray-900 border border-gray-600 rounded-md px-2.5 py-2 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-primary disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">수량 (전량)</label>
              <input
                type="text" value={asset ? String(asset.quantity) : '—'} readOnly disabled
                className="w-full text-sm bg-gray-900 border border-gray-600 rounded-md px-2.5 py-2 text-gray-100 opacity-70 cursor-not-allowed"
              />
            </div>
          </div>

          <p className="text-[11px] text-gray-500">
            청산 손익은 해외주식 양도세 통산에 영향을 줄 수 있습니다(참고 — 확정 세무 판단 아님).
          </p>

          {error && (
            <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">{error}</div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={isSubmitting} className="text-sm text-gray-300 hover:text-white px-4 py-2 rounded-md transition-colors disabled:opacity-50">취소</button>
            <button type="submit" disabled={!canSubmit} className="text-sm font-medium text-white bg-red-600 hover:bg-red-500 px-4 py-2 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {isSubmitting ? '실행 중...' : '매도 실행'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string; tone?: string }> = ({ label, value, tone }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-gray-400">{label}</span>
    <span className={`font-medium ${tone ?? 'text-gray-100'}`}>{value}</span>
  </div>
);

export default CleanupExecuteModal;
