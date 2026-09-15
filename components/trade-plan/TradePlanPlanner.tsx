// components/trade-plan/TradePlanPlanner.tsx
// "새 매수 계획" 독립 화면(P2c, 계획서 §3.1/§4.2 스크린샷 흐름) — 종목 검색 → 현재가 조회 →
// 매수가(직접 수정 가능) → embedded `TradePlanEditor`(강의 세그먼트+계획 보기 미리보기) →
// [관심종목에 계획과 함께 저장] / [지금 매수 기록하며 저장] / [닫기].
//
// 계산은 전부 `hooks/useTradePlanPlanner`(검색·시세 조회·저장 경로)와 `TradePlanEditor`
// (buildTradePlan) 에 위임한다 — 이 컴포넌트는 렌더·조립만 한다.
// App.tsx에 `<TradePlanBulkWizard />` 옆 한 줄로 마운트(prop 없음, modal.plannerOpen이 열림 상태).
//
// Stage D2(2026-09-16): 수제 백드롭/패널 → 공용 `Modal`(size lg, 90dvh, 고정 footer),
// 종목 검색 드롭다운 → 공용 `Combobox`(입력칸 포커스 중에만 목록 표시), 검색/시세 오류 → `FieldError`.
// 닫기는 X·Esc·백드롭 모두 `handleClose`(saveError 초기화 후 onClose) — 미저장 확인은 두지 않는다.

import React, { useId, useRef, useState } from 'react';
import type { SymbolSearchResult } from '../../types';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { useTradePlanPlanner } from '../../hooks/useTradePlanPlanner';
import { formatPlanPrice } from '../../utils/tradePlan';
import TradePlanEditor, { type TradePlanEditorHandle } from './TradePlanEditor';
import TradePlanIntro, { hasSeenTradePlanIntro } from './TradePlanIntro';
import Button from '../common/Button';
import Modal from '../common/Modal';
import Combobox from '../common/Combobox';
import FieldError from '../common/FieldError';
import { CircleAlert } from 'lucide-react';

const INCOMPLETE_PLAN_MESSAGE = '계획을 먼저 완성해 주세요(위 항목을 확인하세요).';

const TradePlanPlanner: React.FC = () => {
  const { modal, actions } = usePortfolio();
  const isOpen = modal.plannerOpen;
  const onClose = actions.closeTradePlanPlanner;

  const planner = useTradePlanPlanner(modal.plannerPrefill);
  const editorRef = useRef<TradePlanEditorHandle>(null);
  const saveErrorRef = useRef<HTMLDivElement>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const searchInputId = useId();
  const buyPriceInputId = useId();
  const searchErrorId = useId();
  const quoteErrorId = useId();

  // 첫 실행 안내 — "렌더 중 조정" 패턴(TradePlanBulkWizard와 동일 관례, effect+setState 대신
  // 렌더 중 비교라 react-hooks/set-state-in-effect 위반이 아니다). 열릴 때마다 최신 flag로 재평가.
  const [showIntro, setShowIntro] = useState<boolean>(() => !hasSeenTradePlanIntro());
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) setShowIntro(!hasSeenTradePlanIntro());
  }

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

  // footer가 고정(스크롤 밖)이라 본문을 위로 올려 둔 채 저장을 누르면 본문 맨 아래 오류가 안 보일 수 있다 —
  // 커밋 뒤 프레임에서 오류 상자를 본문 스크롤 안으로 끌어온다(같은 문구로 다시 눌러도 동작).
  const showSaveError = () => {
    setSaveError(INCOMPLETE_PLAN_MESSAGE);
    requestAnimationFrame(() => saveErrorRef.current?.scrollIntoView({ block: 'nearest' }));
  };

  const handleSaveToWatchlist = () => {
    const r = editorRef.current?.getResult();
    if (!r || !r.ok) { showSaveError(); return; }
    planner.saveToWatchlist(r.plan);
    onClose();
  };

  const handleBuyNow = () => {
    const r = editorRef.current?.getResult();
    if (!r || !r.ok) { showSaveError(); return; }
    planner.buyNowWithPlan(r.plan, r.plan.plannedQuantity);
    // buyNowWithPlan이 AddNewAssetModal 프리필을 열며 플래너를 스스로 닫는다.
  };

  const showSearchPanel = !planner.selected && planner.query.trim().length >= 2;

  // 검색 입력칸 설명: 검색 오류 + 현재가 조회 오류(둘 다 서비스 실패 상태 문구) — 보이는 문구만 연결.
  // 입력값이 틀린 게 아니므로 aria-invalid 는 두지 않는다(AddNewAssetModal 과 동일).
  const searchDescribedBy =
    [planner.searchError ? searchErrorId : null, planner.quoteError ? quoteErrorId : null]
      .filter((id): id is string => id !== null)
      .join(' ') || undefined;

  return (
    <Modal
      open={isOpen}
      onClose={handleClose}
      size="lg"
      title="새 매수 계획"
      description="종목을 검색하고, 사기 전에 손절선·익절선·추세선을 먼저 정합니다."
      footer={
        <div className="w-full flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2">
          <Button variant="ghost" onClick={handleClose} className="order-3 sm:order-1">
            닫기
          </Button>
          <Button variant="secondary" onClick={handleSaveToWatchlist} disabled={!planner.target} className="order-2">
            관심종목에 계획과 함께 저장
          </Button>
          <Button variant="primary" onClick={handleBuyNow} disabled={!planner.target} className="order-1 sm:order-3">
            지금 매수 기록하며 저장
          </Button>
        </div>
      }
    >
      {showIntro && <TradePlanIntro onDismiss={() => setShowIntro(false)} className="mb-4" />}

      {/* 종목 검색 */}
      <div className="mb-4">
        <label htmlFor={searchInputId} className="block text-xs font-medium text-gray-300 mb-1">종목 검색</label>
        <div className="flex items-stretch gap-2">
          <Combobox<SymbolSearchResult>
            className="flex-1 min-w-0"
            inputId={searchInputId}
            inputValue={planner.query}
            onInputChange={(value) => {
              setSaveError(null);
              // 선택된 상태에서 타이핑 = 선택 해제 + 입력값을 새 검색어로 유지(clearSelection 이 query 를 비우지 않게 값 전달)
              if (planner.selected) planner.clearSelection(value);
              else planner.setQuery(value);
            }}
            placeholder="예: Apple, 삼성전자, SLV"
            aria-describedby={searchDescribedBy}
            open={showSearchPanel}
            options={planner.results}
            getOptionKey={(r) => `${r.ticker}-${r.exchange}`}
            renderOption={(r) => (
              <>
                <div className="font-bold text-white text-sm">{r.name} ({r.ticker})</div>
                <div className="text-xs text-gray-400">{r.exchange}</div>
              </>
            )}
            onSelect={handleSelect}
            loading={planner.isSearching}
            emptyText={planner.searchError ? undefined : '검색 결과가 없습니다.'}
            listboxLabel="종목 검색 결과"
          />
          {planner.selected && (
            <Button
              variant="secondary"
              onClick={() => {
                setSaveError(null);
                planner.clearSelection();
                // 이 버튼은 선택 해제로 사라진다 — 포커스가 body로 떨어지지 않게 검색 입력칸으로 옮긴다
                document.getElementById(searchInputId)?.focus();
              }}
              className="shrink-0 whitespace-nowrap"
              title="다른 종목 검색"
            >
              변경
            </Button>
          )}
        </div>
        {planner.searchError && (
          <FieldError id={searchErrorId} className="mt-1">{planner.searchError}</FieldError>
        )}
      </div>

      {planner.selected && (
        <>
          {/* 현재가 표시 */}
          <div className="mb-4 text-sm">
            {planner.isQuoteLoading && <p className="text-gray-400">현재가를 조회하고 있습니다…</p>}
            {planner.quoteError && <FieldError id={quoteErrorId}>{planner.quoteError}</FieldError>}
            {planner.quote && (
              <p className="text-gray-200">
                <span className="font-bold text-white">{planner.selected.ticker}</span> 현재가{' '}
                <span className="font-semibold text-primary-light">{formatPlanPrice(planner.quote.priceOriginal, planner.quote.currency)}</span>
                {' '}({planner.quote.priceDate.slice(5)} {planner.quote.isIntraday ? '장중' : '종가'})
                {planner.existingPlan && <span className="ml-2 text-xs text-warning">이미 계획이 있습니다 — 수정 모드</span>}
              </p>
            )}
          </div>

          {/* 매수가 (기본 현재가, 직접 수정) */}
          {planner.quote && (
            <div className="mb-4">
              <label htmlFor={buyPriceInputId} className="block text-xs font-medium text-gray-300 mb-1">
                매수가 <span className="text-gray-500 font-normal">({planner.quote.currency}, 기본값 = 현재가)</span>
              </label>
              <input
                id={buyPriceInputId}
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
        <div ref={saveErrorRef} className="mt-3 flex items-start gap-1.5 text-sm text-danger bg-danger-soft border border-danger/30 rounded-md px-3 py-2" role="alert"><CircleAlert className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />{saveError}</div>
      )}
    </Modal>
  );
};

export default TradePlanPlanner;
