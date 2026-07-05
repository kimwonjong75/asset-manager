// components/execution/TurtleExecuteModal.tsx
// ---------------------------------------------------------------------------
// 터틀 주문 실행 전용 모달 (Phase 2b-4b-2-ii).
//
// 설계 원칙 (PLAN §5.5 이슈 A / Codex 불변식):
//   · **기존 3개 모달(Add/BuyMore/Sell) 무접촉** — 이 모달은 렌더 + 입력만 담당.
//   · 오케스트레이션은 `useActionQueue().executeTurtleAction` (ExecutionView에서 prop으로 주입 —
//     훅 인스턴스 중복 방지). 여기서 useActionQueue를 다시 부르지 않는다.
//   · 폼 기본값 = 주문안(proposal: refPrice/quantity). lifecycle은 사용자 최종 입력값 기준으로 저장됨.
//   · **action 원본을 mutation하지 않음** — 로컬 state로만 편집.
//   · submit → executeTurtleAction await. ok면 닫기, ok:false면 사유 표시 + 모달 유지(pending 그대로).
//   · 취소 = 닫기만 (아무 상태 변경 없음). 성공 후 refresh 자동 호출 없음(사용자가 다시 "오늘 주문 생성").
//   · 통화 규약(D6): 체결가/손절선은 종목 통화(원통화). 커밋은 executeTurtleAction 내부 단일 commit.
// UI 렌더만 담당(프로젝트 규칙).

import React, { useEffect, useMemo, useState } from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { ActionItem, ActionKind } from '../../types/actionQueue';
import { TurtleFill } from '../../utils/turtleExecution';
import { getCategoryName } from '../../types/category';

interface Props {
  executeTurtleAction: (action: ActionItem, fill: TurtleFill) => Promise<{ ok: boolean; reason?: string }>;
}

const todayISO = (): string => new Date().toISOString().slice(0, 10);
const fmt = (n: number | undefined): string =>
  typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('ko-KR', { maximumFractionDigits: 4 }) : '—';

const KIND_LABEL: Record<ActionKind, string> = {
  TURTLE_ENTRY: '신규 매수 (진입)',
  TURTLE_PYRAMID: '불타기 추가 매수',
  TURTLE_STOP: '손절 매도',
  TURTLE_EXIT: '청산 매도',
  REBALANCE_SELL: '리밸런싱 매도',
  REBALANCE_BUY: '리밸런싱 매수',
  CLEANUP_SELL: '대청소 정리',
};

// executeTurtleAction / 머니액션이 돌려주는 내부 사유 코드 → 사용자 메시지
const REASON_LABEL: Record<string, string> = {
  'candidate-missing': '관심종목 정보를 찾을 수 없습니다. 관심종목 목록을 확인하세요.',
  'position-missing': '연결된 오픈 포지션을 찾을 수 없습니다. 이미 종료된 주문일 수 있습니다.',
  'resolve-failed': '주문 정보(수량/가격/포지션)가 불완전해 실행할 수 없습니다.',
  'unsupported-kind': '이 모달에서 실행할 수 없는 주문 종류입니다.',
  exception: '실행 중 오류가 발생했습니다. 다시 시도해 주세요.',
};

interface Resolution {
  blocked: boolean;
  blockReason: string | null;
  currencyLabel: string | null;
  exchangeLabel: string | null;
  categoryLabel: string | null;
  extraRows: { label: string; value: number | undefined }[];
  quantityLocked: boolean;   // STOP/EXIT = 전량, 수량 편집 금지
}

const TurtleExecuteModal: React.FC<Props> = ({ executeTurtleAction }) => {
  const { modal, data, actions } = usePortfolio();
  const action = modal.turtleExecAction;
  const { watchlist, turtlePositions, assets, categoryStore } = data;
  const onClose = actions.closeTurtleExecution;

  const [fillDate, setFillDate] = useState<string>(todayISO());
  const [fillPrice, setFillPrice] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 주문 변경 시 프리필 (원본 action은 읽기만 — 기본값=proposal). id 기준으로만 리셋.
  useEffect(() => {
    if (!action) return;
    setFillDate(todayISO());
    setFillPrice(String(action.refPrice ?? ''));
    setQuantity(String(action.quantity ?? ''));
    setIsSubmitting(false);
    setError(null);
  }, [action?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // kind별 실행 가능 여부 + 표시 메타 해석 (임의 기본값 저장 방지 — 부족하면 blocked).
  const resolution = useMemo<Resolution | null>(() => {
    if (!action) return null;
    const snap = action.ruleSnapshot ?? {};
    const catName = (categoryId: number): string => getCategoryName(categoryId, categoryStore.categories);

    if (action.kind === 'TURTLE_ENTRY') {
      const w = watchlist.find(x => x.ticker === action.ticker);
      const missing: string[] = [];
      if (!w) missing.push('관심종목');
      if (w && !w.exchange) missing.push('거래소');
      if (w && !w.currency) missing.push('통화');
      if (w && !Number.isFinite(w.categoryId)) missing.push('카테고리');
      return {
        blocked: missing.length > 0,
        blockReason: missing.length > 0 ? `${missing.join(' · ')} 정보가 없어 실행할 수 없습니다.` : null,
        currencyLabel: w?.currency ?? null,
        exchangeLabel: w?.exchange ?? null,
        categoryLabel: w && Number.isFinite(w.categoryId) ? catName(w.categoryId) : null,
        extraRows: [
          { label: `${action.name} 돌파 기준(돈치안)`, value: snap.donchianHigh },
          { label: 'N (20일 ATR)', value: snap.n },
          { label: '진입 손절선', value: snap.stopPrice },
        ],
        quantityLocked: false,
      };
    }

    // 포지션 계열(PYRAMID/STOP/EXIT) — 오픈 포지션 필수
    const pos = turtlePositions.find(p => p.id === action.positionId && p.status === 'open');
    if (!action.positionId || !pos || !pos.assetId) {
      return {
        blocked: true,
        blockReason: '연결된 오픈 포지션을 찾을 수 없어 실행할 수 없습니다.',
        currencyLabel: null, exchangeLabel: null, categoryLabel: null,
        extraRows: [], quantityLocked: action.kind !== 'TURTLE_PYRAMID',
      };
    }
    const asset = assets.find(a => a.id === pos.assetId);
    const extraRows: { label: string; value: number | undefined }[] =
      action.kind === 'TURTLE_PYRAMID'
        ? [{ label: '상향 손절선', value: snap.newStopPrice }, { label: 'N (20일 ATR)', value: snap.n }, { label: '현재 손절선', value: pos.stopPrice }]
        : action.kind === 'TURTLE_STOP'
          ? [{ label: '손절선', value: snap.stopPrice ?? pos.stopPrice }, { label: '트리거 가격', value: snap.triggerPrice }]
          : [{ label: '청산 트리거(20일 최저)', value: snap.donchianLow }, { label: '현재 손절선', value: pos.stopPrice }];
    return {
      blocked: false,
      blockReason: null,
      currencyLabel: asset?.currency ?? null,
      exchangeLabel: asset?.exchange ?? null,
      categoryLabel: asset ? catName(asset.categoryId) : null,
      extraRows,
      quantityLocked: action.kind === 'TURTLE_STOP' || action.kind === 'TURTLE_EXIT',
    };
  }, [action, watchlist, turtlePositions, assets, categoryStore]);

  if (!action || !resolution) return null;

  const priceNum = parseFloat(fillPrice);
  const qtyNum = parseFloat(quantity);
  const inputValid = !!fillDate && priceNum > 0 && qtyNum > 0;
  const canSubmit = inputValid && !resolution.blocked && !isSubmitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return; // 중복 클릭·미충족·차단 방지
    setIsSubmitting(true);
    setError(null);
    const res = await executeTurtleAction(action, { fillDate, fillPrice: priceNum, quantity: qtyNum });
    if (res.ok) {
      onClose(); // 성공 → 닫기 (executeTurtleAction 내부에서 단일 commit 완료)
    } else {
      const msg = REASON_LABEL[res.reason ?? ''] ?? `실행에 실패했습니다${res.reason ? ` (${res.reason})` : ''}. 다시 시도해 주세요.`;
      setError(msg);          // pending 유지 — 커밋 없음
      setIsSubmitting(false);
    }
  };

  const isSell = action.kind === 'TURTLE_STOP' || action.kind === 'TURTLE_EXIT';
  const submitLabel = isSell ? '매도 실행' : '매수 실행';
  const ccy = resolution.currencyLabel ?? '';

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-gray-800 p-4 sm:p-6 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-white truncate">
              {KIND_LABEL[action.kind]}
            </h2>
            <p className="text-sm text-gray-400 mt-0.5">
              <span className="text-gray-200 font-medium">{action.name}</span>
              <span className="text-gray-500 ml-2">{action.ticker}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 text-gray-400 hover:text-white text-xl leading-none px-1"
            aria-label="닫기"
          >×</button>
        </div>

        {/* 주문 근거 + 스냅샷 */}
        <div className="bg-gray-700/60 rounded-md p-3.5 mb-4">
          <p className="text-sm text-gray-200">{action.reasonText}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3 text-xs">
            {resolution.extraRows.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <span className="text-gray-400">{r.label}</span>
                <span className="text-gray-100 font-medium">{fmt(r.value)}{r.value != null && ccy ? ` ${ccy}` : ''}</span>
              </div>
            ))}
            {(resolution.exchangeLabel || resolution.categoryLabel) && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-400">거래소 · 분류</span>
                <span className="text-gray-100 font-medium truncate">
                  {resolution.exchangeLabel ?? '—'}{resolution.categoryLabel ? ` · ${resolution.categoryLabel}` : ''}
                </span>
              </div>
            )}
          </div>
        </div>

        {resolution.blocked && (
          <div className="mb-4 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
            {resolution.blockReason}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">체결일</label>
            <input
              type="date"
              value={fillDate}
              max={todayISO()}
              onChange={e => setFillDate(e.target.value)}
              disabled={isSubmitting}
              className="w-full text-sm bg-gray-900 border border-gray-600 rounded-md px-2.5 py-2 text-gray-100 focus:outline-none focus:border-primary disabled:opacity-50"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                체결가{ccy ? ` (${ccy})` : ''}
              </label>
              <input
                type="number"
                step="any"
                min="0"
                value={fillPrice}
                onChange={e => setFillPrice(e.target.value)}
                disabled={isSubmitting}
                className="w-full text-sm bg-gray-900 border border-gray-600 rounded-md px-2.5 py-2 text-gray-100 focus:outline-none focus:border-primary disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                수량{resolution.quantityLocked ? ' (전량)' : ''}
              </label>
              <input
                type="number"
                step="any"
                min="0"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                readOnly={resolution.quantityLocked}
                disabled={isSubmitting}
                className={`w-full text-sm bg-gray-900 border border-gray-600 rounded-md px-2.5 py-2 text-gray-100 focus:outline-none focus:border-primary disabled:opacity-50 ${resolution.quantityLocked ? 'opacity-70 cursor-not-allowed' : ''}`}
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="text-sm text-gray-300 hover:text-white px-4 py-2 rounded-md transition-colors disabled:opacity-50"
            >취소</button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={`text-sm font-medium text-white px-4 py-2 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isSell ? 'bg-red-600 hover:bg-red-500' : 'bg-primary hover:bg-primary-dark'}`}
            >{isSubmitting ? '실행 중...' : submitLabel}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TurtleExecuteModal;
