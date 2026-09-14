// components/trade-plan/TradePlanPlanner.tsx
// "새 매수 계획" 독립 화면(P2c, 계획서 §3.1/§4.2 스크린샷 흐름) — 종목 검색 → 현재가 조회 →
// 매수가(직접 수정 가능) → embedded `TradePlanEditor`(강의 세그먼트+계획 보기 미리보기) →
// [관심종목에 계획과 함께 저장] / [지금 매수 기록하며 저장] / [닫기].
//
// 계산은 전부 `hooks/useTradePlanPlanner`(검색·시세 조회·저장 경로)와 `TradePlanEditor`
// (buildTradePlan) 에 위임한다 — 이 컴포넌트는 렌더·조립만 한다.
// App.tsx에 `<TradePlanBulkWizard />` 옆 한 줄로 마운트(prop 없음, modal.plannerOpen이 열림 상태).

import React, { useRef, useState } from 'react';
import type { SymbolSearchResult } from '../../types';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { useTradePlanPlanner } from '../../hooks/useTradePlanPlanner';
import { formatPlanPrice } from '../../utils/tradePlan';
import TradePlanEditor, { type TradePlanEditorHandle } from './TradePlanEditor';
import TradePlanIntro, { hasSeenTradePlanIntro } from './TradePlanIntro';

const TradePlanPlanner: React.FC = () => {
  const { modal, actions } = usePortfolio();
  const isOpen = modal.plannerOpen;
  const onClose = actions.closeTradePlanPlanner;

  const planner = useTradePlanPlanner(modal.plannerPrefill);
  const editorRef = useRef<TradePlanEditorHandle>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 첫 실행 안내 — "렌더 중 조정" 패턴(TradePlanBulkWizard와 동일 관례, effect+setState 대신
  // 렌더 중 비교라 react-hooks/set-state-in-effect 위반이 아니다). 열릴 때마다 최신 flag로 재평가.
  const [showIntro, setShowIntro] = useState<boolean>(() => !hasSeenTradePlanIntro());
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) setShowIntro(!hasSeenTradePlanIntro());
  }

  if (!isOpen) return null;

  const inputClasses =
    'w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition';

  const handleSelect = (r: SymbolSearchResult) => {
    setSaveError(null);
    planner.selectSymbol(r);
  };

  const handleClose = () => {
    setSaveError(null);
    onClose();
  };

  const handleSaveToWatchlist = () => {
    const r = editorRef.current?.getResult();
    if (!r || !r.ok) { setSaveError('계획을 먼저 완성해 주세요(위 항목을 확인하세요).'); return; }
    planner.saveToWatchlist(r.plan);
    onClose();
  };

  const handleBuyNow = () => {
    const r = editorRef.current?.getResult();
    if (!r || !r.ok) { setSaveError('계획을 먼저 완성해 주세요(위 항목을 확인하세요).'); return; }
    planner.buyNowWithPlan(r.plan, r.plan.plannedQuantity);
    // buyNowWithPlan이 AddNewAssetModal 프리필을 열며 플래너를 스스로 닫는다.
  };

  const showSearchPanel = !planner.selected && planner.query.trim().length >= 2;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-modal p-2 sm:p-4" onClick={handleClose} role="dialog" aria-modal="true">
      <div
        className="bg-gray-800 p-4 sm:p-6 rounded-lg shadow-xl w-full max-w-xl max-h-[95dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-white">새 매수 계획</h2>
            <p className="text-xs text-gray-400 mt-0.5">종목을 검색하고, 사기 전에 손절선·익절선·추세선을 먼저 정합니다.</p>
          </div>
          <button type="button" onClick={handleClose} className="flex-shrink-0 text-gray-400 hover:text-white text-xl leading-none px-1" aria-label="닫기">×</button>
        </div>

        {showIntro && <TradePlanIntro onDismiss={() => setShowIntro(false)} className="mb-4" />}

        {/* 종목 검색 */}
        <div className="relative mb-4">
          <label className="block text-xs font-medium text-gray-300 mb-1">종목 검색</label>
          <input
            type="text"
            value={planner.query}
            onChange={(e) => { setSaveError(null); planner.setQuery(e.target.value); if (planner.selected) planner.clearSelection(); }}
            placeholder="예: Apple, 삼성전자, SLV"
            className={inputClasses}
            autoComplete="off"
          />
          {planner.selected && (
            <button
              type="button"
              onClick={() => { setSaveError(null); planner.clearSelection(); }}
              className="absolute right-2 top-7 text-xs text-gray-400 hover:text-white px-1"
              title="다른 종목 검색"
            >
              변경
            </button>
          )}
          {planner.searchError && <p className="text-danger text-xs mt-1">{planner.searchError}</p>}
          {showSearchPanel && (
            <div className="absolute z-10 w-full bg-gray-700 border border-gray-600 rounded-md mt-1 max-h-64 overflow-y-auto shadow-lg">
              {planner.results.length > 0 ? (
                <ul>
                  {planner.results.map((r) => (
                    <li
                      key={`${r.ticker}-${r.exchange}`}
                      onMouseDown={() => handleSelect(r)}
                      className="px-3 py-2 cursor-pointer hover:bg-primary-dark transition-colors"
                      role="option"
                      aria-selected="false"
                    >
                      <div className="font-bold text-white text-sm">{r.name} ({r.ticker})</div>
                      <div className="text-xs text-gray-400">{r.exchange}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                !planner.isSearching && <div className="px-3 py-2 text-sm text-gray-400">검색 결과가 없습니다.</div>
              )}
            </div>
          )}
        </div>

        {planner.selected && (
          <>
            {/* 현재가 표시 */}
            <div className="mb-4 text-sm">
              {planner.isQuoteLoading && <p className="text-gray-400">현재가를 조회하고 있습니다…</p>}
              {planner.quoteError && <p className="text-danger">{planner.quoteError}</p>}
              {planner.quote && (
                <p className="text-gray-200">
                  <span className="font-bold text-white">{planner.selected.ticker}</span> 현재가{' '}
                  <span className="font-semibold text-primary-light">{formatPlanPrice(planner.quote.priceOriginal, planner.quote.currency)}</span>
                  {' '}({planner.quote.priceDate.slice(5)} {planner.quote.isIntraday ? '장중' : '종가'})
                  {planner.existingPlan && <span className="ml-2 text-xs text-amber-400">이미 계획이 있습니다 — 수정 모드</span>}
                </p>
              )}
            </div>

            {/* 매수가 (기본 현재가, 직접 수정) */}
            {planner.quote && (
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  매수가 <span className="text-gray-500 font-normal">({planner.quote.currency}, 기본값 = 현재가)</span>
                </label>
                <input
                  type="number" min="0" step="any"
                  value={planner.buyPrice}
                  onChange={(e) => planner.setBuyPrice(e.target.value)}
                  className={inputClasses}
                />
              </div>
            )}

            {/* 계획 편집기(embedded — 저장/취소 푸터·intro는 이 컴포넌트가 대신 담당) */}
            {planner.target && (
              <TradePlanEditor
                ref={editorRef}
                embedded
                target={planner.target}
                existingPlan={planner.existingPlan}
              />
            )}
          </>
        )}

        {saveError && (
          <div className="mt-3 text-sm text-danger bg-danger-soft border border-danger/30 rounded-md px-3 py-2">{saveError}</div>
        )}

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-5">
          <button type="button" onClick={handleClose} className="text-sm text-gray-300 hover:text-white px-4 py-2 rounded-md transition-colors order-3 sm:order-1">
            닫기
          </button>
          <button
            type="button"
            onClick={handleSaveToWatchlist}
            disabled={!planner.target}
            className="text-sm font-medium text-white bg-gray-600 hover:bg-zinc-500 px-4 py-2 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed order-2"
          >
            관심종목에 계획과 함께 저장
          </button>
          <button
            type="button"
            onClick={handleBuyNow}
            disabled={!planner.target}
            className="text-sm font-medium text-white bg-primary hover:bg-primary-dark px-4 py-2 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed order-1 sm:order-3"
          >
            지금 매수 기록하며 저장
          </button>
        </div>
      </div>
    </div>
  );
};

export default TradePlanPlanner;
